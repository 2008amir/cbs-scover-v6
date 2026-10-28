const { randomBytes } = require('node:crypto');

// Prepare supported text/media first, then apply the group-story protocol envelope.
// Matches the published groupStatusMessageV2 implementation without changing Baileys.
async function sendGroupStatus(sock, jid, content, { baileys = require('baileys') } = {}) {
    if (!String(jid).endsWith('@g.us')) throw new Error('Group status requires a group JID.');
    const inner = await baileys.generateWAMessageContent({ ...content,
        contextInfo: { ...content.contextInfo, isGroupStatus: true }
    }, { upload: sock.waUploadToServer, backgroundColor: content.backgroundColor,
        font: content.font, userJid: sock.user?.id });
    const messageId = `3EB0${randomBytes(16).toString('hex').toUpperCase()}`;
    const msg = baileys.generateWAMessageFromContent(jid,
        { groupStatusMessageV2: { message: inner } }, { userJid: sock.user?.id, messageId });
    await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
    return msg;
}

module.exports = { sendGroupStatus };