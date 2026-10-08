import Trainer from '../models/Trainer.js';
import Notification from '../models/Notification.js';
import { loadSchedule } from '../routes/schedule.js';
import { sendMail, mailConfigured, esc, oneLine } from './mailer.js';

/*
 * "Save & notify": after a change commits, each trainer it touched gets one
 * email listing what changed for them, followed by their full weekly
 * timetable as it now stands. Sending happens after the response, one
 * message at a time, and every attempt is written to the Notification log.
 */

const sessionKey = s => `${s.day}|${(s.slots || []).join(',')}|${s.subject}|${s.venue || ''}|${s.startDate || ''}|${s.endDate || ''}`;
const sessionText = (s, slots) => {
  const idx = s.slots || [];
  const first = String(slots[idx[0]] || '').split(/[–-]/)[0];
  const last = String(slots[idx[idx.length - 1]] || '').split(/[–-]/).pop();
  return `${s.day}, slot ${idx.map(i => i + 1).join('–')} (${first}–${last}) · ${s.subject}${s.venue ? ` · ${s.venue}` : ''}`;
};

/* What changed for each trainer between two versions of a batch's sessions. */
export function batchChanges(before, after, slots) {
  const per = new Map();
  const add = (name, line) => { if (!per.has(name)) per.set(name, []); per.get(name).push(line); };
  const people = s => [
    ...(s.mainTrainers || []).map(n => [n, 'main mentor']),
    ...(s.supportTrainers || []).map(n => [n, 'support mentor']),
  ];
  const label = after?.name || before?.name || 'a batch';
  const oldS = before?.sessions || [], newS = after?.sessions || [];

  for (const s of newS) {
    const was = oldS.find(o => String(o._id) === String(s._id));
    for (const [n, role] of people(s)) {
      const had = was && people(was).some(([m, r]) => m === n && r === role);
      if (!had) add(n, `Added as ${role}: ${label} — ${sessionText(s, slots)}`);
      else if (sessionKey(was) !== sessionKey(s)) add(n, `Changed: ${label} — now ${sessionText(s, slots)} (was ${sessionText(was, slots)})`);
    }
  }
  for (const o of oldS) {
    const now = newS.find(s => String(s._id) === String(o._id));
    for (const [n, role] of people(o)) {
      if (!now || !people(now).some(([m, r]) => m === n && r === role)) {
        add(n, `Removed as ${role}: ${label} — ${sessionText(o, slots)}`);
      }
    }
  }
  return per;   // Map<trainerName, string[]>
}

function timetableText(view, data) {
  const lines = [];
  for (const d of data.days) {
    const row = data.slots.map((label, i) => {
      const role = view.roles?.[d]?.[i];
      if (role === 'main' || role === 'support') return `  ${label}  ${view.grid[d][i]} (${role})${view.venues?.[d]?.[i] ? ` @ ${view.venues[d][i]}` : ''}`;
      if (role === 'other') return `  ${label}  ${view.grid[d][i]} (assigned work)`;
      return null;
    }).filter(Boolean);
    lines.push(`${d}: ${row.length ? '' : 'no classes'}`, ...row);
  }
  return lines.join('\n');
}

function timetableHtml(view, data) {
  const head = data.days.map(d => `<th style="padding:6px 8px;border:1px solid #E2E7EF;background:#0A0A0A;color:#fff;font-size:12px">${esc(d)}</th>`).join('');
  const rows = data.slots.map((label, i) => {
    const cells = data.days.map(d => {
      const role = view.roles?.[d]?.[i];
      const v = view.grid?.[d]?.[i] || '';
      const style = role === 'main' ? 'background:#0047AB;color:#fff' : role === 'support' ? 'background:#DCE7F8;color:#002A66' : role === 'other' ? 'background:#EFF4FC;color:#002A66' : 'color:#646B76';
      return `<td style="padding:6px 8px;border:1px solid #E2E7EF;font-size:12px;${style}">${esc(role ? v : i === data.lunchIndex ? 'Lunch' : 'Free')}</td>`;
    }).join('');
    return `<tr><td style="padding:6px 8px;border:1px solid #E2E7EF;font-size:11px;font-family:monospace;color:#646B76">${esc(label)}</td>${cells}</tr>`;
  }).join('');
  return `<table style="border-collapse:collapse;margin-top:8px"><tr><th></th>${head}</tr>${rows}</table>`;
}

/*
 * Queue one email per trainer in `changes` (Map name → lines). Returns at once
 * with the counts; the actual sending continues in the background.
 */
export async function notifyTrainers(req, changes, context) {
  const names = [...changes.keys()].filter(Boolean);
  if (!names.length) return { queued: 0, skipped: 0, configured: mailConfigured() };

  const trainers = await Trainer.find({ name: { $in: names } }, { name: 1, email: 1 }).lean();
  const emailOf = Object.fromEntries(trainers.map(t => [t.name, t.email]));
  const by = req?.user?.email || '';
  const configured = mailConfigured();

  const docs = await Notification.insertMany(names.map(name => {
    const to = emailOf[name] || '';
    const subject = oneLine(`Timetable update — ${context}`);
    if (!to) return { to, trainer: name, subject, status: 'skipped', reason: 'Trainer has no email address', context, by };
    if (!configured) return { to, trainer: name, subject, status: 'skipped', reason: 'Email is not configured on the server', context, by };
    return { to, trainer: name, subject, status: 'queued', context, by };
  }));

  const queued = docs.filter(d => d.status === 'queued');
  if (queued.length) setImmediate(() => deliver(queued, changes).catch(err => console.error('notify:', err)));
  return { queued: queued.length, skipped: docs.length - queued.length, configured };
}

async function deliver(queued, changes) {
  const data = await loadSchedule();
  for (const n of queued) {
    const view = data.trainers.find(t => t.name === n.trainer);
    /* a long holiday can touch dozens of classes; keep the email readable */
    const all = changes.get(n.trainer) || [];
    const lines = all.length > 30 ? [...all.slice(0, 30), `…and ${all.length - 30} more`] : all;
    const text = [
      `Hello ${n.trainer},`, '',
      'Your training timetable has been updated:', ...lines.map(l => `• ${l}`), '',
      'Your weekly timetable now:', view ? timetableText(view, data) : '(not on the timetable)', '',
      '— Class Scheduler',
    ].join('\n');
    const html = `<div style="font-family:Arial,sans-serif;color:#0A0A0A;max-width:720px">
      <p>Hello ${esc(n.trainer)},</p>
      <p>Your training timetable has been updated:</p>
      <ul>${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
      <p style="margin-top:18px"><b>Your weekly timetable now</b></p>
      ${view ? timetableHtml(view, data) : '<p>(not on the timetable)</p>'}
      <p style="color:#646B76;font-size:12px;margin-top:18px">Sent by Class Scheduler.</p></div>`;
    try {
      await sendMail({ to: n.to, subject: n.subject, text, html });
      await Notification.updateOne({ _id: n._id }, { status: 'sent' });
    } catch (err) {
      await Notification.updateOne({ _id: n._id }, { status: err.skipped ? 'skipped' : 'failed', reason: String(err.message || err).slice(0, 300) });
    }
  }
}
