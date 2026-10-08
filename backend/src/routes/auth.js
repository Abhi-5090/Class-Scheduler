import { Router } from 'express';
import Admin from '../models/Admin.js';
import { signToken, cookieOptions, requireAdmin, COOKIE } from '../middleware/auth.js';
import { lockedFor, recordFailure, recordSuccess } from '../middleware/loginLimiter.js';
import { wrap } from '../middleware/asyncRoute.js';

const router = Router();

/* A fixed floor on how long a failed login takes, so the response time cannot
   be used to tell "no such account" apart from "wrong password". */
const SLOW = 350;
const settle = async (started) => {
  const left = SLOW - (Date.now() - started);
  if (left > 0) await new Promise(r => setTimeout(r, left));
};

/* bcrypt only reads the first 72 bytes; a longer "password" would silently
   match on its prefix, so the limits are stated rather than implied */
const MIN_PW = 8, MAX_PW = 72;

const tooMany = (res, seconds) => {
  res.set('Retry-After', String(seconds));
  return res.status(429).json({ error: `Too many failed attempts — try again in ${Math.ceil(seconds / 60)} minute(s)` });
};

router.post('/login', wrap(async (req, res) => {
  const started = Date.now();
  const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 254);
  const password = String(req.body?.password || '');

  if (!email || !password) {
    await settle(started);
    return res.status(400).json({ error: 'Email and password are both required' });
  }

  const wait = lockedFor(req.ip, email);
  if (wait) { await settle(started); return tooMany(res, wait); }

  const admin = password.length <= MAX_PW ? await Admin.findOne({ email }) : null;
  const ok = admin ? await admin.verify(password) : false;
  await settle(started);
  if (!ok) {
    recordFailure(req.ip, email);
    return res.status(401).json({ error: 'Incorrect email or password' });
  }

  recordSuccess(req.ip, email);
  res.cookie(COOKIE, signToken(admin), cookieOptions());
  res.json({ admin: { email: admin.email, name: admin.name } });
}));

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: undefined });
  res.json({ ok: true });
});

/* The client calls this on boot to find out whether it already has a session. */
router.get('/me', requireAdmin, (req, res) => {
  res.json({ admin: { email: req.admin.email, name: req.admin.name } });
});

router.post('/password', requireAdmin, wrap(async (req, res) => {
  const current = String(req.body?.currentPassword || '');
  const next = String(req.body?.newPassword || '');

  if (next.length < MIN_PW || next.length > MAX_PW) {
    return res.status(400).json({ error: `New password must be ${MIN_PW}–${MAX_PW} characters` });
  }

  /* a stolen session must not become an unlimited oracle for the current password */
  const wait = lockedFor(req.ip, req.admin.email);
  if (wait) return tooMany(res, wait);

  const admin = await Admin.findById(req.admin.sub);
  if (!admin) return res.status(401).json({ error: 'Account no longer exists' });
  if (!(await admin.verify(current))) {
    recordFailure(req.ip, req.admin.email);
    return res.status(400).json({ error: 'Current password is incorrect' });
  }

  /* bumping the version kills every token issued before now — this browser's
     included — so every device has to sign in with the new password */
  admin.passwordHash = await Admin.hash(next);
  admin.tokenVersion = (admin.tokenVersion || 0) + 1;
  await admin.save();

  res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: undefined });
  res.json({ ok: true, reauth: true });
}));

export default router;
