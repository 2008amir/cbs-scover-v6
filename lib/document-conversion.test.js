const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { unzipSync, strFromU8 } = require('fflate');
const { pdfToDocx } = require('./document-conversion');

function samplePdf(text = 'This book has 200 pages.') {
    const stream = `BT /F1 12 Tf 50 740 Td (${text}) Tj ET`;
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
    let pdf = '%PDF-1.4\n'; const offsets = [0];
    objects.forEach((obj, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(pdf);
}

test('PDF command converts a real text PDF and delivers a valid Word file without soffice', async () => {
    const source = fs.readFileSync(path.join(__dirname, 'v1/commands.js'), 'utf8');
    const code = source.slice(source.indexOf("case 'pdf2docx':"), source.indexOf("case 'img2docx':"));
    const sent = [];
    const context = vm.createContext({ command: 'pdf2docx', mime: 'application/pdf', prefix: '.', qmsg: {},
        m: { chat: 'reader@s.whatsapp.net', sender: 'reader@s.whatsapp.net', key: { id: 'pdf' } },
        require: name => { assert.equal(name, './lib/document-conversion'); return { pdfToDocx }; },
        reply: () => assert.fail('unexpected PDF error'),
        EliteProTech: { downloadMediaMessage: async () => samplePdf(), sendMessage: async (chat, content) => sent.push(content) }
    });
    await vm.runInContext(`(async () => { switch(command) { ${code} } })()`, context);
    const delivered = sent.find(item => item.document);
    assert.equal(delivered.mimetype, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const files = unzipSync(delivered.document);
    assert.ok(strFromU8(files['word/document.xml']).includes('This book has 200 pages.'));
    assert.equal(sent.at(-1).react.text, '✅');
});

test('PDF converter rejects invalid and oversized files', async () => {
    await assert.rejects(pdfToDocx(Buffer.from('not PDF')), /not a valid PDF/);
    const buffer = Buffer.alloc(20 * 1024 * 1024 + 1); buffer.write('%PDF-');
    await assert.rejects(pdfToDocx(buffer), /20 MB/);
});

test('image-only PDF does not silently return an empty Word document', async () => {
    await assert.rejects(pdfToDocx(samplePdf('')), /OCR is required/);
});