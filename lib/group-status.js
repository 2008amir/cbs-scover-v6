const { randomBytes } = require('node:crypto');

// Match upstream ELITE-PRO-V2: status metadata belongs on the prepared content,
// not on a manually constructed FutureProofMessage envelope.
async function sendGroupStatus(sock, jid, content, { baileys = require('baileys') } = {}) {
    if (!String(jid).endsWith('@g.us')) throw new Error('Group status requires a group JID.');
    const { backgroundColor, font, ...payload } = content;
    for (const key of ['image', 'video', 'audio']) {
        if (Buffer.isBuffer(payload[key])) {
            require('./media-limits').assertMediaSize({ fileLength: payload[key].length });
            if (!payload[key].length) throw new Error('Quoted media is empty.');
        }
    }
    const inner = await baileys.generateWAMessageContent(payload, { upload: sock.waUploadToServer, backgroundColor,
        font: content.font, userJid: sock.user?.id, mediaUploadTimeoutMs: 120000 });
    const type = ['extendedTextMessage', 'imageMessage', 'videoMessage', 'audioMessage'].find(key => inner[key]);
    if (!type) throw new Error('Unable to prepare group status media.');
    inner[type].contextInfo = { ...inner[type].contextInfo,
        featureEligibilities: { ...inner[type].contextInfo?.featureEligibilities, canReceiveMultiReact: true },
        statusSourceType: 4, statusAttributions: [{ type: 10 }], isGroupStatus: true,
        statusAudienceMetadata: { audienceType: 1 }
    };
    if (type === 'extendedTextMessage') {
        if (backgroundColor !== undefined) {
            inner[type].backgroundArgb = typeof backgroundColor === 'number' ? backgroundColor
                : (0xff000000 + parseInt(String(backgroundColor).replace('#', ''), 16)) >>> 0;
        }
        Object.assign(inner[type], { textArgb: 0xffffffff, font: font || 5, previewType: 0, inviteLinkGroupTypeV2: 0 });
    }
    const messageId = `3EB0${randomBytes(16).toString('hex').toUpperCase()}`;
    const msg = baileys.generateWAMessageFromContent(jid, inner, { userJid: sock.user?.id, messageId });
    await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
    return msg;
}

// Find the real media inside a quoted message (view-once/ephemeral/document wrappers).
function quotedMedia(quoted) {
    let node = quoted?.msg || quoted;
    for (let i = 0; i < 4 && node; i++) {
        const wrapped = node.message || node.viewOnceMessageV2?.message || node.viewOnceMessage?.message
            || node.viewOnceMessageV2Extension?.message || node.ephemeralMessage?.message || node.documentWithCaptionMessage?.message;
        if (!wrapped) break;
        const key = Object.keys(wrapped).find(k => /Message$/.test(k));
        node = key ? { ...wrapped[key], mtype: key } : null;
    }
    const mtype = node?.mtype || quoted?.mtype || '';
    let mime = node?.mimetype || '';
    if (!mime && /image/i.test(mtype)) mime = 'image/jpeg';
    if (!mime && /video/i.test(mtype)) mime = 'video/mp4';
    if (!mime && /audio/i.test(mtype)) mime = 'audio/ogg; codecs=opus';
    return { node: node || quoted, mtype, mime };
}

module.exports = { sendGroupStatus, quotedMedia };
