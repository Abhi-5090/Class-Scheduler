import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAdmin } from '../lib/useAdmin.js';
import { useFeedback } from '../lib/feedback.jsx';
import { Modal, PageHead, Field, Notice, Spinner, EmptyState, useTable, SortTh, SearchBox } from './ui.jsx';

const ROLE = {
  admin: { label: 'Admin', help: 'Everything: accounts, change history, time slots, trainers, halls and the timetable.' },
  coordinator: { label: 'Coordinator', help: 'Builds the timetable: batches, sessions, assigned work, holidays, imports and notifications.' },
  trainer: { label: 'Trainer', help: 'Signs in to see their own timetable, upcoming changes and notices. Read-only.' },
};
const blank = { email: '', name: '', role: 'coordinator', trainerId: '' };

/*
 * Who can sign in, and what they may do. New accounts and password resets get
 * a one-time temporary password that must be changed at the next sign-in.
 */
export default function UsersTab() {
  const { user: me } = useAdmin();
  const { toast, confirm } = useFeedback();
  const [rows, setRows] = useState(null);
  const [trainers, setTrainers] = useState([]);
  const [editing, setEditing] = useState(null);
  const [secret, setSecret] = useState(null);       // { email, password } shown once
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const reload = () => Promise.all([api.users(), api.list('trainers')]).then(([u, t]) => { setRows(u); setTrainers(t); }).catch(e => setError(e.message));
  useEffect(() => { reload(); }, []);

  const table = useTable(rows, {
    text: u => `${u.email} ${u.name} ${u.role} ${u.trainerName || ''}`,
    sorts: { email: u => u.email, role: u => ['admin', 'coordinator', 'trainer'].indexOf(u.role), last: u => u.lastLoginAt || '', status: u => (u.active ? 0 : 1) },
    initial: 'role',
  });

  if (!rows) return <><PageHead title="Users & Roles" />{error ? <Notice error={error} /> : <Spinner />}</>;

  const linked = new Set(rows.filter(u => u.trainerId).map(u => u.trainerId));

  async function save() {
    if (saving) return;
    setSaving(true); setError('');
    try {
      const d = editing;
      if (d._id) {
        await api.updateUser(d._id, { name: d.name, role: d.role, trainerId: d.role === 'trainer' ? d.trainerId : null, active: d.active });
        toast(`Saved ${d.email}`);
      } else {
        const r = await api.createUser({ email: d.email, name: d.name, role: d.role, trainerId: d.role === 'trainer' ? d.trainerId : undefined });
        setSecret({ email: d.email, password: r.temporaryPassword });
      }
      setEditing(null);
      await reload();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function reset(u) {
    const ok = await confirm({
      title: `Reset ${u.email}'s password?`,
      body: <p>They are signed out everywhere and get a new temporary password, which they must change when they next sign in.</p>,
      confirmLabel: 'Reset password',
    });
    if (!ok) return;
    try {
      const r = await api.updateUser(u._id, { resetPassword: true });
      setSecret({ email: u.email, password: r.temporaryPassword });
      await reload();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function remove(u) {
    const ok = await confirm({
      title: `Delete ${u.email}?`,
      body: <p>They lose access immediately. Their past changes stay in the change history. To pause access instead, edit the account and untick Active.</p>,
      confirmLabel: 'Delete account', danger: true,
    });
    if (!ok) return;
    try { await api.deleteUser(u._id); toast(`Deleted ${u.email}`); await reload(); } catch (e) { toast(e.message, 'error'); }
  }

  const d = editing;
  const canSave = d && (d._id || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) && (d.role !== 'trainer' || d.trainerId);

  return (
    <>
      <PageHead title="Users & Roles" blurb="Admins run everything, coordinators set the timetable, trainers see their own schedule. Every change here is recorded in the change history.">
        <button className="btn btn-primary" onClick={() => { setError(''); setEditing({ ...blank }); }}>+ New account</button>
      </PageHead>

      <div className="role-cards">
        {Object.entries(ROLE).map(([k, r]) => (
          <div key={k} className="role-card"><b>{r.label}</b><span>{r.help}</span><em>{rows.filter(u => u.role === k).length} account{rows.filter(u => u.role === k).length === 1 ? '' : 's'}</em></div>
        ))}
      </div>

      <div className="card">
        <div className="admin-filter-bar">
          <SearchBox value={table.query} onChange={table.setQuery} label="Search accounts" placeholder="Search email, name, trainer…" />
        </div>
        {!table.rows.length ? <EmptyState title="No accounts match" /> : (
          <div className="tbl-wrap">
            <table className="tbl stack">
              <caption className="sr-only">Accounts and their roles</caption>
              <thead>
                <tr>
                  <SortTh label="Account" k="email" table={table} />
                  <SortTh label="Role" k="role" table={table} />
                  <th>Trainer</th>
                  <SortTh label="Last sign-in" k="last" table={table} />
                  <SortTh label="Status" k="status" table={table} />
                  <th className="act"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {table.rows.map(u => (
                  <tr key={u._id}>
                    <td className="nm" data-label="Account">{u.email}{u.name && <div className="muted" style={{ fontWeight: 400, fontSize: 12 }}>{u.name}</div>}</td>
                    <td data-label="Role"><span className={`pill-tag ${u.role === 'admin' ? 'alt' : u.role === 'trainer' ? 'grey' : ''}`}>{ROLE[u.role].label}</span></td>
                    <td className="muted" data-label="Trainer">{u.trainerName || '—'}</td>
                    <td className="muted" data-label="Last sign-in">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never'}</td>
                    <td data-label="Status">
                      {!u.active ? <span className="pill-tag grey">deactivated</span> : u.mustChangePassword ? <span className="pill-tag warn">temporary password</span> : <span className="pill-tag">active</span>}
                    </td>
                    <td className="act">
                      <button className="btn btn-ghost btn-sm" onClick={() => { setError(''); setEditing({ ...u }); }} aria-label={`Edit ${u.email}`}>Edit</button>
                      {u.email !== me?.email && <button className="btn btn-ghost btn-sm" onClick={() => reset(u)} aria-label={`Reset password for ${u.email}`}>Reset password</button>}
                      {u.email !== me?.email && <button className="btn btn-danger btn-sm" onClick={() => remove(u)} aria-label={`Delete ${u.email}`}>Delete</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {d && (
        <Modal
          title={d._id ? `Edit ${d.email}` : 'New account'}
          sub={d._id ? 'Changing the role or deactivating signs the person out straight away.' : 'A temporary password is created and shown once; they change it at first sign-in.'}
          onClose={() => setEditing(null)}
          dirty
          footer={<>
            <button className="btn btn-ghost" onClick={() => setEditing(null)} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={!canSave || saving}>{saving ? 'Saving…' : d._id ? 'Save changes' : 'Create account'}</button>
          </>}
        >
          <Notice error={error} />
          {!d._id && (
            <Field label="Email" help="They sign in with this.">
              <input type="email" autoComplete="off" value={d.email} maxLength={254} onChange={e => setEditing({ ...d, email: e.target.value.trim() })} />
            </Field>
          )}
          <Field label="Name (optional)"><input value={d.name} maxLength={120} onChange={e => setEditing({ ...d, name: e.target.value })} /></Field>
          <Field label="Role">
            <div className="track-radio-group" role="radiogroup" aria-label="Role">
              {Object.entries(ROLE).map(([k, r]) => (
                <label key={k} className={`track-radio-btn ${d.role === k ? 'active' : ''}`}>
                  <input type="radio" name="role" value={k} checked={d.role === k} disabled={d.email === me?.email}
                    onChange={() => setEditing({ ...d, role: k })} />
                  <span>{r.label}</span>
                </label>
              ))}
            </div>
            <div className="help">{ROLE[d.role].help}{d.email === me?.email ? ' You cannot change your own role.' : ''}</div>
          </Field>
          {d.role === 'trainer' && (
            <Field label="Trainer" help="The timetable this account sees.">
              <select value={d.trainerId || ''} onChange={e => setEditing({ ...d, trainerId: e.target.value })}>
                <option value="">Choose…</option>
                {trainers.filter(t => !linked.has(t._id) || t._id === d.trainerId).map(t => <option key={t._id} value={t._id}>{t.name}</option>)}
              </select>
            </Field>
          )}
          {d._id && d.email !== me?.email && (
            <Field>
              <label className="check">
                <input type="checkbox" checked={d.active} onChange={e => setEditing({ ...d, active: e.target.checked })} />
                Active — untick to stop this account signing in
              </label>
            </Field>
          )}
        </Modal>
      )}

      {secret && (
        <Modal title="Temporary password" sub="Shown only this once. Share it privately — they must change it at first sign-in." onClose={() => {}}
          footer={<button className="btn btn-primary" onClick={() => setSecret(null)}>I have saved it — done</button>}>
          <Field label={secret.email}>
            <div className="secret-row">
              <input readOnly value={secret.password} className="mono" onFocus={e => e.target.select()} aria-label="Temporary password" />
              <button className="btn btn-ghost" onClick={() => navigator.clipboard?.writeText(secret.password).then(() => toast('Copied'), () => toast('Copy it manually', 'error'))}>Copy</button>
            </div>
          </Field>
        </Modal>
      )}
    </>
  );
}
