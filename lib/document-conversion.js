const { Document, Packer, Paragraph, TextRun } = require('docx');

async function pdfToDocx(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.subarray(0, 5).toString() !== '%PDF-') throw new Error('The file is not a valid PDF.');
    if (buffer.length > 20 * 1024 * 1024) throw new Error('PDF exceeds the 20 MB conversion limit.');
    // Pure-JS PDF reader: no shell, LibreOffice, Python or external uploads.
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false });
    let pdf;
    try {
        pdf = await task.promise;
        if (pdf.numPages > 100) throw new Error('PDF exceeds the 100-page conversion limit.');
        const sections = [];
        let characters = 0;
        for (let number = 1; number <= pdf.numPages; number++) {
            const page = await pdf.getPage(number);
            const text = await page.getTextContent();
            const lines = []; let line = '', previousY;
            for (const item of text.items) {
                if (typeof item.str !== 'string') continue;
                const y = item.transform?.[5];
                if (line && previousY !== undefined && y !== undefined && Math.abs(y - previousY) > 3) { lines.push(line); line = ''; }
                line += `${line ? ' ' : ''}${item.str}`;
                previousY = y;
                if (item.hasEOL) { lines.push(line); line = ''; }
            }
            if (line) lines.push(line);
            characters += lines.join('').length;
            if (characters > 1000000) throw new Error('PDF contains too much text to convert safely.');
            if (!lines.some(line => line.trim())) throw new Error(`Page ${number} contains no readable text (scanned/image-only PDF). OCR is required; this converter handles text PDFs.`);
            sections.push({ children: lines.map(line => new Paragraph({ children: [new TextRun(line)] })) });
            page.cleanup();
        }
        return await Packer.toBuffer(new Document({ sections }));
    } finally { await task.destroy(); }
}

module.exports = { pdfToDocx };