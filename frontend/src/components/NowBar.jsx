import { getClassesForDate } from '../lib/calendarUtils.js';

/*
 * One line above the day, trainer and hall views saying where today is on the
 * grid: the period running now (and how many classes are in it), the next one,
 * or that the day is over / not a teaching day. The same period is highlighted
 * inside the grids below. `now` is periodAt() from lib/now.js.
 */
export default function NowBar({ now, data }) {
  const todayIso = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
  /* today's real classes: batch dates, holidays and cancellations applied */
  const todays = now.today ? getClassesForDate(todayIso, data).filter(c => !c.cancelled) : [];
  const running = slot => (slot === null ? 0 : todays.filter(c => c.slots.includes(slot)).length);
  const label = i => `Slot ${i + 1} · ${data.slots[i]}`;

  /* a holiday today overrides the weekly timetable */
  const holiday = (data.exceptions || []).find(e => e.type === 'holiday' && e.date <= todayIso && (e.endDate || e.date) >= todayIso);

  let text, live = false;
  if (holiday && now.state !== 'off') {
    text = <><b>Holiday</b> — {holiday.label}. No classes today.</>;
  } else if (now.state === 'off') {
    text = <>Today is not a teaching day — showing the weekly timetable.</>;
  } else if (now.state === 'during') {
    live = true;
    const lunch = now.current === data.lunchIndex;
    const n = running(now.current);
    text = (
      <>
        <b>Now</b> — {label(now.current)}
        {lunch && !n ? ' · Lunch break' : ` · ${n} class${n === 1 ? '' : 'es'} running`}
        {now.next !== null && <span className="nowbar-next"> · Next: {label(now.next)}</span>}
      </>
    );
  } else if (now.state === 'before' || now.state === 'between') {
    text = now.next !== null
      ? <><b>Next</b> — {label(now.next)} · {running(now.next)} class{running(now.next) === 1 ? '' : 'es'} scheduled</>
      : <>No more periods today.</>;
  } else {
    text = <>Classes are over for today ({now.today}).</>;
  }

  return (
    <div className={`nowbar ${live ? 'live' : ''}`} role="status" aria-live="polite">
      <span className="nowbar-dot" aria-hidden="true" />
      <span className="nowbar-day">{now.today || new Date().toLocaleDateString('en-US', { weekday: 'long' })}</span>
      <span className="nowbar-text">{text}</span>
    </div>
  );
}
