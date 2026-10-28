const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createConnectionHealth } = require('./connection-health');

function harness() {
    let time = 0;
    const timers = new Map();
    let id = 0;
    const health = createConnectionHealth({ now: () => time,
        interval: fn => { timers.set(++id, fn); return id; }, clear: key => timers.delete(key) });
    const socket = { ev: new EventEmitter(), ws: { isClosed: false, isClosing: false }, end() { this.ended = true; } };
    let reconnects = 0;
    health.attach(socket, () => reconnects++);
    return { health, socket, timers, advance(ms) { time += ms; for (const fn of timers.values()) fn(); }, get reconnects() { return reconnects; } };
}

test('an open idle connection remains usable after 24 hours', async () => {
    const h = harness();
    h.socket.ev.emit('connection.update', { connection: 'open' });
    const replies = [];
    h.socket.ev.on('messages.upsert', ({ messages }) => replies.push(`reply:${messages[0].text}`));
    h.advance(24 * 60 * 60 * 1000);
    h.socket.ev.emit('messages.upsert', { messages: [{ text: '.ping' }] });
    assert.deepEqual(replies, ['reply:.ping']);
    assert.equal(h.reconnects, 0);
});

test('a silently closed transport triggers just one recovery', () => {
    const h = harness();
    h.socket.ev.emit('connection.update', { connection: 'open' });
    h.socket.ws.isClosed = true;
    h.advance(30000);
    h.advance(30000);
    assert.equal(h.reconnects, 1);
});

test('a connecting socket gets 90 seconds before recovery', () => {
    const h = harness();
    h.advance(89999);
    assert.equal(h.reconnects, 0);
    h.advance(1);
    assert.equal(h.reconnects, 1);
});

test('replacement disposes old listeners and socket-scoped timers', () => {
    const h = harness();
    let cleanups = 0;
    h.health.interval(() => cleanups++, 60000);
    const next = { ev: new EventEmitter(), ws: {}, end() {} };
    h.health.attach(next, () => {});
    h.advance(60000);
    assert.equal(cleanups, 0);
    assert.equal(h.socket.ended, true);
    assert.equal(h.socket.ev.listenerCount('connection.update'), 0);
    assert.equal(h.timers.size, 1);
});

test('anti-delete private messages expire after 24 hours', () => checkRetention('123@s.whatsapp.net', 24 * 60 * 60 * 1000));
test('anti-delete group messages expire after 24 hours', () => checkRetention('123@g.us', 24 * 60 * 60 * 1000));
function checkRetention(jid, ttl) {
    const fs = require('node:fs');
    const vm = require('node:vm');
    const source = fs.readFileSync(require('node:path').join(__dirname, 'v1/source.js'), 'utf8');
    const snippet = source.slice(source.indexOf('const STORE_MAX_MESSAGES_PER_CHAT'), source.indexOf('let phoneNumber'));
    let time = 100000000;
    const context = vm.createContext({ Date: { now: () => time }, antiDeleteConfig: { enabled: true }, handleAntiDeleteCapture() {} });
    const store = vm.runInContext(snippet + '\nstore', context);
    const events = new EventEmitter();
    store.bind(events);
    events.emit('messages.upsert', { messages: [{ key: { remoteJid: jid, id: 'msg' }, message: { conversation: 'hello' } }] });
    time += ttl - 1;
    store.trim();
    assert.equal(store.messages[jid].msg.message.conversation, 'hello');
    time += 2;
    store.trim();
    assert.equal(store.messages[jid], undefined);
}