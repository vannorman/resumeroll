const PDFDocument = require('pdfkit');

const BLUE = '#1d4ed8';
const INK = '#0f172a';
const MUTED = '#475569';

function collect(doc) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        doc.on('data', c => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
    });
}

function heading(doc, text) {
    doc.moveDown(0.6);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(BLUE).text(text.toUpperCase(), { characterSpacing: 0.8 });
    const y = doc.y + 1;
    doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y)
        .lineWidth(0.5).strokeColor('#cbd5e1').stroke();
    doc.moveDown(0.4);
    doc.fillColor(INK);
}

async function resumePdf(r) {
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 48, bottom: 48, left: 54, right: 54 } });
    const done = collect(doc);
    const c = r.contact || {};
    doc.font('Helvetica-Bold').fontSize(20).fillColor(INK).text(c.name || '');
    if (r.headline) doc.font('Helvetica').fontSize(11).fillColor(BLUE).text(r.headline);
    const contact = [c.email, c.phone, c.location, ...(c.links || [])].filter(Boolean).join('  |  ');
    if (contact) doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(contact);

    if (r.summary) {
        heading(doc, 'Summary');
        doc.font('Helvetica').fontSize(10).fillColor(INK).text(r.summary, { lineGap: 1.5 });
    }
    if ((r.skills || []).length) {
        heading(doc, 'Skills');
        doc.font('Helvetica').fontSize(10).fillColor(INK).text(r.skills.join('  •  '), { lineGap: 1.5 });
    }
    if ((r.experience || []).length) {
        heading(doc, 'Experience');
        for (const e of r.experience) {
            doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK)
                .text(`${e.title || ''}${e.company ? ' — ' + e.company : ''}`, { continued: false });
            const meta = [e.dates, e.location].filter(Boolean).join('  |  ');
            if (meta) doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED).text(meta);
            doc.moveDown(0.15);
            for (const b of e.bullets || []) {
                doc.font('Helvetica').fontSize(10).fillColor(INK)
                    .text(`•  ${b}`, { indent: 0, lineGap: 1.2, paragraphGap: 1.5 });
            }
            doc.moveDown(0.4);
        }
    }
    if ((r.achievements || []).length) {
        heading(doc, 'Highlights');
        for (const a of r.achievements) {
            doc.font('Helvetica').fontSize(10).fillColor(INK).text(`•  ${a}`, { lineGap: 1.2 });
        }
    }
    if ((r.education || []).length) {
        heading(doc, 'Education');
        for (const e of r.education) {
            doc.font('Helvetica-Bold').fontSize(10).fillColor(INK)
                .text(`${e.degree || ''}${e.school ? ' — ' + e.school : ''}`);
            if (e.dates) doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(e.dates);
        }
    }
    doc.end();
    return done;
}

async function letterPdf(body) {
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 72, bottom: 72, left: 72, right: 72 } });
    const done = collect(doc);
    doc.font('Helvetica').fontSize(11).fillColor(INK).text(body, { lineGap: 3, paragraphGap: 8 });
    doc.end();
    return done;
}

function resumeText(r) {
    const c = r.contact || {};
    const L = [];
    L.push(c.name || '');
    if (r.headline) L.push(r.headline);
    L.push([c.email, c.phone, c.location, ...(c.links || [])].filter(Boolean).join(' | '));
    if (r.summary) L.push('', 'SUMMARY', r.summary);
    if ((r.skills || []).length) L.push('', 'SKILLS', r.skills.join(', '));
    if ((r.experience || []).length) {
        L.push('', 'EXPERIENCE');
        for (const e of r.experience) {
            L.push(`${e.title || ''} - ${e.company || ''} (${[e.dates, e.location].filter(Boolean).join(', ')})`);
            for (const b of e.bullets || []) L.push(`- ${b}`);
            L.push('');
        }
    }
    if ((r.achievements || []).length) {
        L.push('HIGHLIGHTS');
        for (const a of r.achievements) L.push(`- ${a}`);
        L.push('');
    }
    if ((r.education || []).length) {
        L.push('EDUCATION');
        for (const e of r.education) L.push(`${e.degree || ''} - ${e.school || ''} ${e.dates || ''}`.trim());
    }
    return L.join('\n');
}

module.exports = { resumePdf, letterPdf, resumeText };
