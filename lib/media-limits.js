// Bounded media buffering for small hosts (about 250 MB RAM). Collecting chunks
// once avoids the quadratic copies of repeated Buffer.concat, and the size cap
// refuses files that would push the process past the host's memory limit.
const MAX_MEDIA_BYTES = (Number(process.env.MAX_MEDIA_MB) || 25) * 1024 * 1024;
let mediaBusy = false;

function acquireMediaJob() {
    if (mediaBusy) throw Object.assign(new Error('A media command is already running. Please try again shortly.'), { code: 'MEDIA_BUSY' });
    mediaBusy = true;
    let released = false;
    return () => { if (!released) { released = true; mediaBusy = false; } };
}

class MediaTooLargeError extends Error {
    constructor(bytes, max = MAX_MEDIA_BYTES) {
        super(`This file is too large for the server (${Math.ceil(bytes / 1048576)} MB). The limit is ${Math.round(max / 1048576)} MB.`);
        this.code = 'MEDIA_TOO_LARGE';
    }
}

function declaredSize(message) {
    const raw = (message?.msg || message)?.fileLength;
    const n = typeof raw === 'object' ? (raw?.toNumber?.() ?? raw?.low ?? 0) : Number(raw || 0);
    return Number.isFinite(n) ? n : 0;
}

function assertMediaSize(message, max = MAX_MEDIA_BYTES) {
    const size = declaredSize(message);
    if (size > max) throw new MediaTooLargeError(size, max);
}

async function collectStream(stream, max = MAX_MEDIA_BYTES) {
    const chunks = [];
    let total = 0;
    for await (const chunk of stream) {
        total += chunk.length;
        if (total > max) {
            try { stream.destroy?.(); } catch {}
            throw new MediaTooLargeError(total, max);
        }
        chunks.push(chunk);
    }
    return Buffer.concat(chunks, total);
}

module.exports = { MAX_MEDIA_BYTES, MediaTooLargeError, declaredSize, assertMediaSize, collectStream, acquireMediaJob };
