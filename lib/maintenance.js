/* Hard count caps for every long-lived memory structure.
   The host kills the process when RSS grows past its plan limit (long uptimes
   and redeploy-startup spikes died this way), so nothing the bot keeps in
   memory is allowed to grow without a bound. Bounding is silent — no console
   output, no clearing of live state — and only counts entries, never timing. */
'use strict';

const CHAT_ARCHIVE_MAX_CHATS = Number(process.env.CHAT_ARCHIVE_MAX_CHATS) || 150;
const LEARN_MAX_PEOPLE = Number(process.env.LEARN_MAX_PEOPLE) || 1500;
const CHAT_SET_MAX_CHATS = 300;

// Object key order is insertion order, so the oldest entries sit first and are
// the ones dropped.
function boundObjectKeys(obj, max) {
    if (!obj || typeof obj !== 'object') return 0;
    const keys = Object.keys(obj);
    const overflow = keys.length - max;
    if (overflow <= 0) return 0;
    for (const key of keys.slice(0, overflow)) delete obj[key];
    return overflow;
}

// Chat archive: every chat is already capped at 400 lines; this caps how many
// chats are kept at all.
function boundChatArchive(archive, maxChats = CHAT_ARCHIVE_MAX_CHATS) {
    return boundObjectKeys(archive, maxChats);
}

// Style + facts learned per person.
function boundLearning(style, facts, maxPeople = LEARN_MAX_PEOPLE) {
    return boundObjectKeys(style || {}, maxPeople) + boundObjectKeys(facts || {}, maxPeople);
}

// The full chat list WhatsApp sends at connect.
function boundChatSet(chats, max = CHAT_SET_MAX_CHATS) {
    if (!chats || typeof chats !== 'object') return chats || {};
    const keys = Object.keys(chats);
    if (keys.length <= max) return chats;
    const bounded = {};
    for (const key of keys.slice(keys.length - max)) bounded[key] = chats[key];
    return bounded;
}

// Every recovery copy gets a full 24-hour window, including group messages.
const ANTIDELETE_TTL_PRIVATE = 24 * 60 * 60 * 1000;
const ANTIDELETE_TTL_GROUP = ANTIDELETE_TTL_PRIVATE;
function antideleteTtl(jid) {
    return String(jid || '').endsWith('@g.us') ? ANTIDELETE_TTL_GROUP : ANTIDELETE_TTL_PRIVATE;
}

// Log only numerical resource data, never environment values or provider errors.
function resourceSummary({ usage = process.memoryUsage(), heapLimit = require('v8').getHeapStatistics().heap_size_limit,
    read = file => require('fs').readFileSync(file, 'utf8') } = {}) {
    const mb = bytes => Math.round(bytes / 1024 / 1024);
    let containerLimit = null;
    for (const file of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) {
        try {
            const value = Number(String(read(file)).trim());
            if (Number.isFinite(value) && value > 0 && value < Number.MAX_SAFE_INTEGER) {
                containerLimit = value;
                break;
            }
        } catch {}
    }
    return `rss=${mb(usage.rss)}MB heap=${mb(usage.heapUsed)}/${mb(heapLimit)}MB buffers=${mb(usage.arrayBuffers || 0)}MB container=${containerLimit === null ? 'unknown' : mb(containerLimit) + 'MB'}`;
}

// Disk budget: V2 resolves packages from the root node_modules, so a nested
// v2/node_modules and an npm download cache inside the server folder are pure
// duplicates. Never touches credentials, sessions, voices or databases.
function trimStartupStorage(root, { fsImpl = require('fs'), pathImpl = require('path') } = {}) {
    const removed = [];
    const rootPackages = pathImpl.join(root, 'node_modules', '@whiskeysockets', 'baileys');
    const targets = [];
    if (fsImpl.existsSync(rootPackages)) targets.push(pathImpl.join(root, 'v2', 'node_modules'));
    targets.push(pathImpl.join(root, '.npm'), pathImpl.join(root, '.cache', 'npm'));
    for (const target of targets) {
        try {
            if (!fsImpl.existsSync(target)) continue;
            fsImpl.rmSync(target, { recursive: true, force: true });
            removed.push(target);
        } catch {}
    }
    return removed;
}

/* A host that kills `npm install` midway (memory limit) leaves packages with
   missing files, and later installs trust them. When startup fails on a file
   missing inside node_modules, delete that one package plus npm's hidden
   lockfile so the next start's npm install reinstalls it. */
function repairBrokenPackage(err, root, { fsImpl = require('fs'), pathImpl = require('path') } = {}) {
    if (!err || err.code !== 'MODULE_NOT_FOUND') return null;
    const modules = pathImpl.join(root, 'node_modules');
    const from = Array.isArray(err.requireStack) ? String(err.requireStack[0] || '') : '';
    let removed = null;
    const marker = pathImpl.sep + 'node_modules' + pathImpl.sep;
    const at = from.lastIndexOf(marker);
    if (from.startsWith(modules + pathImpl.sep) && at !== -1) {
        const parts = from.slice(at + marker.length).split(pathImpl.sep);
        const name = parts[0].startsWith('@') ? parts.slice(0, 2).join(pathImpl.sep) : parts[0];
        const dir = from.slice(0, at + marker.length) + name;
        if (name && dir.startsWith(modules + pathImpl.sep)) {
            try { fsImpl.rmSync(dir, { recursive: true, force: true }); removed = dir; } catch {}
        }
    }
    try { fsImpl.rmSync(pathImpl.join(modules, '.package-lock.json'), { force: true }); } catch {}
    return removed;
}

module.exports = {
    repairBrokenPackage,
    trimStartupStorage,
    CHAT_ARCHIVE_MAX_CHATS,
    LEARN_MAX_PEOPLE,
    CHAT_SET_MAX_CHATS,
    ANTIDELETE_TTL_PRIVATE,
    ANTIDELETE_TTL_GROUP,
    boundObjectKeys,
    boundChatArchive,
    boundLearning,
    boundChatSet,
    antideleteTtl,
    resourceSummary
};
