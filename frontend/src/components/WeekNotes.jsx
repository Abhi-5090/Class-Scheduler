/*
 * "This week" — the holidays, cancelled classes and substitutions that change
 * the current week. The weekly grids show the regular timetable; this strip
 * says where the real week differs, so nobody turns up to a cancelled class.
 */
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const nice = s => new Date(`${s}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

export default function WeekNotes({ exceptions = [] }) {
  const now = new Date();
  const mon = new Date(now); mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const from = iso(now), to = iso(sun);            // what is still ahead this week
  const list = exceptions
    .filter(e => (e.endDate || e.date) >= from && e.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!list.length) return null;

  return (
    <div className="weeknotes" role="note" aria-label="Changes this week">
      <b>This week</b>
      <ul>
        {list.map(e => (
          <li key={e.id}>
            <span className={`feed-tag ${e.type}`}>{e.type === 'holiday' ? 'Holiday' : e.type === 'cancel' ? 'Cancelled' : 'Substitute'}</span>
            <span>{nice(e.date)}{e.endDate && e.endDate !== e.date ? ` – ${nice(e.endDate)}` : ''}</span>
            <span className="muted">
              {e.type === 'holiday' ? e.label
                : e.type === 'cancel' ? `${e.batch} · ${e.subject}${e.label ? ` (${e.label})` : ''}`
                : `${e.toTrainer} covers ${e.fromTrainer} · ${e.batch}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
