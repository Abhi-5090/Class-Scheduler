/*
 * Dates are stored as plain 'YYYY-MM-DD' strings ('' = open-ended), which
 * compare correctly as strings, so no Date maths is needed for ranges.
 */

/* the college's calendar day, whatever timezone the server runs in */
const TZ = process.env.APP_TZ || 'Asia/Kolkata';
export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });

/* '' is allowed (no date); anything else must be a real calendar date */
export function isIsoDate(v) {
  if (v === '') return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/* Two ranges overlap unless one ends before the other starts; a blank end is
   unbounded on that side. */
export function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return (aStart || '0000-00-00') <= (bEnd || '9999-99-99')
      && (bStart || '0000-00-00') <= (aEnd || '9999-99-99');
}

/* 'upcoming' | 'current' | 'ended' relative to `on` (today by default) */
export function rangeStatus(start, end, on = today()) {
  if (start && on < start) return 'upcoming';
  if (end && on > end) return 'ended';
  return 'current';
}

/* a session's own dates win; otherwise it inherits the batch's */
export const sessionRange = (s, b) => ({
  start: s.startDate || b?.startDate || '',
  end: s.endDate || b?.endDate || '',
});
