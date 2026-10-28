/**
 * Voice changer configuration.
 *
 * CONSENT NOTE (please read before adding target voices):
 * Target voice references must only be recordings you own or that the speaker
 * explicitly consented to be used for voice conversion. This feature exists to
 * change the vocal timbre of your *own* speech into a consented voice — it is
 * not an identity-impersonation tool and must not be used to imitate someone
 * without their permission.
 */

const path = require('path');
const { voiceEnvironment } = require('./env');
const env = voiceEnvironment();

const ROOT = path.join(__dirname, '..', '..', 'database', 'voicechanger');

module.exports = {
    // Hugging Face Seed-VC space (zero-shot, reference based voice conversion).
    HF_SPACE: env.HF_SPACE,
    // Never hard-code the token: it comes from the environment only.
    HF_TOKEN: env.HF_TOKEN,

    // Storage
    ROOT,
    VOICES_DIR: path.join(ROOT, 'voices'),
    STATE_FILE: path.join(ROOT, 'user-state', 'voicechanger.json'),
    TMP_DIR: path.join(__dirname, '..', '..', 'database', 'temp', 'voicechanger'),

    // Audio
    SAMPLE_RATE: 22050,

    // Reference recording rules (10-20s recommended, longer is trimmed).
    REF_MIN_SECONDS: 10,
    REF_RECOMMENDED_SECONDS: 20,
    REF_MAX_SECONDS: 30,

    // Source limits. Long voice notes are chunked because ZeroGPU requests
    // have a hard runtime budget per call.
    SOURCE_MAX_SECONDS: 300,
    CHUNK_SECONDS: env.CHUNK_SECONDS,

    // Seed-VC inference settings tuned for natural speech + good similarity
    // while preserving the source timing/emotion (length_adjust = 1).
    INFERENCE: {
        diffusion_steps: env.DIFFUSION_STEPS,
        length_adjust: 1,
        intelligebility_cfg_rate: 0,
        similarity_cfg_rate: env.SIMILARITY_CFG,
        top_p: 0.9,
        temperature: 1,
        repetition_penalty: 1,
        convert_style: env.CONVERT_STYLE,
        anonymization_only: false
    },

    REQUEST_TIMEOUT_MS: env.REQUEST_TIMEOUT_MS
};
