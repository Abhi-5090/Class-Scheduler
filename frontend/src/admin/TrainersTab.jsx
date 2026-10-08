import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { announceChange } from './Console.jsx';
import { Modal, PageHead, Field, Notice, EmptyState, Spinner, useTable, SortTh, SearchBox } from './ui.jsx';
import { useFeedback } from '../lib/feedback.jsx';
import { exportTrainerPDF, exportAllTrainersPDF } from '../lib/pdf.js';

const blank = { name: '', email: '', phone: '', track: 'teaching', active: true };

export default function TrainersTab() {
  const { toast, confirm } = useFeedback();
  const [rows, setRows] = useState(null);
  const [batches, setBatches] = useState([]);
  const [scheduleData, setScheduleData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [snapshot, setSnapshot] = useState('');   // the form as opened, to tell if it changed
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const open = draft => { setError(''); setEditing(draft); setSnapshot(JSON.stringify(draft)); };
  const [trackFilter, setTrackFilter] = useState('All');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [exporting, setExporting] = useState(false);

  const reload = async () => {
    try {
      const [t, b, s] = await Promise.all([
        api.list('trainers'),
        api.list('batches'),
        api.schedule(),
      ]);
      setRows(t);
      setLoadError('');
      setBatches(b);
      setScheduleData(s);
    } catch (e) { setLoadError(e.message); }
  };
  useEffect(() => { reload(); }, []);

  const flash = msg => { setError(''); toast(msg); };

  /* how many periods a week this trainer actually holds and what tasks they have */
  const load = name => {
    const derived = scheduleData?.trainers?.find(t => t.name === name);
    if (derived) {
      return {
        main: derived.mainCount || 0,
        support: derived.supportCount || 0,
        other: derived.otherCount || 0,
        activities: derived.activitiesBreakdown || {},
      };
    }
    let main = 0, support = 0;
    for (const b of batches || []) {
      for (const s of b.sessions || []) {
        if ((s.mainTrainers || []).includes(name)) main += (s.slots || []).length;
        else if ((s.supportTrainers || []).includes(name)) support += (s.slots || []).length;
      }
    }
    return { main, support, other: 0, activities: {} };
  };

  const handleExportAllPDF = async () => {
    setExporting(true); setError('');
    try {
      const schedule = await api.schedule();
      await exportAllTrainersPDF(schedule);
      flash('Consolidated trainer schedules PDF downloaded');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleExportTrainerPDF = async (trainerDoc) => {
    setError('');
    try {
      const schedule = await api.schedule();
      const trainerView = schedule.trainers.find(t => t.name === trainerDoc.name);
      if (!trainerView) throw new Error('Trainer schedule not found');
      await exportTrainerPDF(trainerView, {
        slots: schedule.slots,
        days: schedule.days,
        lunchIndex: schedule.lunchIndex,
      });
      flash(`Timetable PDF for ${trainerDoc.name} downloaded`);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  async function save() {
    if (saving) return;                         // a second click while the first is in flight
    setSaving(true);
    setError('');
    try {
      const body = {
        name: editing.name,
        email: editing.email,
        phone: editing.phone,
        track: editing.track || 'teaching',
        active: editing.active,
      };
      if (editing._id) await api.update('trainers', editing._id, body);
      else await api.create('trainers', body);
      setEditing(null);
      await reload();
      announceChange();
      flash(editing._id ? `Saved ${editing.name}` : `Added ${editing.name}`);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function remove(t) {
    const { main, support, other } = load(t.name);
    const inBatches = batches.filter(b => (b.sessions || []).some(s => (s.mainTrainers || []).includes(t.name) || (s.supportTrainers || []).includes(t.name)));
    const sure = await confirm({
      title: `Delete ${t.name}?`,
      body: main + support + other ? (
        <>
          <p>{t.name} is on the timetable every week. Deleting them will:</p>
          <ul className="impact">
            {!!(main + support) && <li>remove them from <b>{main + support} class period{main + support === 1 ? '' : 's'}</b> in <b>{inBatches.length} batch{inBatches.length === 1 ? '' : 'es'}</b>{inBatches.length ? ` (${inBatches.slice(0, 4).map(b => b.name).join(', ')}${inBatches.length > 4 ? ', …' : ''})` : ''}</li>}
            {!!other && <li>clear <b>{other} assigned work period{other === 1 ? '' : 's'}</b></li>}
            {!!main && <li>leave {main === 1 ? 'that class' : 'those classes'} without a main mentor until you assign one</li>}
          </ul>
          <p className="muted">This cannot be undone. To keep them on record but off the board, edit them and untick “Active” instead.</p>
        </>
      ) : <p>{t.name} has no classes or assigned work. This cannot be undone.</p>,
      confirmLabel: 'Delete trainer',
      danger: true,
    });
    if (!sure) return;
    try {
      await api.remove('trainers', t._id);
      await reload();
      announceChange();
      flash(`Deleted ${t.name}`);
    } catch (e) { toast(e.message, 'error'); }
  }

  const nonTeaching = t => t.track === 'non-teaching' || t.track === 'non-technical';
  const byTrack = (rows || []).filter(t => trackFilter === 'All' || (trackFilter === 'non-teaching' ? nonTeaching(t) : !nonTeaching(t)));
  const table = useTable(byTrack, {
    text: t => `${t.name} ${t.email || ''} ${t.phone || ''}`,
    sorts: {
      name: t => t.name,
      track: t => (nonTeaching(t) ? 1 : 0),
      load: t => { const l = load(t.name); return l.main + l.support + l.other; },
      status: t => (t.active ? 0 : 1),
    },
    initial: 'name',
  });

  if (!rows) {
    return (
      <>
        <PageHead title="Trainers" />
        {loadError
          ? <><Notice error={`Could not load: ${loadError}`} /><button className="btn btn-ghost" onClick={() => { setLoadError(''); reload(); }}>Try again</button></>
          : <Spinner />}
      </>
    );
  }

  return (
    <>
      <PageHead
        title="Trainers"
        blurb="The mentor roster. Each trainer's timetable on the board is built from the sessions that name them and their assigned activities."
      >
        <button
          type="button"
          className="btn-pdf"
          disabled={exporting || !(rows || []).length}
          onClick={handleExportAllPDF}
          title="Download the full consolidated trainer schedules and workloads as a PDF"
        >
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          {exporting ? 'Generating PDF…' : 'Download Trainer Schedules (PDF)'}
        </button>
        <button className="btn btn-primary" onClick={() => open({ ...blank })}>+ New trainer</button>
      </PageHead>

      <Notice error={error || (loadError && `Could not refresh: ${loadError}`)} ok={ok} />

      <div className="card">
        {!rows.length ? (
          <EmptyState
            title="No trainers yet"
            action={<button className="btn btn-primary" onClick={() => open({ ...blank })}>+ New trainer</button>}
          >
            Add the mentors first, then assign them to batch sessions.
          </EmptyState>
        ) : (
          <div className="tbl-wrap">
            <div className="admin-filter-bar">
              <button
                type="button"
                className={`btn btn-sm ${trackFilter === 'All' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setTrackFilter('All')}
              >
                All ({rows.length})
              </button>
              <button
                type="button"
                className={`btn btn-sm ${trackFilter === 'teaching' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setTrackFilter('teaching')}
              >
                Teaching ({rows.filter(t => (t.track || 'teaching') !== 'non-teaching' && t.track !== 'non-technical').length})
              </button>
              <button
                type="button"
                className={`btn btn-sm ${trackFilter === 'non-teaching' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setTrackFilter('non-teaching')}
              >
                Non-Teaching ({rows.filter(t => t.track === 'non-teaching' || t.track === 'non-technical').length})
              </button>
              <SearchBox value={table.query} onChange={table.setQuery} label="Search trainers by name, email or phone" placeholder="Search trainer…" />
            </div>
            {!table.rows.length ? (
              <EmptyState title="No trainers match">Nothing matches “{table.query.trim()}” in this category.</EmptyState>
            ) : (
            <table className="tbl stack">
              <caption className="sr-only">Trainers, their track and weekly load</caption>
              <thead>
                <tr>
                  <SortTh label="Name" k="name" table={table} />
                  <SortTh label="Track" k="track" table={table} />
                  <th>Contact</th>
                  <SortTh label="Weekly load & assignments" k="load" table={table} />
                  <SortTh label="Status" k="status" table={table} />
                  <th className="act">Actions</th>
                </tr>
              </thead>
              <tbody>
                {table.rows.map(t => {
                  const { main, support, other, activities } = load(t.name);
                  const taskNames = Object.entries(activities).map(([k, v]) => `${k} (${v})`).join(', ');
                  const isNonTeaching = t.track === 'non-teaching' || t.track === 'non-technical';
                  return (
                    <tr key={t._id}>
                      <td className="nm" data-label="Name">{t.name}</td>
                      <td data-label="Track">
                        <span className={`pill-tag ${isNonTeaching ? 'alt' : 'accent'}`}>
                          {isNonTeaching ? 'Non-Teaching' : 'Teaching'}
                        </span>
                      </td>
                      <td className="muted" style={{ fontSize: 13 }} data-label="Contact">
                        {t.email || t.phone
                          ? <>{t.email}{t.email && t.phone && <br />}{t.phone}</>
                          : '—'}
                      </td>
                      <td data-label="Weekly load">
                        {main || support || other ? (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                            {!!main && <span className="pill-tag">{main} main</span>}
                            {!!support && <span className="pill-tag grey">{support} support</span>}
                            {!!other && (
                              <span className="pill-tag" style={{ background: 'var(--accent-tint)', color: 'var(--accent-deep)', borderColor: 'var(--accent-soft)' }} title={taskNames}>
                                {other} assigned
                              </span>
                            )}
                          </div>
                        ) : <span className="muted">unassigned</span>}
                      </td>
                      <td data-label="Status">{t.active ? <span className="pill-tag">active</span> : <span className="pill-tag grey">hidden</span>}</td>
                      <td className="act">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => handleExportTrainerPDF(t)}
                          title={`Export PDF timetable for ${t.name}`}
                          aria-label={`Download ${t.name}'s timetable as PDF`}
                        >
                          PDF
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => open({ ...t, track: (t.track === 'non-teaching' || t.track === 'non-technical') ? 'non-teaching' : 'teaching' })} aria-label={`Edit ${t.name}`}>Edit</button>
                        <button className="btn btn-danger btn-sm" onClick={() => remove(t)} aria-label={`Delete ${t.name}`}>Delete</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            )}
          </div>
        )}
      </div>

      {editing && (
        <Modal
          title={editing._id ? `Edit ${editing.name}` : 'New trainer'}
          onClose={() => setEditing(null)}
          dirty={JSON.stringify(editing) !== snapshot}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={!editing.name.trim() || saving}>
                {saving ? 'Saving…' : editing._id ? 'Save changes' : 'Add trainer'}
              </button>
            </>
          }
        >
          <Notice error={error} />

          <Field label="Name" help="Renaming carries through every session they are on.">
            <input autoFocus value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} />
          </Field>

          <Field label="Category / Track" help="Teaching faculty take core instruction & syllabus; Non-Teaching mentors handle operations, soft skills, aptitude, verbal, design, etc.">
            <div className="track-radio-group">
              <label className={`track-radio-btn ${(editing.track || 'teaching') !== 'non-teaching' && editing.track !== 'non-technical' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="trainerTrack"
                  value="teaching"
                  checked={(editing.track || 'teaching') !== 'non-teaching' && editing.track !== 'non-technical'}
                  onChange={() => setEditing({ ...editing, track: 'teaching' })}
                />
                <span>Teaching</span>
              </label>
              <label className={`track-radio-btn ${editing.track === 'non-teaching' || editing.track === 'non-technical' ? 'active non-tech non-teaching' : ''}`}>
                <input
                  type="radio"
                  name="trainerTrack"
                  value="non-teaching"
                  checked={editing.track === 'non-teaching' || editing.track === 'non-technical'}
                  onChange={() => setEditing({ ...editing, track: 'non-teaching' })}
                />
                <span>Non-Teaching</span>
              </label>
            </div>
          </Field>

          <div className="sess-grid">
            <Field label="Email">
              <input type="email" value={editing.email} onChange={e => setEditing({ ...editing, email: e.target.value })} />
            </Field>
            <Field label="Phone">
              <input value={editing.phone} onChange={e => setEditing({ ...editing, phone: e.target.value })} />
            </Field>
          </div>

          <Field help="Hidden trainers stay in the database but drop off the public board.">
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
