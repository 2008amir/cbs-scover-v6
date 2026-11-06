let handler = async (m, { CbsScover }) => {
    const start = Date.now()
    const sent = await CbsScover.reply(m.chat, 'Speed test..', m)
    const latency = Date.now() - start
    await CbsScover.sendMessage(m.chat, {
        text: `Pong ${latency}ms`,
        edit: sent.key
    })
}
handler.command = ['speed']
export default handler
