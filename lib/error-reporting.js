const { AsyncLocalStorage } = require('node:async_hooks');
const context = new AsyncLocalStorage();
const reported = new WeakSet();

function failureReply(value) {
    return typeof value === 'string' && /(?:failed|unable|error|could not|couldn't)\b/i.test(value);
}

async function replyText(sock, m, value) {
    if (failureReply(value)) return reportError(sock, m, value, 'Command');
    return sock.sendMessage(m.chat, { text: redact(value) }, { quoted: m });
}

function redact(value, env = process.env, removeUrls = false) {
    let text = String(value || 'Unknown error');
    for (const [name, value] of Object.entries(env)) {
        if (/key|token|secret|password|session|credential/i.test(name) && value?.length >= 4) {
            text = text.split(value).join('[REDACTED]');
            text = text.split(encodeURIComponent(value)).join('[REDACTED]');
        }
    }
    if (removeUrls) text = text.replace(/https?:\/\/[^\s<>"']+/gi, '[provider URL removed]');
    return text.replace(/\b(?:Bearer\s+\S+|hf_[\w-]+|AIza[\w-]+|eyJ[\w.-]+)\b/gi, '[REDACTED]')
        .replace(/((?:api[-_ ]?key|access[-_ ]?token|token|secret|password|authorization|cookie)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}

function errorCause(err) {
    // Do not serialize Axios/request objects, payloads, headers or stacks.
    const status = err?.response?.status || err?.status || err?.statusCode;
    const code = typeof err?.code === 'string' ? err.code : '';
    const reason = typeof err === 'string' ? err : err?.message || 'Unknown error';
    const causes = [reason, err?.cause?.message].filter(Boolean).map(value => redact(value, process.env, true));
    return [status ? `HTTP ${status}` : '', code, ...new Set(causes)].filter(Boolean).join('\n').slice(0, 1800);
}

function recipient(sock, m) {
    const jid = m?.key?.fromMe ? sock?.user?.id : m?.sender || m?.key?.participant || m?.key?.remoteJid || m?.chat;
    const clean = String(jid || '').replace(/:\d+@/, '@');
    return /^[\w.-]+@(s\.whatsapp\.net|lid)$/.test(clean) ? clean : null;
}

async function reportError(sock, m, err, feature = 'Bot') {
    if (err && typeof err === 'object') {
        if (reported.has(err)) return false;
        reported.add(err);
    }
    const cause = errorCause(err);
    console.error(`[${redact(feature)}] ${cause}`);
    const target = recipient(sock, m);
    if (!target) return false;
    try {
        await sock.sendMessage(target, { text: `❌ ${redact(feature)} error\n\nCause:\n${cause}` });
        return true;
    } catch (notifyErr) {
        console.error(`Private error notice failed: ${errorCause(notifyErr)}`);
        return false;
    }
}

function withErrorContext(sock, m, task) {
    return context.run({ sock, m, notices: [] }, async () => {
        const state = context.getStore();
        // Legacy plugins often catch locally and reply with the actual cause.
        // Route those failure replies privately rather than exposing them in groups.
        const originalReply = m?.reply;
        if (typeof originalReply === 'function') m.reply = async (value, ...args) => {
            if (failureReply(value)) {
                return reportError(sock, m, value, 'Command');
            }
            return originalReply.call(m, typeof value === 'string' ? redact(value) : value, ...args);
        };
        try { return await task(); }
        finally {
            if (typeof originalReply === 'function') m.reply = originalReply;
            if (state) await Promise.allSettled(state.notices);
        }
    });
}

// Evaluated V1 handlers catch errors internally. Use a local console facade,
// not a global console monkey patch, to capture errors in their request scope.
const handlerConsole = Object.create(console);
for (const method of ['error', 'log', 'warn']) {
    handlerConsole[method] = (...args) => {
        const state = context.getStore();
        const error = args.find(arg => arg && typeof arg === 'object' && typeof arg.message === 'string');
        if (state && (error || method === 'error')) {
            const cause = error || args.filter(arg => typeof arg === 'string').join(' ');
            state.notices.push(reportError(state.sock, state.m, cause));
        } else console[method](...args.map(arg => typeof arg === 'string' ? redact(arg, process.env, true) : arg instanceof Error ? errorCause(arg) : arg));
    };
}

module.exports = { redact, errorCause, recipient, reportError, replyText, withErrorContext, handlerConsole };