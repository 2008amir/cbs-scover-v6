/**
 * Voice changer commands + automatic voice-note conversion.
 *
 * Pipeline (speech-to-speech, no TTS and no transcription anywhere):
 *   WhatsApp voice note (ogg/opus) -> wav -> Hugging Face Seed-VC with the
 *   saved reference voice -> wav -> Opus PTT sent back to the chat.
 *
 * Commands
 *   .addvoice <name>            save a replied 10-20s recording as a target voice
 *   .voices                     list saved target voices
 *   .delvoice <name>            delete a saved voice
 *   .renamevoice <old> <new>    rename a saved voice
 *   .voicechanger <name>        turn conversion on with that voice
 *   .voicechanger off           turn conversion off
 *   .voicechanger               show status
 */

const fs = require('fs');
const storage = require('./storage');
const audio = require('./audio');
const seedvc = require('./seedvc');
const { convertVoiceNote, VoiceChangerError } = require('./converter');
const config = require('./config');
const { reportError } = require('../error-reporting');

const busy = new Set();

/* --------------------------- audio sources --------------------------- */

function audioNode(message) {
    const msg = message || {};
    const inner =
        msg.viewOnceMessageV2Extension?.message ||
        msg.viewOnceMessageV2?.message ||
        msg.viewOnceMessage?.message ||
        msg.ephemeralMessage?.message ||
        msg.documentWithCaptionMessage?.message;
    if (inner) return audioNode(inner);
    if (msg.audioMessage) return { type: 'audioMessage', node: msg.audioMessage };
    if (msg.videoMessage) return { type: 'videoMessage', node: msg.videoMessage };
    if (msg.documentMessage && /audio|ogg|mpeg|mp3|wav|m4a/i.test(msg.documentMessage.mimetype || '')) {
        return { type: 'documentMessage', node: msg.documentMessage };
    }
    return null;
}

function extFromMime(mime = '') {
    if (/ogg|opus/i.test(mime)) return 'ogg';
    if (/mpeg|mp3/i.test(mime)) return 'mp3';
    if (/mp4|m4a|aac/i.test(mime)) return 'm4a';
    if (/wav/i.test(mime)) return 'wav';
    if (/webm/i.test(mime)) return 'webm';
    return 'ogg';
}

/** Find the audio the command should work on: replied audio, or the message itself. */
function findAudio(m) {
    const ctx = m?.msg?.contextInfo;
    const quoted = ctx?.quotedMessage;
    if (quoted) {
        const found = audioNode(quoted);
        if (found) {
            return {
                ...found,
                key: {
                    remoteJid: m.chat,
                    fromMe: false,
                    id: ctx.stanzaId,
                    participant: ctx.participant
                },
                message: quoted
            };
        }
    }
    const own = audioNode(m?.message);
    if (own) return { ...own, key: m.key, message: m.message };
    return null;
}

async function downloadAudio(EliteProTech, found) {
    const { downloadMediaMessage, downloadContentFromMessage } = require('baileys');
    const attempts = [
        () => downloadMediaMessage(
            { key: found.key, message: found.message },
            'buffer',
            {},
            { reuploadRequest: EliteProTech.updateMediaMessage }
        ),
        async () => {
            const kind = found.type === 'videoMessage' ? 'video' : found.type === 'documentMessage' ? 'document' : 'audio';
            const stream = await downloadContentFromMessage(found.node, kind);
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            return Buffer.concat(chunks);
        }
    ];
    let lastErr;
    for (const attempt of attempts) {
        try {
            const buf = await attempt();
            if (buf?.length) return buf;
            lastErr = new Error('empty audio buffer');
        } catch (err) {
            lastErr = err;
        }
    }
    throw lastErr || new Error('audio download failed');
}

/* ------------------------------ messages ------------------------------ */

function helpText(prefix) {
    return (
        `🎙️ *VOICE CHANGER*\n\n` +
        `Speaks in *your* words, timing and emotion — only the voice identity changes.\n\n` +
        `• *${prefix}addvoice <name>* — reply to a 10-20s clear recording to save it as a target voice\n` +
        `• *${prefix}voices* — list saved voices\n` +
        `• *${prefix}delvoice <name>* — delete a voice\n` +
        `• *${prefix}renamevoice <old> <new>* — rename a voice\n` +
        `• *${prefix}voicechanger <name>* — start converting your voice notes\n` +
        `• *${prefix}voicechanger off* — stop\n` +
        `• *${prefix}voicechanger* — status\n\n` +
        `⚠️ Only use voices you own or have permission to use.`
    );
}

function friendlyError(err, prefix) {
    const code = err instanceof VoiceChangerError ? err.code : err?.code;
    if (code === 'BAD_AUDIO') return '❌ That recording could not be read (too short, silent or unsupported).';
    if (code === 'TOO_LONG') return `❌ That voice note is too long. Maximum is ${Math.round(config.SOURCE_MAX_SECONDS / 60)} minutes.`;
    if (code === 'ENCODE_FAILED') return '❌ The converted audio could not be packed as a voice note.';
    if (code === 'VC_TIMEOUT') return '⌛ The voice model took too long. Try a shorter voice note.';
    const status = Number(err?.response?.status || err?.status || err?.statusCode || 0);
    if (status === 401 || status === 403 || /no token|401|403|authoriz|invalid.*token/i.test(String(err?.message))) {
        return '❌ Hugging Face rejected access. Replace HF_TOKEN with a valid token, ensure it can access the selected Space, update the hosting environment and restart.';
    }
    if (status === 429 || /quota|gpu|429/i.test(String(err?.message))) return '⚠️ The voice model is busy (GPU quota). Please retry in a moment.';
    return `❌ Voice conversion failed.\n\nSend *${prefix}voicechanger* to check status.`;
}

/* ------------------------------ commands ------------------------------ */

/**
 * @returns {Promise<boolean>} true when the command was handled
 */
async function handleCommands(EliteProTech, m, ctx) {
    const { command, args, reply, prefix, isOwner } = ctx;
    const managementCommands = ['addvoice', 'delvoice', 'renamevoice', 'voices'];

    if (!['voicechanger', 'voicehelp', ...managementCommands].includes(command)) return false;

    if (managementCommands.includes(command) && !isOwner) {
        await reply(global.mess?.owner || '⛔ Command restricted to the bot owner.');
        return true;
    }

    if (command === 'voicehelp') {
        await reply(helpText(prefix));
        return true;
    }

    /* ---- .addvoice <name> ---- */
    if (command === 'addvoice') {
        const name = args.trim();
        if (!name) {
            await reply(`✳️ Usage: reply to a voice note with *${prefix}addvoice <name>*\nExample: *${prefix}addvoice mysoftvoice*`);
            return true;
        }
        if (!storage.slug(name)) {
            await reply('❌ Use a name with letters or numbers, e.g. *soft1*.');
            return true;
        }
        const found = findAudio(m);
        if (!found) {
            await reply(`✳️ Reply to a *voice note or audio* (10-20 seconds of clear speech) with *${prefix}addvoice ${name}*`);
            return true;
        }
        await reply('⏳ Saving that reference voice...');
        try {
            const raw = await downloadAudio(EliteProTech, found);
            const decoded = await audio.toWav(raw, extFromMime(found.node?.mimetype));
            if (audio.wavDuration(decoded) > config.SOURCE_MAX_SECONDS) throw new Error('Reference exceeds five minutes. Send 10–20 seconds of clean single-speaker speech.');
            const prepared = audio.prepareReference(decoded, config.REF_RECOMMENDED_SECONDS);
            if (prepared.speechSeconds < config.REF_MIN_SECONDS) throw new Error(`Only ${prepared.speechSeconds.toFixed(1)} seconds of audible speech in the reference. At least 10 seconds of clean speech is required; record one speaker without music.`);
            const wav = prepared.wav;
            const trimmed = audio.wavDuration(wav) < audio.wavDuration(decoded);
            const existed = !!storage.getVoice(name);
            const saved = storage.saveVoice(name, wav, {
                seconds: Number(audio.wavDuration(wav).toFixed(2)),
                speechSeconds: prepared.speechSeconds,
                savedBy: String(m.sender || '').split('@')[0],
                savedIn: m.chat
            });
            await reply(
                `${existed ? '♻️ Updated' : '✅ Saved'} target voice *${saved.name}* ` +
                `(${saved.metadata.seconds}s${trimmed ? ', quiet edges removed / clearest segment selected' : ''}).\n\n` +
                `Start with *${prefix}voicechanger ${saved.name}*, then send a voice note.\n` +
                `⚠️ Only use voices you own or have consent for.`
            );
        } catch (err) {
            await reportError(EliteProTech, m, err, 'Save reference voice');
        }
        return true;
    }

    /* ---- .voices ---- */
    if (command === 'voices') {
        const voices = storage.listVoices();
        if (!voices.length) {
            await reply(`📭 No target voices saved yet.\nReply to a 10-20s recording with *${prefix}addvoice <name>*.`);
            return true;
        }
        const state = storage.getState(m);
        const active = storage.slug(state.targetVoice);
        const list = voices
            .map((v, i) => `${i + 1}. *${v.name}*${v.id === active && state.enabled ? ' ✅ (active here)' : ''}` +
                `${v.metadata?.seconds ? ` — ${v.metadata.seconds}s` : ''}`)
            .join('\n');
        await reply(`🎙️ *SAVED TARGET VOICES* (${voices.length})\n\n${list}\n\nUse *${prefix}voicechanger <name>* to start.`);
        return true;
    }

    /* ---- .delvoice <name> ---- */
    if (command === 'delvoice') {
        if (!args.trim()) {
            await reply(`✳️ Usage: *${prefix}delvoice <name>*`);
            return true;
        }
        const ok = storage.deleteVoice(args.trim());
        await reply(ok ? `🗑️ Deleted voice *${args.trim()}*.` : `❌ No saved voice named *${args.trim()}*.`);
        return true;
    }

    /* ---- .renamevoice <old> <new> ---- */
    if (command === 'renamevoice') {
        const parts = args.split(/[\s|,]+/).filter(Boolean);
        if (parts.length < 2) {
            await reply(`✳️ Usage: *${prefix}renamevoice <old name> <new name>*`);
            return true;
        }
        const [oldName, ...restName] = parts;
        const newName = restName.join(' ');
        const res = storage.renameVoice(oldName, newName);
        if (res.ok) await reply(`✏️ Renamed *${res.oldName}* → *${res.newName}*.`);
        else if (res.reason === 'exists') await reply(`❌ A voice named *${newName}* already exists.`);
        else if (res.reason === 'invalid') await reply('❌ That new name is not usable.');
        else await reply(`❌ No saved voice named *${oldName}*.`);
        return true;
    }

    /* ---- .voicechanger ---- */
    if (command === 'voicechanger') {
        const arg = args.trim();
        const state = storage.getState(m);

        if (!arg) {
            const voices = storage.listVoices();
            await reply(
                `🎙️ *VOICE CHANGER STATUS*\n\n` +
                `• Here: ${state.enabled && state.targetVoice ? `🟢 ON → *${state.targetVoice}*` : '🔴 OFF'}\n` +
                `• Active chats: *${storage.countActive()}*\n` +
                `• Saved voices: *${voices.length}*${voices.length ? ` (${voices.map(v => v.name).join(', ')})` : ''}\n` +
                `• Engine: Seed-VC on Hugging Face (*${config.HF_SPACE}*)\n` +
                `• Token: ${config.HF_TOKEN ? '✅ configured' : '❌ missing (set HF_TOKEN)'}\n\n` +
                helpText(prefix)
            );
            return true;
        }

        if (/^(off|stop|disable)$/i.test(arg)) {
            storage.setState(m, { enabled: false, targetVoice: state.targetVoice || null });
            await reply('🔴 Voice changer is *off* here. Your voice notes will be left as they are.');
            return true;
        }

        if (/^(on|start|enable)$/i.test(arg)) {
            if (!state.targetVoice || !storage.getVoice(state.targetVoice)) {
                await reply(`✳️ Choose a voice first: *${prefix}voicechanger <name>*\nSee *${prefix}voices*.`);
                return true;
            }
            storage.setState(m, { enabled: true, targetVoice: storage.getVoice(state.targetVoice).name });
            await reply(`🟢 Voice changer *on* → *${state.targetVoice}*. Send a voice note.`);
            return true;
        }

        if (/^help$/i.test(arg)) {
            await reply(helpText(prefix));
            return true;
        }

        const voice = storage.getVoice(arg);
        if (!voice) {
            const voices = storage.listVoices();
            await reply(
                `❌ No saved voice named *${arg}*.\n` +
                (voices.length ? `Saved: ${voices.map(v => v.name).join(', ')}` : `Save one with *${prefix}addvoice <name>*.`)
            );
            return true;
        }
        storage.setState(m, { enabled: true, targetVoice: voice.name });
        await reply(
            `🟢 Voice changer *on* → *${voice.name}*.\n\n` +
            `Send me a voice note and I will send it back in that voice.\n` +
            `Stop anytime with *${prefix}voicechanger off*.`
        );
        return true;
    }

    return false;
}

/* ------------------- automatic voice note conversion ------------------- */

/**
 * Converts an incoming voice note when the voice changer is on for that
 * chat + sender. Returns true when it handled the message.
 */
async function handleVoiceNote(EliteProTech, m) {
    try {
        const state = storage.getState(m);
        if (!state?.enabled || !state.targetVoice) return false;

        const own = audioNode(m?.message);
        // Only the sender's own recorded speech, never quoted or forwarded media.
        if (!own || own.type !== 'audioMessage' || !own.node?.ptt) return false;

        const voice = storage.getVoice(state.targetVoice);
        if (!voice) {
            await EliteProTech.sendMessage(m.chat, {
                text: `❌ The saved voice *${state.targetVoice}* is missing. Send *${global.prefix || '.'}voices*.`
            }, { quoted: m });
            return true;
        }

        const key = `${m.chat}|${m.key?.id}`;
        if (busy.has(key)) return true;
        busy.add(key);

        const prefix = global.prefix || '.';
        try {
            await EliteProTech.sendMessage(m.chat, { react: { text: '🎙️', key: m.key } }).catch(() => {});
            const raw = await downloadAudio(EliteProTech, own);
            const result = await convertVoiceNote(raw, voice.reference, extFromMime(own.node?.mimetype));
            await EliteProTech.sendMessage(m.chat, {
                audio: result.ptt,
                mimetype: 'audio/ogg; codecs=opus',
                ptt: true
            }, { quoted: m });
            await EliteProTech.sendMessage(m.chat, { react: { text: '✅', key: m.key } }).catch(() => {});
        } catch (err) {
            await reportError(EliteProTech, m, err, 'Voice changer');
        } finally {
            busy.delete(key);
        }
        return true;
    } catch (err) {
        await reportError(EliteProTech, m, err, 'Voice changer');
        return false;
    }
}

module.exports = {
    friendlyError,
    handleCommands,
    handleVoiceNote,
    helpText,
    storage,
    seedvc,
    audio,
    config,
    findAudio,
    downloadAudio
};
