'use strict';

const test = require('node:test');
const assert = require('node:assert');
const maintenance = require('./maintenance');

test('bundled V1 starts in the current process without spawning a second bot', () => {
    const fs = require('node:fs');
    const vm = require('node:vm');
    const path = require('node:path');
    const source = fs.readFileSync(path.join(__dirname, 'v1/source.js'), 'utf8');
    const reachedConfig = new Error('configuration reached');
    let spawned = 0;
    assert.throws(() => vm.runInNewContext(`(function(){${source}\n})()`, {
        process: { argv: ['node', 'index.js'] },
        require(name) {
            if (name === 'child_process') return { spawn() { spawned++; throw new Error('duplicate startup'); } };
            if (name === './config') throw reachedConfig;
            return require(name);
        }
    }), error => error === reachedConfig);
    assert.equal(spawned, 0);
});

test('host diagnostics report actual memory and cgroup v2 limit', () => {
    const mb = 1024 * 1024;
    assert.equal(maintenance.resourceSummary({ usage: { rss: 200 * mb, heapUsed: 100 * mb, arrayBuffers: 20 * mb },
        heapLimit: 320 * mb, read: () => String(512 * mb) }),
        'rss=200MB heap=100/320MB buffers=20MB container=512MB');
});

test('host diagnostics handle cgroup v1 and unavailable limits', () => {
    const usage = { rss: 0, heapUsed: 0 };
    const mb = 1024 * 1024;
    assert.equal(maintenance.resourceSummary({ usage, heapLimit: 320 * mb,
        read: file => file.endsWith('memory.max') ? 'max' : String(1024 * mb) }),
        'rss=0MB heap=0/320MB buffers=0MB container=1024MB');
    assert.equal(maintenance.resourceSummary({ usage, heapLimit: 320 * mb,
        read: () => { throw new Error('unavailable'); } }),
        'rss=0MB heap=0/320MB buffers=0MB container=unknown');
});

test('chat archive drops the oldest chats past the cap and keeps the newest', () => {
    const archive = {};
    for (let i = 0; i < 5; i++) archive[`chat${i}@s.whatsapp.net`] = ['x'];
    const removed = maintenance.boundChatArchive(archive, 3);
    assert.equal(removed, 2);
    assert.deepEqual(Object.keys(archive), ['chat2@s.whatsapp.net', 'chat3@s.whatsapp.net', 'chat4@s.whatsapp.net']);
});

test('chat archive does nothing while under the cap', () => {
    const archive = { 'a@s.whatsapp.net': ['x'] };
    assert.equal(maintenance.boundChatArchive(archive, 150), 0);
    assert.deepEqual(Object.keys(archive), ['a@s.whatsapp.net']);
});

test('learned style and facts are capped per person count', () => {
    const style = {}, facts = {};
    for (let i = 0; i < 4; i++) {
        style[`s${i}`] = { msgs: i };
        facts[`f${i}`] = ['my name is test'];
    }
    const removed = maintenance.boundLearning(style, facts, 2);
    assert.equal(removed, 4);
    assert.deepEqual(Object.keys(style), ['s2', 's3']);
    assert.deepEqual(Object.keys(facts), ['f2', 'f3']);
});

test('antidelete retention is 24 hours for every private and group message', () => {
    assert.equal(maintenance.antideleteTtl('234900@s.whatsapp.net'), 24 * 60 * 60 * 1000);
    assert.equal(maintenance.antideleteTtl('12345-67890@g.us'), 24 * 60 * 60 * 1000);
    assert.equal(maintenance.antideleteTtl(''), 24 * 60 * 60 * 1000);
});

test('the connect chat list is bounded to the newest 300 chats', () => {
    const chats = {};
    for (let i = 0; i < 350; i++) chats[`c${i}@s.whatsapp.net`] = { id: `c${i}@s.whatsapp.net` };
    const bounded = maintenance.boundChatSet(chats);
    const keys = Object.keys(bounded);
    assert.equal(keys.length, 300);
    assert.equal(keys[0], 'c50@s.whatsapp.net');
    assert.equal(keys[299], 'c349@s.whatsapp.net');
});

test('startup storage trim removes duplicate packages and npm cache but keeps sessions and data', () => {
    const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trim-'));
    const mk = p => fs.mkdirSync(path.join(root, p), { recursive: true });
    mk('node_modules/@whiskeysockets/baileys'); mk('v2/node_modules/sharp'); mk('.npm/_cacache');
    mk('session'); fs.writeFileSync(path.join(root, 'session/creds.json'), '{}');
    mk('database'); fs.writeFileSync(path.join(root, 'database/owner.json'), '[]');
    maintenance.trimStartupStorage(root);
    assert.equal(fs.existsSync(path.join(root, 'v2/node_modules')), false);
    assert.equal(fs.existsSync(path.join(root, '.npm')), false);
    assert.equal(fs.existsSync(path.join(root, 'session/creds.json')), true);
    assert.equal(fs.existsSync(path.join(root, 'database/owner.json')), true);
    assert.equal(fs.existsSync(path.join(root, 'node_modules/@whiskeysockets/baileys')), true);
    fs.rmSync(root, { recursive: true, force: true });
});

test('startup storage trim keeps v2 packages when the shared root install is missing', () => {
    const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trim-'));
    fs.mkdirSync(path.join(root, 'v2/node_modules/sharp'), { recursive: true });
    maintenance.trimStartupStorage(root);
    assert.equal(fs.existsSync(path.join(root, 'v2/node_modules/sharp')), true);
    fs.rmSync(root, { recursive: true, force: true });
});

test('a package left half-installed is removed so the next npm install restores it', () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'heal-'));
    const pkg = path.join(root, 'node_modules', 'asynckit');
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, 'parallel.js'), "require('./lib/state.js')");
    fs.writeFileSync(path.join(root, 'node_modules', '.package-lock.json'), '{}');
    fs.mkdirSync(path.join(root, 'node_modules', 'axios'));
    let err;
    try { require(path.join(pkg, 'parallel.js')); } catch (e) { err = e; }
    assert.strictEqual(maintenance.repairBrokenPackage(err, root), pkg);
    assert.strictEqual(fs.existsSync(pkg), false);
    assert.strictEqual(fs.existsSync(path.join(root, 'node_modules', '.package-lock.json')), false);
    assert.strictEqual(fs.existsSync(path.join(root, 'node_modules', 'axios')), true);
    assert.strictEqual(maintenance.repairBrokenPackage(new Error('other'), root), null);
});
