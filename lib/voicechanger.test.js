const test = require('node:test');
const assert = require('node:assert/strict');
const { buildWav, prepareReference, wavDuration } = require('./voicechanger/audio');
const { voiceEnvironment } = require('./voicechanger/env');

function recording(segments) {
    const data = Buffer.alloc(segments.reduce((sum, [seconds]) => sum + seconds, 0) * 22050 * 2);
    let offset = 0;
    for (const [seconds, amplitude] of segments) for (let i = 0; i < seconds * 22050; i++) {
        data.writeInt16LE(Math.round(amplitude * Math.sin(i * 0.1)), offset); offset += 2;
    }
    return buildWav({ channels: 1, sampleRate: 22050, bitsPerSample: 16, data });
}

test('reference selection keeps audible speech instead of leading silence, bounded to 20 seconds', () => {
    const selected = prepareReference(recording([[15, 0], [20, 8000], [5, 0]]));
    assert.equal(wavDuration(selected.wav), 20); assert.equal(selected.speechSeconds, 20);
});

test('short reference cannot pass the 10-second audible-speech requirement', () => {
    const selected = prepareReference(recording([[12, 0], [4, 8000], [12, 0]]));
    assert.equal(selected.speechSeconds, 4); assert.ok(selected.speechSeconds < 10);
    assert.throws(() => prepareReference(recording([[20, 0]])), /silent/);
});

test('similarity settings use supported V2 fields and normalize invalid overrides', () => {
    const defaults = voiceEnvironment({});
    assert.equal(defaults.DIFFUSION_STEPS, 50); assert.equal(defaults.SIMILARITY_CFG, 0.9); assert.equal(defaults.CONVERT_STYLE, true);
    const overrides = voiceEnvironment({ VC_SIMILARITY_CFG: '0.8', VC_CONVERT_STYLE: 'false' });
    assert.equal(overrides.SIMILARITY_CFG, 0.8); assert.equal(overrides.CONVERT_STYLE, false);
    assert.equal(voiceEnvironment({ VC_SIMILARITY_CFG: '999' }).SIMILARITY_CFG, 0.9);
});

test('voice provider rejection reaches the initiating user privately through the automatic conversion flow', async () => {
    const voice = require('./voicechanger');
    const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-reference-test-'));
    const reference = path.join(dir, 'reference.wav');
    fs.writeFileSync(reference, recording([[15, 8000]]));
    const original = { toWav: voice.audio.toWav, convert: voice.seedvc.convert };
    const sent = [];
    try {
        voice.audio.toWav = async () => recording([[2, 6000]]);
        voice.seedvc.convert = async () => { throw Object.assign(new Error('Reference model access denied token=private-token'), { status: 403 }); };
        const source = fs.readFileSync(path.join(__dirname, 'voicechanger/index.js'), 'utf8');
        const context = vm.createContext({ storage: { getState: () => ({ enabled: true, targetVoice: 'test' }), getVoice: () => ({ reference }) },
            audioNode: voice.findAudio ? () => ({ type: 'audioMessage', node: { ptt: true } }) : null,
            busy: new Set(), global: { prefix: '.' }, downloadAudio: async () => Buffer.from('source'), extFromMime: () => 'ogg',
            convertVoiceNote: require('./voicechanger/converter').convertVoiceNote,
            reportError: require('./error-reporting').reportError, console });
        vm.runInContext(source.slice(source.indexOf('async function handleVoiceNote('), source.indexOf('module.exports =')), context);
        await context.handleVoiceNote({ sendMessage: async (jid, content) => sent.push({ jid, ...content }) },
            { chat: 'group@g.us', sender: '123@s.whatsapp.net', message: {}, key: { id: 'voice' } });
        const notice = sent.find(item => item.text);
        assert.equal(notice.jid, '123@s.whatsapp.net');
        assert.ok(notice.text.includes('HTTP 403')); assert.ok(notice.text.includes('Reference model access denied'));
        assert.equal(notice.text.includes('private-token'), false);
    } finally {
        voice.audio.toWav = original.toWav; voice.seedvc.convert = original.convert;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});