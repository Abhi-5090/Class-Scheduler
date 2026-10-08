import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useFeedback } from '../lib/feedback.jsx';
import { PageHead, Field, Notice, Spinner, EmptyState, SearchBox } from './ui.jsx';

const ENTITIES = { '': 'Everything', batch: 'Batches', trainer: 'Trainers', venue: 'Halls', group: 'Year groups', activity: 'Assigned work', exception: 'Holidays & exceptions', config: 'Time slots', user: 'Accounts', auth: 'Sign-ins', notification: 'Emails' };
const ACTIONS = { '': 'Any action', create: 'Created', update: 'Changed', delete: 'Deleted', import: 'Imported', login: 'Signed in', login_failed: 'Failed sign-in', password: 'Password change', notify: 'Email' };
const when = d => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/*
 * The complete change history — who changed what, when, and from what to what.
 * Admin only. Filters run on the server; export takes the current filter.
 */
export default function History() {
  const { toast } = useFeedback();
  const [f, setF] = useState({ entity: '', action: '', actor: '', from: '', to: '', q: '' });
  const [page, setPage] = useState(1);
  const [res, setRes] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);

  const params = () => Object.fromEntries(Object.entries({ ...f, page, limit: 50 }).filter(([, v]) => v !== '' && v !== null));

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      api.audit(params()).then(r => { if (live) { setRes(r); setError(''); } }).catch(e => { if (live) setError(e.message); });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [f, page]);   // eslint-disable-line react-hooks/exhaustive-deps

  const set = patch => { setF(x => ({ ...x, ...patch })); setPage(1); };

  async function exportIt(format) {
    try {
      const r = await api.audit({ ...params(), page: 1, limit: 500 });
      const { download } = await import('../lib/sheets.js');
      await download(r.items.map(i => ({
        at: when(i.at), who: i.actor?.email || '', role: i.actor?.role || '', action: ACTIONS[i.action] || i.action,
        what: ENTITIES[i.entity] || i.entity, name: i.name, summary: i.summary,
        changes: (i.changes || []).map(c => `${c.field}: ${c.from} → ${c.to}`).join(' | '), ip: i.ip,
      })), [
        { key: 'at', label: 'When' }, { key: 'who', label: 'Who' }, { key: 'role', label: 'Role' }, { key: 'action', label: 'Action' },
        { key: 'what', label: 'Area' }, { key: 'name', label: 'Item' }, { key: 'summary', label: 'Summary' }, { key: 'changes', label: 'Changes' }, { key: 'ip', label: 'IP' },
      ], 'Change_history', format);
      toast(r.total > 500 ? 'Downloaded the latest 500 entries — narrow the filter for older ones' : 'Change history downloaded');
    } catch (e) { toast(e.message, 'error'); }
  }

  return (
    <>
      <PageHead title="Change History" blurb="Every create, change, delete, import and sign-in, with who did it and exactly what changed.">
        <button className="btn-pdf" onClick={() => exportIt('xlsx')}>Export Excel</button>
        <button className="btn-pdf" onClick={() => exportIt('csv')}>Export CSV</button>
      </PageHead>

      <div className="card">
        <div className="card-row history-filters">
          <Field label="Area"><select value={f.entity} onChange={e => set({ entity: e.target.value })}>{Object.entries(ENTITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Action"><select value={f.action} onChange={e => set({ action: e.target.value })}>{Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="By (email)"><input value={f.actor} maxLength={254} onChange={e => set({ actor: e.target.value.trim() })} placeholder="anyone" /></Field>
          <Field label="From"><input type="date" value={f.from} onChange={e => set({ from: e.target.value })} /></Field>
          <Field label="To"><input type="date" value={f.to} onChange={e => set({ to: e.target.value })} /></Field>
        </div>
        <SearchBox value={f.q} onChange={q => set({ q })} label="Search the change history" placeholder="Search names, summaries and values…" />
      </div>

      <Notice error={error} />
      {!res ? <Spinner /> : !res.items.length ? <EmptyState title="Nothing matches">Try a wider date range or another area.</EmptyState> : (
        <div className="card">
          <p className="sub">{res.total.toLocaleString()} entr{res.total === 1 ? 'y' : 'ies'} · page {res.page} of {res.pages}</p>
          <ol className="history">
            {res.items.map(i => (
              <li key={i._id} className={`h-${i.action}`}>
                <button type="button" className="h-row" aria-expanded={open === i._id} onClick={() => setOpen(open === i._id ? null : i._id)}>
                  <span className="h-when">{when(i.at)}</span>
                  <span className={`h-action ${i.action}`}>{ACTIONS[i.action] || i.action}</span>
                  <span className="h-what"><b>{i.name || ENTITIES[i.entity]}</b>{i.summary && <span className="muted"> — {i.summary}</span>}</span>
                  <span className="h-who">{i.actor?.email || 'unknown'}{i.actor?.role ? ` · ${i.actor.role}` : ''}</span>
                </button>
                {open === i._id && (
                  <div className="h-detail">
                    {!i.changes?.length ? <p className="muted">No field-level detail for this entry.</p> : (
                      <table className="tbl">
                        <thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
                        <tbody>{i.changes.map((c, k) => <tr key={k}><td className="nm">{c.field}</td><td className="mono">{c.from}</td><td className="mono">{c.to}</td></tr>)}</tbody>
                      </table>
                    )}
                    <p className="muted" style={{ fontSize: 12 }}>{ENTITIES[i.entity] || i.entity}{i.ip ? ` · from ${i.ip}` : ''}</p>
                  </div>
                )}
              </li>
            ))}
          </ol>
          <div className="pager">
            <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Newer</button>
            <span className="muted">Page {res.page} of {res.pages}</span>
            <button className="btn btn-ghost btn-sm" disabled={page >= res.pages} onClick={() => setPage(p => p + 1)}>Older →</button>
          </div>
        </div>
      )}
    </>
  );
}
