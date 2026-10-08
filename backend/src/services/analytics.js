import Batch from '../models/Batch.js';
import Venue from '../models/Venue.js';
import Exception from '../models/Exception.js';
import Config from '../models/Config.js';
import Notification from '../models/Notification.js';
import AuditLog from '../models/AuditLog.js';
import { loadSchedule } from '../routes/schedule.js';
import { classesOn, datesBetween, addDays } from './occurrences.js';
import { today } from './dates.js';

const isNT = t => t.track === 'non-teaching' || t.track === 'non-technical';
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

/* Monday of the week containing `iso` */
function mondayOf(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/*
 * Everything the dashboard and the workload page draw. Weekly figures come
 * from the derived board (what runs this week); the trend walks real dates,
 * so it reflects batch start/end dates, holidays and cancellations.
 */
export async function buildAnalytics({ withAudit = false } = {}) {
  const on = today();
  const [data, batches, exceptions, config, venueDocs] = await Promise.all([
    loadSchedule(), Batch.find().lean(), Exception.find().lean(), Config.findOne({ key: 'default' }).lean(), Venue.find({}, { name: 1, capacity: 1 }).lean(),
  ]);
  const capacityOf = new Map(venueDocs.map(v => [v.name, v.capacity || 0]));
  const ctx = { config, batches, exceptions };
  const live = data.batches.filter(b => b.status === 'current');
  const teachingCells = data.days.length * (data.slots.length - 1);   // lunch excluded

  /* ── trainers ── */
  const trainerLoad = data.trainers.map(t => ({
    name: t.name, track: isNT(t) ? 'Non-Teaching' : 'Teaching',
    main: t.mainCount || 0, support: t.supportCount || 0, assigned: t.otherCount || 0,
    total: (t.mainCount || 0) + (t.supportCount || 0) + (t.otherCount || 0),
    free: t.totalFree || 0,
    utilization: pct((t.mainCount || 0) + (t.supportCount || 0) + (t.otherCount || 0), teachingCells),
  })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  /* ── halls ── */
  const hallUsage = data.venues.map(v => {
    const used = v.totalBusy || 0, available = used + (v.totalFree || 0);
    return { name: v.name, used, available, free: v.totalFree || 0, utilization: pct(used, available), capacity: capacityOf.get(v.name) || 0 };
  }).sort((a, b) => b.utilization - a.utilization);

  /* ── day × period heatmap: classes running this week ── */
  const cells = data.days.map(() => data.slots.map(() => 0));
  for (const b of live) {
    for (const r of b.rows) {
      for (const di of r.dayIndexes || []) for (const si of r.slots || []) cells[di][si] += 1;
    }
  }
  const heatMax = Math.max(1, ...cells.flat());

  /* ── composition ── */
  const byGroup = data.groups.map(g => ({
    group: g.group,
    batches: g.batches.length,
    periods: g.batches.reduce((n, b) => n + b.rows.reduce((m, r) => m + r.slots.length * r.dayIndexes.length, 0), 0),
    students: g.batches.reduce((n, b) => n + (Number(b.count) || 0), 0),
  }));
  const subjects = new Map();
  const byDay = data.days.map(day => ({ day, periods: 0, classes: 0 }));
  let weeklyPeriods = 0, unstaffed = 0, noHall = 0;
  for (const b of live) {
    for (const r of b.rows) {
      const p = r.slots.length * r.dayIndexes.length;
      weeklyPeriods += p;
      subjects.set(r.subject, (subjects.get(r.subject) || 0) + p);
      for (const di of r.dayIndexes) { byDay[di].periods += r.slots.length; byDay[di].classes += 1; }
      if (!r.mainList.length) unstaffed += r.dayIndexes.length;
      if (!r.venue) noHall += r.dayIndexes.length;
    }
  }
  const topSubjects = [...subjects].map(([subject, periods]) => ({ subject, periods })).sort((a, b) => b.periods - a.periods).slice(0, 10);

  const status = { current: 0, upcoming: 0, ended: 0 };
  data.batches.forEach(b => { status[b.status] = (status[b.status] || 0) + 1; });

  const trackSplit = ['Teaching', 'Non-Teaching'].map(track => {
    const list = trainerLoad.filter(t => t.track === track);
    return { track, trainers: list.length, periods: list.reduce((n, t) => n + t.main + t.support, 0) };
  });

  /* ── trend: class periods per week, 4 weeks back to 11 ahead ── */
  const firstWeek = addDays(mondayOf(on), -28);
  const trend = [];
  for (let w = 0; w < 16; w++) {
    const start = addDays(firstWeek, w * 7);
    let periods = 0, cancelled = 0, holidayDays = 0;
    for (const d of datesBetween(start, addDays(start, 6))) {
      const day = classesOn(d, ctx);
      if (day.holiday && day.teachingDay) holidayDays += 1;
      for (const c of day.classes) {
        if (c.status === 'cancelled') cancelled += c.slots.length;
        else periods += c.slots.length;
      }
    }
    trend.push({ week: start, periods, cancelled, holidayDays, current: start === mondayOf(on) });
  }

  /* ── what is coming up ── */
  const horizon = addDays(on, 30);
  const upcomingExceptions = exceptions
    .filter(e => (e.endDate || e.date) >= on && e.date <= horizon)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(e => ({ type: e.type, date: e.date, endDate: e.endDate, label: e.label, batch: e.batch, subject: e.subject, fromTrainer: e.fromTrainer, toTrainer: e.toTrainer }));

  const since = new Date(Date.now() - 7 * 864e5);
  const notes = await Notification.aggregate([{ $match: { at: { $gte: since } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
  const notifications = Object.fromEntries(['sent', 'failed', 'skipped', 'queued'].map(k => [k, notes.find(x => x._id === k)?.n || 0]));

  const hallUsed = hallUsage.reduce((n, h) => n + h.used, 0), hallAvail = hallUsage.reduce((n, h) => n + h.available, 0);
  const teachingTrainers = trainerLoad.filter(t => t.track === 'Teaching');

  return {
    generatedAt: new Date().toISOString(), today: on,
    days: data.days, slots: data.slots, lunchIndex: data.lunchIndex,
    kpis: {
      activeBatches: status.current, upcomingBatches: status.upcoming, endedBatches: status.ended,
      trainers: trainerLoad.length, teaching: teachingTrainers.length, nonTeaching: trainerLoad.length - teachingTrainers.length,
      halls: hallUsage.length, weeklyPeriods, students: data.uniqueStudents,
      hallUtilization: pct(hallUsed, hallAvail),
      trainerUtilization: pct(teachingTrainers.reduce((n, t) => n + t.total, 0), teachingTrainers.length * teachingCells),
      idleTrainers: teachingTrainers.filter(t => t.main + t.support === 0).length,
      conflicts: data.conflicts.length, unstaffed, noHall,
      exceptionsNext30: upcomingExceptions.length,
      holidaysNext30: upcomingExceptions.filter(e => e.type === 'holiday').length,
    },
    trainerLoad, hallUsage, heatmap: { cells, max: heatMax }, byGroup, topSubjects, byDay, batchStatus: status, trackSplit,
    trend, upcomingExceptions, notifications, conflicts: data.conflicts,
    recent: withAudit ? await AuditLog.find().sort({ at: -1 }).limit(8).lean() : [],
  };
}
