function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function para(s) {
    return esc(s).split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
}

function cards(items) {
    return (items || []).map(i => `<div class="card"><h3>${esc(i.title)}</h3>${para(i.body)}</div>`).join('');
}

function renderSite({ site, job, contact, slug }) {
    const email = esc(contact.email || '');
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(contact.name || 'Candidate')} for ${esc(job.title)} at ${esc(job.company)}</title>
<style>
:root{--bg:#f8fafc;--ink:#0f172a;--muted:#475569;--blue:#1d4ed8;--blue-d:#1e3a8a;--line:#e2e8f0;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#0b1220;--ink:#e2e8f0;--muted:#94a3b8;--blue:#60a5fa;--blue-d:#93c5fd;--line:#1e293b;--card:#111a2e}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:860px;margin:0 auto;padding:0 20px}
header{padding:72px 0 40px;border-bottom:1px solid var(--line)}
.eyebrow{color:var(--blue);font-weight:600;letter-spacing:.08em;text-transform:uppercase;font-size:13px}
h1{font-size:clamp(30px,5vw,46px);line-height:1.15;margin:12px 0 16px;color:var(--ink)}
.lead{color:var(--muted);font-size:18px;max-width:680px}
section{padding:40px 0;border-bottom:1px solid var(--line)}
h2{font-size:22px;margin:0 0 20px;color:var(--blue-d)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px}
.card h3{margin:0 0 8px;font-size:17px}.card p{margin:0 0 8px;color:var(--muted)}
ol.plan{padding-left:20px;color:var(--muted)}ol.plan li{margin-bottom:10px}ol.plan b{color:var(--ink)}
.cta{display:inline-block;background:var(--blue);color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;margin-right:10px}
.cta.alt{background:transparent;color:var(--blue);border:1px solid var(--blue)}
footer{padding:32px 0 64px;color:var(--muted);font-size:14px}
</style></head><body>
<div class="wrap">
<header><div class="eyebrow">${esc(job.title)} &middot; ${esc(job.company)}</div>
<h1>${esc(site.headline)}</h1><div class="lead">${para(site.intro)}</div></header>
<section><h2>Why ${esc(job.company)}</h2><div class="grid">${cards(site.whyThem)}</div></section>
<section><h2>Relevant proof</h2><div class="grid">${cards(site.proof)}</div></section>
<section><h2>First 90 days</h2><ol class="plan">${(site.firstNinetyDays || []).map(i => `<li><b>${esc(i.title)}</b> &mdash; ${esc(i.body)}</li>`).join('')}</ol></section>
<section><h2>Next step</h2>${para(site.closing)}
<p><a class="cta" href="mailto:${email}">Email ${esc(contact.name || 'me')}</a>
<a class="cta alt" href="/s/${esc(slug)}/resume.pdf">Download resume (PDF)</a></p></section>
<footer>Prepared for ${esc(job.company)} &middot; ${email}</footer>
</div></body></html>`;
}

module.exports = { renderSite, esc };
