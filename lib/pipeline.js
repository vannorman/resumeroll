const crypto = require('crypto');
const db = require('./db');
const { fetchAll, dedupeKey } = require('./sources');
const { scoreJob, generateMaterials, generateSite } = require('./generate');

let running = false;

function pool(items, n, fn) {
    let i = 0;
    const out = [];
    const workers = Array.from({ length: n }, async () => {
        while (i < items.length) {
            const idx = i++;
            try {
                out[idx] = await fn(items[idx]);
            } catch (e) {
                out[idx] = { error: e.message };
            }
        }
    });
    return Promise.all(workers).then(() => out);
}

function salaryOk(score, settings) {
    const max = score.salaryMax || score.salaryMin;
    if (!max) return settings.includeUnlistedSalary;
    return max >= settings.minSalary;
}

async function buildMaterials(job, profile, resumes) {
    const base = resumes.find(r => String(r._id) === String(job.baseResumeId)) || resumes[0];
    const gen = await generateMaterials(job, profile, base);
    const site = await generateSite(job, profile, gen.resume);
    return { gen, site };
}

async function storeMaterials(jobId, job, gen, site) {
    const assets = db.col('assets');
    await assets.deleteMany({ jobId, kind: { $in: ['resume_generated', 'cover_letter'] } });
    const r = await assets.insertOne({
        kind: 'resume_generated', jobId, label: `${job.company} - ${job.title} (resume)`,
        content: gen.resume, createdAt: new Date(), updatedAt: new Date()
    });
    const c = await assets.insertOne({
        kind: 'cover_letter', jobId, label: `${job.company} - ${job.title} (cover letter)`,
        text: gen.coverLetter, createdAt: new Date(), updatedAt: new Date()
    });
    return { resumeAssetId: r.insertedId, coverAssetId: c.insertedId };
}

async function processNew(raw, score, profile, resumes) {
    const job = {
        ...raw,
        dedupeKey: raw.dedupeKey || dedupeKey(raw),
        remote: score.remote != null ? score.remote : raw.remote,
        salaryMin: score.salaryMin || raw.salaryMin || null,
        salaryMax: score.salaryMax || raw.salaryMax || null,
        salaryEstimated: !(raw.salaryMin || raw.salaryMax) || !!score.salaryEstimated,
        fit: score.fit,
        roleFamily: score.roleFamily,
        requirements: score.requirements || [],
        matches: score.matches || [],
        gaps: score.gaps || [],
        reason: score.reason || '',
        baseResumeId: score.baseResumeId || null
    };
    const { gen, site } = await buildMaterials(job, profile, resumes);
    const slug = crypto.randomBytes(9).toString('hex');
    const doc = {
        ...job,
        status: 'review',
        site,
        siteSlug: slug,
        verifyIssues: gen.verifyIssues || [],
        notes: '',
        history: [{ status: 'review', at: new Date(), note: 'added' }],
        createdAt: new Date(),
        updatedAt: new Date()
    };
    const ins = await db.col('jobs').insertOne(doc);
    const ids = await storeMaterials(String(ins.insertedId), job, gen, site);
    await db.col('jobs').updateOne({ _id: ins.insertedId }, { $set: ids });
    return ins.insertedId;
}

async function regenerate(jobId) {
    const job = await db.col('jobs').findOne({ _id: db.oid(jobId) });
    if (!job) throw new Error('job not found');
    const profile = await db.getProfile();
    const resumes = await db.col('assets').find({ kind: 'resume_upload' }).toArray();
    const { gen, site } = await buildMaterials(job, profile, resumes);
    const ids = await storeMaterials(String(job._id), job, gen, site);
    await db.col('jobs').updateOne({ _id: job._id }, {
        $set: { ...ids, site, verifyIssues: gen.verifyIssues || [], updatedAt: new Date() }
    });
}

async function addManual({ title, company, url, location, description }) {
    const profile = await db.getProfile();
    const settings = await db.getSettings();
    const resumes = await db.col('assets').find({ kind: 'resume_upload' }).toArray();
    const raw = {
        source: 'manual', externalId: url || `${company}:${title}`, title, company, url: url || '',
        location: location || '', remote: /remote/i.test(location || ''), description: description || '',
        postedAt: new Date()
    };
    raw.dedupeKey = dedupeKey(raw);
    if (await db.col('jobs').findOne({ dedupeKey: raw.dedupeKey })) throw new Error('job already in pipeline');
    const score = await scoreJob(raw, profile, resumes, settings);
    return processNew(raw, score, profile, resumes);
}

async function runCrawl(trigger = 'manual') {
    if (running) return { skipped: true, reason: 'run already in progress' };
    running = true;
    const run = { startedAt: new Date(), trigger, log: [], added: 0, fetched: 0, scored: 0, status: 'running' };
    const ins = await db.col('runs').insertOne(run);
    const log = m => {
        run.log.push(`${new Date().toISOString().slice(11, 19)} ${m}`);
    };
    const save = () => db.col('runs').updateOne({ _id: ins.insertedId }, { $set: run });
    try {
        const settings = await db.getSettings();
        const profile = await db.getProfile();
        const resumes = await db.col('assets').find({ kind: 'resume_upload' }).toArray();
        if (!profile.experience || !profile.experience.length) throw new Error('profile empty: upload resumes and confirm profile first');
        if (!resumes.length) throw new Error('no uploaded resumes');

        const raw = await fetchAll(settings, log);
        run.fetched = raw.length;
        const seen = new Set();
        const unique = [];
        for (const j of raw) {
            j.dedupeKey = dedupeKey(j);
            if (seen.has(j.dedupeKey)) continue;
            seen.add(j.dedupeKey);
            unique.push(j);
        }
        const existing = new Set((await db.col('jobs').find({ dedupeKey: { $in: [...seen] } }, { projection: { dedupeKey: 1 } }).toArray()).map(j => j.dedupeKey));
        let fresh = unique.filter(j => !existing.has(j.dedupeKey));
        fresh = fresh.filter(j => {
            const max = j.salaryMax || j.salaryMin;
            return !max || j.salaryEstimated || max >= settings.minSalary;
        });
        fresh.sort((a, b) => (b.postedAt || 0) - (a.postedAt || 0));
        fresh = fresh.slice(0, 40);
        log(`new candidates: ${fresh.length}`);
        await save();

        const scored = await pool(fresh, 3, async j => ({ j, s: await scoreJob(j, profile, resumes, settings) }));
        run.scored = scored.filter(x => x.s).length;
        const qualified = scored
            .filter(x => x && x.s && !x.error)
            .filter(x => x.s.usBased !== false && x.s.locationOk !== false && x.s.fit >= settings.minFitScore && salaryOk(x.s, settings))
            .sort((a, b) => b.s.fit - a.s.fit)
            .slice(0, settings.maxNewPerRun);
        log(`qualified: ${qualified.length}`);
        await save();

        await pool(qualified, 2, async x => {
            try {
                await processNew(x.j, x.s, profile, resumes);
                run.added += 1;
                log(`added: ${x.j.company} - ${x.j.title} (fit ${x.s.fit})`);
            } catch (e) {
                log(`failed: ${x.j.company} - ${x.j.title}: ${e.message}`);
            }
        });
        run.status = 'done';
    } catch (e) {
        run.status = 'error';
        log(`error: ${e.message}`);
    } finally {
        run.finishedAt = new Date();
        await save();
        running = false;
    }
    return run;
}

function isRunning() {
    return running;
}

module.exports = { runCrawl, regenerate, addManual, isRunning };
