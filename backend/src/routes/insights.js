import { Router } from 'express';
import Batch from '../models/Batch.js';
import Trainer from '../models/Trainer.js';
import Venue from '../models/Venue.js';
import Config from '../models/Config.js';
import Activity from '../models/Activity.js';
import Exception from '../models/Exception.js';
import Notification from '../models/Notification.js';
import { requireAuth } from '../middleware/auth.js';
import { wrap } from '../middleware/asyncRoute.js';
import { buildAnalytics } from '../services/analytics.js';
import { classesOn, addDays, datesBetween, weekday } from '../services/occurrences.js';
import { rangeStatus, sessionRange, today } from '../services/dates.js';
import { loadSchedule } from './schedule.js';
import { str, fail, date, COORD, isNonTeaching } from './_shared.js';

/*
 * Read-only views over the timetable:
 *   GET /analytics   the dashboard and workload numbers         (admin, coordinator)
 *   GET /finder      who and which hall is free at a time        (any signed-in role)
 *   GET /me          a trainer's own week, next 30 days, notices (any signed-in role)
 */
const router = Router();
router.use(requireAuth());

router.get('/analytics', COORD, wrap(async (req, res) => {
  res.json(await buildAnalytics({ withAudit: req.user.role === 'admin' }));
}));

/*
 * ?slots=0,1 and either ?date=YYYY-MM-DD (that real day: date ranges,
 * holidays, cancellations and substitutions all apply) or ?day=Monday (the
 * weekly timetable as it runs this week).
 */
router.get('/finder', wrap(async (req, res) => {
  const config = await Config.findOne({ key: 'default' }).lean();
  const slots = [...new Set(str(req.query.slots).split(',').filter(Boolean).map(Number))];
  if (!slots.length || slots.some(i => !Number.isInteger(i) || i < 0 || i >= config.slots.length)) return fail(res, 400, 'Pick one or more periods');

  const dateStr = req.query.date ? date(req.query.date, 'Date') : '';
  const day = dateStr ? weekday(dateStr) : str(req.query.day);
  if (!dateStr && !config.days.includes(day)) return fail(res, 400, 'Pick a date or a teaching day');

  const [batches, exceptions, trainers, venues, activities] = await Promise.all([
    Batch.find().lean(), Exception.find().lean(), Trainer.find({ active: true }).lean(),
    Venue.find({ active: true }).lean(), Activity.find({ day, slot: { $in: slots } }).lean(),
  ]);

  /* the classes that occupy these periods */
  let running = [], holiday = null, teachingDay = config.days.includes(day);
  if (dateStr) {
    const on = classesOn(dateStr, { config, batches, exceptions });
    holiday = on.holiday; teachingDay = on.teachingDay;
    running = on.classes.filter(c => c.status === 'running');
  } else {
    const on = today();
    running = batches.flatMap(b => (b.sessions || [])
      .filter(s => s.day === day && rangeStatus(sessionRange(s, b).start, sessionRange(s, b).end, on) === 'current')
      .map(s => ({ batch: b.name, subject: s.subject, venue: s.venue || '', slots: s.slots, main: s.mainTrainers || [], support: s.supportTrainers || [] })));
  }
  running = running.filter(c => c.slots.some(i => slots.includes(i)));

  const busyT = new Map(), busyV = new Map();
  for (const c of running) {
    for (const n of [...c.main, ...c.support]) if (!busyT.has(n)) busyT.set(n, `${c.batch} · ${c.subject}`);
    if (c.venue && !busyV.has(c.venue)) busyV.set(c.venue, `${c.batch} · ${c.subject}`);
  }
  for (const a of activities) if (!busyT.has(a.trainer)) busyT.set(a.trainer, a.kind === 'lunch' ? 'Lunch (logged)' : `${a.label} (assigned work)`);

  /* weekly load helps pick between several free people */
  const data = await loadSchedule();
  const loadOf = new Map(data.trainers.map(t => [t.name, (t.mainCount || 0) + (t.supportCount || 0)]));

  res.json({
    date: dateStr, day, slots, teachingDay,
    holiday: holiday ? { label: holiday.label, date: holiday.date, endDate: holiday.endDate } : null,
    trainers: trainers.map(t => ({
      name: t.name, track: isNonTeaching(t) ? 'non-teaching' : 'teaching',
      free: !busyT.has(t.name), busyWith: busyT.get(t.name) || null, weeklyLoad: loadOf.get(t.name) || 0,
    })).sort((a, b) => Number(b.free) - Number(a.free) || a.weeklyLoad - b.weeklyLoad || a.name.localeCompare(b.name)),
    halls: venues.map(v => ({ name: v.name, capacity: v.capacity || 0, free: !busyV.has(v.name), busyWith: busyV.get(v.name) || null }))
      .sort((a, b) => Number(b.free) - Number(a.free) || a.name.localeCompare(b.name)),
  });
}));

/* A trainer's own view: their weekly grid, the next 30 days as they will
   really run, and the notices sent to them. Other roles get it too when their
   account is linked to a trainer; otherwise there is nothing personal to show. */
router.get('/me', wrap(async (req, res) => {
  if (!req.user.trainer) return res.json({ linked: false });
  const trainer = await Trainer.findById(req.user.trainer).lean();
  if (!trainer) return res.json({ linked: false });

  const [data, config, batches, exceptions, notices] = await Promise.all([
    loadSchedule(), Config.findOne({ key: 'default' }).lean(), Batch.find().lean(), Exception.find().lean(),
    Notification.find({ trainer: trainer.name }).sort({ at: -1 }).limit(20).lean(),
  ]);
  const view = data.trainers.find(t => t.name === trainer.name) || null;

  const start = today();
  const agenda = [];
  for (const d of datesBetween(start, addDays(start, 29))) {
    const on = classesOn(d, { config, batches, exceptions });
    if (on.holiday && on.teachingDay) { agenda.push({ date: d, day: on.day, holiday: on.holiday.label, items: [] }); continue; }
    const items = on.classes
      .filter(c => [...c.main, ...c.support].includes(trainer.name) || c.substitute?.from === trainer.name)
      .map(c => ({
        batch: c.batch, subject: c.subject, venue: c.venue, slots: c.slots,
        role: c.main.includes(trainer.name) ? 'main' : c.support.includes(trainer.name) ? 'support' : 'covered',
        status: c.substitute?.from === trainer.name ? 'covered' : c.substitute?.to === trainer.name ? 'covering' : c.status,
        note: c.substitute ? (c.substitute.to === trainer.name ? `Covering for ${c.substitute.from}` : `${c.substitute.to} covers this`) : '',
      }));
    if (items.length) agenda.push({ date: d, day: on.day, items });
  }

  res.json({
    linked: true,
    trainer: { name: trainer.name, track: isNonTeaching(trainer) ? 'non-teaching' : 'teaching' },
    days: data.days, slots: data.slots, lunchIndex: data.lunchIndex,
    view, agenda,
    notices: notices.map(n => ({ at: n.at, subject: n.subject, status: n.status, context: n.context })),
  });
}));

export default router;
