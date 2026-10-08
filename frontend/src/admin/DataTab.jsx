import { useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useAdmin } from '../lib/useAdmin.js';
import { useFeedback } from '../lib/feedback.jsx';
import { announceChange } from './Console.jsx';
import { PageHead, Field, Notice } from './ui.jsx';

const sheets = () => import('../lib/sheets.js');

/* the columns of each import, which double as its template */
const TEMPLATES = {
  batches: {
    label: 'Batches & sessions', admin: false,
    help: 'One row per weekly class. Rows with the same batch name make one batch; a batch already on file has its sessions replaced by the rows here.',
    columns: ['Batch', 'Year', 'Department', 'Students', 'Start', 'End', 'Day', 'Periods', 'Subject', 'Hall', 'Main', 'Support', 'Session start', 'Session end'],
    example: ['Python · Batch-3', 'First Year', 'CSE', '60', '2026-11-01', '2026-12-15', 'Monday', '1-2', 'Python', 'Training Block · 1st Floor Hall', 'Naveen', 'Harika', '', ''],
  },
  trainers: {
    label: 'Trainers', admin: true,
    help: 'Names are the key: an existing name is updated (blank cells keep what is there), a new name is added. Track is Teaching or Non-Teaching.',
    columns: ['Name', 'Email', 'Phone', 'Track', 'Active'],
    example: ['Priya Sharma', 'priya@college.edu', '+91 98765 43210', 'Teaching', 'Yes'],
  },
  halls: {
    label: 'Training halls', admin: true,
    help: 'Hall names are the key: an existing hall is updated, a new one is added.',
    columns: ['Name', 'Capacity', 'Active'],
    example: ['Main Block · Seminar Hall 2', '80', 'Yes'],
  },
};

/*
 * Spreadsheets in and out. Exports are generated in the browser from the live
 * data; imports are read in the browser, checked by the server row by row
 * (nothing saved), shown here, and only then applied — all rows or none.
 */
export default function DataTab() {
  const { can } = useAdmin();
  const { toast } = useFeedback();
  const [kind, setKind] = useState(can('admin') ? 'trainers' : 'batches');
  const [preview, setPreview] = useState(null);
  const [rows, setRows] = useState(null);
  const [file, setFile] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const input = useRef(null);
  const check = useRef(0);            // id of the newest check; older answers are ignored
  const allowed = Object.entries(TEMPLATES).filter(([, t]) => !t.admin || can('admin'));

  /* ── exports ── */
  async function exportAll(what, format) {
    setBusy(`${what}-${format}`);
    try {
      const { download } = await sheets();
      if (what === 'trainers') {
        const list = await api.list('trainers');
        await download(list.map(t => ({ ...t, track: t.track === 'non-teaching' || t.track === 'non-technical' ? 'Non-Teaching' : 'Teaching', active: t.active })),
          [{ key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' }, { key: 'track', label: 'Track' }, { key: 'active', label: 'Active' }], 'Trainers', format);
      } else if (what === 'halls') {
        const list = await api.list('venues');
        await download(list, [{ key: 'name', label: 'Name' }, { key: 'capacity', label: 'Capacity' }, { key: 'active', label: 'Active' }], 'Training_halls', format);
      } else if (what === 'batches') {
        const [list, config] = await Promise.all([api.list('batches'), api.config()]);
        const out = list.flatMap(b => (b.sessions.length ? b.sessions : [null]).map(s => ({
          batch: b.name, year: b.group, dept: b.dept, students: b.count, start: b.startDate, end: b.endDate,
          day: s?.day || '', periods: s ? periodText(s.slots) : '', time: s?.slots?.length ? `${config.slots[s.slots[0]]?.split(/[–-]/)[0] || ''}–${config.slots[s.slots.at(-1)]?.split(/[–-]/).pop() || ''}` : '',
          subject: s?.subject || '', hall: s?.venue || '', main: (s?.mainTrainers || []).join('; '), support: (s?.supportTrainers || []).join('; '),
          sstart: s?.startDate || '', send: s?.endDate || '',
        })));
        await download(out, [
          { key: 'batch', label: 'Batch' }, { key: 'year', label: 'Year' }, { key: 'dept', label: 'Department' }, { key: 'students', label: 'Students' },
          { key: 'start', label: 'Start' }, { key: 'end', label: 'End' }, { key: 'day', label: 'Day' }, { key: 'periods', label: 'Periods' },
          { key: 'time', label: 'Time' }, { key: 'subject', label: 'Subject' }, { key: 'hall', label: 'Hall' }, { key: 'main', label: 'Main' },
          { key: 'support', label: 'Support' }, { key: 'sstart', label: 'Session start' }, { key: 'send', label: 'Session end' },
        ], 'Batches_and_sessions', format);
      } else if (what === 'timetable') {
        const s = await api.schedule();
        const out = s.trainers.flatMap(t => s.days.flatMap(d => s.slots.map((slot, i) => ({
          trainer: t.name, day: d, period: i + 1, time: slot,
          role: t.roles?.[d]?.[i] === 'main' ? 'Main' : t.roles?.[d]?.[i] === 'support' ? 'Support' : t.roles?.[d]?.[i] === 'other' ? 'Assigned work' : t.roles?.[d]?.[i] === 'lunch' ? 'Lunch' : '',
          what: t.grid?.[d]?.[i] || '', hall: t.venues?.[d]?.[i] || '',
        })))).filter(r => r.role);
        await download(out, [
          { key: 'trainer', label: 'Trainer' }, { key: 'day', label: 'Day' }, { key: 'period', label: 'Period' }, { key: 'time', label: 'Time' },
          { key: 'role', label: 'Role' }, { key: 'what', label: 'Batch / work' }, { key: 'hall', label: 'Hall' },
        ], 'Weekly_timetable', format);
      } else if (what === 'exceptions') {
        const list = await api.exceptions();
        await download(list.map(e => ({ ...e, type: { holiday: 'Holiday', cancel: 'Cancelled', substitute: 'Substitute' }[e.type], slots: periodText(e.slots || []) })), [
          { key: 'type', label: 'Type' }, { key: 'date', label: 'Date' }, { key: 'endDate', label: 'Until' }, { key: 'label', label: 'Reason' },
          { key: 'batch', label: 'Batch' }, { key: 'subject', label: 'Subject' }, { key: 'day', label: 'Day' }, { key: 'slots', label: 'Periods' },
          { key: 'fromTrainer', label: 'Covered trainer' }, { key: 'toTrainer', label: 'Substitute' },
        ], 'Holidays_and_exceptions', format);
      }
      toast('Download ready');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(''); }
  }

  async function template(format) {
    const t = TEMPLATES[kind];
    const { download } = await sheets();
    await download([Object.fromEntries(t.columns.map((c, i) => [c, t.example[i]]))], t.columns.map(c => ({ key: c, label: c })), `${t.label}_template`, format);
  }

  /* ── import ── */
  async function choose(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const mine = ++check.current;
    setError(''); setPreview(null); setRows(null); setFile(f.name);
    setBusy('check');
    try {
      const { readFile } = await sheets();
      const parsed = await readFile(f);
      if (!parsed.length) throw new Error('The file has no rows under its header');
      const result = await api.importRows(kind, parsed, true);
      if (mine !== check.current) return;            // the user started over meanwhile
      setRows(parsed);
      setPreview(result);
    } catch (err) { if (mine === check.current) setError(err.message); }
    finally { if (mine === check.current) setBusy(''); }
  }

  async function apply() {
    setBusy('apply'); setError('');
    try {
      /* import exactly what was checked: the server echoes the kind it checked */
      const r = await api.importRows(preview.kind, rows, false);
      toast(`Imported: ${r.creates} added, ${r.updates} updated`);
      setPreview(null); setRows(null); setFile('');
      announceChange();
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  }

  const t = TEMPLATES[kind];
  const exports = [
    ['batches', 'Batches & sessions', 'One row per weekly class, with times, halls and mentors.'],
    ['timetable', 'Weekly timetable', 'Every trainer, day and period that is booked.'],
    ['exceptions', 'Holidays & exceptions', 'Holidays, cancellations and substitutions.'],
    ['trainers', 'Trainers', 'Names, contact details, track and status.'],
    ['halls', 'Training halls', 'Names, capacity and status.'],
  ];

  return (
    <>
      <PageHead title="Import & Export" blurb="Download any part of the timetable as Excel or CSV, or bring trainers, halls and batches in from a spreadsheet." />

      <div className="card">
        <h2>Export</h2>
        <p className="sub">Generated from the live data. Opens in Excel, Google Sheets or Numbers.</p>
        <ul className="export-list">
          {exports.map(([k, label, help]) => (
            <li key={k}>
              <div><b>{label}</b><span className="muted">{help}</span></div>
              <div className="export-btns">
                <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => exportAll(k, 'xlsx')}>{busy === `${k}-xlsx` ? 'Preparing…' : 'Excel'}</button>
                <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => exportAll(k, 'csv')}>{busy === `${k}-csv` ? 'Preparing…' : 'CSV'}</button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2>Import</h2>
        <p className="sub">Nothing is saved until you have seen the check and pressed Import. If any row has a problem, nothing is imported.</p>

        <div className="card-row" style={{ marginBottom: 14 }}>
          <Field label="What to import">
            <select value={kind} disabled={!!busy} onChange={e => { check.current++; setKind(e.target.value); setPreview(null); setRows(null); setFile(''); setError(''); setBusy(''); }}>
              {allowed.map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Field>
          <div className="export-btns" style={{ alignSelf: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => template('xlsx')}>Template (Excel)</button>
            <button className="btn btn-ghost btn-sm" onClick={() => template('csv')}>Template (CSV)</button>
          </div>
        </div>
        <p className="help-text">{t.help}</p>
        <p className="help-text">Columns: <span className="mono">{t.columns.join(' · ')}</span>{kind === 'batches' && <> — periods like <span className="mono">1-2</span> or <span className="mono">3,4</span>; several trainers separated by <span className="mono">;</span>; dates as <span className="mono">YYYY-MM-DD</span> or <span className="mono">DD/MM/YYYY</span>.</>}</p>

        <input ref={input} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={choose} />
        <button className="btn btn-primary" onClick={() => input.current?.click()} disabled={!!busy}>
          {busy === 'check' ? 'Checking…' : 'Choose a .xlsx or .csv file'}
        </button>
        {file && <span className="muted" style={{ marginLeft: 12 }}>{file}</span>}

        <div style={{ marginTop: 16 }}><Notice error={error} /></div>

        {preview && (
          <div className="import-preview">
            <div className="import-summary">
              <span><b>{preview.rows.length}</b> rows</span>
              <span><b>{preview.creates}</b> to add</span>
              <span><b>{preview.updates}</b> to update</span>
              <span className={preview.errors ? 'bad' : ''}><b>{preview.errors}</b> with problems</span>
            </div>
            <div className="tbl-wrap" style={{ maxHeight: 360, overflow: 'auto' }}>
              <table className="tbl">
                <caption className="sr-only">Import check, row by row</caption>
                <thead><tr><th>Row</th><th>Result</th><th>Name</th><th>Problem</th></tr></thead>
                <tbody>
                  {preview.rows.map(r => (
                    <tr key={r.row} className={r.status === 'error' ? 'row-bad' : ''}>
                      <td className="mono">{r.row}</td>
                      <td><span className={`pill-tag ${r.status === 'error' ? 'warn' : r.status === 'update' ? 'grey' : ''}`}>{r.status === 'error' ? 'problem' : r.status === 'create' ? 'add' : 'update'}</span></td>
                      <td className="nm">{r.name || '—'}</td>
                      <td className="muted">{r.error || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => { setPreview(null); setRows(null); setFile(''); }}>Discard</button>
              <button className="btn btn-primary" disabled={!!preview.errors || busy === 'apply'} onClick={apply}>
                {busy === 'apply' ? 'Importing…' : preview.errors ? 'Fix the problems first' : `Import ${preview.rows.length} rows`}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function periodText(slots) {
  const s = [...slots].sort((a, b) => a - b).map(i => i + 1);
  if (!s.length) return '';
  const contiguous = s.every((v, i) => !i || v === s[i - 1] + 1);
  return contiguous && s.length > 1 ? `${s[0]}-${s.at(-1)}` : s.join(',');
}
