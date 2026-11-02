let pdfjs;

async function extractPdfText(buffer) {
    if (!pdfjs) pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({
        data: new Uint8Array(buffer),
        useSystemFonts: true,
        disableFontFace: true,
        isEvalSupported: false
    }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        let line = '';
        const out = [];
        for (const item of content.items) {
            line += item.str;
            if (item.hasEOL) {
                out.push(line);
                line = '';
            } else if (item.str && !/\s$/.test(item.str)) {
                line += ' ';
            }
        }
        if (line) out.push(line);
        pages.push(out.join('\n'));
    }
    await doc.destroy();
    return pages.join('\n\n').replace(/[ \t]+\n/g, '\n').trim();
}

module.exports = { extractPdfText };
