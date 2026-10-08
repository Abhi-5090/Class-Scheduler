/*
 * One line above the day, trainer and hall views saying where today is on the
 * grid: the period running now (and how many classes are in it), the next one,
 * or that the day is over / not a teaching day. The same period is highlighted
 * inside the grids below. `now` is periodAt() from lib/now.js.
 */
export default function NowBar({ now, data }) {
  const dayIdx = data.days.indexOf(now.today);
  const running = slot => (slot === null || dayIdx < 0 ? 0 : data.groups.reduce((n, g) => n + g.batches.reduce(
    (m, b) => m + (b.rows || []).filter(r => r.dayIndexes?.includes(dayIdx) && r.slots?.includes(slot)).length, 0), 0));
  const label = i => `Slot ${i + 1} · ${data.slots[i]}`;

  let text, live = false;
  if (now.state === 'off') {
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
