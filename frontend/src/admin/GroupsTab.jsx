import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { announceChange } from './Console.jsx';
import { Modal, PageHead, Field, Notice, EmptyState, Spinner } from './ui.jsx';

const blank = { name: '', order: 0, pending: false, note: '' };

export default function GroupsTab() {
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
      const [g, b] = await Promise.all([api.list('groups'), api.list('batches')]);
      setRows(g);
      setLoadError(''); setBatches(b);
    } catch (e) { setLoadError(e.message); }
  };
  useEffect(() => { reload(); }, []);

  const flash = msg => { setOk(msg); setError(''); setTimeout(() => setOk(''), 2600); };
  const held = name => batches.filter(b => b.group === name);

  async function save() {
    if (saving) return;                         // a second click while the first is in flight
    setSaving(true);
    setError('');
    try {
      const body = {
        name: editing.name, order: Number(editing.order) || 0,
        pending: editing.pending, note: editing.note,
      };
      if (editing._id) await api.update('groups', editing._id, body);
      else await api.create('groups', body);
      setEditing(null);
      await reload();
      announceChange();
      flash(editing._id ? `Saved ${editing.name}` : `Added ${editing.name}`);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function remove(g) {
    if (!window.confirm(`Delete "${g.name}"?\n\nThis cannot be undone.`)) return;
    try {
      await api.remove('groups', g._id);
      await reload();
      announceChange();
      flash(`Deleted ${g.name}`);
    } catch (e) { setError(e.message); }
  }

  /* Order is what the board reads top to bottom, so nudging beats typing. */
  async function move(g, dir) {
    const sorted = [...rows].sort((a, b) => a.order - b.order);
    const i = sorted.findIndex(x => x._id === g._id);
    const j = i + dir;
    if (j < 0 || j >= sorted.length) return;
    try {
      await Promise.all([
        api.update('groups', sorted[i]._id, { order: sorted[j].order }),
        api.update('groups', sorted[j]._id, { order: sorted[i].order }),
      ]);
      await reload();
      announceChange();
    } catch (e) { setError(e.message); }
  }

  if (!rows) {
    return (
      <>
        <PageHead title="Year Groups" />
        {loadError
          ? <><Notice error={`Could not load: ${loadError}`} /><button className="btn btn-ghost" onClick={() => { setLoadError(''); reload(); }}>Try again</button></>
          : <Spinner />}
      </>
    );
  }

  const sorted = [...rows].sort((a, b) => a.order - b.order);

  return (
    <>
      <PageHead
        title="Year Groups"
        blurb="The year bands the board is split into, in the order they appear. A group marked as awaiting its schedule shows the “will be updated soon” card instead of batch cards."
      >
        <button
          className="btn btn-primary"
          onClick={() => open({ ...blank, order: (Math.max(-1, ...rows.map(r => r.order)) + 1) })}
        >
          + New year group
        </button>
      </PageHead>

      <Notice error={error || (loadError && `Could not refresh: ${loadError}`)} ok={ok} />

      <div className="card">
        {!sorted.length ? (
          <EmptyState
            title="No year groups yet"
            action={<button className="btn btn-primary" onClick={() => open({ ...blank })}>+ New year group</button>}
          >
            Batches belong to a year group, so add one before adding batches.
          </EmptyState>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Order</th><th>Year group</th><th>Batches</th><th>Status</th><th className="act">Actions</th></tr>
              </thead>
              <tbody>
                {sorted.map((g, i) => (
                  <tr key={g._id}>
                    <td>
                      <button className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => move(g, -1)} aria-label="Move up">↑</button>
                      <button className="btn btn-ghost btn-sm" style={{ marginLeft: 5 }} disabled={i === sorted.length - 1} onClick={() => move(g, 1)} aria-label="Move down">↓</button>
                    </td>
                    <td className="nm">{g.name}</td>
                    <td className="mono">{held(g.name).length}</td>
                    <td>
                      {g.pending
                        ? <span className="pill-tag grey">awaiting schedule</span>
                        : <span className="pill-tag">live</span>}
                    </td>
                    <td className="act">
                      <button className="btn btn-ghost btn-sm" onClick={() => open({ ...g })}>Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={() => remove(g)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <Modal
          title={editing._id ? `Edit ${editing.name}` : 'New year group'}
          onClose={() => setEditing(null)}
          dirty={JSON.stringify(editing) !== snapshot}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={!editing.name.trim() || saving}>
                {editing._id ? 'Save changes' : 'Add year group'}
              </button>
            </>
          }
        >
          <Notice error={error} />

          <Field label="Name" help="Renaming moves every batch in this group with it.">
            <input
              autoFocus value={editing.name}
              placeholder="e.g. Second Year"
              onChange={e => setEditing({ ...editing, name: e.target.value })}
            />
          </Field>

          <Field help="Tick this while a year has no schedule yet. Its batches, if any, are hidden until you untick it.">
            <label className="check">
              <input
                type="checkbox"
                checked={editing.pending}
                onChange={e => setEditing({ ...editing, pending: e.target.checked })}
              />
              Awaiting schedule
            </label>
          </Field>

          {editing.pending && (
            <Field label="Note on the card" help="Explains to anyone reading the board why this year is not up yet.">
              <textarea
                rows="3" value={editing.note}
                placeholder="Batch allocation and trainer mapping are being finalised for this year group."
                onChange={e => setEditing({ ...editing, note: e.target.value })}
              />
            </Field>
          )}
        </Modal>
      )}
    </>
  );
}
