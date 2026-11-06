// Shared owner registry. Read fresh on every check so .addowner/.delowner
// take effect immediately (no restart). LID addresses of owners are learned
// and remembered so owners are recognised in groups and private mode too.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILES = [path.join(ROOT, 'database', 'owner.json'), path.join(ROOT, 'lib', 'database', 'owner.json')];
const LID_FILE = path.join(ROOT, 'database', 'owner-lids.json');

const digits = v => String(v || '').split('@')[0].split(':')[0].replace(/\D/g, '');

function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function list() {
    const out = [];
    for (const file of FILES) {
        const data = readJson(file, []);
        if (Array.isArray(data)) out.push(...data.map(digits));
    }
    return [...new Set(out.filter(Boolean))];
}

function write(numbers) {
    const clean = [...new Set(numbers.map(digits).filter(Boolean))];
    for (const file of FILES) {
        try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(clean, null, 2)); } catch {}
    }
    return clean;
}

function lidMap() { const m = readJson(LID_FILE, {}); return m && typeof m === 'object' ? m : {}; }
function saveLid(lid, pn) {
    const map = lidMap();
    if (map[lid] === pn) return;
    map[lid] = pn;
    const keys = Object.keys(map);
    while (keys.length > 200) delete map[keys.shift()];
    try { fs.writeFileSync(LID_FILE, JSON.stringify(map, null, 2)); } catch {}
}

function mainOwner() { return digits(global.ownernumber); }

function isOwnerSync(sock, jid) {
    let num = digits(jid);
    if (!num) return false;
    if (String(jid).includes('@lid')) num = lidMap()[num] || num;
    const self = [digits(sock?.user?.id), digits(sock?.user?.lid)];
    return num === mainOwner() || self.includes(num) || list().includes(num);
}

// Resolves a LID sender to its phone number and remembers it.
async function resolve(sock, jid) {
    const raw = String(jid || '');
    if (!raw.includes('@lid')) return raw;
    const lid = digits(raw);
    const known = lidMap()[lid];
    if (known) return `${known}@s.whatsapp.net`;
    try {
        const pn = await sock?.signalRepository?.lidMapping?.getPNForLID?.(raw.replace(/:\d+@/, '@'));
        const n = digits(pn);
        if (n) { if (n === mainOwner() || list().includes(n)) saveLid(lid, n); return `${n}@s.whatsapp.net`; }
    } catch {}
    return raw;
}

async function isOwner(sock, jid, fromMe) {
    if (fromMe) return true;
    if (isOwnerSync(sock, jid)) return true;
    return isOwnerSync(sock, await resolve(sock, jid));
}

async function add(sock, number) {
    const n = digits(number);
    if (!n) return false;
    write([...list(), n]);
    try {
        const lid = await sock?.signalRepository?.lidMapping?.getLIDForPN?.(`${n}@s.whatsapp.net`);
        if (digits(lid)) saveLid(digits(lid), n);
    } catch {}
    return true;
}

function remove(number) {
    const n = digits(number);
    const before = list();
    write(before.filter(x => x !== n));
    const map = lidMap();
    for (const [k, v] of Object.entries(map)) if (v === n) delete map[k];
    try { fs.writeFileSync(LID_FILE, JSON.stringify(map, null, 2)); } catch {}
    return before.includes(n);
}

module.exports = { digits, list, add, remove, isOwner, isOwnerSync, resolve, mainOwner };
