const test = require('node:test');
const assert = require('node:assert/strict');
const { sendGroupStatus } = require('./group-status');

test('real Baileys generates an encodable text group story without invalid media type', async () => {
    const real = require('baileys');
    let relayed;
    await sendGroupStatus({ user: { id: '123@s.whatsapp.net' },
        relayMessage: async (jid, message) => { relayed = message; }
    }, '123@g.us', { text: 'Hello group', backgroundColor: '#25D366', font: 1 });
    const decoded = real.proto.Message.decode(real.proto.Message.encode(relayed).finish());
    const inner = decoded.extendedTextMessage;
    assert.equal(inner.text, 'Hello group');
    assert.equal(inner.contextInfo.isGroupStatus, true);
});

for (const content of [{ text: 'Hello group', font: 1 }, { image: Buffer.from('image'), caption: 'Photo' },
    { video: Buffer.from('video'), mimetype: 'video/mp4' }, { audio: Buffer.from('audio'), mimetype: 'audio/mpeg', ptt: true }]) {
    test(`group status prepares ${Object.keys(content)[0]} before direct relay`, async () => {
        const real = require('baileys');
        let relay;
        const socket = { user: { id: '123@s.whatsapp.net' }, waUploadToServer() {},
            relayMessage: async (jid, message, options) => { relay = { jid, message, options }; } };
        const type = Object.keys(content)[0] === 'text' ? 'extendedTextMessage' : `${Object.keys(content)[0]}Message`;
        await sendGroupStatus(socket, '123@g.us', content, { baileys: { ...real,
            generateWAMessageContent: async (input, options) => {
                assert.equal(input.groupStatusMessage, undefined);
                assert.equal(options.upload, socket.waUploadToServer);
                return { [type]: { contextInfo: input.contextInfo || {} } };
            }
        } });
        const decoded = real.proto.Message.decode(real.proto.Message.encode(relay.message).finish());
        assert.equal(decoded.groupStatusMessageV2, null);
        assert.equal(decoded[type].contextInfo.isGroupStatus, true);
        assert.equal(decoded[type].contextInfo.statusSourceType, 4);
        assert.equal(decoded[type].contextInfo.statusAttributions[0].type, 10);
        assert.equal(decoded[type].contextInfo.statusAudienceMetadata.audienceType, 1);
        assert.equal(decoded[type].contextInfo.featureEligibilities.canReceiveMultiReact, true);
        assert.equal(relay.jid, '123@g.us');
        assert.match(relay.options.messageId, /^3EB0[A-F0-9]{32}$/);
    });
}

test('quoted media unwraps serialized audio and view-once media without mutating the quote', () => {
    const { quotedMedia } = require('./group-status');
    const audio = { mtype: 'audioMessage', msg: { mimetype: 'audio/ogg', ptt: true } };
    assert.equal(quotedMedia(audio).mime, 'audio/ogg');
    assert.equal(quotedMedia(audio).node.ptt, true);
    const image = { viewOnceMessageV2: { message: { imageMessage: { mimetype: 'image/jpeg' } } } };
    assert.equal(quotedMedia(image).mtype, 'imageMessage');
    assert.equal(image.viewOnceMessageV2.message.imageMessage.mtype, undefined);
});

test('real Baileys uploads and relays actual image, video and audio group statuses', async () => {
    const real = require('baileys');
    const { spawnSync } = require('child_process');
    const binary = require('@ffmpeg-installer/ffmpeg').path;
    const sound = spawnSync(binary, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=0.3', '-f', 'mp3', 'pipe:1']);
    const clip = spawnSync(binary, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=10:duration=0.3',
        '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-f', 'matroska', 'pipe:1']);
    assert.equal(sound.status, 0); assert.equal(clip.status, 0);
    const image = await require('sharp')({ create: { width: 16, height: 16, channels: 3, background: '#25D366' } }).jpeg().toBuffer();
    for (const content of [{ image }, { video: clip.stdout, jpegThumbnail: image }, { audio: sound.stdout, mimetype: 'audio/mpeg', ptt: false, seconds: 1 }]) {
        let uploads = 0, relayed;
        const type = `${Object.keys(content)[0]}Message`;
        await sendGroupStatus({ user: { id: '123@s.whatsapp.net' },
            waUploadToServer: async file => {
                assert.ok((await require('fs').promises.stat(file)).size > 0);
                uploads++;
                return { mediaUrl: 'https://example.test/media', directPath: '/media' };
            },
            relayMessage: async (jid, message) => { assert.equal(jid, '123@g.us'); relayed = message; }
        }, '123@g.us', content);
        assert.equal(uploads, 1);
        const decoded = real.proto.Message.decode(real.proto.Message.encode(relayed).finish());
        assert.equal(decoded[type].mediaKey.length, 32);
        assert.equal(decoded[type].contextInfo.isGroupStatus, true);
        assert.equal(decoded[type].directPath, '/media');
        assert.equal(decoded.groupStatusMessageV2, null);
    }
});

test('group status rejects oversized media before preparation or relay', async () => {
    const { MAX_MEDIA_BYTES } = require('./media-limits');
    await assert.rejects(sendGroupStatus({}, 'g@g.us', { image: Buffer.alloc(MAX_MEDIA_BYTES + 1) }, {
        baileys: { generateWAMessageContent: () => assert.fail('Oversized media was uploaded') }
    }), { code: 'MEDIA_TOO_LARGE' });
});