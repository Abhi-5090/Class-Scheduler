import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { useFeedback } from '../lib/feedback.jsx';
import { announceChange } from './Console.jsx';
import { Modal, PageHead, Field, Notice, EmptyState, Spinner, useTable, SortTh, SearchBox } from './ui.jsx';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekday = iso => WEEKDAYS[new Date(`${iso}T00:00:00`).getDay()];
const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const nice = iso => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '');
const TYPE = { holiday: 'Holiday', cancel: 'Cancelled class', substitute: 'Substitute trainer' };
const live = (s, b, d) => {
  const start = s.startDate || b.startDate || '', end = s.endDate || b.endDate || '';
  return (!start || d >= start) && (!end || d <= end);
};
const notifyText = r => (!r ? '' : r.configured === false ? ' (email is not configured, so nobody was emailed)'
  : r.queued ? ` · emailing ${r.queued} trainer${r.queued === 1 ? '' : 's'}${r.skipped ? ` (${r.skipped} without an address)` : ''}` : r.skipped ? ` · ${r.skipped} trainer(s) have no email address` : '');

/*
 * Holidays and one-off changes to the weekly timetable. The weekly template
 * is never edited from here: a holiday stops every class on its dates, a
 * cancellation stops one class on one date, a substitution swaps one trainer
 * for another in one class on one date. The calendar, today's status, the
 * finder and the analytics trend all apply them.
 */
export default function Exceptions() {
  const { toast, confirm } = useFeedback();
  const [list, setList] = useState(null);
  const [batches, setBatches] = useState([]);
  const [trainers, setTrainers] = useState([]);
  const [config, setConfig] = useState(null);
  const [show, setShow] = useState('upcoming');
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [free, setFree] = useState(null);

  const reload = () => Promise.all([api.exceptions(), api.list('batches'), api.list('trainers'), api.config()])
    .then(([e, b, t, c]) => { setList(e); setBatches(b); setTrainers(t); setConfig(c); })
    .catch(e => setError(e.message));
  useEffect(() => { reload(); }, []);

  const today = isoToday();
  const shown = useMemo(() => (list || []).filter(e => (show === 'upcoming' ? (e.endDate || e.date) >= today : (e.endDate || e.date) < today)), [list, show, today]);
  const table = useTable(shown, {
    text: e => `${TYPE[e.type]} ${e.label} ${e.batch} ${e.subject} ${e.fromTrainer} ${e.toTrainer}`,
    sorts: { date: e => e.date, type: e => e.type, what: e => e.batch || e.label },
    initial: 'date', initialDir: show === 'upcoming' ? 'asc' : 'desc',
  });
  /* upcoming reads soonest first, past reads most recent first */
  useEffect(() => { table.setSort({ key: 'date', dir: show === 'upcoming' ? 'asc' : 'desc' }); }, [show]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* classes that actually run on the chosen date */
  const draft = editing;
  const classes = useMemo(() => {
    if (!draft?.date || draft.type === 'holiday') return [];
    const day = weekday(draft.date);
    return batches.flatMap(b => (b.sessions || []).filter(s => s.day === day && live(s, b, draft.date)).map(s => ({ b, s })));
  }, [draft?.date, draft?.type, batches]);
  const chosen = classes.find(c => c.s._id === draft?.sessionId);

  /* for a substitution, ask the finder who is free at that class's periods */
  useEffect(() => {
    setFree(null);
    if (draft?.type !== 'substitute' || !chosen) return undefined;
    let ok = true;
    api.finder({ date: draft.date, slots: chosen.s.slots.join(',') }).then(r => { if (ok) setFree(r.trainers); }).catch(() => {});
    return () => { ok = false; };
  }, [draft?.type, draft?.date, chosen?.s?._id]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!list || !config) return <><PageHead title="Holidays & Exceptions" />{error ? <Notice error={error} /> : <Spinner />}</>;

  const open = type => { setError(''); setEditing({ type, date: today, endDate: '', label: '', batchId: '', sessionId: '', fromTrainer: '', toTrainer: '' }); };
  const set = patch => setEditing(d => ({ ...d, ...patch }));

  async function save(notify) {
    if (saving) return;
    setSaving(true); setError('');
    try {
      const d = editing;
      const body = d.type === 'holiday'
        ? { type: d.type, date: d.date, endDate: d.endDate, label: d.label }
        : { type: d.type, date: d.date, label: d.label, batchId: chosen?.b._id, sessionId: d.sessionId, fromTrainer: d.fromTrainer, toTrainer: d.toTrainer };
      const r = await api.createException(body, notify);
      setEditing(null);
      await reload();
      announceChange();
      toast(`${TYPE[d.type]} saved${notifyText(r.notified)}`);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function remove(e) {
    const answer = await confirm({
      title: `Remove this ${TYPE[e.type].toLowerCase()}?`,
      body: <p>{describe(e)}. {e.type === 'holiday' ? 'Classes on these dates will run as usual again.' : e.type === 'cancel' ? 'The class will run that day after all.' : `${e.fromTrainer} will teach the class that day.`}</p>,
      confirmLabel: 'Remove', alternate: 'Remove & notify trainers', danger: true,
    });
    if (!answer) return;
    try {
      const r = await api.deleteException(e._id, answer === 'alternate');
      await reload();
      announceChange();
      toast(`Removed${notifyText(r.notified)}`);
    } catch (err) { toast(err.message, 'error'); }
  }

  const d = editing;
  const canSave = d && d.date && (d.type === 'holiday' ? !!d.label.trim() : d.sessionId && (d.type === 'cancel' || (d.fromTrainer && d.toTrainer)));
  const people = chosen ? [...(chosen.s.mainTrainers || []), ...(chosen.s.supportTrainers || [])] : [];

  return (
    <>
      <PageHead
        title="Holidays & Exceptions"
        blurb="Changes to particular dates: college holidays, a class that will not run, or another trainer covering a class. The weekly timetable itself stays as it is."
      >
        <button className="btn btn-ghost" onClick={() => open('holiday')}>+ Holiday</button>
        <button className="btn btn-ghost" onClick={() => open('cancel')}>+ Cancel a class</button>
        <button className="btn btn-primary" onClick={() => open('substitute')}>+ Substitute</button>
      </PageHead>

      <div className="card">
        <div className="admin-filter-bar">
          {['upcoming', 'past'].map(k => (
            <button key={k} type="button" className={`btn btn-sm ${show === k ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={show === k} onClick={() => setShow(k)}>
              {k === 'upcoming' ? 'Today & upcoming' : 'Past'}
            </button>
          ))}
          <SearchBox value={table.query} onChange={table.setQuery} label="Search exceptions" placeholder="Search batch, trainer, reason…" />
        </div>
        {!table.rows.length ? (
          <EmptyState title={show === 'upcoming' ? 'Nothing planned' : 'Nothing in the past'}>
            {show === 'upcoming' ? 'Add a holiday, a cancellation or a substitute above.' : ''}
          </EmptyState>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl stack">
              <caption className="sr-only">Holidays and exceptions</caption>
              <thead>
                <tr>
                  <SortTh label="Date" k="date" table={table} />
                  <SortTh label="Type" k="type" table={table} />
                  <SortTh label="What" k="what" table={table} />
                  <th>Reason</th>
                  <th className="act"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {table.rows.map(e => (
                  <tr key={e._id}>
                    <td data-label="Date" className="nm">{nice(e.date)}{e.endDate && e.endDate !== e.date ? <><br /><span className="muted">to {nice(e.endDate)}</span></> : ''}</td>
                    <td data-label="Type"><span className={`feed-tag ${e.type}`}>{TYPE[e.type]}</span></td>
                    <td data-label="What">{e.type === 'holiday' ? <span className="muted">All classes</span> : (
                      <>
                        <b>{e.batch}</b> · {e.subject}<br />
                        <span className="muted">{e.day}, slot {e.slots.map(i => i + 1).join('–')}{e.type === 'substitute' ? ` · ${e.toTrainer} for ${e.fromTrainer}` : ''}</span>
                      </>
                    )}</td>
                    <td data-label="Reason" className="muted">{e.label || '—'}</td>
                    <td className="act"><button className="btn btn-danger btn-sm" onClick={() => remove(e)} aria-label={`Remove ${describe(e)}`}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {d && (
        <Modal
          title={`New ${TYPE[d.type].toLowerCase()}`}
          sub={d.type === 'holiday' ? 'No classes run on these dates.' : d.type === 'cancel' ? 'One class does not run on one date.' : 'Another trainer takes one class on one date. Only trainers free at that time are offered.'}
          onClose={() => setEditing(null)}
          dirty
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setEditing(null)} disabled={saving}>Cancel</button>
              <span className="spacer" />
              <button className="btn btn-ghost" onClick={() => save(false)} disabled={!canSave || saving}>{saving ? 'Saving…' : 'Save'}</button>
              <button className="btn btn-primary" onClick={() => save(true)} disabled={!canSave || saving}>Save & notify trainers</button>
            </>
          }
        >
          <Notice error={error} />
          <div className="sess-grid">
            <Field label={d.type === 'holiday' ? 'From' : 'Date'}>
              <input type="date" value={d.date} onChange={e => set({ date: e.target.value, sessionId: '', fromTrainer: '', toTrainer: '' })} />
            </Field>
            {d.type === 'holiday' && (
              <Field label="To (optional)" help="Leave blank for a single day.">
                <input type="date" value={d.endDate} min={d.date} onChange={e => set({ endDate: e.target.value })} />
              </Field>
            )}
          </div>

          {d.type !== 'holiday' && (
            <Field label="Class" help={d.date ? `Classes that run on ${weekday(d.date)} ${nice(d.date)}.` : ''}>
              <select value={d.sessionId} onChange={e => set({ sessionId: e.target.value, fromTrainer: '', toTrainer: '' })}>
                <option value="">{classes.length ? 'Choose a class…' : 'No classes run on this date'}</option>
                {classes.map(({ b, s }) => (
                  <option key={s._id} value={s._id}>
                    {b.name} · {s.subject} · slot {s.slots.map(i => i + 1).join('–')} ({config.slots[s.slots[0]]?.split(/[–-]/)[0]}){(s.mainTrainers || []).length ? ` · ${s.mainTrainers.join(', ')}` : ''}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {d.type === 'substitute' && chosen && (
            <div className="sess-grid">
              <Field label="Trainer being covered">
                <select value={d.fromTrainer} onChange={e => set({ fromTrainer: e.target.value })}>
                  <option value="">Choose…</option>
                  {people.map(p => <option key={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Substitute" help={free ? `${free.filter(t => t.free && !people.includes(t.name)).length} free at that time` : 'Checking who is free…'}>
                <select value={d.toTrainer} onChange={e => set({ toTrainer: e.target.value })} disabled={!free}>
                  <option value="">Choose…</option>
                  {(free || []).filter(t => t.free && !people.includes(t.name)).map(t => (
                    <option key={t.name} value={t.name}>{t.name} — {t.weeklyLoad} periods/week</option>
                  ))}
                </select>
              </Field>
            </div>
          )}

          <Field label={d.type === 'holiday' ? 'Holiday name' : 'Reason (optional)'}>
            <input value={d.label} maxLength={200} placeholder={d.type === 'holiday' ? 'e.g. Diwali, Semester break' : 'e.g. Guest lecture, trainer on leave'}
              onChange={e => set({ label: e.target.value })} />
          </Field>
          {!trainers.length && <p className="sub">No trainers yet.</p>}
        </Modal>
      )}
    </>
  );
}

function describe(e) {
  return e.type === 'holiday'
    ? `${e.label} (${nice(e.date)}${e.endDate && e.endDate !== e.date ? ` to ${nice(e.endDate)}` : ''})`
    : `${e.batch} · ${e.subject} on ${nice(e.date)}${e.type === 'substitute' ? ` (${e.toTrainer} for ${e.fromTrainer})` : ''}`;
}
