const fs = require('fs');
const path = require('path');
const { randomBytes } = require('crypto');
const fonts = require('./fonts');
const SETTINGS = path.join(__dirname, 'database', 'settings.json');
const MAX_MENUS = 100;
const RETENTION = 30 * 24 * 60 * 60 * 1000;
const deliveries = new WeakMap();

const unwrap = value => value.trim().replace(/^\((.*)\)$/s, '$1').trim();
function phone(value) {
    const input = unwrap(value);
    if (!/^\+?[\d ()-]+$/.test(input)) throw new Error('Use an international phone number, including its country code.');
    const digits = input.replace(/\D/g, '');
    if (!/^[1-9]\d{6,14}$/.test(digits)) throw new Error('Use an international phone number, including its country code.');
    return digits;
}
function webLink(value) {
    let url;
    try { url = new URL(unwrap(value)); } catch { throw new Error('Links must start with https:// or http://.'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Use a public https:// or http:// link without credentials.');
    return url.href;
}
function parseMenu(input) {
    if (typeof input !== 'string' || input.length > 12000) throw new Error('Menu text is too long.');
    const [title, ...entries] = input.split(';').map(unwrap);
    if (!title || title.length > 1024 || !entries.length || entries.length > 10) throw new Error('Provide a menu name and 1–10 buttons separated by semicolons.');
    const buttons = entries.map(entry => {
        const match = /^([^:]+):([^:]+):([\s\S]+)$/.exec(entry);
        if (!match) throw new Error('Each button needs a label, action, and value separated by colons.');
        const label = unwrap(match[1]);
        const kind = unwrap(match[2]).toLowerCase();
        const value = unwrap(match[3]);
        if (!label || label.length > 80 || !value || value.length > 4000) throw new Error('Use a short button label and a nonempty value (up to 4000 characters).');
        if (kind === 'link') return { label, type: 'link', url: webLink(value) };
        if (['telecome', 'telecom', 'call'].includes(kind)) return { label, type: 'call', number: phone(value) };
        if (kind === 'chathere') return { label, type: 'chathere', text: value };
        if (['phone', 'number', 'phone number'].includes(kind)) {
            const separator = value.indexOf(':');
            if (separator < 0) throw new Error('Phone actions need an international number followed by :message.');
            const text = unwrap(value.slice(separator + 1));
            if (!text) throw new Error('Provide a message for the WhatsApp number.');
            return { label, type: 'phone', number: phone(value.slice(0, separator)), text };
        }
        return { label, type: 'phone', number: phone(match[2]), text: value };
    });
    return { title, buttons };
}
function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function retained(settings, now) {
    return Object.entries(settings.menuButtonMenus || {}).filter(([, menu]) => menu && now - menu.createdAt < RETENTION)
        .sort((a, b) => b[1].createdAt - a[1].createdAt).slice(0, MAX_MENUS);
}
function nativeButtons(menu, token) {
    return menu.buttons.map((button, index) => {
        if (button.type === 'chathere') return { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: button.label, id: `menubutton:${token}:${index}` }) };
        if (button.type === 'call') return { name: 'cta_call', buttonParamsJson: JSON.stringify({ display_text: button.label, phone_number: `+${button.number}`, id: `menubutton:${token}:${index}` }) };
        const url = button.type === 'phone' ? `https://wa.me/${button.number}?text=${encodeURIComponent(button.text)}` : button.url;
        return { name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: button.label, url, merchant_url: url }) };
    });
}
// Builds the native-flow message directly; WhatsApp needs the biz node for buttons to be tappable.
async function sendInteractive(sock, chat, { text, interactiveButtons, image }) {
    const { generateWAMessageFromContent, prepareWAMessageMedia, proto } = require('@whiskeysockets/baileys');
    let header = { title: '', subtitle: '', hasMediaAttachment: false };
    if (image) {
        const media = await prepareWAMessageMedia({ image }, { upload: sock.waUploadToServer });
        header = { title: '', subtitle: '', hasMediaAttachment: true, imageMessage: media.imageMessage };
    }
    const content = { viewOnceMessage: { message: {
        messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
        interactiveMessage: proto.Message.InteractiveMessage.fromObject({
            header, body: { text }, footer: { text: '' },
            nativeFlowMessage: { buttons: interactiveButtons, messageParamsJson: '' }
        })
    } } };
    const msg = generateWAMessageFromContent(chat, content, { userJid: sock.user?.id });
    await sock.relayMessage(chat, msg.message, { messageId: msg.key.id, additionalNodes: [{
        tag: 'biz', attrs: {}, content: [{ tag: 'interactive', attrs: { type: 'native_flow', v: '1' },
            content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }] }]
    }] });
    return msg;
}
async function sendMenu(sock, m, input, { file = SETTINGS, sender, now = Date.now(), image } = {}) {
    const menu = parseMenu(input);
    const token = randomBytes(12).toString('hex');
    // Validate the durable store before sending a menu whose replies need it.
    read(file);
    const send = sender || sendInteractive;
    const title = fonts.styleText(menu.title, fonts.activeFont(sock, file));
    // No quoted option: the menu must not show the original command in a reply box.
    const result = await send(sock, m.chat, { text: title, interactiveButtons: nativeButtons(menu, token), image });
    if (menu.buttons.some(button => button.type === 'chathere')) {
        const settings = read(file);
        const menus = Object.fromEntries(retained(settings, now).slice(0, MAX_MENUS - 1));
        menus[token] = { chat: m.chat, createdAt: now, messageId: result?.key?.id || null,
            texts: menu.buttons.map(button => button.type === 'chathere' ? button.text : null) };
        fs.writeFileSync(file, JSON.stringify({ ...settings, menuButtonMenus: menus }, null, 2));
    }
    return result;
}
function buttonResponse(m) {
    let body = m?.message;
    body = body?.ephemeralMessage?.message || body;
    body = body?.viewOnceMessage?.message || body;
    const response = body?.interactiveResponseMessage;
    if (response) {
        try { return { id: JSON.parse(response.nativeFlowResponseMessage.paramsJson).id, stanza: response.contextInfo?.stanzaId }; }
        catch { return null; }
    }
    const legacy = body?.buttonsResponseMessage || body?.templateButtonReplyMessage;
    return legacy ? { id: legacy.selectedButtonId || legacy.selectedId, stanza: legacy.contextInfo?.stanzaId } : null;
}
async function handleMenuButtonReply(sock, m, { file = SETTINGS, now = Date.now() } = {}) {
    const response = buttonResponse(m);
    const match = /^menubutton:([a-f0-9]{24}):(\d+)$/.exec(String(response?.id || ''));
    if (!match) return false;
    const menu = read(file).menuButtonMenus?.[match[1]];
    const text = menu?.texts?.[Number(match[2])];
    if (!menu || menu.chat !== m.chat || now - menu.createdAt >= RETENTION || typeof text !== 'string' ||
        (menu.messageId && response.stanza !== menu.messageId)) return true;
    if (!m.key?.id) return true;
    let seen = deliveries.get(sock);
    if (!seen) { seen = new Map(); deliveries.set(sock, seen); }
    const id = `${m.chat}:${m.key.id}`;
    if (seen.has(id)) return true;
    seen.set(id, 'pending');
    try {
        await sock.sendMessage(m.chat, { text });
        seen.set(id, 'sent');
        if (seen.size > 500) seen.delete(seen.keys().next().value);
    } catch (error) { seen.delete(id); throw error; }
    return true;
}
module.exports = { parseMenu, nativeButtons, sendMenu, buttonResponse, handleMenuButtonReply };