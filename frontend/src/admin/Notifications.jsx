import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { PageHead, Notice, Spinner, EmptyState } from './ui.jsx';

const STATUS = { '': 'All', sent: 'Sent', failed: 'Failed', skipped: 'Skipped', queued: 'Sending' };

/* Every timetable email the app tried to send, and what happened to it. */
export default function Notifications() {
  const [status, setStatus] = useState('');
  const [res, setRes] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true, timer;
    const load = () => api.notifications(status)
      .then(r => {
        if (!live) return;
        setRes(r); setError('');
        /* emails send in the background; check again only while some are still going */
        if (r.items.some(n => n.status === 'queued')) timer = setTimeout(load, 5000);
      })
      .catch(e => { if (live) { setError(e.message); timer = setTimeout(load, 15000); } });
    load();
    return () => { live = false; clearTimeout(timer); };
  }, [status]);

  return (
    <>
      <PageHead title="Notifications" blurb="Use “Save & notify trainers” on a batch, assigned work or an exception to email every trainer it affects. Each email and its outcome is listed here." />

      {res && !res.configured && (
        <div className="admin-hint">
          Email is not configured yet, so notifications are logged as “skipped”. Set <span className="mono">SMTP_HOST</span>, <span className="mono">SMTP_PORT</span>,
          <span className="mono"> SMTP_USER</span>, <span className="mono">SMTP_PASS</span> and <span className="mono">MAIL_FROM</span> in the backend <span className="mono">.env</span>, then send a test from Settings.
        </div>
      )}

      <div className="admin-filter-bar">
        {Object.entries(STATUS).map(([k, v]) => (
          <button key={k} type="button" className={`btn btn-sm ${status === k ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={status === k} onClick={() => setStatus(k)}>{v}</button>
        ))}
      </div>

      <Notice error={error} />
      {!res ? <Spinner /> : !res.items.length ? <EmptyState title="No emails yet">Notifications appear here once someone saves with “Save & notify trainers”.</EmptyState> : (
        <div className="card">
          <div className="tbl-wrap">
            <table className="tbl stack">
              <caption className="sr-only">Notification emails</caption>
              <thead><tr><th>When</th><th>To</th><th>About</th><th>Status</th><th>By</th></tr></thead>
              <tbody>
                {res.items.map(n => (
                  <tr key={n._id}>
                    <td className="mono" data-label="When">{new Date(n.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                    <td data-label="To"><b>{n.trainer || n.to}</b>{n.trainer && <div className="muted" style={{ fontSize: 12 }}>{n.to || 'no email address'}</div>}</td>
                    <td data-label="About">{n.context}</td>
                    <td data-label="Status">
                      <span className={`pill-tag ${n.status === 'sent' ? '' : n.status === 'failed' ? 'warn' : 'grey'}`}>{STATUS[n.status]}</span>
                      {n.reason && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{n.reason}</div>}
                    </td>
                    <td className="muted" data-label="By">{n.by || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
