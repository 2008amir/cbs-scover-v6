/* =====================================================================
   LOCAL KEY LOADER
   All API keys now come from the local environment (.env / hosting panel).
   No external key server is involved.
   ===================================================================== */

const { envText } = require('./env-config');
const axios = require('axios');

function chatModels(env = process.env) {
    const configured = envText(env, 'GEMINI_CHAT_MODEL');
    return configured ? [configured] : ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemma-4-31b-it'];
}

function uniq(list) {
    return list
        .map(v => String(v || '').trim())
        .filter((v, i, all) => v && all.indexOf(v) === i);
}

function readEnvKeys(env = process.env) {
    const gemini = uniq([
        envText(env, 'GEMINI_API_KEY', 'GEMINI_KEY_1', 'GOOGLE_API_KEY'),
        env.GEMINI_KEY_2,
        env.GEMINI_KEY_3,
        env.GEMINI_KEY_4,
        env.GEMINI_KEY_5
    ]);
    // Mixed-case names requested by the owner, plus old uppercase aliases.
    // Hyphenated names are supported in .env, but underscores work in shells too.
    const video = uniq(Array.from({ length: 5 }, (_, i) => {
        const suffix = i ? `_${i + 1}` : '';
        return envText(env, `GEMINI_youtube_KEY${suffix}`,
            `GEMINI_youtube_KEY-${i + 1}`, `GEMINI_YOUTUBE_KEY${suffix}`,
            `GEMINI_YOUTUBE_KEY-${i + 1}`, `GEMINI_YOUTUBE_KEY_${i + 1}`, `GEMINI_youtube_KEY_${i + 1}`);
    }));
    const youtube = uniq([env.YOUTUBE_API_KEY]);
    // Dedicated image-generation pool: IMAGE_GEMINI_KEY / IMAGE_GEMINI_KEY_1..5,
    // with underscore, hyphen and short (IMAGE_GEMINI_1..5) aliases.
    const image = uniq(Array.from({ length: 5 }, (_, i) => {
        const suffix = i ? `_${i + 1}` : '';
        return envText(env, `IMAGE_GEMINI_KEY${i ? suffix : ''}`,
            `IMAGE_GEMINI_KEY_${i + 1}`, `IMAGE-GEMINI-KEY${suffix ? `-${i + 1}` : ''}`,
            `IMAGE_GEMINI_${i + 1}`, `IMAGE-GEMINI-${i + 1}`);
    }));
    return {
        geminiKeys: gemini,
        videoGeminiKeys: video,
        videoGeminiKey: video[0] || null,
        imageGeminiKeys: image,
        youtubeKeys: youtube,
        youtubeKey: youtube[0] || null
    };
}

let cache = { at: 0, keys: null };

// Kept async for backwards compatibility with existing call sites.
async function loadKeys(force = false) {
    if (!cache.keys || force) {
        cache = { at: Date.now(), keys: readEnvKeys() };
    }
    return cache.keys;
}

async function geminiKeys() {
    const keys = await loadKeys(true);
    return keys.geminiKeys.slice();
}

async function videoGeminiKey() {
    const keys = await loadKeys(true);
    return keys.videoGeminiKey || null;
}

async function videoGeminiKeys() {
    const keys = await loadKeys(true);
    return keys.videoGeminiKeys.slice();
}

async function youtubeKey() {
    const keys = await loadKeys(true);
    return keys.youtubeKey || null;
}

async function imageGeminiKeys() {
    const keys = await loadKeys(true);
    return keys.imageGeminiKeys.slice();
}

function cachedSnapshot() {
    return cache.keys ? { ...cache.keys, at: cache.at } : null;
}

// Never return provider messages or Axios errors: they can contain credentials.
function geminiFailure(status, data) {
    const detail = JSON.stringify(data?.error || {});
    if (/leaked/i.test(detail)) return 'KEY_LEAKED';
    if (/unrestricted/i.test(detail)) return 'KEY_UNRESTRICTED';
    if (/dormant|key.*blocked|blocked.*key/i.test(detail)) return 'KEY_BLOCKED';
    if (/API_KEY_INVALID|API key not valid|invalid api key/i.test(detail) || status === 401) return 'KEY_INVALID';
    if (/SERVICE_DISABLED|service.*disabled|has not been used/i.test(detail)) return 'API_DISABLED';
    if (/location.*not supported|country|region.*not supported/i.test(detail)) return 'REGION_RESTRICTED';
    if (status === 403) return 'KEY_ACCESS';
    if (status === 429) return 'QUOTA';
    if (status === 404) return 'MODEL_UNAVAILABLE';
    return status === 400 ? 'REQUEST_REJECTED' : 'UNAVAILABLE';
}

const geminiErrors = {
    MISSING_KEY: 'No Gemini key configured in the dedicated environment pool.',
    KEY_INVALID: 'Gemini rejected the key. Create a replacement auth key in Google AI Studio and update the hosting environment; then restart.',
    KEY_LEAKED: 'Google blocked a leaked Gemini key. Replace it with a new auth key in AI Studio, update the hosting environment and restart.',
    KEY_UNRESTRICTED: 'Google rejects unrestricted standard Gemini keys. Restrict the key to the Generative Language API in AI Studio or create a new auth key.',
    KEY_BLOCKED: 'Google blocked this Gemini key. Create a new auth key in AI Studio and update the hosting environment.',
    API_DISABLED: 'Enable the Generative Language API in the Google Cloud project for this key.',
    REGION_RESTRICTED: 'Gemini is unavailable in the server region. Use a deployment in a supported region.',
    KEY_ACCESS: 'Gemini access denied. Check key API/IP restrictions and the linked service account permissions in Google AI Studio.',
    QUOTA: 'Gemini quota is exhausted. Check project billing and quota; extra keys in the same project do not add quota.',
    MODEL_UNAVAILABLE: 'The configured Gemini model is unavailable. Set an available model in the hosting environment.',
    REQUEST_REJECTED: 'Gemini rejected the request format or requested model features.',
    UNAVAILABLE: 'Gemini is unavailable or returned no answer. Try again later.'
};

async function requestGemini(body, { keys, models, http = axios, timeoutMs = 120000 } = {}) {
    if (!keys?.length) throw Object.assign(new Error(geminiErrors.MISSING_KEY), { code: 'MISSING_KEY' });
    const rejected = new Set();
    const deadline = Date.now() + timeoutMs;
    let failure = 'UNAVAILABLE';
    for (const model of models || []) {
        for (const key of keys) {
            if (rejected.has(key)) continue;
            const remaining = deadline - Date.now();
            if (remaining <= 0) break;
            try {
                const response = await http.post(
                    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, body,
                    { timeout: Math.min(45000, remaining), headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, validateStatus: () => true }
                );
                if (response.status >= 200 && response.status < 300) {
                    const text = (response.data?.candidates?.[0]?.content?.parts || []).filter(part => !part.thought).map(part => part.text || '').join('').trim();
                    if (text) return text;
                    failure = 'UNAVAILABLE';
                    continue;
                }
                failure = geminiFailure(response.status, response.data);
            } catch { failure = 'UNAVAILABLE'; }
            if (/^KEY_|^API_DISABLED$/.test(failure)) rejected.add(key);
            if (failure === 'REGION_RESTRICTED') throw Object.assign(new Error(geminiErrors[failure]), { code: failure });
            if (failure === 'MODEL_UNAVAILABLE' || failure === 'REQUEST_REJECTED') break;
        }
    }
    throw Object.assign(new Error(geminiErrors[failure]), { code: failure });
}

module.exports = { chatModels, loadKeys, geminiKeys, imageGeminiKeys, videoGeminiKey, videoGeminiKeys, youtubeKey, cachedSnapshot, readEnvKeys, geminiFailure, geminiErrors, requestGemini };
