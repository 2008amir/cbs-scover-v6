let handler = async (CbsScover, { messages, type }) => {
    if (global.botname || type !== 'notify') return

    for (const raw of messages || []) {
        const chat = raw.key?.remoteJidAlt || raw.key?.remoteJid
        if (!chat || raw.key?.fromMe || chat === 'status@broadcast' || chat.endsWith('@newsletter')) continue

        if (global.autoRecordType) {
            await CbsScover.sendPresenceUpdate('recording', chat).catch(() => {})
            setTimeout(() => CbsScover.sendPresenceUpdate('composing', chat).catch(() => {}), 700)
        } else if (global.autoRecording) {
            await CbsScover.sendPresenceUpdate('recording', chat).catch(() => {})
        } else if (global.autoTyping) {
            await CbsScover.sendPresenceUpdate('composing', chat).catch(() => {})
        }
    }
}

handler.on = 'messages.upsert'

export default handler
