import { Router } from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Trainer from '../models/Trainer.js';
import { signToken, cookieOptions, requireAuth, COOKIE } from '../middleware/auth.js';
import { lockedFor, recordFailure, recordSuccess } from '../middleware/loginLimiter.js';
import { wrap } from '../middleware/asyncRoute.js';
import { audit } from '../services/audit.js';

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
export const MIN_PW = 8, MAX_PW = 72;

/* compared against when there is no such account, so an unknown email costs the
   same bcrypt time as a wrong password and response time reveals nothing */
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

const tooMany = (res, seconds) => {
  res.set('Retry-After', String(seconds));
  return res.status(429).json({ error: `Too many failed attempts — try again in ${Math.ceil(seconds / 60)} minute(s)` });
};

/* what the client is told about the signed-in account */
async function profile(u) {
  const trainer = u.trainer ? await Trainer.findById(u.trainer, { name: 1 }).lean() : null;
  return {
    email: u.email, name: u.name || '', role: u.role,
    trainerId: trainer ? String(trainer._id) : null, trainerName: trainer?.name || null,
    mustChangePassword: !!u.mustChangePassword,
  };
}

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

  const user = password.length <= MAX_PW ? await User.findOne({ email }) : null;
  const ok = user && user.active ? await user.verify(password) : (await bcrypt.compare(password.slice(0, MAX_PW), DUMMY_HASH), false);
  await settle(started);
  if (!ok) {
    recordFailure(req.ip, email);
    /* only a real account's address is recorded — whatever else was typed in
       the email box (sometimes a password) is not */
    req.auditEmail = user ? email : '';
    await audit(req, { action: 'login_failed', entity: 'auth', name: user ? email : '(unknown account)', summary: user && !user.active ? 'Account is deactivated' : 'Wrong email or password' });
    return res.status(401).json({ error: 'Incorrect email or password' });
  }

  recordSuccess(req.ip, email);
  user.lastLoginAt = new Date();
  await user.save();
  req.user = { id: String(user._id), email: user.email, role: user.role };
  await audit(req, { action: 'login', entity: 'auth', entityId: user._id, name: user.email });
  res.cookie(COOKIE, signToken(user), cookieOptions());
  res.json({ user: await profile(user) });
}));

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: undefined });
  res.json({ ok: true });
});

/* The client calls this on boot to find out whether it already has a session. */
router.get('/me', requireAuth({ allowPending: true }), wrap(async (req, res) => {
  const u = await User.findById(req.user.id).lean();
  res.json({ user: await profile(u) });
}));

router.post('/password', requireAuth({ allowPending: true }), wrap(async (req, res) => {
  const current = String(req.body?.currentPassword || '');
  const next = String(req.body?.newPassword || '');

  if (next.length < MIN_PW || next.length > MAX_PW) {
    return res.status(400).json({ error: `New password must be ${MIN_PW}–${MAX_PW} characters` });
  }
  if (next === current) return res.status(400).json({ error: 'Choose a password different from the current one' });

  /* a stolen session must not become an unlimited oracle for the current password */
  const wait = lockedFor(req.ip, req.user.email);
  if (wait) return tooMany(res, wait);

  const user = await User.findById(req.user.id);
  if (!user) return res.status(401).json({ error: 'Account no longer exists' });
  if (!(await user.verify(current))) {
    recordFailure(req.ip, req.user.email);
    return res.status(400).json({ error: 'Current password is incorrect' });
  }

  /* bumping the version kills every token issued before now — this browser's
     included — so every device has to sign in with the new password */
  user.passwordHash = await User.hash(next);
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  user.mustChangePassword = false;
  await user.save();
  await audit(req, { action: 'password', entity: 'user', entityId: user._id, name: user.email, summary: 'Changed own password' });

  res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: undefined });
  res.json({ ok: true, reauth: true });
}));

export default router;
