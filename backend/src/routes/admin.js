import { Router } from 'express';
import mongoose from 'mongoose';
import Config from '../models/Config.js';
import YearGroup from '../models/YearGroup.js';
import Trainer from '../models/Trainer.js';
import Venue from '../models/Venue.js';
import Batch from '../models/Batch.js';
import Activity from '../models/Activity.js';
import Exception from '../models/Exception.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { requireAuth } from '../middleware/auth.js';
import { wrap } from '../middleware/asyncRoute.js';
import { rangesOverlap, rangeStatus, sessionRange, today } from '../services/dates.js';
import { audit, diff, plain } from '../services/audit.js';
import { batchChanges, notifyTrainers } from '../services/notify.js';
import {
  str, fail, httpError, text, count, orderNum, date, dateRange, validId, EMAIL_RE, normTrack,
  atomically, ADMIN, COORD, wantsNotify, lockSchedule, CI,
} from './_shared.js';

const router = Router();
/* nothing below is public; each route then says which roles may use it */
router.use(requireAuth());

/* ───────────────────────── config: the period grid ───────────────────────── */

router.get('/config', wrap(async (_req, res) => {
  res.json(await Config.findOne({ key: 'default' }).lean());
}));

/*
 * Sessions and logged activities point at periods by index and at days by
 * name, so editing the grid has to carry them along. Each row may say where
 * it came from:
 *   slots: [{ label: '9:00–9:50', from: 0 }, { label: '…', from: null }, …]
 *   days:  [{ name: 'Mon', from: 'Monday' }, …]
 * `from` null (or absent on a new row) means "new". A plain string is read as
 * "unchanged at this position" for older clients. Removing a period or day a
 * class still uses is refused with the list of what is in the way; renames,
 * removals and reorders otherwise move every session and activity with them,
 * all in one transaction so the grid and the data can never disagree.
 */
router.put('/config', ADMIN, wrap(async (req, res) => {
  const old = await Config.findOne({ key: 'default' }).lean();
  if (!old) return fail(res, 503, 'Schedule is not initialised — run `npm run seed`');

  if (!Array.isArray(req.body?.slots) || !req.body.slots.length) return fail(res, 400, 'At least one time slot is required');
  if (!Array.isArray(req.body?.days) || !req.body.days.length) return fail(res, 400, 'At least one teaching day is required');
  if (req.body.slots.length > 24 || req.body.days.length > 7) return fail(res, 400, 'At most 24 periods and 7 days');

  const slotRows = req.body.slots.map((r, i) => (typeof r === 'string' || typeof r === 'number'
    ? { label: text(r, 'slot', `slot ${i + 1}`), from: i < old.slots.length ? i : null }
    : { label: text(r?.label, 'slot', `slot ${i + 1}`), from: r?.from ?? null }));
  const dayRows = req.body.days.map(r => (typeof r === 'string'
    ? { name: text(r, 'day'), from: old.days.includes(str(r)) ? str(r) : null }
    : { name: text(r?.name, 'day'), from: r?.from ?? null }));

  if (slotRows.some(r => !r.label)) return fail(res, 400, 'Every period needs a time — fill in or remove the blank row');
  if (dayRows.some(r => !r.name)) return fail(res, 400, 'Every day needs a name — fill in or remove the blank row');
  if (new Set(dayRows.map(r => r.name.toLowerCase())).size !== dayRows.length) return fail(res, 400, 'Each day can only appear once');

  /* old index → new index, old day → new day; a source may be claimed once */
  const slotMap = new Map();
  slotRows.forEach((r, i) => {
    if (r.from === null) return;
    if (!Number.isInteger(r.from) || r.from < 0 || r.from >= old.slots.length || slotMap.has(r.from)) {
      throw httpError(400, 'The period list is out of date — reload the page and try again');
    }
    slotMap.set(r.from, i);
  });
  const dayMap = new Map();
  for (const r of dayRows) {
    if (r.from === null) continue;
    if (!old.days.includes(r.from) || dayMap.has(r.from)) throw httpError(400, 'The day list is out of date — reload the page and try again');
    dayMap.set(r.from, r.name);
  }

  const slots = slotRows.map(r => r.label);
  const days = dayRows.map(r => r.name);
  const lunchIndex = Number(req.body?.lunchIndex);
  if (!Number.isInteger(lunchIndex) || lunchIndex < 0 || lunchIndex >= slots.length) {
    return fail(res, 400, 'Lunch slot must be one of the time slots');
  }

  /* read everything under the schedule lock, so an edit saved meanwhile is
     neither overwritten nor brought back by this remap */
  let dropped = [], moved = [];
  await atomically(async session => {
    await lockSchedule(session);
    /* the rows say where they came from in the grid as it was loaded; if
       someone changed the grid since, those positions no longer hold */
    const now = await Config.findOne({ key: 'default' }).session(session).lean();
    if (JSON.stringify([now.slots, now.days]) !== JSON.stringify([old.slots, old.days])) {
      throw httpError(409, 'Someone else changed the time slots meanwhile — reload the page and make your change again');
    }
    const [batches, activities, exceptions] = await Promise.all([
      Batch.find().session(session).lean(), Activity.find().session(session).lean(),
      Exception.find({ sessionId: { $ne: null } }).session(session).lean(),
    ]);
    /* a class on a removed period or day blocks the change */
    const orphans = [];
    for (const b of batches) {
      for (const s of b.sessions || []) {
        const lost = s.slots.filter(i => !slotMap.has(i)).map(i => `slot ${i + 1}`);
        if (!dayMap.has(s.day)) orphans.push(`${b.name} — ${s.subject} on ${s.day} (day removed)`);
        else if (lost.length) orphans.push(`${b.name} — ${s.subject} on ${s.day} (${lost.join(', ')} removed)`);
      }
    }
    if (orphans.length) {
      throw httpError(409, `Move or delete these sessions first — they use a period or day being removed: ${[...new Set(orphans)].join('; ')}`);
    }

    /* work notes on a removed period/day go with it; the rest move along */
    moved = []; dropped = [];
    for (const a of activities) {
      const day = dayMap.get(a.day), slot = slotMap.get(a.slot);
      if (day === undefined || slot === undefined) dropped.push(a._id);
      else if (day !== a.day || slot !== a.slot) moved.push({ ...a, day, slot });
    }

    await Config.updateOne({ key: 'default' }, { slots, days, lunchIndex }, { session });

    const batchOps = [];
    for (const b of batches) {
      let changed = false;
      const sessions = (b.sessions || []).map(s => {
        const day = dayMap.get(s.day);
        const ns = [...new Set(s.slots.map(i => slotMap.get(i)))].sort((x, y) => x - y);
        if (day !== s.day || ns.join() !== s.slots.join()) changed = true;
        return { ...s, day, slots: ns };
      });
      if (changed) batchOps.push({ updateOne: { filter: { _id: b._id }, update: { $set: { sessions } } } });
    }
    if (batchOps.length) await Batch.bulkWrite(batchOps, { session });

    /* delete-then-insert, so a shift can never trip the unique trainer/day/slot index mid-way */
    const gone = [...dropped, ...moved.map(a => a._id)];
    if (gone.length) await Activity.deleteMany({ _id: { $in: gone } }, { session });
    if (moved.length) await Activity.insertMany(moved, { session });

    /* class exceptions keep a snapshot of the class's day and periods for display */
    const exOps = exceptions.filter(e => dayMap.has(e.day)).map(e => ({ updateOne: {
      filter: { _id: e._id },
      update: { $set: { day: dayMap.get(e.day), slots: [...new Set(e.slots.map(i => slotMap.get(i)).filter(i => i !== undefined))].sort((x, y) => x - y) } },
    } }));
    if (exOps.length) await Exception.bulkWrite(exOps, { session });

    await audit(req, {
      action: 'update', entity: 'config', name: 'Time slots & days',
      summary: `${slots.length} periods × ${days.length} days, lunch at ${slots[lunchIndex]}${dropped.length ? ` · ${dropped.length} logged activities cleared` : ''}`,
      changes: diff({ slots: old.slots, days: old.days, lunchIndex: old.lunchIndex }, { slots, days, lunchIndex }),
    }, session);
  });

  const config = await Config.findOne({ key: 'default' }).lean();
  res.json({ ...config, activitiesCleared: dropped.length });
}));

/* ───────────────────────── year groups ───────────────────────── */

router.get('/groups', COORD, wrap(async (_req, res) => {
  res.json(await YearGroup.find().sort({ order: 1 }).lean());
}));

router.post('/groups', ADMIN, wrap(async (req, res) => {
  const name = text(req.body?.name, 'name', 'year group name');
  if (!name) return fail(res, 400, 'Year group name is required');
  if (await YearGroup.findOne({ name }).collation(CI)) return fail(res, 409, `"${name}" already exists`);

  const last = await YearGroup.findOne().sort({ order: -1 }).lean();
  let created;
  await atomically(async session => {
    [created] = await YearGroup.create([{
      name,
      order: req.body?.order !== undefined ? orderNum(req.body.order) : ((last?.order ?? -1) + 1),
      pending: !!req.body?.pending,
      note: text(req.body?.note, 'note'),
    }], { session });
    await audit(req, { action: 'create', entity: 'group', entityId: created._id, name, changes: diff({}, plain(created)) }, session);
  });
  res.status(201).json(created);
}));

router.put('/groups/:id', ADMIN, wrap(async (req, res) => {
  if (!validId(req.params.id)) return fail(res, 404, 'Year group not found');
  const group = await YearGroup.findById(req.params.id);
  if (!group) return fail(res, 404, 'Year group not found');
  const before = plain(group);

  const name = text(req.body?.name, 'name', 'year group name') || group.name;
  if (name !== group.name && await YearGroup.findOne({ name, _id: { $ne: group._id } }).collation(CI)) return fail(res, 409, `"${name}" already exists`);
  const oldName = group.name;

  group.name = name;
  if (req.body?.order !== undefined) group.order = orderNum(req.body.order);
  if (req.body?.pending !== undefined) group.pending = !!req.body.pending;
  if (req.body?.note !== undefined) group.note = text(req.body.note, 'note');

  /* batches reference the group by name, so a rename carries them along —
     both writes land together or neither does */
  await atomically(async session => {
    if (name !== oldName) await Batch.updateMany({ group: oldName }, { group: name }, { session });
    await group.save({ session });
    const changes = diff(before, plain(group));
    if (changes.length) await audit(req, { action: 'update', entity: 'group', entityId: group._id, name, changes }, session);
  });
  res.json(group);
}));

router.delete('/groups/:id', ADMIN, wrap(async (req, res) => {
  if (!validId(req.params.id)) return fail(res, 404, 'Year group not found');
  const group = await YearGroup.findById(req.params.id);
  if (!group) return fail(res, 404, 'Year group not found');

  const used = await Batch.countDocuments({ group: group.name });
  if (used) return fail(res, 409, `${group.name} still has ${used} batch(es) — move or delete those first`);

  await atomically(async session => {
    await group.deleteOne({ session });
    await audit(req, { action: 'delete', entity: 'group', entityId: group._id, name: group.name, changes: diff(plain(group), {}) }, session);
  });
  res.json({ ok: true });
}));

/* ───────────────────────── trainers ───────────────────────── */

const contact = body => {
  const email = text(body?.email, 'email');
  const phone = text(body?.phone, 'phone');
  if (email && !EMAIL_RE.test(email)) throw httpError(400, 'That email address does not look right');
  if (phone && !/^[+\d][\d\s()-]{5,}$/.test(phone)) throw httpError(400, 'That phone number does not look right');
  return { email, phone };
};

router.get('/trainers', COORD, wrap(async (_req, res) => {
  res.json(await Trainer.find().sort({ name: 1 }).lean());
}));

router.post('/trainers', ADMIN, wrap(async (req, res) => {
  const name = text(req.body?.name, 'name', 'trainer name');
  if (!name) return fail(res, 400, 'Trainer name is required');
  if (await Trainer.findOne({ name }).collation(CI)) return fail(res, 409, `${name} is already on the list`);

  let created;
  await atomically(async session => {
    [created] = await Trainer.create([{
      name, ...contact(req.body),
      track: normTrack(req.body?.track),
      active: req.body?.active !== false,
    }], { session });
    await audit(req, { action: 'create', entity: 'trainer', entityId: created._id, name, changes: diff({}, plain(created)) }, session);
  });
  res.status(201).json(created);
}));

router.put('/trainers/:id', ADMIN, wrap(async (req, res) => {
  if (!validId(req.params.id)) return fail(res, 404, 'Trainer not found');
  const trainer = await Trainer.findById(req.params.id);
  if (!trainer) return fail(res, 404, 'Trainer not found');
  const before = plain(trainer);

  const name = text(req.body?.name, 'name', 'trainer name') || trainer.name;
  if (name !== trainer.name && await Trainer.findOne({ name, _id: { $ne: trainer._id } }).collation(CI)) return fail(res, 409, `${name} is already on the list`);
  const oldName = trainer.name;

  trainer.name = name;
  if (req.body?.email !== undefined || req.body?.phone !== undefined) {
    const c = contact({ email: req.body?.email ?? trainer.email, phone: req.body?.phone ?? trainer.phone });
    trainer.email = c.email; trainer.phone = c.phone;
  }
  if (req.body?.track !== undefined) trainer.track = normTrack(req.body.track);
  if (req.body?.active !== undefined) trainer.active = !!req.body.active;

  /* sessions, logged activities and exceptions all hold trainer names, so a
     rename reaches into every one — in one transaction, nothing half-renamed */
  await atomically(async session => {
    if (name !== oldName) {
      await Batch.updateMany({ 'sessions.mainTrainers': oldName },
        { $set: { 'sessions.$[s].mainTrainers.$[t]': name } },
        { arrayFilters: [{ 's.mainTrainers': oldName }, { t: oldName }], session });
      await Batch.updateMany({ 'sessions.supportTrainers': oldName },
        { $set: { 'sessions.$[s].supportTrainers.$[t]': name } },
        { arrayFilters: [{ 's.supportTrainers': oldName }, { t: oldName }], session });
      await Activity.updateMany({ trainer: oldName }, { trainer: name }, { session });
      await Exception.updateMany({ fromTrainer: oldName }, { fromTrainer: name }, { session });
      await Exception.updateMany({ toTrainer: oldName }, { toTrainer: name }, { session });
      await Notification.updateMany({ trainer: oldName }, { trainer: name }, { session });
    }
    await trainer.save({ session });
    const changes = diff(before, plain(trainer));
    if (changes.length) await audit(req, { action: 'update', entity: 'trainer', entityId: trainer._id, name, changes }, session);
  });
  res.json(trainer);
}));

router.delete('/trainers/:id', ADMIN, wrap(async (req, res) => {
  if (!validId(req.params.id)) return fail(res, 404, 'Trainer not found');
  const trainer = await Trainer.findById(req.params.id);
  if (!trainer) return fail(res, 404, 'Trainer not found');

  /* Pull them out of every session too, otherwise the derived grids would
     still show a trainer who no longer exists. A linked sign-in account is
     switched off rather than left pointing at nobody. */
  let sessionsTouched = 0;
  await atomically(async session => {
    const pulled = await Batch.updateMany({}, {
      $pull: { 'sessions.$[].mainTrainers': trainer.name, 'sessions.$[].supportTrainers': trainer.name },
    }, { session });
    sessionsTouched = pulled.modifiedCount;
    await Activity.deleteMany({ trainer: trainer.name }, { session });
    await Exception.deleteMany({ $or: [{ fromTrainer: trainer.name }, { toTrainer: trainer.name }] }, { session });
    await User.updateMany({ trainer: trainer._id }, { $set: { trainer: null, active: false }, $inc: { tokenVersion: 1 } }, { session });
    /* keep the email history, but never show it to a future trainer of the same name */
    await Notification.updateMany({ trainer: trainer.name }, { trainer: `${trainer.name} (deleted)` }, { session });
    await trainer.deleteOne({ session });
    await audit(req, {
      action: 'delete', entity: 'trainer', entityId: trainer._id, name: trainer.name,
      summary: `Removed from ${sessionsTouched} batch(es)`, changes: diff(plain(trainer), {}),
    }, session);
  });
  res.json({ ok: true, sessionsTouched });
}));

/* ───────────────────────── venues ───────────────────────── */

router.get('/venues', COORD, wrap(async (_req, res) => {
  res.json(await Venue.find().sort({ name: 1 }).lean());
}));

router.post('/venues', ADMIN, wrap(async (req, res) => {
  const name = text(req.body?.name, 'name', 'hall name');
  if (!name) return fail(res, 400, 'Hall name is required');
  if (await Venue.findOne({ name }).collation(CI)) return fail(res, 409, `"${name}" already exists`);

  let created;
  await atomically(async session => {
    [created] = await Venue.create([{
      name, capacity: count(req.body?.capacity, 'Capacity'), active: req.body?.active !== false,
    }], { session });
    await audit(req, { action: 'create', entity: 'venue', entityId: created._id, name, changes: diff({}, plain(created)) }, session);
  });
  res.status(201).json(created);
}));

router.put('/venues/:id', ADMIN, wrap(async (req, res) => {
  if (!validId(req.params.id)) return fail(res, 404, 'Hall not found');
  const venue = await Venue.findById(req.params.id);
  if (!venue) return fail(res, 404, 'Hall not found');
  const before = plain(venue);

  const name = text(req.body?.name, 'name', 'hall name') || venue.name;
  if (name !== venue.name && await Venue.findOne({ name, _id: { $ne: venue._id } }).collation(CI)) return fail(res, 409, `"${name}" already exists`);
  const oldName = venue.name;

  venue.name = name;
  if (req.body?.capacity !== undefined) venue.capacity = count(req.body.capacity, 'Capacity');
  if (req.body?.active !== undefined) venue.active = !!req.body.active;

  /* venue lives on each session, so the rename reaches inside the sessions array */
  await atomically(async session => {
    if (name !== oldName) {
      await Batch.updateMany(
        { 'sessions.venue': oldName },
        { $set: { 'sessions.$[s].venue': name } },
        { arrayFilters: [{ 's.venue': oldName }], session },
      );
    }
    await venue.save({ session });
    const changes = diff(before, plain(venue));
    if (changes.length) await audit(req, { action: 'update', entity: 'venue', entityId: venue._id, name, changes }, session);
  });
  res.json(venue);
}));

router.delete('/venues/:id', ADMIN, wrap(async (req, res) => {
  if (!validId(req.params.id)) return fail(res, 404, 'Hall not found');
  const venue = await Venue.findById(req.params.id);
  if (!venue) return fail(res, 404, 'Hall not found');

  let sessionsUnassigned = 0;
  await atomically(async session => {
    const freed = await Batch.updateMany(
      { 'sessions.venue': venue.name },
      { $set: { 'sessions.$[s].venue': '' } },
      { arrayFilters: [{ 's.venue': venue.name }], session },
    );
    sessionsUnassigned = freed.modifiedCount;
    await venue.deleteOne({ session });
    await audit(req, {
      action: 'delete', entity: 'venue', entityId: venue._id, name: venue.name,
      summary: `${sessionsUnassigned} batch(es) left without this hall`, changes: diff(plain(venue), {}),
    }, session);
  });
  res.json({ ok: true, sessionsUnassigned });
}));

/* ───────────────────────── batches + their sessions ───────────────────────── */

/*
 * Cleans and checks a batch's sessions. Throws a 400/409 the caller sees as-is.
 * `batch` is { id, startDate, endDate, existingIds } of the batch being saved —
 * the dates a session without its own inherits, the id so the batch never
 * clashes with its own stored copy, and the ids of its current sessions so an
 * edited session keeps its identity (exceptions and change notices hang off it).
 * `others`, when given, replaces the database read of every other batch — the
 * importer uses it to check a whole file of batches against each other.
 *
 * Double-booking is refused here rather than discovered later on the
 * dashboard: a trainer or a hall cannot be in two classes on the same day and
 * period while those classes' date ranges overlap. Back-to-back batches
 * (one ending in September, the next starting in October) are fine.
 */
export async function validateSessions(raw, batch, { others: givenOthers, config: givenConfig, venuesByName: givenVenues, trainersByName: givenTrainers, session = null } = {}) {
  if (!Array.isArray(raw)) throw httpError(400, 'Sessions must be a list');
  if (raw.length > 60) throw httpError(400, 'A batch can have at most 60 sessions');

  const [config, venueDocs, trainerDocs] = await Promise.all([
    givenConfig || Config.findOne({ key: 'default' }).session(session).lean(),
    givenVenues ? null : Venue.find({}, { name: 1, active: 1 }).session(session).lean(),
    givenTrainers ? null : Trainer.find({}, { name: 1, active: 1 }).session(session).lean(),
  ]);
  if (!config) throw httpError(503, 'Schedule is not initialised — run `npm run seed`');
  const venuesByName = givenVenues || new Map(venueDocs.map(v => [v.name, v]));
  const trainersByName = givenTrainers || new Map(trainerDocs.map(t => [t.name, t]));

  const sessions = [];
  for (const [n, s] of raw.entries()) {
    const where = `Session ${n + 1}`;
    const day = str(s?.day);
    if (!config.days.includes(day)) throw httpError(400, `${where}: "${day || '(blank)'}" is not a teaching day`);

    const picked = Array.isArray(s?.slots) ? s.slots.map(Number) : [];
    if (picked.some(i => !Number.isInteger(i) || i < 0 || i >= config.slots.length)) {
      throw httpError(400, `${where}: one of the periods is not in the grid`);
    }
    const slots = [...new Set(picked)].sort((a, b) => a - b);
    if (!slots.length) throw httpError(400, `${where} (${day}): pick at least one period`);

    const subject = text(s?.subject, 'subject', `${where} subject`);
    if (!subject) throw httpError(400, `${where} (${day}): needs a subject`);

    const venue = text(s?.venue, 'name', `${where} hall`);
    if (venue) {
      const v = venuesByName.get(venue);
      if (!v) throw httpError(400, `${where}: "${venue}" is not a known hall`);
      /* an inactive hall may stay where it already is, but cannot be newly picked */
      if (v.active === false && !batch.existingVenues?.has(venue)) throw httpError(400, `${where}: "${venue}" is marked inactive — reactivate it or pick another hall`);
    }

    const clean = list => [...new Set((Array.isArray(list) ? list : []).map(x => text(x, 'name', 'trainer name')).filter(Boolean))];
    const mainTrainers = clean(s?.mainTrainers);
    const supportTrainers = clean(s?.supportTrainers).filter(t => !mainTrainers.includes(t));
    for (const t of [...mainTrainers, ...supportTrainers]) {
      const doc = trainersByName.get(t);
      if (!doc) throw httpError(400, `${where}: "${t}" is not on the trainer list`);
      if (doc.active === false && !batch.existingPeople?.has(t)) throw httpError(400, `${where}: ${t} is marked inactive — reactivate them or pick someone else`);
    }

    const startDate = date(s?.startDate, `${where} start date`);
    const endDate = date(s?.endDate, `${where} end date`);
    dateRange(startDate, endDate, where);

    /* keep the session's identity across edits; a stranger's id is ignored */
    const sid = String(s?._id || '');
    const keep = validId(sid) && batch.existingIds?.has(sid) && !sessions.some(x => String(x._id) === sid);
    sessions.push({ ...(keep ? { _id: new mongoose.Types.ObjectId(sid) } : {}), day, slots, subject, venue, mainTrainers, supportTrainers, startDate, endDate });
  }

  /* ── double-booking ── */
  const others = givenOthers || await Batch.find(batch.id ? { _id: { $ne: batch.id } } : {}, { name: 1, startDate: 1, endDate: 1, sessions: 1 }).session(session).lean();
  const existing = others.flatMap(b => (b.sessions || []).map(s => ({ s, owner: b.name, ...sessionRange(s, b) })));

  const clashes = [];
  const say = (what, s, slot, other) => `${what} on ${s.day} ${config.slots[slot]} (slot ${slot + 1}) — already in ${other}`;
  sessions.forEach((s, i) => {
    const mine = sessionRange(s, batch);
    const people = [...s.mainTrainers, ...s.supportTrainers];
    const against = [
      ...existing,
      /* the batch's own earlier sessions, so it cannot double-book itself either */
      ...sessions.slice(0, i).map((o, j) => ({ s: o, owner: `session ${j + 1} of this batch`, own: true, ...sessionRange(o, batch) })),
    ];
    for (const o of against) {
      if (o.s.day !== s.day || !rangesOverlap(mine.start, mine.end, o.start, o.end)) continue;
      const shared = s.slots.filter(x => (o.s.slots || []).includes(x));
      if (!shared.length) continue;
      if (o.own) {
        clashes.push(`Session ${i + 1} overlaps ${o.owner} on ${s.day} ${config.slots[shared[0]]} — a batch can only be in one class at a time`);
        continue;
      }
      const oPeople = [...(o.s.mainTrainers || []), ...(o.s.supportTrainers || [])];
      for (const t of people.filter(p => oPeople.includes(p))) clashes.push(say(t, s, shared[0], o.owner));
      if (s.venue && s.venue === o.s.venue) clashes.push(say(s.venue, s, shared[0], o.owner));
    }
  });
  /* a trainer covering someone else's class on a date is booked then too */
  const allPeople = [...new Set(sessions.flatMap(s => [...s.mainTrainers, ...s.supportTrainers]))];
  if (allPeople.length) {
    const covers = await Exception.find({ type: 'substitute', toTrainer: { $in: allPeople }, date: { $gte: today() } }).session(session).lean();
    for (const s of sessions) {
      const mine = sessionRange(s, batch);
      for (const e of covers) {
        if (e.day !== s.day || String(e.sessionId) === String(s._id || '')) continue;
        if (![...s.mainTrainers, ...s.supportTrainers].includes(e.toTrainer)) continue;
        if (!e.slots.some(x => s.slots.includes(x))) continue;
        if (!rangesOverlap(mine.start, mine.end, e.date, e.date)) continue;
        clashes.push(`${e.toTrainer} on ${e.day} ${config.slots[e.slots[0]]} — covering ${e.batch} on ${e.date}`);
      }
    }
  }
  if (clashes.length) {
    const list = [...new Set(clashes)];
    throw httpError(409, `Double-booking — not saved: ${list.slice(0, 8).join('; ')}${list.length > 8 ? `; and ${list.length - 8} more` : ''}`);
  }

  return sessions;
}

/* Reads a batch's own fields from a request body; `current` fills gaps on update. */
export function batchFields(body, current = {}) {
  const pick = (k, fn) => (body?.[k] !== undefined ? fn(body[k]) : current[k]);
  const out = {
    name: pick('name', v => text(v, 'name', 'batch name')) || current.name || '',
    group: pick('group', v => text(v, 'name', 'year group')) ?? '',
    dept: pick('dept', v => text(v, 'dept', 'department')) ?? '',
    count: pick('count', v => count(v, 'Student count')) ?? 0,
    startDate: pick('startDate', v => date(v, 'Start date')) ?? '',
    endDate: pick('endDate', v => date(v, 'End date')) ?? '',
  };
  dateRange(out.startDate, out.endDate, 'Batch');
  return out;
}

/*
 * Exceptions hang off a batch's sessions. After the batch changes: those on a
 * session that no longer exists, or that moved to another weekday, or whose
 * substituted trainer left the class, can no longer apply and are removed;
 * the rest get the new name and class snapshot. Returns how many went.
 */
export async function reconcileExceptions(batchDoc, session) {
  const list = await Exception.find({ batchId: batchDoc._id }, null, { session }).lean();
  if (!list.length) return 0;
  const byId = new Map((batchDoc.sessions || []).map(s => [String(s._id), s]));
  const gone = [], ops = [];
  for (const e of list) {
    const s = byId.get(String(e.sessionId));
    const people = s ? [...(s.mainTrainers || []), ...(s.supportTrainers || [])] : [];
    if (!s || s.day !== e.day || (e.type === 'substitute' && (!people.includes(e.fromTrainer) || people.includes(e.toTrainer)))) {
      gone.push(e._id);
    } else {
      ops.push({ updateOne: { filter: { _id: e._id }, update: { $set: { batch: batchDoc.name, slots: s.slots, subject: s.subject } } } });
    }
  }
  if (gone.length) await Exception.deleteMany({ _id: { $in: gone } }, { session });
  if (ops.length) await Exception.bulkWrite(ops, { session });
  return gone.length;
}

router.get('/batches', COORD, wrap(async (_req, res) => {
  res.json(await Batch.find().sort({ order: 1, name: 1 }).lean());
}));

router.get('/batches/:id', COORD, wrap(async (req, res) => {
  if (!validId(req.params.id)) return fail(res, 404, 'Batch not found');
  const batch = await Batch.findById(req.params.id).lean();
  if (!batch) return fail(res, 404, 'Batch not found');
  res.json(batch);
}));

router.post('/batches', COORD, wrap(async (req, res) => {
  const f = batchFields(req.body);
  if (!f.name) return fail(res, 400, 'Batch name is required');

  /* the checks and the write happen together, under the schedule lock, so a
     simultaneous save elsewhere cannot slip a clash between them */
  let created, activitiesReplaced = 0;
  await atomically(async session => {
    await lockSchedule(session);
    if (await Batch.findOne({ name: f.name }).collation(CI).session(session)) throw httpError(409, `"${f.name}" already exists`);
    if (!await YearGroup.findOne({ name: f.group }).session(session)) throw httpError(400, 'Pick an existing year group');
    const sessions = await validateSessions(req.body?.sessions ?? [], { startDate: f.startDate, endDate: f.endDate }, { session });
    const last = await Batch.findOne().sort({ order: -1 }).session(session).lean();
    [created] = await Batch.create([{
      ...f,
      order: req.body?.order !== undefined ? orderNum(req.body.order) : ((last?.order ?? -1) + 1),
      sessions,
    }], { session });
    activitiesReplaced = await clearActivitiesUnder(sessions, session, f);
    await audit(req, {
      action: 'create', entity: 'batch', entityId: created._id, name: f.name,
      summary: `${sessions.length} session(s)`, changes: diff({}, plain(created)),
    }, session);
  });

  const config = await Config.findOne({ key: 'default' }).lean();
  const notified = wantsNotify(req)
    ? await notifyTrainers(req, batchChanges(null, plain(created), config.slots), `${f.name} created`)
    : null;
  res.status(201).json({ ...created.toObject(), activitiesReplaced, notified });
}));

/* ids arrive from the client; only real ObjectId strings ever reach a filter */
const idList = (list, what) => {
  if (!Array.isArray(list) || !list.length || list.length > 500) throw httpError(400, `${what} must be a non-empty list`);
  if (!list.every(validId)) throw httpError(400, `${what} contains an invalid id`);
  return list;
};

router.put('/batches/reorder', COORD, wrap(async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const ids = idList(items.map(item => item?.id || item?._id), 'items');
  await Batch.bulkWrite(items.map((item, i) => ({
    updateOne: { filter: { _id: ids[i] }, update: { $set: { order: orderNum(item.order) } } },
  })));
  await audit(req, { action: 'update', entity: 'batch', name: 'Board order', summary: `Reordered ${ids.length} batch(es)` });
  res.json({ ok: true });
}));

router.put('/batches/reorder-group', COORD, wrap(async (req, res) => {
  const ids = idList(req.body?.orderedIds, 'orderedIds');
  await Batch.bulkWrite(ids.map((id, index) => ({
    updateOne: { filter: { _id: id }, update: { $set: { order: index } } },
  })));
  await audit(req, { action: 'update', entity: 'batch', name: 'Board order', summary: `Reordered ${ids.length} batch(es)${req.body?.group ? ` in ${str(req.body.group).slice(0, 80)}` : ''}` });
  res.json({ ok: true });
}));

router.put('/batches/:id', COORD, wrap(async (req, res) => {
  if (!validId(req.params.id)) return fail(res, 404, 'Batch not found');

  /* read, check and write under the schedule lock in one transaction; if a
     simultaneous save forces a retry, everything is read afresh */
  let batch, before, activitiesReplaced = 0, exceptionsRemoved = 0;
  await atomically(async session => {
    await lockSchedule(session);
    batch = await Batch.findById(req.params.id).session(session);
    if (!batch) throw httpError(404, 'Batch not found');
    before = plain(batch);

    const f = batchFields(req.body, before);
    if (f.name !== batch.name && await Batch.findOne({ name: f.name, _id: { $ne: batch._id } }).collation(CI).session(session)) {
      throw httpError(409, `"${f.name}" already exists`);
    }
    if (f.group !== batch.group && !await YearGroup.findOne({ name: f.group }).session(session)) throw httpError(400, 'Pick an existing year group');

    /* new dates can create a clash even with the sessions untouched, so the
       sessions are re-checked whenever either changes */
    const datesChanged = f.startDate !== batch.startDate || f.endDate !== batch.endDate;
    const sessionsSent = req.body?.sessions !== undefined;
    const old = before.sessions || [];
    const sessions = sessionsSent || datesChanged
      ? await validateSessions(sessionsSent ? req.body.sessions : old, {
        id: batch._id, startDate: f.startDate, endDate: f.endDate,
        existingIds: new Set(old.map(s => String(s._id))),
        existingPeople: new Set(old.flatMap(s => [...(s.mainTrainers || []), ...(s.supportTrainers || [])])),
        existingVenues: new Set(old.map(s => s.venue).filter(Boolean)),
      }, { session })
      : null;

    Object.assign(batch, f);
    if (req.body?.order !== undefined) batch.order = orderNum(req.body.order);
    if (sessions) batch.sessions = sessions;

    await batch.save({ session });
    const after = plain(batch);
    if (sessions) activitiesReplaced = await clearActivitiesUnder(after.sessions, session, f);
    exceptionsRemoved = await reconcileExceptions(after, session);
    const changes = diff(before, after);
    if (changes.length) {
      await audit(req, {
        action: 'update', entity: 'batch', entityId: batch._id, name: batch.name,
        summary: exceptionsRemoved ? `${exceptionsRemoved} date exception(s) no longer applied and were removed` : '',
        changes,
      }, session);
    }
  });

  const config = await Config.findOne({ key: 'default' }).lean();
  const notified = wantsNotify(req)
    ? await notifyTrainers(req, batchChanges(before, plain(batch), config.slots), `${batch.name} updated`)
    : null;
  res.json({ ...batch.toObject(), activitiesReplaced, exceptionsRemoved, notified });
}));

router.delete('/batches/:id', COORD, wrap(async (req, res) => {
  if (!validId(req.params.id)) return fail(res, 404, 'Batch not found');
  const batch = await Batch.findById(req.params.id);
  if (!batch) return fail(res, 404, 'Batch not found');
  const before = plain(batch);

  await atomically(async session => {
    await batch.deleteOne({ session });
    await Exception.deleteMany({ batchId: batch._id }, { session });
    await audit(req, {
      action: 'delete', entity: 'batch', entityId: batch._id, name: batch.name,
      summary: `${(before.sessions || []).length} session(s) removed`, changes: diff(before, {}),
    }, session);
  });

  const config = await Config.findOne({ key: 'default' }).lean();
  const notified = wantsNotify(req)
    ? await notifyTrainers(req, batchChanges(before, { name: before.name, sessions: [] }, config.slots), `${before.name} removed`)
    : null;
  res.json({ ok: true, notified });
}));

/* ───────────────────────── availability lookup ─────────────────────────
   Answers "who and what is already taken at these times". One `when` per
   day+period set, e.g. ?when=Monday:0,1&when=Tuesday:2,3 — a single session
   sends one, the hall picker sends every session on the batch, because a hall
   has to be free at all of them to be worth assigning.

   `excludeBatch` leaves the batch being edited out, so its own sessions do
   not read as clashes with itself. */

router.get('/availability', COORD, wrap(async (req, res) => {
  const raw = req.query.when === undefined ? [] : [].concat(req.query.when);
  const when = [];

  if (raw.length > 40) return fail(res, 400, 'Too many when= entries');
  for (const entry of raw) {
    const [dayPart, slotPart = ''] = str(entry).slice(0, 200).split(':');
    const day = dayPart.trim();
    const slots = [...new Set(slotPart.split(',').map(Number).filter(Number.isInteger))];
    if (day && slots.length) when.push({ day, slots });
  }

  if (!when.length) return fail(res, 400, 'At least one when=Day:slot,slot is required');

  const exclude = str(req.query.excludeBatch);
  const filter = validId(exclude) ? { _id: { $ne: exclude } } : {};
  /* the dates of the class being planned: only sessions whose own dates
     overlap them can clash (blank = open-ended, as everywhere else) */
  const from = date(req.query.from, 'from'), to = date(req.query.to, 'to');
  const [batches, trainers, venues, config, activities] = await Promise.all([
    Batch.find(filter).lean(),
    Trainer.find({ active: true }).sort({ name: 1 }).lean(),
    Venue.find({ active: true }).sort({ name: 1 }).lean(),
    Config.findOne({ key: 'default' }).lean(),
    Activity.find({ $or: when.map(w => ({ day: w.day, slot: { $in: w.slots } })) }).lean(),
  ]);

  const slotName = i => config?.slots?.[i] || `slot ${i + 1}`;
  const trainerHits = new Map();      // name -> [{day, slot, batch}]
  const venueHits = new Map();
  const push = (map, key, hit) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(hit);
  };

  for (const b of batches) {
    for (const s of b.sessions || []) {
      const r = sessionRange(s, b);
      if (!rangesOverlap(from, to, r.start, r.end)) continue;
      for (const w of when) {
        if (s.day !== w.day) continue;
        const overlap = s.slots.filter(i => w.slots.includes(i));
        if (!overlap.length) continue;

        for (const i of overlap) {
          const hit = { day: s.day, slotIndex: i, slot: slotName(i), batch: b.name };
          for (const n of [...(s.mainTrainers || []), ...(s.supportTrainers || [])]) push(trainerHits, n, hit);
          const venueName = s.venue;
          if (venueName) push(venueHits, venueName, hit);
        }
      }
    }
  }

  /* Work logged from the board counts as busy too. It goes in after the
     classes so a real class clash is what `busyWith` names first; saving a
     class over it replaces the note (see clearActivitiesUnder). */
  for (const a of activities) {
    const label = a.kind === 'lunch' ? 'Lunch (logged)' : `${a.label || 'Assigned work'} (assigned work)`;
    push(trainerHits, a.trainer, { day: a.day, slotIndex: a.slot, slot: slotName(a.slot), batch: label, activity: true });
  }

  /* One line the UI can show as-is: "Mon 9:00–9:50 · AI Ready 2028 · Batch-1". */
  const summarise = hits => {
    const seen = new Set();
    return hits.filter(h => {
      const k = `${h.day}|${h.slotIndex}|${h.batch}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  const shape = (list, map) => list.map(x => {
    const conflicts = summarise(map.get(x.name) || []);
    return {
      name: x.name,
      track: (x.track === 'non-teaching' || x.track === 'non-technical') ? 'non-teaching' : 'teaching',
      free: conflicts.length === 0,
      busyWith: conflicts[0]?.batch || null,      // kept for the single-session picker
      conflicts,
    };
  });

  res.json({ when, trainers: shape(trainers, trainerHits), venues: shape(venues, venueHits) });
}));

/* ───────────────────────── trainer activities ─────────────────────────
   What a trainer is doing during a period that isn't a class — logged
   straight from the timetable cell rather than a separate form. A real
   batch session at that slot always wins when the board is built, so this
   can never mask one. */

/* Every period the trainer teaches (main or support) in a class that has not
   ended, keyed "Day|slot" → batch name. A finished class no longer holds the
   period; an upcoming one does, or the note would vanish the day it starts. */
async function classSlotsFor(trainer, session = null) {
  const batches = await Batch.find(
    { $or: [{ 'sessions.mainTrainers': trainer }, { 'sessions.supportTrainers': trainer }] },
    { name: 1, startDate: 1, endDate: 1, sessions: 1 },
  ).session(session).lean();
  const taught = new Map();
  for (const b of batches) {
    for (const s of b.sessions || []) {
      if (!(s.mainTrainers || []).includes(trainer) && !(s.supportTrainers || []).includes(trainer)) continue;
      const r = sessionRange(s, b);
      if (rangeStatus(r.start, r.end) === 'ended') continue;
      for (const slot of s.slots || []) taught.set(`${s.day}|${slot}`, b.name);
    }
  }
  return taught;
}

/* The other direction: a class saved over a period a trainer had logged
   work in takes that period, so the note under it is removed rather than
   left behind as a hidden record. Returns how many were removed. */
export async function clearActivitiesUnder(sessions, session, batch = {}) {
  const or = [];
  for (const s of sessions || []) {
    const r = sessionRange(s, batch);
    if (rangeStatus(r.start, r.end) === 'ended') continue;
    const trainers = [...new Set([...(s.mainTrainers || []), ...(s.supportTrainers || [])])];
    if (trainers.length && s.slots?.length) or.push({ trainer: { $in: trainers }, day: s.day, slot: { $in: s.slots } });
  }
  if (!or.length) return 0;
  const { deletedCount } = await Activity.deleteMany({ $or: or }, { session });
  return deletedCount;
}

router.put('/activities', COORD, wrap(async (req, res) => {
  const trainer = text(req.body?.trainer, 'name', 'trainer name');
  const rawDays = Array.isArray(req.body?.days)
    ? req.body.days
    : (req.body?.day !== undefined ? [req.body.day] : []);
  const days = [...new Set(rawDays.map(str).filter(Boolean))];

  const rawSlots = Array.isArray(req.body?.slots)
    ? req.body.slots
    : (req.body?.slot !== undefined ? [req.body.slot] : []);
  const slots = [...new Set(rawSlots.map(Number))].filter(Number.isInteger);

  const kind = str(req.body?.kind);
  const label = text(req.body?.label, 'label', 'work description');

  if (!trainer || !await Trainer.findOne({ name: trainer })) return fail(res, 400, 'Unknown trainer');

  const config = await Config.findOne({ key: 'default' }).lean();
  if (!config) return fail(res, 503, 'Schedule is not initialised — run `npm run seed`');
  if (!days.length || days.some(d => !config.days.includes(d))) {
    return fail(res, 400, 'Pick valid teaching day(s)');
  }
  if (!slots.length || slots.some(s => s < 0 || s >= config.slots.length)) {
    return fail(res, 400, 'Pick valid period(s)');
  }
  if (!['lunch', 'other'].includes(kind)) return fail(res, 400, 'Kind must be "lunch" or "other"');
  if (kind === 'other' && !label) return fail(res, 400, 'Say what they\'re doing');

  /* A class always wins on the board, so a note written under one would be
     stored but never shown — and would surface unannounced if the class were
     ever moved. Refuse it and say which class is in the way. */
  const value = { kind, label: kind === 'lunch' ? '' : label };
  const what = `${kind === 'lunch' ? 'Lunch' : value.label} on ${days.join(', ')}, slot ${slots.map(s => s + 1).join(',')}`;
  /* the clash check and the write happen together under the schedule lock */
  await atomically(async session => {
    await lockSchedule(session);
    const taught = await classSlotsFor(trainer, session);
    const clashes = [];
    for (const day of days) {
      for (const slot of slots) {
        const batch = taught.get(`${day}|${slot}`);
        if (batch) clashes.push(`${day} slot ${slot + 1} (${config.slots[slot]}) — ${batch}`);
      }
    }
    /* covering someone else's class on a coming date also holds that period */
    const covers = await Exception.find({ type: 'substitute', toTrainer: trainer, day: { $in: days }, slots: { $in: slots }, date: { $gte: today() } }).session(session).lean();
    for (const e of covers) clashes.push(`${e.date} slot ${e.slots.map(i => i + 1).join('–')} — covering ${e.batch}`);
    if (clashes.length) {
      throw httpError(409, `${trainer} has a class at ${clashes.length === 1 ? 'that period' : 'these periods'}: ${clashes.join('; ')}. Move the class in Batches & Sessions, or pick other periods.`);
    }
    await Activity.bulkWrite(days.flatMap(day => slots.map(slot => ({
      updateOne: { filter: { trainer, day, slot }, update: { $set: { trainer, day, slot, ...value } }, upsert: true },
    }))), { session });
    await audit(req, { action: 'update', entity: 'activity', name: trainer, summary: `Assigned: ${what}` }, session);
  });

  /* read back what is now stored, so the caller sees the database's answer */
  const docs = await Activity.find({ trainer, day: { $in: days }, slot: { $in: slots } }).sort({ day: 1, slot: 1 }).lean();
  const notified = wantsNotify(req)
    ? await notifyTrainers(req, new Map([[trainer, [`Assigned work: ${what}`]]]), `work assigned to ${trainer}`)
    : null;
  res.json({ ok: true, count: docs.length, docs, notified });
}));

router.delete('/activities', COORD, wrap(async (req, res) => {
  const trainer = text(req.query.trainer || req.body?.trainer, 'name', 'trainer name');
  if (!trainer) return fail(res, 400, 'Say whose activities to clear');
  const day = text(req.query.day || req.body?.day, 'day');

  let rawSlots = [];
  if (req.query.slots !== undefined) {
    rawSlots = String(req.query.slots).split(',').map(Number);
  } else if (req.query.slot !== undefined) {
    rawSlots = [Number(req.query.slot)];
  } else if (Array.isArray(req.body?.slots)) {
    rawSlots = req.body.slots.map(Number);
  } else if (req.body?.slot !== undefined) {
    rawSlots = [Number(req.body.slot)];
  }

  const slots = rawSlots.filter(Number.isInteger);

  const filter = { trainer };
  if (day) filter.day = day;
  if (slots.length) filter.slot = { $in: slots };

  let deletedCount = 0;
  const what = `${day || 'every day'}${slots.length ? `, slot ${slots.map(s => s + 1).join(',')}` : ''}`;
  await atomically(async session => {
    ({ deletedCount } = await Activity.deleteMany(filter, { session }));
    if (deletedCount) await audit(req, { action: 'delete', entity: 'activity', name: trainer, summary: `Cleared ${deletedCount} period(s): ${what}` }, session);
  });
  const notified = wantsNotify(req) && deletedCount
    ? await notifyTrainers(req, new Map([[trainer, [`Assigned work cleared: ${what}`]]]), `work cleared for ${trainer}`)
    : null;
  res.json({ ok: true, deletedCount, notified });
}));

export default router;
