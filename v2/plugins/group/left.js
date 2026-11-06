let handler = async (m, { CbsScover }) => {
    await CbsScover.groupLeave(m.chat)
}

handler.command = ['leavegroup']
handler.group = true
handler.owner = true

export default handler
