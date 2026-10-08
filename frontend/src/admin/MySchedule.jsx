import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAdmin } from '../lib/useAdmin.js';
import { PageHead, Notice, Spinner, EmptyState } from './ui.jsx';
import PeriodGrid, { Counts } from '../components/PeriodGrid.jsx';
import { periodAt, useNow } from '../lib/now.js';

const nice = iso => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const STATUS = { running: '', cancelled: 'Cancelled', covered: 'Covered by someone else', covering: 'You are covering' };

/*
 * A trainer's own view: the weekly timetable, the next 30 days as they will
 * actually run (holidays, cancellations and substitutions applied), and the
 * notices emailed to them.
 */
export default function MySchedule() {
  const { user } = useAdmin();
  const [me, setMe] = useState(null);
  const [error, setError] = useState('');
  const clock = useNow();

  useEffect(() => { api.mySchedule().then(setMe).catch(e => setError(e.message)); }, []);

  if (error) return <><PageHead title="My Schedule" /><Notice error={error} /></>;
  if (!me) return <><PageHead title="My Schedule" /><Spinner /></>;
  if (!me.linked) {
    return (
      <>
        <PageHead title="My Schedule" />
        <EmptyState title="This account is not linked to a trainer">
          {user?.role === 'trainer' ? 'Ask an admin to link your account to your trainer record.' : 'Admin and coordinator accounts can be linked to a trainer from Users & Roles to see a personal timetable here.'}
        </EmptyState>
      </>
    );
  }

  const now = periodAt(me.slots, me.days, clock);
  const slotTime = s => `${me.slots[s[0]]?.split(/[–-]/)[0]}–${me.slots[s[s.length - 1]]?.split(/[–-]/).pop()}`;

  return (
    <>
      <PageHead title={`My Schedule · ${me.trainer.name}`} blurb="Your weekly timetable, the next 30 days as they will really run, and the notices sent to you." />

      {me.view && (
        <article className="tcard">
          <div className="top">
            <div className="tname"><div><h3>Weekly timetable</h3><div className="role">{me.trainer.track === 'teaching' ? 'Teaching' : 'Non-Teaching'}</div></div></div>
            <Counts entity={me.view} />
          </div>
          <PeriodGrid entity={me.view} slots={me.slots} days={me.days} lunchIndex={me.lunchIndex} now={now} />
        </article>
      )}

      <div className="dash-grid">
        <section className="card span-7">
          <h2>Next 30 days</h2>
          <p className="sub">With holidays, cancellations and substitutions applied.</p>
          {!me.agenda.length ? <EmptyState title="No classes in the next 30 days" /> : (
            <ol className="agenda">
              {me.agenda.map(d => (
                <li key={d.date}>
                  <div className="agenda-day">{nice(d.date)}</div>
                  {d.holiday ? <div className="agenda-item holiday">Holiday — {d.holiday}</div> : d.items.map((c, i) => (
                    <div key={i} className={`agenda-item ${c.status}`}>
                      <span className="mono">{slotTime(c.slots)}</span>
                      <span><b>{c.batch}</b> · {c.subject}{c.venue && <span className="muted"> · {c.venue}</span>}</span>
                      <span className="agenda-tags">
                        {c.role !== 'covered' && <span className="pill-tag grey">{c.role === 'main' ? 'Main' : 'Support'}</span>}
                        {STATUS[c.status] && <span className={`pill-tag ${c.status === 'covering' ? '' : 'warn'}`}>{STATUS[c.status]}</span>}
                      </span>
                      {c.note && <span className="muted agenda-note">{c.note}</span>}
                    </div>
                  ))}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="card span-5">
          <h2>Notices</h2>
          <p className="sub">Timetable emails sent to you.</p>
          {!me.notices.length ? <EmptyState title="No notices yet" /> : (
            <ul className="feed">
              {me.notices.map((n, i) => (
                <li key={i}>
                  <span className="feed-when">{new Date(n.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                  <span className="feed-what">{n.context}{n.status !== 'sent' && <span className="muted"> ({n.status})</span>}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
