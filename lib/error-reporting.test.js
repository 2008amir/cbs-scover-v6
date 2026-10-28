const test = require('node:test');
const assert = require('node:assert/strict');
const { reportError, redact, withErrorContext, handlerConsole } = require('./error-reporting');

test('group error cause goes to initiating user DM exactly once, never group', async () => {
    const sent = [], sock = { sendMessage: async (jid, content) => sent.push({ jid, ...content }) };
    const m = { chat: 'group@g.us', sender: '123@s.whatsapp.net', key: { id: 'one' } };
    const err = Object.assign(new Error('soffice: not found'), { code: 'ENOENT' });
    await reportError(sock, m, err, 'PDF'); await reportError(sock, m, err, 'PDF');
    assert.equal(sent.length, 1); assert.equal(sent[0].jid, '123@s.whatsapp.net');
    assert.ok(sent[0].text.includes('soffice: not found')); assert.ok(sent[0].text.includes('ENOENT'));
});

test('private notices preserve HTTP cause but never secrets, URLs, payloads or stacks', async () => {
    assert.equal(redact('secret-value', { HF_TOKEN: 'secret-value' }), '[REDACTED]');
    const sent = [];
    await reportError({ sendMessage: async (jid, content) => sent.push(content.text) },
        { key: { remoteJid: '123@lid' } }, { response: { status: 403, data: { private: 'payload-private' } },
            message: 'Access denied token=private-value https://host/?key=private-value hf_12345', stack: 'private stack' }, 'Voice changer');
    assert.ok(sent[0].includes('HTTP 403')); assert.ok(sent[0].includes('Access denied'));
    for (const secret of ['private-value', 'payload-private', 'hf_12345', 'private stack']) assert.equal(sent[0].includes(secret), false);
});

test('caught handler errors use the correct concurrent request scope', async () => {
    const sent = [], sock = { sendMessage: async (jid, content) => sent.push({ jid, ...content }) };
    await Promise.all(['111', '222'].map(id => withErrorContext(sock, { sender: `${id}@s.whatsapp.net` }, async () => {
        await new Promise(resolve => setImmediate(resolve)); handlerConsole.error(new Error(`failure ${id}`));
    })));
    assert.equal(sent.length, 2);
    for (const id of ['111', '222']) assert.ok(sent.find(item => item.jid === `${id}@s.whatsapp.net`).text.includes(`failure ${id}`));
});

test('locally caught V2 failure replies go privately and normal replies retain their destination', async () => {
    const sent = [], normal = [], sock = { sendMessage: async (jid, content) => sent.push({ jid, ...content }) };
    const m = { sender: '123@s.whatsapp.net', chat: 'group@g.us', reply: async text => normal.push(text) };
    await withErrorContext(sock, m, async () => {
        await m.reply('Conversion failed: unsupported format'); await m.reply('Done https://youtube.com/watch?v=abc');
    });
    assert.equal(sent[0].jid, m.sender); assert.ok(sent[0].text.includes('unsupported format'));
    assert.deepEqual(normal, ['Done https://youtube.com/watch?v=abc']);
});