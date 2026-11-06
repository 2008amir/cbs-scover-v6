let handler = async (m, { CbsScover }) => {
    const jid = CbsScover.decodeJid(CbsScover.user.id)
    const number = jid.split('@')[0]
    const name = CbsScover.user.name || global.ownerName || global.botName || 'Owner'

    const vcard = `BEGIN:VCARD\n`
        + `VERSION:3.0\n`
        + `FN:${name}\n`
        + `ORG:${global.botName || ''};\n`
        + `TEL;type=CELL;type=VOICE;waid=${number}:+${number}\n`
        + `END:VCARD`

    await CbsScover.sendMessage(m.chat, {
        contacts: {
            displayName: name,
            contacts: [{ vcard }]
        }
    }, { quoted: m })
}

handler.command = []

export default handler
