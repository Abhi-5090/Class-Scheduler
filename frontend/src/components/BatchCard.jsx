import { PinIcon } from './Icons.jsx';
import { formatDateRange } from '../lib/calendarUtils.js';

/* A day range reads better broken over two lines, the way it did originally. */
function DayLabel({ day }) {
  const parts = day.split(/ – | - /);
  return parts.length > 1
    ? <>{parts[0]}<br />–&nbsp;{parts.slice(1).join(' – ')}</>
    : <>{day}</>;
}

export default function BatchCard({ batch, dimUnless }) {
  /* A batch usually meets in one room all week — the common case keeps the
     single footer it always had. Once its sessions split across halls, that
     one line can no longer say which room is which, so each row grows its
     own instead. */
  const distinctVenues = [...new Set(batch.venues || [])];
  const oneVenue = distinctVenues.length === 1 ? distinctVenues[0] : null;
  const perRowVenue = distinctVenues.length > 1;

  return (
    <article className="bcard rv">
      <header>
        <div>
          <h3>{batch.name}</h3>
          <div className="meta">
            {batch.dept && <span className="tag dept">{batch.dept}</span>}
            {(batch.startDate || batch.endDate) && (
              <span className="tag-period" title="Tentative schedule dates">
                📅 {formatDateRange(batch.startDate, batch.endDate)}
              </span>
            )}
          </div>
        </div>
        {!!batch.count && <div className="cnt-b">{batch.count}<span>students</span></div>}
      </header>

      <div className="rows">
        {batch.rows.map((r, i) => (
          <div className={`srow ${dimUnless(r) ? '' : 'dim'}`} key={i}>
            <div className="day"><DayLabel day={r.day} /></div>
            <div>
              <div className="subj">{r.subject}</div>
              <div className="time">{r.time}{r.slot && <span className="slot">Slot {r.slot}</span>}</div>
              <div className="who">
                <div><span className="lbl m">Main</span><span className="m">{r.trainer}</span></div>
                {r.support && r.support !== '—' && (
                  <div><span className="lbl s">Support</span><span className="s">{r.support}</span></div>
                )}
                {perRowVenue && r.venue && (
                  <div><span className="lbl v">Hall</span><span className="v">{r.venue}</span></div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {oneVenue && (
        <div className="venue-foot"><PinIcon />{oneVenue}</div>
      )}
    </article>
  );
}
