const { MongoClient, ObjectId } = require('mongodb');

let client;
let db;

const DEFAULT_SETTINGS = {
    _id: 'settings',
    roles: [
        'Sales Engineer', 'Partner Development Manager', 'Technical Program Manager',
        'Full Stack Software Engineer', 'AI Test Engineer', 'Prompt Engineer',
        'Entrepreneur in Residence', 'Founder in Residence', 'Product Owner',
        'VR Designer', 'VR Developer', 'VR Prototype Developer', 'Senior Engineer',
        'Senior Solutions Architect', 'Senior Solutions Engineer', 'Game Producer'
    ],
    minSalary: 100000,
    includeUnlistedSalary: true,
    allowRemote: true,
    onsiteMetros: ['Austin, TX', 'Round Rock, TX'],
    allowRelocation: true,
    relocationNote: 'Any US metro',
    minFitScore: 60,
    maxNewPerRun: 15,
    maxDaysOld: 3,
    boards: {
        greenhouse: [],
        lever: [],
        ashby: []
    },
    sources: {
        adzuna: true,
        jsearch: true,
        boards: true
    }
};

async function connect() {
    if (db) return db;
    client = new MongoClient(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017');
    await client.connect();
    db = client.db(process.env.MONGODB_DB || 'resumeroll');
    await db.collection('jobs').createIndex({ dedupeKey: 1 }, { unique: true });
    await db.collection('jobs').createIndex({ status: 1, createdAt: -1 });
    await db.collection('jobs').createIndex({ siteSlug: 1 }, { sparse: true });
    await db.collection('assets').createIndex({ kind: 1, createdAt: -1 });
    await db.collection('config').updateOne(
        { _id: 'settings' },
        { $setOnInsert: DEFAULT_SETTINGS },
        { upsert: true }
    );
    return db;
}

function col(name) {
    if (!db) throw new Error('db not connected');
    return db.collection(name);
}

function oid(id) {
    try {
        return new ObjectId(String(id));
    } catch (e) {
        return null;
    }
}

async function getSettings() {
    const doc = await col('config').findOne({ _id: 'settings' });
    return { ...DEFAULT_SETTINGS, ...doc };
}

async function saveSettings(patch) {
    const allowed = [
        'roles', 'minSalary', 'includeUnlistedSalary', 'allowRemote', 'onsiteMetros',
        'allowRelocation', 'relocationNote', 'minFitScore', 'maxNewPerRun', 'maxDaysOld',
        'boards', 'sources'
    ];
    const set = {};
    for (const k of allowed) {
        if (patch[k] !== undefined) set[k] = patch[k];
    }
    await col('config').updateOne({ _id: 'settings' }, { $set: set });
    return getSettings();
}

async function getProfile() {
    const doc = await col('config').findOne({ _id: 'profile' });
    return doc || {
        _id: 'profile',
        contact: {
            name: '',
            email: process.env.APPLICANT_EMAIL || 'charlie@vannorman.ai',
            phone: '',
            location: 'Round Rock, TX',
            links: []
        },
        summary: '',
        facts: [],
        experience: [],
        education: [],
        skills: [],
        achievements: [],
        updatedAt: null
    };
}

async function saveProfile(profile) {
    const doc = { ...profile, _id: 'profile', updatedAt: new Date() };
    await col('config').replaceOne({ _id: 'profile' }, doc, { upsert: true });
    return doc;
}

module.exports = { connect, col, oid, getSettings, saveSettings, getProfile, saveProfile, DEFAULT_SETTINGS };
