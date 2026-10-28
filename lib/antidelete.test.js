const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

function harness() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-'));
    fs.mkdirSync(path.join(dir, 'database/antidelete_store'), { recursive: true });
    const state = { antiDeleteAllowedFor: () => true, antiDeleteGroupEnabled: () => true };
    let now = 100000;
    const clock = { now: () => now };
    const context = vm.createContext({ global: state, __dirname: dir, fs, path, console,
        maintenance: require('./maintenance'), Date: clock });
    const index = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
    vm.runInContext(index.slice(index.indexOf('const ANTIDELETE_STORE_DIR ='), index.indexOf('/* ===== WHO DELETED IT =====')), context);
    return { state, context, dir, advance: ms => { now += ms; }, close: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

for (const jid of ['person@s.whatsapp.net', 'group@g.us']) {
    test(`each ${jid} recovery copy survives 23 hours and expires at 24 hours`, () => {
        const h = harness();
        try {
            h.state.antiDeleteSave(jid, 'first', { key: { remoteJid: jid, id: 'first' }, message: { conversation: 'original' } });
            h.advance(23 * 60 * 60 * 1000);
            assert.equal(h.state.antiDeleteLoad(jid, 'first').message.conversation, 'original');
            h.state.antiDeleteSave(jid, 'first', { key: { remoteJid: jid, id: 'first' }, message: { conversation: 'redelivery' } });
            h.state.antiDeleteSave(jid, 'second', { key: { remoteJid: jid, id: 'second' }, message: { conversation: 'newer' } });
            h.advance(60 * 60 * 1000);
            h.state.purgeAntiDeleteStore(true);
            assert.equal(h.state.antiDeleteLoad(jid, 'first'), null);
            assert.equal(h.state.antiDeleteLoad(jid, 'second').message.conversation, 'newer');
        } finally { h.close(); }
    });
}

test('capture and recovery continue after long uptime, reconnect and failed sends without reactivation', async () => {
    const h = harness();
    const source = fs.readFileSync(path.join(__dirname, 'v1/source.js'), 'utf8');
    const start = source.indexOf('const handledDeletes =');
    const end = source.indexOf("EliteProTech.ev.on('messages.upsert', async chatUpdate", start);
    let recovered = 0, fail = false;
    h.context.saveMessage = h.state.antiDeleteSave;
    h.context.loadMessage = h.state.antiDeleteLoad;
    h.context.getChatName = async () => 'Test chat';
    h.context.restoreMessage = async () => { if (fail) throw new Error('Temporary send failure'); recovered++; return { key: {} }; };
    h.state.antiDeleteIsOwnerDeleter = () => false;
    vm.runInContext(source.slice(source.indexOf('function handleAntiDeleteCapture('), source.indexOf('const store =')), h.context);
    try {
        for (let socket = 0; socket < 2; socket++) {
            const ev = new EventEmitter();
            h.context.EliteProTech = { ev, user: { id: 'owner@s.whatsapp.net' } };
            vm.runInContext(`(function() { ${source.slice(start, end)}; global.capture = handleAntiDeleteCapture; global.deleted = handleDeletedUpdates })()`, h.context);
            const jid = 'person@s.whatsapp.net';
            const key = { remoteJid: jid, id: `message-${socket}` };
            await h.state.capture(null, { key, message: { conversation: 'Saved before a slow command' } });
            h.advance(2 * 60 * 60 * 1000);
            fail = true;
            await h.state.deleted([{ key, deleted: true }]);
            fail = false;
            await h.state.deleted([{ key, update: { message: { protocolMessage: { type: 0, key } } } }]);
            await h.state.deleted([{ key, deleted: true }]);
            assert.equal(recovered, socket + 1);
            assert.ok(h.state.antiDeleteLoad(jid, key.id));
            assert.equal(ev.listenerCount('messages.delete'), 1);
            assert.equal(ev.listenerCount('messages.update'), 1);
            ev.removeAllListeners();
        }
    } finally { h.close(); }
});

test('real shared store captures messages without blocking later command listeners across reconnects', () => {
    const h = harness();
    const source = fs.readFileSync(path.join(__dirname, 'v1/source.js'), 'utf8');
    h.context.antiDeleteConfig = { enabled: true };
    try {
        // Reproduce the actual lexical boundary: store is outside socket startup.
        const snippet = source.slice(source.indexOf('const STORE_MAX_MESSAGES_PER_CHAT'), source.indexOf('let phoneNumber'));
        const store = vm.runInContext(snippet + '\nstore', h.context);
        for (let socket = 0; socket < 2; socket++) {
            const ev = new EventEmitter();
            let commands = 0;
            store.bind(ev);
            ev.on('messages.upsert', () => { commands++; });
            const key = { remoteJid: 'person@s.whatsapp.net', id: `command-${socket}` };
            assert.doesNotThrow(() => ev.emit('messages.upsert', { messages: [{ key, message: { conversation: '.ping' } }] }));
            assert.equal(commands, 1);
            assert.equal(h.state.antiDeleteLoad(key.remoteJid, key.id).message.conversation, '.ping');
            ev.removeAllListeners();
        }
    } finally { h.close(); }
});