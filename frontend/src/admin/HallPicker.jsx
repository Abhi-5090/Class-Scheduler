import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { Field } from './ui.jsx';

const SHORT = {
  Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed',
  Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun',
};
const shortDay = d => SHORT[d] || d.slice(0, 3);

/* "Mon 9:00–9:50 · AI Ready 2028 · Batch-1" */
const describe = c => `${shortDay(c.day)} ${c.slot} · ${c.batch}`;

/*
 * A hall has to be free at *every* one of the batch's session times to be worth
 * assigning, so this asks about all of them at once rather than one session at
 * a time. An occupied hall is marked with what holds it; the server refuses
 * to save a double-booking, so this is the early warning.
 */
export default function HallPicker({ venues, sessions, value, batchId, range = {}, onChange, scope = 'batch' }) {
  const [state, setState] = useState({ loading: false, venues: [], failed: false });

  /* only sessions that are actually pinned down can be checked */
  const when = useMemo(
    () => (sessions || [])
      .filter(s => s.day && (s.slots || []).length)
      .map(s => ({ day: s.day, slots: s.slots })),
    [sessions],
  );

  const key = JSON.stringify([when, range.from || '', range.to || '']);
  useEffect(() => {
    if (!when.length) { setState({ loading: false, venues: [] }); return; }
    let live = true;
    setState(s => ({ ...s, loading: true }));
    const t = setTimeout(() => {
      api.availability(when, batchId, range)
        .then(r => { if (live) setState({ loading: false, venues: r.venues, failed: false }); })
        .catch(() => { if (live) setState({ loading: false, venues: [], failed: true }); });
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [key, batchId]);                 // eslint-disable-line react-hooks/exhaustive-deps

  const byName = Object.fromEntries(state.venues.map(v => [v.name, v]));
  const chosen = value ? byName[value] : null;
  const known = state.venues.length > 0;

  const freeCount = state.venues.filter(v => v.free).length;

  const noun = scope === 'session' ? 'this session' : "this batch's session times";
  const help = !when.length
    ? (scope === 'session'
        ? 'Set a day and periods above and the halls free at that time will be listed here.'
        : 'Set a day and periods on the sessions below and the halls free at those times will be listed here.')
    : state.loading
      ? 'Checking which halls are free…'
      : known
        ? `${freeCount} of ${state.venues.length} halls are free at ${noun}.`
        : 'Could not read hall occupancy.';

  return (
    <>
      {state.failed && <div className="admin-hint">Could not check hall availability — saving will still refuse a double-booking.</div>}
      <Field label="Training hall" help={help}>
        <select value={value} onChange={e => onChange(e.target.value)}>
          <option value="">Not assigned yet</option>
          {venues.map(v => {
            const info = byName[v.name];
            const tail = !info ? '' : info.free ? ' — free' : ` — busy (${info.conflicts.length})`;
            return <option key={v._id} value={v.name}>{v.name}{tail}</option>;
          })}
        </select>
      </Field>

      {chosen && !chosen.free && (
        <div className="conflict" style={{ marginTop: -4, marginBottom: 16 }}>
          <h3>{value} is already in use at {chosen.conflicts.length === 1 ? 'this time' : 'these times'}</h3>
          <ul>{chosen.conflicts.map((c, i) => <li key={i}>{describe(c)}</li>)}</ul>
        </div>
      )}

      {known && !!when.length && (
        <Field label={scope === 'session' ? 'Hall availability at this time' : "Hall availability at this batch's times"}>
          <div className="halls">
            {state.venues.map(v => (
              <button
                type="button"
                key={v.name}
                className={`hall ${v.free ? 'free' : 'taken'} ${v.name === value ? 'on' : ''}`}
                onClick={() => onChange(v.name === value ? '' : v.name)}
                title={v.free ? 'Free — click to assign' : v.conflicts.map(describe).join('\n')}
              >
                <span className="hn">{v.name}</span>
                <span className="hs">
                  {v.name === value && <b>assigned</b>}
                  {v.free
                    ? (scope === 'session' ? 'free' : 'free at all times')
                    : v.conflicts.map(describe).join(' · ')}
                </span>
              </button>
            ))}
          </div>
        </Field>
      )}
    </>
  );
}
