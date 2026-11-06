let handler = async (m, { CbsScover }) => {
    const target = m.quoted?.sender || m.mentionedJid?.[0] || m.chat

    try {
        const image = await CbsScover.profilePictureUrl(target, 'image')
        await CbsScover.sendMessage(m.chat, {
            image: { url: image },
            caption: target.endsWith('@g.us') ? 'Group profile picture' : `Profile picture: @${target.split('@')[0]}`,
            mentions: target.endsWith('@g.us') ? [] : [target]
        }, { quoted: m })
    } catch {
        await m.reply('That profile picture is unavailable. The person may have no picture or their privacy settings block it.')
    }
}

handler.command = ['pp']

export default handler
