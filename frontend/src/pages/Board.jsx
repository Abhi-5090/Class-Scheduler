import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { RM } from '../lib/theme.js';
import { reveal } from '../lib/reveal.js';

import Hero from '../components/Hero.jsx';
import Stats from '../components/Stats.jsx';
import Loading from '../components/Loading.jsx';
import BatchCard from '../components/BatchCard.jsx';
import SoonCard from '../components/SoonCard.jsx';
import PeriodGrid, { Counts, freeAllDay, dayShort } from '../components/PeriodGrid.jsx';
import ActivityModal from '../components/ActivityModal.jsx';
import DayWiseView from '../components/DayWiseView.jsx';
import CalendarView from '../components/CalendarView.jsx';
import { CalendarIcon, CalendarDayIcon, CalendarMonthIcon, PersonIcon, BuildingIcon, SearchIcon } from '../components/Icons.jsx';
import { formatDayShort } from '../lib/abbreviate.js';

/* loading dwell, ms — the same beats the original board used */
const D_VIEW = 900, D_FILTER = 620, D_SEARCH = 460;

const VIEWS = {
  schedule: { msg: 'Loading class schedule', n: 3, label: 'Overall Schedule', shortLabel: 'Overall', Icon: CalendarIcon },
  daywise:  { msg: 'Loading day-wise schedule', n: 3, label: 'Day Wise Schedule', shortLabel: 'Day Wise', Icon: CalendarDayIcon },
  calendar: { msg: 'Loading monthly calendar', n: 3, label: 'Monthly Calendar', shortLabel: 'Calendar', Icon: CalendarMonthIcon },
  trainer:  { msg: 'Loading trainer grids',  n: 2, label: 'Trainer Schedule',  shortLabel: 'Trainers', Icon: PersonIcon },
  venue:    { msg: 'Loading hall occupancy', n: 2, label: 'Venue Schedule',    shortLabel: 'Venues',   Icon: BuildingIcon },
};

export default function Board({ admin }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  /* ?view=trainer deep-links straight to a view, so a particular grid can be
     shared rather than described. */
  const [view, setViewState] = useState(() => {
    const v = new URLSearchParams(location.search).get('view');
    return VIEWS[v] ? v : 'schedule';
  });
  const setView = v => {
    setViewState(v);
    const url = new URL(location.href);
    if (v === 'schedule') url.searchParams.delete('view');
    else url.searchParams.set('view', v);
    history.replaceState(null, '', url);
  };
  const [dayFilter, setDayFilter] = useState('All');
  const [dayWiseDay, setDayWiseDay] = useState('Monday');
  const [query, setQuery] = useState('');
  const [trainerTrackFilter, setTrainerTrackFilter] = useState('teaching'); // 'teaching' | 'non-teaching'

  /* `dwell` holds the skeleton up for a beat after every change, the way the
     original did — the board is meant to feel like it is fetching. */
  const [dwell, setDwell] = useState(true);
  const [dwellMsg, setDwellMsg] = useState(VIEWS.schedule.msg);

  const refresh = () => api.schedule().then(setData);
  useEffect(() => { refresh().catch(e => setError(e.message)); }, []);

  useEffect(() => {
    if (data?.days?.length) {
      const today = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date());
      if (data.days.includes(today)) {
        setDayWiseDay(today);
      } else if (!data.days.includes(dayWiseDay)) {
        setDayWiseDay(data.days[0]);
      }
    }
  }, [data]);

  useEffect(() => { document.body.classList.add('boot'); }, []);

  /* The console and the login screen retitle the tab, so the board has to
     claim it back when you navigate here from either of them. */
  useEffect(() => { document.title = 'Class Scheduler · NCET Training Schedule'; }, []);

  const hold = (msg, ms) => {
    setDwellMsg(msg);
    setDwell(true);
    if (RM) { setDwell(false); return () => {}; }
    const t = setTimeout(() => setDwell(false), ms);
    return () => clearTimeout(t);
  };

  /* view switch */
  useEffect(() => hold(VIEWS[view].msg, D_VIEW), [view]);

  /* day filter, schedule view only */
  const firstFilter = useRef(true);
  useEffect(() => {
    if (firstFilter.current) { firstFilter.current = false; return; }
    return hold(dayFilter === 'All' ? 'Loading all days' : `Loading ${dayFilter}`, D_FILTER);
  }, [dayFilter]);

  /* trainer track filter */
  const firstTrack = useRef(true);
  useEffect(() => {
    if (firstTrack.current) { firstTrack.current = false; return; }
    const label = trainerTrackFilter === 'teaching'
      ? 'teaching trainers'
      : 'non-teaching trainers';
    return hold(`Loading ${label}`, D_FILTER);
  }, [trainerTrackFilter]);

  /* trainer search, debounced then held */
  const firstQuery = useRef(true);
  useEffect(() => {
    if (firstQuery.current) { firstQuery.current = false; return; }
    const debounce = setTimeout(() => {
      hold(query.trim() ? `Searching “${query.trim()}”` : 'Loading trainers', D_SEARCH);
    }, 240);
    return () => clearTimeout(debounce);
  }, [query]);

  if (error) {
    return (
      <div className="wrap">
        <Hero admin={admin} />
        <p className="empty">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="wrap">
        <Hero admin={admin} />
        <Loading msg="Loading schedule" n={3} />
      </div>
    );
  }

  const busy = dwell;

  return (
    <div className="wrap">
      <Hero admin={admin} />
      <Stats data={data} />

      <div className="control">
        <Segmented view={view} onChange={setView} />
        <div id="ctrlRight">
          {view === 'schedule' && (
            <div className="filters">
              {['All', ...data.days].map(d => (
                <button
                  key={d}
                  className={`chip ${d === dayFilter ? 'on' : ''} ${busy ? 'busy' : ''}`}
                  onClick={() => setDayFilter(d)}
                >
                  {d === 'All' ? 'All days' : (
                    <>
                      <span className="day-full">{d}</span>
                      <span className="day-abbr">{formatDayShort(d)}</span>
                    </>
                  )}
                </button>
              ))}
            </div>
          )}
          {view === 'daywise' && (
            <div className="search">
              <SearchIcon />
              <input
                placeholder="Search batch, subject, trainer…"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </div>
          )}
          {view === 'trainer' && (
            <div className="trainer-ctrl">
              <div className="search">
                <SearchIcon />
                <input
                  placeholder="Search trainer…"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                />
              </div>
              <div className="track-toggle" role="group" aria-label="Filter by Teaching or Non-Teaching track">
                <button
                  type="button"
                  className={trainerTrackFilter === 'teaching' ? 'on' : ''}
                  onClick={() => setTrainerTrackFilter('teaching')}
                  title="Show Teaching trainers"
                >
                  Teaching <span className="count-badge">({data.trainers.filter(t => (t.track || 'teaching') !== 'non-teaching' && t.track !== 'non-technical').length})</span>
                </button>
                <button
                  type="button"
                  className={trainerTrackFilter === 'non-teaching' ? 'on non-teaching' : ''}
                  onClick={() => setTrainerTrackFilter('non-teaching')}
                  title="Show Non-Teaching trainers"
                >
                  Non-Teaching <span className="count-badge">({data.trainers.filter(t => t.track === 'non-teaching' || t.track === 'non-technical').length})</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {view === 'schedule' && (
        <section className="panel show">
          <div className="sec-head">
            <h2>Overall Class Schedule</h2>
            <span className="hint">
              {dayFilter === 'All' ? data.groups.map(g => g.group).join(', ') : `Highlighting ${dayFilter}`}
            </span>
          </div>
          {busy ? <Loading msg={dwellMsg} n={3} />
                : <ScheduleView data={data} dayFilter={dayFilter} />}
        </section>
      )}

      {view === 'daywise' && (
        <section className="panel show">
          <div className="sec-head">
            <h2>Day-Wise Training Schedule</h2>
            <span className="hint">
              Detailed classes, faculty deployment, and training halls scheduled for {dayWiseDay}
            </span>
          </div>
          {busy ? <Loading msg={dwellMsg} n={3} />
                : <DayWiseView
                    data={data}
                    selectedDay={dayWiseDay}
                    onSelectDay={setDayWiseDay}
                    query={query}
                    onQueryChange={setQuery}
                    admin={admin}
                  />}
        </section>
      )}

      {view === 'calendar' && (
        <section className="panel show">
          <div className="sec-head">
            <h2>Monthly Training Calendar</h2>
            <span className="hint">
              Comprehensive day-by-day training classes, tentative batch duration, and scheduled modules across months
            </span>
          </div>
          {busy ? <Loading msg={dwellMsg} n={3} />
                : <CalendarView data={data} admin={admin} />}
        </section>
      )}

      {view === 'trainer' && (
        <section className="panel show">
          <div className="sec-head">
            <h2>Trainer Schedule</h2>
            <span className="hint">
              {trainerTrackFilter === 'teaching'
                ? `Showing Teaching mentors (${data.trainers.filter(t => (t.track || 'teaching') !== 'non-teaching' && t.track !== 'non-technical').length}) · `
                : `Showing Non-Teaching mentors (${data.trainers.filter(t => t.track === 'non-teaching' || t.track === 'non-technical').length}) · `}
              Free vs occupied periods per trainer · lunch ({data.slots[data.lunchIndex]}) is a break for all.
            </span>
          </div>
          {busy ? <Loading msg={dwellMsg} n={2} />
                : <TrainerView data={data} query={query} trackFilter={trainerTrackFilter} admin={admin} refresh={refresh} />}
        </section>
      )}

      {view === 'venue' && (
        <section className="panel show">
          <div className="sec-head">
            <h2>Venue Schedule</h2>
            <span className="hint">
              Which hall is free when, and what class is running there · lunch ({data.slots[data.lunchIndex]}) is a break for all.
            </span>
          </div>
          {busy ? <Loading msg={dwellMsg} n={2} />
                : <VenueView data={data} />}
        </section>
      )}

      <footer>
        <span>
          <b>Class Scheduler</b> · <span className="tag-accent">NCET Training Schedule</span>
        </span>
        <span>{data.trainers.length} trainers · {data.batches.filter(b => !b.status || b.status === 'current').length} active batches · {data.venues.length} halls</span>
      </footer>
    </div>
  );
}


/* ── the sliding pill has to be measured, so it lives in its own component ── */
function Segmented({ view, onChange }) {
  const segRef = useRef(null);
  const [pill, setPill] = useState({ width: 0, x: 0 });

  const position = () => {
    const on = segRef.current?.querySelector('button.on');
    if (on) {
      setPill({ width: on.offsetWidth, x: on.offsetLeft - 5 });
      if (segRef.current) {
        const scrollLeft = on.offsetLeft - (segRef.current.clientWidth - on.offsetWidth) / 2;
        segRef.current.scrollTo({ left: Math.max(0, scrollLeft), behavior: 'smooth' });
      }
    }
  };

  useLayoutEffect(position, [view]);
  useEffect(() => {
    addEventListener('resize', position);
    addEventListener('load', position);
    /* webfonts land after first paint and change the button widths */
    document.fonts?.ready?.then(position);
    return () => { removeEventListener('resize', position); removeEventListener('load', position); };
  }, []);

  return (
    <div className="seg" ref={segRef} data-view={view}>
      <span className="pill" style={{ width: `${pill.width}px`, transform: `translateX(${pill.x}px)` }} />
      {Object.entries(VIEWS).map(([key, { label, shortLabel, Icon }]) => (
        <button
          key={key}
          className={key === view ? 'on' : ''}
          data-v={key}
          onClick={() => { if (key !== view) onChange(key); }}
        >
          <Icon />
          <span className="tab-full">{label}</span>
          <span className="tab-abbr">{shortLabel || label}</span>
        </button>
      ))}
    </div>
  );
}

function ScheduleView({ data, dayFilter }) {
  const host = useRef(null);
  useEffect(() => reveal(host.current), [data, dayFilter]);

  /* a row may stand for a run of days ("Monday – Wednesday"), so match on the
     day positions it covers, not on the words in its label */
  const matches = row => dayFilter === 'All' || (row.dayIndexes || []).some(i => data.days[i] === dayFilter);

  return (
    <div ref={host}>
      {data.groups.map((g, i) => (
        <div className="group rv" key={g.group}>
          <div className="group-head">
            <span className={`yr ${i === 0 ? 'hl' : ''}`}>{g.group}</span>
            <span className="rule" />
            <span className="cnt">{g.batches.length} {g.batches.length > 1 ? 'batches' : 'batch'}</span>
          </div>
          <div className="grid-cards">
            {g.batches.map(b => <BatchCard key={b.id} batch={b} dimUnless={matches} />)}
          </div>
        </div>
      ))}

      {!!data.offBoard?.length && <OffBoard list={data.offBoard} />}

      {data.upcoming.map(u => (
        <div className="group rv" key={u.group}>
          <div className="group-head">
            <span className="yr soon">{u.group}</span>
            <span className="rule" />
            <span className="cnt">awaiting schedule</span>
          </div>
          <div className="grid-cards" style={{ gridTemplateColumns: '1fr' }}>
            <SoonCard group={u.group} note={u.note} />
          </div>
        </div>
      ))}
    </div>
  );
}

const LEGEND = (
  <div className="legend">
    <span><i className="m" />Main mentor — delivers the class</span>
    <span><i className="s" />Support mentor — assists</span>
    <span><i className="f" />Free</span>
    <span><i className="l" />Lunch break</span>
  </div>
);

const VENUE_LEGEND = (
  <div className="legend">
    <span><i className="m" />Class in session</span>
    <span><i className="f" />Hall free</span>
    <span><i className="l" />Lunch break</span>
  </div>
);

const initials = n => n.slice(0, 2).toUpperCase();

/* day → { slotIndex: batch } for every period the trainer teaches, so the
   activity editor can lock them: a class always wins on the board. */
const classSlotsOf = (t, days) => Object.fromEntries(days.map(d => [d, Object.fromEntries(
  (t?.roles?.[d] || []).flatMap((r, i) => (r === 'main' || r === 'support' ? [[i, t.grid[d][i]]] : [])),
)]));

function TrainerView({ data, query, trackFilter = 'teaching', admin, refresh }) {
  const host = useRef(null);
  const q = query.trim().toLowerCase();
  const list = useMemo(
    () => data.trainers.filter(t => {
      const matchQuery = t.name.toLowerCase().includes(q);
      const isNonTeaching = t.track === 'non-teaching' || t.track === 'non-technical';
      const matchTrack = trackFilter === 'non-teaching' ? isNonTeaching : !isNonTeaching;
      return matchQuery && matchTrack;
    }),
    [data, q, trackFilter],
  );

  /* the cell currently open in the activity editor, or null */
  const [editing, setEditing] = useState(null);

  useEffect(() => reveal(host.current), [list]);

  if (!list.length) {
    const trackNote = trackFilter === 'teaching' ? 'Teaching ' : 'Non-Teaching ';
    return <p className="empty">No {trackNote}trainer matches {q ? `“${q}”` : 'that category'}.</p>;
  }

  return (
    <div ref={host}>
      {LEGEND}
      {admin && (
        <p className="admin-hint">
          Signed in — click any free, lunch, or logged period on a grid below to record what that trainer is doing.
        </p>
      )}
      {list.map(t => {
        const free = freeAllDay(t, data.days, data.slots.length);
        const role = t.mainCount && t.supportCount ? 'Main + Support mentor'
          : t.mainCount ? 'Main mentor'
          : t.supportCount ? 'Support mentor' : 'Unassigned';
        const isNonTeaching = t.track === 'non-teaching' || t.track === 'non-technical';
        return (
          <article className="tcard rv" key={t.id}>
            <div className="top">
              <div className="tname">
                <div className={`avatar ${isNonTeaching ? 'non-teaching' : ''}`}>{initials(t.name)}</div>
                <div>
                  <div className="tname-head">
                    <h3>{t.name}</h3>
                    <span className={`tag-track ${isNonTeaching ? 'non-teaching' : 'teaching'}`}>
                      {isNonTeaching ? 'Non-Teaching' : 'Teaching'}
                    </span>
                  </div>
                  <div className="role">{role}</div>
                </div>
              </div>
              <Counts entity={t} />
            </div>
            <PeriodGrid
              entity={t} slots={data.slots} days={data.days} lunchIndex={data.lunchIndex}
              onEditCell={admin ? (day, slot, current) => setEditing({ trainerName: t.name, day, slot, current }) : undefined}
            />
            {!!free.length && <p className="free-note">● Free all day: {free.join(', ')}</p>}
          </article>
        );
      })}

      {editing && (
        <ActivityModal
          trainerName={editing.trainerName}
          day={editing.day}
          slot={editing.slot}
          slotLabel={data.slots[editing.slot]}
          days={data.days}
          slots={data.slots}
          lunchIndex={data.lunchIndex}
          current={editing.current}
          classSlots={classSlotsOf(data.trainers.find(x => x.name === editing.trainerName), data.days)}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

function VenueView({ data }) {
  const host = useRef(null);
  useEffect(() => reveal(host.current), [data]);

  return (
    <div ref={host}>
      {VENUE_LEGEND}
      {data.venues.map(v => {
        const free = freeAllDay(v, data.days, data.slots.length);
        return (
          <article className="tcard rv" key={v.id}>
            <div className="top">
              <div className="tname">
                <div className="avatar venue">
                  <svg viewBox="0 0 24 24"><path d="M4 21V8l8-5 8 5v13" /><path d="M9 21v-6h6v6" /></svg>
                </div>
                <div><h3>{v.name}</h3><div className="role">Training hall</div></div>
              </div>
              <Counts entity={v} />
            </div>
            <PeriodGrid entity={v} slots={data.slots} days={data.days} lunchIndex={data.lunchIndex} />
            {!!free.length && <p className="free-note">● Free all day: {free.join(', ')}</p>}
          </article>
        );
      })}
    </div>
  );
}

/* Batches outside their dates aren't on this week's board; say which and why,
   so a missing batch never looks like lost data. */
const fmt = d => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
function OffBoard({ list }) {
  const upcoming = list.filter(b => b.status === 'upcoming').sort((a, b) => a.startDate.localeCompare(b.startDate));
  const ended = list.filter(b => b.status === 'ended').sort((a, b) => b.endDate.localeCompare(a.endDate));
  return (
    <div className="offboard rv">
      {!!upcoming.length && (
        <p><b>Starting later</b> — {upcoming.map(b => `${b.name} (from ${fmt(b.startDate)})`).join(' · ')}</p>
      )}
      {!!ended.length && (
        <p><b>Finished</b> — {ended.map(b => `${b.name} (ended ${fmt(b.endDate)})`).join(' · ')}</p>
      )}
      <p className="offboard-hint">These appear on the Monthly Calendar for their dates.</p>
    </div>
  );
}
