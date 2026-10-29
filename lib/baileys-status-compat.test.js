const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { patchGroupStatusMedia } = require('./baileys-status-compat');

test('installed relay classifies wrapped image, video and voice statuses without posting bare media', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'status-compat-'));
    try {
        const original = fs.readFileSync(path.join(__dirname, '../node_modules/baileys/lib/Socket/messages-send.js'), 'utf8');
        for (const name of ['baileys', '@whiskeysockets/baileys']) {
            const file = path.join(root, 'node_modules', name, 'lib', 'Socket', 'messages-send.js');
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, original.replace('        message = normalizeMessageContent(message) || {};\n', ''));
        }
        patchGroupStatusMedia(root);
        const file = path.join(root, 'node_modules/baileys/lib/Socket/messages-send.js');
        const patched = fs.readFileSync(file, 'utf8');
        patchGroupStatusMedia(root);
        assert.equal(fs.readFileSync(file, 'utf8'), patched, 'patch is idempotent');
        assert.equal(fs.readFileSync(path.join(root, 'node_modules/@whiskeysockets/baileys/lib/Socket/messages-send.js'), 'utf8'), patched);
        const real = require('baileys');
        let stanza, encrypted;
        const sandbox = {
            normalizeMessageContent: real.normalizeMessageContent,
            assertMeId: () => '123@s.whatsapp.net',
            jidDecode: real.jidDecode,
            generateMessageIDV2: () => 'id',
            authState: { creds: {}, keys: {
                transaction: async fn => fn(), get: async () => ({}), set: async () => {}
            } },
            patchMessageBeforeSending: async message => message,
            groupMetadata: async () => ({ participants: [], addressingMode: 'pn' }),
            getUSyncDevices: async () => [],
            signalRepository: { encryptGroupMessage: async ({ data }) => {
                encrypted = real.proto.Message.decode(data);
                return { ciphertext: Buffer.from('encrypted'), senderKeyDistributionMessage: Buffer.alloc(0) };
            } },
            encodeWAMessage: message => real.proto.Message.encode(message).finish(),
            sendNode: async node => { stanza = node; },
            shouldIncludeReportingToken: () => false,
            logger: { debug() {}, trace() {} },
            messageRetryManager: null
        };
        // Exercise the installed relay transaction, encryption and node creation,
        // without a live account, rather than simulating our send helper alone.
        const start = patched.indexOf('    const relayMessage = async');
        const end = patched.indexOf('    const issuePrivacyTokens =', start);
        const relay = vm.runInNewContext(patched.slice(start, end) + '\nrelayMessage;', sandbox);
        for (const [type, payload, mediatype] of [
            ['imageMessage', {}, 'image'], ['videoMessage', {}, 'video'],
            ['videoMessage', { gifPlayback: true }, 'gif'],
            ['audioMessage', { ptt: true }, 'ptt'], ['audioMessage', { ptt: false }, 'audio'],
            ['extendedTextMessage', { text: 'Status' }, undefined]
        ]) {
            await relay('222@g.us', { groupStatusMessageV2: { message: { [type]: payload } } },
                { messageId: 'request', useCachedGroupMetadata: false });
            assert.equal(stanza.attrs.to, '222@g.us');
            assert.equal(stanza.attrs.type, mediatype ? 'media' : 'text');
            const enc = stanza.content.find(node => node.tag === 'enc');
            assert.equal(enc.attrs.mediatype, mediatype);
            assert.ok(encrypted.groupStatusMessageV2.message[type]);
            assert.equal(encrypted[type], null, 'no normal chat media outside status');
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});