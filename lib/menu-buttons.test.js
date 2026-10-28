const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const menus = require('./menu-buttons');
const fonts = require('./fonts');
const input = 'My menu; WhatsApp:(+2348012345678):(Hello: friend); Website:(link):(https://example.com/page?q=a:b); Call:(telecome):(+2348012345678); Reply:(chathere):(Hello group)';
function fixture() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-buttons-'));
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, JSON.stringify({ prefix: '!', fontStyle: null }));
    const sends = [];
    const sock = { user: { id: '123@s.whatsapp.net' }, sendMessage: async (chat, content, options) => sends.push({ chat, content, options }) };
    return { file, sock, sends, close: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
function tap(id, chat = 'group@g.us', stanza = 'menu-id', key = 'tap-id') {
    return { chat, key: { id: key }, message: { interactiveResponseMessage: {
        nativeFlowResponseMessage: { paramsJson: JSON.stringify({ id }) }, contextInfo: { stanzaId: stanza }
    } } };
}
test('phone buttons open the supplied WhatsApp number with its exact prepared message', () => {
    const button = menus.nativeButtons(menus.parseMenu(input), 'token')[0];
    assert.equal(button.name, 'cta_url');
    const params = JSON.parse(button.buttonParamsJson);
    assert.equal(params.display_text, 'WhatsApp');
    assert.equal(params.url, 'https://wa.me/2348012345678?text=Hello%3A%20friend');
});
test('link buttons preserve the supplied browser link including colons', () => {
    const button = menus.nativeButtons(menus.parseMenu(input), 'token')[1];
    assert.equal(button.name, 'cta_url');
    assert.equal(JSON.parse(button.buttonParamsJson).url, 'https://example.com/page?q=a:b');
});
test('telecome buttons target the supplied international dialer number', () => {
    const button = menus.nativeButtons(menus.parseMenu(input), 'token')[2];
    assert.equal(button.name, 'cta_call');
    assert.equal(JSON.parse(button.buttonParamsJson).phone_number, '+2348012345678');
});
test('chathere taps send exact text to the original group and deduplicate the incoming tap', async () => {
    const f = fixture();
    try {
        let buttons;
        await menus.sendMenu(f.sock, { chat: 'group@g.us' }, input, { file: f.file, sender: async (sock, chat, content) => { buttons = content.interactiveButtons; return { key: { id: 'menu-id' } }; } });
        const id = JSON.parse(buttons[3].buttonParamsJson).id;
        assert.equal(await menus.handleMenuButtonReply(f.sock, tap(id), { file: f.file }), true);
        await menus.handleMenuButtonReply(f.sock, tap(id), { file: f.file });
        assert.deepEqual(f.sends.map(send => [send.chat, send.content.text]), [['group@g.us', 'Hello group']]);
        assert.equal(JSON.parse(fs.readFileSync(f.file)).prefix, '!');
    } finally { f.close(); }
});
test('chathere survives a new socket and cannot send to another chat or use a forged menu stanza', async () => {
    const f = fixture();
    try {
        let buttons;
        await menus.sendMenu(f.sock, { chat: 'group@g.us' }, 'Menu; Reply:chathere:.setprefix stolen', { file: f.file, sender: async (sock, chat, content) => { buttons = content.interactiveButtons; return { key: { id: 'menu-id' } }; } });
        const id = JSON.parse(buttons[0].buttonParamsJson).id;
        await menus.handleMenuButtonReply(f.sock, tap(id, 'other@g.us'), { file: f.file });
        await menus.handleMenuButtonReply(f.sock, tap(id, 'group@g.us', 'forged'), { file: f.file });
        assert.equal(f.sends.length, 0);
        const replacement = { ...f.sock };
        await menus.handleMenuButtonReply(replacement, tap(id), { file: f.file });
        assert.equal(f.sends[0].content.text, '.setprefix stolen');
    } finally { f.close(); }
});
test('invalid inputs reject unsafe links and malformed phone numbers', () => {
    for (const input of ['Menu; Open:link:javascript:alert(1)', 'Menu; Open:link:https://user:pass@example.com', 'Menu; Call:telecome:abc1234567', 'Menu; Chat:123:Hello', 'Menu; Reply:chathere:']) assert.throws(() => menus.parseMenu(input));
    assert.deepEqual(menus.parseMenu('Menu; Chat:phone:+2348012345678:Hello').buttons[0], { label: 'Chat', type: 'phone', number: '2348012345678', text: 'Hello' });
});
test('expired menus cannot trigger replies and retention is bounded', async () => {
    const f = fixture();
    try {
        const now = Date.now();
        fs.writeFileSync(f.file, JSON.stringify({ menuButtonMenus: Object.fromEntries(Array.from({ length: 120 }, (_, i) => [String(i), { createdAt: now, texts: [] }])) }));
        let buttons;
        await menus.sendMenu(f.sock, { chat: 'group@g.us' }, 'Menu; Reply:chathere:Hello', { file: f.file, now, sender: async (sock, chat, content) => { buttons = content.interactiveButtons; return { key: { id: 'menu-id' } }; } });
        assert.equal(Object.keys(JSON.parse(fs.readFileSync(f.file)).menuButtonMenus).length, 100);
        await menus.handleMenuButtonReply(f.sock, tap(JSON.parse(buttons[0].buttonParamsJson).id), { file: f.file, now: now + 30 * 24 * 60 * 60 * 1000 });
        assert.equal(f.sends.length, 0);
    } finally { f.close(); }
});
test('fontpreview uses a copied selected font without changing activation', async () => {
    const f = fixture();
    const activeFont = fonts.activeFont;
    try {
        const { default: handler } = await import('../v2/plugins/tools/fontpreview.js');
        fonts.setFont('bold', fonts.accountId(f.sock), f.file);
        fonts.activeFont = sock => activeFont(sock, f.file);
        const before = fs.readFileSync(f.file, 'utf8');
        await handler({ chat: 'chat' }, { EliteProTech: f.sock, args: ['𝓈𝒸𝓇𝒾𝓅𝓉', 'Hello'] });
        assert.equal(f.sends[0].content.text, fonts.styleText('Hello', 'script'));
        assert.equal(f.sends[0].options.fontPlain, true);
        await handler({ chat: 'chat' }, { EliteProTech: f.sock, args: ['Hello', 'world'] });
        assert.equal(f.sends[1].content.text, '𝐇𝐞𝐥𝐥𝐨 𝐰𝐨𝐫𝐥𝐝');
        assert.equal(fs.readFileSync(f.file, 'utf8'), before);
    } finally { fonts.activeFont = activeFont; f.close(); }
});test('menus are sent without quoting the command and carry a replied image', async () => {
    const f = fixture();
    try {
        let call;
        const image = Buffer.from('img');
        await menus.sendMenu(f.sock, { chat: 'c' }, 'Menu; Site:link:https://example.com', { file: f.file, image, sender: async (...args) => { call = args; return { key: { id: 'x' } }; } });
        assert.equal(call[3], undefined);
        assert.equal(call[2].image, image);
    } finally { f.close(); }
});
