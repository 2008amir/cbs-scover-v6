import fonts from '../../../lib/fonts.js'

let handler = async (m, { EliteProTech, args }) => {
    const prefix = global.prefix ?? '.'
    const name = args[0]
    const plainName = name?.toLowerCase()
    const action = args[1]?.toLowerCase()
    const reply = text => EliteProTech.sendMessage(m.chat, { text }, { quoted: m, fontPlain: true })
    const list = () => `*Fonts*\n\nStatus = ${fonts.activeFont(EliteProTech) ? 'activated' : 'deactivated'}\n\n${prefix}fonts <font name> activate\n\n${prefix}fonts deactivate\n\n${prefix}fonts <font name> <text>\n\n` +
        fonts.styles.map((style, index) => `${index + 1}. ${fonts.styleText(style.name, style.name)}`).join('\n\n')
    if (!name) return reply(list())
    if (['deactivate', 'diactivate', 'disable', 'off'].includes(plainName) || ['deactivate', 'diactivate'].includes(action)) {
        if (!m.fromMe) return reply('Only the linked WhatsApp account can deactivate its font.')
        fonts.setFont(null, fonts.accountId(EliteProTech))
        return reply('Font deactivated.')
    }
    const style = fonts.findStyle(name)
    if (!style) return reply(list())
    if (action === 'activate') {
        if (!m.fromMe) return reply('Only the linked WhatsApp account can activate its font. You can still convert text with the fonts command.')
        fonts.setFont(style.name, fonts.accountId(EliteProTech))
        return reply(`${fonts.styleText(style.name, style.name)} activated.\n${prefix}fonts deactivate`)
    }
    const text = args.slice(1).join(' ')
    if (!text) return reply(list())
    return reply(fonts.styleText(text.slice(0, 4000), style.name))
}

handler.command = ['fonts']
export default handler