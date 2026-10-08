import { Router } from 'express';
import crypto from 'node:crypto';
import User, { ROLES } from '../models/User.js';
import Trainer from '../models/Trainer.js';
import { requireAuth } from '../middleware/auth.js';
import { wrap } from '../middleware/asyncRoute.js';
import { audit } from '../services/audit.js';
import { MIN_PW, MAX_PW } from './auth.js';
import { str, fail, httpError, text, validId, EMAIL_RE, atomically, ADMIN, lockSchedule } from './_shared.js';

/*
 * Sign-in accounts — admin only. Accounts are created with a temporary
 * password that the person must replace at first sign-in; a reset issues a
 * new temporary one. The last active admin can never be removed, demoted or
 * deactivated, and nobody can do any of those to their own account here.
 */
const router = Router();
router.use(requireAuth(), ADMIN);

const shape = (u, trainersById) => ({
  _id: String(u._id), email: u.email, name: u.name || '', role: u.role, active: u.active,
  trainerId: u.trainer ? String(u.trainer) : null,
  trainerName: u.trainer ? trainersById.get(String(u.trainer)) || '(deleted trainer)' : null,
  mustChangePassword: !!u.mustChangePassword, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt,
});

/* readable, 14 characters, no look-alikes; shown to the admin exactly once */
function tempPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(14);
  return [...bytes].map(b => alphabet[b % alphabet.length]).join('');
}

async function trainerLink(role, trainerId, selfId) {
  if (role !== 'trainer') return null;
  if (!validId(String(trainerId || ''))) throw Object.assign(new Error('Pick the trainer this account belongs to'), { status: 400 });
  const t = await Trainer.findById(trainerId).lean();
  if (!t) throw Object.assign(new Error('That trainer no longer exists'), { status: 400 });
  const taken = await User.findOne({ trainer: t._id, _id: { $ne: selfId } }).lean();
  if (taken) throw Object.assign(new Error(`${t.name} already has an account (${taken.email})`), { status: 409 });
  return t._id;
}

const activeAdmins = (excludeId) => User.countDocuments({ role: 'admin', active: true, ...(excludeId ? { _id: { $ne: excludeId } } : {}) });

/* inside the write's transaction, under the shared lock: two admins demoting
   each other at the same moment conflict, and the retry sees the first change */
async function keepAnAdmin(session) {
  await lockSchedule(session);
  if (!(await User.countDocuments({ role: 'admin', active: true }).session(session))) {
    throw httpError(409, 'This would leave no active admin — make someone else an admin first');
  }
}

router.get('/', wrap(async (_req, res) => {
  const [users, trainers] = await Promise.all([User.find().sort({ role: 1, email: 1 }).lean(), Trainer.find({}, { name: 1 }).lean()]);
  const byId = new Map(trainers.map(t => [String(t._id), t.name]));
  res.json(users.map(u => shape(u, byId)));
}));

router.post('/', wrap(async (req, res) => {
  const email = text(req.body?.email, 'email').toLowerCase();
  if (!EMAIL_RE.test(email)) return fail(res, 400, 'Enter a valid email address');
  const role = str(req.body?.role);
  if (!ROLES.includes(role)) return fail(res, 400, 'Pick a role');
  if (await User.findOne({ email })) return fail(res, 409, 'An account with that email already exists');

  const trainer = await trainerLink(role, req.body?.trainerId);
  const password = tempPassword();
  let created;
  await atomically(async session => {
    [created] = await User.create([{
      email, name: text(req.body?.name, 'name'), role, trainer,
      passwordHash: await User.hash(password), mustChangePassword: true,
    }], { session });
    await audit(req, { action: 'create', entity: 'user', entityId: created._id, name: email, summary: `Created ${role} account` }, session);
  });
  /* the only time this password is ever shown */
  res.status(201).json({ user: { _id: String(created._id), email, role }, temporaryPassword: password });
}));

router.put('/:id', wrap(async (req, res) => {
  if (!validId(req.params.id)) return fail(res, 404, 'Account not found');
  const user = await User.findById(req.params.id);
  if (!user) return fail(res, 404, 'Account not found');
  const self = String(user._id) === req.user.id;

  const role = req.body?.role !== undefined ? str(req.body.role) : user.role;
  if (!ROLES.includes(role)) return fail(res, 400, 'Pick a role');
  const active = req.body?.active !== undefined ? !!req.body.active : user.active;

  if (self && (role !== user.role || !active)) return fail(res, 400, 'You cannot change your own role or deactivate your own account');
  if (user.role === 'admin' && user.active && (role !== 'admin' || !active) && await activeAdmins(user._id) === 0) {
    return fail(res, 409, 'This is the last active admin — make someone else an admin first');
  }

  const changes = [];
  const before = { role: user.role, active: user.active, name: user.name, trainer: user.trainer ? String(user.trainer) : '' };
  user.name = req.body?.name !== undefined ? text(req.body.name, 'name') : user.name;
  const trainer = req.body?.trainerId !== undefined || role !== user.role ? await trainerLink(role, req.body?.trainerId ?? user.trainer, user._id) : user.trainer;

  /* losing access (role change, deactivation) ends the person's sessions now */
  const accessChanged = role !== user.role || active !== user.active || String(trainer || '') !== String(user.trainer || '');
  user.role = role; user.active = active; user.trainer = trainer;
  if (accessChanged) user.tokenVersion = (user.tokenVersion || 0) + 1;

  let password = null;
  if (req.body?.resetPassword) {
    if (self) return fail(res, 400, 'Change your own password from Settings');
    password = tempPassword();
    user.passwordHash = await User.hash(password);
    user.mustChangePassword = true;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    changes.push({ field: 'password', from: '—', to: 'reset to a temporary password' });
  }

  for (const k of ['role', 'active', 'name']) if (String(before[k]) !== String(user[k])) changes.push({ field: k, from: String(before[k]), to: String(user[k]) });
  if (before.trainer !== String(user.trainer || '')) changes.push({ field: 'trainer', from: before.trainer || '—', to: String(user.trainer || '—') });

  await atomically(async session => {
    await user.save({ session });
    await keepAnAdmin(session);
    if (changes.length) await audit(req, { action: 'update', entity: 'user', entityId: user._id, name: user.email, changes }, session);
  });
  res.json({ ok: true, temporaryPassword: password });
}));

router.delete('/:id', wrap(async (req, res) => {
  if (!validId(req.params.id)) return fail(res, 404, 'Account not found');
  const user = await User.findById(req.params.id);
  if (!user) return fail(res, 404, 'Account not found');
  if (String(user._id) === req.user.id) return fail(res, 400, 'You cannot delete your own account');
  if (user.role === 'admin' && user.active && await activeAdmins(user._id) === 0) {
    return fail(res, 409, 'This is the last active admin — make someone else an admin first');
  }
  await atomically(async session => {
    await user.deleteOne({ session });
    await keepAnAdmin(session);
    await audit(req, { action: 'delete', entity: 'user', entityId: user._id, name: user.email, summary: `Deleted ${user.role} account` }, session);
  });
  res.json({ ok: true });
}));

export const PASSWORD_LIMITS = { MIN_PW, MAX_PW };
export default router;
