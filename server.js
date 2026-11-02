require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const cron = require('node-cron');
const { extractPdfText } = require('./lib/pdftext');

const db = require('./lib/db');
const auth = require('./lib/auth');
const { runCrawl, regenerate, addManual, isRunning } = require('./lib/pipeline');
const { extractProfile } = require('./lib/generate');
const { resumePdf, letterPdf, resumeText } = require('./lib/render');
const { renderSite } = require('./lib/site');

const UPLOAD_DIR = path.join(__dirname, 'data', 'assets');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
    storage: multer.diskStorage({
        destination: UPLOAD_DIR,
        filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + '.pdf')
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname))
});

const STATUSES = ['review', 'submitted', 'interview', 'offer', 'lost', 'skipped'];
const GROUPS = {
    review: ['review'],
    submitted: ['submitted'],
    closed: ['interview', 'offer', 'lost'],
    skipped: ['skipped']
};

const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => {
    console.error(e);
    res.status(500).json({ error: e.message });
});

const app = express();
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser(process.env.COOKIE_SECRET || 'dev-secret'));

app.get('/healthz', (req, res) => res.json({ ok: true }));

/* public microsites */
async function findSite(slug) {
    if (!/^[a-f0-9]{18}$/.test(slug)) return null;
    return db.col('jobs').findOne({ siteSlug: slug });
}

app.get('/s/:slug', wrap(async (req, res) => {
    const job = await findSite(req.params.slug);
    if (!job || !job.site) return res.status(404).send('Not found');
    const profile = await db.getProfile();
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.type('html').send(renderSite({ site: job.site, job, contact: profile.contact || {}, slug: job.siteSlug }));
}));

app.get('/s/:slug/resume.pdf', wrap(async (req, res) => {
    const job = await findSite(req.params.slug);
    if (!job) return res.status(404).send('Not found');
    const asset = await db.col('assets').findOne({ _id: job.resumeAssetId });
    if (!asset) return res.status(404).send('Not found');
    const buf = await resumePdf(asset.content);
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.type('pdf').send(buf);
}));

/* auth */
app.post('/api/login', auth.login);
app.post('/api/logout', auth.logout);
app.get('/api/auth', auth.status);

app.use('/api', auth.requireAuth);

/* stats */
app.get('/api/stats', wrap(async (req, res) => {
    const agg = await db.col('jobs').aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]).toArray();
    const counts = Object.fromEntries(STATUSES.map(s => [s, 0]));
    for (const a of agg) counts[a._id] = a.n;
    const lastRun = await db.col('runs').find().sort({ startedAt: -1 }).limit(1).toArray();
    res.json({ counts, running: isRunning(), lastRun: lastRun[0] || null });
}));

/* jobs */
app.get('/api/jobs', wrap(async (req, res) => {
    const statuses = GROUPS[req.query.group] || GROUPS.review;
    const jobs = await db.col('jobs')
        .find({ status: { $in: statuses } }, { projection: { description: 0, site: 0 } })
        .sort({ fit: -1, createdAt: -1 })
        .limit(300)
        .toArray();
    res.json(jobs);
}));

app.get('/api/jobs/:id', wrap(async (req, res) => {
    const job = await db.col('jobs').findOne({ _id: db.oid(req.params.id) });
    if (!job) return res.status(404).json({ error: 'not found' });
    const [resume, cover] = await Promise.all([
        db.col('assets').findOne({ _id: job.resumeAssetId }),
        db.col('assets').findOne({ _id: job.coverAssetId })
    ]);
    res.json({ job, resume, cover, siteUrl: `${process.env.PUBLIC_BASE_URL || ''}/s/${job.siteSlug}` });
}));

app.post('/api/jobs/manual', wrap(async (req, res) => {
    const { title, company } = req.body;
    if (!title || !company) return res.status(400).json({ error: 'title and company required' });
    const id = await addManual(req.body);
    res.json({ id });
}));

app.post('/api/jobs/:id/status', wrap(async (req, res) => {
    const { status, note } = req.body;
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'invalid status' });
    const r = await db.col('jobs').updateOne({ _id: db.oid(req.params.id) }, {
        $set: { status, updatedAt: new Date(), ...(status === 'submitted' ? { submittedAt: new Date() } : {}) },
        $push: { history: { status, at: new Date(), note: note || '' } }
    });
    res.json({ ok: r.matchedCount === 1 });
}));

app.put('/api/jobs/:id', wrap(async (req, res) => {
    const set = { updatedAt: new Date() };
    if (typeof req.body.notes === 'string') set.notes = req.body.notes;
    if (req.body.site && typeof req.body.site === 'object') set.site = req.body.site;
    await db.col('jobs').updateOne({ _id: db.oid(req.params.id) }, { $set: set });
    res.json({ ok: true });
}));

app.post('/api/jobs/:id/regenerate', wrap(async (req, res) => {
    await regenerate(req.params.id);
    res.json({ ok: true });
}));

app.delete('/api/jobs/:id', wrap(async (req, res) => {
    const id = db.oid(req.params.id);
    await db.col('assets').deleteMany({ jobId: String(id) });
    await db.col('jobs').deleteOne({ _id: id });
    res.json({ ok: true });
}));

/* assets */
app.get('/api/assets', wrap(async (req, res) => {
    const kinds = req.query.kind ? [req.query.kind] : ['resume_upload', 'resume_generated', 'cover_letter'];
    const assets = await db.col('assets')
        .find({ kind: { $in: kinds } }, { projection: { text: 0, content: 0 } })
        .sort({ createdAt: -1 })
        .toArray();
    const jobIds = [...new Set(assets.map(a => a.jobId).filter(Boolean))].map(db.oid).filter(Boolean);
    const jobs = await db.col('jobs').find({ _id: { $in: jobIds } }, { projection: { title: 1, company: 1, status: 1 } }).toArray();
    const byId = Object.fromEntries(jobs.map(j => [String(j._id), j]));
    res.json(assets.map(a => ({ ...a, job: a.jobId ? byId[a.jobId] || null : null })));
}));

app.post('/api/assets/upload', upload.array('files', 10), wrap(async (req, res) => {
    const out = [];
    for (const f of req.files || []) {
        let text = '';
        try {
            text = await extractPdfText(fs.readFileSync(f.path));
        } catch (e) {
            text = '';
        }
        const doc = {
            kind: 'resume_upload',
            label: f.originalname.replace(/\.pdf$/i, ''),
            filename: f.originalname,
            file: f.filename,
            text,
            textEmpty: text.trim().length < 50,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        const r = await db.col('assets').insertOne(doc);
        out.push({ id: r.insertedId, label: doc.label, textEmpty: doc.textEmpty });
    }
    res.json(out);
}));

app.get('/api/assets/:id', wrap(async (req, res) => {
    const a = await db.col('assets').findOne({ _id: db.oid(req.params.id) });
    if (!a) return res.status(404).json({ error: 'not found' });
    res.json(a);
}));

app.put('/api/assets/:id', wrap(async (req, res) => {
    const a = await db.col('assets').findOne({ _id: db.oid(req.params.id) });
    if (!a) return res.status(404).json({ error: 'not found' });
    const set = { updatedAt: new Date() };
    if (a.kind === 'cover_letter' && typeof req.body.text === 'string') set.text = req.body.text;
    if (a.kind === 'resume_generated' && req.body.content) set.content = req.body.content;
    if (typeof req.body.label === 'string') set.label = req.body.label;
    await db.col('assets').updateOne({ _id: a._id }, { $set: set });
    res.json({ ok: true });
}));

app.get('/api/assets/:id/download', wrap(async (req, res) => {
    const a = await db.col('assets').findOne({ _id: db.oid(req.params.id) });
    if (!a) return res.status(404).json({ error: 'not found' });
    const safe = (a.label || 'document').replace(/[^a-z0-9._ -]+/gi, '_');
    const fmt = req.query.format === 'txt' ? 'txt' : 'pdf';
    if (a.kind === 'resume_upload') {
        return res.download(path.join(UPLOAD_DIR, a.file), a.filename || `${safe}.pdf`);
    }
    if (a.kind === 'resume_generated') {
        if (fmt === 'txt') {
            res.set('Content-Disposition', `attachment; filename="${safe}.txt"`);
            return res.type('text/plain').send(resumeText(a.content));
        }
        const buf = await resumePdf(a.content);
        res.set('Content-Disposition', `attachment; filename="${safe}.pdf"`);
        return res.type('pdf').send(buf);
    }
    if (a.kind === 'cover_letter') {
        if (fmt === 'txt') {
            res.set('Content-Disposition', `attachment; filename="${safe}.txt"`);
            return res.type('text/plain').send(a.text);
        }
        const buf = await letterPdf(a.text);
        res.set('Content-Disposition', `attachment; filename="${safe}.pdf"`);
        return res.type('pdf').send(buf);
    }
    res.status(400).json({ error: 'unsupported' });
}));

app.delete('/api/assets/:id', wrap(async (req, res) => {
    const a = await db.col('assets').findOne({ _id: db.oid(req.params.id) });
    if (!a) return res.json({ ok: true });
    if (a.kind !== 'resume_upload') return res.status(400).json({ error: 'only uploaded resumes can be deleted here' });
    try {
        fs.unlinkSync(path.join(UPLOAD_DIR, a.file));
    } catch (e) { /* ignore */ }
    await db.col('assets').deleteOne({ _id: a._id });
    res.json({ ok: true });
}));

/* profile */
app.get('/api/profile', wrap(async (req, res) => res.json(await db.getProfile())));

app.put('/api/profile', wrap(async (req, res) => {
    const p = req.body || {};
    const clean = {
        contact: { name: '', email: process.env.APPLICANT_EMAIL || 'charlie@vannorman.ai', phone: '', location: '', links: [], ...(p.contact || {}) },
        summary: p.summary || '',
        facts: p.facts || [],
        experience: p.experience || [],
        education: p.education || [],
        skills: p.skills || [],
        achievements: p.achievements || []
    };
    res.json(await db.saveProfile(clean));
}));

app.post('/api/profile/extract', wrap(async (req, res) => {
    const resumes = await db.col('assets').find({ kind: 'resume_upload' }).toArray();
    if (!resumes.length) return res.status(400).json({ error: 'upload at least one resume PDF first' });
    const current = await db.getProfile();
    const proposed = await extractProfile(resumes, current.experience.length ? current : null);
    proposed.contact = proposed.contact || {};
    proposed.contact.email = process.env.APPLICANT_EMAIL || 'charlie@vannorman.ai';
    res.json(proposed);
}));

/* settings */
app.get('/api/settings', wrap(async (req, res) => {
    res.json({
        ...(await db.getSettings()),
        credentials: {
            anthropic: !!process.env.ANTHROPIC_API_KEY,
            adzuna: !!(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY),
            jsearch: !!process.env.RAPIDAPI_KEY
        }
    });
}));

app.put('/api/settings', wrap(async (req, res) => res.json(await db.saveSettings(req.body || {}))));

/* runs */
app.get('/api/runs', wrap(async (req, res) => {
    res.json(await db.col('runs').find().sort({ startedAt: -1 }).limit(30).toArray());
}));

app.post('/api/runs/start', wrap(async (req, res) => {
    if (isRunning()) return res.status(409).json({ error: 'run already in progress' });
    runCrawl('manual').catch(e => console.error(e));
    res.json({ started: true });
}));

app.use(express.static(path.join(__dirname, 'public')));

async function main() {
    await db.connect();
    const schedule = process.env.CRON_SCHEDULE || '0 6 * * *';
    if (cron.validate(schedule)) {
        cron.schedule(schedule, () => runCrawl('cron').catch(e => console.error(e)), {
            timezone: process.env.CRON_TZ || 'America/Chicago'
        });
    }
    const port = process.env.PORT || 3000;
    app.listen(port, () => console.log(`ResumeRoll on :${port}, crawl schedule "${schedule}"`));
}

if (require.main === module) {
    main().catch(e => {
        console.error(e);
        process.exit(1);
    });
}

module.exports = { app, main };
