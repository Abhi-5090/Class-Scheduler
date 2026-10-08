import { useEffect, useState } from 'react';

/*
 * "What is running right now?" for the period grid.
 *
 * Slot labels are written 12-hour without AM/PM ("9:00–9:50", "1:40–2:30"),
 * the same convention the server's time labels assume: 8–11 is morning,
 * 12 and 1–7 are afternoon, and anything already 13:00+ is 24-hour.
 */
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function toMinutes(hhmm) {
  const [h, m = '0'] = String(hhmm).trim().split(':');
  let hour = parseInt(h, 10);
  const min = parseInt(m, 10) || 0;
  if (!Number.isFinite(hour)) return null;
  if (hour >= 1 && hour <= 7) hour += 12;
  return hour * 60 + min;
}

/* '9:00–9:50' → { start: 540, end: 590 } (minutes since midnight) */
export function slotWindow(label) {
  const [a, b] = String(label || '').split(/[–-]/);
  const start = toMinutes(a), end = toMinutes(b);
  return start === null || end === null ? null : { start, end };
}

/*
 * Where `date` falls on the configured grid:
 *   today   — the weekday name if it is a teaching day, else null
 *   current — index of the period running now, or null
 *   next    — index of the next period still to start today, or null
 *   state   — 'before' | 'during' | 'between' | 'after' | 'off'
 */
export function periodAt(slots = [], days = [], date = new Date()) {
  const dayName = WEEKDAYS[date.getDay()];
  if (!days.includes(dayName)) return { today: null, current: null, next: null, state: 'off' };

  const mins = date.getHours() * 60 + date.getMinutes();
  const windows = slots.map(slotWindow);
  let current = null, next = null;
  windows.forEach((w, i) => {
    if (!w) return;
    if (mins >= w.start && mins < w.end) current = i;
    else if (w.start > mins && (next === null || w.start < windows[next].start)) next = i;
  });

  const first = windows.find(Boolean), last = [...windows].reverse().find(Boolean);
  const state = current !== null ? 'during'
    : first && mins < first.start ? 'before'
    : last && mins >= last.end ? 'after'
    : 'between';
  return { today: dayName, current, next, state };
}

/* The current time, refreshed every `ms` (30s by default) so "now" moves on
   by itself while the board is left open on a screen. */
export function useNow(ms = 30000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
