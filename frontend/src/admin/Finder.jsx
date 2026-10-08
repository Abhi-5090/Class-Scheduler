import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { PageHead, Field, Notice, Spinner, EmptyState } from './ui.jsx';

const isoToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/*
 * "Who is free, and which hall is free, at this time?"
 * By date: that real day, with batch dates, holidays, cancellations and
 * substitutions applied. By weekday: the weekly timetable as it runs now.
 * Assigned work (lunch, design work …) counts as busy.
 */
export default function Finder() {
  const [config, setConfig] = useState(null);
  const [mode, setMode] = useState('date');
  const [date, setDate] = useState(isoToday());
  const [day, setDay] = useState('');
  const [slots, setSlots] = useState([]);
  const [track, setTrack] = useState('all');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.config().then(c => { setConfig(c); setDay(c.days[0]); }).catch(e => setError(e.message));
  }, []);

  const params = useMemo(() => {
    if (!slots.length || (mode === 'date' && !date)) return null;
    return mode === 'date' ? { date, slots: slots.join(',') } : { day, slots: slots.join(',') };
  }, [mode, date, day, slots]);

  useEffect(() => {
    if (!params) { setResult(null); return undefined; }
    let live = true;
    setBusy(true); setError('');
    api.finder(params)
      .then(r => { if (live) setResult(r); })
      .catch(e => { if (live) setError(e.message); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [params]);

  if (!config) return <><PageHead title="Free Finder" />{error ? <Notice error={error} /> : <Spinner />}</>;

  const toggle = i => setSlots(s => (s.includes(i) ? s.filter(x => x !== i) : [...s, i].sort((a, b) => a - b)));
  const trainers = (result?.trainers || []).filter(t => track === 'all' || t.track === track);
  const freeT = trainers.filter(t => t.free), busyT = trainers.filter(t => !t.free);
  const freeH = (result?.halls || []).filter(h => h.free), busyH = (result?.halls || []).filter(h => !h.free);
  const when = result ? `${result.date ? new Date(`${result.date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) : `Every ${result.day}`} · slot ${slots.map(i => i + 1).join(', ')}` : '';

  return (
    <>
      <PageHead
        title="Free Finder"
        blurb="Find a free trainer or a free hall for a period. Pick a real date to include holidays, cancellations and substitutions, or a weekday to check the regular timetable."
      />

      <div className="card finder-form">
        <div className="card-row">
          <Field label="Check">
            <div className="mode-toggle" role="group" aria-label="Check by date or weekday">
              <button type="button" className={`mode-btn ${mode === 'date' ? 'on' : ''}`} aria-pressed={mode === 'date'} onClick={() => setMode('date')}>A date</button>
              <button type="button" className={`mode-btn ${mode === 'day' ? 'on' : ''}`} aria-pressed={mode === 'day'} onClick={() => setMode('day')}>Every week</button>
            </div>
          </Field>
          {mode === 'date' ? (
            <Field label="Date"><input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
          ) : (
            <Field label="Weekday">
              <select value={day} onChange={e => setDay(e.target.value)}>{config.days.map(d => <option key={d}>{d}</option>)}</select>
            </Field>
          )}
          <Field label="Trainers">
            <select value={track} onChange={e => setTrack(e.target.value)}>
              <option value="all">All trainers</option>
              <option value="teaching">Teaching only</option>
              <option value="non-teaching">Non-Teaching only</option>
            </select>
          </Field>
        </div>
        <Field label="Periods" help="Pick one or more — a trainer or hall must be free for all of them.">
          <div className="slotpick">
            {config.slots.map((s, i) => (
              <button key={i} type="button" className={`${slots.includes(i) ? 'on' : ''} ${i === config.lunchIndex ? 'lunchy' : ''}`}
                aria-pressed={slots.includes(i)} onClick={() => toggle(i)}>
                {i + 1}<span className="t">{s}</span>
              </button>
            ))}
          </div>
        </Field>
      </div>

      <Notice error={error} />

      {!slots.length ? (
        <EmptyState title="Pick a period to start">Results appear as soon as you choose a period.</EmptyState>
      ) : !result ? <Spinner /> : (
        <div className={busy ? 'is-refreshing' : ''}>
          <p className="finder-when">{when}</p>
          {result.holiday && <div className="admin-hint">Holiday — {result.holiday.label}. No classes run, so everyone is free.</div>}
          {!result.holiday && result.date && !result.teachingDay && <div className="admin-hint">{result.day} is not a teaching day — no classes are scheduled.</div>}

          <div className="dash-grid">
            <section className="card span-6">
              <h2>Trainers <span className="count-chip">{freeT.length} free</span></h2>
              <p className="sub">Free trainers are listed lightest weekly load first.</p>
              {!freeT.length ? <EmptyState title="Nobody is free at that time" /> : (
                <ul className="finder-list">
                  {freeT.map(t => (
                    <li key={t.name}>
                      <span className="free-dot" aria-hidden="true" />
                      <b>{t.name}</b>
                      <span className={`mini-track ${t.track}`}>{t.track === 'teaching' ? 'Teaching' : 'Non-Teaching'}</span>
                      <span className="muted finder-meta">{t.weeklyLoad} period{t.weeklyLoad === 1 ? '' : 's'} / week</span>
                    </li>
                  ))}
                </ul>
              )}
              {!!busyT.length && (
                <details className="finder-busy">
                  <summary>{busyT.length} busy</summary>
                  <ul className="finder-list">
                    {busyT.map(t => <li key={t.name}><span className="busy-dot" aria-hidden="true" /><b>{t.name}</b><span className="muted finder-meta">{t.busyWith}</span></li>)}
                  </ul>
                </details>
              )}
            </section>

            <section className="card span-6">
              <h2>Halls <span className="count-chip">{freeH.length} free</span></h2>
              <p className="sub">Capacity shown where it is recorded.</p>
              {!freeH.length ? <EmptyState title="Every hall is in use at that time" /> : (
                <ul className="finder-list">
                  {freeH.map(h => (
                    <li key={h.name}><span className="free-dot" aria-hidden="true" /><b>{h.name}</b>{!!h.capacity && <span className="muted finder-meta">{h.capacity} seats</span>}</li>
                  ))}
                </ul>
              )}
              {!!busyH.length && (
                <details className="finder-busy">
                  <summary>{busyH.length} in use</summary>
                  <ul className="finder-list">
                    {busyH.map(h => <li key={h.name}><span className="busy-dot" aria-hidden="true" /><b>{h.name}</b><span className="muted finder-meta">{h.busyWith}</span></li>)}
                  </ul>
                </details>
              )}
            </section>
          </div>
        </div>
      )}
    </>
  );
}
