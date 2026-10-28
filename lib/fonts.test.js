const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const fonts = require('./fonts');

function fixture() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fonts-test-'));
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, '{"prefix":"!"}');
    const sends = []; const events = [];
    const sock = { user: { id: '123:4@s.whatsapp.net' }, ev: { on: (event, callback) => events.push(callback) },
        sendMessage: async (jid, content, options) => { sends.push({ jid, content, options }); return { key: { id: 'sent-' + sends.length } }; } };
    return { file, sock, sends, events, close: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
test('fonts offers exactly 50 distinct styles including bold, bending, and ziza', () => {
    assert.equal(fonts.styles.length, 50);
    assert.equal(new Set(fonts.styles.map(style => style.name)).size, 50);
    assert.equal(new Set(fonts.styles.map(style => style.transform('Sample123'))).size, 50);
    assert.equal(fonts.styleText('Ab1', 'bold'), '𝐀𝐛𝟏');
    assert.equal(fonts.styleText('Ab', 'bending'), 'A̯b̑');
    assert.equal(fonts.styleText('Ab', 'ziza'), 'Ǎb̬');
    assert.equal(fonts.findStyle('bolt').name, 'bold');
    for (const style of fonts.styles) assert.notEqual(fonts.styleText('Sample 123', style.name), 'Sample 123');
});
test('copied styled names resolve to their font, including script and uppercase square previews', () => {
    assert.equal(fonts.findStyle('𝓈𝒸𝓇𝒾𝓅𝓉')?.name, 'script');
    for (const style of fonts.styles) {
        assert.equal(fonts.findStyle(fonts.styleText(style.name, style.name))?.name, style.name);
    }
});
test('styled script activation saves the linked account and deactivation clears it', async () => {
    const { default: handler } = await import('../v2/plugins/tools/fonts.js');
    const f = fixture();
    const setFont = fonts.setFont;
    try {
        fonts.setFont = (name, account) => setFont(name, account, f.file);
        await handler({ chat: 'chat', fromMe: true }, { EliteProTech: f.sock, args: ['𝓈𝒸𝓇𝒾𝓅𝓉', 'activate'] });
        assert.equal(fonts.activeFont(f.sock, f.file), 'script');
        await handler({ chat: 'chat', fromMe: true }, { EliteProTech: f.sock, args: ['deactivate'] });
        assert.equal(fonts.activeFont(f.sock, f.file), null);
    } finally { fonts.setFont = setFont; f.close(); }
});
test('font conversion preserves URLs, mentions, emoji and code', () => {
    assert.equal(fonts.styleText('Hi https://example.com @123 `code` 🙂', 'bold'), '𝐇𝐢 https://example.com @123 `code` 🙂');
});
test('activation persists only for the linked account and deactivation restores plain replies', async () => {
    const f = fixture();
    try {
        fonts.setFont('bold', fonts.accountId(f.sock), f.file);
        fonts.attachFonts(f.sock, f.file); fonts.attachFonts(f.sock, f.file);
        assert.equal(f.events.length, 1);
        assert.equal(fonts.activeFont(f.sock, f.file), 'bold');
        assert.equal(fonts.activeFont({ user: { id: '999@s.whatsapp.net' } }, f.file), null);
        await f.sock.sendMessage('chat', { text: 'Hello', caption: 'Photo' });
        assert.equal(f.sends[0].content.text, '𝐇𝐞𝐥𝐥𝐨');
        assert.equal(f.sends[0].content.caption, '𝐏𝐡𝐨𝐭𝐨');
        await f.sock.sendMessage('chat', { text: '.fonts' }, { fontPlain: true });
        assert.equal(f.sends[1].content.text, '.fonts');
        assert.equal('fontPlain' in f.sends[1].options, false);
        fonts.setFont(null, fonts.accountId(f.sock), f.file);
        await f.sock.sendMessage('chat', { text: 'Hello' });
        assert.equal(f.sends[2].content.text, 'Hello');
        assert.equal(JSON.parse(fs.readFileSync(f.file)).prefix, '!');
    } finally { f.close(); }
});
test('only recent linked-account text is edited, once, without styling commands or incoming messages', async () => {
    const f = fixture(); const previous = global.prefix; global.prefix = '!';
    try {
        fonts.setFont('bold', fonts.accountId(f.sock), f.file); fonts.attachFonts(f.sock, f.file);
        const raw = (id, fromMe, text, age = 0) => ({ key: { id, fromMe, remoteJid: 'chat' }, message: { conversation: text }, messageTimestamp: Date.now() / 1000 - age });
        const messages = [raw('one', true, 'Hello'), raw('other', false, 'Hi'), raw('command', true, '!fonts bold activate'), raw('old', true, 'old', 1000)];
        await f.events[0]({ type: 'notify', messages });
        await f.events[0]({ type: 'notify', messages });
        assert.equal(f.sends.length, 1);
        assert.equal(f.sends[0].content.text, '𝐇𝐞𝐥𝐥𝐨');
        assert.equal(f.sends[0].content.edit.id, 'one');
    } finally { global.prefix = previous; f.close(); }
});
test('fonts command allows conversion but prevents other accounts from activating a font', async () => {
    const { default: handler } = await import('../v2/plugins/tools/fonts.js');
    const replies = [];
    const sock = { user: { id: '123@s.whatsapp.net' }, sendMessage: async (chat, content) => replies.push(content.text) };
    await handler({ chat: 'chat', fromMe: false }, { EliteProTech: sock, args: ['bold', 'Hi'] });
    assert.equal(replies[0], '𝐇𝐢');
    await handler({ chat: 'chat', fromMe: false }, { EliteProTech: sock, args: ['bold', 'activate'] });
    assert.match(replies[1], /Only the linked WhatsApp account/);
});