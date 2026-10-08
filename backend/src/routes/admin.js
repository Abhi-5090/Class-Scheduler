import { Router } from 'express';
import mongoose from 'mongoose';
import Config from '../models/Config.js';
import YearGroup from '../models/YearGroup.js';
import Trainer from '../models/Trainer.js';
import Venue from '../models/Venue.js';
import Batch from '../models/Batch.js';
import Activity from '../models/Activity.js';
import { requireAdmin } from '../middleware/auth.js';
import { wrap } from '../middleware/asyncRoute.js';
import { isIsoDate, rangesOverlap, rangeStatus, sessionRange } from '../services/dates.js';

const router = Router();
router.use(requireAdmin);          // nothing below this line is public

const str = v => String(v ?? '').trim();
const fail = (res, status, error) => res.status(status).json({ error });

/* Thrown from deep inside validation; the error middleware turns `status`
   into the response, so a helper can refuse without threading `res` around. */
const httpError = (status, message) => Object.assign(new Error(message), { status });

/* Every free-text field has a ceiling, so nobody can park megabytes in a name. */
const LIMITS = { name: 120, subject: 120, note: 500, label: 200, email: 254, phone: 32, dept: 80, slot: 40, day: 20 };
const text = (v, kind, what = kind) => {
  const s = str(v);
  if (s.length > LIMITS[kind]) throw httpError(400, `${what[0].toUpperCase()}${what.slice(1)} is too long (max ${LIMITS[kind]} characters)`);
  return s;
};
const count = (v, what) => {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 100000) throw httpError(400, `${what} must be a whole number`);
  return n;
};
const orderNum = v => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw httpError(400, 'Order must be a number');
  return n;
};
const date = (v, what) => {
  const s = str(v);
  if (!isIsoDate(s)) throw httpError(400, `${what} must be a date (YYYY-MM-DD)`);
  return s;
};
const dateRange = (start, end, what) => {
  if (start && end && end < start) throw httpError(400, `${what}: the end date is before the start date`);
};
const validId = id => typeof id === 'string' && mongoose.isValidObjectId(id) && /^[a-f\d]{24}$/i.test(id);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normTrack = v => (['non-teaching', 'non-technical', 'non-tech'].includes(str(v).toLowerCase()) ? 'non-teaching' : 'teaching');

/* Runs `fn(session)` as one all-or-nothing transaction (Atlas replica set). */
const atomically = fn => mongoose.connection.transaction(fn);

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
router.put('/config', wrap(async (req, res) => {
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

  /* a class on a removed period or day blocks the change */
  const [batches, activities] = await Promise.all([Batch.find().lean(), Activity.find().lean()]);
  const orphans = [];
  for (const b of batches) {
    for (const s of b.sessions || []) {
      const lost = s.slots.filter(i => !slotMap.has(i)).map(i => `slot ${i + 1}`);
      if (!dayMap.has(s.day)) orphans.push(`${b.name} — ${s.subject} on ${s.day} (day removed)`);
      else if (lost.length) orphans.push(`${b.name} — ${s.subject} on ${s.day} (${lost.join(', ')} removed)`);
    }
  }
  if (orphans.length) {
    return fail(res, 409, `Move or delete these sessions first — they use a period or day being removed: ${[...new Set(orphans)].join('; ')}`);
  }

  /* work notes on a removed period/day go with it; the rest move along */
  const moved = [], dropped = [];
  for (const a of activities) {
    const day = dayMap.get(a.day), slot = slotMap.get(a.slot);
    if (day === undefined || slot === undefined) dropped.push(a._id);
    else if (day !== a.day || slot !== a.slot) moved.push({ ...a, day, slot });
  }

  await atomically(async session => {
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
  });

  const config = await Config.findOne({ key: 'default' }).lean();
  res.json({ ...config, activitiesCleared: dropped.length });
}));

/* ───────────────────────── year groups ───────────────────────── */

router.get('/groups', wrap(async (_req, res) => {
  res.json(await YearGroup.find().sort({ order: 1 }).lean());
}));

router.post('/groups', wrap(async (req, res) => {
  const name = text(req.body?.name, 'name', 'year group name');
  if (!name) return fail(res, 400, 'Year group name is required');
  if (await YearGroup.findOne({ name })) return fail(res, 409, `"${name}" already exists`);

  const last = await YearGroup.findOne().sort({ order: -1 }).lean();
  res.status(201).json(await YearGroup.create({
    name,
    order: req.body?.order !== undefined ? orderNum(req.body.order) : ((last?.order ?? -1) + 1),
    pending: !!req.body?.pending,
    note: text(req.body?.note, 'note'),
  }));
}));

router.put('/groups/:id', wrap(async (req, res) => {
  if (!validId(req.params.id)) return fail(res, 404, 'Year group not found');
  const group = await YearGroup.findById(req.params.id);
  if (!group) return fail(res, 404, 'Year group not found');

  const name = text(req.body?.name, 'name', 'year group name') || group.name;
  if (name !== group.name && await YearGroup.findOne({ name })) return fail(res, 409, `"${name}" already exists`);
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
  });
  res.json(group);
}));

router.delete('/groups/:id', wrap(async (req, res) => {
  if (!validId(req.params.id)) return fail(res, 404, 'Year group not found');
  const group = await YearGroup.findById(req.params.id);
  if (!group) return fail(res, 404, 'Year group not found');

  const used = await Batch.countDocuments({ group: group.name });
  if (used) return fail(res, 409, `${group.name} still has ${used} batch(es) — move or delete those first`);

  await group.deleteOne();
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

router.get('/trainers', wrap(async (_req, res) => {
  res.json(await Trainer.find().sort({ name: 1 }).lean());
}));

router.post('/trainers', wrap(async (req, res) => {
  const name = text(req.body?.name, 'name', 'trainer name');
  if (!name) return fail(res, 400, 'Trainer name is required');
  if (await Trainer.findOne({ name })) return fail(res, 409, `${name} is already on the list`);

  res.status(201).json(await Trainer.create({
    name, ...contact(req.body),
    track: normTrack(req.body?.track),
    active: req.body?.active !== false,
  }));
}));

router.put('/trainers/:id', wrap(async (req, res) => {
  if (!validId(req.params.id)) return fail(res, 404, 'Trainer not found');
  const trainer = await Trainer.findById(req.params.id);
  if (!trainer) return fail(res, 404, 'Trainer not found');

  const name = text(req.body?.name, 'name', 'trainer name') || trainer.name;
  if (name !== trainer.name && await Trainer.findOne({ name })) return fail(res, 409, `${name} is already on the list`);
  const oldName = trainer.name;

  trainer.name = name;
  if (req.body?.email !== undefined || req.body?.phone !== undefined) {
    const c = contact({ email: req.body?.email ?? trainer.email, phone: req.body?.phone ?? trainer.phone });
    trainer.email = c.email; trainer.phone = c.phone;
  }
  if (req.body?.track !== undefined) trainer.track = normTrack(req.body.track);
  if (req.body?.active !== undefined) trainer.active = !!req.body.active;

  /* sessions and logged activities both hold trainer names, so a rename has
     to reach into both — in one transaction, so nothing is left half-renamed */
  await atomically(async session => {
    if (name !== oldName) {
      await Batch.updateMany({ 'sessions.mainTrainers': oldName },
        { $set: { 'sessions.$[s].mainTrainers.$[t]': name } },
        { arrayFilters: [{ 's.mainTrainers': oldName }, { t: oldName }], session });
      await Batch.updateMany({ 'sessions.supportTrainers': oldName },
        { $set: { 'sessions.$[s].supportTrainers.$[t]': name } },
        { arrayFilters: [{ 's.supportTrainers': oldName }, { t: oldName }], session });
      await Activity.updateMany({ trainer: oldName }, { trainer: name }, { session });
    }
    await trainer.save({ session });
  });
  res.json(trainer);
}));

router.delete('/trainers/:id', wrap(async (req, res) => {
  if (!validId(req.params.id)) return fail(res, 404, 'Trainer not found');
  const trainer = await Trainer.findById(req.params.id);
  if (!trainer) return fail(res, 404, 'Trainer not found');

  /* Pull them out of every session too, otherwise the derived grids would
     still show a trainer who no longer exists. */
  let sessionsTouched = 0;
  await atomically(async session => {
    const pulled = await Batch.updateMany({}, {
      $pull: { 'sessions.$[].mainTrainers': trainer.name, 'sessions.$[].supportTrainers': trainer.name },
    }, { session });
    sessionsTouched = pulled.modifiedCount;
    await Activity.deleteMany({ trainer: trainer.name }, { session });
    await trainer.deleteOne({ session });
  });
  res.json({ ok: true, sessionsTouched });
}));

/* ───────────────────────── venues ───────────────────────── */

router.get('/venues', wrap(async (_req, res) => {
  res.json(await Venue.find().sort({ name: 1 }).lean());
}));

router.post('/venues', wrap(async (req, res) => {
  const name = text(req.body?.name, 'name', 'hall name');
  if (!name) return fail(res, 400, 'Hall name is required');
  if (await Venue.findOne({ name })) return fail(res, 409, `"${name}" already exists`);

  res.status(201).json(await Venue.create({
    name, capacity: count(req.body?.capacity, 'Capacity'), active: req.body?.active !== false,
  }));
}));

router.put('/venues/:id', wrap(async (req, res) => {
  if (!validId(req.params.id)) return fail(res, 404, 'Hall not found');
  const venue = await Venue.findById(req.params.id);
  if (!venue) return fail(res, 404, 'Hall not found');

  const name = text(req.body?.name, 'name', 'hall name') || venue.name;
  if (name !== venue.name && await Venue.findOne({ name })) return fail(res, 409, `"${name}" already exists`);
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
  });
  res.json(venue);
}));

router.delete('/venues/:id', wrap(async (req, res) => {
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
  });
  res.json({ ok: true, sessionsUnassigned });
}));

/* ───────────────────────── batches + their sessions ───────────────────────── */

/*
 * Cleans and checks a batch's sessions. Throws a 400/409 the caller sees as-is.
 * `batch` is { id, startDate, endDate } of the batch being saved — the dates a
 * session without its own inherits, and the id so the batch never clashes
 * with its own stored copy.
 *
 * Double-booking is refused here rather than discovered later on the
 * dashboard: a trainer or a hall cannot be in two classes on the same day and
 * period while those classes' date ranges overlap. Back-to-back batches
 * (one ending in September, the next starting in October) are fine.
 */
async function validateSessions(raw, batch) {
  if (!Array.isArray(raw)) throw httpError(400, 'Sessions must be a list');
  if (raw.length > 60) throw httpError(400, 'A batch can have at most 60 sessions');

  const [config, venueDocs, trainerDocs] = await Promise.all([
    Config.findOne({ key: 'default' }).lean(),
    Venue.find({}, { name: 1, active: 1 }).lean(),
    Trainer.find({}, { name: 1, active: 1 }).lean(),
  ]);
  if (!config) throw httpError(503, 'Schedule is not initialised — run `npm run seed`');
  const venuesByName = new Map(venueDocs.map(v => [v.name, v]));
  const trainersByName = new Map(trainerDocs.map(t => [t.name, t]));

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
      if (v.active === false) throw httpError(400, `${where}: "${venue}" is marked inactive — reactivate it or pick another hall`);
    }

    const clean = list => [...new Set((Array.isArray(list) ? list : []).map(x => text(x, 'name', 'trainer name')).filter(Boolean))];
    const mainTrainers = clean(s?.mainTrainers);
    const supportTrainers = clean(s?.supportTrainers).filter(t => !mainTrainers.includes(t));
    for (const t of [...mainTrainers, ...supportTrainers]) {
      const doc = trainersByName.get(t);
      if (!doc) throw httpError(400, `${where}: "${t}" is not on the trainer list`);
      if (doc.active === false) throw httpError(400, `${where}: ${t} is marked inactive — reactivate them or pick someone else`);
    }

    const startDate = date(s?.startDate, `${where} start date`);
    const endDate = date(s?.endDate, `${where} end date`);
    dateRange(startDate, endDate, where);

    sessions.push({ day, slots, subject, venue, mainTrainers, supportTrainers, startDate, endDate });
  }

  /* ── double-booking ── */
  const others = await Batch.find(batch.id ? { _id: { $ne: batch.id } } : {}, { name: 1, startDate: 1, endDate: 1, sessions: 1 }).lean();
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
  if (clashes.length) {
    const list = [...new Set(clashes)];
    throw httpError(409, `Double-booking — not saved: ${list.slice(0, 8).join('; ')}${list.length > 8 ? `; and ${list.length - 8} more` : ''}`);
  }

  return sessions;
}

/* Reads a batch's own fields from a request body; `current` fills gaps on update. */
function batchFields(body, current = {}) {
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

router.get('/batches', wrap(async (_req, res) => {
  res.json(await Batch.find().sort({ order: 1, name: 1 }).lean());
}));

router.get('/batches/:id', wrap(async (req, res) => {
  if (!validId(req.params.id)) return fail(res, 404, 'Batch not found');
  const batch = await Batch.findById(req.params.id).lean();
  if (!batch) return fail(res, 404, 'Batch not found');
  res.json(batch);
}));

router.post('/batches', wrap(async (req, res) => {
  const f = batchFields(req.body);
  if (!f.name) return fail(res, 400, 'Batch name is required');
  if (await Batch.findOne({ name: f.name })) return fail(res, 409, `"${f.name}" already exists`);
  if (!await YearGroup.findOne({ name: f.group })) return fail(res, 400, 'Pick an existing year group');

  const sessions = await validateSessions(req.body?.sessions ?? [], { startDate: f.startDate, endDate: f.endDate });
  const last = await Batch.findOne().sort({ order: -1 }).lean();

  let created, activitiesReplaced = 0;
  await atomically(async session => {
    [created] = await Batch.create([{
      ...f,
      order: req.body?.order !== undefined ? orderNum(req.body.order) : ((last?.order ?? -1) + 1),
      sessions,
    }], { session });
    activitiesReplaced = await clearActivitiesUnder(sessions, session, f);
  });
  res.status(201).json({ ...created.toObject(), activitiesReplaced });
}));

/* ids arrive from the client; only real ObjectId strings ever reach a filter */
const idList = (list, what) => {
  if (!Array.isArray(list) || !list.length || list.length > 500) throw httpError(400, `${what} must be a non-empty list`);
  if (!list.every(validId)) throw httpError(400, `${what} contains an invalid id`);
  return list;
};

router.put('/batches/reorder', wrap(async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const ids = idList(items.map(item => item?.id || item?._id), 'items');
  await Batch.bulkWrite(items.map((item, i) => ({
    updateOne: { filter: { _id: ids[i] }, update: { $set: { order: orderNum(item.order) } } },
  })));
  res.json({ ok: true });
}));

router.put('/batches/reorder-group', wrap(async (req, res) => {
  const ids = idList(req.body?.orderedIds, 'orderedIds');
  await Batch.bulkWrite(ids.map((id, index) => ({
    updateOne: { filter: { _id: id }, update: { $set: { order: index } } },
  })));
  res.json({ ok: true });
}));

router.put('/batches/:id', wrap(async (req, res) => {
  if (!validId(req.params.id)) return fail(res, 404, 'Batch not found');
  const batch = await Batch.findById(req.params.id);
  if (!batch) return fail(res, 404, 'Batch not found');

  const f = batchFields(req.body, batch.toObject());
  if (f.name !== batch.name && await Batch.findOne({ name: f.name })) return fail(res, 409, `"${f.name}" already exists`);
  if (f.group !== batch.group && !await YearGroup.findOne({ name: f.group })) return fail(res, 400, 'Pick an existing year group');

  /* new dates can create a clash even with the sessions untouched, so the
     sessions are re-checked whenever either changes */
  const datesChanged = f.startDate !== batch.startDate || f.endDate !== batch.endDate;
  const sessionsSent = req.body?.sessions !== undefined;
  const sessions = sessionsSent || datesChanged
    ? await validateSessions(sessionsSent ? req.body.sessions : batch.toObject().sessions,
      { id: batch._id, startDate: f.startDate, endDate: f.endDate })
    : null;

  Object.assign(batch, f);
  if (req.body?.order !== undefined) batch.order = orderNum(req.body.order);
  if (sessions) batch.sessions = sessions;

  let activitiesReplaced = 0;
  await atomically(async session => {
    await batch.save({ session });
    if (sessions) activitiesReplaced = await clearActivitiesUnder(batch.toObject().sessions, session, f);
  });
  res.json({ ...batch.toObject(), activitiesReplaced });
}));

router.delete('/batches/:id', wrap(async (req, res) => {
  if (!validId(req.params.id)) return fail(res, 404, 'Batch not found');
  const batch = await Batch.findByIdAndDelete(req.params.id);
  if (!batch) return fail(res, 404, 'Batch not found');
  res.json({ ok: true });
}));

/* ───────────────────────── availability lookup ─────────────────────────
   Answers "who and what is already taken at these times". One `when` per
   day+period set, e.g. ?when=Monday:0,1&when=Tuesday:2,3 — a single session
   sends one, the hall picker sends every session on the batch, because a hall
   has to be free at all of them to be worth assigning.

   `excludeBatch` leaves the batch being edited out, so its own sessions do
   not read as clashes with itself. */

router.get('/availability', wrap(async (req, res) => {
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
async function classSlotsFor(trainer) {
  const batches = await Batch.find(
    { $or: [{ 'sessions.mainTrainers': trainer }, { 'sessions.supportTrainers': trainer }] },
    { name: 1, startDate: 1, endDate: 1, sessions: 1 },
  ).lean();
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
async function clearActivitiesUnder(sessions, session, batch = {}) {
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

router.put('/activities', wrap(async (req, res) => {
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
  const taught = await classSlotsFor(trainer);
  const clashes = [];
  for (const day of days) {
    for (const slot of slots) {
      const batch = taught.get(`${day}|${slot}`);
      if (batch) clashes.push({ day, slot, batch });
    }
  }
  if (clashes.length) {
    const list = clashes.map(c => `${c.day} slot ${c.slot + 1} (${config.slots[c.slot]}) — ${c.batch}`).join('; ');
    return res.status(409).json({
      error: `${trainer} has a class at ${clashes.length === 1 ? 'that period' : 'these periods'}: ${list}. Move the class in Batches & Sessions, or pick other periods.`,
      clashes,
    });
  }

  const value = { kind, label: kind === 'lunch' ? '' : label };
  await Activity.bulkWrite(days.flatMap(day => slots.map(slot => ({
    updateOne: { filter: { trainer, day, slot }, update: { $set: { trainer, day, slot, ...value } }, upsert: true },
  }))));

  /* read back what is now stored, so the caller sees the database's answer */
  const docs = await Activity.find({ trainer, day: { $in: days }, slot: { $in: slots } }).sort({ day: 1, slot: 1 }).lean();
  res.json({ ok: true, count: docs.length, docs });
}));

router.delete('/activities', wrap(async (req, res) => {
  const trainer = text(req.query.trainer || req.body?.trainer, 'name', 'trainer name');
  if (!trainer) return fail(res, 400, 'Say whose activities to clear');
  const day = str(req.query.day || req.body?.day);

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

  const result = await Activity.deleteMany(filter);
  res.json({ ok: true, deletedCount: result.deletedCount });
}));

export default router;
