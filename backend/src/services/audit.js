import AuditLog from '../models/AuditLog.js';

/*
 * Change history. `audit(req, entry, session)` records who did what; pass the
 * transaction `session` when there is one so the entry commits (or rolls back)
 * with the change it describes.
 *
 * `diff(before, after)` lists changed fields as readable strings. Secrets and
 * bookkeeping fields are never recorded.
 */
const HIDDEN = new Set(['passwordHash', 'tokenVersion', '__v', 'createdAt', 'updatedAt', '_id', 'id']);
const MAX = 400;

const show = v => {
  if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return '—';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > MAX ? `${s.slice(0, MAX - 1)}…` : s;
};

/* sessions read better as one line each than as JSON */
const sessionLine = s => `${s.day} slot ${(s.slots || []).map(i => i + 1).join(',')} · ${s.subject}`
  + `${s.venue ? ` @ ${s.venue}` : ''}`
  + `${(s.mainTrainers || []).length ? ` · main: ${s.mainTrainers.join(', ')}` : ''}`
  + `${(s.supportTrainers || []).length ? ` · support: ${s.supportTrainers.join(', ')}` : ''}`
  + `${s.startDate || s.endDate ? ` · ${s.startDate || '…'}→${s.endDate || '…'}` : ''}`;

export function diff(before = {}, after = {}) {
  const changes = [];
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const k of keys) {
    if (HIDDEN.has(k)) continue;
    if (k === 'sessions') {
      const a = (before?.sessions || []).map(sessionLine), b = (after?.sessions || []).map(sessionLine);
      const removed = a.filter(x => !b.includes(x)), added = b.filter(x => !a.includes(x));
      removed.forEach(x => changes.push({ field: 'session removed', from: show(x), to: '—' }));
      added.forEach(x => changes.push({ field: 'session added', from: '—', to: show(x) }));
      continue;
    }
    const x = before?.[k], y = after?.[k];
    const from = show(x), to = show(y);
    if (from !== to) changes.push({ field: k, from, to });
  }
  return changes.slice(0, 80);
}

export const plain = doc => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc) || {};

export async function audit(req, { action, entity, entityId = '', name = '', summary = '', changes = [] }, session) {
  const entry = {
    actor: req?.user ? { id: req.user.id, email: req.user.email, role: req.user.role } : { id: null, email: req?.auditEmail || '', role: '' },
    action, entity, entityId: String(entityId || ''), name: String(name || '').slice(0, 200),
    summary: String(summary || '').slice(0, 500), changes,
    ip: String(req?.ip || '').slice(0, 64),
  };
  await AuditLog.create([entry], session ? { session } : undefined);
}
