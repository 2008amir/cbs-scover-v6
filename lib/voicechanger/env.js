const { envText, envNumber } = require('../env-config');

function voiceEnvironment(env = process.env) {
    const space = envText(env, 'HF_SPACE') || 'Plachta/Seed-VC';
    // Client.connect expects owner/space, not a webpage URL.
    const normalized = space.replace(/^https:\/\/huggingface\.co\/spaces\//i, '').replace(/\/+$/, '');
    return {
        HF_SPACE: /^[\w.-]+\/[\w.-]+$/.test(normalized) ? normalized : 'Plachta/Seed-VC',
        HF_TOKEN: envText(env, 'HF_TOKEN', 'HUGGINGFACE_TOKEN', 'HF_API_TOKEN'),
        CHUNK_SECONDS: envNumber(env, 'VC_CHUNK_SECONDS', 45, 1, 300),
        DIFFUSION_STEPS: Math.round(envNumber(env, 'VC_DIFFUSION_STEPS', 50, 1, 200)),
        SIMILARITY_CFG: envNumber(env, 'VC_SIMILARITY_CFG', 0.9, 0, 1),
        CONVERT_STYLE: envText(env, 'VC_CONVERT_STYLE').toLowerCase() !== 'false',
        REQUEST_TIMEOUT_MS: envNumber(env, 'VC_TIMEOUT_MS', 240000, 1000, 3600000)
    };
}

module.exports = { voiceEnvironment };