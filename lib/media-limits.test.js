const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { collectStream, assertMediaSize } = require('./media-limits');
const { sendGroupStatus } = require('./group-status');

test('media over the size cap is refused instead of buffered', async () => {
    const stream = Readable.from([Buffer.alloc(600), Buffer.alloc(600)]);
    await assert.rejects(collectStream(stream, 1000), { code: 'MEDIA_TOO_LARGE' });
    assert.throws(() => assertMediaSize({ fileLength: 2000 }, 1000), { code: 'MEDIA_TOO_LARGE' });
    assert.equal((await collectStream(Readable.from([Buffer.alloc(300), Buffer.alloc(300)]), 1000)).length, 600);
});

test('group status media is relayed directly with status audience metadata', async () => {
    let relayed;
    const baileys = {
        generateWAMessageContent: async () => ({ imageMessage: { url: 'u' } }),
        generateWAMessageFromContent: (jid, message, { messageId }) => ({ key: { id: messageId }, message })
    };
    const sock = { user: { id: 'me@s.whatsapp.net' }, relayMessage: async (jid, message) => { relayed = message; } };
    await sendGroupStatus(sock, 'g@g.us', { image: Buffer.alloc(1) }, { baileys });
    assert.ok(relayed.imageMessage);
    assert.equal(relayed.groupStatusMessageV2, undefined);
    assert.equal(relayed.imageMessage.contextInfo.isGroupStatus, true);
    assert.equal(relayed.imageMessage.contextInfo.statusAudienceMetadata.audienceType, 1);
});

test('only one expensive media command holds the shared host allowance', () => {
    const { acquireMediaJob } = require('./media-limits');
    const release = acquireMediaJob();
    assert.throws(() => acquireMediaJob(), { code: 'MEDIA_BUSY' });
    release(); release();
    const next = acquireMediaJob();
    assert.throws(() => acquireMediaJob(), { code: 'MEDIA_BUSY' });
    next();
});

test('anti-delete never activates for statuses or channels', () => {
    const fs = require('node:fs');
    const src = fs.readFileSync(require('node:path').join(__dirname, '../index.js'), 'utf8');
    const start = src.indexOf('global.antiDeleteActiveFor = function');
    const fn = new Function('global', src.slice(start, src.indexOf('};', start) + 2));
    const g = { antiDeleteAllowedFor: () => true, antiDeleteGroupEnabled: () => true };
    fn(g);
    assert.equal(g.antiDeleteActiveFor('status@broadcast'), false);
    assert.equal(g.antiDeleteActiveFor('123@newsletter'), false);
    assert.equal(g.antiDeleteActiveFor('123@s.whatsapp.net'), true);
});
