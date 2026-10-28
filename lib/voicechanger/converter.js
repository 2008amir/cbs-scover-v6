/**
 * Full pipeline: WhatsApp voice note -> wav -> Seed-VC (with saved reference)
 * -> wav -> Opus PTT buffer. Long voice notes are chunked at pauses because
 * one ZeroGPU request cannot run for minutes.
 */

const fs = require('fs');
const audio = require('./audio');
const seedvc = require('./seedvc');
const { CHUNK_SECONDS, SOURCE_MAX_SECONDS } = require('./config');

class VoiceChangerError extends Error {
    constructor(code, message) {
        super(message || code);
        this.code = code;
    }
}

/**
 * @param {Buffer} sourceBuffer raw WhatsApp audio (ogg/opus, m4a, mp3...)
 * @param {string} referencePath path to the saved reference wav
 * @param {string} ext source extension hint
 * @returns {Promise<{ptt: Buffer, wav: Buffer, seconds: number, chunks: number}>}
 */
async function convertVoiceNote(sourceBuffer, referencePath, ext = 'ogg') {
    let sourceWav;
    try {
        sourceWav = await audio.toWav(sourceBuffer, ext);
    } catch (err) {
        throw new VoiceChangerError('BAD_AUDIO', err.message);
    }

    let seconds;
    try {
        seconds = audio.wavDuration(sourceWav);
    } catch (err) {
        throw new VoiceChangerError('BAD_AUDIO', err.message);
    }
    if (!seconds || seconds < 0.4) throw new VoiceChangerError('BAD_AUDIO', 'source too short');
    if (audio.wavLoudness(sourceWav) < 0.004) throw new VoiceChangerError('BAD_AUDIO', 'source is silent');
    if (seconds > SOURCE_MAX_SECONDS) throw new VoiceChangerError('TOO_LONG', `source is ${Math.round(seconds)}s`);

    // Apply the same selection to existing voices without changing saved files.
    const prepared = audio.prepareReference(fs.readFileSync(referencePath));
    if (prepared.speechSeconds < 10) throw new VoiceChangerError('BAD_REFERENCE', `Saved reference has only ${prepared.speechSeconds.toFixed(1)} seconds of audible speech. Save it again with addvoice using 10–20 seconds of clean speech.`);
    const referenceWav = prepared.wav;

    const chunks = seconds > CHUNK_SECONDS ? audio.chunkWav(sourceWav, CHUNK_SECONDS) : [sourceWav];
    const converted = [];
    for (const chunk of chunks) {
        converted.push(await seedvc.convert(chunk, referenceWav));
    }

    const wav = converted.length === 1 ? converted[0] : audio.concatWav(converted);
    let ptt;
    try {
        ptt = await audio.toVoiceNote(wav);
    } catch (err) {
        throw new VoiceChangerError('ENCODE_FAILED', err.message);
    }

    return { ptt, wav, seconds, chunks: chunks.length };
}

module.exports = { convertVoiceNote, VoiceChangerError };
