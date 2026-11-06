import fs from 'fs'
import path from 'path'

const OWNER_DB_PATH = path.join(process.cwd(), 'database', 'owner.json')

function readOwners() {
    try {
        return JSON.parse(fs.readFileSync(OWNER_DB_PATH, 'utf-8'))
    } catch {
        return []
    }
}

let handler = async (m, { CbsScover }) => {
    const owners = readOwners()
    const botNumber = CbsScover.decodeJid(CbsScover.user.id).split('@')[0]

    let text = `*Owner List*\n\n`
    text += `➤ ${botNumber} (primary)\n`

    if (owners.length) {
        for (const number of owners) {
            text += `➤ ${number}\n`
        }
    }

    text += `\n*Total:* ${owners.length + 1} owner(s)`

    await m.reply(text)
}

handler.command = ['owners']
handler.owner = true

export default handler
