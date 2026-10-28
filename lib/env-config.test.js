const test = require('node:test');
const assert = require('node:assert/strict');
const { readEnvKeys } = require('./keyserver');
const { imageGeminiKeys } = require('./keyserver');
const { voiceEnvironment } = require('./voicechanger/env');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { configureBotSettings } = require('./env-config');
const { v1CommandNames, menuCommands } = require('./v2');
// Command recognition imports V2 config; release its reload watcher in tests.
test.after(() => fs.unwatchFile(path.join(__dirname, '..', 'v2', 'config.js')));

function withBotSettings(callback) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-command-check-'));
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, JSON.stringify({ prefix: '.', autoViewStatus: false, autoLikeStatus: false }));
    const target = {};
    configureBotSettings(target, file);
    try { return callback(target, file); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

async function runV1Setting(command, text, target, isCreator = true) {
    const source = fs.readFileSync(path.join(__dirname, 'v1', 'commands.js'), 'utf8');
    const start = source.indexOf(`case '${command}':`);
    assert.ok(start >= 0);
    const end = source.indexOf('\nbreak', start);
    const code = source.slice(start, end);
    const context = vm.createContext({ global: target, reply: value => value, isCreator,
        mess: { owner: 'owner only' }, args: text ? text.split(/\s+/) : [], text, q: text, command, prefix: target.prefix });
    return vm.runInContext(`(async () => { switch (command) { ${code}\n } })()`, context);
}

test('setprefix changes the shared prefix and persists across restart', async () => {
    let target, file, dir;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-prefix-'));
    file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, '{"prefix":"."}');
    target = {}; configureBotSettings(target, file);
    try {
        await runV1Setting('setprefix', '!', target);
        assert.equal(target.prefix, '!');
        const restarted = {}; configureBotSettings(restarted, file);
        assert.equal(restarted.prefix, '!');
        await runV1Setting('setprefix', 'none', target);
        assert.equal(target.prefix, '');
        await runV1Setting('setprefix', '#', target, false);
        assert.equal(target.prefix, '');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('reactions require the current prefix and an exact registered V1 or V2 command', async () => {
    const layer = require('./v2');
    assert.equal(layer.parseCommand('.ping', '!'), null);
    assert.equal(layer.parseCommand('! ping', '!'), null);
    assert.equal(layer.parseCommand('!', '!'), null);
    assert.equal(layer.parseCommand('ping', '!'), null);
    assert.equal(layer.parseCommand('!!PING\targument', '!!').command, 'ping');
    assert.equal(layer.parseCommand('ping argument', '').command, 'ping');
    assert.equal(await layer.isKnownCommand('ping'), true);
    assert.equal(await layer.isKnownCommand('notarealcommand'), false);
    assert.equal(await layer.isKnownCommand('pingextra'), false);
    require('child_process').execFileSync(process.execPath, ['-e', `
        const layer = require('./lib/v2');
        layer.init({ user: { id: 'recognition-test@s.whatsapp.net' }, ev: { on() {} } })
            .then(async () => { require('node:assert/strict').equal(await layer.isKnownCommand('calc'), true); process.exit(0); })
            .catch(() => process.exit(1));
    `], { cwd: path.join(__dirname, '..'), timeout: 20000, stdio: 'pipe' });
});

function commandHarness(prefix = '.') {
    const source = fs.readFileSync(path.join(__dirname, '..', 'ElitePro.js'), 'utf8');
    const start = source.indexOf('/* ---------- Command reactions ----------');
    const sent = [];
    const calls = [];
    const layer = require('./v2');
    const context = vm.createContext({
        module: { exports: {} }, console, global: { prefix }, errorReporting: require('./error-reporting'),
        v2: { ...layer, init: async () => {},
            parseCommand: body => layer.parseCommand(body, prefix),
            isKnownCommand: async command => command === 'calc' || await layer.isKnownCommand(command) },
        rememberViewOnce() {}, isBotPublic: () => true, isOwnerSender: () => false,
        menuButtons: { handleMenuButtonReply: async () => false },
        handleAiVoice: async () => false, voiceChanger: { handleVoiceNote: async () => false },
        handleExtraCommands: async (sock, m) => {
            if (layer.parseCommand(m.text, prefix)?.command !== 'calc') return false;
            calls.push('calc'); await sock.sendMessage(m.chat, { text: '2' }); return true;
        },
        cachedHandler: async (sock, m) => {
            calls.push('ping'); await sock.sendMessage(m.chat, { text: 'pong' });
        }
    });
    vm.runInContext(source.slice(start), context);
    const socket = { user: { id: `dispatch-${prefix}@s.whatsapp.net` },
        sendMessage: async (chat, content) => { sent.push({ chat, ...content }); } };
    const message = (id, text, chat = 'command-test@s.whatsapp.net') => ({
        chat, text, sender: chat, key: { id, remoteJid: chat, fromMe: false },
        message: { conversation: text }
    });
    return { handler: context.module.exports, socket, message, sent, calls, context };
}

test('unknown prefixed words produce zero reactions and zero answers through the command handler', async () => {
    const h = commandHarness('!');
    for (const [id, text] of [['unknown-1', '!notarealcommand'], ['unknown-2', '!pingextra'], ['unknown-3', '!']]) {
        await h.handler(h.socket, h.message(id, text));
    }
    assert.equal(h.sent.length, 0);
    assert.equal(h.calls.length, 0);
    await h.handler(h.socket, h.message('known-1', '!ping'));
    assert.equal(h.sent.filter(item => item.react).length, 1);
    assert.equal(h.sent.filter(item => item.text === 'pong').length, 1);
});

test('one V1 or V2 command message executes once despite concurrent redelivery and reconnect', async () => {
    const h = commandHarness('#');
    for (const command of ['ping', 'calc']) {
        const message = h.message(`once-${command}`, `#${command}`);
        await Promise.all([h.handler(h.socket, message), h.handler(h.socket, { ...message })]);
        await h.handler({ ...h.socket, user: { id: 'dispatch-#:7@s.whatsapp.net' } }, message);
        assert.equal(h.calls.filter(value => value === command).length, 1);
    }
    assert.equal(h.sent.filter(item => item.text).length, 2);
    // The same message redelivered under its LID address does not run again.
    await h.handler(h.socket, h.message('once-ping', '#ping', '123456789@lid'));
    assert.equal(h.calls.filter(value => value === 'ping').length, 1);
    // A second intentional command still runs.
    await h.handler(h.socket, h.message('next-ping', '#ping'));
    assert.equal(h.calls.filter(value => value === 'ping').length, 2);
});

test('inner option words and disabled commands are not treated as commands', async () => {
    const layer = require('./v2');
    for (const word of ['here', 'disable', 'second', 'minute', 'hour', 'jam', 'hari', 'detik', 'menit', 'panel']) {
        assert.equal(await layer.isKnownCommand(word), false, word);
    }
    for (const word of ['welcome', 'opentime', 'closetime', 'ping', 'play', 'all']) {
        assert.equal(layer.v1CommandNames().has(word), true, word);
    }
});

test('a reply or reaction from another bot on the same number is detected and warned once', async () => {
    const layer = require('./v2');
    const warnings = [];
    const sock = { user: { id: 'owner:3@s.whatsapp.net' },
        sendMessage: async (jid, content) => { warnings.push({ jid, ...content }); return { key: { id: 'OWN-' + warnings.length } }; } };
    const chat = 'friend@s.whatsapp.net';
    const command = { key: { id: 'CMD-1', remoteJid: chat, fromMe: false }, message: { conversation: '.unknownword' } };
    assert.equal(await layer.watchForOtherBot(sock, command, 1000), false);
    const ownReply = await sock.sendMessage(chat, { text: 'mine' });
    warnings.length = 0;
    assert.equal(await layer.watchForOtherBot(sock, { key: { id: ownReply.key.id, remoteJid: chat, fromMe: true },
        message: { extendedTextMessage: { text: 'mine', contextInfo: { stanzaId: 'CMD-1' } } } }, 1100), false);
    const foreign = { key: { id: '3EB0FOREIGN', remoteJid: chat, fromMe: true },
        message: { reactionMessage: { text: '⚡', key: { id: 'CMD-1' } } } };
    assert.equal(await layer.watchForOtherBot(sock, foreign, 1200), true);
    assert.equal(await layer.watchForOtherBot(sock, { ...foreign, key: { ...foreign.key, id: '3EB0FOREIGN2' } }, 1300), true);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].jid, 'owner@s.whatsapp.net');
});

test('automatic chat and channel reactions do not react to any prefixed command input', async () => {
    const source = fs.readFileSync(path.join(__dirname, 'v1/source.js'), 'utf8');
    const chatCode = source.slice(source.indexOf('async function handleAutoReact('), source.indexOf('//CHATBOT CODES//'));
    const channelCode = source.slice(source.indexOf('const CHANNEL_ID ='), source.indexOf('//ANTIDELETE CODES//'));
    const sent = [];
    const state = { autoreact: true, prefix: '.' };
    const context = vm.createContext({ global: state, console: { log() {}, error() {} }, emojis: ['❤️'],
        require: name => { assert.equal(name, './lib/v2'); return require('./v2'); } });
    vm.runInContext(chatCode + channelCode, context);
    const socket = { sendMessage: async (chat, content) => sent.push(content), newsletterReactMessage: async () => sent.push('channel') };
    const message = text => ({ key: { id: 'auto-react-test', remoteJid: '120363287352245413@newsletter', server_id: 1 }, message: { conversation: text } });
    for (const text of ['.notarealcommand', '.ping', '.calc']) {
        await context.handleAutoReact(socket, message(text));
        await context.handleChannelReact(socket, message(text));
    }
    assert.equal(sent.length, 0);
    await context.handleAutoReact(socket, message('hello'));
    assert.equal(sent.length, 1);
    state.prefix = '!';
    await context.handleAutoReact(socket, message('!notarealcommand'));
    assert.equal(sent.length, 1);
});

test('chatbot command has one dispatcher and archive listeners never execute commands', async () => {
    const h = commandHarness('%');
    h.context.global.chatbotCommand = async (socket, message) => {
        await socket.sendMessage(message.chat, { text: 'chatbot status' }); return true;
    };
    await h.handler(h.socket, h.message('chatbot-once', '%chatbot'));
    await h.handler(h.socket, h.message('chatbot-once', '%chatbot'));
    assert.equal(h.sent.filter(item => item.text).length, 1);
    assert.equal(h.calls.length, 0);

    const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    const start = source.indexOf('const seenSide =');
    const end = source.indexOf('const sideChannelSockets =', start);
    let controls = 0, logged = 0;
    const context = vm.createContext({ global: { prefix: '%', chatbotCommand: async () => { controls++; },
        logChatMessage: () => logged++ }, console, extractText: m => m.message.conversation });
    vm.runInContext(source.slice(start, end), context);
    await context.global.chatbotSideChannel(h.socket, h.message('side-command', '%chatbot'));
    await context.global.chatbotSideChannel(h.socket, h.message('side-text', 'hello'));
    assert.equal(controls, 0);
    assert.equal(logged, 1);
});

test('autoviewstatus on/off updates the state consumed by V1 and V2', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-status-'));
    const file = path.join(dir, 'settings.json'); fs.writeFileSync(file, '{}');
    const target = {}; configureBotSettings(target, file);
    try {
        await runV1Setting('autoviewstatus', 'on', target);
        assert.equal(target.autoViewStatus, true);
        assert.equal(target.autoviewstatus, true);
        assert.equal(JSON.parse(fs.readFileSync(file)).autoViewStatus, true);
        await runV1Setting('autoviewstatus', 'off', target);
        assert.equal(target.autoViewStatus, false);
        assert.equal(target.autoviewstatus, false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('V2 aliases update the same automation state as V1', () => withBotSettings(target => {
    target.autoViewStatus = true; assert.equal(target.autoviewstatus, true);
    target.autoLikeStatus = true; assert.equal(target.autolikestatus, true);
    target.autoread = true; assert.equal(target.autoRead, true);
    target.autoRecordType = true; assert.equal(target.autorecordtype, true);
}));

test('all V2 declarations exclude V1 duplicates and unique aliases stay in the menu', () => {
    const v1 = v1CommandNames();
    const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
        entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
    for (const file of walk(path.join(__dirname, '..', 'v2', 'plugins')).filter(file => file.endsWith('.js'))) {
        const source = fs.readFileSync(file, 'utf8');
        for (const match of source.matchAll(/handler\.command\s*=\s*\[([^\]]*)\]/g)) {
            for (const name of match[1].matchAll(/['"]([^'"]+)['"]/g)) assert.equal(v1.has(name[1]), false, `${file}: ${name[1]}`);
        }
    }
    const menu = require('./v2').menuGroups();
    const commands = Object.values(menu).flat().map(value => value.toLowerCase());
    for (const alias of ['avs', 'autolike', 'pp', 'open', 'close', 'tttfun']) assert.ok(commands.includes(alias), alias);
    assert.ok(menuCommands().length > 0);
});

test('status watcher reads an enabled status once and stops when switched off', async () => {
    const source = fs.readFileSync(path.join(__dirname, 'v1', 'source.js'), 'utf8');
    const start = source.indexOf('const processedStatusMessages =');
    const end = source.indexOf('//ANTISTATUS GROUP WATCHER//', start);
    const state = { autoViewStatus: true, autoLikeStatus: false };
    const context = vm.createContext({ global: state, console, Date, Map });
    vm.runInContext(source.slice(start, end), context);
    const read = [];
    const socket = { decodeJid: value => value, readMessages: async keys => read.push(...keys) };
    const message = { key: { id: 'status-one', remoteJid: 'status@broadcast', participant: '123@lid', participantAlt: '456@s.whatsapp.net' }, message: { conversation: 'test' } };
    await context.handleStatusWatcher(socket, message);
    await context.handleStatusWatcher(socket, message);
    assert.equal(read.length, 1);
    assert.equal(read[0].participant, '456@s.whatsapp.net');
    state.autoViewStatus = false;
    await context.handleStatusWatcher(socket, { ...message, key: { ...message.key, id: 'status-two' } });
    assert.equal(read.length, 1);
});

test('V2 loads every declared unique command, retains the shared prefix, and wires each socket once', () => {
    const { execFileSync } = require('child_process');
    const script = `
        const assert = require('node:assert/strict');
        global.botname = 'CBS-SCOVER'; global.prefix = '!';
        import('./v2/bridge.js').then(async bridge => {
            const counts = [];
            const socket = () => {
                const events = new Map(); counts.push(events);
                return { user: { id: '123@s.whatsapp.net' }, ev: { on(name) { events.set(name, (events.get(name) || 0) + 1); } } };
            };
            const first = socket();
            await Promise.all([bridge.init(first), bridge.init(first)]);
            await bridge.init(first); await bridge.init(socket());
            assert.equal(global.prefix, '!');
            for (const events of counts) assert.equal(events.get('messages.upsert'), 1);
            const declared = Object.values(require('./lib/v2').menuGroups()).flat().map(name => name.toLowerCase()).filter(name => !name.startsWith('shell'));
            const v1 = require('./lib/v2').v1CommandNames();
            for (const name of declared) assert.equal(bridge.owns(name), !v1.has(name), name);
            for (const name of ['autoviewstatus', 'setprefix', 'ping', 'menu']) assert.equal(bridge.owns(name), false, name);
            process.exit(0);
        }).catch(error => { console.error(error); process.exit(1); });`;
    execFileSync(process.execPath, ['-e', script], { cwd: path.join(__dirname, '..'), timeout: 20000, stdio: 'pipe' });
});

test('image pool reads five dedicated slots and never borrows chat or video keys', () => {
    const env = { GEMINI_API_KEY: 'test-chat', GEMINI_youtube_KEY: 'test-video' };
    for (let i = 1; i <= 5; i++) env[`IMAGE_GEMINI_KEY_${i}`] = `test-image-${i}`;
    const keys = readEnvKeys(env);
    assert.deepEqual(keys.imageGeminiKeys, [1, 2, 3, 4, 5].map(i => `test-image-${i}`));
    assert.deepEqual(keys.geminiKeys, ['test-chat']);
    assert.deepEqual(keys.videoGeminiKeys, ['test-video']);
});

test('image pool accepts bare, hyphen and short slot names', () => {
    const keys = readEnvKeys({
        IMAGE_GEMINI_KEY: 'test-image-1',
        'IMAGE-GEMINI-KEY-2': 'test-image-2',
        IMAGE_GEMINI_3: 'test-image-3'
    });
    assert.deepEqual(keys.imageGeminiKeys, ['test-image-1', 'test-image-2', 'test-image-3']);
});

test('imageGeminiKeys() serves the dedicated pool from the environment', async () => {
    const saved = { ...process.env };
    for (const name of Object.keys(process.env)) if (/^IMAGE_GEMINI/i.test(name)) delete process.env[name];
    process.env.IMAGE_GEMINI_KEY_1 = 'test-live-image';
    try {
        assert.deepEqual(await imageGeminiKeys(), ['test-live-image']);
    } finally {
        for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
        Object.assign(process.env, saved);
    }
});

test('missing image keys leave the pool empty without borrowing chat keys', () => {
    const keys = readEnvKeys({ GEMINI_API_KEY: 'test-chat' });
    assert.deepEqual(keys.imageGeminiKeys, []);
});

test('chat reads the five requested slots only', () => {
    const env = { GEMINI_API_KEY: 'test-chat-1', GEMINI_youtube_KEY: 'test-video' };
    for (let i = 2; i <= 5; i++) env[`GEMINI_KEY_${i}`] = `test-chat-${i}`;
    env.GEMINI_KEY_6 = 'test-outside';
    assert.deepEqual(readEnvKeys(env).geminiKeys, [1, 2, 3, 4, 5].map(i => `test-chat-${i}`));
});

test('video reads five dedicated slots and YouTube uses its own key', () => {
    const env = { GEMINI_youtube_KEY: 'test-video-1', YOUTUBE_API_KEY: 'test-search' };
    for (let i = 2; i <= 5; i++) env[`GEMINI_youtube_KEY_${i}`] = `test-video-${i}`;
    const keys = readEnvKeys(env);
    assert.deepEqual(keys.videoGeminiKeys, [1, 2, 3, 4, 5].map(i => `test-video-${i}`));
    assert.deepEqual(keys.youtubeKeys, ['test-search']);
});

test('hyphenated and legacy uppercase video names are accepted', () => {
    assert.deepEqual(readEnvKeys({ 'GEMINI_youtube_KEY-5': 'test-five', GEMINI_YOUTUBE_KEY_2: 'test-two' }).videoGeminiKeys,
        ['test-two', 'test-five']);
});

test('missing video keys never borrow chat or old dedicated keys', () => {
    const keys = readEnvKeys({ GEMINI_API_KEY: 'test-chat', VIDEO_KNOWLEDGE_GEMINI_API_KEY: 'test-old' });
    assert.deepEqual(keys.videoGeminiKeys, []);
    assert.equal(keys.videoGeminiKey, null);
    assert.equal(keys.youtubeKey, null);
});

test('blank and duplicate keys are ignored', () => {
    assert.deepEqual(readEnvKeys({ GEMINI_API_KEY: ' test-chat ', GEMINI_KEY_2: 'test-chat', GEMINI_KEY_3: ' ' }).geminiKeys,
        ['test-chat']);
});

test('HF token aliases are trimmed and primary takes precedence', () => {
    assert.equal(voiceEnvironment({ HF_TOKEN: ' test-primary ', HUGGINGFACE_TOKEN: 'test-fallback' }).HF_TOKEN, 'test-primary');
    assert.equal(voiceEnvironment({ HF_TOKEN: ' ', HUGGINGFACE_TOKEN: ' test-fallback ' }).HF_TOKEN, 'test-fallback');
});

test('Space URLs normalize and invalid numbers use safe defaults', () => {
    const config = voiceEnvironment({ HF_SPACE: ' https://huggingface.co/spaces/Plachta/Seed-VC/ ',
        VC_CHUNK_SECONDS: 'oops', VC_DIFFUSION_STEPS: '-1', VC_TIMEOUT_MS: 'Infinity' });
    assert.equal(config.HF_SPACE, 'Plachta/Seed-VC');
    assert.equal(config.CHUNK_SECONDS, 45);
    assert.equal(config.DIFFUSION_STEPS, 50);
    assert.equal(config.REQUEST_TIMEOUT_MS, 240000);
});

test('uppercase video slots 1 through 5 load all keys without using chat keys', () => {
    const env = { GEMINI_API_KEY: 'chat-only' };
    for (let i = 1; i <= 5; i++) env[`GEMINI_YOUTUBE_KEY_${i}`] = `video-${i}`;
    assert.deepEqual(readEnvKeys(env).videoGeminiKeys, ['video-1', 'video-2', 'video-3', 'video-4', 'video-5']);
});

test('chat first-slot aliases respect explicit dedicated configuration', () => {
    assert.deepEqual(readEnvKeys({ GEMINI_KEY_1: 'chat-one', GOOGLE_API_KEY: 'fallback' }).geminiKeys, ['chat-one']);
    assert.deepEqual(readEnvKeys({ GOOGLE_API_KEY: 'fallback' }).geminiKeys, ['fallback']);
});

test('Gemini rejected keys are tried once, not retried across models', async () => {
    const { requestGemini } = require('./keyserver');
    let calls = 0;
    await assert.rejects(requestGemini({}, { keys: ['one', 'two'], models: ['first', 'second'], http: { post: async () => {
        calls++; return { status: 401, data: { error: { message: 'API key not valid' } } };
    } } }), { code: 'KEY_INVALID' });
    assert.equal(calls, 2);
});

test('Gemini missing model moves to fallback without testing every credential', async () => {
    const { requestGemini } = require('./keyserver');
    const calls = [];
    const text = await requestGemini({}, { keys: ['one', 'two'], models: ['missing', 'available'], http: { post: async url => {
        calls.push(url);
        return url.includes('/missing:') ? { status: 404 } : { status: 200, data: { candidates: [{ content: { parts: [{ text: 'answer' }] } }] } };
    } } });
    assert.equal(text, 'answer');
    assert.equal(calls.length, 2);
});

test('Gemini classifies new key policies without returning secret details', () => {
    const { geminiFailure } = require('./keyserver');
    assert.equal(geminiFailure(403, { error: { message: 'Unrestricted standard keys rejected' } }), 'KEY_UNRESTRICTED');
    assert.equal(geminiFailure(403, { error: { message: 'Key reported as leaked' } }), 'KEY_LEAKED');
    assert.equal(geminiFailure(403, { error: { message: 'Dormant key blocked' } }), 'KEY_BLOCKED');
    assert.equal(geminiFailure(429, {}), 'QUOTA');
});

test('Gemini network failures never expose Axios credential details', async () => {
    const { requestGemini } = require('./keyserver');
    await assert.rejects(requestGemini({}, { keys: ['secret-value'], models: ['model'], http: { post: async () => { throw new Error('secret-value'); } } }),
        error => error.code === 'UNAVAILABLE' && !error.message.includes('secret-value'));
});

test('Hugging Face structured access errors and generic failures are sanitized', () => {
    const { friendlyError } = require('./voicechanger');
    for (const status of [401, 403]) {
        const result = friendlyError({ response: { status }, message: 'secret-value' }, '.');
        assert.match(result, /HF_TOKEN/);
        assert.equal(result.includes('secret-value'), false);
    }
    assert.equal(friendlyError({ message: 'secret-value' }, '.').includes('secret-value'), false);
    assert.match(friendlyError({ status: 429 }, '.'), /quota/);
});

test('V1 gemini uses the dedicated shared request implementation', async () => {
    const source = fs.readFileSync(path.join(__dirname, 'v1', 'commands.js'), 'utf8');
    const start = source.indexOf("case 'gemini':");
    const end = source.indexOf("case 'aio':", start);
    const replies = [];
    let request;
    const context = vm.createContext({ text: 'Hello', process: { env: {} }, command: 'gemini',
        reply: async value => replies.push(value), m: { chat: 'test', key: {} },
        EliteProTech: { sendMessage: async () => {} },
        require: name => { assert.equal(name, './lib/keyserver'); return {
            geminiKeys: async () => ['chat-only'], requestGemini: async (body, options) => { request = { body, options }; return 'Hi'; }
        }; }
    });
    await vm.runInContext(`(async () => { switch(command) { ${source.slice(start, end)} } })()`, context);
    assert.deepEqual(replies, ['Hi']);
    assert.equal(request.options.keys[0], 'chat-only');
    assert.equal(request.body.contents[0].parts[0].text, 'Hello');
});

function chatbotHarness() {
    const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    const requests = [], sent = [];
    const state = { chatArchive: {}, chatFacts: {}, chatBuffers: {}, prefix: '.',
        logChatMessage(chat, who, text) {
            (this.chatArchive[chat] ||= []).push(`${who}: ${text}`);
        } };
    const context = vm.createContext({ global: state, process: { env: {} }, console,
        keyServer: { geminiKeys: async () => ['test-only'], requestGemini: async body => {
            requests.push(body);
            return '200 pages — how far have you read?';
        }, chatModels: () => ['test'] }, GEMINI_MODELS: ['test'], CONFIGURED_LOCATION: '',
        learnStyle() {}, rememberFacts() {}, chatbotName: () => 'Test bot',
        chatbotMode: () => context.mode || 'normal', chatbotGender: () => 'male',
        personaBlock: mode => mode, learnPersona: async () => '', genderBlock: () => '',
        pauseThenType: async () => {}, humanOnlyRequest: () => false });
    state.buildChatbotPrompt = (history, name, sender, chat, persona, opts) =>
        `${persona}\n${'Personality instructions. '.repeat(900)}\n${history}\n${opts.latest}`;
    vm.runInContext(source.slice(source.indexOf('function stripLocationData('), source.indexOf('function extractText(')), context);
    vm.runInContext(source.slice(source.indexOf('async function generateAndSend('), source.indexOf('/* ---- human-only requests')), context);
    const socket = { sendMessage: async (chat, content) => { sent.push({ chat, ...content }); } };
    return { context, state, requests, sent, socket, source };
}

for (const mode of ['normal', 'friend', 'love', 'lovestart']) {
    test(`${mode} remembers its book-page question when the user answers 200 after cache expiry`, async () => {
        const h = chatbotHarness(); h.context.mode = mode;
        const chat = 'reader@s.whatsapp.net';
        h.state.chatArchive[chat] = ['Them: I am reading a book.', 'You: How many pages are in this book?', 'Them: 200'];
        await h.context.generateAndSend(h.socket, chat, chat, { pushName: 'Reader' }, ['200'], [], [], false);
        const body = h.requests[0];
        assert.equal(body.systemInstruction.parts[0].text.length, 12000);
        assert.deepEqual(Array.from(body.contents, turn => [turn.role, turn.parts[0].text]), [
            ['user', 'I am reading a book.'], ['model', 'How many pages are in this book?'], ['user', '200']
        ]);
        assert.equal(h.sent[0].text, '200 pages — how far have you read?');
        assert.equal(h.state.chatArchive[chat].at(-1), 'You: 200 pages — how far have you read?');
    });
}

test('chatbot group histories are isolated by chat and participant, and request history stays bounded', async () => {
    const h = chatbotHarness();
    h.state.userChats = {
        'first@g.us|reader': ['Bot: How many pages are in this book?'],
        'second@g.us|reader': ['Bot: When is your exam?']
    };
    await h.context.generateAndSend(h.socket, 'first@g.us', 'reader', {}, ['200'], [], [], false);
    assert.equal(h.requests[0].contents[0].parts[0].text, 'How many pages are in this book?');
    assert.equal(h.requests[0].contents.some(turn => turn.parts[0].text.includes('exam')), false);
    const turns = h.context.conversationTurns(Array.from({ length: 100 }, (_, i) => `Bot: ${i} ${'x'.repeat(1000)}`).join('\n'));
    assert.ok(turns.length <= 20);
    assert.ok(turns.reduce((sum, turn) => sum + turn.parts[0].text.length, 0) <= 6000);
    assert.ok(turns.at(-1).parts[0].text.startsWith('99 '));
});

test('unsent chatbot replies are never remembered as questions the user received', async () => {
    const h = chatbotHarness();
    await assert.rejects(h.context.generateAndSend({ sendMessage: async () => { throw new Error('delivery failed'); } },
        'reader', 'reader', {}, ['200'], [], [], false));
    assert.equal(h.state.chatArchive.reader.some(line => line.startsWith('You:')), false);
    assert.equal(h.state.userChats['reader|reader'].some(line => line.startsWith('Bot:')), false);
});

test('a follow-up waits for the previous bot reply before generating, then its buffer is released', async () => {
    const h = chatbotHarness();
    const timers = new Map(); let next = 0, release, active = 0, peak = 0;
    h.context.setTimeout = fn => { timers.set(++next, fn); return next; };
    h.context.clearTimeout = id => timers.delete(id);
    h.context.hookSideChannel = () => {};
    h.context.readJsonSafe = () => ({ dm: true });
    h.context.path = path; h.context.__dirname = path.join(__dirname, '..');
    h.context.extractText = m => m.message.conversation;
    h.context.voiceNode = h.context.imageNode = h.context.videoNode = () => null;
    h.context.reportChatbotError = async () => assert.fail('unexpected chatbot error');
    h.state.startVideoKnowledgeScheduler = () => {};
    h.state.chatbotSideChannel = async () => false;
    h.state.observeUser = () => {};
    let calls = 0;
    h.context.keyServer.requestGemini = async body => {
        active++; peak = Math.max(peak, active); h.requests.push(body);
        if (++calls === 1) await new Promise(resolve => { release = resolve; });
        active--;
        return calls === 1 ? 'How many pages are in this book?' : '200 pages — how far have you read?';
    };
    const start = h.source.indexOf('global.humanChatbot =');
    vm.runInContext(h.source.slice(start, h.source.indexOf('/* =====================================================================', start)), h.context);
    const message = text => ({ key: { remoteJid: 'reader', fromMe: false }, message: { conversation: text } });
    const runTimer = () => { const [id, fn] = timers.entries().next().value; timers.delete(id); return fn(); };
    await h.state.humanChatbot(h.socket, message('I am reading a book.'));
    const first = runTimer();
    while (!release) await new Promise(resolve => setImmediate(resolve));
    await h.state.humanChatbot(h.socket, message('200'));
    await runTimer();
    assert.equal(h.requests.length, 1);
    release(); await first; await runTimer();
    assert.equal(peak, 1);
    assert.equal(h.requests.length, 2);
    assert.ok(h.requests[1].contents.some(turn => turn.role === 'model' && turn.parts[0].text === 'How many pages are in this book?'));
    assert.equal(h.requests[1].contents.at(-1).parts[0].text, '200');
    assert.equal(Object.keys(h.state.chatBuffers).length, 0);
});