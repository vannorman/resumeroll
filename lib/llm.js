const Anthropic = require('@anthropic-ai/sdk');

let client;

function getClient() {
    if (!client) {
        if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
        client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
    return client;
}

function model() {
    return process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
}

function extractJson(text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced ? fenced[1] : text;
    const start = candidate.search(/[\[{]/);
    if (start < 0) throw new Error('no JSON in model output');
    const open = candidate[start];
    const close = open === '{' ? '}' : ']';
    const end = candidate.lastIndexOf(close);
    if (end < start) throw new Error('unterminated JSON in model output');
    return JSON.parse(candidate.slice(start, end + 1));
}

async function complete({ system, prompt, maxTokens = 4096 }) {
    const res = await getClient().messages.create({
        model: model(),
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: prompt }]
    });
    return res.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
}

async function completeJson(opts) {
    const text = await complete({
        ...opts,
        system: (opts.system || '') + '\nReturn only valid JSON. No prose, no markdown fences.'
    });
    try {
        return extractJson(text);
    } catch (e) {
        const retry = await complete({
            ...opts,
            system: (opts.system || '') + '\nReturn only valid JSON. No prose, no markdown fences.',
            prompt: opts.prompt + '\n\nYour previous reply was not valid JSON. Reply with valid JSON only.'
        });
        return extractJson(retry);
    }
}

module.exports = { complete, completeJson, extractJson };
