const fs = require('fs');
const path = require('path');
const SETTINGS = path.join(__dirname, 'database', 'settings.json');
const sockets = new WeakSet();
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function mathematical(upper, lower, digits, exceptions = {}) {
    return text => Array.from(text, char => {
        if (exceptions[char]) return exceptions[char];
        const code = char.codePointAt(0);
        if (code >= 65 && code <= 90) return String.fromCodePoint(upper + code - 65);
        if (code >= 97 && code <= 122) return String.fromCodePoint(lower + code - 97);
        if (digits && code >= 48 && code <= 57) return String.fromCodePoint(digits + code - 48);
        return char;
    }).join('');
}
const mark = marks => text => Array.from(text, (char, index) => /[A-Za-z0-9]/.test(char) ? char + marks[index % marks.length] : char).join('');
const mapped = values => text => Array.from(text, char => {
    const index = alphabet.indexOf(char);
    return index >= 0 ? Array.from(values)[index] || char : char;
}).join('');
const styles = [
    ['bold', mathematical(0x1d400, 0x1d41a, 0x1d7ce)],
    ['italic', mathematical(0x1d434, 0x1d44e, null, { h: 'ℎ' })],
    ['bolditalic', mathematical(0x1d468, 0x1d482, 0x1d7ce)],
    ['script', mathematical(0x1d49c, 0x1d4b6, null, { B:'ℬ', E:'ℰ', F:'ℱ', H:'ℋ', I:'ℐ', L:'ℒ', M:'ℳ', R:'ℛ', e:'ℯ', g:'ℊ', o:'ℴ' })],
    ['boldscript', mathematical(0x1d4d0, 0x1d4ea)],
    ['gothic', mathematical(0x1d504, 0x1d51e, null, { C:'ℭ', H:'ℌ', I:'ℑ', R:'ℜ', Z:'ℨ' })],
    ['boldgothic', mathematical(0x1d56c, 0x1d586)],
    ['double', mathematical(0x1d538, 0x1d552, 0x1d7d8, { C:'ℂ', H:'ℍ', N:'ℕ', P:'ℙ', Q:'ℚ', R:'ℝ', Z:'ℤ' })],
    ['sans', mathematical(0x1d5a0, 0x1d5ba, 0x1d7e2)],
    ['sansbold', mathematical(0x1d5d4, 0x1d5ee, 0x1d7ec)],
    ['sansitalic', mathematical(0x1d608, 0x1d622)],
    ['sansbolditalic', mathematical(0x1d63c, 0x1d656, 0x1d7ec)],
    ['mono', mathematical(0x1d670, 0x1d68a, 0x1d7f6)],
    ['wide', text => Array.from(text, char => /[!-~]/.test(char) ? String.fromCodePoint(char.codePointAt(0) + 0xfee0) : char).join('')],
    ['circle', text => Array.from(text, char => {
        const code = char.codePointAt(0);
        return /[A-Z]/.test(char) ? String.fromCodePoint(0x24b6 + code - 65) : /[a-z]/.test(char) ? String.fromCodePoint(0x24d0 + code - 97) : char;
    }).join('')],
    ['square', text => Array.from(text, char => /[A-Za-z]/.test(char) ? String.fromCodePoint(0x1f130 + char.toUpperCase().charCodeAt(0) - 65) : char).join('')],
    ['blackcircle', text => Array.from(text, char => /[A-Za-z]/.test(char) ? String.fromCodePoint(0x1f150 + char.toUpperCase().charCodeAt(0) - 65) : char).join('')],
    ['blacksquare', text => Array.from(text, char => /[A-Za-z]/.test(char) ? String.fromCodePoint(0x1f170 + char.toUpperCase().charCodeAt(0) - 65) : char).join('')],
    ['smallcaps', mapped('ABCDEFGHIJKLMNOPQRSTUVWXYZᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ0123456789')],
    ['superscript', mapped('ᴬᴮᶜᴰᴱᶠᴳᴴᴵᴶᴷᴸᴹᴺᴼᴾQᴿˢᵀᵁⱽᵂˣʸᶻᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖqʳˢᵗᵘᵛʷˣʸᶻ⁰¹²³⁴⁵⁶⁷⁸⁹')],
    ['underline', mark(['\u0332'])],
    ['doubleunderline', mark(['\u0333'])],
    ['strike', mark(['\u0336'])],
    ['slash', mark(['\u0338'])],
    ['overline', mark(['\u0305'])],
    ['dotted', mark(['\u0307'])],
    ['bending', mark(['\u032f', '\u0311'])],
    ['ziza', mark(['\u030c', '\u032c'])],
    ['wave', mark(['\u0303'])],
    ['spaced', text => Array.from(text).join(' ')],
    ['tripleunderline', mark(['\u0332\u0333'])],
    ['shortstrike', mark(['\u0335'])],
    ['longslash', mark(['\u0337'])],
    ['ring', mark(['\u030a'])],
    ['diaeresis', mark(['\u0308'])],
    ['acute', mark(['\u0301'])],
    ['grave', mark(['\u0300'])],
    ['circumflex', mark(['\u0302'])],
    ['caron', mark(['\u030c'])],
    ['breve', mark(['\u0306'])],
    ['macron', mark(['\u0304'])],
    ['dotbelow', mark(['\u0323'])],
    ['diaeresisbelow', mark(['\u0324'])],
    ['tildebelow', mark(['\u0330'])],
    ['ringbelow', mark(['\u0325'])],
    ['bridgebelow', mark(['\u032a'])],
    ['arrowabove', mark(['\u20d7'])],
    ['doubleacute', mark(['\u030b'])],
    ['hookabove', mark(['\u0309'])],
    ['plusabove', mark(['\u031f'])]
].map(([name, transform]) => ({ name, transform }));
const aliases = { bolt: 'bold', bend: 'bending', zigzag: 'ziza', cursive: 'script', monospace: 'mono' };
function findStyle(name) {
    const input = String(name || '').trim();
    const key = input.normalize('NFKC').toLowerCase();
    return styles.find(style => style.name === (aliases[key] || key)) ||
        styles.find(style => style.transform(style.name) === input);
}
function styleText(text, name) {
    const style = findStyle(name);
    if (!style || typeof text !== 'string') return text;
    // Preserve links, mentions, inline code, and command syntax verbatim.
    return text.split(/(https?:\/\/\S+|www\.\S+|@[\w.+-]+|```[\s\S]*?```|`[^`]*`)/g)
        .map((part, index) => index % 2 ? part : style.transform(part)).join('');
}
function readSettings(file = SETTINGS) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}
function setFont(name, account, file = SETTINGS) {
    const style = name ? findStyle(name) : null;
    if (name && !style) throw new Error('Unknown font');
    fs.writeFileSync(file, JSON.stringify({ ...readSettings(file), fontStyle: style ? { account, name: style.name } : null }, null, 2));
}
const accountId = sock => String(sock.user?.id || '').replace(/:\d+(?=@)/, '');
function activeFont(sock, file = SETTINGS) {
    const setting = readSettings(file).fontStyle;
    return setting?.account === accountId(sock) ? findStyle(setting.name)?.name : null;
}
function isCommand(text) {
    const prefix = global.prefix ?? '.';
    if (text.startsWith('$')) return true;
    if (prefix) return text.startsWith(prefix);
    const name = text.trim().split(/\s+/)[0]?.toLowerCase();
    const layer = require('./v2');
    return layer.v1CommandNames().has(name) || Object.values(layer.menuGroups()).flat().some(value => value.toLowerCase() === name);
}
function attachFonts(sock, file = SETTINGS) {
    if (sockets.has(sock) || typeof sock.sendMessage !== 'function') return;
    sockets.add(sock);
    const send = sock.sendMessage.bind(sock);
    const edited = new Map();
    sock.sendMessage = async (jid, content, options = {}) => {
        const { fontPlain, ...rest } = options;
        const name = activeFont(sock, file);
        const payload = { ...content };
        if (name && !fontPlain && !content.delete && !content.react) {
            for (const key of ['text', 'caption']) {
                if (typeof payload[key] === 'string' && !isCommand(payload[key])) payload[key] = styleText(payload[key], name);
            }
        }
        const result = await send(jid, payload, rest);
        if (result?.key?.id) {
            edited.set(result.key.id, Date.now());
            if (edited.size > 500) edited.delete(edited.keys().next().value);
        }
        return result;
    };
    sock.ev.on('messages.upsert', async ({ messages = [], type }) => {
        if (type !== 'notify' || !activeFont(sock, file)) return;
        for (const raw of messages) {
            const key = raw.key;
            if (!key?.fromMe || !key.id || !key.remoteJid || key.remoteJid === 'status@broadcast') continue;
            const now = Date.now();
            for (const [id, time] of edited) if (now - time > 10 * 60 * 1000) edited.delete(id);
            if (edited.has(key.id)) continue;
            const timestamp = Number(raw.messageTimestamp?.toNumber?.() ?? raw.messageTimestamp?.low ?? raw.messageTimestamp);
            if (!timestamp || now / 1000 - timestamp > 10 * 60 || timestamp > now / 1000 + 60) continue;
            const body = raw.message?.ephemeralMessage?.message || raw.message;
            const text = body?.conversation || body?.extendedTextMessage?.text;
            if (!text || isCommand(text)) continue;
            const transformed = styleText(text, activeFont(sock, file));
            if (text === transformed) continue;
            edited.set(key.id, now);
            if (edited.size > 500) edited.delete(edited.keys().next().value);
            try { await send(key.remoteJid, { text: transformed, edit: key }); }
            catch { console.error('[Fonts] WhatsApp could not edit a linked-account message.'); }
        }
    });
}
module.exports = { styles, findStyle, styleText, setFont, activeFont, attachFonts, accountId };