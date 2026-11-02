const { completeJson } = require('./llm');

const SYS_TRUTH = `You prepare job application material for one candidate. The candidate profile ("canonical truths") is the only source of facts. Never invent employers, titles, dates, metrics, degrees, certifications, tools, or achievements. You may reorder, select, and rephrase profile facts to fit the role. If the job asks for something absent from the profile, omit it; do not imply it.`;

const RESUME_SHAPE = `{
  "headline": string,
  "summary": string,
  "skills": string[],
  "experience": [{"company": string, "title": string, "dates": string, "location": string, "bullets": string[]}],
  "education": [{"school": string, "degree": string, "dates": string}],
  "achievements": string[]
}`;

function trimText(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n) : s;
}

async function extractProfile(resumes, existing) {
    const docs = resumes.map((r, i) => `--- RESUME ${i + 1}: ${r.label} ---\n${trimText(r.text, 12000)}`).join('\n\n');
    return completeJson({
        system: 'You extract a canonical candidate profile from resumes. Include only facts stated in the resumes or the existing profile. When resumes disagree, keep the more specific version and add the conflict to "conflicts".',
        prompt: `Existing profile (may be empty):\n${JSON.stringify(existing || {})}\n\nResumes:\n${docs}\n\nReturn JSON:\n{
  "contact": {"name": string, "email": string, "phone": string, "location": string, "links": string[]},
  "summary": string,
  "facts": string[],
  "experience": [{"company": string, "title": string, "dates": string, "location": string, "bullets": string[]}],
  "education": [{"school": string, "degree": string, "dates": string}],
  "skills": string[],
  "achievements": string[],
  "conflicts": string[]
}\n"facts" are standalone verifiable statements (patents, team sizes, scope, ownership level, certifications, languages).`,
        maxTokens: 8000
    });
}

async function scoreJob(job, profile, resumes, settings) {
    const resumeList = resumes.map(r => ({ id: String(r._id), label: r.label, excerpt: trimText(r.text, 1200) }));
    return completeJson({
        system: 'You screen job postings for one candidate and return strict JSON.',
        prompt: `Candidate profile:\n${JSON.stringify({ summary: profile.summary, facts: profile.facts, skills: profile.skills, experience: profile.experience.map(e => ({ company: e.company, title: e.title, bullets: e.bullets })) })}

Target roles: ${settings.roles.join('; ')}
Salary floor (USD base): ${settings.minSalary}
Remote allowed: ${settings.allowRemote}. Onsite/hybrid metros: ${settings.onsiteMetros.join('; ')}. Relocation: ${settings.allowRelocation ? settings.relocationNote : 'no'}.

Uploaded base resumes:\n${JSON.stringify(resumeList)}

Job:
Title: ${job.title}
Company: ${job.company}
Location: ${job.location} (remote flag: ${job.remote})
Listed salary: ${job.salaryMin || 'n/a'} - ${job.salaryMax || 'n/a'}
Description:\n${trimText(job.description, 7000)}

Return JSON:
{
  "fit": number 0-100 (match of candidate truths to requirements),
  "roleFamily": string (closest target role),
  "usBased": boolean,
  "locationOk": boolean,
  "remote": boolean,
  "salaryMin": number|null (listed, else your estimate),
  "salaryMax": number|null,
  "salaryEstimated": boolean,
  "requirements": string[] (top 8 stated requirements),
  "matches": string[] (candidate facts that satisfy requirements),
  "gaps": string[],
  "baseResumeId": string|null (id from the uploaded list best suited),
  "reason": string (one sentence)
}`,
        maxTokens: 1800
    });
}

async function generateMaterials(job, profile, baseResume) {
    const truths = {
        contact: profile.contact,
        summary: profile.summary,
        facts: profile.facts,
        experience: profile.experience,
        education: profile.education,
        skills: profile.skills,
        achievements: profile.achievements
    };
    const jobBlock = `Job: ${job.title} at ${job.company} (${job.location})
Requirements: ${(job.requirements || []).join('; ')}
Description:\n${trimText(job.description, 7000)}`;

    const core = await completeJson({
        system: SYS_TRUTH,
        prompt: `Canonical truths:\n${JSON.stringify(truths)}

Base resume for style reference only (facts must still come from canonical truths):\n${trimText(baseResume && baseResume.text, 6000)}

${jobBlock}

Produce a tailored resume and a cover letter.
Resume rules: one page of content; keep real employers/titles/dates exactly; 3-5 bullets per recent role, fewer for older; mirror the job's vocabulary only where the truths support it; skills list max 18.
Cover letter rules: body paragraphs only (3 short paragraphs, under 250 words); no greeting, no signoff, no date, no heading, no placeholders; specific to the company and role; no clichés; no claims beyond the truths.

Return JSON: {"resume": ${RESUME_SHAPE}, "coverLetter": string}`,
        maxTokens: 7000
    });

    const issues = await verify(core, truths);
    let result = core;
    if (issues.length) {
        result = await completeJson({
            system: SYS_TRUTH,
            prompt: `Fix these unsupported claims by removing or rewriting them using only the canonical truths.\nIssues:\n${issues.map(i => '- ' + i).join('\n')}\n\nCanonical truths:\n${JSON.stringify(truths)}\n\nCurrent draft:\n${JSON.stringify(core)}\n\nReturn JSON in the same shape: {"resume": ${RESUME_SHAPE}, "coverLetter": string}`,
            maxTokens: 7000
        });
    }
    result.resume.contact = { ...(truths.contact || {}) };
    result.verifyIssues = issues;
    return result;
}

async function verify(draft, truths) {
    try {
        const out = await completeJson({
            system: 'You are a strict fact checker for job application material.',
            prompt: `Canonical truths:\n${JSON.stringify(truths)}\n\nDraft:\n${JSON.stringify(draft)}\n\nList every claim in the draft (employer, title, date, metric, credential, tool, achievement, scope) that is not supported by the canonical truths. Return JSON: {"issues": string[]} (empty array if none).`,
            maxTokens: 1200
        });
        return Array.isArray(out.issues) ? out.issues : [];
    } catch (e) {
        return [];
    }
}

async function generateSite(job, profile, resume) {
    return completeJson({
        system: SYS_TRUTH,
        prompt: `Write the content for a short, specific microsite addressed to ${job.company} for the ${job.title} role. It doubles as portfolio and cover note. Tone: direct, confident, concrete, no hype, no clichés. Use only the candidate truths.

Candidate truths:\n${JSON.stringify({ summary: profile.summary, facts: profile.facts, experience: profile.experience, achievements: profile.achievements })}
Tailored resume:\n${JSON.stringify(resume)}
Job:\n${job.title} at ${job.company}\nRequirements: ${(job.requirements || []).join('; ')}\n${trimText(job.description, 5000)}

Return JSON:
{
  "headline": string (max 12 words),
  "intro": string (2-3 sentences),
  "whyThem": [{"title": string, "body": string}] (3 items, grounded in the posting),
  "proof": [{"title": string, "body": string}] (3 items, each tied to a real candidate fact),
  "firstNinetyDays": [{"title": string, "body": string}] (3 items: 30/60/90, plausible from the posting, no invented company internals),
  "closing": string (2 sentences)
}`,
        maxTokens: 3000
    });
}

module.exports = { extractProfile, scoreJob, generateMaterials, generateSite };
