const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const owners = require('./owners');
const files = ['database/owner.json', 'lib/database/owner.json', 'database/owner-lids.json'].map(f => path.join(__dirname, '..', f));

test('added owner is recognised immediately, including via LID, and listed', async () => {
    const saved = files.map(f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } });
    try {
        const sock = { user: { id: '111@s.whatsapp.net' }, signalRepository: { lidMapping: {
            getLIDForPN: async () => '999888@lid', getPNForLID: async () => '2348000000001@s.whatsapp.net' } } };
        assert.equal(await owners.isOwner(sock, '2348000000001@s.whatsapp.net'), false);
        await owners.add(sock, '2348000000001');
        assert.ok(owners.list().includes('2348000000001'));
        assert.equal(await owners.isOwner(sock, '2348000000001@s.whatsapp.net'), true);
        assert.equal(owners.isOwnerSync(sock, '999888@lid'), true);
        owners.remove('2348000000001');
        assert.equal(await owners.isOwner(sock, '2348000000001@s.whatsapp.net'), false);
    } finally {
        files.forEach((f, i) => saved[i] == null ? fs.rmSync(f, { force: true }) : fs.writeFileSync(f, saved[i]));
    }
});

test('antideletegroup-public and -private are recognised commands', async () => {
    const v2 = require('./v2');
    assert.equal(await v2.isKnownCommand('antideletegroup-public'), true);
    assert.equal(await v2.isKnownCommand('antideletegroup-private'), true);
});
