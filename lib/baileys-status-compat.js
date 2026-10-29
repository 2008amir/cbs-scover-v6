const fs = require('node:fs');
const path = require('node:path');

// rc14 classifies the envelope as media but checks only its outer fields when
// setting mediatype on the encrypted node. Keep the status envelope encrypted
// intact, and use Baileys' own normalizer solely for media classification.
function patchGroupStatusMedia(root = path.join(__dirname, '..')) {
    for (const name of ['baileys', '@whiskeysockets/baileys']) {
        const file = path.join(root, 'node_modules', name, 'lib', 'Socket', 'messages-send.js');
        if (!fs.existsSync(file)) continue;
        const source = fs.readFileSync(file, 'utf8');
        const start = source.indexOf('    const getMediaType = (message) => {');
        const end = source.indexOf('\n    };', start);
        if (start < 0 || end < 0) throw new Error(`Unsupported ${name} media classification; check group-status compatibility.`);
        const classifier = source.slice(start, end);
        if (classifier.includes('normalizeMessageContent(message)')) continue;
        const header = '    const getMediaType = (message) => {';
        fs.writeFileSync(file, source.slice(0, start) + classifier.replace(header,
            header + '\n        message = normalizeMessageContent(message) || {};') + source.slice(end));
    }
}

module.exports = { patchGroupStatusMedia };
if (require.main === module) patchGroupStatusMedia();