/* Menu listing only.
   V1 owns `pdf2docx`/`img2docx` routing in merged mode (bridge.owns()
   defers to V1 handlers), so this plugin must NOT declare handler.command —
   that would double-reply on the shared socket. menuCommands only makes
   the V2 menu list the commands while V1 keeps executing them.
   menuCategory supplies the display name without moving the plugin. */
let handler = async () => {}

handler.menuCommands = ['pdf2docx', 'img2docx']
handler.menuCategory = 'Convert'

export default handler
