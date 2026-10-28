const { ffmpeg } = require('./converter');
const { MAX_MEDIA_BYTES, assertMediaSize } = require('./media-limits');

// Voice statuses require real Opus audio, not an arbitrary file relabelled as audio.
async function prepareStatusAudio(buffer) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Quoted audio is empty.');
    assertMediaSize({ fileLength: buffer.length });
    const audio = await ffmpeg(buffer, [
        '-map', '0:a:0', '-vn', '-threads', '1', '-filter_threads', '1',
        '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '48k',
        '-compression_level', '5', '-application', 'voip', '-f', 'ogg',
        '-fs', String(MAX_MEDIA_BYTES)
    ], 'input', 'ogg');
    if (!audio.length || audio.subarray(0, 4).toString() !== 'OggS' ||
        !audio.subarray(0, 256).includes(Buffer.from('OpusHead'))) {
        throw new Error('Unable to create playable status audio.');
    }
    if (audio.length >= MAX_MEDIA_BYTES) throw new Error('Converted status audio exceeds the media limit.');
    return { audio, mimetype: 'audio/ogg; codecs=opus', ptt: true };
}

module.exports = { prepareStatusAudio };