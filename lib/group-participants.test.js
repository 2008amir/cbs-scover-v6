const test = require('node:test'); const assert = require('node:assert')
const gp = require('./group-participants')
const sock = (status, parts = []) => ({ calls: [], sent: [],
  async groupMetadata() { return { subject: 'G', participants: parts } },
  async groupParticipantsUpdate(c, j, a) { this.calls.push([j[0], a]); return [{ status }] },
  async groupInviteCode() { return 'CODE' }, async sendMessage(j, m) { this.sent.push([j, m]) } })
test('add privacy refusal is reported as failure and sends invite', async () => {
  const s = sock('403'); const r = await gp.updateMembers(s, 'g@g.us', ['234111@s.whatsapp.net'], 'add')
  assert.equal(r[0].ok, false); assert.match(s.sent[0][1].text, /chat\.whatsapp\.com\/CODE/)
})
test('promote targets the member LID address', async () => {
  const s = sock('200', [{ id: '999@lid', phoneNumber: '234111@s.whatsapp.net' }])
  const r = await gp.updateMembers(s, 'g@g.us', ['234111@s.whatsapp.net'], 'promote')
  assert.equal(r[0].ok, true); assert.deepEqual(s.calls[0], ['999@lid', 'promote'])
})
test('remove of non-member does not claim success', async () => {
  const r = await gp.updateMembers(sock('200'), 'g@g.us', ['234@s.whatsapp.net'], 'remove'); assert.equal(r[0].ok, false)
})
