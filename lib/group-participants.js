// Shared add/remove/promote/demote: targets the member's in-group address
// (PN or LID) and reads WhatsApp's per-member result instead of assuming success.
const digits = v => String(v || '').split('@')[0].split(':')[0].replace(/\D/g, '')

const REASONS = {
    '401': 'I am not allowed to do that (am I still an admin?)',
    '403': 'their privacy settings block being added; an invite link was sent to them',
    '404': 'that number is not on WhatsApp',
    '408': 'they left the group recently, so WhatsApp blocks re-adding for now',
    '409': 'nothing to change (already in that state)',
    '406': 'that person cannot be changed (group creator?)',
    '500': 'the group is full',
}

function findParticipant(participants, target) {
    const n = digits(target)
    return participants.find(p => [p.id, p.lid, p.jid, p.pn, p.phoneNumber].filter(Boolean)
        .some(v => v === target || (n && digits(v) === n)))
}

function collectTargets(m, text) {
    const out = [...(m.mentionedJid || [])]
    if (m.quoted?.sender) out.push(m.quoted.sender)
    for (const num of String(text || '').match(/\d{7,16}/g) || []) out.push(`${num}@s.whatsapp.net`)
    return [...new Set(out.filter(Boolean))]
}

async function updateMembers(sock, chat, rawTargets, action) {
    const meta = await sock.groupMetadata(chat)
    const participants = meta?.participants || []
    const results = []
    for (const raw of rawTargets) {
        const p = findParticipant(participants, raw)
        const label = digits(p?.phoneNumber || p?.pn || p?.jid || raw)
        if (action === 'add' && p) { results.push({ label, ok: false, reason: 'already in the group' }); continue }
        if (action !== 'add' && !p) { results.push({ label, ok: false, reason: 'not a member of this group' }); continue }
        const jid = action === 'add' ? `${digits(raw)}@s.whatsapp.net` : p.id
        try {
            const res = await sock.groupParticipantsUpdate(chat, [jid], action)
            const status = String(res?.[0]?.status || '200')
            if (status === '200') { results.push({ label, ok: true }); continue }
            if (status === '403' && action === 'add') {
                try {
                    const code = await sock.groupInviteCode(chat)
                    await sock.sendMessage(jid, { text: `You were invited to join *${meta.subject || 'a group'}*:\nhttps://chat.whatsapp.com/${code}` })
                } catch {}
            }
            results.push({ label, ok: false, reason: REASONS[status] || `WhatsApp refused (code ${status})` })
        } catch (e) {
            results.push({ label, ok: false, reason: e?.message || 'request failed' })
        }
    }
    return results
}

const VERB = { add: 'added', remove: 'removed', promote: 'promoted', demote: 'demoted' }
function formatResults(results, action) {
    return results.map(r => r.ok ? `✅ @${r.label} has been ${VERB[action]}.` : `❌ @${r.label} was not ${VERB[action]}: ${r.reason}.`).join('\n')
}

module.exports = { collectTargets, updateMembers, formatResults, findParticipant }
