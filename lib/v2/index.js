/* ============================================================
   CBS-SCOVER-V2 command layer (CommonJS -> ESM bridge)
   ------------------------------------------------------------
   The full ELITE-PRO-V2 bot lives in ../../v2 exactly as shipped.
   This module lets the CommonJS V1 handler dispatch into the real
   V2 plugin engine, so both versions share one process, one
   WhatsApp connection and one HTTP server.
   ============================================================ */

const path = require('path');
const { pathToFileURL } = require('url');

const BRIDGE_PATH = path.join(__dirname, '..', '..', 'v2', 'bridge.js');

/* Commands V2 adds on top of V1 (used for the menu when the plugin engine has
   not finished loading yet). */
const FALLBACK_COMMANDS = [
    'autoviewlike', 'avl', 'avs', 'calc', 'calculator', 'dino', 'doom',
    'html', 'leavegroup', 'owners', 'piano', 'removeowner', 'sendhtml',
    'setting', 'speed', 'tovoice'
];

let bridgePromise = null;
let bridge = null;

const EXTRA_COMMANDS = new Set([
    'chatbot', 'chatbot-love', 'chatbotlove', 'chatbot-friend', 'chatbotfriend',
    'chatbot-love-start', 'chatbotlovestart', 'chatbot-lovestart',
    'voicehelp', 'addvoice', 'voices', 'delvoice', 'renamevoice', 'voicechanger'
]);
const claimedMessages = new Map();

function messageText(m) {
    const msg = m?.message?.ephemeralMessage?.message || m?.message?.viewOnceMessageV2?.message ||
        m?.message?.viewOnceMessage?.message || m?.message || {};
    return String(m?.text || m?.body || msg.conversation || msg.extendedTextMessage?.text ||
        msg.imageMessage?.caption || msg.videoMessage?.caption || msg.documentMessage?.caption || '');
}

function parseCommand(body, prefix = global.prefix ?? '.') {
    if (typeof body !== 'string' || !body.startsWith(prefix)) return null;
    const rest = body.slice(prefix.length);
    if (prefix && /^\s/.test(rest)) return null;
    const command = rest.trim().split(/\s+/)[0]?.toLowerCase();
    return command ? { command, prefix, body } : null;
}

async function isKnownCommand(command) {
    if (!command) return false;
    if (EXTRA_COMMANDS.has(command) || /^(?:aivoice|av)(?:[-_]?(hausa|male|female))?(?:[-_]?(hausa|male|female))?$/.test(command)) return true;
    return v1CommandNames().has(command) || await owns(command);
}

/* Claim synchronously before any await. Shared across reconnects, bounded by
   both age and count, and scoped to the linked account and message ID only:
   WhatsApp can redeliver one message under its phone-number and its LID
   address, so chat/sender addressing must not make a second claim. */
function claimMessage(sock, m, stage = 'dispatch', now = Date.now()) {
    const id = m?.key?.id;
    const chat = m?.key?.remoteJid || m?.chat;
    if (!id || !chat) return false;
    const account = String(sock?.user?.id || '').replace(/:\d+@/, '@');
    const key = JSON.stringify([stage, account, id]);
    for (const [entry, timestamp] of claimedMessages) {
        if (now - timestamp < 24 * 60 * 60 * 1000) break;
        claimedMessages.delete(entry);
    }
    if (claimedMessages.has(key)) return false;
    claimedMessages.set(key, now);
    while (claimedMessages.size > 10000) claimedMessages.delete(claimedMessages.keys().next().value);
    return true;
}

/* Inner option switches (welcome here/all/disable, opentime units...) are
   not commands; only cases of the main command switch count. */
function stripInnerSwitches(source) {
    const pattern = /switch\s*\(\s*([^)]*?)\s*\)\s*\{/g;
    let out = '';
    let cursor = 0;
    let match;
    while ((match = pattern.exec(source))) {
        if (match[1] === 'command') continue;
        let depth = 1;
        let index = pattern.lastIndex;
        while (index < source.length && depth) {
            if (source[index] === '{') depth++;
            else if (source[index] === '}') depth--;
            index++;
        }
        out += source.slice(cursor, match.index);
        cursor = index;
        pattern.lastIndex = index;
    }
    return out + source.slice(cursor);
}

let commandNameCache = null;
function v1CommandNames() {
    const fs = require('fs');
    const files = ['ElitePro.js', 'lib/v1/commands.js'].map(file => path.join(__dirname, '..', '..', file));
    const stamp = files.map(file => { try { return fs.statSync(file).mtimeMs; } catch { return 0; } }).join('|');
    if (commandNameCache?.stamp === stamp) return new Set(commandNameCache.names);
    const names = new Set();
    const disabled = new Set();
    for (const file of files) {
        let source = '';
        try { source = stripInnerSwitches(fs.readFileSync(file, 'utf8')); } catch { continue; }
        for (const match of source.matchAll(/(?:case\s*|command\s*===\s*)['"]([a-z0-9_-]+)['"]/gi)) names.add(match[1].toLowerCase());
        // Commands the loader renames away (e.g. panel) no longer exist.
        for (const match of source.matchAll(/split\(\s*["']case '([a-z0-9_-]+)': \{["']\)\.join\(\s*["']case '__/gi)) disabled.add(match[1].toLowerCase());
    }
    for (const name of [...names]) if (name.startsWith('__') || disabled.has(name)) names.delete(name);
    commandNameCache = { stamp, names: [...names] };
    return names;
}

/* A second bot linked to the same WhatsApp number answers and reacts to the
   same commands; this process cannot stop it, so detect and warn the owner. */
const prefixedMessages = new Map();
const sentBySelf = new Map();
const trackedSockets = new WeakSet();
let otherBotWarnedAt = 0;

function remember(map, id, now) {
    if (!id) return;
    map.set(id, now);
    for (const [entry, timestamp] of map) {
        if (now - timestamp < 5 * 60 * 1000) break;
        map.delete(entry);
    }
    while (map.size > 2000) map.delete(map.keys().next().value);
}

function trackOwnSends(sock) {
    if (!sock || typeof sock.sendMessage !== 'function' || trackedSockets.has(sock)) return;
    trackedSockets.add(sock);
    const send = sock.sendMessage.bind(sock);
    sock.sendMessage = async (...args) => {
        const result = await send(...args);
        remember(sentBySelf, result?.key?.id, Date.now());
        return result;
    };
}

function answeredMessageId(mek) {
    const msg = mek?.message || {};
    if (msg.reactionMessage?.key?.id) return msg.reactionMessage.key.id;
    for (const node of Object.values(msg)) {
        const id = node?.contextInfo?.stanzaId;
        if (id) return id;
    }
    return null;
}

async function watchForOtherBot(sock, mek, now = Date.now()) {
    trackOwnSends(sock);
    const id = mek?.key?.id;
    if (!id) return false;
    if (!mek.key.fromMe || !sentBySelf.has(id)) {
        if (parseCommand(messageText(mek).trim())) remember(prefixedMessages, id, now);
    }
    if (!mek.key.fromMe || sentBySelf.has(id)) return false;
    const target = answeredMessageId(mek);
    if (!target || !prefixedMessages.has(target)) return false;
    if (otherBotWarnedAt && now - otherBotWarnedAt < 6 * 60 * 60 * 1000) return true;
    otherBotWarnedAt = now;
    const warning = '⚠️ Another bot linked to this WhatsApp number is also answering commands, ' +
        'which causes double replies and reactions to unknown commands. Open WhatsApp → Linked devices ' +
        'and log out every old bot device except this one.';
    // Owner asked not to receive this in WhatsApp; keep it in the host log only.
    console.log('[DUPLICATE BOT] ' + warning);
    return true;
}

function loadBridge() {
    if (!bridgePromise) {
        bridgePromise = import(pathToFileURL(BRIDGE_PATH).href)
            .then((mod) => { bridge = mod; return mod; })
            .catch((err) => {
                console.error('[V2] bridge failed to load:', err?.message || err);
                bridgePromise = null;
                return null;
            });
    }
    return bridgePromise;
}

/* Warm the plugin engine up as soon as the socket is available. */
async function init(EliteProTech) {
    const mod = await loadBridge();
    if (!mod) return false;
    try {
        await mod.init(EliteProTech);
        return true;
    } catch (err) {
        console.error('[V2] init failed:', err?.message || err);
        return false;
    }
}

async function handleCommands(EliteProTech, m, { command }) {
    const mod = await loadBridge();
    if (!mod) return false;
    await mod.init(EliteProTech);
    if (!mod.owns(command)) return false;
    return await mod.handle(EliteProTech, m, { command });
}

/* True when the command is a unique V2 plugin command (not a V1 spelling). */
async function owns(command) {
    const mod = await loadBridge();
    if (!mod) return false;
    try { return mod.owns(command); } catch { return false; }
}

/* V2 keeps the owner shell on its own "$" prefix. */
async function handleShell(EliteProTech, m) {
    const mod = await loadBridge();
    if (!mod) return false;
    await mod.init(EliteProTech);
    return await mod.handle(EliteProTech, m, { command: '', isCustomPrefix: true });
}

/* Read every V2 plugin's declared commands straight off disk, grouped by the
   plugin folder, so the menu lists all V2 sections even before the plugin
   engine has finished loading. */
const PLUGIN_DIR = path.join(__dirname, '..', '..', 'v2', 'plugins');

function scanPluginGroups() {
    const fs = require('fs');
    const groups = {};
    const v1 = v1CommandNames();

    const walk = (dir, category) => {
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                const name = entry.name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                walk(full, category || name);
                continue;
            }
            if (!entry.name.endsWith('.js')) continue;
            let src = '';
            try { src = fs.readFileSync(full, 'utf-8'); } catch { continue; }

            const names = [];
            for (const match of src.matchAll(/handler\.command\s*=\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/g)) {
                for (const cmd of match[1].matchAll(/['"]([^'"]+)['"]/g)) {
                    if (!v1.has(cmd[1].toLowerCase())) names.push(cmd[1].toLowerCase());
                }
            }
            // Menu-only commands still execute in V1; listing is not ownership.
            for (const match of src.matchAll(/handler\.menuCommands\s*=\s*\[([^\]]*)\]/g)) {
                for (const cmd of match[1].matchAll(/['"]([^'"]+)['"]/g)) names.push(cmd[1].toLowerCase());
            }
            if (/handler\.customPrefix/.test(src)) names.push('Shell ($cmd)');
            if (!names.length) continue;

            const declaredCategory = src.match(/handler\.menuCategory\s*=\s*['"]([^'"]+)['"]/);
            const key = declaredCategory?.[1] || category || 'Other';
            groups[key] = groups[key] || [];
            groups[key].push(...names);
        }
    };

    walk(PLUGIN_DIR, '');

    const out = {};
    for (const key of Object.keys(groups).sort()) {
        const unique = [...new Set(groups[key])].sort();
        out[key] = unique.map(n => n.charAt(0).toUpperCase() + n.slice(1));
    }
    return out;
}

function menuGroups() {
    const groups = scanPluginGroups();
    if (Object.keys(groups).length) return groups;
    return { Commands: menuCommands() };
}

function menuCommands() {
    let names = [];
    try {
        if (bridge) names = bridge.commandNames();
    } catch {}
    if (!names.length) names = FALLBACK_COMMANDS.slice();

    const seen = new Set();
    const list = [];
    for (const name of names.sort()) {
        const key = String(name).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        list.push(key.charAt(0).toUpperCase() + key.slice(1));
    }
    list.push('Shell ($cmd)');
    return list;
}

module.exports = {
    messageText,
    parseCommand,
    isKnownCommand,
    claimMessage,
    watchForOtherBot,
    v1CommandNames,
    owns,
    init,
    menuGroups,
    handleCommands,
    handleShell,
    menuCommands,
    get MENU_COMMANDS() { return menuCommands(); },
    get MENU_GROUPS() { return menuGroups(); }
};
