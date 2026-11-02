const crypto = require('crypto');

const UA = 'ResumeRoll/1.0 (personal job search)';

function stripHtml(html) {
    return String(html || '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<\/(p|div|li|h\d|br)>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n+/g, '\n\n')
        .trim();
}

function dedupeKey(job) {
    const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    return crypto.createHash('sha1')
        .update([norm(job.company), norm(job.title), norm(job.location)].join('|'))
        .digest('hex');
}

async function getJson(url, headers = {}) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers } });
    if (!res.ok) throw new Error(`${res.status} ${url.split('?')[0]}`);
    return res.json();
}

function titleMatches(title, roles) {
    const t = String(title || '').toLowerCase();
    const words = new Set();
    for (const r of roles) {
        for (const w of r.toLowerCase().split(/\s+/)) {
            if (w.length > 3 && !['senior', 'manager'].includes(w)) words.add(w);
        }
    }
    const phrases = roles.map(r => r.toLowerCase());
    if (phrases.some(p => t.includes(p))) return true;
    const hits = [...words].filter(w => t.includes(w));
    return hits.length >= 2;
}

async function adzuna(settings, log) {
    const id = process.env.ADZUNA_APP_ID;
    const key = process.env.ADZUNA_APP_KEY;
    if (!id || !key) {
        log('adzuna: skipped (no credentials)');
        return [];
    }
    const out = [];
    for (const role of settings.roles) {
        const params = new URLSearchParams({
            app_id: id,
            app_key: key,
            results_per_page: '30',
            what_phrase: role,
            salary_min: String(settings.minSalary),
            max_days_old: String(settings.maxDaysOld),
            sort_by: 'date',
            'content-type': 'application/json'
        });
        try {
            const data = await getJson(`https://api.adzuna.com/v1/api/jobs/us/search/1?${params}`);
            for (const r of data.results || []) {
                out.push({
                    source: 'adzuna',
                    externalId: String(r.id),
                    title: r.title ? stripHtml(r.title) : '',
                    company: r.company && r.company.display_name || '',
                    location: r.location && r.location.display_name || '',
                    remote: /remote/i.test(`${r.title} ${r.description}`),
                    salaryMin: r.salary_min || null,
                    salaryMax: r.salary_max || null,
                    salaryEstimated: r.salary_is_predicted === '1',
                    description: stripHtml(r.description),
                    url: r.redirect_url,
                    postedAt: r.created ? new Date(r.created) : null,
                    descriptionTruncated: true
                });
            }
        } catch (e) {
            log(`adzuna "${role}": ${e.message}`);
        }
    }
    log(`adzuna: ${out.length} raw`);
    return out;
}

async function jsearch(settings, log) {
    const key = process.env.RAPIDAPI_KEY;
    if (!key) {
        log('jsearch: skipped (no RAPIDAPI_KEY)');
        return [];
    }
    const out = [];
    for (const role of settings.roles) {
        const params = new URLSearchParams({
            query: `${role} in United States`,
            page: '1',
            num_pages: '1',
            date_posted: settings.maxDaysOld <= 1 ? 'today' : settings.maxDaysOld <= 3 ? '3days' : 'week'
        });
        try {
            const data = await getJson(`https://jsearch.p.rapidapi.com/search?${params}`, {
                'X-RapidAPI-Key': key,
                'X-RapidAPI-Host': 'jsearch.p.rapidapi.com'
            });
            for (const r of data.data || []) {
                out.push({
                    source: 'jsearch',
                    externalId: String(r.job_id),
                    title: r.job_title || '',
                    company: r.employer_name || '',
                    location: [r.job_city, r.job_state].filter(Boolean).join(', ') || r.job_country || '',
                    remote: !!r.job_is_remote,
                    salaryMin: r.job_min_salary || null,
                    salaryMax: r.job_max_salary || null,
                    salaryEstimated: false,
                    description: r.job_description || '',
                    url: r.job_apply_link || r.job_google_link,
                    postedAt: r.job_posted_at_datetime_utc ? new Date(r.job_posted_at_datetime_utc) : null
                });
            }
        } catch (e) {
            log(`jsearch "${role}": ${e.message}`);
        }
    }
    log(`jsearch: ${out.length} raw`);
    return out;
}

async function greenhouse(token, settings, log) {
    try {
        const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`);
        return (data.jobs || [])
            .filter(j => titleMatches(j.title, settings.roles))
            .map(j => ({
                source: 'greenhouse',
                externalId: `${token}:${j.id}`,
                title: j.title,
                company: j.company_name || token,
                location: j.location && j.location.name || '',
                remote: /remote/i.test(j.location && j.location.name || ''),
                salaryMin: null,
                salaryMax: null,
                description: stripHtml(j.content),
                url: j.absolute_url,
                postedAt: j.updated_at ? new Date(j.updated_at) : null,
                ats: 'greenhouse'
            }));
    } catch (e) {
        log(`greenhouse ${token}: ${e.message}`);
        return [];
    }
}

async function lever(company, settings, log) {
    try {
        const data = await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`);
        return data
            .filter(j => titleMatches(j.text, settings.roles))
            .map(j => {
                const sr = j.salaryRange || {};
                return {
                    source: 'lever',
                    externalId: `${company}:${j.id}`,
                    title: j.text,
                    company,
                    location: j.categories && j.categories.location || '',
                    remote: (j.workplaceType || '') === 'remote' || /remote/i.test(j.categories && j.categories.location || ''),
                    salaryMin: sr.min || null,
                    salaryMax: sr.max || null,
                    description: j.descriptionPlain || stripHtml(j.description),
                    url: j.hostedUrl,
                    postedAt: j.createdAt ? new Date(j.createdAt) : null,
                    ats: 'lever'
                };
            });
    } catch (e) {
        log(`lever ${company}: ${e.message}`);
        return [];
    }
}

async function ashby(name, settings, log) {
    try {
        const data = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(name)}?includeCompensation=true`);
        return (data.jobs || [])
            .filter(j => j.isListed !== false && titleMatches(j.title, settings.roles))
            .map(j => {
                const comp = j.compensation && j.compensation.summaryComponents || [];
                const base = comp.find(c => c.compensationType === 'Salary') || {};
                return {
                    source: 'ashby',
                    externalId: `${name}:${j.id}`,
                    title: j.title,
                    company: name,
                    location: j.location || '',
                    remote: !!j.isRemote,
                    salaryMin: base.minValue || null,
                    salaryMax: base.maxValue || null,
                    description: j.descriptionPlain || stripHtml(j.descriptionHtml),
                    url: j.jobUrl,
                    postedAt: j.publishedAt ? new Date(j.publishedAt) : null,
                    ats: 'ashby'
                };
            });
    } catch (e) {
        log(`ashby ${name}: ${e.message}`);
        return [];
    }
}

async function boards(settings, log) {
    const b = settings.boards || {};
    const tasks = [];
    for (const t of b.greenhouse || []) tasks.push(greenhouse(t, settings, log));
    for (const t of b.lever || []) tasks.push(lever(t, settings, log));
    for (const t of b.ashby || []) tasks.push(ashby(t, settings, log));
    const out = (await Promise.all(tasks)).flat();
    log(`boards: ${out.length} title-matched`);
    return out;
}

async function fetchAll(settings, log) {
    const src = settings.sources || {};
    const parts = [];
    if (src.adzuna) parts.push(adzuna(settings, log));
    if (src.jsearch) parts.push(jsearch(settings, log));
    if (src.boards) parts.push(boards(settings, log));
    const all = (await Promise.all(parts)).flat();
    return all.filter(j => j.title && j.company && j.url);
}

module.exports = { fetchAll, dedupeKey, stripHtml };
