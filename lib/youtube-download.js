const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const FileType = require('file-type');
const { MAX_MEDIA_BYTES, assertMediaSize, acquireMediaJob } = require('./media-limits');

const LIMITS = { mp3: MAX_MEDIA_BYTES, mp4: MAX_MEDIA_BYTES };
const DETAILS_TARGET_MS = 3000;
const SEARCH_TIMEOUT_MS = 2600;
const PLAY_TARGET_MS = 10000;
const AUDIO_HEDGE_MS = 800;

function youtubeUrl(value) {
    try {
        const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
        const host = url.hostname.toLowerCase();
        const id = host === 'youtu.be' ? url.pathname.slice(1) :
            ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)
                ? (url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|embed)\/([^/]+)/)?.[1]) : null;
        return /^[\w-]{11}$/.test(id || '') ? `https://www.youtube.com/watch?v=${id}` : null;
    } catch { return null; }
}

function dailymotionUrl(value) {
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
        const id = ['dailymotion.com', 'www.dailymotion.com'].includes(url.hostname)
            ? url.pathname.match(/^\/video\/([a-zA-Z0-9]+)(?:_|\/|$)/)?.[1]
            : url.hostname === 'dai.ly' ? url.pathname.match(/^\/([a-zA-Z0-9]+)$/)?.[1] : null;
        return id ? `https://www.dailymotion.com/video/${id}` : null;
    } catch { return null; }
}

async function searchVideo(text, options = {}) {
    if (youtubeUrl(text)) return searchYoutube(text, options);
    const direct = dailymotionUrl(text);
    if (/^https?:\/\//i.test(text) && !direct) throw Object.assign(new Error('VIDEO_SOURCE_UNSUPPORTED'), { code: 'VIDEO_SOURCE_UNSUPPORTED' });
    const http = options.http || axios;
    try {
        const { data } = await http.get(direct ? `https://api.dailymotion.com/video/${direct.split('/').at(-1)}` : 'https://api.dailymotion.com/videos', {
            timeout: 15000, maxContentLength: 1024 * 1024,
            params: { fields: 'id,title,duration,url,created_time,views_total', ...(direct ? {} : { search: text, limit: 10 }) }
        });
        const terms = text.toLowerCase().split(/\s+/).filter(term => term.length > 1 && !['song', 'video', 'music', 'official'].includes(term));
        const item = (direct ? [data] : data?.list || []).find(row => dailymotionUrl(row.url) && row.title &&
            (direct || terms.every(term => row.title.toLowerCase().includes(term))));
        if (!item) return { videos: [] };
        return { videos: [{ url: dailymotionUrl(item.url), title: item.title, views: item.views_total,
            timestamp: `${Math.floor(item.duration / 60)}:${String(item.duration % 60).padStart(2, '0')}`,
            ago: item.created_time ? new Date(item.created_time * 1000).toISOString().slice(0, 10) : undefined, source: 'Dailymotion' }] };
    } catch { throw Object.assign(new Error('VIDEO_SEARCH_UNAVAILABLE'), { code: 'VIDEO_SEARCH_UNAVAILABLE' }); }
}

function boundedSearch(job) {
    let timer;
    return Promise.race([Promise.resolve().then(job), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('SEARCH_TIMEOUT'), { code: 'SEARCH_TIMEOUT' })), SEARCH_TIMEOUT_MS);
    })]).finally(() => clearTimeout(timer));
}

async function searchYoutube(text, options = {}) {
    const http = options.http || axios;
    const key = options.key === undefined ? await require('./keyserver').youtubeKey() : options.key;
    const directUrl = youtubeUrl(text);
    const jobs = [boundedSearch(async () => {
        const result = await (options.publicSearch || require('yt-search'))(directUrl ? { videoId: new URL(directUrl).searchParams.get('v') } : text);
        const video = directUrl ? result : result.videos?.[0];
        if (!video?.title || !youtubeUrl(video.url || directUrl)) throw new Error('NO_RESULTS');
        return { videos: [{ ...video, url: youtubeUrl(video.url || directUrl) }] };
    })];
    if (key) jobs.push(boundedSearch(async () => {
        const { data } = await http.get(`https://www.googleapis.com/youtube/v3/${directUrl ? 'videos' : 'search'}`, {
            timeout: SEARCH_TIMEOUT_MS, maxContentLength: 1024 * 1024,
            headers: { 'x-goog-api-key': key },
            params: directUrl ? { part: 'snippet,contentDetails,statistics', id: new URL(directUrl).searchParams.get('v') }
                : { part: 'snippet', type: 'video', maxResults: 1, q: text }
        });
        const item = data?.items?.[0];
        const id = typeof item?.id === 'string' ? item.id : item?.id?.videoId;
        if (!/^[\w-]{11}$/.test(id || '') || !item?.snippet?.title) throw new Error('NO_RESULTS');
        return { videos: [{ url: `https://www.youtube.com/watch?v=${id}`, title: item.snippet.title,
            views: item.statistics?.viewCount, timestamp: item.contentDetails?.duration,
            ago: item.snippet.publishedAt?.slice(0, 10),
            thumbnail: item.snippet.thumbnails?.high?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg` }] };
    }));
    // Prefer public metadata: it carries views, duration, upload age and artwork.
    jobs.slice(1).forEach(job => job.catch(() => {}));
    try { return await jobs[0]; } catch {}
    try { return await Promise.any(jobs.slice(1)); }
    catch { throw Object.assign(new Error('SEARCH_UNAVAILABLE'), { code: 'SEARCH_UNAVAILABLE' }); }
}

// The Data API returns metadata, not media. Download public media directly using
// the maintained extractor; never supply cookies or work around access checks.
async function downloadDirectYoutube(url, type, options = {}) {
    const canonical = youtubeUrl(url) || (type === 'mp4' ? dailymotionUrl(url) : null);
    if (!canonical || !LIMITS[type]) throw Object.assign(new Error('INVALID_VIDEO'), { code: 'INVALID_VIDEO' });
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'elite-direct-youtube-'));
    const output = path.join(dir, 'download.media');
    try {
        await new Promise((resolve, reject) => {
            const binary = require('youtube-dl-exec').constants.YOUTUBE_DL_PATH;
            const args = ['--ignore-config', '--no-playlist', '--no-warnings', '--no-progress',
                '--socket-timeout', '15', '--retries', '0', '--fragment-retries', '0',
                '--max-filesize', String(LIMITS[type]), '--output', output,
                '--format', type === 'mp4' ? 'best[height<=480][vcodec!=none][acodec!=none]/best[height<=480]' : 'bestaudio/best', '--', canonical];
            const proc = (options.spawn || spawn)(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
            let diagnostic = '';
            let stopped = false;
            let stopError;
            const finish = error => {
                if (stopped) return;
                stopped = true; clearTimeout(timer); clearInterval(watcher);
                if (error) reject(error); else resolve();
            };
            const failure = code => Object.assign(new Error(code), { code });
            const stop = error => {
                if (stopped || stopError) return;
                stopError = error;
                clearTimeout(timer); clearInterval(watcher);
                proc.kill('SIGKILL');
            };
            const timer = setTimeout(() => stop(failure('DIRECT_DOWNLOAD_TIMEOUT')), 90000);
            const watcher = setInterval(() => {
                for (const file of [output, `${output}.part`]) {
                    try { if (fs.statSync(file).size >= LIMITS[type]) stop(failure('MEDIA_TOO_LARGE')); } catch {}
                }
            }, 250);
            proc.stderr?.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-8192); });
            proc.once('error', () => finish(failure('DIRECT_DOWNLOADER_UNAVAILABLE')));
            proc.once('close', code => finish(stopError || (code === 0 ? null : failure(
                /larger than max.filesize/i.test(diagnostic) ? 'MEDIA_TOO_LARGE' : /sign in|not a bot|confirm your age|private video|members.only|403|429/i.test(diagnostic)
                    ? (dailymotionUrl(canonical) ? 'VIDEO_ACCESS_RESTRICTED' : 'YOUTUBE_ACCESS_RESTRICTED') : 'DIRECT_DOWNLOAD_FAILED')));
        });
        const size = (await fs.promises.stat(output)).size;
        if (size < 1024 || size >= LIMITS[type]) throw Object.assign(new Error('INVALID_MEDIA'), { code: 'INVALID_MEDIA' });
        const handle = await fs.promises.open(output, 'r');
        const header = Buffer.alloc(4100);
        try { await handle.read(header, 0, header.length, 0); } finally { await handle.close(); }
        const detected = await FileType.fromBuffer(header);
        if (!detected || !(type === 'mp4' ? /^video\// : /^(audio|video)\//).test(detected.mime))
            throw Object.assign(new Error('INVALID_MEDIA'), { code: 'INVALID_MEDIA' });
        // The normal path consumes the file directly: do not retain a second
        // complete input buffer while ffmpeg and WhatsApp upload are running.
        return { buffer: options.normalize
            ? await options.normalize(await fs.promises.readFile(output), type)
            : await normalizeFile(output, type) };
    } finally { await fs.promises.rm(dir, { recursive: true, force: true }); }
}

function providers(url, type) {
    const target = encodeURIComponent(url);
    return [
        `https://api.neosoft.best/api/downloader/youtube?url=${target}&type=${type}`,
        `https://apis.davidcyriltech.my.id/download/yt${type}?url=${target}`,
        `https://apis.davidcyriltech.my.id/youtube/${type}?url=${target}`,
        // Songs that only exist as video: fetch the video and extract its sound.
        ...(type === 'mp3' ? [
            `https://api.neosoft.best/api/downloader/youtube?url=${target}&type=mp4`,
            `https://apis.davidcyriltech.my.id/download/ytmp4?url=${target}`
        ] : [])
    ];
}

function downloadLink(data) {
    if (!data || data.success === false || data.status === false) return null;
    const result = data.result || data.data || data;
    const link = typeof data.download === 'string' ? data.download :
        result.download_url || result.downloadURL || result.downloadUrl || result.url || data.downloadURL;
    if (typeof link !== 'string' || !/^https?:\/\//i.test(link)) return null;
    return { url: link, title: data.title || result.title };
}

// Isolated files and a hard deadline prevent simultaneous conversions from
// overwriting each other or leaving ffmpeg running indefinitely.
async function normalize(buffer, type) {
    assertMediaSize({ fileLength: buffer.length }, LIMITS[type]);
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'elite-youtube-'));
    const input = path.join(dir, 'input');
    try {
        await fs.promises.writeFile(input, buffer);
        return await normalizeFile(input, type);
    } finally { await fs.promises.rm(dir, { recursive: true, force: true }); }
}

async function normalizeFile(input, type) {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'elite-youtube-'));
    const output = path.join(dir, `output.${type}`);
    try {
        const handle = await fs.promises.open(input, 'r');
        const header = Buffer.alloc(4100);
        try { await handle.read(header, 0, header.length, 0); } finally { await handle.close(); }
        const detected = await FileType.fromBuffer(header);
        let compatibleVideo = false;
        if (type === 'mp4') {
            const diagnostic = await new Promise((resolve, reject) => {
                const proc = spawn(require('@ffmpeg-installer/ffmpeg').path, ['-nostdin', '-hide_banner', '-i', input], { stdio: ['ignore', 'ignore', 'pipe'] });
                let text = '';
                const timer = setTimeout(() => proc.kill('SIGKILL'), 10000);
                proc.stderr.on('data', chunk => { text = (text + chunk).slice(-8192); });
                proc.once('error', () => { clearTimeout(timer); reject(new Error('CONVERSION_FAILED')); });
                proc.once('close', () => { clearTimeout(timer); resolve(text); });
            });
            compatibleVideo = /Video: h264\b/i.test(diagnostic);
        }
        // Remux genuine MP3 through ffmpeg without another lossy encode. Other
        // audio formats still need conversion; invalid streams still fail.
        const args = type === 'mp3'
            ? (detected?.mime === 'audio/mpeg' ? ['-vn', '-c:a', 'copy'] : ['-vn', '-ac', '2', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '128k'])
            : ['-map', '0:v:0', '-map', '0:a:0?',
                ...(compatibleVideo ? ['-c:v', 'copy'] : ['-c:v', 'libx264', '-threads', '1', '-preset', 'ultrafast', '-crf', '30', '-vf', 'scale=trunc(min(640,iw)/2)*2:-2', '-pix_fmt', 'yuv420p']),
                '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart'];
        await new Promise((resolve, reject) => {
            const proc = spawn(require('@ffmpeg-installer/ffmpeg').path,
                ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-threads', '1', '-filter_threads', '1', '-i', input,
                    ...args, '-threads', '1', '-fs', String(LIMITS[type] + 1), output], { stdio: 'ignore' });
            let timedOut = false;
            const timer = setTimeout(() => { timedOut = true; proc.kill('SIGKILL'); }, 120000);
            proc.once('error', () => { clearTimeout(timer); reject(new Error('CONVERSION_FAILED')); });
            proc.once('close', code => { clearTimeout(timer); code === 0 && !timedOut ? resolve() : reject(new Error(timedOut ? 'CONVERSION_TIMEOUT' : 'INVALID_MEDIA')); });
        });
        assertMediaSize({ fileLength: (await fs.promises.stat(output)).size }, LIMITS[type]);
        const converted = await fs.promises.readFile(output);
        if (converted.length < 1024 || converted.length >= LIMITS[type]) throw new Error('INVALID_MEDIA');
        return converted;
    } finally {
        await fs.promises.rm(dir, { recursive: true, force: true });
    }
}

async function downloadYoutube(url, type, options = {}) {
    if (!LIMITS[type] || !youtubeUrl(url)) throw Object.assign(new Error('INVALID_VIDEO'), { code: 'INVALID_VIDEO' });
    if (type === 'mp4' && !options.providers) return (options.direct || downloadDirectYoutube)(url, type, options);
    const http = options.http || axios;
    const convert = options.normalize || normalize;
    if (type === 'mp3') {
        // Keep the original primary service, but do not wait a full minute for
        // a stalled service before trying the existing fallbacks. At most two
        // fetches run at once; only the winner is converted, with no audio cache.
        const endpoints = options.providers || providers(url, type);
        const controller = new AbortController();
        let hedgeTimer;
        const failures = [];
        const failureSummary = (error, index) => {
            const status = Number(error?.response?.status);
            const code = typeof error?.code === 'string' && /^[A-Z_0-9]+$/.test(error.code) ? error.code : 'INVALID_MEDIA';
            return `Audio provider ${index + 1}: ${status ? `HTTP ${status}` : code}`;
        };
        const fetchAudio = async endpoint => {
            const deadline = Date.now() + 25000;
            let response;
            // One retry for transient transport/server failures, within the same
            // resolver deadline. Permanent denials and invalid files are not retried.
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    response = await http.get(endpoint, {
                        timeout: Math.max(1, deadline - Date.now()), maxContentLength: 1024 * 1024, signal: controller.signal
                    });
                    break;
                } catch (error) {
                    const transient = [500, 502, 503, 504].includes(error.response?.status) ||
                        ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN'].includes(error.code);
                    if (attempt || !transient || controller.signal.aborted || deadline - Date.now() <= 250) throw error;
                    await new Promise(resolve => {
                        const done = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', done); resolve(); };
                        const timer = setTimeout(done, 200);
                        controller.signal.addEventListener('abort', done, { once: true });
                    });
                    if (controller.signal.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ERR_CANCELED' });
                }
            }
            const media = downloadLink(response.data);
            if (!media) throw new Error('INVALID_MEDIA');
            const file = await http.get(media.url, {
                responseType: 'arraybuffer', timeout: 60000, signal: controller.signal,
                maxContentLength: LIMITS.mp3, maxBodyLength: LIMITS.mp3,
                headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.youtube.com/' }
            });
            const buffer = Buffer.from(file.data);
            const detected = await FileType.fromBuffer(buffer);
            if (buffer.length < 1024 || buffer.length >= LIMITS.mp3 || !detected || !/^(audio|video)\//.test(detected.mime))
                throw new Error('INVALID_MEDIA');
            return { buffer, title: media.title };
        };
        try {
            if (!endpoints.length) throw new Error('NO_PROVIDERS');
            let startFallback;
            const fallbackReady = new Promise(resolve => { startFallback = resolve; });
            const primary = fetchAudio(endpoints[0]).catch(error => {
                failures.push(failureSummary(error, 0));
                throw error;
            });
            primary.catch(() => startFallback());
            hedgeTimer = setTimeout(() => startFallback(), AUDIO_HEDGE_MS);
            const fallback = fallbackReady.then(async () => {
                for (const [index, endpoint] of endpoints.slice(1).entries()) {
                    if (controller.signal.aborted) break;
                    try { return await fetchAudio(endpoint); } catch (error) {
                        if (!controller.signal.aborted) failures.push(failureSummary(error, index + 1));
                    }
                }
                throw new Error('NO_PROVIDERS');
            });
            const winner = await Promise.any([primary, fallback]);
            clearTimeout(hedgeTimer);
            controller.abort();
            startFallback();
            try {
                return { buffer: await convert(winner.buffer, type), title: winner.title };
            } catch (error) {
                const code = typeof error?.code === 'string' && /^[A-Z_0-9]+$/.test(error.code) ? error.code : 'INVALID_MEDIA';
                throw Object.assign(new Error(`The downloaded audio could not be converted (${code}).`), { code: 'AUDIO_CONVERSION_FAILED' });
            }
        } catch (error) {
            if (error.code === 'AUDIO_CONVERSION_FAILED') throw error;
            // Last resort: fetch the public media directly (audio, or the video
            // stream when no audio-only format exists) and convert it to MP3.
            if (!options.providers || options.direct) {
                try {
                    const direct = await (options.direct || downloadDirectYoutube)(url, 'mp3', options);
                    if (direct?.buffer) return direct;
                } catch (directError) {
                    const code = typeof directError?.code === 'string' && /^[A-Z_0-9]+$/.test(directError.code) ? directError.code : 'DIRECT_DOWNLOAD_FAILED';
                    failures.push(`Direct download: ${code}`);
                }
            }
            throw Object.assign(new Error(failures.length ? failures.join('\n') : 'No audio provider returned a valid playable file.'), { code: 'DOWNLOAD_UNAVAILABLE' });
        } finally {
            clearTimeout(hedgeTimer);
            controller.abort();
        }
    }
    for (const endpoint of options.providers || providers(url, type)) {
        try {
            const response = await http.get(endpoint, { timeout: 20000, maxContentLength: 1024 * 1024 });
            const media = downloadLink(response.data);
            if (!media) continue;
            const file = await http.get(media.url, {
                responseType: 'arraybuffer', timeout: 60000,
                maxContentLength: LIMITS[type], maxBodyLength: LIMITS[type],
                headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.youtube.com/' }
            });
            const buffer = Buffer.from(file.data);
            const detected = await FileType.fromBuffer(buffer);
            if (buffer.length < 1024 || buffer.length > LIMITS[type] || !detected ||
                !(type === 'mp4' ? /^video\// : /^(audio|video)\//).test(detected.mime)) continue;
            // Never send arbitrary bytes labelled MP3/MP4, even if conversion fails.
            return { buffer: await convert(buffer, type), title: media.title };
        } catch (error) {
            // Do not log signed CDN URLs, tokens, or entire Axios request objects.
            console.warn(`YouTube ${type} provider failed (${error.response?.status || error.code || 'invalid media'})`);
        }
    }
    const error = new Error('DOWNLOAD_UNAVAILABLE');
    error.code = 'DOWNLOAD_UNAVAILABLE';
    throw error;
}

async function downloadVideo(url, type, options = {}) {
    if (type !== 'mp4') throw Object.assign(new Error('INVALID_VIDEO'), { code: 'INVALID_VIDEO' });
    if (dailymotionUrl(url)) return (options.direct || downloadDirectYoutube)(url, type, options);
    return downloadYoutube(url, type, options);
}

function styled(text, upper, lower, digit) {
    return [...String(text)].map(ch => {
        const c = ch.codePointAt(0);
        if (c >= 65 && c <= 90 && upper) return String.fromCodePoint(upper + c - 65);
        if (c >= 97 && c <= 122 && lower) return String.fromCodePoint(lower + c - 97);
        if (c >= 48 && c <= 57 && digit) return String.fromCodePoint(digit + c - 48);
        return ch;
    }).join('');
}
const fancy = text => styled(text, 0x1D468, 0x1D482, 0x1D7CE);
const SMALL = 'ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ';
const caps = text => [...String(text).toLowerCase()].map(ch => /[a-z]/.test(ch) ? SMALL[ch.charCodeAt(0) - 97] : ch).join('');

function musicCaption(video, url) {
    const ago = String(video.ago || '—').replace(/(\d+)\s*months?/, '$1mo').replace(/(\d+)\s*years?/, '$1y');
    return '╭━━━━━━━━━\n' +
        `┃ ${fancy('CBS-SCOVER-V1 MUSIC - DOWNLOADER')}\n\n` +
        `> ${caps('Title')}: ${fancy(video.title || 'YouTube Download')}\n\n` +
        `┃ ${caps('Views')}: ${fancy(video.views ?? '—')}\n` +
        `┃ ${caps('Duration')}: ${fancy(video.timestamp || '—')}\n` +
        `┃ ${caps('Uploaded')}: ${fancy(ago)}\n\n` +
        `> ${caps('URL')}: ${String(url).replace('www.youtube.com', 'youtube.com')}\n\n` +
        `┃ ${fancy('Enjoy your music')}®\n` +
        '╰━━━━━━━━━━━━━━━━━━┈⊷\n' +
        `> ${caps('Powered by CBS-SCOVER')}©`;
}

async function handleYoutubeDownload(socket, m, text, type, prefix, command, options = {}) {
    const sendText = value => socket.sendMessage(m.chat, { text: value }, { quoted: m });
    if (!text) return sendText(`*Example:* ${prefix + command} Faded by Alan Walker`);
    let releaseMedia;
    try { releaseMedia = acquireMediaJob(); } catch (error) { return sendText(error.message); }
    let videoUrl;
    try {
        await socket.sendMessage(m.chat, { react: { text: type === 'mp3' ? '🎵' : '📽️', key: m.key } }).catch(() => {});
        const multiSource = type === 'mp4' && command !== 'ytmp4';
        const search = await (options.search || (multiSource ? searchVideo : searchYoutube))(text);
        const video = search.videos?.[0];
        if (!video) return sendText(`No matching video found for: ${text}${multiSource ? '\nTry a public Dailymotion or YouTube video link.' : ''}`);
        videoUrl = youtubeUrl(text) || (multiSource ? dailymotionUrl(text) : null)
            || youtubeUrl(video.url) || (multiSource ? dailymotionUrl(video.url) : null);
        if (!videoUrl) throw Object.assign(new Error('INVALID_VIDEO'), { code: 'INVALID_VIDEO' });
        const info = `*CBS-SCOVER-V1 ${type === 'mp3' ? 'MUSIC' : 'VIDEO'} - DOWNLOADER*\n\n` +
            `*Title:* ${video.title || 'YouTube Download'}\n*Views:* ${video.views || '—'}\n*Duration:* ${video.timestamp || '—'}\n` +
            `*Uploaded:* ${video.ago || '—'}\n\n*URL:* ${videoUrl}`;
        // Latest timing request: real link details immediately after search, without
        // waiting for download, thumbnail fetch, conversion or WhatsApp upload.
        const thumb = video.thumbnail || video.image ||
            (youtubeUrl(videoUrl) ? `https://i.ytimg.com/vi/${new URL(youtubeUrl(videoUrl)).searchParams.get('v')}/hqdefault.jpg` : null);
        const baileys = options.baileys || require('baileys');
        const prepareMedia = async () => {
            const media = await (options.download || (multiSource ? downloadVideo : downloadYoutube))(videoUrl, type);
            assertMediaSize({ fileLength: media.buffer?.length });
            const title = media.title || video.title || 'YouTube Download';
            const content = type === 'mp3'
                ? { audio: media.buffer, mimetype: 'audio/mpeg', ptt: false, fileName: `${title.replace(/[\\/:*?"<>|]/g, '')}.mp3` }
                : { video: media.buffer, mimetype: 'video/mp4', caption: `🎬 *${title}*` };
            return baileys.prepareWAMessageMedia(content, { upload: socket.waUploadToServer });
        };
        // Download and upload audio while the thumbnail/card is being sent.
        // Capture errors immediately; never relay audio before the card arrives.
        const audioJob = type === 'mp3'
            ? Promise.resolve().then(prepareMedia).then(value => ({ value }), error => ({ error })) : null;
        if (type === 'mp3') {
            const caption = musicCaption(video, videoUrl);
            await (thumb ? socket.sendMessage(m.chat, { image: { url: thumb }, caption }, { quoted: m }).catch(() => sendText(caption)) : sendText(caption));
        } else await sendText('📽️ Preparing your video…');
        // Only relay validated and completely uploaded media.
        const result = audioJob ? await audioJob : { value: await prepareMedia() };
        if (result.error) throw result.error;
        const prepared = result.value;
        const message = baileys.generateWAMessageFromContent(m.chat, prepared, { userJid: socket.user.id, quoted: m });
        await socket.relayMessage(m.chat, message.message, { messageId: message.key.id });
        if (type === 'mp4') await sendText(info);
        await socket.sendMessage(m.chat, { react: { text: '✅', key: m.key } }).catch(() => {});
    } catch (error) {
        console.warn(`YouTube command failed (${error.code || 'send or search failure'})`);
        await socket.sendMessage(m.chat, { react: { text: '❌', key: m.key } }).catch(() => {});
        if (error.code === 'DOWNLOAD_UNAVAILABLE' || error.code === 'AUDIO_CONVERSION_FAILED') {
            await require('./error-reporting').reportError(socket, m, error, 'Music download');
        }
        const description = error.code === 'MEDIA_TOO_LARGE' ? `This file exceeds the ${Math.round(MAX_MEDIA_BYTES / 1048576)} MB media limit. Try a shorter video.`
            : error.code === 'YOUTUBE_ACCESS_RESTRICTED'
            ? 'YouTube blocked this server from accessing the video. A YouTube API key cannot unlock the download.'
            : error.code === 'VIDEO_ACCESS_RESTRICTED' ? 'The video website denied access to this public video. Try another video link.'
            : error.code === 'VIDEO_SOURCE_UNSUPPORTED' ? 'Supported video links: Dailymotion and YouTube. Or send a title to search Dailymotion.'
            : error.code === 'VIDEO_SEARCH_UNAVAILABLE' ? 'Dailymotion search is unavailable. Try again or send a public video link.'
            : error.code === 'SEARCH_UNAVAILABLE' ? 'YouTube search did not respond in time. Please try again or send the video link.'
            : error.code === 'DIRECT_DOWNLOADER_UNAVAILABLE' ? 'The video downloader is missing. Reinstall the bot dependencies on your host.'
            : /^DIRECT_DOWNLOAD/.test(error.code || '') ? 'The video website could not supply this file to the server. Please try another public video.'
            : error.code === 'DOWNLOAD_UNAVAILABLE'
            ? 'The download providers could not supply a playable file. Please try again later.'
            : error.code === 'AUDIO_CONVERSION_FAILED' ? 'The downloaded audio could not be converted to a playable MP3. Check the private error notice.'
            : 'The file could not be prepared or sent. Please try again.';
        return sendText(`❌ ${description}${videoUrl && type === 'mp3' ? `\nWatch or listen here: ${videoUrl}` : ''}`);
    } finally {
        releaseMedia();
    }
}

module.exports = { downloadYoutube, downloadVideo, searchVideo, dailymotionUrl, handleYoutubeDownload, downloadLink, normalize, downloadDirectYoutube, searchYoutube, youtubeUrl, DETAILS_TARGET_MS, SEARCH_TIMEOUT_MS, PLAY_TARGET_MS, AUDIO_HEDGE_MS, LIMITS };