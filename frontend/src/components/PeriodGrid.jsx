import { abbreviateBatch, abbreviateVenue } from '../lib/abbreviate.js';

const DAY_SHORT = {
  Monday: 'MON', Tuesday: 'TUE', Wednesday: 'WED',
  Thursday: 'THU', Friday: 'FRI', Saturday: 'SAT', Sunday: 'SUN',
};

export const dayShort = d => DAY_SHORT[d] || d.slice(0, 3).toUpperCase();

/* The lunch slot carries the placeholder "Lunch Break" wherever no class was
   booked over it. Only a real batch name counts as a class — First Year's
   slot 3–4 sessions legitimately run through 11:50–12:50. */
const isClass = v => !!v && !/^lunch\b/i.test(v.trim());

/*
 * The 8 × 5 timetable shown on every trainer and hall card. `entity` is one
 * of the derived trainer/venue views: { grid, roles? }.
 *
 * `onEditCell(day, slotIndex, current)` — pass it to make non-class cells on
 * a trainer's own grid clickable (signed-in admins only; the caller decides
 * that, this component just renders what it's given). `current` is null for
 * a free/plain-lunch cell, or `{ kind, label }` for an existing logged note.
 * A cell already held by a real class (role 'main'/'support') never calls it.
 *
 * `now` is periodAt() from lib/now.js: today's column, the running period's
 * row and the cell where they cross are marked, so the grid answers "what is
 * happening right now?" at a glance.
 */
export default function PeriodGrid({ entity, slots, days, lunchIndex, onEditCell, now }) {
  return (
    <div className="tt-scroll">
      <div className="ttgrid" style={{ '--daycols': days.length }}>
        <div />
        {days.map(d => (
          <div className={`tt-dh ${now?.today === d ? 'today' : ''}`} key={d}>
            {dayShort(d)}{now?.today === d && <span className="sr-only"> (today)</span>}
          </div>
        ))}

        {slots.map((label, i) => (
          <Row key={i} i={i} label={label} entity={entity} days={days} lunchIndex={lunchIndex} onEditCell={onEditCell} now={now} />
        ))}
      </div>
    </div>
  );
}

function Row({ i, label, entity, days, lunchIndex, onEditCell, now }) {
  const isNow = now?.current === i, isNext = !isNow && now?.next === i;
  /* the cell in today's column on the running (or next) period */
  const mark = d => (now?.today === d ? (isNow ? ' now-cell' : isNext ? ' next-cell' : '') : '');
  return (
    <>
      <div className={`tt-time${isNow ? ' is-now' : isNext ? ' is-next' : ''}`}>
        {label}
        {isNow && <span className="now-tag">Now</span>}
        {isNext && <span className="now-tag next">Next</span>}
      </div>
      {days.map(d => {
        const v = entity.grid[d]?.[i] || '';
        const role = entity.roles ? entity.roles[d]?.[i] || '' : '';
        const venue = entity.venues ? entity.venues[d]?.[i] || '' : '';
        const isGlobalLunch = i === lunchIndex && !isClass(v);

        /* a real class is never editable here — that lives in Batches & Sessions */
        if (role === 'main' || role === 'support') {
          const shortBatch = abbreviateBatch(v);
          const shortVenue = abbreviateVenue(venue);
          return (
            <div
              className={`cell occ ${role === 'support' ? 'support' : ''}${mark(d)}`}
              key={d}
              title={`${v} — ${role === 'support' ? 'Support' : 'Main'} mentor${venue ? ` @ ${venue}` : ''}`}
            >
              <div className="batch-name">
                <span className="name-full">{v}</span>
                <span className="name-abbr">{shortBatch}</span>
              </div>
              {venue && (
                <div className="cell-venue">
                  <span className="name-full">{venue}</span>
                  <span className="name-abbr">{shortVenue}</span>
                </div>
              )}
              <span className="rl">{role.toUpperCase()}</span>
            </div>
          );
        }

        const clickable = !!onEditCell;
        const current = role === 'lunch' || role === 'other' ? { kind: role, label: v } : null;
        const handleClick = clickable ? () => onEditCell(d, i, current) : undefined;

        if (role === 'lunch') {
          return clickable
            ? (
              <button type="button" className={`cell lunch editable${mark(d)}`} key={d} onClick={handleClick} title="Logged lunch — click to change or clear">
                {v}
              </button>
            ) : (
              <div className={`cell lunch${mark(d)}`} key={d}>{v}</div>
            );
        }
        if (role === 'other') {
          const shortLabel = abbreviateBatch(v);
          return clickable
            ? (
              <button type="button" className={`cell occ other editable${mark(d)}`} key={d} onClick={handleClick} title={`${v} — click to change or clear`}>
                <span className="name-full">{v}</span>
                <span className="name-abbr">{shortLabel}</span>
                <span className="rl">ASSIGNED</span>
              </button>
            ) : (
              <div className={`cell occ other${mark(d)}`} key={d} title={v}>
                <span className="name-full">{v}</span>
                <span className="name-abbr">{shortLabel}</span>
                <span className="rl">ASSIGNED</span>
              </div>
            );
        }
        if (isClass(v)) {
          const shortBatch = abbreviateBatch(v);
          return (
            <div className={`cell occ${mark(d)}`} key={d} title={v}>
              <span className="name-full">{v}</span>
              <span className="name-abbr">{shortBatch}</span>
            </div>
          );
        }
        if (isGlobalLunch) {
          return clickable
            ? <button type="button" className={`cell lunch editable${mark(d)}`} key={d} onClick={handleClick} title="Click to assign lunch or other work">Lunch</button>
            : <div className={`cell lunch${mark(d)}`} key={d}>Lunch</div>;
        }
        return clickable
          ? <button type="button" className={`cell free editable${mark(d)}`} key={d} onClick={handleClick} title="Click to assign lunch or other work">Free</button>
          : <div className={`cell free${mark(d)}`} key={d}>Free</div>;
      })}
    </>
  );
}

export function Counts({ entity }) {
  const breakdownEntries = Object.entries(entity.activitiesBreakdown || {});

  const split = entity.mainCount !== undefined ? (
    <>
      <div className="count occ" title="Main mentor teaching periods">
        <span className="big">{entity.mainCount}</span><small>Main</small>
      </div>
      <div className="count supp" title="Support mentor teaching periods">
        <span className="big">{entity.supportCount}</span><small>Support</small>
      </div>
      {breakdownEntries.map(([name, cnt]) => (
        <div className="count task" key={name} title={`${name}: ${cnt} period(s)`}>
          <span className="big">{cnt}</span><small>{name}</small>
        </div>
      ))}
    </>
  ) : (
    <div className="count occ"><span className="big">{entity.totalBusy}</span><small>Occupied</small></div>
  );

  return (
    <div className="counts">
      <div className="count free" title="Free unassigned periods">
        <span className="big">{entity.totalFree}</span><small>Free</small>
      </div>
      {split}
    </div>
  );
}

/* "Free all day" means every period except lunch is open. */
export function freeAllDay(entity, days, slotCount) {
  return days.filter(d => (entity.free[d] || []).length === slotCount - 1);
}
