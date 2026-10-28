const axios = require('axios');
const { reportError } = require('./error-reporting');
const IMAGE_ENDPOINT = 'https://eliteprotech-apis.zone.id/ai/zonerai';

class ImageGenerationError extends Error {
    constructor(code) {
        super(code === 'NO_IMAGE' ? 'Image service returned no valid PNG, JPEG or WebP image.' : code);
        this.code = code;
    }
}

function imageBuffer(payload) {
    if (Buffer.isBuffer(payload) || payload instanceof Uint8Array || payload instanceof ArrayBuffer) {
        const buffer = Buffer.from(payload);
        if (!buffer.length || buffer.length > 20 * 1024 * 1024) return null;
        const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        const jpeg = buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
        const webp = buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
        return png || jpeg || webp ? buffer : null;
    }
    for (const candidate of payload?.candidates || []) {
        for (const part of candidate.content?.parts || []) {
            const image = part.inlineData || part.inline_data;
            if (!/^image\/(png|jpeg|webp)$/.test(image?.mimeType || image?.mime_type || '')) continue;
            if (typeof image.data !== 'string' || image.data.length > 28 * 1024 * 1024) continue;
            const buffer = Buffer.from(image.data, 'base64');
            const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
            const jpeg = buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
            const webp = buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
            if (png || jpeg || webp) return buffer;
        }
    }
    return null;
}

async function generateImage(prompt, { http = axios, timeoutMs = 120000 } = {}) {
    let response;
    try {
        response = await http.get(`${IMAGE_ENDPOINT}?prompt=${encodeURIComponent(prompt)}`, {
            responseType: 'arraybuffer', timeout: Math.min(timeoutMs, 120000),
            maxContentLength: 20 * 1024 * 1024, maxRedirects: 3, validateStatus: () => true
        });
    } catch (error) {
        const failure = new ImageGenerationError('UNAVAILABLE');
        failure.message = `Image service request failed (${error.code || 'NETWORK_ERROR'}).`;
        throw failure;
    }
    if (response.status < 200 || response.status >= 300) {
        const failure = new ImageGenerationError('REQUEST_REJECTED');
        failure.status = response.status;
        failure.message = `Image service returned HTTP ${response.status}.`;
        throw failure;
    }
    const buffer = imageBuffer(response.data);
    if (!buffer) throw new ImageGenerationError('NO_IMAGE');
    return buffer;
}

async function handleCreate(socket, message, prompt, command, { generate = generateImage } = {}) {
    const send = content => socket.sendMessage(message.chat, content, { quoted: message });
    const react = text => socket.sendMessage(message.chat, { react: { text, key: message.key } }).catch(() => {});
    if (!prompt?.trim()) return send({ text: `⚠️ Example: *${command} a man walking home*` });
    await react('🖼️');
    let generated = false;
    try {
        const image = await generate(prompt.trim());
        generated = true;
        await send({ image, caption: '*AI Image Generated*' });
        await react('✅');
    } catch (error) {
        const code = generated ? 'SEND_FAILED' : (error instanceof ImageGenerationError ? error.code : 'UNAVAILABLE');
        console.error('Create failed:', code);
        await react('❌');
        await reportError(socket, message, error, generated ? 'Image delivery' : 'Image generation');
    }
}

module.exports = { generateImage, imageBuffer, handleCreate, ImageGenerationError };