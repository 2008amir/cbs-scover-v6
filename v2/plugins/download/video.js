/* Menu listing only.
   V1 owns `video`/`ytmp4` routing in merged mode (bridge.owns() defers to
   V1 handlers), so this plugin must NOT declare handler.command — that
   would double-reply on the shared socket. menuCommands only makes the
   V2 menu list the command while V1 keeps executing it. */
let handler = async () => {}

handler.menuCommands = ['video', 'ytmp4']
handler.category = 'Download'

export default handler
