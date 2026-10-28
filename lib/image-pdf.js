const fs = require('fs');
const { PDFDocument } = require('pdf-lib');

const MAX_IMAGES = 20;
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;

function kind(buf) {
    if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
    if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
    return 'other';
}

// Builds the PDF locally (no external API), one page per image sized to the image.
async function imagesToPdf(filePaths) {
    if (!Array.isArray(filePaths) || !filePaths.length) throw new Error('No images to convert.');
    if (filePaths.length > MAX_IMAGES) throw new Error(`Maximum of ${MAX_IMAGES} images.`);
    const pdf = await PDFDocument.create();
    let total = 0;
    for (const file of filePaths) {
        let buf = await fs.promises.readFile(file);
        total += buf.length;
        if (total > MAX_TOTAL_BYTES) throw new Error('Images are too large to combine.');
        let type = kind(buf);
        if (type === 'other') {
            const sharp = require('sharp');
            buf = await sharp(buf, { animated: false }).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();
            type = 'jpg';
        }
        const image = type === 'jpg' ? await pdf.embedJpg(buf) : await pdf.embedPng(buf);
        const page = pdf.addPage([image.width, image.height]);
        page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    }
    return Buffer.from(await pdf.save());
}

module.exports = { imagesToPdf };
