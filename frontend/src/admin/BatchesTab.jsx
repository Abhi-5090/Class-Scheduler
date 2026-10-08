import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { announceChange } from './Console.jsx';
import { Modal, PageHead, Field, Notice, EmptyState, Spinner, useTable, SortTh, SearchBox } from './ui.jsx';
import { useFeedback } from '../lib/feedback.jsx';
import SessionEditor, { blankSession } from './SessionEditor.jsx';

import { exportBatchesPDF } from '../lib/pdf.js';
import { formatDateRange } from '../lib/calendarUtils.js';

/* Quick date ranges relative to today: this month, next month, and both. */
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function datePresets(now = new Date()) {
  const first = k => new Date(now.getFullYear(), now.getMonth() + k, 1);
  const last = k => new Date(now.getFullYear(), now.getMonth() + k + 1, 0);
  const name = (d, withYear = true) => d.toLocaleDateString('en-US', withYear ? { month: 'long', year: 'numeric' } : { month: 'short' });
  return [
    { label: name(first(0)), startDate: iso(first(0)), endDate: iso(last(0)) },
    { label: name(first(1)), startDate: iso(first(1)), endDate: iso(last(1)) },
    { label: `${name(first(0), false)} – ${name(first(1))}`, startDate: iso(first(0)), endDate: iso(last(1)) },
  ];
}

const emptyBatch = groups => ({
  name: '', group: groups[0]?.name || '', dept: '', count: 0,
  startDate: '', endDate: '',
  sessions: [blankSession()],
});

export default function BatchesTab() {
  const { toast, confirm } = useFeedback();
  const [params, setParams] = useSearchParams();
  const [batches, setBatches] = useState(null);
  const [groups, setGroups] = useState([]);
  const [trainers, setTrainers] = useState([]);
  const [venues, setVenues] = useState([]);
  const [config, setConfig] = useState(null);
  const [exporting, setExporting] = useState(false);

  const [editing, setEditing] = useState(null);   // the draft being edited, or null
  const [snapshot, setSnapshot] = useState('');  // the draft as opened, to tell if it changed
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');

  /* every session gets a stable key for React, so removing one in the middle
     does not hand its neighbour's clash lookup to the wrong row */
  const keyed = s => ({ ...s, _key: s._key || s._id || Math.random().toString(36).slice(2) });
  const open = draft => {
    const d = { ...draft, sessions: (draft.sessions || []).map(keyed) };
    setError('');
    setEditing(d);
    setSnapshot(JSON.stringify(d));
  };
  const dirty = !!editing && JSON.stringify(editing) !== snapshot;

  /* "Duplicate" starts a new batch from an existing one: same year, dates and
     session times, but no mentors or halls — the original already holds those
     at exactly these times, so a straight copy could never be saved. */
  const duplicate = b => {
    const { _id, createdAt, updatedAt, __v, order, ...rest } = structuredClone(b);
    open({
      ...rest,
      name: `${b.name} (copy)`,
      sessions: (rest.sessions || []).map(({ _id: sid, ...s }) => ({ ...s, mainTrainers: [], supportTrainers: [], venue: '' })),
    });
    toast('Copy ready — mentors and halls were cleared because the original uses them at these times.', 'success', 6000);
  };
  const [arrangingGroup, setArrangingGroup] = useState(null); // active year group name in arrange modal or null
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [filter, setFilter] = useState('All');

  const handleExportPDF = async () => {
    setExporting(true);
    try {
      const schedule = await api.schedule();
      await exportBatchesPDF(schedule);
      flash('Batches schedule PDF downloaded');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setExporting(false);
    }
  };

  const reload = async () => {
    try {
      const [b, g, t, v, c] = await Promise.all([
        api.list('batches'), api.list('groups'), api.list('trainers'), api.list('venues'), api.config(),
      ]);
      setBatches(b); setGroups(g); setTrainers(t); setVenues(v); setConfig(c);
      setLoadError('');
    } catch (e) { setLoadError(e.message); }
  };
  useEffect(() => { reload(); }, []);

  /* success lands as a toast, so it is seen however far down the page you are */
  const flash = msg => { setError(''); toast(msg); };

  const sortedBatches = useMemo(() => {
    if (!batches) return [];
    const groupOrderMap = new Map((groups || []).map((g, idx) => [g.name, g.order ?? idx]));
    return [...batches].sort((a, b) => {
      const gA = groupOrderMap.has(a.group) ? groupOrderMap.get(a.group) : 999;
      const gB = groupOrderMap.has(b.group) ? groupOrderMap.get(b.group) : 999;
      if (gA !== gB) return gA - gB;
      return (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name);
    });
  }, [batches, groups]);

  const shown = useMemo(
    () => sortedBatches.filter(b => filter === 'All' || b.group === filter),
    [sortedBatches, filter],
  );

  const table = useTable(shown, {
    text: b => [b.name, b.dept, b.group, ...(b.sessions || []).flatMap(s => [s.subject, s.venue, ...(s.mainTrainers || []), ...(s.supportTrainers || [])])].join(' '),
    sorts: {
      order: b => sortedBatches.indexOf(b),
      name: b => b.name,
      group: b => sortedBatches.indexOf(b),
      period: b => b.startDate || '',
      sessions: b => (b.sessions || []).length,
      students: b => Number(b.count) || 0,
    },
    initial: 'order',
  });
  /* the arrows reorder the board, so they only make sense in board order */
  const canReorder = table.sort.key === 'order' && table.sort.dir === 'asc' && !table.query.trim();

  /* /admin/batches?edit=<id> opens that batch straight away — the dashboard's
     clash and "needs attention" links land here */
  useEffect(() => {
    const id = params.get('edit');
    if (!id || !batches) return;
    const b = batches.find(x => x._id === id);
    if (b) open(structuredClone(b));
    else toast('That batch no longer exists', 'error');
    setParams({}, { replace: true });
  }, [batches, params]);   // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    const draft = editing;
    if (saving) return;                         // a second click while the first is in flight
    if (draft.startDate && draft.endDate && draft.endDate < draft.startDate) {
      setError('The end date is before the start date.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      const body = {
        name: draft.name, group: draft.group, dept: draft.dept,
        count: Number(draft.count) || 0,
        startDate: draft.startDate || '',
        endDate: draft.endDate || '',
        sessions: draft.sessions.map(({ _key, ...s }) => s),
      };
      if (draft._id) await api.update('batches', draft._id, body);
      else await api.create('batches', body);

      setEditing(null);
      await reload();
      announceChange();
      flash(draft._id ? `Saved ${draft.name}` : `Created ${draft.name}`);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function remove(b) {
    const n = (b.sessions || []).length;
    const sure = await confirm({
      title: `Delete "${b.name}"?`,
      body: (
        <>
          <p>This removes the batch and its <b>{n} weekly session{n === 1 ? '' : 's'}</b> from the board,
            the monthly calendar, and every trainer and hall timetable.</p>
          <p className="muted">This cannot be undone.</p>
        </>
      ),
      confirmLabel: 'Delete batch',
      danger: true,
    });
    if (!sure) return;
    try {
      await api.remove('batches', b._id);
      await reload();
      announceChange();
      flash(`Deleted ${b.name}`);
    } catch (e) { toast(e.message, 'error'); }
  }

  /* Moves a batch up/down within its own Year Group to determine its position in Overall Schedule */
  async function moveWithinGroup(b, dir) {
    const groupBatches = sortedBatches.filter(x => x.group === b.group);
    const i = groupBatches.findIndex(x => x._id === b._id);
    const j = i + dir;
    if (j < 0 || j >= groupBatches.length) return;

    const reordered = [...groupBatches];
    const [target] = reordered.splice(i, 1);
    reordered.splice(j, 0, target);

    const orderedIds = reordered.map(x => x._id);

    try {
      await api.reorderGroupBatches(b.group, orderedIds);
      await reload();
      announceChange();
      flash(`Updated order for ${b.group}`);
    } catch (e) { toast(e.message, 'error'); }
  }

  /* Moves a batch to the extreme top or bottom of its group */
  async function moveBatchToEdge(groupName, bId, toTop) {
    const groupBatches = sortedBatches.filter(x => x.group === groupName);
    const i = groupBatches.findIndex(x => x._id === bId);
    if (i === -1) return;
    if (toTop && i === 0) return;
    if (!toTop && i === groupBatches.length - 1) return;

    const reordered = [...groupBatches];
    const [target] = reordered.splice(i, 1);
    if (toTop) reordered.unshift(target);
    else reordered.push(target);

    const orderedIds = reordered.map(x => x._id);

    try {
      await api.reorderGroupBatches(groupName, orderedIds);
      await reload();
      announceChange();
      flash(`Moved "${target.name}" to ${toTop ? 'top' : 'bottom'}`);
    } catch (e) { toast(e.message, 'error'); }
  }

  if (loadError && (!batches || !config)) {
    return (
      <>
        <PageHead title="Batches & Sessions" />
        <Notice error={`Could not load batches: ${loadError}`} />
        <button className="btn btn-ghost" onClick={() => { setLoadError(''); reload(); }}>Try again</button>
      </>
    );
  }
  if (!batches || !config) return <><PageHead title="Batches & Sessions" /><Spinner /></>;

  const currentArrangeGroup = arrangingGroup || (filter !== 'All' ? filter : groups[0]?.name || '');
  const arrangeBatchesList = sortedBatches.filter(b => b.group === currentArrangeGroup);

  return (
    <>
      <PageHead
        title="Batches & Sessions"
        blurb="This is the source of truth for the whole board. Enter each batch once with its weekly sessions — the trainer timetables, hall occupancy, and Overall Schedule are calculated from what you put here."
      >
        <button
          type="button"
          className="btn-arrange"
          disabled={!batches.length}
          onClick={() => setArrangingGroup(filter !== 'All' ? filter : groups[0]?.name || '')}
          title="Arrange how batches appear in the Overall Schedule"
        >
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
          Arrange Batches
        </button>

        <button
          type="button"
          className="btn-pdf"
          disabled={exporting || !(batches || []).length}
          onClick={handleExportPDF}
          title="Download the full batches and sessions schedule as a PDF"
        >
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          {exporting ? 'Generating PDF…' : 'Download Schedule (PDF)'}
        </button>
        <button
          className="btn btn-primary"
          disabled={!groups.length}
          onClick={() => open(emptyBatch(groups))}
        >
          + New batch
        </button>
      </PageHead>

      <Notice error={error || (loadError && `Could not refresh: ${loadError}`)} ok={ok} />

      {!groups.length && (
        <div className="conflict">
          <h3>Add a year group first</h3>
          <ul><li>Every batch belongs to a year group. Create one under <b>Year Groups</b>, then come back.</li></ul>
        </div>
      )}

      <div className="card">
        <div className="card-row" style={{ marginBottom: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <Field label="Filter by year">
            <select value={filter} onChange={e => setFilter(e.target.value)}>
              <option value="All">All year groups</option>
              {groups.map(g => <option key={g._id} value={g.name}>{g.name}</option>)}
            </select>
          </Field>

          <SearchBox value={table.query} onChange={table.setQuery} label="Search batches by name, subject, trainer or hall" placeholder="Search batch, subject, trainer, hall…" />

          {groups.length > 0 && batches.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 13, alignSelf: 'flex-end', marginBottom: 2 }}
              onClick={() => setArrangingGroup(filter !== 'All' ? filter : groups[0]?.name || '')}
            >
              ↕ Reorder batches in schedule
            </button>
          )}
        </div>

        {!shown.length ? (
          <EmptyState
            title={batches.length ? 'No batches in this year group' : 'No batches yet'}
            action={groups.length && (
              <button className="btn btn-primary" onClick={() => open(emptyBatch(groups))}>+ New batch</button>
            )}
          >
            {batches.length ? 'Pick another year, or add a batch here.' : 'Add your first batch to start building the board.'}
          </EmptyState>
        ) : !table.rows.length ? (
          <EmptyState title="No batches match">Nothing matches “{table.query.trim()}”. Try a batch name, subject, trainer or hall.</EmptyState>
        ) : (
          <div className="tbl-wrap">
            {!canReorder && <p className="tbl-note">Sorted or filtered — clear the search and sort by Order to move batches up and down.</p>}
            <table className="tbl stack">
              <caption className="sr-only">Batches and their weekly sessions</caption>
              <thead>
                <tr>
                  <SortTh label="Order" k="order" table={table} style={{ width: 110 }} />
                  <SortTh label="Batch" k="name" table={table} />
                  <SortTh label="Year" k="group" table={table} />
                  <SortTh label="Tentative Period" k="period" table={table} />
                  <SortTh label="Sessions" k="sessions" table={table} />
                  <th>Halls</th>
                  <SortTh label="Students" k="students" table={table} />
                  <th className="act">Actions</th>
                </tr>
              </thead>
              <tbody>
                {table.rows.map(b => {
                  const groupBatches = sortedBatches.filter(x => x.group === b.group);
                  const groupIndex = groupBatches.findIndex(x => x._id === b._id);
                  const sess = b.sessions || [];
                  const unstaffed = sess.filter(s => !(s.mainTrainers || []).length).length;
                  const noHall = sess.filter(s => !s.venue).length;
                  const halls = [...new Set(sess.map(s => s.venue).filter(Boolean))];
                  return (
                    <tr key={b._id}>
                      <td data-label="Order">
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <span className="pill-tag" style={{ minWidth: 26, textAlign: 'center', padding: '2px 6px', fontSize: 11, fontWeight: 700 }}>
                            #{groupIndex + 1}
                          </span>
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ padding: '4px 6px', minHeight: 26, minWidth: 24, lineHeight: 1 }}
                            disabled={!canReorder || groupIndex === 0}
                            onClick={() => moveWithinGroup(b, -1)}
                            title="Move up in Overall Schedule"
                            aria-label={`Move ${b.name} up`}
                          >
                            ↑
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ padding: '4px 6px', minHeight: 26, minWidth: 24, lineHeight: 1 }}
                            disabled={!canReorder || groupIndex === groupBatches.length - 1}
                            onClick={() => moveWithinGroup(b, 1)}
                            title="Move down in Overall Schedule"
                            aria-label={`Move ${b.name} down`}
                          >
                            ↓
                          </button>
                        </div>
                      </td>
                      <td className="nm" data-label="Batch">
                        {b.name}
                        {b.dept && <div className="muted" style={{ fontWeight: 400, fontSize: 12, marginTop: 3 }}>{b.dept}</div>}
                      </td>
                      <td className="muted" data-label="Year">{b.group}</td>
                      <td data-label="Period">
                        {(b.startDate || b.endDate) ? (
                          <span className="tag-period" title={`From ${b.startDate || 'start'} to ${b.endDate || 'end'}`}>
                            📅 {formatDateRange(b.startDate, b.endDate)}
                          </span>
                        ) : (
                          <span className="muted" style={{ fontSize: 12 }}>Continuous</span>
                        )}
                      </td>
                      <td data-label="Sessions">
                        <span className="mono">{sess.length}</span>
                        {!!unstaffed && <span className="pill-tag warn" style={{ marginLeft: 8 }}>{unstaffed} unstaffed</span>}
                      </td>
                      <td className="muted" style={{ fontSize: 12.5 }} data-label="Halls">
                        {halls.length ? halls.join(', ') : <span className="pill-tag warn">not set</span>}
                        {!!noHall && !!halls.length && <span className="pill-tag warn" style={{ marginLeft: 6 }}>{noHall} missing</span>}
                      </td>
                      <td className="mono" data-label="Students">{b.count || '—'}</td>
                      <td className="act">
                        <button className="btn btn-ghost btn-sm" onClick={() => open(structuredClone(b))} aria-label={`Edit ${b.name}`}>Edit</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => duplicate(b)} aria-label={`Duplicate ${b.name}`}>Duplicate</button>
                        <button className="btn btn-danger btn-sm" onClick={() => remove(b)} aria-label={`Delete ${b.name}`}>Delete</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Arrange Batches Modal ── */}
      {arrangingGroup && (
        <Modal
          wide
          title="Arrange Batches in Overall Schedule"
          sub="Set the exact sequence in which batch cards appear on the board. Changes are applied live to the Overall Schedule."
          onClose={() => setArrangingGroup(null)}
          footer={
            <button className="btn btn-primary" onClick={() => setArrangingGroup(null)}>
              Done
            </button>
          }
        >
          <div className="arrange-container">
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                Select Year Group:
              </label>
              <div className="arrange-group-tabs">
                {groups.map(g => (
                  <button
                    key={g._id}
                    type="button"
                    className={`arrange-group-tab ${g.name === currentArrangeGroup ? 'on' : ''}`}
                    onClick={() => setArrangingGroup(g.name)}
                  >
                    {g.name} ({sortedBatches.filter(b => b.group === g.name).length})
                  </button>
                ))}
              </div>
            </div>

            {!arrangeBatchesList.length ? (
              <EmptyState title={`No batches in ${currentArrangeGroup}`}>
                Add batches to this year group to arrange them.
              </EmptyState>
            ) : (
              <>
                <div className="arrange-list">
                  {arrangeBatchesList.map((b, idx) => (
                    <div className="arrange-row" key={b._id}>
                      <div className="arrange-row-left">
                        <div className="arrange-num">#{idx + 1}</div>
                        <div className="arrange-row-info">
                          <div className="arrange-row-title">{b.name}</div>
                          <div className="arrange-row-meta">
                            {b.dept && <span><b>Dept:</b> {b.dept}</span>}
                            <span><b>Sessions:</b> {(b.sessions || []).length}</span>
                            {b.count > 0 && <span><b>Students:</b> {b.count}</span>}
                          </div>
                        </div>
                      </div>

                      <div className="arrange-row-actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm arrange-btn-action"
                          disabled={idx === 0}
                          onClick={() => moveBatchToEdge(currentArrangeGroup, b._id, true)}
                          title="Move to Top"
                        >
                          ⤒ Top
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm arrange-btn-action"
                          disabled={idx === 0}
                          onClick={() => moveWithinGroup(b, -1)}
                          title="Move Up"
                        >
                          ↑ Up
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm arrange-btn-action"
                          disabled={idx === arrangeBatchesList.length - 1}
                          onClick={() => moveWithinGroup(b, 1)}
                          title="Move Down"
                        >
                          ↓ Down
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm arrange-btn-action"
                          disabled={idx === arrangeBatchesList.length - 1}
                          onClick={() => moveBatchToEdge(currentArrangeGroup, b._id, false)}
                          title="Move to Bottom"
                        >
                          ⤓ Bottom
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="arrange-preview-box">
                  <div className="arrange-preview-head">
                    <span className="arrange-preview-title">Board Grid Preview: {currentArrangeGroup}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>Left-to-right order as rendered on the public board</span>
                  </div>
                  <div className="arrange-preview-grid">
                    {arrangeBatchesList.map((b, i) => (
                      <div className="arrange-preview-card" key={b._id}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)' }}>#{i + 1}</span>
                          {b.dept && <span style={{ fontSize: 10, color: 'var(--muted)' }}>{b.dept}</span>}
                        </div>
                        <strong>{b.name}</strong>
                        <span>{(b.sessions || []).length} sessions</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      {editing && (
        <Modal
          wide
          title={editing._id ? `Edit ${editing.name}` : 'New batch'}
          sub="A session is one class on one day. Add as many as the batch has in a week."
          onClose={() => setEditing(null)}
          dirty={dirty}
          footer={
            <>
              <button
                className="btn btn-ghost"
                onClick={() => setEditing({ ...editing, sessions: [...editing.sessions, keyed(blankSession())] })}
              >
                + Add session
              </button>
              <span className="spacer" />
              <button className="btn btn-ghost" onClick={() => setEditing(null)} disabled={saving}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={!editing.name.trim() || saving}>
                {saving ? 'Saving…' : editing._id ? 'Save changes' : 'Create batch'}
              </button>
            </>
          }
        >
          <Notice error={error} />

          <div className="sess-grid" style={{ marginBottom: 14 }}>
            <Field label="Batch name" help="Shown as the card title on the board.">
              <input
                value={editing.name}
                placeholder="e.g. C · Batch-1"
                onChange={e => setEditing({ ...editing, name: e.target.value })}
              />
            </Field>

            <Field label="Year group">
              <select value={editing.group} onChange={e => setEditing({ ...editing, group: e.target.value })}>
                {groups.map(g => <option key={g._id} value={g.name}>{g.name}</option>)}
              </select>
            </Field>
          </div>

          <div className="sess-grid" style={{ marginBottom: 14 }}>
            <Field label="Departments" help="Optional tag on the card. Leave blank to show nothing.">
              <input
                value={editing.dept}
                placeholder="e.g. AIML, DS, ISE"
                onChange={e => setEditing({ ...editing, dept: e.target.value })}
              />
            </Field>

            <Field label="Students" help="0 hides the count badge.">
              <input
                type="number" min="0"
                value={editing.count}
                onChange={e => setEditing({ ...editing, count: e.target.value })}
              />
            </Field>
          </div>

          <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: '14px 16px', margin: '14px 0 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
              <div>
                <strong style={{ fontSize: 13.5, color: 'var(--ink)' }}>📅 Tentative Training Dates (Monthly Calendar)</strong>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  Defines the start and end dates when classes for this batch appear on the Monthly Calendar.
                </div>
              </div>
              {(editing.startDate || editing.endDate) && (
                <span className="tag-period" style={{ fontSize: 11 }}>
                  📅 {formatDateRange(editing.startDate, editing.endDate)}
                </span>
              )}
            </div>

            <div className="sess-grid" style={{ marginBottom: 10 }}>
              <Field label="Tentative Start Date">
                <input
                  type="date"
                  value={editing.startDate || ''}
                  onChange={e => setEditing({ ...editing, startDate: e.target.value })}
                />
              </Field>
              <Field label="Tentative End Date">
                <input
                  type="date"
                  value={editing.endDate || ''}
                  onChange={e => setEditing({ ...editing, endDate: e.target.value })}
                />
              </Field>
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Quick Presets:</span>
              {datePresets().map(p => (
                <button
                  key={p.label}
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: 11.5, padding: '3px 8px' }}
                  onClick={() => setEditing({ ...editing, startDate: p.startDate, endDate: p.endDate })}
                >
                  {p.label}
                </button>
              ))}
              {(editing.startDate || editing.endDate) && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: 11.5, padding: '3px 8px', color: 'var(--accent-strong)' }}
                  onClick={() => setEditing({ ...editing, startDate: '', endDate: '' })}
                >
                  Clear (Continuous)
                </button>
              )}
            </div>
          </div>

          <h2 style={{ fontSize: 16, margin: '26px 0 6px' }}>Weekly sessions</h2>
          <p className="sub" style={{ marginBottom: 16 }}>
            Each session picks its own hall — a batch can meet in a different room on a different day.
            Anyone or anywhere already booked at the chosen day and period is marked <b>busy</b> so you can see a clash before saving.
          </p>

          {!editing.sessions.length && (
            <EmptyState title="No sessions yet">Add one to put this batch on the board.</EmptyState>
          )}

          {editing.sessions.map((s, i) => (
            <SessionEditor
              key={s._key}
              index={i}
              session={s}
              config={config}
              trainers={trainers}
              venues={venues}
              batchId={editing._id}
              batchDates={{ startDate: editing.startDate, endDate: editing.endDate }}
              onChange={next => {
                const sessions = [...editing.sessions];
                sessions[i] = next;
                setEditing({ ...editing, sessions });
              }}
              onRemove={() => setEditing({ ...editing, sessions: editing.sessions.filter((_, j) => j !== i) })}
            />
          ))}
        </Modal>
      )}
    </>
  );
}
