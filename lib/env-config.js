const path = require('path');
const fs = require('fs');

// Resolve from the repository, not the hosting panel's working directory.
// Panel environment values take precedence over .env.
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

function envText(env, ...names) {
    for (const name of names) {
        const value = String(env[name] || '').trim();
        if (value) return value;
    }
    return '';
}

function envNumber(env, name, fallback, min, max) {
    const raw = envText(env, name);
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

// V1 and the bridged V2 engine use one durable settings store. Aliases share
// descriptors so either command spelling updates the exact same state.
function configureBotSettings(target = global, settingsPath = path.join(__dirname, 'database', 'settings.json')) {
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch {}
    const aliases = {
        prefix: ['prefix'],
        autoViewStatus: ['autoviewstatus', 'autoViewStatus'],
        autoLikeStatus: ['autolikestatus', 'autoLikeStatus'],
        autoRead: ['autoread', 'autoRead'],
        autoTyping: ['autoTyping'],
        autoRecording: ['autoRecording'],
        autoRecordType: ['autorecordtype', 'autoRecordType']
    };
    for (const [key, names] of Object.entries(aliases)) {
        const valid = value => key === 'prefix' ? typeof value === 'string' : typeof value === 'boolean';
        let value = valid(saved[key]) ? saved[key] : target[names[0]];
        if (!valid(value)) value = key === 'prefix' ? '.' : false;
        for (const name of new Set(names)) {
            Object.defineProperty(target, name, {
                configurable: true,
                enumerable: true,
                get: () => value,
                set: next => {
                    if (!valid(next)) return;
                    let current = {};
                    try { current = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch {}
                    fs.writeFileSync(settingsPath, JSON.stringify({ ...current, [key]: next }, null, 2));
                    value = next;
                }
            });
        }
    }
}

module.exports = { envText, envNumber, configureBotSettings };