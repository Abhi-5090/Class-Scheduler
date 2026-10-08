import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { announceChange } from './Console.jsx';
import { Modal, PageHead, Field, Notice, EmptyState, Spinner } from './ui.jsx';
import { useFeedback } from '../lib/feedback.jsx';

const blank = { name: '', order: 0, pending: false, note: '' };

export default function GroupsTab() {
  const { toast, confirm } = useFeedback();
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

  const flash = msg => { setError(''); toast(msg); };
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
    const using = held(g.name);
    if (using.length) {
      /* the API refuses this anyway; say so up front, and say what to do */
      await confirm({
        title: `${g.name} still has batches`,
        body: (
          <>
            <p><b>{using.length} batch{using.length === 1 ? '' : 'es'}</b> belong to this year group. Move them to another year, or delete them, before deleting the group:</p>
            <ul className="impact">{using.slice(0, 8).map(b => <li key={b._id}>{b.name}</li>)}{using.length > 8 && <li>…and {using.length - 8} more</li>}</ul>
          </>
        ),
        confirmLabel: 'OK',
        cancelLabel: 'Close',
      });
      return;
    }
    const sure = await confirm({
      title: `Delete "${g.name}"?`,
      body: <p>No batch uses this year group, so nothing else changes. This cannot be undone.</p>,
      confirmLabel: 'Delete year group',
      danger: true,
    });
    if (!sure) return;
    try {
      await api.remove('groups', g._id);
      await reload();
      announceChange();
      flash(`Deleted ${g.name}`);
    } catch (e) { toast(e.message, 'error'); }
  }

  /* Order is what the board reads top to bottom, so nudging beats typing. */
  async function move(g, dir) {
    const sorted = [...rows].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    const i = sorted.findIndex(x => x._id === g._id);
    const j = i + dir;
    if (j < 0 || j >= sorted.length) return;
    /* renumber the whole list 0..n so two groups sharing a number can still
       be told apart and moved */
    const next = [...sorted];
    [next[i], next[j]] = [next[j], next[i]];
    try {
      await Promise.all(next.map((x, k) => (x.order === k ? null : api.update('groups', x._id, { order: k }))));
      await reload();
      announceChange();
    } catch (e) { toast(e.message, 'error'); }
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

  const sorted = [...rows].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

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
            <table className="tbl stack">
              <caption className="sr-only">Year groups in board order</caption>
              <thead>
                <tr><th>Order</th><th>Year group</th><th>Batches</th><th>Status</th><th className="act">Actions</th></tr>
              </thead>
              <tbody>
                {sorted.map((g, i) => (
                  <tr key={g._id}>
                    <td data-label="Order">
                      <button className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => move(g, -1)} aria-label={`Move ${g.name} up`}>↑</button>
                      <button className="btn btn-ghost btn-sm" style={{ marginLeft: 5 }} disabled={i === sorted.length - 1} onClick={() => move(g, 1)} aria-label={`Move ${g.name} down`}>↓</button>
                    </td>
                    <td className="nm" data-label="Year group">{g.name}</td>
                    <td className="mono" data-label="Batches">{held(g.name).length}</td>
                    <td data-label="Status">
                      {g.pending
                        ? <span className="pill-tag grey">awaiting schedule</span>
                        : <span className="pill-tag">live</span>}
                    </td>
                    <td className="act">
                      <button className="btn btn-ghost btn-sm" onClick={() => open({ ...g })} aria-label={`Edit ${g.name}`}>Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={() => remove(g)} aria-label={`Delete ${g.name}`}>Delete</button>
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
                {saving ? 'Saving…' : editing._id ? 'Save changes' : 'Add year group'}
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
