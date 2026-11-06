import fonts from '../../../lib/fonts.js'

let handler = async (m, { CbsScover, args = [] }) => {
    const prefix = global.prefix ?? '.'
    const reply = text => CbsScover.sendMessage(m.chat, { text }, { quoted: m, fontPlain: true })
    const explicit = fonts.findStyle(args[0])
    const active = fonts.activeFont(CbsScover)
    const style = explicit || fonts.findStyle(active)
    if (!style) return reply(`Select a font to preview: ${prefix}fontpreview <font name> <sample text>`)
    const sample = (explicit ? args.slice(1) : args).join(' ') || 'Hello world! ABC abc 123'
    return reply(fonts.styleText(sample.slice(0, 4000), style.name))
}
handler.command = ['fontpreview']
export default handler