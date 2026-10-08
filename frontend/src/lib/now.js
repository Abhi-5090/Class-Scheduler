import { useEffect, useState } from 'react';

/*
 * "What is running right now?" for the period grid.
 *
 * Slot labels are written 12-hour without AM/PM ("9:00–9:50", "1:40–2:30");
 * slotWindows() reads them in order through the day to place each one.
 */
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function clock(hhmm) {
  const [h, m = '0'] = String(hhmm ?? '').trim().split(':');
  const hour = parseInt(h, 10);
  return Number.isFinite(hour) ? hour * 60 + (parseInt(m, 10) || 0) : null;
}

/*
 * All the slot labels at once → [{ start, end }] in minutes since midnight.
 * The grid runs forward through the day, so times are read in order: the
 * first is morning (a 1–6 o'clock first period is read as afternoon), and any
 * time that would go backwards is moved 12 hours on. "7:30–8:20" then reads as
 * an early-morning period, "12:50–1:40" as lunchtime, "1:40–2:30" as afternoon.
 */
export function slotWindows(labels = []) {
  let prev = null;
  const fix = t => {
    if (t === null) return null;
    let v = t;
    if (prev === null) { if (v < 7 * 60) v += 12 * 60; }
    else while (v < prev) v += 12 * 60;
    prev = v;
    return v;
  };
  return labels.map(l => {
    const [a, b] = String(l || '').split(/[–-]/);
    const start = fix(clock(a)), end = fix(clock(b));
    return start === null || end === null ? null : { start, end };
  });
}
export const slotWindow = label => slotWindows([label])[0];

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
  const windows = slotWindows(slots);
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
