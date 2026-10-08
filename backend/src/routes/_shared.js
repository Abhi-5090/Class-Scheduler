import mongoose from 'mongoose';
import { isIsoDate } from '../services/dates.js';
import { requireRole } from '../middleware/auth.js';
import Config from '../models/Config.js';

/* Shared request-validation helpers for every route file. Anything that
   refuses input throws an httpError; the error middleware turns its status
   into the response. */

export const str = v => String(v ?? '').trim();
export const fail = (res, status, error) => res.status(status).json({ error });
export const httpError = (status, message) => Object.assign(new Error(message), { status });

/* Every free-text field has a ceiling, so nobody can park megabytes in a name. */
export const LIMITS = { name: 120, subject: 120, note: 500, label: 200, email: 254, phone: 32, dept: 80, slot: 40, day: 20 };
export const text = (v, kind, what = kind) => {
  const s = str(v);
  if (s.length > LIMITS[kind]) throw httpError(400, `${what[0].toUpperCase()}${what.slice(1)} is too long (max ${LIMITS[kind]} characters)`);
  return s;
};
export const count = (v, what) => {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 100000) throw httpError(400, `${what} must be a whole number`);
  return n;
};
export const orderNum = v => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw httpError(400, 'Order must be a number');
  return n;
};
export const date = (v, what) => {
  const s = str(v);
  if (!isIsoDate(s)) throw httpError(400, `${what} must be a date (YYYY-MM-DD)`);
  return s;
};
export const dateRange = (start, end, what) => {
  if (start && end && end < start) throw httpError(400, `${what}: the end date is before the start date`);
};
export const validId = id => typeof id === 'string' && mongoose.isValidObjectId(id) && /^[a-f\d]{24}$/i.test(id);
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const normTrack = v => (['non-teaching', 'non-technical', 'non-tech'].includes(str(v).toLowerCase()) ? 'non-teaching' : 'teaching');
export const isNonTeaching = t => t?.track === 'non-teaching' || t?.track === 'non-technical';

/* Runs `fn(session)` as one all-or-nothing transaction (Atlas replica set). */
export const atomically = fn => mongoose.connection.transaction(fn);

/* role gates, used after requireAuth() */
export const ADMIN = requireRole('admin');
export const COORD = requireRole('admin', 'coordinator');

/* weekday name of a YYYY-MM-DD date (UTC-safe) */
export const weekdayOf = d => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(`${d}T00:00:00Z`).getUTCDay()];

/* `notify` arrives as a query flag or a body field */
export const wantsNotify = req => ['1', 'true'].includes(String(req.query?.notify ?? req.body?.notify ?? '').toLowerCase());

/* Take the timetable "lock" inside a transaction — see Config.rev. Every
   transaction that checks for clashes and then writes calls this first. */
export const lockSchedule = async session => {
  await Config.updateOne({ key: 'default' }, { $inc: { rev: 1 } }, { session });
};

/* case-insensitive name lookups, so "Batch-1" and "batch-1" are the same name */
export const CI = { locale: 'en', strength: 2 };
