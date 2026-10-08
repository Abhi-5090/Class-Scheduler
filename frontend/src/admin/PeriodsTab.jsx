import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { announceChange } from './Console.jsx';
import { PageHead, Field, Notice, Spinner } from './ui.jsx';

/*
 * The period grid every other view is drawn on. Sessions point at periods by
 * position and at days by name, so every row remembers where it came from
 * (`from`): the API then moves each class and logged activity along with its
 * row on rename, removal or insertion, all in one go. Removing a period or day
 * a class still uses is refused, with the list of what is in the way.
 */
/* the editable shape: each row carries the position or name it was loaded with */
const fromConfig = c => ({
  slots: c.slots.map((label, i) => ({ label, from: i })),
  days: c.days.map(name => ({ name, from: name })),
  lunchIndex: c.lunchIndex,
});

export default function PeriodsTab() {
  const [draft, setDraft] = useState(null);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.config()
      .then(c => { setSaved(c); setDraft(fromConfig(c)); })
      .catch(e => setError(e.message));
  }, []);

  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(fromConfig(saved));
  /* unsaved grid edits survive neither a reload nor leaving the page — warn first */
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = e => { e.preventDefault(); e.returnValue = ''; };
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (!draft) return <><PageHead title="Time Slots & Days" /><Spinner /></>;


  const setSlot = (i, v) => setDraft({ ...draft, slots: draft.slots.map((s, j) => (j === i ? { ...s, label: v } : s)) });
  const setDay = (i, v) => setDraft({ ...draft, days: draft.days.map((d, j) => (j === i ? { ...d, name: v } : d)) });

  const removeSlot = i => setDraft({
    ...draft,
    slots: draft.slots.filter((_, j) => j !== i),
    /* the lunch marker follows the row it was on */
    lunchIndex: draft.lunchIndex > i ? draft.lunchIndex - 1
      : draft.lunchIndex === i ? Math.max(0, i - 1) : draft.lunchIndex,
  });

  async function save() {
    setBusy(true); setError(''); setOk('');
    try {
      /* blank rows are refused rather than dropped, so the lunch marker and
         every later slot number stay exactly where they appear on screen */
      if (draft.slots.some(s => !s.label.trim())) throw new Error('Fill in or remove the blank period row.');
      if (draft.days.some(d => !d.name.trim())) throw new Error('Fill in or remove the blank day row.');
      const c = await api.saveConfig({
        slots: draft.slots.map(s => ({ label: s.label.trim(), from: s.from })),
        days: draft.days.map(d => ({ name: d.name.trim(), from: d.from })),
        lunchIndex: draft.lunchIndex,
      });
      setSaved(c);
      setDraft(fromConfig(c));
      announceChange();
      setOk(c.activitiesCleared
        ? `Period grid saved. ${c.activitiesCleared} logged activit${c.activitiesCleared > 1 ? 'ies' : 'y'} on removed periods were cleared.`
        : 'Period grid saved.');
      setTimeout(() => setOk(''), 2600);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <>
      <PageHead
        title="Time Slots & Days"
        blurb="The shape of the teaching week. Sessions refer to periods by number, so this is what “Slot 1–2” actually means on the board."
      >
        <button className="btn btn-ghost" disabled={!dirty || busy} onClick={() => setDraft(fromConfig(saved))}>
          Discard
        </button>
        <button className="btn btn-primary" disabled={!dirty || busy} onClick={save}>
          {busy ? 'Saving…' : 'Save grid'}
        </button>
      </PageHead>

      <Notice error={error} ok={ok} />

      <div className="card">
        <h2>Periods</h2>
        <p className="sub">
          In order, top to bottom. Slot numbers on the board come from this order — the first row is Slot 1.
          Pick which row is the lunch break; it shows as a break for everyone unless a class is explicitly booked over it.
        </p>

        <div className="chips-edit">
          {draft.slots.map((s, i) => (
            <div className={`line ${i === draft.lunchIndex ? 'is-lunch' : ''}`} key={i}>
              <span className="ix">{i + 1}</span>
              <input value={s.label} onChange={e => setSlot(i, e.target.value)} placeholder="9:00–9:50" maxLength={40} />
              <button
                type="button"
                className={`btn btn-sm ${i === draft.lunchIndex ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setDraft({ ...draft, lunchIndex: i })}
                title="Mark this period as the lunch break"
              >
                {i === draft.lunchIndex ? 'Lunch' : 'Set lunch'}
              </button>
              <button
                type="button" className="btn btn-danger btn-sm"
                disabled={draft.slots.length <= 1}
                onClick={() => removeSlot(i)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <button
          className="btn btn-ghost btn-sm" style={{ marginTop: 14 }}
          onClick={() => setDraft({ ...draft, slots: [...draft.slots, { label: '', from: null }] })}
        >
          + Add period
        </button>
      </div>

      <div className="card">
        <h2>Teaching days</h2>
        <p className="sub">The columns on every trainer and hall timetable, in order.</p>

        <div className="chips-edit">
          {draft.days.map((d, i) => (
            <div className="line" key={i}>
              <span className="ix">{i + 1}</span>
              <input value={d.name} onChange={e => setDay(i, e.target.value)} placeholder="Monday" maxLength={20} />
              <button
                type="button" className="btn btn-danger btn-sm"
                disabled={draft.days.length <= 1}
                onClick={() => setDraft({ ...draft, days: draft.days.filter((_, j) => j !== i) })}
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <button
          className="btn btn-ghost btn-sm" style={{ marginTop: 14 }}
          onClick={() => setDraft({ ...draft, days: [...draft.days, { name: '', from: null }] })}
        >
          + Add day
        </button>
      </div>

      <div className="card">
        <h2>How this reads on the board</h2>
        <p className="sub">A preview of the slot numbering sessions will refer to.</p>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Slot</th><th>Time</th><th>Note</th></tr></thead>
            <tbody>
              {draft.slots.map((s, i) => (
                <tr key={i}>
                  <td className="nm">Slot {i + 1}</td>
                  <td className="mono">{s.label || <span className="muted">blank</span>}</td>
                  <td>{i === draft.lunchIndex ? <span className="pill-tag warn">lunch break</span> : <span className="muted">teaching period</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
