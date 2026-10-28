/**
 * Audio helpers for the voice changer.
 *
 * WhatsApp voice notes arrive as OGG/Opus, Seed-VC wants PCM wav, and the
 * reply has to go back out as Opus PTT. FFmpeg comes from the bundled
 * @ffmpeg-installer binary already used by lib/converter.js.
 */

const { ffmpeg, toPTT } = require('../converter');
const { SAMPLE_RATE } = require('./config');

/** Convert any audio buffer into mono PCM wav at the Seed-VC sample rate. */
async function toWav(buffer, ext = 'ogg', sampleRate = SAMPLE_RATE) {
    return ffmpeg(buffer, [
        '-vn',
        '-ac', '1',
        '-ar', String(sampleRate),
        '-c:a', 'pcm_s16le',
        '-f', 'wav'
    ], ext || 'ogg', 'wav');
}

/** Convert a wav buffer into a WhatsApp compatible Opus voice note. */
async function toVoiceNote(wavBuffer) {
    return toPTT(wavBuffer, 'wav');
}

/* ------------------------- raw wav utilities ------------------------- */

function parseWav(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') {
        throw new Error('not a wav buffer');
    }
    let offset = 12;
    let fmt = null;
    let data = null;
    while (offset + 8 <= buffer.length) {
        const id = buffer.toString('ascii', offset, offset + 4);
        const size = buffer.readUInt32LE(offset + 4);
        const body = offset + 8;
        if (id === 'fmt ') {
            fmt = {
                channels: buffer.readUInt16LE(body + 2),
                sampleRate: buffer.readUInt32LE(body + 4),
                bitsPerSample: buffer.readUInt16LE(body + 14)
            };
        } else if (id === 'data') {
            data = buffer.subarray(body, Math.min(body + size, buffer.length));
            break;
        }
        offset = body + size + (size % 2);
    }
    if (!fmt || !data) throw new Error('invalid wav layout');
    return { ...fmt, data };
}

function buildWav({ channels, sampleRate, bitsPerSample, data }) {
    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const header = Buffer.alloc(44);
    header.write('RIFF', 0, 'ascii');
    header.writeUInt32LE(36 + data.length, 4);
    header.write('WAVE', 8, 'ascii');
    header.write('fmt ', 12, 'ascii');
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(channels * (bitsPerSample / 8), 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36, 'ascii');
    header.writeUInt32LE(data.length, 40);
    return Buffer.concat([header, data]);
}

/** Duration of a wav buffer in seconds. */
function wavDuration(buffer) {
    const w = parseWav(buffer);
    return w.data.length / (w.sampleRate * w.channels * (w.bitsPerSample / 8));
}

/** Average loudness (0..1) — used to reject silent/empty recordings. */
function wavLoudness(buffer) {
    const w = parseWav(buffer);
    if (w.bitsPerSample !== 16 || !w.data.length) return 0;
    let sum = 0;
    let count = 0;
    for (let i = 0; i + 1 < w.data.length; i += 2 * 8) { // sample every 8th frame
        const v = w.data.readInt16LE(i) / 32768;
        sum += v * v;
        count++;
    }
    return count ? Math.sqrt(sum / count) : 0;
}

/** Cut a wav buffer to [start, start+length] seconds without re-encoding. */
function sliceWav(buffer, startSeconds, lengthSeconds) {
    const w = parseWav(buffer);
    const frame = w.channels * (w.bitsPerSample / 8);
    const bytesPerSecond = w.sampleRate * frame;
    let from = Math.max(0, Math.floor(startSeconds * bytesPerSecond / frame) * frame);
    let to = lengthSeconds == null
        ? w.data.length
        : Math.min(w.data.length, from + Math.floor(lengthSeconds * bytesPerSecond / frame) * frame);
    return buildWav({ ...w, data: w.data.subarray(from, to) });
}

/** Split a wav buffer into chunks of at most `seconds`, cutting at the quietest point. */
function chunkWav(buffer, seconds) {
    const w = parseWav(buffer);
    const frame = w.channels * (w.bitsPerSample / 8);
    const bytesPerSecond = w.sampleRate * frame;
    const target = Math.floor(seconds * bytesPerSecond / frame) * frame;
    if (w.data.length <= target) return [buffer];

    const chunks = [];
    let cursor = 0;
    while (cursor < w.data.length) {
        let end = Math.min(w.data.length, cursor + target);
        if (end < w.data.length && w.bitsPerSample === 16) {
            // Look for the quietest 20 ms window in the last 5 s so we cut in a
            // pause instead of the middle of a word.
            const windowBytes = Math.floor(0.02 * bytesPerSecond / frame) * frame;
            const searchStart = Math.max(cursor + Math.floor(target / 2), end - Math.floor(5 * bytesPerSecond / frame) * frame);
            let best = end;
            let bestEnergy = Infinity;
            for (let p = searchStart; p + windowBytes <= end; p += windowBytes) {
                let energy = 0;
                for (let i = p; i + 1 < p + windowBytes; i += 2) energy += Math.abs(w.data.readInt16LE(i));
                if (energy < bestEnergy) {
                    bestEnergy = energy;
                    best = p + windowBytes;
                }
            }
            end = best;
        }
        chunks.push(buildWav({ ...w, data: w.data.subarray(cursor, end) }));
        cursor = end;
    }
    return chunks;
}

/** Join wav buffers that share the same format. */
function concatWav(buffers) {
    const parsed = buffers.map(parseWav);
    const first = parsed[0];
    return buildWav({ ...first, data: Buffer.concat(parsed.map(p => p.data)) });
}

/** Trim quiet edges and choose the most speech-rich bounded reference window.
 * No denoising/pitch processing: retain the speaker's actual vocal timbre. */
function prepareReference(buffer, maxSeconds = 20) {
    const w = parseWav(buffer);
    if (w.bitsPerSample !== 16 || w.channels !== 1) throw new Error('Reference must be mono 16-bit PCM WAV.');
    const samples = Math.floor(w.data.length / 2);
    const step = Math.max(1, Math.round(w.sampleRate * 0.1));
    const levels = [];
    for (let start = 0; start < samples; start += step) {
        let sum = 0, count = 0;
        for (let i = start; i < Math.min(samples, start + step); i += 8) { const v = w.data.readInt16LE(i * 2) / 32768; sum += v * v; count++; }
        levels.push(count ? Math.sqrt(sum / count) : 0);
    }
    const threshold = Math.max(0.004, Math.max(...levels) * 0.08);
    const first = levels.findIndex(value => value >= threshold);
    if (first < 0) throw new Error('Reference recording is silent or too quiet.');
    let last = levels.length - 1;
    while (last > first && levels[last] < threshold) last--;
    const window = Math.max(1, Math.round(maxSeconds * 10));
    let bestStart = first, bestScore = -1;
    for (let start = first; start <= Math.max(first, last - window + 1); start++) {
        const score = levels.slice(start, Math.min(last + 1, start + window)).filter(value => value >= threshold).length;
        if (score > bestScore) { bestScore = score; bestStart = start; }
    }
    const end = Math.min(last + 1, bestStart + window);
    const speechSeconds = levels.slice(bestStart, end).filter(value => value >= threshold).length / 10;
    return { wav: sliceWav(buffer, bestStart / 10, (end - bestStart) / 10), speechSeconds };
}

module.exports = {
    toWav,
    toVoiceNote,
    wavDuration,
    wavLoudness,
    sliceWav,
    chunkWav,
    concatWav,
    parseWav,
    buildWav,
    prepareReference
};
