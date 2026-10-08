import { useEffect, useMemo, useRef, useState } from 'react';
import { reveal } from '../lib/reveal.js';
import { useFeedback } from '../lib/feedback.jsx';
import { exportDayPDF } from '../lib/pdf.js';
import { PinIcon, ClockIcon, GridIcon, TimelineIcon, DownloadIcon, SearchIcon } from './Icons.jsx';
import { formatDayShort } from '../lib/abbreviate.js';

export default function DayWiseView({ data, selectedDay, onSelectDay, query, now }) {
  const { toast } = useFeedback();
  const host = useRef(null);
  const [mode, setMode] = useState('timeline'); // 'timeline' (primary) | 'batch'

  useEffect(() => {
    reveal(host.current);
  }, [data, selectedDay, mode, query]);

  const days = data.days || [];
  const activeDay = selectedDay === 'All' ? days[0] || 'Monday' : selectedDay;
  const isAll = selectedDay === 'All';

  // Compute daily metrics & sessions for a given day
  const getDayInfo = (dayName) => {
    const dayIdx = days.indexOf(dayName);
    if (dayIdx === -1) return { activeBatches: [], totalSessions: 0, mentors: new Set(), halls: new Set() };

    const activeBatches = [];
    let totalSessions = 0;
    const mentors = new Set();
    const halls = new Set();

    for (const group of data.groups) {
      const gBatches = [];
      for (const b of group.batches) {
        const matchingRows = (b.rows || []).filter(r => r.dayIndexes && r.dayIndexes.includes(dayIdx));
        if (matchingRows.length > 0) {
          totalSessions += matchingRows.length;
          matchingRows.forEach(r => {
            if (r.venue) halls.add(r.venue);
            (r.mainList || []).forEach(m => mentors.add(m));
            (r.supportList || []).forEach(s => mentors.add(s));
          });
          gBatches.push({ ...b, dayRows: matchingRows });
        }
      }
      if (gBatches.length > 0) {
        activeBatches.push({ group: group.group, batches: gBatches });
      }
    }

    return { activeBatches, totalSessions, mentors, halls };
  };

  const currentStats = useMemo(() => getDayInfo(activeDay), [data, activeDay]);

  const q = (query || '').trim().toLowerCase();

  const filterDayBatches = (groupsList) => {
    if (!q) return groupsList;
    return groupsList.map(g => {
      const filtered = g.batches.filter(b => {
        const matchBatch = b.name.toLowerCase().includes(q) || (b.dept && b.dept.toLowerCase().includes(q));
        const matchSession = b.dayRows.some(r =>
          r.subject.toLowerCase().includes(q) ||
          (r.venue && r.venue.toLowerCase().includes(q)) ||
          (r.trainer && r.trainer.toLowerCase().includes(q)) ||
          (r.support && r.support.toLowerCase().includes(q))
        );
        return matchBatch || matchSession;
      });
      return { ...g, batches: filtered };
    }).filter(g => g.batches.length > 0);
  };

  // Timeline slots computation for activeDay
  const timelineSlots = useMemo(() => {
    const dayIdx = days.indexOf(activeDay);
    if (dayIdx === -1) return [];

    return data.slots.map((slotLabel, slotIdx) => {
      const isLunch = slotIdx === data.lunchIndex;
      const sessions = [];

      for (const group of data.groups) {
        for (const b of group.batches) {
          for (const r of b.rows || []) {
            if (r.dayIndexes && r.dayIndexes.includes(dayIdx) && r.slots && r.slots.includes(slotIdx)) {
              // check search query
              if (q) {
                const matches = b.name.toLowerCase().includes(q) ||
                  (b.dept && b.dept.toLowerCase().includes(q)) ||
                  r.subject.toLowerCase().includes(q) ||
                  (r.venue && r.venue.toLowerCase().includes(q)) ||
                  (r.trainer && r.trainer.toLowerCase().includes(q)) ||
                  (r.support && r.support.toLowerCase().includes(q));
                if (!matches) continue;
              }
              sessions.push({
                group: group.group,
                batch: b.name,
                dept: b.dept,
                subject: r.subject,
                time: r.time,
                slot: r.slot,
                venue: r.venue,
                trainer: r.trainer,
                support: r.support,
                mainList: r.mainList,
                supportList: r.supportList,
              });
            }
          }
        }
      }

      return {
        slotIdx,
        slotLabel,
        isLunch,
        sessions,
      };
    });
  }, [data, activeDay, q]);

  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await exportDayPDF(data, activeDay);
      toast(` schedule downloaded`);
    } catch {
      toast('Could not create the PDF — please try again', 'error');
    } finally { setExporting(false); }
  };

  return (
    <div className="daywise-view" ref={host}>
      {/* Day Selector Bar */}
      <div className="daywise-subbar rv">
        <div className="daywise-chips">
          {days.map(d => {
            const info = getDayInfo(d);
            const isSelected = d === activeDay;
            return (
              <button
                key={d}
                type="button"
                className={`day-chip ${isSelected ? 'on' : ''} ${now?.today === d ? 'is-today' : ''}`}
                aria-pressed={isSelected}
                onClick={() => onSelectDay(d)}
                title={`${d} schedule (${info.totalSessions} sessions)`}
              >
                <span className="day-name">
                  <span className="day-full">{d}</span>
                  {now?.today === d && <span className="today-tag">Today</span>}
                  <span className="day-abbr">{formatDayShort(d)}</span>
                </span>
                <span className="day-badge">
                  <span className="badge-full">{info.totalSessions} sessions</span>
                  <span className="badge-abbr">{info.totalSessions} sess</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="daywise-actions">
          {/* Mode Switcher: Timeline is primary and first, By Batch is secondary and second */}
          <div className="mode-toggle" role="group" aria-label="View mode">
            <button
              type="button"
              className={`mode-btn ${mode === 'timeline' ? 'on' : ''}`}
              aria-pressed={mode === 'timeline'}
              onClick={() => setMode('timeline')}
              title="View as Period-by-Period Timeline"
            >
              <TimelineIcon />
              <span>Timeline</span>
            </button>
            <button
              type="button"
              className={`mode-btn ${mode === 'batch' ? 'on' : ''}`}
              aria-pressed={mode === 'batch'}
              onClick={() => setMode('batch')}
              title="Group by Year & Batch"
            >
              <GridIcon />
              <span>By Batch</span>
            </button>
          </div>

          {/* PDF Download */}
          <button
            type="button"
            className="day-export-btn"
            onClick={handleExport}
            disabled={exporting}
            title={`Download ${activeDay} schedule as PDF`}
          >
            <DownloadIcon />
            <span>{exporting ? 'Generating…' : 'Export PDF'}</span>
          </button>
        </div>
      </div>

      {/* Day Overview Metrics */}
      <div className="daywise-metrics rv">
        <div className="dm-card">
          <span className="dm-num">{currentStats.activeBatches.reduce((acc, g) => acc + g.batches.length, 0)}</span>
          <span className="dm-lbl">Active Batches</span>
        </div>
        <div className="dm-card">
          <span className="dm-num">{currentStats.totalSessions}</span>
          <span className="dm-lbl">Day Sessions</span>
        </div>
        <div className="dm-card">
          <span className="dm-num">{currentStats.mentors.size}</span>
          <span className="dm-lbl">Mentors on Duty</span>
        </div>
        <div className="dm-card">
          <span className="dm-num">{currentStats.halls.size}</span>
          <span className="dm-lbl">Halls in Use</span>
        </div>
      </div>

      {/* Main Content Area: Timeline mode (primary) or Batch mode */}
      {mode === 'timeline' && q && !timelineSlots.some(s => s.sessions.length) ? (
        <p className="empty">No classes match “{query.trim()}” on {activeDay}.</p>
      ) : mode === 'timeline' ? (
        <div className="daywise-timeline-mode">
          <div className="timeline-stream">
            {timelineSlots.map((slot) => {
              const hasClasses = slot.sessions.length > 0;
              const isGlobalLunch = slot.isLunch && !hasClasses;
              const onToday = now?.today === activeDay;
              const isNow = onToday && now.current === slot.slotIdx;
              const isNext = onToday && !isNow && now.next === slot.slotIdx;

              return (
                <div
                  key={slot.slotIdx}
                  className={`timeline-slot-row rv ${slot.isLunch ? 'is-lunch' : ''} ${hasClasses ? 'has-classes' : 'is-empty'} ${isNow ? 'is-now' : ''} ${isNext ? 'is-next' : ''}`}
                  aria-current={isNow ? 'time' : undefined}
                >
                  <div className="slot-timeline-header">
                    <div className="slot-pill">Slot {slot.slotIdx + 1}</div>
                    {isNow && <span className="now-tag">Now</span>}
                    {isNext && <span className="now-tag next">Next</span>}
                    <div className="slot-time-text">{slot.slotLabel}</div>
                    {hasClasses && (
                      <span className="slot-cnt-badge">
                        {slot.sessions.length} {slot.sessions.length > 1 ? 'Classes' : 'Class'}
                      </span>
                    )}
                  </div>

                  <div className="slot-timeline-body">
                    {isGlobalLunch && (
                      <div className="timeline-lunch-card">
                        <div className="lunch-icon">🍽️</div>
                        <div>
                          <h4>College Lunch Break</h4>
                          <p>Common lunch recess for all training batches and mentors</p>
                        </div>
                      </div>
                    )}

                    {hasClasses && (
                      <div className="slot-session-grid">
                        {slot.sessions.map((sess, si) => (
                          <div className="slot-session-card" key={si}>
                            <div className="sess-top">
                              <div className="sess-batch">
                                <span className="sess-group-tag">{sess.group}</span>
                                <strong>{sess.batch}</strong>
                                {sess.dept && <span className="tag dept">{sess.dept}</span>}
                              </div>
                              {sess.venue && (
                                <div className="sess-venue">
                                  <PinIcon />
                                  <span>{sess.venue}</span>
                                </div>
                              )}
                            </div>

                            <div className="sess-subject">{sess.subject}</div>

                            <div className="sess-mentors">
                              <div className="mentor-row">
                                <span className="lbl m">Main</span>
                                <span className="m-name">{sess.trainer}</span>
                              </div>
                              {sess.support && sess.support !== '—' && (
                                <div className="mentor-row">
                                  <span className="lbl s">Support</span>
                                  <span className="s-name">{sess.support}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {!hasClasses && !slot.isLunch && (
                      <div className="slot-free-card">
                        <span>No academic sessions scheduled in this slot</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* Batch Mode */
        <div className="daywise-batch-mode">
          {filterDayBatches(currentStats.activeBatches).length === 0 ? (
            <p className="empty">
              {q ? `No batches or sessions match “${q}” on ${activeDay}.` : `No academic sessions scheduled for ${activeDay}.`}
            </p>
          ) : (
            filterDayBatches(currentStats.activeBatches).map((g, gi) => (
              <div className="group rv" key={g.group}>
                <div className="group-head">
                  <span className={`yr ${gi === 0 ? 'hl' : ''}`}>{g.group}</span>
                  <span className="rule" />
                  <span className="cnt">{g.batches.length} {g.batches.length > 1 ? 'batches' : 'batch'} active</span>
                </div>

                <div className="grid-cards">
                  {g.batches.map(b => (
                    <article className="bcard day-bcard rv" key={b.id}>
                      <header>
                        <div>
                          <h3>{b.name}</h3>
                          <div className="meta">
                            {b.dept && <span className="tag dept">{b.dept}</span>}
                            <span className="tag day-tag">{activeDay}</span>
                          </div>
                        </div>
                        {!!b.count && (
                          <div className="cnt-b">
                            {b.count}<span>students</span>
                          </div>
                        )}
                      </header>

                      <div className="rows">
                        {b.dayRows.map((r, ri) => (
                          <div className="srow day-srow" key={ri}>
                            <div className="day-time-block">
                              <div className="time-val">{r.time}</div>
                              {r.slot && <span className="slot-badge">Slot {r.slot}</span>}
                            </div>
                            <div className="day-details">
                              <div className="subj">{r.subject}</div>
                              <div className="who">
                                <div>
                                  <span className="lbl m">Main</span>
                                  <span className="m">{r.trainer}</span>
                                </div>
                                {r.support && r.support !== '—' && (
                                  <div>
                                    <span className="lbl s">Support</span>
                                    <span className="s">{r.support}</span>
                                  </div>
                                )}
                              </div>
                              {r.venue && (
                                <div className="day-venue-tag">
                                  <PinIcon />
                                  <span>{r.venue}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
