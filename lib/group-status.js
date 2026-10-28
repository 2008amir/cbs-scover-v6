const { randomBytes } = require('node:crypto');

// Prepare supported text/media first, then apply the group-story protocol envelope.
// Media stories need a shared messageSecret on both the inner and outer message,
// otherwise WhatsApp shows only text stories and silently drops photos/videos/audio.
async function sendGroupStatus(sock, jid, content, { baileys = require('baileys') } = {}) {
    if (!String(jid).endsWith('@g.us')) throw new Error('Group status requires a group JID.');
    const inner = await baileys.generateWAMessageContent({ ...content,
        contextInfo: { ...content.contextInfo, isGroupStatus: true }
    }, { upload: sock.waUploadToServer, backgroundColor: content.backgroundColor,
        font: content.font, userJid: sock.user?.id, mediaUploadTimeoutMs: 120000 });
    const messageSecret = randomBytes(32);
    inner.messageContextInfo = { ...inner.messageContextInfo, messageSecret };
    const messageId = `3EB0${randomBytes(16).toString('hex').toUpperCase()}`;
    const msg = baileys.generateWAMessageFromContent(jid,
        { messageContextInfo: { messageSecret }, groupStatusMessageV2: { message: inner } },
        { userJid: sock.user?.id, messageId });
    await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
    return msg;
}

// Find the real media inside a quoted message (view-once/ephemeral/document wrappers).
function quotedMedia(quoted) {
    let node = quoted;
    for (let i = 0; i < 4 && node; i++) {
        const wrapped = node.message || node.viewOnceMessageV2?.message || node.viewOnceMessage?.message
            || node.viewOnceMessageV2Extension?.message || node.ephemeralMessage?.message || node.documentWithCaptionMessage?.message;
        if (!wrapped) break;
        const key = Object.keys(wrapped).find(k => /Message$/.test(k));
        node = key ? Object.assign(wrapped[key], { mtype: key }) : null;
    }
    const mtype = node?.mtype || quoted?.mtype || '';
    let mime = node?.mimetype || '';
    if (!mime && /image/i.test(mtype)) mime = 'image/jpeg';
    if (!mime && /video/i.test(mtype)) mime = 'video/mp4';
    if (!mime && /audio/i.test(mtype)) mime = 'audio/ogg; codecs=opus';
    return { node: node || quoted, mtype, mime };
}

module.exports = { sendGroupStatus, quotedMedia };
