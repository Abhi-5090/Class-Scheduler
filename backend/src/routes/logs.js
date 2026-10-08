import { Router } from 'express';
import AuditLog from '../models/AuditLog.js';
import Notification from '../models/Notification.js';
import { requireAuth } from '../middleware/auth.js';
import { wrap } from '../middleware/asyncRoute.js';
import { mailConfigured, sendMail, oneLine } from '../services/mailer.js';
import { audit } from '../services/audit.js';
import { str, fail, date, EMAIL_RE, ADMIN, COORD } from './_shared.js';

/*
 *   GET  /audit           change history, filtered and paged    (admin)
 *   GET  /notifications   every email attempt and its outcome    (admin, coordinator)
 *   GET  /mail            is email configured?                    (admin, coordinator)
 *   POST /mail/test       send a test email                       (admin)
 */
const router = Router();
router.use(requireAuth());

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

router.get('/audit', ADMIN, wrap(async (req, res) => {
  const filter = {};
  const entity = str(req.query.entity), action = str(req.query.action), actor = str(req.query.actor).slice(0, 254);
  if (entity && /^[a-z_]{1,20}$/.test(entity)) filter.entity = entity;
  if (action && /^[a-z_]{1,20}$/.test(action)) filter.action = action;
  if (actor) filter['actor.email'] = actor.toLowerCase();
  const from = req.query.from ? date(req.query.from, 'From') : '', to = req.query.to ? date(req.query.to, 'To') : '';
  if (from || to) filter.at = { ...(from ? { $gte: new Date(`${from}T00:00:00Z`) } : {}), ...(to ? { $lte: new Date(`${to}T23:59:59Z`) } : {}) };
  /* free-text search is a literal, escaped match — never a user-supplied regex */
  const q = str(req.query.q).slice(0, 80);
  if (q) {
    const re = new RegExp(escapeRe(q), 'i');
    filter.$or = [{ name: re }, { summary: re }, { 'changes.from': re }, { 'changes.to': re }];
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ at: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);
  res.json({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
}));

router.get('/notifications', COORD, wrap(async (req, res) => {
  const status = str(req.query.status);
  const filter = ['sent', 'failed', 'skipped', 'queued'].includes(status) ? { status } : {};
  res.json({ items: await Notification.find(filter).sort({ at: -1 }).limit(200).lean(), configured: mailConfigured() });
}));

router.get('/mail', COORD, (_req, res) => {
  res.json({ configured: mailConfigured(), from: mailConfigured() ? oneLine(process.env.MAIL_FROM) : '' });
});

router.post('/mail/test', ADMIN, wrap(async (req, res) => {
  const to = str(req.body?.to || req.user.email).toLowerCase().slice(0, 254);
  if (!EMAIL_RE.test(to)) return fail(res, 400, 'Enter a valid email address');
  if (!mailConfigured()) return fail(res, 400, 'Email is not configured — set SMTP_HOST and MAIL_FROM in the backend .env');
  try {
    await sendMail({
      to, subject: 'Class Scheduler — test email',
      text: 'This is a test message from Class Scheduler. If you can read it, timetable notifications will reach your trainers.',
      html: '<p>This is a test message from <b>Class Scheduler</b>. If you can read it, timetable notifications will reach your trainers.</p>',
    });
  } catch (e) {
    return fail(res, 502, `The mail server refused it: ${String(e.message).slice(0, 200)}`);
  }
  await Notification.create({ to, subject: 'Class Scheduler — test email', status: 'sent', context: 'Test email', by: req.user.email });
  await audit(req, { action: 'notify', entity: 'notification', name: to, summary: 'Sent a test email' });
  res.json({ ok: true });
}));

export default router;
