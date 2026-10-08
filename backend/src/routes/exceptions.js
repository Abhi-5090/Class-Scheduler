import { Router } from 'express';
import Exception, { EXCEPTION_TYPES } from '../models/Exception.js';
import Batch from '../models/Batch.js';
import Trainer from '../models/Trainer.js';
import Config from '../models/Config.js';
import Activity from '../models/Activity.js';
import { requireAuth } from '../middleware/auth.js';
import { wrap } from '../middleware/asyncRoute.js';
import { audit, diff, plain } from '../services/audit.js';
import { notifyTrainers } from '../services/notify.js';
import { classesOn, datesBetween, holidayOn, weekday } from '../services/occurrences.js';
import { rangeStatus, sessionRange } from '../services/dates.js';
import { str, fail, httpError, text, date, validId, atomically, COORD, wantsNotify, lockSchedule } from './_shared.js';

/*
 * Holidays and one-off exceptions to the weekly timetable. Coordinators and
 * admins manage them; the public board reads them through /api/schedule.
 */
const router = Router();
router.use(requireAuth(), COORD);

const MAX_HOLIDAY_DAYS = 62;

const describe = e => (e.type === 'holiday'
  ? `Holiday ${e.date}${e.endDate && e.endDate !== e.date ? ` to ${e.endDate}` : ''}${e.label ? ` — ${e.label}` : ''}`
  : `${e.type === 'cancel' ? 'Cancelled' : `Substitute ${e.toTrainer} for ${e.fromTrainer}`}: ${e.batch} · ${e.subject} on ${e.date}`);

router.get('/', wrap(async (req, res) => {
  const from = req.query.from ? date(req.query.from, 'from') : '';
  const to = req.query.to ? date(req.query.to, 'to') : '';
  const filter = {};
  if (from) filter.$or = [{ endDate: { $gte: from } }, { date: { $gte: from } }];
  if (to) filter.date = { $lte: to };
  res.json(await Exception.find(filter).sort({ date: 1, type: 1 }).limit(1000).lean());
}));

/* Is `name` free for `slots` on `date`, other than in the class being covered? */
async function substituteFree(name, dateStr, slots, ctx, skipSessionId) {
  const { classes } = classesOn(dateStr, ctx);
  const busy = classes.find(c => c.status === 'running' && String(c.sessionId) !== String(skipSessionId)
    && [...c.main, ...c.support].includes(name) && c.slots.some(i => slots.includes(i)));
  if (busy) return `${name} is teaching ${busy.batch} (${busy.subject}) at that time on ${dateStr}`;
  const work = await Activity.findOne({ trainer: name, day: weekday(dateStr), slot: { $in: slots } }).lean();
  if (work) return `${name} has assigned work (${work.kind === 'lunch' ? 'lunch' : work.label}) at that time every ${work.day}`;
  return null;
}

router.post('/', wrap(async (req, res) => {
  const type = str(req.body?.type);
  if (!EXCEPTION_TYPES.includes(type)) return fail(res, 400, 'Pick holiday, cancel or substitute');
  const d = date(req.body?.date, 'Date');
  if (!d) return fail(res, 400, 'Pick a date');
  const label = text(req.body?.label, 'label', 'reason');

  /* every check and the write happen under the schedule lock, so two people
     cannot book the same substitute into two classes at once */
  let created, config, existing, doc;
  await atomically(async session => {
    await lockSchedule(session);
    [config, existing] = await Promise.all([Config.findOne({ key: 'default' }).lean(), Exception.find().session(session).lean()]);
    doc = { type, date: d, label };

    if (type === 'holiday') {
      const end = req.body?.endDate ? date(req.body.endDate, 'End date') : '';
      if (end && end < d) throw httpError(400, 'The holiday ends before it starts');
      if (end && datesBetween(d, end).length > MAX_HOLIDAY_DAYS) throw httpError(400, `A holiday can span at most ${MAX_HOLIDAY_DAYS} days`);
      if (!label) throw httpError(400, 'Name the holiday (e.g. Diwali, Semester break)');
      const clash = existing.find(e => e.type === 'holiday' && e.date <= (end || d) && (e.endDate || e.date) >= d);
      if (clash) throw httpError(409, `That overlaps an existing holiday: ${describe(clash)}`);
      doc.endDate = end && end !== d ? end : '';
    } else {
      if (!validId(str(req.body?.batchId)) || !validId(str(req.body?.sessionId))) throw httpError(400, 'Pick the batch and the class');
      const batch = await Batch.findById(req.body.batchId).lean();
      if (!batch) throw httpError(404, 'Batch not found');
      const s = (batch.sessions || []).find(x => String(x._id) === str(req.body.sessionId));
      if (!s) throw httpError(404, 'That class is no longer on this batch');
      if (weekday(d) !== s.day) throw httpError(400, `This class runs on ${s.day}s; ${d} is a ${weekday(d)}`);
      const { start, end } = sessionRange(s, batch);
      if (rangeStatus(start, end, d) !== 'current') throw httpError(400, `${batch.name} does not run this class on ${d} (it runs ${start || '…'} to ${end || '…'})`);
      const hol = holidayOn(d, existing);
      if (hol) throw httpError(409, `${d} is already a holiday (${hol.label}) — no classes run that day`);
      const dup = existing.find(e => String(e.sessionId) === String(s._id) && e.date === d);
      if (dup) throw httpError(409, `This class already has an exception that day: ${describe(dup)}`);

      Object.assign(doc, { batchId: batch._id, batch: batch.name, sessionId: s._id, day: s.day, slots: s.slots, subject: s.subject });

      if (type === 'substitute') {
        const people = [...(s.mainTrainers || []), ...(s.supportTrainers || [])];
        const from = text(req.body?.fromTrainer, 'name', 'trainer');
        const to = text(req.body?.toTrainer, 'name', 'substitute');
        if (!people.includes(from)) throw httpError(400, `${from || 'That trainer'} does not teach this class`);
        const sub = await Trainer.findOne({ name: to }).lean();
        if (!sub) throw httpError(400, 'Pick the substitute from the trainer list');
        if (sub.active === false) throw httpError(400, `${to} is marked inactive`);
        if (people.includes(to)) throw httpError(400, `${to} already teaches this class`);
        const batches = await Batch.find().session(session).lean();
        const busy = await substituteFree(to, d, s.slots, { config, batches, exceptions: existing }, s._id);
        if (busy) throw httpError(409, `${busy} — pick someone free`);
        Object.assign(doc, { fromTrainer: from, toTrainer: to });
      }
    }

    [created] = await Exception.create([doc], { session });
    await audit(req, { action: 'create', entity: 'exception', entityId: created._id, name: describe(created), changes: diff({}, plain(created)) }, session);
  });

  const notified = wantsNotify(req) ? await notifyFor(req, created, 'added', config) : null;
  res.status(201).json({ ...created.toObject(), notified });
}));

router.put('/:id', wrap(async (req, res) => {
  if (!validId(req.params.id)) return fail(res, 404, 'Exception not found');
  const ex = await Exception.findById(req.params.id);
  if (!ex) return fail(res, 404, 'Exception not found');
  const before = plain(ex);
  /* only the wording can change in place; anything else is a new exception */
  if (req.body?.label !== undefined) ex.label = text(req.body.label, 'label', 'reason');
  if (ex.type === 'holiday' && !ex.label) throw httpError(400, 'Name the holiday');
  await atomically(async session => {
    await ex.save({ session });
    const changes = diff(before, plain(ex));
    if (changes.length) await audit(req, { action: 'update', entity: 'exception', entityId: ex._id, name: describe(ex), changes }, session);
  });
  res.json(ex);
}));

router.delete('/:id', wrap(async (req, res) => {
  if (!validId(req.params.id)) return fail(res, 404, 'Exception not found');
  const ex = await Exception.findById(req.params.id);
  if (!ex) return fail(res, 404, 'Exception not found');
  await atomically(async session => {
    await ex.deleteOne({ session });
    await audit(req, { action: 'delete', entity: 'exception', entityId: ex._id, name: describe(ex), changes: diff(plain(ex), {}) }, session);
  });
  const config = await Config.findOne({ key: 'default' }).lean();
  const notified = wantsNotify(req) ? await notifyFor(req, plain(ex), 'removed', config) : null;
  res.json({ ok: true, notified });
}));

/* who an exception touches, and what to tell each of them */
async function notifyFor(req, e, verb, config) {
  const lines = new Map();
  const add = (n, l) => { if (!n) return; if (!lines.has(n)) lines.set(n, []); lines.get(n).push(l); };
  const when = s => `${config.slots[s.slots?.[0]]?.split(/[–-]/)[0] || ''} slot ${(s.slots || []).map(i => i + 1).join('–')}`;
  if (e.type === 'holiday') {
    const batches = await Batch.find().lean();
    const others = (await Exception.find({ type: { $ne: 'holiday' } }).lean());
    for (const d of datesBetween(e.date, e.endDate || e.date)) {
      const { classes } = classesOn(d, { config, batches, exceptions: verb === 'added' ? others : [...others] });
      for (const c of classes) {
        for (const n of [...c.main, ...c.support]) {
          add(n, verb === 'added'
            ? `No class on ${d} (${e.label}): ${c.batch} · ${c.subject}, ${when(c)}`
            : `Holiday on ${d} cancelled — ${c.batch} · ${c.subject} runs as usual, ${when(c)}`);
        }
      }
    }
  } else {
    const batch = await Batch.findById(e.batchId).lean();
    const s = batch?.sessions?.find(x => String(x._id) === String(e.sessionId));
    const people = s ? [...(s.mainTrainers || []), ...(s.supportTrainers || [])] : [];
    const what = `${e.batch} · ${e.subject} on ${e.date}, ${when(e)}`;
    if (e.type === 'cancel') {
      people.forEach(n => add(n, verb === 'added' ? `Cancelled: ${what}` : `Back on: ${what} (cancellation withdrawn)`));
    } else {
      add(e.fromTrainer, verb === 'added' ? `${e.toTrainer} covers your class: ${what}` : `You teach as usual: ${what} (substitution withdrawn)`);
      add(e.toTrainer, verb === 'added' ? `You are covering ${e.fromTrainer}'s class: ${what}` : `You are no longer covering: ${what}`);
    }
  }
  return notifyTrainers(req, lines, `${describe(e)} ${verb}`);
}

export default router;
