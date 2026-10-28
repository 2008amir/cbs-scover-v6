import { plugins } from '../../index.js'

let handler = async (m) => {
    const byCategory = {}
    const seen = new Set()
    const pushName = String(m.pushName || 'User').trim().replace(/[*_`~]/g, '') || 'User'

    for (const h of plugins.values()) {
        if (seen.has(h)) continue
        seen.add(h)

        if (h.silentDeny) continue
        const listed = h.menuCommands || h.command
        if (!listed || listed instanceof RegExp) continue

        const category = h.category || 'Other'
        if (!byCategory[category]) byCategory[category] = []

        const commands = (Array.isArray(listed) ? listed : [listed])
            .filter(Boolean)
            .map(command => `${global.prefix || ''}${command}`)

        if (commands.length) byCategory[category].push(...commands)
    }

    let text = `*${global.botName} — Menu*\n`
    text += `Hello, *${pushName}*\n`
    text += `Prefix: ${global.prefix || 'none'} | Mode: ${global.botMode}\n\n`

    for (const category of Object.keys(byCategory).sort()) {
        text += `*${category}*\n`

        const commands = [...new Set(byCategory[category])].sort()

        for (let index = 0; index < commands.length; index += 2) {
            text += `➤ ${commands.slice(index, index + 2).join('   |   ')}\n`
        }

        text += '\n'
    }

    await m.reply(text.trim())
}

handler.command = []

export default handler
