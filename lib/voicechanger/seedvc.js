/**
 * Hugging Face Seed-VC client (speech-to-speech, zero-shot voice conversion).
 *
 * The Space API was inspected live before writing this module:
 *   GET https://plachta-seed-vc.hf.space/gradio_api/info
 * Named endpoints: /predict (Seed-VC V2) and /predict_1 (V1, with F0 options).
 * /predict parameters:
 *   source_audio_path, target_audio_path, diffusion_steps, length_adjust,
 *   intelligebility_cfg_rate, similarity_cfg_rate, top_p, temperature,
 *   repetition_penalty, convert_style, anonymization_only
 * Returns: [stream audio (m3u8), full output audio (wav FileData)]
 *
 * No speech-to-text and no TTS is involved: the user's own speech is sent as
 * source audio and only its vocal identity is moved toward the reference.
 */

const axios = require('axios');
const { HF_SPACE, HF_TOKEN, INFERENCE, REQUEST_TIMEOUT_MS } = require('./config');

const ENDPOINT = '/predict';

let clientPromise;
let inFlight = Promise.resolve(); // serialise requests (ZeroGPU quota friendly)

async function getClient() {
    if (!clientPromise) {
        clientPromise = (async () => {
            const { Client } = await import('@gradio/client');
            const options = {};
            if (HF_TOKEN) options.token = HF_TOKEN;
            return Client.connect(HF_SPACE, options);
        })().catch(err => {
            clientPromise = null;
            throw err;
        });
    }
    return clientPromise;
}

function resetClient() {
    clientPromise = null;
}

function withTimeout(promise, ms, label) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(Object.assign(new Error(label), { code: 'VC_TIMEOUT' })), ms);
        })
    ]).finally(() => clearTimeout(timer));
}

function fullOutputUrl(data) {
    const items = Array.isArray(data) ? data : [data];
    // Prefer the non-stream "full output" entry.
    const full = items.find(i => i && i.url && !i.is_stream) || items.find(i => i && i.url);
    return full ? full.url : null;
}

/**
 * Convert one wav chunk.
 * @param {Buffer} sourceWav user's own speech
 * @param {Buffer} referenceWav saved target voice reference
 * @returns {Promise<Buffer>} converted wav
 */
async function convertChunk(sourceWav, referenceWav, overrides = {}) {
    const client = await getClient();
    const payload = {
        source_audio_path: new Blob([sourceWav], { type: 'audio/wav' }),
        target_audio_path: new Blob([referenceWav], { type: 'audio/wav' }),
        ...INFERENCE,
        ...overrides
    };

    const result = await withTimeout(
        client.predict(ENDPOINT, payload),
        REQUEST_TIMEOUT_MS,
        'seed-vc request timed out'
    );

    const url = fullOutputUrl(result?.data);
    if (!url) throw new Error('seed-vc returned no audio');

    const headers = HF_TOKEN ? { Authorization: `Bearer ${HF_TOKEN}` } : {};
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000, headers });
    const buffer = Buffer.from(res.data);
    if (!buffer.length) throw new Error('seed-vc returned empty audio');
    return buffer;
}

/**
 * Queue-safe conversion: only one Space request at a time so a burst of voice
 * notes never fires duplicate/parallel ZeroGPU jobs.
 */
function convert(sourceWav, referenceWav, overrides) {
    const run = inFlight.then(() => convertChunk(sourceWav, referenceWav, overrides));
    inFlight = run.catch(() => {});
    return run.catch(err => {
        // A dropped websocket needs a fresh client next time.
        const status = Number(err?.response?.status || err?.status || err?.statusCode || 0);
        if (status === 401 || status === 403 || /websocket|closed|ECONN|socket|fetch/i.test(String(err?.message))) resetClient();
        throw err;
    });
}

async function spaceStatus() {
    try {
        const { data } = await axios.get(`https://huggingface.co/api/spaces/${HF_SPACE}/runtime`, { timeout: 15000 });
        return data?.stage || 'UNKNOWN';
    } catch {
        return 'UNKNOWN';
    }
}

module.exports = { convert, spaceStatus, resetClient, ENDPOINT, HF_SPACE };
