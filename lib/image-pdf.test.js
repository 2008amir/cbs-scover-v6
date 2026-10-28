const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const { imagesToPdf } = require('./image-pdf');

test('img2pdf builds one page per added image locally, including webp', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'img2pdf-'));
    const base = sharp({ create: { width: 40, height: 30, channels: 3, background: '#336699' } });
    const files = [['1.jpg', 'jpeg'], ['2.png', 'png'], ['3.webp', 'webp']].map(([name, fmt]) => path.join(dir, name));
    await base.clone().jpeg().toFile(files[0]);
    await base.clone().png().toFile(files[1]);
    await base.clone().webp().toFile(files[2]);
    const pdf = await imagesToPdf(files);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.equal((await PDFDocument.load(pdf)).getPageCount(), 3);
    fs.rmSync(dir, { recursive: true, force: true });
});
