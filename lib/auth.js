const crypto = require('crypto');

const COOKIE = 'rr_session';
const attempts = new Map();

function safeEqual(a, b) {
    const ab = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
}

function login(req, res) {
    const ip = req.ip;
    const rec = attempts.get(ip) || { n: 0, t: Date.now() };
    if (Date.now() - rec.t > 15 * 60 * 1000) {
        rec.n = 0;
        rec.t = Date.now();
    }
    if (rec.n >= 10) {
        return res.status(429).json({ error: 'too many attempts' });
    }
    const pw = process.env.ADMIN_PASSWORD;
    if (!pw || !safeEqual(req.body.password || '', pw)) {
        rec.n += 1;
        attempts.set(ip, rec);
        return res.status(401).json({ error: 'invalid password' });
    }
    res.cookie(COOKIE, '1', {
        signed: true,
        httpOnly: true,
        sameSite: 'lax',
        secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
        maxAge: 1000 * 60 * 60 * 24 * 14
    });
    res.json({ ok: true });
}

function logout(req, res) {
    res.clearCookie(COOKIE);
    res.json({ ok: true });
}

function requireAuth(req, res, next) {
    if (req.signedCookies && req.signedCookies[COOKIE] === '1') return next();
    res.status(401).json({ error: 'auth required' });
}

function status(req, res) {
    res.json({ authed: !!(req.signedCookies && req.signedCookies[COOKIE] === '1') });
}

module.exports = { login, logout, requireAuth, status };
