import { rangeStatus, sessionRange } from './dates.js';

/*
 * The weekly template says what *usually* happens; this says what happens on
 * a given date once date ranges, holidays, cancellations and substitutions are
 * applied. Everything date-based — the free finder, the analytics trend,
 * holiday notices and the substitute checks — goes through here, so they all
 * agree with each other and with the calendar.
 */
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const weekday = d => WEEKDAYS[new Date(`${d}T00:00:00Z`).getUTCDay()];

export const holidayOn = (d, exceptions) => exceptions.find(e => e.type === 'holiday' && e.date <= d && (e.endDate || e.date) >= d) || null;

/*
 * Every class on `date`: { batch, batchId, session, day, slots, subject, venue,
 * main, support, status: 'running' | 'cancelled', substitute: {from,to} | null,
 * exception }. On a holiday or a non-teaching day the list is empty and
 * `holiday` says why.
 */
export function classesOn(date, { config, batches, exceptions = [] }) {
  const day = weekday(date);
  const holiday = holidayOn(date, exceptions);
  if (!config.days.includes(day) || holiday) return { day, holiday, teachingDay: config.days.includes(day), classes: [] };

  const byKey = new Map(exceptions.filter(e => e.date === date && e.sessionId).map(e => [String(e.sessionId), e]));
  const classes = [];
  for (const b of batches) {
    for (const s of b.sessions || []) {
      if (s.day !== day) continue;
      const { start, end } = sessionRange(s, b);
      if (rangeStatus(start, end, date) !== 'current') continue;
      const ex = byKey.get(String(s._id));
      let main = [...(s.mainTrainers || [])], support = [...(s.supportTrainers || [])], substitute = null;
      if (ex?.type === 'substitute') {
        substitute = { from: ex.fromTrainer, to: ex.toTrainer };
        main = main.map(n => (n === ex.fromTrainer ? ex.toTrainer : n));
        support = support.map(n => (n === ex.fromTrainer ? ex.toTrainer : n));
      }
      classes.push({
        batch: b.name, batchId: String(b._id), sessionId: String(s._id), session: s,
        day, slots: s.slots, subject: s.subject, venue: s.venue || '',
        main, support, status: ex?.type === 'cancel' ? 'cancelled' : 'running', substitute, exception: ex || null,
      });
    }
  }
  return { day, holiday: null, teachingDay: true, classes };
}

/* Inclusive list of YYYY-MM-DD dates from a to b (at most `cap`). */
export function datesBetween(a, b, cap = 400) {
  const out = [];
  const d = new Date(`${a}T00:00:00Z`), end = new Date(`${b}T00:00:00Z`);
  while (d <= end && out.length < cap) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
