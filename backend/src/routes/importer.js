import { Router } from 'express';
import Trainer from '../models/Trainer.js';
import Venue from '../models/Venue.js';
import Batch from '../models/Batch.js';
import YearGroup from '../models/YearGroup.js';
import Config from '../models/Config.js';
import Exception from '../models/Exception.js';
import { requireAuth } from '../middleware/auth.js';
import { wrap } from '../middleware/asyncRoute.js';
import { audit } from '../services/audit.js';
import { validateSessions, batchFields, reconcileExceptions, clearActivitiesUnder } from './admin.js';
import { str, fail, text, count, EMAIL_RE, normTrack, atomically, COORD, lockSchedule } from './_shared.js';

/*
 * Bulk import from a spreadsheet. The browser reads the CSV / Excel file and
 * posts its rows as JSON; nothing here ever parses a file. Every import runs
 * twice: `dryRun: true` checks every row and reports what would happen
 * (create / update / error per row) without touching the database; the real
 * run repeats every check and applies all rows in one transaction, or none.
 *
 *   trainers  name, email, phone, track, active                    (admin)
 *   halls     name, capacity, active                               (admin)
 *   batches   one row per weekly session:                          (admin, coordinator)
 *             batch, year, department, students, start, end,
 *             day, periods, subject, hall, main, support, session start, session end
 *             A batch in the file replaces that batch's sessions.
 */
const router = Router();
router.use(requireAuth(), COORD);

const MAX_ROWS = 2000;
const yes = v => !['no', 'false', '0', 'inactive', 'hidden', 'n'].includes(str(v).toLowerCase());
const list = v => str(v).split(/[;,/|]/).map(x => x.trim()).filter(Boolean);
/* "1-2", "1,2", "3–4", "Slot 5" → [0,1] etc. (periods are numbered from 1) */
function periods(v, max) {
  const out = new Set();
  for (const part of str(v).replace(/slot/gi, '').split(/[,;\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    const [a, b] = m ? [Number(m[1]), Number(m[2])] : [Number(part), Number(part)];
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < a || b > max) throw new Error(`"${v}" is not a valid period list (use e.g. 1-2 or 3,4; there are ${max} periods)`);
    for (let i = a; i <= b; i++) out.add(i - 1);
  }
  if (!out.size) throw new Error('Periods are missing');
  return [...out].sort((x, y) => x - y);
}
const pick = (row, ...keys) => {
  for (const k of keys) {
    const hit = Object.keys(row).find(h => h.trim().toLowerCase() === k);
    if (hit !== undefined && row[hit] !== undefined && row[hit] !== null && String(row[hit]).trim() !== '') return row[hit];
  }
  return '';
};
const dateCell = (v, what) => {
  if (v === '' || v === null || v === undefined) return '';
  if (v instanceof Date || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v))) return new Date(v).toISOString().slice(0, 10);
  const s = str(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);      // DD/MM/YYYY, as written in India
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  throw new Error(`${what} "${s}" is not a date (use YYYY-MM-DD or DD/MM/YYYY)`);
};

router.post('/', wrap(async (req, res) => {
  const kind = str(req.body?.kind);
  const rows = req.body?.rows;
  const dryRun = req.body?.dryRun !== false;
  if (!['trainers', 'halls', 'batches'].includes(kind)) return fail(res, 400, 'Pick what to import: trainers, halls or batches');
  if ((kind === 'trainers' || kind === 'halls') && req.user.role !== 'admin') return fail(res, 403, 'Only an admin can import trainers or halls');
  if (!Array.isArray(rows) || !rows.length) return fail(res, 400, 'The file has no rows');
  if (rows.length > MAX_ROWS) return fail(res, 400, `At most ${MAX_ROWS} rows per import`);
  if (!rows.every(r => r && typeof r === 'object' && !Array.isArray(r) && Object.keys(r).length <= 40)) return fail(res, 400, 'Each row must be a set of named columns');

  const run = session => (kind === 'trainers' ? importTrainers(req, rows, dryRun, session)
    : kind === 'halls' ? importHalls(req, rows, dryRun, session)
    : importBatches(req, rows, dryRun, session));

  if (dryRun) return res.json(await run(null));

  /* the real run repeats every read and check inside the transaction, after
     taking the schedule lock, so nothing saved meanwhile is overwritten */
  let result;
  try {
    await atomically(async session => {
      await lockSchedule(session);
      result = await run(session);
      if (result.errors) throw Object.assign(new Error('import has errors'), { importResult: result });
    });
  } catch (e) {
    if (e.importResult) return res.status(400).json(e.importResult);
    throw e;
  }
  res.json(result);
}));

/* ── trainers ── */
async function importTrainers(req, rows, dryRun, session) {
  const existing = new Map((await Trainer.find().session(session).lean()).map(t => [t.name.toLowerCase(), t]));
  const seen = new Set();
  const report = rows.map((row, i) => {
    try {
      const name = text(pick(row, 'name', 'trainer', 'trainer name'), 'name', 'name');
      if (!name) throw new Error('Name is missing');
      if (seen.has(name.toLowerCase())) throw new Error(`"${name}" appears twice in the file`);
      seen.add(name.toLowerCase());
      const email = text(pick(row, 'email', 'e-mail'), 'email');
      if (email && !EMAIL_RE.test(email)) throw new Error(`Email "${email}" does not look right`);
      const phone = text(pick(row, 'phone', 'mobile'), 'phone');
      if (phone && !/^[+\d][\d\s()-]{5,}$/.test(phone)) throw new Error(`Phone "${phone}" does not look right`);
      const trackRaw = pick(row, 'track', 'category');
      const activeRaw = pick(row, 'active', 'status');
      const found = existing.get(name.toLowerCase());
      const data = {
        name: found?.name || name, email, phone,
        track: trackRaw === '' ? (found?.track || 'teaching') : normTrack(trackRaw),
        active: activeRaw === '' ? (found?.active ?? true) : yes(activeRaw),
      };
      return { row: i + 2, status: found ? 'update' : 'create', name: data.name, data, id: found?._id };
    } catch (e) { return { row: i + 2, status: 'error', error: e.message }; }
  });
  return apply(req, 'trainers', report, dryRun, session, async () => {
    for (const r of report) {
      if (r.status === 'create') await Trainer.create([r.data], { session });
      /* an update never renames — names are the key — and keeps blank cells as they were */
      else {
        const set = { track: r.data.track, active: r.data.active };
        if (r.data.email) set.email = r.data.email;
        if (r.data.phone) set.phone = r.data.phone;
        await Trainer.updateOne({ _id: r.id }, { $set: set }, { session });
      }
    }
  });
}

/* ── halls ── */
async function importHalls(req, rows, dryRun, session) {
  const existing = new Map((await Venue.find().session(session).lean()).map(v => [v.name.toLowerCase(), v]));
  const seen = new Set();
  const report = rows.map((row, i) => {
    try {
      const name = text(pick(row, 'name', 'hall', 'hall name', 'venue'), 'name', 'hall name');
      if (!name) throw new Error('Hall name is missing');
      if (seen.has(name.toLowerCase())) throw new Error(`"${name}" appears twice in the file`);
      seen.add(name.toLowerCase());
      const found = existing.get(name.toLowerCase());
      const capRaw = pick(row, 'capacity', 'seats');
      const activeRaw = pick(row, 'active', 'status');
      const data = {
        name: found?.name || name,
        capacity: capRaw === '' ? (found?.capacity || 0) : count(capRaw, 'Capacity'),
        active: activeRaw === '' ? (found?.active ?? true) : yes(activeRaw),
      };
      return { row: i + 2, status: found ? 'update' : 'create', name: data.name, data, id: found?._id };
    } catch (e) { return { row: i + 2, status: 'error', error: e.message }; }
  });
  return apply(req, 'halls', report, dryRun, session, async () => {
    for (const r of report) {
      if (r.status === 'create') await Venue.create([r.data], { session });
      else await Venue.updateOne({ _id: r.id }, { $set: { capacity: r.data.capacity, active: r.data.active } }, { session });
    }
  });
}

/* ── batches (one row per session) ── */
async function importBatches(req, rows, dryRun, session) {
  const [config, groups, trainers, venues, all, exceptions] = await Promise.all([
    Config.findOne({ key: 'default' }).session(session).lean(), YearGroup.find().session(session).lean(),
    Trainer.find({}, { name: 1, active: 1 }).session(session).lean(), Venue.find({}, { name: 1, active: 1 }).session(session).lean(),
    Batch.find().session(session).lean(), Exception.find({ sessionId: { $ne: null } }, { batchId: 1, sessionId: 1 }).session(session).lean(),
  ]);
  const groupNames = new Map(groups.map(g => [g.name.toLowerCase(), g.name]));
  const trainersByName = new Map(trainers.map(t => [t.name, t]));
  const trainerCase = new Map(trainers.map(t => [t.name.toLowerCase(), t.name]));
  const venuesByName = new Map(venues.map(v => [v.name, v]));
  const venueCase = new Map(venues.map(v => [v.name.toLowerCase(), v.name]));
  const dayCase = new Map(config.days.map(d => [d.toLowerCase(), d]));
  const dayShort = new Map(config.days.map(d => [d.slice(0, 3).toLowerCase(), d]));
  const existingByName = new Map(all.map(b => [b.name.toLowerCase(), b]));

  /* 1) read rows and group them by batch */
  const groupsInFile = new Map();
  const report = rows.map((row, i) => {
    const line = i + 2;
    try {
      const batch = text(pick(row, 'batch', 'batch name'), 'name', 'batch name');
      if (!batch) throw new Error('Batch name is missing');
      const dayRaw = str(pick(row, 'day', 'weekday')).toLowerCase();
      const day = dayCase.get(dayRaw) || dayShort.get(dayRaw.slice(0, 3));
      if (!day) throw new Error(`"${pick(row, 'day', 'weekday')}" is not a teaching day (${config.days.join(', ')})`);
      const hallRaw = str(pick(row, 'hall', 'venue', 'room'));
      const venue = hallRaw ? venueCase.get(hallRaw.toLowerCase()) : '';
      if (hallRaw && !venue) throw new Error(`Hall "${hallRaw}" is not on the hall list`);
      const people = v => list(v).map(n => {
        const real = trainerCase.get(n.toLowerCase());
        if (!real) throw new Error(`Trainer "${n}" is not on the trainer list`);
        return real;
      });
      const cls = {
        day,
        slots: periods(pick(row, 'periods', 'period', 'slots', 'slot'), config.slots.length),
        subject: text(pick(row, 'subject', 'module', 'course'), 'subject'),
        venue,
        mainTrainers: people(pick(row, 'main', 'main trainers', 'main mentor', 'main mentors', 'trainer', 'trainers')),
        supportTrainers: people(pick(row, 'support', 'support trainers', 'support mentor', 'support mentors')),
        startDate: dateCell(pick(row, 'session start', 'session start date'), 'Session start'),
        endDate: dateCell(pick(row, 'session end', 'session end date'), 'Session end'),
      };
      if (!cls.subject) throw new Error('Subject is missing');
      const key = batch.toLowerCase();
      if (!groupsInFile.has(key)) {
        const yearRaw = str(pick(row, 'year', 'year group', 'group'));
        const found = existingByName.get(key);
        const group = yearRaw ? groupNames.get(yearRaw.toLowerCase()) : found?.group;
        if (!group) throw new Error(yearRaw ? `Year group "${yearRaw}" does not exist — create it first` : 'Year group is missing');
        groupsInFile.set(key, {
          firstRow: line, rows: [],
          fields: {
            name: found?.name || batch, group,
            dept: pick(row, 'department', 'dept') !== '' ? text(pick(row, 'department', 'dept'), 'dept') : found?.dept || '',
            count: pick(row, 'students', 'count') !== '' ? count(pick(row, 'students', 'count'), 'Students') : found?.count || 0,
            startDate: pick(row, 'start', 'start date', 'batch start') !== '' ? dateCell(pick(row, 'start', 'start date', 'batch start'), 'Start') : found?.startDate || '',
            endDate: pick(row, 'end', 'end date', 'batch end') !== '' ? dateCell(pick(row, 'end', 'end date', 'batch end'), 'End') : found?.endDate || '',
          },
          sessions: [], existing: found || null,
        });
      }
      const g = groupsInFile.get(key);
      g.sessions.push(cls); g.rows.push(line);
      return { row: line, status: g.existing ? 'update' : 'create', name: g.fields.name, batchKey: key };
    } catch (e) { return { row: line, status: 'error', error: e.message }; }
  });

  /* 2) validate each batch against everything else as it would stand after
        the import: untouched batches plus every other batch in the file */
  const inFile = new Set(groupsInFile.keys());
  const untouched = all.filter(b => !inFile.has(b.name.toLowerCase()));
  const validated = [];
  for (const [key, g] of groupsInFile) {
    if (report.some(r => r.batchKey === key && r.status === 'error')) continue;
    try {
      const fields = batchFields(g.fields);
      const old = g.existing?.sessions || [];
      const unused = [...old];
      const raw = g.sessions.map(s => {
        const i = unused.findIndex(o => o.day === s.day && o.slots.join() === s.slots.join());
        return i === -1 ? s : { ...s, _id: String(unused.splice(i, 1)[0]._id) };
      });
      const others = [...untouched, ...validated.map(v => ({ name: v.fields.name, startDate: v.fields.startDate, endDate: v.fields.endDate, sessions: v.sessions }))];
      const sessions = await validateSessions(raw, {
        startDate: fields.startDate, endDate: fields.endDate,
        existingIds: new Set(old.map(o => String(o._id))),
        existingPeople: new Set(old.flatMap(o => [...(o.mainTrainers || []), ...(o.supportTrainers || [])])),
        existingVenues: new Set(old.map(o => o.venue).filter(Boolean)),
      }, { others, config, venuesByName, trainersByName, session });
      /* date exceptions on sessions that are not in the file any more will go */
      const kept = new Set(sessions.filter(x => x._id).map(x => String(x._id)));
      const lost = g.existing ? exceptions.filter(e => String(e.batchId) === String(g.existing._id) && !kept.has(String(e.sessionId))).length : 0;
      validated.push({ key, fields, sessions, existing: g.existing, lost });
    } catch (e) {
      report.forEach(r => { if (r.batchKey === key) { r.status = 'error'; r.error = `${g.fields.name}: ${e.message}`; } });
    }
  }

  const exceptionsRemoved = validated.reduce((n, v) => n + v.lost, 0);
  return apply(req, 'batches', report, dryRun, session, async () => {
    let order = (all.reduce((m, b) => Math.max(m, b.order ?? 0), -1)) + 1;
    for (const v of validated) {
      if (v.existing) {
        await Batch.updateOne({ _id: v.existing._id }, { $set: { ...v.fields, sessions: v.sessions } }, { session });
        const after = await Batch.findById(v.existing._id, null, { session }).lean();
        await reconcileExceptions(after, session);
      } else {
        await Batch.create([{ ...v.fields, order: order++, sessions: v.sessions }], { session });
      }
      await clearActivitiesUnder(v.sessions, session, v.fields);
    }
  }, { batches: validated.length, exceptionsRemoved });
}

/* shared tail: report on a dry run, or apply everything inside the caller's
   transaction (the route aborts it if anything fails) */
async function apply(req, kind, report, dryRun, session, write, extra = {}) {
  const errors = report.filter(r => r.status === 'error').length;
  const creates = new Set(report.filter(r => r.status === 'create').map(r => r.name)).size;
  const updates = new Set(report.filter(r => r.status === 'update').map(r => r.name)).size;
  const out = { kind, dryRun, rows: report.map(({ data, id, batchKey, ...r }) => r), creates, updates, errors, ...extra };
  if (dryRun || errors) return out;

  await write();
  await audit(req, {
    action: 'import', entity: kind === 'halls' ? 'venue' : kind === 'trainers' ? 'trainer' : 'batch',
    name: `${kind} import`,
    summary: `${report.length} row(s): ${creates} created, ${updates} updated${extra.exceptionsRemoved ? ` · ${extra.exceptionsRemoved} date exception(s) on removed sessions deleted` : ''}`,
  }, session);
  return { ...out, dryRun: false, applied: true };
}

export default router;
