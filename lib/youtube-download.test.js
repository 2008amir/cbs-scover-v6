const test = require('node:test');
const assert = require('node:assert/strict');
const { handleYoutubeDownload, downloadYoutube, downloadLink, searchYoutube, downloadDirectYoutube, DETAILS_TARGET_MS, SEARCH_TIMEOUT_MS, PLAY_TARGET_MS, AUDIO_HEDGE_MS } = require('./youtube-download');
const fs = require('fs');
const { EventEmitter } = require('events');

const audio = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(2048)]);
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(2048)]);
const video = { url: 'https://youtube.com/watch?v=sz-5kP-r758', title: 'Amanar Kauna', timestamp: '2:53' };

test('provider normalization supports both Neosoft and fallback responses', () => {
    assert.equal(downloadLink({ status: true, download: 'https://cdn.test/a.mp3' }).url, 'https://cdn.test/a.mp3');
    assert.equal(downloadLink({ success: true, result: { download_url: 'https://cdn.test/a.mp4' } }).url, 'https://cdn.test/a.mp4');
    assert.equal(downloadLink({ status: false, download: 'https://cdn.test/error' }), null);
});

test('a failed primary video resolver falls through to a downloadable provider', async () => {
    const calls = [];
    const http = { get: async url => {
        calls.push(url);
        if (url === 'primary') throw Object.assign(new Error('rate limited'), { response: { status: 429 } });
        if (url === 'fallback') return { data: { success: true, result: { title: 'Amanar Kauna', download_url: 'https://cdn.test/video' } } };
        return { data: mp4 };
    } };
    const result = await downloadYoutube(video.url, 'mp4', { http, providers: ['primary', 'fallback'], normalize: async (_, type) => {
        assert.equal(type, 'mp4'); return Buffer.from('normalized playable mp4');
    } });
    assert.equal(result.title, 'Amanar Kauna');
    assert.deepEqual(calls, ['primary', 'fallback', 'https://cdn.test/video']);
});

test('HTML downloads and failed conversions are never sent as media', async () => {
    const http = { get: async url => url === 'provider' ? { data: { download: 'https://cdn.test/error' } } : { data: Buffer.from('<html>' + 'error'.repeat(400)) } };
    await assert.rejects(downloadYoutube(video.url, 'mp3', { http, providers: ['provider'], normalize: () => assert.fail('HTML reached converter') }), { code: 'DOWNLOAD_UNAVAILABLE' });
    http.get = async url => url === 'provider' ? { data: { download: 'https://cdn.test/audio' } } : { data: audio };
    await assert.rejects(downloadYoutube(video.url, 'mp3', { http, providers: ['provider'], normalize: async () => { throw new Error('invalid audio'); } }), { code: 'AUDIO_CONVERSION_FAILED' });
});

function flow(type, overrides = {}) {
    const events = [];
    let now = 0;
    let detailsAt;
    let mediaAt;
    const socket = { user: { id: 'bot@s.whatsapp.net' }, waUploadToServer: () => {},
        sendMessage: async (_, content) => {
            if (content.text?.startsWith('*CBS-SCOVER-V1') || content.caption?.includes('𝑴𝑼𝑺𝑰𝑪')) { events.push('details'); detailsAt = now; }
        },
        relayMessage: async (_, content) => { events.push('relay'); assert.ok(content[type === 'mp3' ? 'audioMessage' : 'videoMessage']); mediaAt = now; }
    };
    const options = { search: async query => { assert.equal(query, 'amanar kauna song'); return { videos: [video] }; },
        download: async (_, format) => { assert.equal(format, type); now += 30000; events.push('download'); return { buffer: audio }; },
        baileys: {
            prepareWAMessageMedia: async () => { now += 12000; events.push('upload'); return { [type === 'mp3' ? 'audioMessage' : 'videoMessage']: {} }; },
            generateWAMessageFromContent: (_, message) => ({ key: { id: 'ready' }, message })
        }, ...overrides
    };
    return { run: () => handleYoutubeDownload(socket, { chat: 'test@s.whatsapp.net', key: { id: 'request' } }, 'amanar kauna song', type, '.', type === 'mp3' ? 'play' : 'video', options), events, gap: () => mediaAt - detailsAt, detailsAt: () => detailsAt };
}

test('play details appear within the three-second target before a slow audio download or upload', async () => {
    const f = flow('mp3'); await f.run();
    assert.deepEqual(f.events, ['details', 'download', 'upload', 'relay']);
    assert.equal(DETAILS_TARGET_MS, 3000);
    assert.ok(f.detailsAt() < 3000);
    assert.equal(f.gap(), 42000);
});

test('.play reacts first, sends matching YouTube information, then sends playable audio', async () => {
    const events = [];
    const request = { chat: 'test@s.whatsapp.net', key: { id: 'play-sequence' } };
    const socket = {
        user: { id: 'bot@s.whatsapp.net' }, waUploadToServer: () => {},
        sendMessage: async (_, content) => {
            if (content.react?.text === '🎵') {
                await new Promise(resolve => setTimeout(resolve, 10));
                assert.equal(content.react.key, request.key);
                events.push('reaction');
            } else if (content.caption) {
                assert.equal(content.image.url, 'https://i.ytimg.com/vi/sz-5kP-r758/hqdefault.jpg');
                assert.ok(content.caption.includes('𝑨𝒎𝒂𝒏𝒂𝒓 𝑲𝒂𝒖𝒏𝒂'));
                assert.ok(content.caption.includes('youtube.com/watch?v=sz-5kP-r758'));
                events.push('youtube-info');
            }
        },
        relayMessage: async (_, content) => {
            assert.deepEqual(content.audioMessage.buffer, audio);
            events.push('audio');
        }
    };
    await handleYoutubeDownload(socket, request, 'amanar kauna song', 'mp3', '.', 'play', {
        search: async () => ({ videos: [video] }),
        download: async (url, type) => {
            assert.equal(url, video.url);
            assert.equal(type, 'mp3');
            assert.deepEqual(events, ['reaction', 'youtube-info']);
            return { buffer: audio };
        },
        baileys: {
            prepareWAMessageMedia: async content => {
                assert.equal(content.mimetype, 'audio/mpeg');
                assert.equal(content.ptt, false);
                assert.equal(content.fileName, 'Amanar Kauna.mp3');
                return { audioMessage: { buffer: content.audio } };
            },
            generateWAMessageFromContent: (_, message) => ({ key: { id: 'audio-ready' }, message })
        }
    });
    assert.deepEqual(events, ['reaction', 'youtube-info', 'audio']);
});

test('.video sends its details only after the actual video has been relayed', async () => {
    const f = flow('mp4'); await f.run();
    assert.deepEqual(f.events, ['download', 'upload', 'relay', 'details']);
});

test('.play overlaps picture delivery with full audio preparation and meets the ten-second target on bounded services', async () => {
    let now = 0;
    let cardDelivered = false;
    let releaseCard;
    const cardReady = new Promise(resolve => { releaseCard = resolve; });
    const events = [];
    const socket = {
        user: { id: 'bot@s.whatsapp.net' }, waUploadToServer: () => {},
        sendMessage: async (_, content) => {
            if (content.react?.text === '🎵') { now = 100; events.push('reaction'); }
            if (content.caption) { events.push('card-start'); await cardReady; cardDelivered = true; events.push('card-delivered'); }
        },
        relayMessage: async (_, content) => {
            assert.equal(cardDelivered, true);
            assert.deepEqual(content.audioMessage.buffer, audio);
            events.push('audio-delivered');
        }
    };
    await handleYoutubeDownload(socket, { chat: 'chat', key: { id: 'overlap' } }, 'amanar kauna song', 'mp3', '.', 'play', {
        search: async () => { now += 500; return { videos: [video] }; },
        download: async () => {
            assert.equal(cardDelivered, false);
            events.push('download'); now += 4000; return { buffer: audio };
        },
        baileys: {
            prepareWAMessageMedia: async content => {
                assert.equal(cardDelivered, false);
                now += 2000; events.push('upload'); releaseCard();
                return { audioMessage: { buffer: content.audio } };
            },
            generateWAMessageFromContent: (_, message) => ({ key: { id: 'sent' }, message })
        }
    });
    assert.equal(PLAY_TARGET_MS, 10000);
    assert.equal(now, 6600);
    assert.ok(now < PLAY_TARGET_MS);
    assert.deepEqual(events, ['reaction', 'card-start', 'download', 'upload', 'card-delivered', 'audio-delivered']);
});

test('a stalled primary audio provider is hedged without duplicate conversion or waiting for its timeout', async () => {
    const calls = [];
    let primarySignal;
    let conversions = 0;
    const http = { get: async (url, config) => {
        calls.push(url);
        if (url === 'primary') {
            primarySignal = config.signal;
            assert.ok(config.timeout > 0 && config.timeout <= 25000);
            return new Promise((_, reject) => config.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
        }
        if (url === 'fallback') return { data: { download: 'https://cdn.test/full.mp3' } };
        assert.equal(config.timeout, 60000);
        return { data: audio };
    } };
    const started = Date.now();
    const result = await downloadYoutube(video.url, 'mp3', { http, providers: ['primary', 'fallback', 'unused'], normalize: async buffer => {
        conversions++; assert.deepEqual(buffer, audio); return buffer;
    } });
    assert.equal(AUDIO_HEDGE_MS, 800);
    assert.ok(Date.now() - started < PLAY_TARGET_MS);
    assert.deepEqual(result.buffer, audio);
    assert.equal(conversions, 1);
    assert.equal(primarySignal.aborted, true);
    assert.deepEqual(calls, ['primary', 'fallback', 'https://cdn.test/full.mp3']);
});

test('a transient audio provider 502 retries once within the resolver deadline and converts once', async () => {
    let requests = 0, conversions = 0;
    const result = await downloadYoutube('https://www.youtube.com/watch?v=BG-anHt4vzw', 'mp3', {
        providers: ['primary'], http: { get: async (url, options) => {
            if (url === 'primary') {
                requests++;
                assert.ok(options.timeout <= 25000);
                if (requests === 1) throw Object.assign(new Error('private signed URL'), { response: { status: 502 } });
                return { data: { download: 'https://cdn.test/audio' } };
            }
            return { data: audio };
        } }, normalize: async buffer => { conversions++; return buffer; }
    });
    assert.equal(requests, 2);
    assert.equal(conversions, 1);
    assert.deepEqual(result.buffer, audio);
});

test('permanent audio denials are not retried and failure causes omit provider secrets', async () => {
    let requests = 0;
    await assert.rejects(downloadYoutube(video.url, 'mp3', { providers: ['primary'], http: { get: async () => {
        requests++;
        throw Object.assign(new Error('https://cdn.test/?token=secret-value'), { response: { status: 403, data: 'secret-value' } });
    } } }), error => error.code === 'DOWNLOAD_UNAVAILABLE' && error.message === 'Audio provider 1: HTTP 403');
    assert.equal(requests, 1);
});

test('failed overlapped audio preparation never relays a broken file or leaks an unhandled rejection', async () => {
    const replies = [];
    await handleYoutubeDownload({
        sendMessage: async (_, content) => { replies.push(content); },
        relayMessage: () => assert.fail('Failed audio was relayed')
    }, { chat: 'chat', key: { id: 'failed-audio' } }, 'song', 'mp3', '.', 'play', {
        search: async () => ({ videos: [video] }),
        download: async () => { throw Object.assign(new Error('DOWNLOAD_UNAVAILABLE'), { code: 'DOWNLOAD_UNAVAILABLE' }); },
        baileys: {}
    });
    assert.ok(replies.some(content => content.caption));
    assert.ok(replies.some(content => content.text?.includes('could not supply a playable file')));
});

test('genuine MP3 preserves every original audio packet without a slow second lossy encode', async () => {
    const { spawnSync } = require('child_process');
    const binary = require('@ffmpeg-installer/ffmpeg').path;
    const source = spawnSync(binary, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.3', '-f', 'mp3', 'pipe:1']);
    assert.equal(source.status, 0);
    const output = await require('./youtube-download').normalize(source.stdout, 'mp3');
    const packets = buffer => {
        const result = spawnSync(binary, ['-v', 'error', '-i', 'pipe:0', '-map', '0:a:0', '-c:a', 'copy', '-f', 'data', 'pipe:1'], { input: buffer });
        assert.equal(result.status, 0);
        return result.stdout;
    };
    assert.ok(output.length > 1024);
    assert.deepEqual(packets(output), packets(source.stdout));
});

test('unavailable video never announces unverified watch details or relays a broken file', async () => {
    const f = flow('mp4', { download: async () => { throw Object.assign(new Error('unavailable'), { code: 'DOWNLOAD_UNAVAILABLE' }); } });
    await f.run(); assert.deepEqual(f.events, []);
});

test('audio and video share the 25 MB host media ceiling', () => {
    const { LIMITS } = require('./youtube-download');
    assert.equal(LIMITS.mp3, 25 * 1024 * 1024);
    assert.equal(LIMITS.mp4, 25 * 1024 * 1024);
});

test('invalid video result cannot reach download or be sent as a watch link', async () => {
    const f = flow('mp4', {
        search: async () => ({ videos: [{ title: 'Song', url: 'https://example.test/not-a-video' }] }),
        download: () => assert.fail('Invalid source reached downloader')
    });
    await f.run();
    assert.deepEqual(f.events, []);
});

test('real H264 video is normalized without re-encoding video packets', async () => {
    const { spawnSync } = require('child_process');
    const binary = require('@ffmpeg-installer/ffmpeg').path;
    const source = spawnSync(binary, ['-v', 'error', '-threads', '1', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=10:duration=0.5',
        '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-f', 'matroska', 'pipe:1']);
    assert.equal(source.status, 0);
    const result = await require('./youtube-download').normalize(source.stdout, 'mp4');
    const packets = buffer => {
        const probe = spawnSync(binary, ['-v', 'error', '-i', 'pipe:0', '-map', '0:v:0', '-c:v', 'copy', '-f', 'h264', 'pipe:1'], { input: buffer });
        assert.equal(probe.status, 0);
        return probe.stdout;
    };
    assert.ok(result.length > 1024);
    assert.deepEqual(packets(result), packets(source.stdout));
});

test('official YouTube key is used for metadata only and does not wait for slower public search', async () => {
    const result = await searchYoutube('amanar kauna song', {
        key: 'test-only-credential', publicSearch: () => new Promise(() => {}),
        http: { get: async (url, config) => {
            assert.equal(url, 'https://www.googleapis.com/youtube/v3/search');
            assert.equal(config.headers['x-goog-api-key'], 'test-only-credential');
            assert.equal(config.params.q, 'amanar kauna song');
            assert.equal(config.timeout, 2600);
            assert.ok(SEARCH_TIMEOUT_MS < 3000);
            assert.equal(config.params.key, undefined);
            return { data: { items: [{ id: { videoId: 'sz-5kP-r758' }, snippet: { title: 'Amanar Kauna' } }] } };
        } }
    });
    assert.equal(result.videos[0].url, 'https://www.youtube.com/watch?v=sz-5kP-r758');
});

test('a failed official search still uses public metadata without borrowing Gemini keys', async () => {
    const result = await searchYoutube('amanar kauna song', { key: 'test-only-credential',
        publicSearch: async () => ({ videos: [video] }), http: { get: async () => { throw new Error('quota'); } } });
    assert.equal(result.videos[0].title, 'Amanar Kauna');
});

test('video bypasses the failing third-party providers and selects direct YouTube download', async () => {
    const result = await downloadYoutube(video.url, 'mp4', {
        http: { get: () => assert.fail('Third-party provider was called') },
        direct: async (url, type) => { assert.equal(url, video.url); assert.equal(type, 'mp4'); return { buffer: mp4 }; }
    });
    assert.deepEqual(result.buffer, mp4);
});

test('direct downloader validates, converts and cleans temporary video files', async () => {
    let output;
    const result = await downloadDirectYoutube(video.url, 'mp4', {
        spawn: (_, args) => {
            assert.ok(args.includes('--ignore-config'));
            assert.equal(args.includes('--cookies'), false);
            assert.equal(args.at(-1), 'https://www.youtube.com/watch?v=sz-5kP-r758');
            output = args[args.indexOf('--output') + 1];
            const proc = new EventEmitter(); proc.stderr = new EventEmitter(); proc.kill = () => {};
            setImmediate(() => { fs.writeFileSync(output, mp4); proc.emit('close', 0); });
            return proc;
        }, normalize: async (buffer, type) => { assert.deepEqual(buffer, mp4); assert.equal(type, 'mp4'); return mp4; }
    });
    assert.deepEqual(result.buffer, mp4);
    assert.equal(fs.existsSync(output), false);
});

test('YouTube verification stops direct downloads without provider retries or leaked diagnostics', async () => {
    await assert.rejects(downloadDirectYoutube(video.url, 'mp4', { spawn: () => {
        const proc = new EventEmitter(); proc.stderr = new EventEmitter(); proc.kill = () => {};
        setImmediate(() => { proc.stderr.emit('data', 'Sign in to confirm you are not a bot'); proc.emit('close', 1); });
        return proc;
    } }), { code: 'YOUTUBE_ACCESS_RESTRICTED', message: 'YOUTUBE_ACCESS_RESTRICTED' });
});

test('non-YouTube URLs cannot reach the direct downloader', async () => {
    await assert.rejects(downloadDirectYoutube('https://example.test/private', 'mp4', { spawn: () => assert.fail('Invalid URL executed') }), { code: 'INVALID_VIDEO' });
});

test('video title search uses Dailymotion without invoking music or YouTube search', async () => {
    const { searchVideo } = require('./youtube-download');
    const result = await searchVideo('amanar kauna song', { http: { get: async (url, options) => {
        assert.equal(url, 'https://api.dailymotion.com/videos');
        assert.equal(options.params.search, 'amanar kauna song');
        return { data: { list: [{ id: 'x123', url: 'https://www.dailymotion.com/video/x123', title: 'Amanar Kauna', duration: 125 }] } };
    } } });
    assert.equal(result.videos[0].source, 'Dailymotion');
    assert.equal(result.videos[0].timestamp, '2:05');
});

test('Dailymotion search does not replace a missing song with an unrelated clip', async () => {
    const { searchVideo } = require('./youtube-download');
    const result = await searchVideo('amanar kauna song', { http: { get: async () => ({ data: { list: [{ url: 'https://www.dailymotion.com/video/x123', title: 'Amanar travel', duration: 30 }] } }) } });
    assert.equal(result.videos.length, 0);
});

test('video accepts public Dailymotion URLs but rejects arbitrary hosts and embedded credentials', async () => {
    const { dailymotionUrl, downloadVideo, searchVideo } = require('./youtube-download');
    assert.equal(dailymotionUrl('https://dai.ly/x2fos9'), 'https://www.dailymotion.com/video/x2fos9');
    for (const url of ['http://127.0.0.1/private', 'https://dailymotion.com.evil.test/video/x123', 'https://user:pass@www.dailymotion.com/video/x123']) {
        await assert.rejects(searchVideo(url), { code: 'VIDEO_SOURCE_UNSUPPORTED' });
    }
    const result = await downloadVideo('https://dai.ly/x2fos9', 'mp4', { direct: async (url, type) => {
        assert.equal(type, 'mp4'); return { buffer: mp4 };
    } });
    assert.deepEqual(result.buffer, mp4);
});