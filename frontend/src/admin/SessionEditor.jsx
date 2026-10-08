import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Field } from './ui.jsx';
import HallPicker from './HallPicker.jsx';

/*
 * Asks the API who is already busy at this day + period, so a clash shows up
 * while the session is being written rather than after it is saved.
 */
function useAvailability(day, slots = [], excludeBatch, range = {}) {
  const [busy, setBusy] = useState({ trainers: {}, venues: {}, failed: false });

  const key = `${day}|${[...(slots || [])].sort((a, b) => a - b).join(',')}|${range.from || ''}|${range.to || ''}`;
  useEffect(() => {
    if (!day || !slots?.length) { setBusy({ trainers: {}, venues: {}, failed: false }); return; }
    let live = true;
    const t = setTimeout(() => {
      api.availability([{ day, slots }], excludeBatch, range)
        .then(r => {
          if (!live) return;
          const map = list => Object.fromEntries(list.filter(x => x.busyWith).map(x => [x.name, x.busyWith]));
          setBusy({ trainers: map(r.trainers), venues: map(r.venues), failed: false });
        })
        /* say so rather than silently showing everyone as free */
        .catch(() => { if (live) setBusy({ trainers: {}, venues: {}, failed: true }); });
    }, 180);
    return () => { live = false; clearTimeout(t); };
  }, [key, excludeBatch]);            // eslint-disable-line react-hooks/exhaustive-deps

  return busy;
}

function MentorPicker({ label, help, all, chosen = [], exclude = [], busy = {}, onToggle }) {
  return (
    <Field label={label} help={help}>
      <div className="picker">
        {all.length === 0 && <span className="muted" style={{ fontSize: 13, padding: 6 }}>No trainers yet.</span>}
        {all.map(t => {
          const disabled = (exclude || []).includes(t.name);
          const taken = busy[t.name];
          return (
            <label key={t.name} className={taken ? 'taken' : ''} style={disabled ? { opacity: .4 } : undefined}>
              <input
                type="checkbox"
                checked={(chosen || []).includes(t.name)}
                disabled={disabled}
                onChange={() => onToggle(t.name)}
              />
              {t.name}
              <span className={`mini-track ${(t.track === 'non-teaching' || t.track === 'non-technical') ? 'non-teaching non-tech' : 'teaching tech'}`}>
                {(t.track === 'non-teaching' || t.track === 'non-technical') ? 'Non-Teaching' : 'Teaching'}
              </span>
              {taken && <span className="busy-note">busy · {taken}</span>}
            </label>
          );
        })}
      </div>
    </Field>
  );
}

export default function SessionEditor({ index, session, config, trainers, venues, batchId, batchDates = {}, onChange, onRemove }) {
  /* the dates this session runs: its own, else the batch's — only classes
     overlapping them can clash, the same rule the server applies on save */
  const range = { from: session.startDate || batchDates.startDate || '', to: session.endDate || batchDates.endDate || '' };
  const busy = useAvailability(session.day, session.slots || [], batchId, range);

  const set = patch => onChange({ ...session, ...patch });

  const toggleSlot = i => {
    const currentSlots = session.slots || [];
    const has = currentSlots.includes(i);
    set({ slots: (has ? currentSlots.filter(s => s !== i) : [...currentSlots, i]).sort((a, b) => a - b) });
  };

  const toggleIn = (field, name) => {
    const list = session[field] || [];
    set({ [field]: list.includes(name) ? list.filter(n => n !== name) : [...list, name] });
  };

  const label = (session.slots || []).length
    ? `Slot ${(session.slots || []).map(i => i + 1).join(', ')}`
    : 'No period picked';

  return (
    <div className="sess">
      <div className="sess-head">
        <span className="ttl">Session {index + 1} · {session.day || 'pick a day'} · {label}</span>
        <button type="button" className="btn btn-danger btn-sm" onClick={onRemove}>Remove</button>
      </div>

      <div className="sess-grid">
        <Field label="Day">
          <select value={session.day} onChange={e => set({ day: e.target.value })}>
            <option value="">Choose a day…</option>
            {config.days.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>

        <Field label="Subject">
          <input
            value={session.subject}
            placeholder="e.g. C Programming"
            onChange={e => set({ subject: e.target.value })}
          />
        </Field>
      </div>

      <Field
        label="Periods"
        help={`Slots are numbered the way the college numbers them. Lunch (${config.slots[config.lunchIndex]}) is dashed — pick it only if this class genuinely runs through the break.`}
      >
        <div className="slotpick">
          {config.slots.map((s, i) => (
            <button
              key={i}
              type="button"
              className={`${(session.slots || []).includes(i) ? 'on' : ''} ${i === config.lunchIndex ? 'lunchy' : ''}`}
              onClick={() => toggleSlot(i)}
            >
              {i + 1}<span className="t">{s}</span>
            </button>
          ))}
        </div>
      </Field>

      {busy.failed && (
        <div className="admin-hint">Could not check who is free right now — saving will still refuse a double-booking.</div>
      )}

      <HallPicker
        scope="session"
        venues={venues}
        sessions={[session]}
        value={session.venue}
        batchId={batchId}
        range={range}
        onChange={venue => set({ venue })}
      />

      <div className="sess-grid">
        <MentorPicker
          label="Main mentors"
          help="Delivers the class."
          all={trainers}
          chosen={session.mainTrainers || []}
          exclude={session.supportTrainers || []}
          busy={busy.trainers}
          onToggle={n => toggleIn('mainTrainers', n)}
        />
        <MentorPicker
          label="Support mentors"
          help="Assists. Someone already picked as main cannot also be support."
          all={trainers}
          chosen={session.supportTrainers || []}
          exclude={session.mainTrainers || []}
          busy={busy.trainers}
          onToggle={n => toggleIn('supportTrainers', n)}
        />
      </div>

      <div className="sess-grid" style={{ marginTop: 10 }}>
        <Field label="Session start date (optional)" help="Leave blank to use batch tentative start date.">
          <input
            type="date"
            value={session.startDate || ''}
            onChange={e => set({ startDate: e.target.value })}
          />
        </Field>
        <Field label="Session end date (optional)" help="Leave blank to use batch tentative end date.">
          <input
            type="date"
            value={session.endDate || ''}
            onChange={e => set({ endDate: e.target.value })}
          />
        </Field>
      </div>
    </div>
  );
}

export const blankSession = () => ({
  day: '', slots: [], subject: '', venue: '', mainTrainers: [], supportTrainers: [], startDate: '', endDate: '',
});
