/* =========================================================================
   RomanticVideoKnowledgeEngine
   -------------------------------------------------------------------------
   A COMPLETELY SEPARATE process from the live chatbot.

   It searches publicly accessible internet video search pages, keeps only the
   public metadata it is allowed to read (title / description / channel), asks
   the model to describe CONVERSATIONAL PATTERNS from that material, and stores
   short summarised style notes in its own cache file.

   Hard rules honoured here:
   - Never logs in, never touches private accounts / groups / messages, never
     solves captchas, never bypasses rate limits or platform security.
   - Never stores or reuses dialogue: only summarised patterns are kept.
   - Never called from the live message path. Live chat only READS the cache
     through readVideoKnowledge()/relevantVideoKnowledge().
   - One failing video or source is skipped; the rest keeps going.
   ========================================================================= */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const keyServer = require('./keyserver');

const DB_FILE = path.join(__dirname, '..', 'database', 'videoknow.json');

const CATEGORIES = [
    'HAUSA_FIRST_CONTACT', 'HAUSA_GREETING', 'HAUSA_GETTING_TO_KNOW', 'HAUSA_PLAYFUL',
    'HAUSA_COMPLIMENT', 'HAUSA_AFFECTION', 'HAUSA_FLIRTING', 'HAUSA_REASSURANCE',
    'HAUSA_GOOD_MORNING', 'HAUSA_GOOD_NIGHT', 'HAUSA_APOLOGY',
    'HAUSA_CONVERSATION_CONTINUATION', 'HAUSA_CODE_SWITCHING', 'HAUSA_EMOJI_USAGE',
    'ENGLISH_FIRST_CONTACT', 'ENGLISH_GREETING', 'ENGLISH_GETTING_TO_KNOW',
    'ENGLISH_PLAYFUL', 'ENGLISH_COMPLIMENT', 'ENGLISH_AFFECTION', 'ENGLISH_FLIRTING',
    'ENGLISH_REASSURANCE', 'ENGLISH_GOOD_MORNING', 'ENGLISH_GOOD_NIGHT',
    'ENGLISH_APOLOGY', 'ENGLISH_CONVERSATION_CONTINUATION', 'ENGLISH_EMOJI_USAGE',
    'MIXED_CODE_SWITCHING', 'MIXED_AFFECTION', 'MIXED_PLAYFUL', 'MIXED_GREETING',
    'PIDGIN_GREETING', 'PIDGIN_PLAYFUL', 'PIDGIN_AFFECTION'
];

// Hausa / Nigerian material first, then general English.
const QUERIES = [
    'Hausa romantic conversation', 'Hausa love conversation', 'Hausa relationship conversation',
    'Hausa flirting', 'Hausa dating conversation', 'Hausa romantic texting',
    'Hausa relationship advice', 'Hausa WhatsApp conversation',
    'Hausa English romantic conversation', 'Nigerian Hausa love conversation',
    'Nigerian romantic conversation', 'Nigerian relationship conversation',
    'Nigerian pidgin romantic conversation',
    'romantic conversation', 'natural flirting conversation', 'relationship conversation',
    'romantic texting', 'affectionate conversation', 'relationship communication',
    'dating conversation', 'good morning romantic conversation', 'good night romantic conversation'
];

function readDb() {
    try {
        const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
        if (raw && typeof raw === 'object') {
            raw.sources = raw.sources || {};
            raw.knowledge = raw.knowledge || {};
            return raw;
        }
    } catch { /* first run / unreadable cache */ }
    return { updated: null, sources: {}, knowledge: {} };
}

function writeDb(db) {
    try {
        fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    } catch (err) {
        console.log('video knowledge save failed:', err?.message || err);
    }
}

function hashOf(text) {
    return crypto.createHash('sha256').update(String(text || '')).digest('hex').slice(0, 32);
}

// Strip links, handles and anything phone-number shaped before analysis.
function deIdentify(text) {
    return String(text || '')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/@[\w.]+/g, '')
        .replace(/\+?\d[\d\s-]{6,}\d/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 600);
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const VIDEO_KNOWLEDGE_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemma-4-31b-it'];

// Video-pattern analysis has its own Gemini authorization key. It never borrows
// the live chatbot key pool, so a refresh cannot consume or block chat traffic.
async function analyseWithDedicatedGemini(systemPrompt, userText) {
    // Key comes from the local environment (.env).
    const keys = await keyServer.videoGeminiKeys();
    if (!keys.length) throw new Error('Set GEMINI_YOUTUBE_KEY_1 through GEMINI_YOUTUBE_KEY_5 for video analysis');
    const configuredModel = process.env.GEMINI_VIDEO_MODEL?.trim();
    return keyServer.requestGemini({
        systemInstruction: { role: 'user', parts: [{ text: String(systemPrompt).slice(0, 12000) }] },
        contents: [{ role: 'user', parts: [{ text: String(userText).slice(0, 6000) }] }],
        generationConfig: { temperature: 0.4, topP: 0.9, maxOutputTokens: 1200 }
    }, { keys, models: configuredModel ? [configuredModel] : VIDEO_KNOWLEDGE_MODELS });
}

/* ---- public video search (no private access) ---------------------------- */
// Preferred: official YouTube Data API v3 using YOUTUBE_API_KEY from env.
async function searchYouTubeApi(query) {
    const key = String((await keyServer.youtubeKey()) || process.env.YOUTUBE_API_KEY || '').trim();
    if (!key) return [];
    const { data } = await axios.get('https://www.googleapis.com/youtube/v3/search', {
        timeout: 20000,
        headers: { 'x-goog-api-key': key },
        params: {
            q: query,
            part: 'snippet',
            type: 'video',
            maxResults: 12,
            relevanceLanguage: 'en',
            safeSearch: 'none'
        }
    });
    return (data?.items || []).map(item => ({
        source_url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
        source_type: 'video',
        source_domain: 'youtube.com',
        source_title: deIdentify(item.snippet?.title || ''),
        source_text: deIdentify(`${item.snippet?.title || ''}. ${item.snippet?.channelTitle || ''}. ${item.snippet?.description || ''}`)
    })).filter(v => v.source_text.length >= 12);
}

// Fallback: scrape public YouTube search HTML when no API key is configured
// or the API request fails (quota, network, etc).
async function searchYouTubeHtml(query) {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`;
    const { data } = await axios.get(url, {
        timeout: 20000,
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9,ha;q=0.8' }
    });
    const html = String(data);
    const start = html.indexOf('ytInitialData');
    if (start === -1) return [];
    const jsonStart = html.indexOf('{', start);
    const jsonEnd = html.indexOf('};', jsonStart);
    if (jsonStart === -1 || jsonEnd === -1) return [];
    let parsed;
    try {
        parsed = JSON.parse(html.slice(jsonStart, jsonEnd + 1));
    } catch {
        return [];
    }

    const found = [];
    const walk = (node) => {
        if (!node || typeof node !== 'object' || found.length >= 12) return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        const v = node.videoRenderer;
        if (v?.videoId) {
            const title = v.title?.runs?.map(r => r.text).join(' ') || '';
            const desc = (v.detailedMetadataSnippets || [])
                .map(s => (s.snippetText?.runs || []).map(r => r.text).join(' ')).join(' ');
            const channel = v.ownerText?.runs?.map(r => r.text).join(' ') || '';
            found.push({
                source_url: `https://www.youtube.com/watch?v=${v.videoId}`,
                source_type: 'video',
                source_domain: 'youtube.com',
                source_title: deIdentify(title),
                source_text: deIdentify(`${title}. ${channel}. ${desc}`)
            });
        }
        Object.values(node).forEach(walk);
    };
    walk(parsed);
    return found;
}

// Main entry: prefer the official API, fall back to public HTML search.
async function searchYouTube(query) {
    try {
        const viaApi = await searchYouTubeApi(query);
        if (viaApi.length) return viaApi;
    } catch (err) {
        console.log('youtube api search failed, using html fallback:', query, Number(err?.response?.status || 0) || 'network');
    }
    return searchYouTubeHtml(query);
}

async function searchDuckDuckGoVideos(query) {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query + ' video')}`;
    const { data } = await axios.get(url, { timeout: 20000, headers: { 'User-Agent': UA } });
    const html = String(data);
    const out = [];
    const re = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>|<a[^>]*href="(https?:\/\/[^"]+)"[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(html)) && out.length < 8) {
        const href = m[1] || m[3];
        const title = String(m[2] || m[4] || '').replace(/<[^>]+>/g, ' ');
        if (!href) continue;
        let domain = '';
        try { domain = new URL(href).hostname.replace(/^www\./, ''); } catch { continue; }
        out.push({
            source_url: href,
            source_type: 'web-video-page',
            source_domain: domain,
            source_title: deIdentify(title),
            source_text: deIdentify(title)
        });
    }
    return out;
}

/* ---- pattern extraction (never dialogue) ------------------------------- */
async function analyseBatch(batch) {
    const material = batch.map((b, i) => `${i + 1}. [${b.source_domain}] ${b.source_text}`).join('\n').slice(0, 5000);
    const prompt = `
You are building CONVERSATIONAL STYLE KNOWLEDGE for a Nigerian WhatsApp chat assistant (Hausa, Nigerian English, Pidgin, and Hausa+English mixing).

Below is PUBLIC video search metadata (titles/descriptions only) about romantic and relationship conversation.
Do NOT quote, translate or reproduce any sentence from it. Do NOT invent dialogue lines.
Instead, describe HOW such conversations behave: how they open, how greetings are answered, how people introduce themselves, ask questions, keep a chat alive, show interest, tease playfully, compliment, show affection, flirt, reassure, apologise, greet in the morning/at night, recover a dead chat, switch between Hausa and English, and how they use emojis.

Output ONLY lines in this exact pipe format, max 20 lines:
CATEGORY|LANGUAGE|TONE|style_tags(comma separated)|pattern summary (max 20 words, behaviour only, no example sentence)

LANGUAGE must be one of: HAUSA, ENGLISH, PIDGIN, HAUSA_ENGLISH, MIXED.
CATEGORY must be one of:
${CATEGORIES.join(', ')}

MATERIAL (patterns only, never copy):
${material}`.trim();

    const reply = String(await analyseWithDedicatedGemini(prompt, 'Produce the pattern lines now.') || '');
    const rows = [];
    for (const line of reply.split('\n')) {
        const parts = line.replace(/^\s*[-*\d.]+\s*/, '').split('|').map(p => p.trim());
        if (parts.length < 5) continue;
        const [cat, lang, tone, tags, pattern] = parts;
        const category = cat.toUpperCase();
        if (!CATEGORIES.includes(category)) continue;
        if (!pattern || pattern.length < 8) continue;
        rows.push({
            category,
            language: (lang || 'MIXED').toUpperCase().slice(0, 20),
            tone: (tone || 'warm').toLowerCase().slice(0, 40),
            style_tags: (tags || '').toLowerCase().slice(0, 120),
            pattern_summary: pattern.slice(0, 200)
        });
    }
    return rows;
}

function langBucket(language) {
    if (language === 'HAUSA') return 'hausa';
    if (language === 'ENGLISH') return 'english';
    return 'mixed';
}

/* ---- the refresh run (manual or scheduled, always background) ---------- */
let running = false;

async function refresh({ maxQueries = QUERIES.length } = {}) {
    if (running) throw new Error('a romantic video knowledge refresh is already running');
    running = true;
    const stats = {
        found: 0, processed: 0, skipped: 0, duplicates: 0, failedSources: 0,
        hausa: 0, english: 0, mixed: 0
    };
    try {
        const db = readDb();
        const fresh = [];

        for (const query of QUERIES.slice(0, maxQueries)) {
            let results = [];
            try {
                results = await searchYouTube(query);
            } catch (err) {
                stats.failedSources++;
                console.log('video source failed (youtube):', query, err?.message || err);
            }
            if (!results.length) {
                try {
                    results = await searchDuckDuckGoVideos(query);
                } catch (err) {
                    stats.failedSources++;
                    console.log('video source failed (web):', query, err?.message || err);
                }
            }
            for (const item of results) {
                stats.found++;
                if (!item.source_text || item.source_text.length < 12) { stats.skipped++; continue; }
                const content_hash = hashOf(item.source_text);
                const prev = db.sources[item.source_url];
                if (prev && prev.content_hash === content_hash) { stats.duplicates++; continue; }
                fresh.push({ ...item, content_hash, changed: !!prev });
            }
        }

        for (let i = 0; i < fresh.length; i += 8) {
            const batch = fresh.slice(i, i + 8);
            let rows = [];
            try {
                rows = await analyseBatch(batch);
            } catch (err) {
                stats.skipped += batch.length;
                console.log('video batch analysis failed:', err?.message || err);
                continue;
            }
            const now = new Date().toISOString();
            for (const b of batch) {
                db.sources[b.source_url] = {
                    id: hashOf(b.source_url),
                    source_url: b.source_url,
                    source_type: b.source_type,
                    source_title: b.source_title,
                    source_domain: b.source_domain,
                    content_hash: b.content_hash,
                    created_at: db.sources[b.source_url]?.created_at || now,
                    updated_at: now
                };
                stats.processed++;
            }
            for (const row of rows) {
                const bucket = langBucket(row.language);
                const list = db.knowledge[row.category] || [];
                const key = row.pattern_summary.toLowerCase().replace(/\W+/g, ' ').trim();
                if (list.some(e => e.pattern_summary.toLowerCase().replace(/\W+/g, ' ').trim() === key)) continue;
                list.unshift({ ...row, updated_at: now });
                db.knowledge[row.category] = list.slice(0, 6);
                stats[bucket]++;
            }
            db.updated = now;
            writeDb(db);
        }

        db.updated = new Date().toISOString();
        writeDb(db);
        return stats;
    } finally {
        running = false;
    }
}

/* ---- read side: this is the ONLY thing live chat may call -------------- */
function readVideoKnowledge() {
    return readDb();
}

// Picks a SMALL relevant subset from the cache — pure local lookup, no network.
function relevantVideoKnowledge(message, languageStyle, stage, limit = 6) {
    const db = readDb();
    const knowledge = db.knowledge || {};
    if (!Object.keys(knowledge).length) return [];

    const text = String(message || '').toLowerCase();
    const style = String(languageStyle || '').toUpperCase();
    const wants = new Set();

    const prefixes = style.includes('HAUSA') && style.includes('ENGLISH') ? ['HAUSA', 'MIXED']
        : style.includes('HAUSA') ? ['HAUSA', 'MIXED']
        : style.includes('PIDGIN') ? ['PIDGIN', 'ENGLISH', 'MIXED']
        : ['ENGLISH', 'MIXED'];

    const add = (suffix) => {
        for (const p of prefixes) wants.add(`${p}_${suffix}`);
    };

    if (/good ?morning|ina kwana|barka da safe|safiya|ya aka tashi|kwanciya/.test(text)) add('GOOD_MORNING');
    if (/good ?night|barka da dare|kwana lafiya|sleep|barci/.test(text)) add('GOOD_NIGHT');
    if (/sorry|hakuru|gafara|yi hakuri|apolog/.test(text)) add('APOLOGY');
    if (/miss|love|so na|ina son|masoyi|kauna|dear|honey/.test(text)) add('AFFECTION');
    if (/hi|hello|salam|sannu|barka|yaya|kaka|wetin/.test(text)) add('GREETING');
    if (/who are you|su wanene|sunanka|sunanki|name|from where|ina kake|ina kike/.test(text)) add('GETTING_TO_KNOW');
    if (/\?|shin|ko|abi/.test(text)) add('CONVERSATION_CONTINUATION');
    if (/😂|😅|haha|lol|kwarai|wayyo/.test(text)) add('PLAYFUL');
    if (/beautiful|kyau|kyakkyawa|fine|sweet/.test(text)) add('COMPLIMENT');
    if (/don't worry|kar ki damu|kar ka damu|sad|bakin ciki|stress/.test(text)) add('REASSURANCE');

    if (stage === 'first') add('FIRST_CONTACT');
    if (!wants.size) { add('GREETING'); add('CONVERSATION_CONTINUATION'); }
    add('CODE_SWITCHING');
    add('EMOJI_USAGE');

    const max = Math.max(1, Number(limit) || 6);
    const perCategory = max > 8 ? 2 : 1;
    const out = [];
    for (const cat of wants) {
        for (const entry of (knowledge[cat] || []).slice(0, perCategory)) {
            out.push({ category: cat, ...entry });
            if (out.length >= max) return out;
        }
    }
    return out;

}

/* ---- independent scheduler (never triggered by a chat message) --------- */
let timer = null;
function startScheduler({ intervalHours = Number(process.env.VIDEO_KNOWLEDGE_INTERVAL_HOURS || 24), onDone, onError } = {}) {
    if (timer) return;
    const run = () => {
        refresh()
            .then(stats => onDone && onDone(stats))
            .catch(err => onError && onError(err));
    };
    // First run a few minutes after boot so startup stays fast.
    setTimeout(run, 5 * 60 * 1000).unref?.();
    timer = setInterval(run, Math.max(1, intervalHours) * 3600 * 1000);
    timer.unref?.();
}

module.exports = {
    CATEGORIES,
    QUERIES,
    refresh,
    searchYouTube,
    searchYouTubeApi,
    searchDuckDuckGoVideos,
    isRunning: () => running,
    readVideoKnowledge,
    relevantVideoKnowledge,
    startScheduler
};
