import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { calculateUniqueStudents } from '../lib/studentStats.js';
import { PageHead, Spinner, Notice, EmptyState } from './ui.jsx';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.schedule().then(setData).catch(e => setError(e.message));
    const refresh = () => api.schedule().then(setData).catch(() => {});
    addEventListener('schedule:changed', refresh);
    return () => removeEventListener('schedule:changed', refresh);
  }, []);

  if (error) return <><PageHead title="Dashboard" /><Notice error={error} /></>;
  if (!data) return <><PageHead title="Dashboard" /><Spinner /></>;

  const students = calculateUniqueStudents(data.batches);
  const sessions = data.batches.reduce((s, b) => s + b.rows.length, 0);
  const unassigned = data.batches.filter(b => b.rows.some(r => !r.mainList.length));
  const noVenue = data.batches.filter(b => b.rows.some(r => !r.venue));

  return (
    <>
      <PageHead
        title="Dashboard"
        blurb="Everything the public board shows is derived from what you enter here. Batch sessions are the single source of truth — the trainer and hall timetables are calculated from them."
      />

      <div className="mini-stats">
        {[
          [data.batches.length, 'Batches'],
          [sessions, 'Weekly sessions'],
          [data.trainers.length, 'Trainers'],
          [data.venues.length, 'Training halls'],
          [students.toLocaleString(), 'Students'],
          [data.groups.length + data.upcoming.length, 'Year groups'],
        ].map(([n, l]) => (
          <div className="mini" key={l}><div className="n">{n}</div><div className="l">{l}</div></div>
        ))}
      </div>

      {!!data.conflicts.length && (
        <div className="conflict">
          <h3>{data.conflicts.length} scheduling clash{data.conflicts.length > 1 ? 'es' : ''} to resolve</h3>
          <ul>
            {data.conflicts.map((c, i) => (
              <li key={i}>
                {c.kind === 'trainer' ? <b>{c.subject}</b> : <b>{c.subject}</b>}
                {c.kind === 'trainer' ? ' is booked twice' : ' is double-booked'} on {c.day} at {c.slot} — {c.batches.join(' and ')}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <h2>Needs attention</h2>
        <p className="sub">Sessions that are on the board but not yet fully staffed or placed.</p>

        {!unassigned.length && !noVenue.length ? (
          <EmptyState title="Everything is assigned">
            Every session has a mentor and every batch has a hall.
          </EmptyState>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Batch</th><th>Year</th><th>Missing</th><th className="act">—</th></tr>
              </thead>
              <tbody>
                {[...new Set([...unassigned, ...noVenue])].map(b => {
                  const gaps = [];
                  if (b.rows.some(r => !r.mainList.length)) gaps.push('main mentor');
                  if (b.rows.some(r => !r.venue)) gaps.push('training hall');
                  return (
                    <tr key={b.id}>
                      <td className="nm">{b.name}</td>
                      <td className="muted">{b.group}</td>
                      <td>{gaps.map(g => <span className="pill-tag warn" key={g} style={{ marginRight: 6 }}>{g}</span>)}</td>
                      <td className="act">
                        <Link className="btn btn-ghost btn-sm" to="/admin/batches">Open</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Year groups on the board</h2>
        <p className="sub">Ordering here is the ordering the public board uses.</p>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Year</th><th>Batches</th><th>Status</th></tr></thead>
            <tbody>
              {data.groups.map(g => (
                <tr key={g.group}>
                  <td className="nm">{g.group}</td>
                  <td className="mono">{g.batches.length}</td>
                  <td><span className="pill-tag">live</span></td>
                </tr>
              ))}
              {data.upcoming.map(u => (
                <tr key={u.group}>
                  <td className="nm">{u.group}</td>
                  <td className="mono">0</td>
                  <td><span className="pill-tag grey">awaiting schedule</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
