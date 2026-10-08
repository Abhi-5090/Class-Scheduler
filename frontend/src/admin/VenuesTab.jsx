import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { announceChange } from './Console.jsx';
import { Modal, PageHead, Field, Notice, EmptyState, Spinner } from './ui.jsx';

const blank = { name: '', capacity: 0, active: true };

export default function VenuesTab() {
  const [rows, setRows] = useState(null);
  const [batches, setBatches] = useState([]);
  const [editing, setEditing] = useState(null);
  const [snapshot, setSnapshot] = useState('');   // the form as opened, to tell if it changed
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const open = draft => { setError(''); setEditing(draft); setSnapshot(JSON.stringify(draft)); };
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  const reload = async () => {
    try {
      const [v, b] = await Promise.all([api.list('venues'), api.list('batches')]);
      setRows(v);
      setLoadError(''); setBatches(b);
    } catch (e) { setLoadError(e.message); }
  };
  useEffect(() => { reload(); }, []);

  const flash = msg => { setOk(msg); setError(''); setTimeout(() => setOk(''), 2600); };

  const users = name => (batches || []).filter(b => (b.sessions || []).some(s => s.venue === name));

  async function save() {
    if (saving) return;                         // a second click while the first is in flight
    setSaving(true);
    setError('');
    try {
      const body = { name: editing.name, capacity: Number(editing.capacity) || 0, active: editing.active };
      if (editing._id) await api.update('venues', editing._id, body);
      else await api.create('venues', body);
      setEditing(null);
      await reload();
      announceChange();
      flash(editing._id ? `Saved ${editing.name}` : `Added ${editing.name}`);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function remove(v) {
    const held = users(v.name);
    const sessionCount = held.reduce((n, b) => n + (b.sessions || []).filter(s => s.venue === v.name).length, 0);
    const extra = held.length
      ? `\n\n${sessionCount} session(s) across ${held.length} batch(es) use this hall — they will be left without one:\n${held.map(b => `• ${b.name}`).join('\n')}`
      : '';
    if (!window.confirm(`Delete "${v.name}"?${extra}\n\nThis cannot be undone.`)) return;
    try {
      await api.remove('venues', v._id);
      await reload();
      announceChange();
      flash(`Deleted ${v.name}`);
    } catch (e) { setError(e.message); }
  }

  if (!rows) {
    return (
      <>
        <PageHead title="Training Halls" />
        {loadError
          ? <><Notice error={`Could not load: ${loadError}`} /><button className="btn btn-ghost" onClick={() => { setLoadError(''); reload(); }}>Try again</button></>
          : <Spinner />}
      </>
    );
  }

  return (
    <>
      <PageHead
        title="Training Halls"
        blurb="The rooms sessions run in. Each hall's occupancy on the board is worked out from the batches assigned to it, so it stays right on its own."
      >
        <button className="btn btn-primary" onClick={() => open({ ...blank })}>+ New hall</button>
      </PageHead>

      <Notice error={error || (loadError && `Could not refresh: ${loadError}`)} ok={ok} />

      <div className="card">
        {!rows.length ? (
          <EmptyState
            title="No halls yet"
            action={<button className="btn btn-primary" onClick={() => open({ ...blank })}>+ New hall</button>}
          >
            Add a hall, then pick it when you edit a batch.
          </EmptyState>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Hall</th><th>Capacity</th><th>Batches</th><th>Status</th><th className="act">Actions</th></tr>
              </thead>
              <tbody>
                {rows.map(v => {
                  const held = users(v.name);
                  return (
                    <tr key={v._id}>
                      <td className="nm">{v.name}</td>
                      <td className="mono">{v.capacity || '—'}</td>
                      <td className="muted" style={{ fontSize: 13 }}>
                        {held.length ? held.map(b => b.name).join(', ') : <span className="muted">none</span>}
                      </td>
                      <td>{v.active ? <span className="pill-tag">active</span> : <span className="pill-tag grey">hidden</span>}</td>
                      <td className="act">
                        <button className="btn btn-ghost btn-sm" onClick={() => open({ ...v })}>Edit</button>
                        <button className="btn btn-danger btn-sm" onClick={() => remove(v)}>Delete</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <Modal
          title={editing._id ? `Edit ${editing.name}` : 'New hall'}
          onClose={() => setEditing(null)}
          dirty={JSON.stringify(editing) !== snapshot}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={!editing.name.trim() || saving}>
                {editing._id ? 'Save changes' : 'Add hall'}
              </button>
            </>
          }
        >
          <Notice error={error} />

          <Field label="Hall name" help="Renaming moves every batch already in it.">
            <input
              autoFocus value={editing.name}
              placeholder="e.g. Examination Block · 2nd Floor Hall"
              onChange={e => setEditing({ ...editing, name: e.target.value })}
            />
          </Field>

          <Field label="Capacity" help="Optional. 0 hides it.">
            <input
              type="number" min="0" value={editing.capacity}
              onChange={e => setEditing({ ...editing, capacity: e.target.value })}
            />
          </Field>

          <Field help="Hidden halls stay in the database but drop off the public board.">
            <label className="check">
              <input
                type="checkbox"
                checked={editing.active}
                onChange={e => setEditing({ ...editing, active: e.target.checked })}
              />
              Show on the board
            </label>
          </Field>
        </Modal>
      )}
    </>
  );
}
