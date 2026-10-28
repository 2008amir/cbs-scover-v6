const fs = require('fs');
const path = require('path');
const axios = require('axios');
const googleTTS = require('google-tts-api');
const apiProxy = require('./lib/apiproxy');
const voiceChanger = require('./lib/voicechanger');
const v2 = require('./lib/v2');
const menuButtons = require('./lib/menu-buttons');
const errorReporting = require('./lib/error-reporting');

const HANDLER_FILE = path.join(__dirname, 'lib', 'v1', 'commands.js');


const GROUP_LINK = 'https://chat.whatsapp.com/GAlNHmy9FxZ90YXdxgzdu5?s=cl&p=a&mlu=4';
const CHANNEL_LINK = 'https://whatsapp.com/channel/0029Vb8CfvXDjiOVpsJpdW3j';
const OWNER_NUMBER = '2349162748703';

// Speechma / Edge voices used by the aivoice command
const VOICES = {
    male: 'Andrew',
    female: 'Aria',
    hausa_male: 'Hamdan',
    hausa_female: 'Salma'
};

const HAUSA_VOICE_IDS = {
    male: 'ha-NG-HamdanNeural',
    female: 'ha-NG-SalmaNeural'
};

let cachedHandler;

/* ============================ AI VOICE ============================ */

// Common Hausa words used to auto-detect Hausa text.
const HAUSA_HINTS = [
    'sannu', 'yaya', 'kake', 'kike', 'lafiya', 'nagode', 'na gode', 'barka',
    'dai', 'kuma', 'ina', 'ban', 'zan', 'muna', 'suna', 'kai', 'ke', 'shi',
    'ita', 'mu', 'ku', 'su', 'gobe', 'yau', 'jiya', 'ranka', 'allah', 'malam',
    'yaushe', 'me', 'don', 'saboda', 'amma', 'wannan', 'wancan', 'gaskiya',
    'sosai', 'kadan', 'yawa', 'aiki', 'gida', 'abinci', 'ruwa', 'mutum'
];

function looksHausa(text) {
    const words = String(text).toLowerCase().match(/[a-z\u0300-\u036f']+/g) || [];
    if (!words.length) return false;
    let hits = 0;
    for (const w of words) if (HAUSA_HINTS.includes(w)) hits++;
    return hits >= 2 || (words.length <= 4 && hits >= 1);
}

// Hausa reads much better when abbreviations/numbers are spelled the Hausa way.
const HAUSA_NUMBERS = ['sifili', 'daya', 'biyu', 'uku', 'hudu', 'biyar', 'shida', 'bakwai', 'takwas', 'tara', 'goma'];

function normalizeHausa(text) {
    let out = ' ' + String(text).replace(/\s+/g, ' ').trim() + ' ';
    // Expand small numbers so the engine pronounces them in Hausa, not English.
    out = out.replace(/\b(\d{1,2})\b/g, (m, n) => {
        const num = parseInt(n, 10);
        return num <= 10 ? HAUSA_NUMBERS[num] : m;
    });
    // Keep hooked letters intact but normalise the common ASCII stand-ins.
    out = out
        .replace(/\bnagode\b/gi, 'na gode')
        .replace(/\bina kwana\b/gi, 'ina kwana,')
        .replace(/\bsannu\b/gi, 'sannu,');
    // Add short pauses so the sentence is not rushed.
    out = out.replace(/([.!?])\s*/g, '$1 ');
    return out.trim();
}

async function speechmaBuffer(text, voice, rate = 1.5, pitch = 0) {
    const res = await axios.get(
        `https://apis.davidcyril.name.ng/tools/speechma?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(voice)}&pitch=${pitch}&rate=${rate}`,
        { responseType: 'arraybuffer', timeout: 120000 }
    );
    const buffer = Buffer.from(res.data);
    if (!buffer.length) throw new Error('empty speechma audio');
    return buffer;
}

async function googleBuffer(text, lang = 'en') {
    const parts = await googleTTS.getAllAudioBase64(text, {
        lang,
        slow: false,
        host: 'https://translate.google.com',
        splitPunct: ',.?!;:'
    });
    const buffer = Buffer.concat(parts.map(p => Buffer.from(p.base64, 'base64')));
    if (!buffer.length) throw new Error('empty google tts audio');
    return buffer;
}

async function makeVoice(text, gender, hausa) {
    if (hausa) {
        const clean = normalizeHausa(text);
        const attempts = [
            () => speechmaBuffer(clean, HAUSA_VOICE_IDS[gender] || HAUSA_VOICE_IDS.male, 1.35),
            () => speechmaBuffer(clean, VOICES[`hausa_${gender}`] || VOICES.hausa_male, 1.35),
            () => googleBuffer(clean, 'ha')
        ];
        let lastErr;
        for (const attempt of attempts) {
            try {
                return await attempt();
            } catch (err) {
                lastErr = err;
                console.error('Hausa TTS attempt failed:', err?.message || err);
            }
        }
        throw lastErr || new Error('hausa tts failed');
    }

    try {
        return await speechmaBuffer(text, VOICES[gender] || VOICES.male);
    } catch (err) {
        console.error('Speechma failed, using fallback:', err?.message || err);
        return await googleBuffer(text, 'en');
    }
}

function extractBody(m) {
    if (typeof m?.text === 'string' && m.text.trim()) return m.text;
    if (typeof m?.body === 'string' && m.body.trim()) return m.body;
    const msg = m?.message || {};
    return (
        msg.conversation ||
        msg.extendedTextMessage?.text ||
        msg.imageMessage?.caption ||
        msg.videoMessage?.caption ||
        ''
    );
}

async function handleAiVoice(EliteProTech, m) {
    const prefix = global.prefix ?? '.';
    const body = extractBody(m);
    if (!body || !body.startsWith(prefix) || body[prefix.length] === ' ') return false;

    const command = body.slice(prefix.length).trim().split(/ +/)[0].toLowerCase();
    const match = /^(?:aivoice|av)(?:[-_ ]?(hausa|male|female))?(?:[-_ ]?(hausa|male|female))?$/.exec(command);
    if (!match) return false;

    const flags = [match[1], match[2]].filter(Boolean);
    let hausa = flags.includes('hausa');
    const gender = flags.includes('female') ? 'female' : 'male';
    const reply = (text) => errorReporting.replyText(EliteProTech, m, text);

    let text = body.slice(prefix.length + command.length).trim();
    if (!text && m?.quoted?.text) text = String(m.quoted.text).trim();

    if (!text) {
        await reply(
            `🎙️ *AI VOICE*\n\n` +
            `*${prefix}aivoice-male* <text>\n` +
            `*${prefix}aivoice-female* <text>\n` +
            `*${prefix}aivoice-hausa* <rubutu>\n` +
            `*${prefix}aivoice-hausa-female* <rubutu>\n\n` +
            `Example:\n${prefix}aivoice-male hello everyone\n${prefix}aivoice-hausa sannu da zuwa, yaya kake?`
        );
        return true;
    }

    // Speech engines are limited; keep the text within a safe length.
    text = text.slice(0, 900);
    if (!hausa && looksHausa(text)) hausa = true;

    // "recording audio..." shows immediately and disappears the moment the
    // voice note is delivered.
    let recording = true;
    const keepRecording = async () => {
        while (recording) {
            await EliteProTech.sendPresenceUpdate('recording', m.chat).catch(() => {});
            await new Promise(r => setTimeout(r, 3000));
        }
    };

    try {
        await EliteProTech.sendPresenceUpdate('available', m.chat).catch(() => {});
        await EliteProTech.sendPresenceUpdate('recording', m.chat).catch(() => {});
        keepRecording();

        const audio = await makeVoice(text, gender, hausa);

        let payload = { audio, mimetype: 'audio/mpeg', ptt: true };
        try {
            const { toPTT } = require('./lib/converter');
            const converted = await toPTT(audio, 'mp3');
            if (converted && converted.length) {
                payload = { audio: converted, mimetype: 'audio/ogg; codecs=opus', ptt: true };
            }
        } catch (convErr) {
            console.error('PTT conversion failed, sending mp3:', convErr?.message || convErr);
        }

        await EliteProTech.sendMessage(m.chat, payload, { quoted: m });
        recording = false;
        await EliteProTech.sendPresenceUpdate('paused', m.chat).catch(() => {});
    } catch (err) {
        recording = false;
        await EliteProTech.sendPresenceUpdate('paused', m.chat).catch(() => {});
        await errorReporting.reportError(EliteProTech, m, err, 'AI voice');
    }


    return true;
}

/* ==================== CHATBOT NAME + ANTIDELETE COMMANDS ==================== */

const NAME_FILE = path.join(__dirname, 'database', 'chatbotname.json');
const ANTIDELETE_FILE = path.join(__dirname, 'database', 'antidelete.json');
const ANTIDELETE_GROUP_FILE = path.join(__dirname, 'database', 'antideletegroup.json');
const CHATBOT_FILE = path.join(__dirname, 'database', 'chatbot.json');

function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return fallback;
    }
}

function writeJson(file, data) {
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
        return true;
    } catch (err) {
        console.error('Failed to save', file, err?.message || err);
        return false;
    }
}

/* ---------- shared helpers for the local commands ---------- */

const USERNAME_FILE = path.join(__dirname, 'database', 'username.json');

function ownerJid(EliteProTech) {
    const me = EliteProTech?.user?.id || '';
    const num = String(me).split(':')[0].split('@')[0];
    return `${num || OWNER_NUMBER}@s.whatsapp.net`;
}

function contextOf(m) {
    const msg = m?.message || {};
    return (
        msg.extendedTextMessage?.contextInfo ||
        msg.imageMessage?.contextInfo ||
        msg.videoMessage?.contextInfo ||
        m?.msg?.contextInfo ||
        null
    );
}

function quotedInfo(m) {
    const ctx = contextOf(m);
    if (!ctx?.quotedMessage) return null;
    return {
        message: ctx.quotedMessage,
        key: {
            remoteJid: m.chat,
            fromMe: false,
            id: ctx.stanzaId,
            participant: ctx.participant
        }
    };
}

function unwrap(message) {
    let current = message || {};
    for (let i = 0; i < 5; i++) {
        const inner =
            current?.viewOnceMessageV2Extension?.message ||
            current?.viewOnceMessageV2?.message ||
            current?.viewOnceMessage?.message ||
            current?.ephemeralMessage?.message ||
            current?.documentWithCaptionMessage?.message;
        if (!inner) break;
        current = inner;
    }
    const clean = {};
    for (const [k, v] of Object.entries(current)) {
        clean[k] = v && typeof v === 'object' ? { ...v, viewOnce: false } : v;
    }
    return clean;
}

async function downloadQuoted(EliteProTech, q) {
    const baileys = require('baileys');
    const { downloadMediaMessage, downloadContentFromMessage } = baileys;
    const message = unwrap(q.message);
    const TYPES = {
        imageMessage: 'image',
        videoMessage: 'video',
        audioMessage: 'audio',
        stickerMessage: 'sticker',
        documentMessage: 'document'
    };
    const attempts = [
        () => downloadMediaMessage({ key: q.key, message }, 'buffer', {}, { reuploadRequest: EliteProTech.updateMediaMessage }),
        () => downloadMediaMessage({ key: q.key, message: q.message }, 'buffer', {}, { reuploadRequest: EliteProTech.updateMediaMessage }),
        async () => {
            const type = Object.keys(TYPES).find(k => message[k]);
            if (!type) throw new Error('no media node');
            const stream = await downloadContentFromMessage(message[type], TYPES[type]);
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            return Buffer.concat(chunks);
        }
    ];
    let lastErr;
    for (const attempt of attempts) {
        try {
            const buf = await attempt();
            if (buf && buf.length) return buf;
            lastErr = new Error('empty buffer');
        } catch (err) {
            lastErr = err;
            console.error('download attempt failed:', err?.message || err);
        }
    }
    throw lastErr || new Error('download failed');
}

// Image the command should work on: a replied image, or the image the command
// was sent as a caption of.
function imageSource(m) {
    const q = quotedInfo(m);
    if (q && unwrap(q.message).imageMessage) return q;
    const own = unwrap(m.message || {});
    if (own.imageMessage) return { message: m.message, key: m.key };
    return null;
}

async function cropSquare(buffer) {
    const Jimp = require('jimp');
    const img = await Jimp.read(buffer);
    const side = Math.min(img.getWidth(), img.getHeight());
    return img
        .crop((img.getWidth() - side) / 2, (img.getHeight() - side) / 2, side, side)
        .resize(640, 640)
        .quality(90)
        .getBufferAsync(Jimp.MIME_JPEG);
}

// WhatsApp always displays a square profile picture, so "full, no crop" means
// fitting the whole image inside a square canvas instead of cutting it.
async function padToSquare(buffer) {
    const Jimp = require('jimp');
    const img = await Jimp.read(buffer);
    const side = Math.max(img.getWidth(), img.getHeight());
    const canvas = new Jimp(side, side, 0x000000ff);
    const fitted = img.clone().contain(side, side);
    canvas.composite(fitted, 0, 0);
    return canvas.resize(640, 640).quality(90).getBufferAsync(Jimp.MIME_JPEG);
}

// Full view-once messages as they arrive. WhatsApp often strips the media
// keys from the quoted copy, so recovery uses the original when available.
const viewOnceCache = new Map();
const VIEW_ONCE_TTL = 24 * 60 * 60 * 1000;
function isViewOnce(msg) {
    if (!msg) return false;
    if (msg.viewOnceMessage || msg.viewOnceMessageV2 || msg.viewOnceMessageV2Extension) return true;
    const inner = msg.ephemeralMessage?.message || msg;
    return ['imageMessage', 'videoMessage', 'audioMessage'].some(k => inner[k]?.viewOnce);
}
function rememberViewOnce(m) {
    try {
        if (!m?.key?.id || !isViewOnce(m.message)) return;
        viewOnceCache.set(m.key.id, { message: m.message, key: m.key, at: Date.now() });
        const cutoff = Date.now() - VIEW_ONCE_TTL;
        for (const [id, v] of viewOnceCache) if (v.at < cutoff || viewOnceCache.size > 300) viewOnceCache.delete(id); else break;
    } catch {}
}
function resolveViewOnce(q) {
    const hit = q?.key?.id && viewOnceCache.get(q.key.id);
    return hit ? { message: hit.message, key: hit.key } : q;
}

async function sendViewOnceCopy(EliteProTech, q, target, m) {
    q = resolveViewOnce(q);
    const message = unwrap(q.message);
    const from = String(q.key.participant || m.chat || '').split('@')[0];
    const header = `👁️ *VIEW ONCE RECOVERED*\n👤 From: @${from}\n💬 Chat: ${m.chat}`;
    const options = { mentions: [q.key.participant || m.chat].filter(Boolean) };

    if (message.imageMessage) {
        const buffer = await downloadQuoted(EliteProTech, q);
        return EliteProTech.sendMessage(target, { image: buffer, caption: `${header}\n\n${message.imageMessage.caption || ''}`.trim(), ...options });
    }
    if (message.videoMessage) {
        const buffer = await downloadQuoted(EliteProTech, q);
        return EliteProTech.sendMessage(target, { video: buffer, caption: `${header}\n\n${message.videoMessage.caption || ''}`.trim(), ...options });
    }
    if (message.audioMessage) {
        const buffer = await downloadQuoted(EliteProTech, q);
        await EliteProTech.sendMessage(target, { text: header, ...options });
        return EliteProTech.sendMessage(target, {
            audio: buffer,
            ptt: !!message.audioMessage.ptt,
            mimetype: message.audioMessage.mimetype || 'audio/mpeg'
        });
    }
    const text = message.conversation || message.extendedTextMessage?.text;
    if (text) return EliteProTech.sendMessage(target, { text: `${header}\n\n${text}`, ...options });
    throw new Error('unsupported view once content');
}


/* ============================ HELP ============================ */
// One short line describing what every command does, grouped exactly like the
// menu. `.help` sends it section by section, `.help <command>` explains one.
const HELP_SECTIONS = [
    ['SETTINGS', {
        Addowner: 'Add a number as a bot owner.',
        Delowner: 'Remove a number from the owner list.',
        Listowner: 'Show every registered owner.',
        Block: 'Block a user from the bot/WhatsApp.',
        Unblock: 'Unblock a blocked user.',
        Blocklist: 'Show all blocked users.',
        Anticall: 'Auto decline or block incoming calls.',
        Joingc: 'Make the bot join a group from an invite link.',
        Join: 'Same as joingc — join a group link.',
        Restart: 'Restart the bot process.',
        Mode: 'Switch the bot between public and private (applies everywhere).',
        Edit: 'Edit a message the bot sent.',
        Clearall: 'Clear all chats from the bot account.',
        Autobio: 'Keep the bot bio updating automatically.',
        Setpp: 'Set the bot profile picture (cropped).',
        Autoread: 'Auto mark incoming messages as read.',
        Autotyping: 'Show "typing..." before replying.',
        Autorecording: 'Show "recording audio..." before replying.',
        Autorecordtype: 'Randomly show typing or recording.',
        Autoviewstatus: 'Automatically view everyone\'s status.',
        Autoreact: 'React automatically to incoming messages.',
        Autolikestatus: 'Automatically like viewed statuses.',
        Chatbot: 'Turn the AI chatbot on/off (dm, group, here, all).',
        Getsession: 'Send your session credentials.',
        Backup: 'Send a backup of the bot files.',
        Update: 'Pull the latest bot update.',
        Setmenuimage: 'Change the image shown on the menu.',
        Antidelete: 'Restore messages deleted in private chats.',
        Antideletemessage: 'Same as antidelete, message level control.',
        Chatbotname: 'Change the name the AI chatbot answers with.',
        Username: 'Set the name the bot calls you by.',
        'Chatbot-friend': 'Friendly-buddy AI personality (private chats only).',
        'Chatbot-love': 'Romantic AI personality (private chats only).',
        'Chatbot gender': 'Set the chatbot voice/personality gender (male/female).',
        Setprefix: 'Change the command prefix.',
        Setfullpp: 'Set the bot profile picture without cropping.',
        Reveal: 'Reveal a hidden/one-time message.',
        Listgroup: 'List all groups the bot is in.',
        Listonline: 'Show who is currently online in the chat.',
        Setpaypoint: 'Set your payment/donation details.',
        Reportcommand: 'Report a broken command to the owner.'
    }],
    ['GROUPS', {
        Add: 'Add a member to the group.',
        Addall: 'Add a saved list of members to the group.',
        Promote: 'Make a member a group admin.',
        Promoteall: 'Make every member an admin.',
        Demote: 'Remove admin rights from a member.',
        Demoteall: 'Remove admin rights from everyone.',
        Kick: 'Remove a member from the group.',
        Kickall: 'Remove all members from the group.',
        Left: 'Make the bot leave the group.',
        Tagall: 'Mention every member with a message.',
        Hidetag: 'Mention everyone invisibly.',
        Totag: 'Re-send a quoted message tagging everyone.',
        Gc: 'Open or close the group (who can send).',
        Warn: 'Give a member a warning.',
        Unwarn: 'Remove a warning from a member.',
        All: 'Alert every member of the group.',
        Antistatus: 'Delete status re-posts inside the group.',
        Approve: 'Approve pending join requests.',
        Reject: 'Reject pending join requests.',
        Group: 'Open/close the group chat.',
        Gcalert: 'Toggle group event alerts.',
        Addmetaai: 'Add Meta AI to the group.',
        Removemetaai: 'Remove Meta AI from the group.',
        Opentime: 'Schedule the group to open at a time.',
        Closetime: 'Schedule the group to close at a time.',
        Setdesc: 'Change the group description.',
        Setgrouppicture: 'Change the group picture.',
        Editinfo: 'Choose who can edit group info.',
        Invite: 'Get the group invite link.',
        Revoke: 'Reset the group invite link.',
        Savecontact: 'Save all group members as contacts.',
        Sendcontact: 'Send the group contact list.',
        Contacttag: 'Tag members using their saved names.',
        Welcome: 'Turn the welcome & goodbye messages on/off (all groups, here, or by group id).',
        Antilink: 'Delete links posted in the group.',
        Tagadmin: 'Mention all group admins.',
        'Antideletegroup-public': 'Restore deleted group messages inside the group.',
        'Antideletegroup-private': 'Send deleted group messages to the owner DM.',
        Grouppp: 'Set the group picture from a replied image (cropped).',
        Groupfullpp: 'Set the group picture full size, without cropping.',
        Groupstatus: 'Group status tool.'
    }],
    ['AI', {
        Aivoice: 'Read your text out loud as a voice note.',
        'Aivoice-male': 'Voice note in a male voice.',
        'Aivoice-female': 'Voice note in a female voice.',
        'Aivoice-hausa': 'Voice note in a Hausa male voice.',
        'Aivoice-hausa-female': 'Voice note in a Hausa female voice.',
        Ai: 'Ask the AI anything.',
        Search: 'AI powered web search.',
        Chatgpt: 'Ask ChatGPT a question.',
        Analyze: 'Let the AI analyse a replied image or text.',
        Aimusic: 'Generate music with AI.'
    }],
    ['ANIME', {
        Animeavatar: 'Random anime avatar.',
        Animeblush: 'Anime blushing reaction.',
        Animewave: 'Anime waving reaction.',
        Animesmile: 'Anime smiling reaction.',
        Animepoke: 'Anime poke reaction.',
        Animewink: 'Anime wink reaction.',
        Animebonk: 'Anime bonk reaction.',
        Animebully: 'Anime bully reaction.',
        Neko: 'Random neko image.',
        Waifu: 'Random waifu image.',
        Loli: 'Random loli image.'
    }],
    ['IMG MAKER', {
        Create: 'Create an image from your text.',
        Ephoto: 'Text effects from ephoto360.',
        Brat: 'Make a brat-style text sticker.',
        Toanime: 'Turn a photo into anime style.',
        Ephotolist: 'List available ephoto effects.',
        Imagine: 'AI image generation from a prompt.',
        Deepfake: 'Face swap on a replied image.',
        Firelogo: 'Make a fire text logo.',
        Fakeigstory: 'Create a fake Instagram story image.',
        Carbon: 'Turn code into a carbon image.'
    }],
    ['VOICE CHANGER', {
        Addvoice: 'Reply to a 10-20s recording to save it as a target voice.',
        Voices: 'List your saved target voices.',
        Delvoice: 'Delete a saved target voice.',
        Renamevoice: 'Rename a saved target voice.',
        Voicechanger: 'Turn voice conversion on with a saved voice, off, or see status.'
    }],
    ['CONVERT', {
        Sticker: 'Turn an image/video into a sticker.',
        Take: 'Re-brand a sticker with your pack name.',
        Toimage: 'Convert a sticker to an image.',
        Tovideo: 'Convert an animated sticker to video.',
        Toaudio: 'Extract audio from a video.',
        Tovideonote: 'Convert a video into a round video note.',
        Tomp3: 'Convert media into an mp3 file.',
        Tovn: 'Convert audio into a voice note.',
        Togif: 'Convert a sticker/video into a gif.',
        Toqr: 'Turn text or a link into a QR code.',
        Addpdf: 'Add a page to the PDF being built.',
        Img2pdf: 'Turn collected images into a PDF.',
        Clearpdf: 'Clear the collected PDF pages.',
        Url: 'Upload media and get a direct link.',
        Catbox: 'Upload media to catbox and get a link.',
        Img2txt: 'Read the text inside an image.',
        Get: 'Fetch the raw content of a URL.',
        Fliptext: 'Flip your text upside down.',
        Emojimix: 'Mix two emojis into a sticker.',
        Tiny: 'Shorten a long link.',
        Ssweb: 'Screenshot a website.',
        Imgbb: 'Upload an image to imgbb.',
        Tts: 'Text to speech.',
        Ocr: 'Extract text from an image.',
        Qrscan: 'Read a QR code from an image.',
        Vocalremover: 'Split a song into vocals and instrumental.',
        Colorize: 'Colorize an old black & white photo.',
        Remini: 'Enhance and sharpen a photo.',
        Translate: 'Translate text to another language.',
        Removebg: 'Remove the background of an image.',
        Toviewonce: 'Re-send media as a view-once message.'
    }],
    ['FUN', {
        Readmore: 'Hide long text behind "read more".',
        Define: 'Dictionary definition of a word.',
        Flux: 'AI art with the Flux model.',
        Quotes: 'Random quote.',
        Fact: 'Random fact.',
        Truth: 'Random truth question.',
        Google: 'Google search results.',
        Pickupline: 'Random pickup line.',
        Flirt: 'Random flirty line.',
        Story: 'Random short story.',
        Stickkill: 'Fun kill sticker on a tagged user.',
        Note: 'Save a personal note.',
        Roast: 'Roast a tagged user.',
        Predict: 'Fun prediction about someone.',
        Listnote: 'Show your saved notes.',
        Deletenote: 'Delete a saved note.',
        Insult: 'Random insult (fun).',
        Wasted: 'Wasted effect on a photo.',
        Fakechannel: 'Make a fake channel message.',
        Fakedana: 'Make a fake payment alert.',
        Country: 'Info about a country.',
        Telegramsticker: 'Download a Telegram sticker pack.',
        Rate: 'Rate a tagged person for fun.'
    }],
    ['DOWNLOADS', {
        Play: 'Search and send a song as audio.',
        Vocalremover: 'Separate vocals and instrumental from a song.',
        Get: 'Download the content of a direct link.',
        Ytmp3: 'Download YouTube audio.',
        Ytmp4: 'Download YouTube video.',
        Mediafire: 'Download a Mediafire file.',
        Wallpaper: 'Search wallpapers.',
        Hdwallpaper: 'Search HD wallpapers.',
        Pinterest: 'Search Pinterest images.',
        Tiktok: 'Download a TikTok video without watermark.',
        Instagram: 'Download Instagram media.',
        Facebook: 'Download a Facebook video.',
        Img: 'Search and send images.',
        Aio: 'All-in-one downloader for any supported link.',
        Fdroid: 'Download an app from F-Droid.',
        Imgsearch: 'Search the web for images.',
        Song: 'Download a song by name.',
        Twitter: 'Download a Twitter/X video.',
        Apk: 'Download an Android app.',
        Spotify: 'Download a Spotify track.',
        Spotifysearch: 'Search Spotify tracks.',
        Gitclone: 'Download a GitHub repository as zip.',
        Splay: 'Play a song from Spotify.',
        Nsfw: 'NSFW content (18+).',
        Npm: 'Look up an npm package.',
        Knackvideo: 'Download a Knack video.',
        Tiktokstalk: 'Show a TikTok profile.'
    }],
    ['GENERAL', {
        Owner: 'Show the bot owner contact.',
        Help: 'Explain what every command does, section by section.',
        Doubletick: 'Always show the sender 2 delivered ticks, never a blue tick (all chats, this chat, or one number).',
        Dpdownload: 'Download a profile picture — send it inside the person\'s DM, or use .dpdownload <phone number>.',
        'Chat-id': 'Show a chat id — .chat-id in the chat, or .chat-id <phone number>.',
        Menu: 'Show the full command list.',
        Test: 'Check that the bot is responding.',
        Alive: 'Show the bot status card.',
        Runtime: 'How long the bot has been running.',
        Script: 'Link to the bot source.',
        Donate: 'Support the bot owner.',
        Clearchat: 'Clear the current chat.',
        Delete: 'Delete a replied message.',
        Getpp: 'Get someone\'s profile picture.',
        Gemini: 'Ask Google Gemini a question.',
        Elevenlab: 'Realistic AI voice from text.',
        Lyrics: 'Get the lyrics of a song.',
        Yts: 'Search YouTube.',
        Vv: 'Reveal a view-once media in the same chat.',
        Getgrouppp: 'Get the group profile picture.',
        Copy: 'Copy a replied message.',
        Vvdm: 'Recover a view-once media and send it to your DM.',
        '8ballpool': 'Ask the magic 8 ball.',
        Bible: 'Read a bible verse.',
        Quran: 'Read a Quran verse.',
        Shazam: 'Identify a song from audio.',
        Statusd: 'Download a replied status.',
        Audiospeed: 'Speed up or slow down audio.',
        Eval: 'Run code (owner only).',
        Jid: 'Show the chat JID.',
        Lid: 'Show the chat LID.',
        Tempmail: 'Create a temporary email address.',
        Tempinbox: 'Read the temporary email inbox.',
        Poll: 'Create a poll.',
        'Channel-id': 'Show a WhatsApp channel ID.',
        'Group-id': 'Show the group ID.',
        Pair: 'Pair a new session with a session id.'
    }]
];

function helpForCommand(name) {
    const key = String(name || '').toLowerCase();
    for (const [section, items] of HELP_SECTIONS) {
        for (const [cmd, desc] of Object.entries(items)) {
            if (cmd.toLowerCase() === key) return `📖 *${cmd}* — ${section}\n\n${desc}`;
        }
    }
    return null;
}

function helpSectionText(section, items, prefix) {
    const lines = Object.entries(items)
        .map(([cmd, desc]) => `│ *${prefix}${cmd.toLowerCase()}*\n│ ↳ ${desc}`)
        .join('\n│\n');
    return `┏━━━━━━━━━━━━━━━❍\n┗┳❍ 「 *${section}* 」❍\n┏┻━━━━━━━━━━━━━━❍\n${lines}\n┗━━━━━━━━━━━━━━━❍`;
}

async function handleExtraCommands(EliteProTech, m) {


    const prefix = global.prefix ?? '.';
    const body = extractBody(m);
    if (!body) return false;

    /* V2 shell keeps its own "$" prefix. */
    if (body.startsWith('$')) {
        return await v2.handleShell(EliteProTech, m, {
            body,
            reply: (text) => EliteProTech.sendMessage(m.chat, { text }, { quoted: m }),
            isOwner: isOwnerSender(m)
        });
    }

    if (!body.startsWith(prefix)) return false;

    const rest = body.slice(prefix.length).replace(/^\s+/, '');
    const command = (rest.split(/\s+/)[0] || '').toLowerCase();
    const args = rest.slice(command.length).replace(/^[^\S\n]+/, '').replace(/^\n/, '').trim();

    const reply = (text) => errorReporting.replyText(EliteProTech, m, text);
    const isGroupChat = String(m.chat || '').endsWith('@g.us');

    /* ---------- VOICE CHANGER (Seed-VC speech-to-speech) ---------- */
    if (await voiceChanger.handleCommands(EliteProTech, m, { command, args, reply, prefix, isOwner: isOwnerSender(m) })) return true;

    /* ---------- CBS-SCOVER-V2 commands ---------- */
    if (await v2.handleCommands(EliteProTech, m, { command, args, reply, prefix, isOwner: isOwnerSender(m) })) return true;


    /* ---------- HELP ---------- */
    if (command === 'help') {
        if (args) {
            const one = helpForCommand(args.replace(/^[./!#]/, '').trim());
            await reply(one || `❔ No help found for *${args}*. Send *${prefix}help* for the full list.`);
            return true;
        }
        await reply(
            `📖 *CBS-SCOVER HELP*\n\nWhat every command does, section by section.\n` +
            `Send *${prefix}help <command>* for one command only.`
        );
        for (const [section, items] of HELP_SECTIONS) {
            await reply(helpSectionText(section, items, prefix));
            await new Promise(r => setTimeout(r, 600));
        }
        return true;
    }


    /* ---------- PROMOTE (no admin check on our side) ---------- */
    if (command === 'promote') {
        if (!isGroupChat) {
            await reply('ℹ️ Use this command inside a group.');
            return true;
        }
        const mentioned = m.msg?.contextInfo?.mentionedJid || m.mentionedJid || [];
        const quotedSender = m.msg?.contextInfo?.participant;
        const numeric = (args.match(/[0-9]{7,16}/g) || []).map(n => `${n}@s.whatsapp.net`);
        const targets = [...new Set([...mentioned, ...numeric, ...(quotedSender ? [quotedSender] : [])])];
        if (!targets.length) {
            await reply(`👑 Tag, reply to, or type the number of the person:\n*${prefix}promote @user*`);
            return true;
        }
        const ok = [];
        const failed = [];
        for (const jid of targets) {
            let done = false;
            for (let attempt = 0; attempt < 3 && !done; attempt++) {
                try {
                    await EliteProTech.groupParticipantsUpdate(m.chat, [jid], 'promote');
                    done = true;
                } catch (err) {
                    if (attempt === 2) console.error('promote error:', err?.message || err);
                    await new Promise(r => setTimeout(r, 700));
                }
            }
            (done ? ok : failed).push(jid);
        }
        let text = '';
        if (ok.length) text += `👑 Promoted to admin:\n${ok.map(j => '@' + j.split('@')[0]).join('\n')}\n`;
        if (failed.length) {
            text += `\n❌ WhatsApp refused the promotion for:\n${failed.map(j => '@' + j.split('@')[0]).join('\n')}\n\n` +
                `Promotion is enforced by WhatsApp's servers — the bot itself must be a group admin. No client-side bypass exists.`;
        }
        await EliteProTech.sendMessage(m.chat, { text: text.trim(), mentions: targets }, { quoted: m });
        return true;
    }

    /* ---------- USERNAME (settings) ---------- */

    if (command === 'username' || command === 'setusername') {
        const current = readJson(USERNAME_FILE, {}).name || '';
        if (!args) {
            await reply(
                `👤 *USERNAME*\n\nCurrent: *${current || 'not set'}*\n\nSet it with:\n*${prefix}username <your name>*`
            );
            return true;
        }
        const name = args.slice(0, 40);
        writeJson(USERNAME_FILE, { name });
        global.username = name;
        await reply(`✅ Username set to *${name}*.`);
        return true;
    }

    /* ---------- GROUP PROFILE PICTURE ---------- */
    if (command === 'grouppp' || command === 'groupfullpp' || command === 'setgrouppp') {
        if (!isGroupChat) {
            await reply('ℹ️ Use this command inside a group.');
            return true;
        }
        const source = imageSource(m);
        if (!source) {
            await reply(`🖼️ Reply to an image (or send the image with the caption) using *${prefix}${command}*.`);
            return true;
        }
        try {
            const raw = await downloadQuoted(EliteProTech, source);
            if (command === 'groupfullpp') {
                const padded = await padToSquare(raw);
                await EliteProTech.updateProfilePicture(m.chat, padded);
                await reply('✅ Group profile picture updated — full image, nothing cropped out.');
            } else {
                const cropped = await cropSquare(raw);
                await EliteProTech.updateProfilePicture(m.chat, cropped);
                await reply('✅ Group profile picture updated (cropped).');
            }
        } catch (err) {
            console.error('grouppp error:', err?.message || err);
            await reply(`❌ Could not set the group picture.\n${err?.message || err}\n\nI must be a group admin to change it.`);
        }
        return true;
    }



    /* ---------- VIEW ONCE TO DM ---------- */
    if (['vvdm', 'vv2', 'viewoncedm', 'vv', 'viewonce'].includes(command)) {
        const toDm = !['vv', 'viewonce'].includes(command);
        const q = quotedInfo(m);
        if (!q) {
            await reply(`👁️ Reply to a view-once message with *${prefix}${command}*.`);
            return true;
        }
        let lastErr;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const target = toDm ? ownerJid(EliteProTech) : m.chat;
                await sendViewOnceCopy(EliteProTech, q, target, m);
                if (toDm) await EliteProTech.sendMessage(m.chat, { text: '✅ View-once media recovered and sent to your DM.' }, { quoted: m });
                return true;
            } catch (err) {
                lastErr = err;
                if (String(err?.message).includes('unsupported')) break;
                await new Promise(r => setTimeout(r, 1500));
            }
        }
        console.error(`${command} error:`, lastErr?.message || lastErr);
        await reply(String(lastErr?.message).includes('unsupported')
            ? '⚠️ That message is not a view-once photo, video or voice note.'
            : '❌ Could not recover that view-once. WhatsApp may have expired the media — ask for it to be resent and reply with the command soon after it arrives.');
        return true;
    }



    if (command === 'chatbotname' || command === 'botname') {
        const current = readJson(NAME_FILE, {}).name || 'CBS-SCOVER';
        if (!args) {
            await reply(
                `🤖 *CHATBOT NAME*\n\nCurrent name: *${current}*\n\nSet a new one with:\n*${prefix}chatbotname <name>*\n\nExample: ${prefix}chatbotname Sadiq`
            );
            return true;
        }
        const name = args.slice(0, 40);
        writeJson(NAME_FILE, { name });
        await reply(`✅ Chatbot name set to *${name}*.\nFrom now on the chatbot replies as ${name}.`);
        return true;
    }

    // Turns "1234567890-123456@g.us", "1234567890-123456" or a phone number
    // into a usable chat id, so both commands can be aimed at a remote chat.
    const resolveChatTarget = (raw) => {
        const value = String(raw || '').trim();
        if (!value) return '';
        if (value.endsWith('@g.us') || value.endsWith('@s.whatsapp.net') || value.endsWith('@lid')) return value;
        const digits = value.replace(/[^0-9-]/g, '');
        if (!digits) return '';
        return digits.includes('-') ? `${digits}@g.us` : `${digits}@s.whatsapp.net`;
    };
    const normalizeAction = (word) => {
        const w = String(word || '').toLowerCase();
        if (['enable', 'on', 'activate', 'active'].includes(w)) return 'on';
        if (['disable', 'off', 'deactivate', 'inactive'].includes(w)) return 'off';
        return '';
    };

    if (command === 'antideletemessage' || command === 'antideletemsg') {
        const config = readJson(ANTIDELETE_FILE, { enabled: false, chats: {} });
        config.chats = config.chats || {};
        const words = args.trim().split(/\s+/).filter(Boolean);
        // .antideletemessage <group-id|phone> activate/deactivate  (remote)
        let target = '';
        let action = normalizeAction(words[0]);
        if (!action && words.length >= 2) {
            target = resolveChatTarget(words[0]);
            action = normalizeAction(words[1]);
        }

        if (action) {
            if (target) {
                if (String(target).endsWith('@g.us')) {
                    await reply(`⚠️ *Anti-delete message covers individual chats only.*\nFor groups use:\n*${prefix}antideletegroup-public ${target} activate*`);
                    return true;
                }
                config.chats[target] = action === 'on';
                writeJson(ANTIDELETE_FILE, config);
                // Switching it off forgets everything stored for that chat.
                if (action === 'off') { try { global.antiDeleteClearStore?.(target); } catch {} }
                await reply(
                    action === 'on'
                        ? `✅ *Anti-delete message activated* for \`${target}\`.`
                        : `❌ *Anti-delete message deactivated* for \`${target}\`.\nStored messages for that chat were forgotten — nothing will be restored again.`
                );
                return true;
            }
            config.enabled = action === 'on';
            writeJson(ANTIDELETE_FILE, config);
            if (action === 'off') { try { global.antiDeleteClearStore?.(); } catch {} }
            await reply(
                action === 'on'
                    ? '✅ *Anti-delete message enabled* — individual chats only.\nDeleted messages will be re-shown with a ⚠️ *This message was deleted* mark.\nGroup messages are not covered — use *antideletegroup* for groups.\nMessages you delete yourself are never restored.'
                    : '❌ *Anti-delete message disabled.*\nAll stored messages were forgotten and no deleted message will be sent again.'
            );
            return true;
        }


        await reply(
            `🗑️ *ANTI DELETE MESSAGE* (individual chats only)\n\nStatus: ${config.enabled ? '✅ ENABLED' : '❌ DISABLED'}\n\n` +
            `*${prefix}antideletemessage activate*\n*${prefix}antideletemessage deactivate*\n` +
            `*${prefix}antideletemessage <phone> activate*\n*${prefix}antideletemessage <phone> deactivate*\n\n` +
            `_Groups are handled by ${prefix}antideletegroup. Your own deletions are never recovered._`
        );
        return true;
    }

    if (command.startsWith('antideletegroup')) {
        const config = readJson(ANTIDELETE_GROUP_FILE, { all: false, chats: {} });
        config.chats = config.chats || {};
        const isGroup = String(m.chat || '').endsWith('@g.us');
        let mode = command.includes('-public') ? 'public' : command.includes('-private') ? 'private' : null;
        const words = args.trim().split(/\s+/).filter(Boolean);
        if (!mode && /^(public|private)$/i.test(words[0] || '')) mode = words.shift().toLowerCase();

        // Accepted: "<action>", "<group-id> <action>", "<action> <group-id>"
        let action = normalizeAction(words[0]);
        let target = '';
        if (action) {
            target = resolveChatTarget(words[1]);
        } else if (words.length >= 2) {
            target = resolveChatTarget(words[0]);
            action = normalizeAction(words[1]);
        }
        const chat = target || m.chat;
        const current = config.chats[chat];
        const currentMode = current === true ? 'public' : current || null;

        if (action === 'on' || (mode && !action && isGroup)) {
            if (!target && !isGroup) {
                await reply(`ℹ️ Use this inside the group, or pass the group id:\n*${prefix}${command} <group-id> activate*`);
                return true;
            }
            if (!String(chat).endsWith('@g.us')) {
                await reply(`⚠️ *Anti-delete group only works on groups.*\nFor an individual chat use:\n*${prefix}antideletemessage ${chat} activate*`);
                return true;
            }
            config.chats[chat] = mode || 'public';
            config.all = false;
            writeJson(ANTIDELETE_GROUP_FILE, config);

            await reply(
                (config.chats[chat] === 'private'
                    ? `🔒 *Anti-delete group: PRIVATE* for \`${chat}\`.\nDeleted messages are restored to your DM only.`
                    : `📢 *Anti-delete group: PUBLIC* for \`${chat}\`.\nDeleted messages are restored inside the group, tagging who sent it and who deleted it.`) +
                `\n_Only this group is covered. Messages you delete yourself are never restored._`
            );
            return true;
        }
        if (action === 'off') {
            delete config.chats[chat];
            if (!target) config.all = false;
            writeJson(ANTIDELETE_GROUP_FILE, config);
            // Forget everything kept for that group.
            try { global.antiDeleteClearStore?.(chat); } catch {}
            await reply(`❌ *Anti-delete group deactivated* for \`${chat}\`.\nStored messages for that group were forgotten — no deleted message will be sent again.`);
            return true;
        }

        await reply(
            `🛡️ *ANTI DELETE GROUP*\n\nStatus for \`${chat}\`: ${currentMode ? `✅ ${currentMode.toUpperCase()}` : '❌ DISABLED'}\n\n` +
            `*${prefix}antideletegroup-public activate* — restore inside the group\n` +
            `*${prefix}antideletegroup-private activate* — restore to your DM\n` +
            `*${prefix}antideletegroup-public <group-id> activate*\n` +
            `*${prefix}antideletegroup-private <group-id> activate*\n` +
            `*${prefix}antideletegroup-public <group-id> deactivate*\n\n` +
            `_Your own deletions are never recovered._`
        );
        return true;
    }



    /* ---------- CHATBOT: normal / love / friend ---------- */
    if (command === 'chatbot' || command === 'chatbot-friend' || command === 'chatbot-love') {
        const persona = command === 'chatbot-friend' ? 'friend' : command === 'chatbot-love' ? 'love' : 'normal';
        const store = readJson(CHATBOT_FILE, {});
        store.chats = store.chats || {};
        store.modes = store.modes || {};
        store.genders = store.genders || {};
        store.disabled = store.disabled || {};

        const parts = args.toLowerCase().split(/\s+/).filter(Boolean);
        const isGroup = String(m.chat || '').endsWith('@g.us');
        const save = () => writeJson(CHATBOT_FILE, store);

        const genderKey = persona === 'love' ? 'loveGender' : persona === 'friend' ? 'friendGender' : 'gender';
        const currentGender = store.genders[m.chat] || store[genderKey] || 'not set';
        const hereMode = store.modes[m.chat] || 'normal';
        const hereOn = persona === 'normal'
            ? (hereMode === 'normal' && (store.chats[m.chat] === true ||
                (!store.disabled[m.chat] && (store.global === true || (isGroup ? store.group === true : store.dm === true)))))
            : (hereMode === persona && store.chats[m.chat] === true);

        const status = () => {
            const head =
                `🤖 *CHATBOT${persona === 'normal' ? '' : ' — ' + persona.toUpperCase()}*\n\n` +
                `Here: ${hereOn ? '✅ ON' : '❌ OFF'}\n` +
                `DMs: ${store.dm ? '✅' : '❌'}  |  Groups: ${store.group ? '✅' : '❌'}\n` +
                `Personality here: *${hereMode}*\n` +
                `Gender here: *${currentGender}*\n\n`;
            if (persona === 'normal') {
                return head +
                    `*${prefix}chatbot dm on/off*\n` +
                    `*${prefix}chatbot group on/off*\n` +
                    `*${prefix}chatbot here on/off*\n` +
                    `*${prefix}chatbot all on/off*\n` +
                    `*${prefix}chatbot gender male/female*\n` +
                    `*${prefix}chatbot gender here female/male*`;
            }
            return head +
                `*${prefix}${command} on/off*\n` +
                `*${prefix}${command} gender female/male*\n` +
                `*${prefix}${command} gender here female/male*\n\n` +
                `_${persona === 'love' ? 'Love' : 'Friend'} personality works in individual chats only._`;
        };

        /* ----- gender ----- */
        if (parts[0] === 'gender') {
            const here = parts[1] === 'here' || parts[1] === 'this';
            const want = here ? parts[2] : parts[1];
            if (want === 'male' || want === 'female') {
                if (here) store.genders[m.chat] = want;
                else store[genderKey] = want;
                save();
                await reply(
                    `${want === 'female' ? '👩' : '👨'} ${persona === 'normal' ? 'Chatbot' : persona === 'love' ? 'Chatbot-love' : 'Chatbot-friend'} gender set to *${want}*` +
                    `${here ? ' *in this chat only*' : ' for all chats (chats with their own gender keep theirs)'}.`
                );
                return true;
            }
            if (want === 'off' || want === 'reset' || want === 'none') {
                if (here) delete store.genders[m.chat];
                else delete store[genderKey];
                save();
                await reply(`✅ Gender cleared${here ? ' for this chat' : ''}.`);
                return true;
            }
            await reply(status());
            return true;
        }

        const state = parts[parts.length - 1];
        const on = state === 'on' || state === 'enable';
        const off = state === 'off' || state === 'disable';
        const scope = parts[0] || '';

        /* ----- love / friend: individual chats only, per-chat switch ----- */
        if (persona !== 'normal') {
            if (!on && !off) {
                await reply(status());
                return true;
            }
            if (isGroup) {
                await reply(`ℹ️ *Chatbot-${persona}* only works in individual chats, not in groups.`);
                return true;
            }
            if (on) {
                store.modes[m.chat] = persona;
                store.chats[m.chat] = true;
                delete store.disabled[m.chat];
                save();
                await reply(
                    persona === 'love'
                        ? '💖 *Chatbot-love is ON in this chat.* The normal personality is switched off here.'
                        : '🤝 *Chatbot-friend is ON in this chat.* The normal personality is switched off here.'
                );
                return true;
            }
            delete store.modes[m.chat];
            delete store.chats[m.chat];
            store.disabled[m.chat] = true;   // normal stays off until switched on again
            save();
            await reply(`✅ *Chatbot-${persona} is OFF here.* The normal chatbot stays off until you run *${prefix}chatbot here on*.`);
            return true;
        }

        /* ----- normal chatbot switches ----- */
        if ((scope === 'here' || scope === 'this') && (on || off)) {
            if (on) {
                store.chats[m.chat] = true;
                delete store.modes[m.chat];
                delete store.disabled[m.chat];
            } else {
                delete store.chats[m.chat];
                store.disabled[m.chat] = true;
            }
            save();
            await reply(on ? '🤖 Chatbot is now ON in this chat (normal personality).' : '🤖 Chatbot is now OFF in this chat.');
            return true;
        }
        if (scope === 'dm' && (on || off)) {
            store.dm = on;
            save();
            await reply(on ? '🤖 Chatbot is now ON for all DMs.' : '🤖 Chatbot is now OFF for DMs.');
            return true;
        }
        if (scope === 'group' && (on || off)) {
            store.group = on;
            save();
            await reply(on ? '🤖 Chatbot is now ON in all groups.' : '🤖 Chatbot is now OFF in groups.');
            return true;
        }
        if ((scope === 'all' || scope === 'global') && (on || off)) {
            store.global = on;
            store.dm = on;
            store.group = on;
            save();
            await reply(on ? '🤖 Chatbot is now ON everywhere.' : '🤖 Chatbot is now OFF everywhere.');
            return true;
        }
        if (on || off) {
            if (on) {
                store.chats[m.chat] = true;
                delete store.modes[m.chat];
                delete store.disabled[m.chat];
            } else {
                delete store.chats[m.chat];
                store.disabled[m.chat] = true;
            }
            save();
            await reply(on ? '🤖 Chatbot is now ON in this chat.' : '🤖 Chatbot is now OFF in this chat.');
            return true;
        }

        await reply(status());
        return true;
    }


    /* ---------- DOUBLE TICK ---------- */
    if (command === 'doubletick') {
        if (typeof global.handleTickCommand === 'function') {
            await global.handleTickCommand(EliteProTech, m, args, 'double', prefix);
        } else {
            await reply('⚠️ Tick control is not loaded yet, try again in a moment.');
        }
        return true;
    }

    /* ---------- DP DOWNLOAD ---------- */
    if (command === 'dpdownload' || command === 'dpdl') {
        if (typeof global.handleDpDownload === 'function') {
            await global.handleDpDownload(EliteProTech, m, args, prefix);
        } else {
            await reply('⚠️ Not loaded yet, try again in a moment.');
        }
        return true;
    }

    /* ---------- CHAT ID ---------- */
    if (command === 'chat-id' || command === 'chatid') {
        if (typeof global.handleChatId === 'function') {
            await global.handleChatId(EliteProTech, m, args, prefix);
        } else {
            await reply('⚠️ Not loaded yet, try again in a moment.');
        }
        return true;
    }

    return false;
}



/* ============================ HANDLER PATCHES ============================ */

function patchHandler(source, proxyBase) {
    let code = String(source);

    // The upstream API host is currently failing (HTTP 500 / 403 auth) on the
    // download and shazam routes, so all of its traffic is routed through the
    // local fallback proxy, which repairs those routes and forwards the rest.
    if (proxyBase) {
        code = code.split(apiProxy.UPSTREAM).join(proxyBase);
    }

    // Bot image was renamed during rebranding.
    code = code.split('elitepropic.jpg').join('cbs-scover.jpg');


    // Panel is disabled: never treated as a command, and gone from the menu.
    code = code.split("case 'panel': {").join("case '__panel_disabled__': {");
    code = code.split('│𖥟╾ Panel\n').join('').split('│𖥟╾ Panel \n').join('');

    // Welcome/goodbye switch is handled locally (global + per-group scopes).
    const welcomeCase = "case 'welcome': {";
    if (code.includes(welcomeCase)) {
        code = code.split(welcomeCase).join(
            "case 'welcome': {\n    await global.handleWelcomeCommand(EliteProTech, m, args, prefix)\n}\nbreak\ncase '__welcome_legacy__': {"
        );
    } else {
        console.log('⚠️ Welcome command patch target not found.');
    }


    // Menu title.
    code = code.split('┃ *ᴇʟɪᴛᴇ-ᴘʀᴏ-ᴠɪ ʙᴏᴛ ᴍᴇɴᴜ*').join('┃ *CBS-SCOVER*');

    // Remove any leftover plain group link line in the menu body.
    code = code.split(`\n┣❍ *ɢʀᴏᴜᴘ:* ${GROUP_LINK}`).join('');

    // List the locally added commands in the menu.
    const addAfter = (anchor, extra, label) => {
        if (code.includes(anchor)) {
            code = code.split(anchor).join(anchor + extra);
        } else {
            console.log(`⚠️ Menu ${label} patch target not found.`);
        }
    };

    // SETTINGS
    addAfter('│𖥟╾ Antidelete\n', '│𖥟╾ Antideletemessage\n│𖥟╾ Chatbotname\n│𖥟╾ Username\n│𖥟╾ Chatbot-friend\n│𖥟╾ Chatbot-love\n│𖥟╾ Chatbot gender\n', 'settings-commands');
    // GROUP
    addAfter('│𖥟╾ Tagadmin\n', '│𖥟╾ Antideletegroup-public\n│𖥟╾ Antideletegroup-private\n│𖥟╾ Grouppp\n│𖥟╾ Groupfullpp\n│𖥟╾ Groupstatus\n', 'group-commands');
    // GENERAL
    addAfter('│𖥟╾ Owner\n', '│𖥟╾ Help\n│𖥟╾ Doubletick\n│𖥟╾ Dpdownload\n│𖥟╾ Chat-id\n', 'general-commands');

    // DOWNLOADS
    addAfter('│𖥟╾ Play\n', '│𖥟╾ Vocalremover\n│𖥟╾ Get\n', 'download-commands');

    if (code.includes('│𖥟╾ Aivoice\n')) {
        code = code.split('│𖥟╾ Aivoice\n').join('│𖥟╾ Aivoice\n│𖥟╾ Aivoice-male\n│𖥟╾ Aivoice-female\n│𖥟╾ Aivoice-hausa\n│𖥟╾ Aivoice-hausa-female\n');
    } else {
        console.log('⚠️ Menu ai-commands patch target not found.');
    }

    // Route the menu through our own sender (no buttons, plain image + list).
    const menuSend = `await EliteProTech.sendMessage(m.chat, {
  image: elitepropic,
  caption: elitemenuoh
}, { quoted: m });`;
    const menuCall = 'await global.sendMenu(EliteProTech, m, elitepropic, elitemenuoh);';
    if (code.includes(menuSend)) {
        code = code.split(menuSend).join(menuCall);
    } else {
        // Whitespace/formatting in the remote source can change; match loosely
        // so the menu is always routed through our sender instead of silently
        // never being delivered.
        const loose = /await\s+EliteProTech\.sendMessage\(\s*m\.chat\s*,\s*\{\s*image\s*:\s*elitepropic\s*,\s*caption\s*:\s*elitemenuoh\s*,?\s*\}\s*,\s*\{[^}]*\}\s*\)\s*;?/g;
        if (loose.test(code)) {
            code = code.replace(loose, menuCall);
        } else {
            console.log('⚠️ Menu send patch target not found.');
        }
    }


    // Mode is global for the whole bot (stored in database/mode.json), never
    // per chat: private = only the owner numbers (and the bot itself) can run
    // commands anywhere, public = everyone can. Keep the upstream gate as-is.


    // Branding
    code = code
        .split('2347047504860').join(OWNER_NUMBER)
        .split('https://t.me/eliteprotechs').join('https://t.me/cbsscover')
        .split('https://www.youtube.com/@eliteprotechs').join(CHANNEL_LINK)
        .split('https://eliteprotech.zone.id/').join('https://codebreakers.uk/')
        .split('ᴇʟɪᴛᴇ-ᴘʀᴏ-ᴛᴇᴄʜ').join('ᴄʙꜱ-ꜱᴄᴏᴠᴇʀ')
        .split('ᴇʟɪᴛᴇᴘʀᴏ-ᴛᴇᴄʜ').join('ᴄʙꜱ-ꜱᴄᴏᴠᴇʀ');

    return code;
}

// Global (bot-wide) mode gate for the locally added commands, so private mode
// applies in every chat and not only where it was switched on.
function isBotPublic() {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, 'database', 'mode.json'), 'utf8')).mode === 'public';
    } catch {
        return false;
    }
}

function isOwnerSender(m) {
    if (m?.key?.fromMe) return true;
    const num = String(m?.sender || '').split('@')[0].split(':')[0];
    const owners = [String(global.ownernumber || '')];
    try {
        const list = JSON.parse(fs.readFileSync(path.join(__dirname, 'database', 'owner.json'), 'utf8'));
        if (Array.isArray(list)) owners.push(...list.map(String));
    } catch {}
    return owners.some(o => o && o.replace(/\D/g, '') === num.replace(/\D/g, ''));
}

/* ---------- Command reactions ----------
 * Every command message gets an emoji reaction the moment it arrives,
 * including remote-handler commands like .shazam and .vocalremover.
 */
const COMMAND_REACTIONS = {
    shazam: '🎧', whatmusic: '🎧', findsong: '🎧',
    vocalremover: '🎼', vocal: '🎼',
    voicechanger: '🎙️', addvoice: '🎙️', voices: '🎙️', delvoice: '🗑️', renamevoice: '✏️',
    play: '🎵', song: '🎵', video: '🎬', ytmp3: '🎵', ytmp4: '🎬',
    sticker: '🩹', menu: '📜', help: '📜', ai: '🤖', chatgpt: '🤖',
    calculator: '🧮', calc: '🧮', dino: '🦖', doom: '🔫', piano: '🎹',
    ping: '🏓', speed: '🏓', settings: '⚙️', setting: '⚙️',
    autoviewlike: '👀', avl: '👀', sendhtml: '🧩', html: '🧩'
};
const reacted = new Set();

async function reactToCommand(EliteProTech, m) {
    try {
        const parsed = v2.parseCommand(v2.messageText(m));
        if (!parsed || !(await v2.isKnownCommand(parsed.command))) return;
        const { command } = parsed;

        const id = `${m.chat}|${m.key?.id}`;
        if (reacted.has(id)) return;
        reacted.add(id);
        if (reacted.size > 500) reacted.delete(reacted.values().next().value);

        const emoji = COMMAND_REACTIONS[command] || '⚡';
        await EliteProTech.sendMessage(m.chat, { react: { text: emoji, key: m.key } }).catch(() => {});
    } catch {}
}


module.exports = async (EliteProTech, m, chatUpdate, store) => {
    return errorReporting.withErrorContext(EliteProTech, m, async () => {
    try {
        if (!v2.claimMessage(EliteProTech, m)) return;
        rememberViewOnce(m);
        /* Initialize before parsing, including replacement sockets. */
        await v2.init(EliteProTech);
        // Double tick behaviour is applied before anything else.
        try { await global.applyTickOnMessage?.(EliteProTech, m); } catch (e) { console.error('tick hook:', e?.message || e); }

        const allowed = isBotPublic() || isOwnerSender(m);
        if (allowed) {
            if (await menuButtons.handleMenuButtonReply(EliteProTech, m)) return;
            const body = v2.messageText(m);
            const parsed = v2.parseCommand(body);
            if (body.startsWith(global.prefix ?? '.') && (!parsed || !(await v2.isKnownCommand(parsed.command)))) return;
            await reactToCommand(EliteProTech, m);
            // Chatbot controls have one owner, not the archive side listener.
            if (parsed && await global.chatbotCommand?.(EliteProTech, m, body)) return;
            if (await handleAiVoice(EliteProTech, m)) return;
            if (await voiceChanger.handleVoiceNote(EliteProTech, m)) return;
            if (await handleExtraCommands(EliteProTech, m)) return;
        }



        if (!cachedHandler) {
            const proxyBase = await apiProxy.start();
            // Commands come from the bundled updated V1 source, never from an
            // access/license host, so no external request is made at load time.
            const data = fs.readFileSync(HANDLER_FILE, 'utf8');
            const mod = { exports: {} };
            eval(`(function(module,exports,require,console){\n${patchHandler(data, proxyBase)}\n})`)(mod, mod.exports, require, errorReporting.handlerConsole);

            if (typeof mod.exports !== 'function') throw new Error('Invalid local V1 command handler');
            cachedHandler = mod.exports;
        }

        return await cachedHandler(EliteProTech, m, chatUpdate, store);
    } catch (err) {
        await errorReporting.reportError(EliteProTech, m, err, 'Command');
    }
    });
};
