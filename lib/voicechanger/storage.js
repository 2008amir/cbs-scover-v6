/**
 * Persistent storage for target voices and per chat/user voice-changer state.
 * Uses the same plain-JSON + database/ folder approach as the rest of the bot.
 */

const fs = require('fs');
const path = require('path');
const { VOICES_DIR, STATE_FILE } = require('./config');

function slug(name) {
    return String(name || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return fallback;
    }
}

function writeJson(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

/* ----------------------------- voices ----------------------------- */

function voiceDir(name) {
    return path.join(VOICES_DIR, slug(name));
}

function getVoice(name) {
    const id = slug(name);
    if (!id) return null;
    const dir = path.join(VOICES_DIR, id);
    const ref = path.join(dir, 'reference.wav');
    if (!fs.existsSync(ref)) return null;
    const meta = readJson(path.join(dir, 'metadata.json'), {});
    return {
        id,
        name: meta.name || id,
        reference: ref,
        metadata: meta
    };
}

function listVoices() {
    try {
        return fs.readdirSync(VOICES_DIR, { withFileTypes: true })
            .filter(e => e.isDirectory())
            .map(e => getVoice(e.name))
            .filter(Boolean)
            .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
        return [];
    }
}

function saveVoice(name, wavBuffer, extra = {}) {
    const id = slug(name);
    if (!id) throw new Error('invalid voice name');
    const dir = path.join(VOICES_DIR, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'reference.wav'), wavBuffer);
    const meta = {
        name: String(name).trim(),
        id,
        createdAt: new Date().toISOString(),
        ...extra
    };
    writeJson(path.join(dir, 'metadata.json'), meta);
    return { id, name: meta.name, reference: path.join(dir, 'reference.wav'), metadata: meta };
}

function deleteVoice(name) {
    const voice = getVoice(name);
    if (!voice) return false;
    fs.rmSync(path.join(VOICES_DIR, voice.id), { recursive: true, force: true });
    // Drop it from any state that pointed at it.
    const state = readState();
    let dirty = false;
    for (const [key, value] of Object.entries(state)) {
        if (slug(value?.targetVoice) === voice.id) {
            state[key] = { enabled: false, targetVoice: null };
            dirty = true;
        }
    }
    if (dirty) writeJson(STATE_FILE, state);
    return true;
}

function renameVoice(oldName, newName) {
    const voice = getVoice(oldName);
    if (!voice) return { ok: false, reason: 'missing' };
    const newId = slug(newName);
    if (!newId) return { ok: false, reason: 'invalid' };
    if (newId !== voice.id && getVoice(newId)) return { ok: false, reason: 'exists' };

    const from = path.join(VOICES_DIR, voice.id);
    const to = path.join(VOICES_DIR, newId);
    if (newId !== voice.id) fs.renameSync(from, to);
    const meta = { ...voice.metadata, name: String(newName).trim(), id: newId, renamedAt: new Date().toISOString() };
    writeJson(path.join(to, 'metadata.json'), meta);

    // Point any active state at the new name (no reconversion needed).
    const state = readState();
    let dirty = false;
    for (const [key, value] of Object.entries(state)) {
        if (slug(value?.targetVoice) === voice.id) {
            state[key] = { ...value, targetVoice: meta.name };
            dirty = true;
        }
    }
    if (dirty) writeJson(STATE_FILE, state);

    return { ok: true, oldName: voice.name, newName: meta.name };
}

/* ------------------------------ state ------------------------------ */

function readState() {
    return readJson(STATE_FILE, {});
}

/** State is per chat + per sender so one user never switches another user's voice. */
function stateKey(m) {
    const chat = String(m?.chat || '');
    const sender = String(m?.sender || chat).split(':')[0];
    return `${chat}|${sender}`;
}

function getState(m) {
    const state = readState();
    return state[stateKey(m)] || { enabled: false, targetVoice: null };
}

function setState(m, value) {
    const state = readState();
    state[stateKey(m)] = value;
    writeJson(STATE_FILE, state);
    return value;
}

function countActive() {
    return Object.values(readState()).filter(v => v?.enabled && v?.targetVoice).length;
}

module.exports = {
    slug,
    getVoice,
    listVoices,
    saveVoice,
    deleteVoice,
    renameVoice,
    voiceDir,
    getState,
    setState,
    readState,
    countActive
};
