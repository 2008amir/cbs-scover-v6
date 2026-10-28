let handler = async (m, { EliteProTech }) => {
    await EliteProTech.groupLeave(m.chat)
}

handler.command = ['leavegroup']
handler.group = true
handler.owner = true

export default handler
