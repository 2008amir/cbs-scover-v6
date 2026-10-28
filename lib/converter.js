const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('node:crypto');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path; 

function ffmpeg(buffer, args = [], ext = '', ext2 = '') {
  return new Promise(async (resolve, reject) => {
    try {
      const tempDir = path.join(__dirname, '..', 'database', 'temp')
      await fs.promises.mkdir(tempDir, { recursive: true })
      const id = randomUUID();
      const tmp = path.join(tempDir, `${id}-input.${ext}`)
      const out = path.join(tempDir, `${id}-output.${ext2}`)
      
      await fs.promises.writeFile(tmp, buffer)
      let diagnostic = '';
      const child = spawn(ffmpegPath, [
        '-hide_banner', '-loglevel', 'error', '-threads', '1',
        '-y',
        '-i', tmp,
        ...args,
        out
      ]);
      child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-2000); });
      const timer = setTimeout(() => child.kill('SIGKILL'), 180000);
      child.on('error', async err => {
          clearTimeout(timer);
          await fs.promises.unlink(tmp).catch(() => {});
          await fs.promises.unlink(out).catch(() => {});
          reject(err);
        })
        .on('close', async (code) => {
          clearTimeout(timer);
          try {
            await fs.promises.unlink(tmp).catch(() => {});
            if (code !== 0) {
              await fs.promises.unlink(out).catch(() => {});
              return reject(new Error(`FFmpeg exited with code ${code}: ${diagnostic.trim() || 'conversion timed out or was stopped'}`));
            }

            const outputBuffer = await fs.promises.readFile(out);
            await fs.promises.unlink(out).catch(() => {});

            resolve(outputBuffer);
          } catch (e) {
            reject(e);
          }
        });
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Convert Audio to Playable WhatsApp Audio
 * @param {Buffer} buffer Audio Buffer
 * @param {String} ext File Extension 
 */
function toAudio(buffer, ext) {
  return ffmpeg(buffer, [
    '-vn',
    '-ac', '2',
    '-b:a', '128k',
    '-ar', '44100',
    '-f', 'mp3'
  ], ext, 'mp3');
}

/**
 * Convert Audio to Playable WhatsApp PTT
 * @param {Buffer} buffer
 * @param {String} ext
 */
function toPTT(buffer, ext) {
  return ffmpeg(buffer, [
    '-vn',
    '-ac', '1',
    '-ar', '48000',
    '-c:a', 'libopus',
    '-b:a', '96k',
    '-vbr', 'on',
    '-compression_level', '10',
    '-application', 'voip',
    '-f', 'ogg'
  ], ext, 'ogg');
}

/**
 * Convert Audio to Playable WhatsApp Video
 * @param {Buffer} buffer Video Buffer
 * @param {String} ext File Extension 
 */
function toVideo(buffer, ext) {
  return ffmpeg(buffer, [
    '-c:v', 'libx264',
    '-c:a', 'aac',
    '-ab', '128k',
    '-ar', '44100',
    '-crf', '32',
    '-preset', 'slow'
  ], ext, 'mp4');
}

module.exports = {
  toAudio,
  toPTT,
  toVideo,
  ffmpeg,
};
