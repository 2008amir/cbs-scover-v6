import { sendRichHtml } from '../../lib/richhtml.js'

/* The uploaded HTML fully replaces the card body, exactly like the piano
   plugin does with its own markup: same wrapper, same sizing, plain style. */
function buildCard(input) {
    const source = String(input || '').trim()
    const head = source.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] || ''
    const body = source.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1]
    const content = body === undefined
        ? source.replace(/<!doctype[^>]*>/gi, '').replace(/<\/?(?:html|head|body)[^>]*>/gi, '')
        : body

    const style = `<style>*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}html,body{margin:0;width:100%;background:#0d0c16;color:#fff;font-family:Arial}.card{width:100%;max-width:620px;min-height:518px;margin:auto;padding:22px;border-radius:22px;background:radial-gradient(circle at top right,#51458f,#171424 56%,#0d0c16);border:1px solid #7566c5;box-shadow:0 14px 38px #0009;overflow:auto}.card>*{max-width:100%}img,video,canvas,svg,iframe{max-width:100%!important;object-fit:contain}</style>`

    return `${style}${head}<div class="card">${content}</div>`
}

async function readQuotedHtml(m) {
    const text = m.quoted?.text?.trim()
    if (text && /<[^>]+>/.test(text)) return text

    const mime = String(m.quoted?.mimetype || m.quoted?.msg?.mimetype || '').toLowerCase()
    const fileName = String(m.quoted?.fileName || m.quoted?.msg?.fileName || '').toLowerCase()
    if (!m.quoted?.download || (!mime.includes('html') && !fileName.endsWith('.html') && !fileName.endsWith('.htm'))) return ''

    const file = await m.quoted.download()
    return Buffer.from(file || []).toString('utf8').trim()
}

let handler = async (m, { EliteProTech }) => {
    try {
        const uploadedHtml = await readQuotedHtml(m)
        if (!uploadedHtml) {
            return await m.reply(`Reply to an HTML file or a text message containing HTML.\n\nUsage: ${global.prefix || ''}sendhtml`)
        }

        await sendRichHtml(EliteProTech, m.chat, { id: 'cbs-scover-html', title: 'CBS-SCOVER', html: buildCard(uploadedHtml), source: 'cbsscover' })
    } catch (error) {
        await m.reply(`Unable to send HTML card: ${error.message || String(error)}`)
    }
}

handler.command = ['sendhtml', 'html']
handler.owner = true

export default handler
