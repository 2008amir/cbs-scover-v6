/* ============================================================
   CBS-SCOVER-V2 bridge
   ------------------------------------------------------------
   The complete ELITE-PRO-V2 bot lives in this folder untouched.
   Instead of opening a second WhatsApp connection and a second
   HTTP server, this bridge runs the real V2 plugin engine inside
   the V1 process, on the V1 socket, so both versions live on one
   server.
   ============================================================ */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import handleMessage, { plugins, initPlugins, initEvents, wireEventDispatchers } from './index.js'
import { smsg, bind, decorateSocket } from './lib/myfunc.js'
import commandLayer from '../lib/v2/index.js'
import fonts from '../lib/fonts.js'
import errorReporting from '../lib/error-reporting.js'


const __dirname = path.dirname(fileURLToPath(import.meta.url))

/* Actual V1 handlers are authoritative; unique V2 aliases remain routable. */
const v1Commands = () => commandLayer.v1CommandNames()

let ready = false
let socket = null
let initialization = null


/* Keep V2 globals it depends on, without overwriting V1 branding. */
function ensureGlobals() {
    global.botMessage = global.botMessage || {
        owner: 'This feature is for the Owner only.',
        admin: 'This feature is for group Admins only.',
        group: 'This command can only be used in a group.',
        private: 'This command can only be used in a private chat.',
        isBotAdmin: 'I need to be an admin in this group to do that.'
    }
    global.stickerPack = global.stickerPack || {
        packname: global.packname || 'CBS-SCOVER',
        author: global.author || 'codebreakers'
    }
    global.botName = global.botName || global.botname || 'CBS-SCOVER'
    global.ownerName = global.ownerName || global.ownername || 'codebreakers'
    global.repo = global.repo || 'https://github.com/EliteProTech/ELITE-PRO-V2'
    /* V1 answers everyone, so V2 must not run in self mode. */
    global.botMode = 'public'
}

export async function init(sock) {
    ensureGlobals()
    if (sock && socket !== sock) {
        socket = sock
        decorateSocket(sock)
        fonts.attachFonts(sock)
        try { bind(sock) } catch {}
    }
    if (!ready) {
        if (!initialization) initialization = (async () => {
            await initPlugins()
            await initEvents()
            ready = true
        })().catch(error => { initialization = null; throw error })
        await initialization
    }
    if (socket) {
        try { wireEventDispatchers(socket) } catch {}
    }
}

export function commandNames({ excludeV1 = true } = {}) {
    const names = []
    for (const key of plugins.keys()) {
        if (typeof key !== 'string') continue
        if (excludeV1 && v1Commands().has(key)) continue
        names.push(key)
    }
    return names
}

export function owns(command) {
    const key = String(command || '').toLowerCase()
    if (!key) return false
    if (v1Commands().has(key)) return false
    return plugins.has(key)
}

/* Runs a V2 command (or the "$" shell custom prefix) on the V1 socket.
   Returns true when V2 handled the message. */
export async function handle(sock, m, { command, isCustomPrefix = false } = {}) {
    await init(sock)
    if (!isCustomPrefix && !owns(command)) return false

    let vm = m
    try {
        vm = (await smsg(sock, m)) || m
    } catch {}

    try {
        await handleMessage(sock, vm)
        return true
    } catch (e) {
        await errorReporting.reportError(sock, m, e, 'V2 command')
        return true
    }
}

export const V2_DIR = __dirname
export { plugins }
