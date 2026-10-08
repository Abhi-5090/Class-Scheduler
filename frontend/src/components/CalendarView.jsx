import { useEffect, useMemo, useRef, useState } from 'react';
import { reveal } from '../lib/reveal.js';
import { exportMonthCalendarPDF } from '../lib/pdfExport.js';
import {
  MONTH_NAMES,
  MONTH_NAMES_SHORT,
  WEEKDAYS,
  WEEKDAYS_SHORT,
  getMonthCalendarGrid,
  getClassesForDate,
  getMonthStats,
  formatDateLong,
  formatDateRange,
} from '../lib/calendarUtils.js';
import { abbreviateVenue } from '../lib/abbreviate.js';
import {
  CalendarMonthIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GridIcon,
  TimelineIcon,
  DownloadIcon,
  SearchIcon,
  PinIcon,
} from './Icons.jsx';

export default function CalendarView({ data, admin }) {
  const host = useRef(null);

  // Opens on the current month
  const now = new Date();
  const [currentYear, setCurrentYear] = useState(() => now.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(() => now.getMonth()); // 0-indexed: 8 = Sep, 9 = Oct
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'agenda'
  const [groupFilter, setGroupFilter] = useState('All');
  const [query, setQuery] = useState('');
  const [inspectDay, setInspectDay] = useState(null); // date string 'YYYY-MM-DD' or null
  const [exporting, setExporting] = useState(false);

  // Selected date for day inspection panel (defaults to today if in month, or first day of month)
  const [selectedDate, setSelectedDate] = useState(() => {
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const thisMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (todayStr.startsWith(thisMonthPrefix)) {
      return todayStr;
    }
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  });

  useEffect(() => {
    reveal(host.current);
  }, [currentYear, currentMonth, viewMode, groupFilter, query, selectedDate]);

  // Steppers for Month Navigation
  const prevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(y => y - 1);
    } else {
      setCurrentMonth(m => m - 1);
    }
  };

  const nextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(y => y + 1);
    } else {
      setCurrentMonth(m => m + 1);
    }
  };

  /* The month picker spans every year a batch runs in, plus this year and the
     next, plus whatever year is on screen — so the arrows can never step off
     the end of the list. */
  const yearOptions = useMemo(() => {
    const ys = new Set([now.getFullYear(), now.getFullYear() + 1, currentYear]);
    for (const b of data.batches || []) {
      for (const v of [b.startDate, b.endDate]) if (v) ys.add(Number(v.slice(0, 4)));
    }
    return [...ys].filter(Number.isFinite).sort((a, b) => a - b);
  }, [data.batches, currentYear]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* last, this and next month, relative to today */
  const quickMonths = [-1, 0, 1].map(k => {
    const d = new Date(now.getFullYear(), now.getMonth() + k, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  const jumpTo = (year, monthIdx) => {
    setCurrentYear(year);
    setCurrentMonth(monthIdx);
  };

  const jumpToToday = () => {
    const today = new Date();
    setCurrentYear(today.getFullYear());
    setCurrentMonth(today.getMonth());
  };

  // Generate 7-column calendar matrix
  const calendarGrid = useMemo(() => {
    return getMonthCalendarGrid(currentYear, currentMonth, data.days);
  }, [currentYear, currentMonth]);

  // Pre-calculate classes for all days in the grid
  const dayClassesMap = useMemo(() => {
    const map = {};
    if (!data) return map;
    const q = query.trim().toLowerCase();

    for (const cell of calendarGrid) {
      let classes = getClassesForDate(cell.dateStr, data);

      if (groupFilter !== 'All') {
        classes = classes.filter(c => c.group === groupFilter);
      }

      if (q) {
        classes = classes.filter(c => {
          return c.batchName.toLowerCase().includes(q) ||
            c.subject.toLowerCase().includes(q) ||
            c.venue.toLowerCase().includes(q) ||
            (c.dept && c.dept.toLowerCase().includes(q)) ||
            (c.mainTrainers || []).some(m => m.toLowerCase().includes(q)) ||
            (c.supportTrainers || []).some(s => s.toLowerCase().includes(q));
        });
      }

      map[cell.dateStr] = classes;
    }
    return map;
  }, [calendarGrid, data, groupFilter, query]);

  // Monthly summary metrics
  const monthStats = useMemo(() => {
    return getMonthStats(currentYear, currentMonth, data, groupFilter);
  }, [currentYear, currentMonth, data, groupFilter]);

  // List of unique year groups in schedule
  const availableGroups = useMemo(() => {
    if (!data?.groups) return [];
    return data.groups.map(g => g.group);
  }, [data]);

  // Handle PDF Download
  const handleExportPDF = () => {
    if (!data) return;
    setExporting(true);
    try {
      exportMonthCalendarPDF(data, currentYear, currentMonth, groupFilter);
    } catch (e) {
      console.error('Failed to export monthly PDF', e);
    } finally {
      setExporting(false);
    }
  };

  // Synchronize selectedDate when currentYear or currentMonth changes
  useEffect(() => {
    const prefix = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
    if (selectedDate && selectedDate.startsWith(prefix)) return;

    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (todayStr.startsWith(prefix)) {
      setSelectedDate(todayStr);
      return;
    }
    const firstActive = calendarGrid.find(c => c.isCurrentMonth && (dayClassesMap[c.dateStr] || []).length > 0);
    if (firstActive) {
      setSelectedDate(firstActive.dateStr);
    } else {
      setSelectedDate(`${prefix}-01`);
    }
  }, [currentYear, currentMonth, calendarGrid, dayClassesMap]);

  // Classes for the currently selected date (for quick preview panel)
  const selectedDayClasses = selectedDate ? (dayClassesMap[selectedDate] || []) : [];

  // Day click handler: sets selectedDate; opens modal on desktop or on double-tap
  const handleDayClick = (dateStr) => {
    if (selectedDate === dateStr) {
      setInspectDay(dateStr);
    } else {
      setSelectedDate(dateStr);
      if (typeof window !== 'undefined' && window.innerWidth > 680) {
        setInspectDay(dateStr);
      }
    }
  };

  // Inspect day details
  const inspectedDayClasses = inspectDay ? (dayClassesMap[inspectDay] || []) : [];

  // Helper for Year Group class tags
  const getGroupClass = (groupName) => {
    const g = String(groupName || '').toLowerCase();
    if (g.includes('final')) return 'final-year';
    if (g.includes('third')) return 'third-year';
    if (g.includes('second')) return 'second-year';
    if (g.includes('first')) return 'first-year';
    return '';
  };

  return (
    <div className="cal-view" ref={host}>
      {/* ── Calendar Navigation & Control Sub-bar ── */}
      <div className="cal-subbar rv">
        {/* Left: Month Stepper & Quick Month Select */}
        <div className="cal-month-stepper">
          <button
            type="button"
            className="cal-step-btn"
            onClick={prevMonth}
            title="Previous Month"
            aria-label="Previous Month"
          >
            <ChevronLeftIcon />
          </button>

          <div className="cal-month-title-wrap">
            <h3 className="cal-month-heading">
              {MONTH_NAMES[currentMonth]} {currentYear}
            </h3>

            <select
              className="cal-month-select"
              value={`${currentYear}-${currentMonth}`}
              onChange={e => {
                const [y, m] = e.target.value.split('-').map(Number);
                jumpTo(y, m);
              }}
              title="Select Month & Year"
            >
              {yearOptions.map(y =>
                MONTH_NAMES.map((name, mIdx) => (
                  <option key={`${y}-${mIdx}`} value={`${y}-${mIdx}`}>
                    {name} {y}
                  </option>
                ))
              )}
            </select>
          </div>

          <button
            type="button"
            className="cal-step-btn"
            onClick={nextMonth}
            title="Next Month"
            aria-label="Next Month"
          >
            <ChevronRightIcon />
          </button>
        </div>

        {/* Center: quick shortcuts to last, this and next month */}
        <div className="cal-quick-chips">
          {quickMonths.map(q => (
            <button
              key={`${q.y}-${q.m}`}
              type="button"
              className={`cal-chip ${currentYear === q.y && currentMonth === q.m ? 'on' : ''}`}
              onClick={() => jumpTo(q.y, q.m)}
            >
              {MONTH_NAMES[q.m]} {q.y}
            </button>
          ))}
          <button
            type="button"
            className="cal-chip today-btn"
            onClick={jumpToToday}
            title="Go to Today's date"
          >
            Today
          </button>
        </div>

        {/* Right: View Mode Toggle & PDF Export */}
        <div className="cal-actions">
          <div className="cal-view-modes" role="group" aria-label="Calendar view mode">
            <button
              type="button"
              className={`cal-mode-btn ${viewMode === 'grid' ? 'on' : ''}`}
              onClick={() => setViewMode('grid')}
            >
              <GridIcon /> Month Grid
            </button>
            <button
              type="button"
              className={`cal-mode-btn ${viewMode === 'agenda' ? 'on' : ''}`}
              onClick={() => setViewMode('agenda')}
            >
              <TimelineIcon /> Agenda List
            </button>
          </div>

          <button
            type="button"
            className="btn-pdf"
            onClick={handleExportPDF}
            disabled={exporting}
            title="Download Monthly Schedule PDF"
          >
            <DownloadIcon />
            {exporting ? 'Generating PDF…' : 'Export Month (PDF)'}
          </button>
        </div>
      </div>

      {/* ── Integrated Batch Group Filters & Search ── */}
      <div className="cal-filter-bar rv">
        <div className="cal-group-chips" role="group" aria-label="Filter calendar by Year Group">
          <button
            type="button"
            className={`cal-group-chip ${groupFilter === 'All' ? 'on' : ''}`}
            onClick={() => setGroupFilter('All')}
          >
            All Batches
          </button>
          {availableGroups.map(g => (
            <button
              key={g}
              type="button"
              className={`cal-group-chip ${getGroupClass(g)} ${groupFilter === g ? 'on' : ''}`}
              onClick={() => setGroupFilter(g)}
            >
              {g}
            </button>
          ))}
        </div>

        <div className="cal-search-wrap">
          <SearchIcon />
          <input
            type="text"
            className="cal-search-input"
            placeholder="Search batch, subject, hall, mentor…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              className="cal-search-clear"
              onClick={() => setQuery('')}
              title="Clear search"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* ── Monthly Summary Metric Cards ── */}
      <div className="cal-metrics rv">
        <div className="cal-stat">
          <div className="n">{monthStats.totalDays}</div>
          <div className="l">Month Days</div>
        </div>
        <div className="cal-stat">
          <div className="n">{monthStats.trainingDays}</div>
          <div className="l">Active Training Days</div>
        </div>
        <div className="cal-stat">
          <div className="n">{monthStats.totalClasses}</div>
          <div className="l">Classes Scheduled</div>
        </div>
        <div className="cal-stat dark">
          <div className="n">{monthStats.activeBatchesCount}</div>
          <div className="l">Batches Training</div>
        </div>
        <div className="cal-stat dark">
          <div className="n">{monthStats.activeMentorsCount}</div>
          <div className="l">Mentors Deployed</div>
        </div>
        <div className="cal-stat">
          <div className="n">{monthStats.activeVenuesCount}</div>
          <div className="l">Halls Utilized</div>
        </div>
      </div>

      {/* ── Grid View: Full 7-Day Month Matrix ── */}
      {viewMode === 'grid' && (
        <>
          <div className="cal-grid-wrapper rv">
            {/* Weekday Column Headers */}
            <div className="cal-weekdays">
              {WEEKDAYS.map((day, idx) => (
                <div key={day} className={`cal-weekday ${data.days.includes(day) ? '' : 'weekend'}`}>
                  <span className="name-full">{day}</span>
                  <span className="name-abbr">{WEEKDAYS_SHORT[idx]}</span>
                </div>
              ))}
            </div>

            {/* 7-column calendar day cells */}
            <div className="cal-grid-matrix">
              {calendarGrid.map((cell) => {
                const classes = dayClassesMap[cell.dateStr] || [];
                const hasClasses = classes.length > 0;
                const maxDisplay = 3;
                const visibleClasses = classes.slice(0, maxDisplay);
                const overflowCount = classes.length - maxDisplay;
                const isSelected = cell.dateStr === selectedDate;

                return (
                  <div
                    key={cell.dateStr}
                    className={`cal-day ${cell.isCurrentMonth ? '' : 'out-month'} ${cell.isToday ? 'is-today' : ''} ${cell.isWeekend ? 'weekend-day' : ''} ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => handleDayClick(cell.dateStr)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => { if (e.key === 'Enter') handleDayClick(cell.dateStr); }}
                    title={`View schedule for ${cell.dateStr} (${classes.length} class${classes.length === 1 ? '' : 'es'})`}
                  >
                    <div className="cal-day-head">
                      <span className="cal-day-num">{cell.dayNumber}</span>
                      {hasClasses ? (
                        <span className="cal-day-classes-badge">
                          {classes.length} {classes.length === 1 ? 'class' : 'classes'}
                        </span>
                      ) : cell.isWeekend ? (
                        <span className="cal-day-weekend-label">Off</span>
                      ) : null}
                    </div>

                    {/* Mobile Compact Class Indicator (Visible on mobile <= 680px) */}
                    <div className="cal-mobile-indicator">
                      {hasClasses ? (
                        <>
                          <div className="cal-mobile-dots">
                            {visibleClasses.slice(0, 3).map((c, i) => (
                              <span key={i} className={`cal-mob-dot ${getGroupClass(c.group)}`} />
                            ))}
                          </div>
                          <span className="cal-mob-count">{classes.length}</span>
                        </>
                      ) : cell.isWeekend ? (
                        <span className="cal-mob-weekend-off">Off</span>
                      ) : null}
                    </div>

                    {/* Desktop Full Class Chips (Hidden on mobile <= 680px) */}
                    <div className="cal-desktop-classes">
                      {visibleClasses.map((c, i) => (
                        <div key={i} className={`cal-class-chip ${getGroupClass(c.group)}`}>
                          <div className="cal-chip-top">
                            <span className="cal-chip-slot">{c.slotLabel}</span>
                            <span className="cal-chip-hall">{abbreviateVenue(c.venue)}</span>
                          </div>
                          <div className="cal-chip-subj">{c.subject}</div>
                          <div className="cal-chip-batch">{c.batchName}</div>
                        </div>
                      ))}

                      {overflowCount > 0 && (
                        <div className="cal-more-classes">
                          +{overflowCount} more class{overflowCount === 1 ? '' : 'es'}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Selected Day Schedule Section: Immediately accessible below grid on mobile and desktop */}
          {selectedDate && (
            <div className="cal-day-panel rv">
              <div className="cal-day-panel-head">
                <div>
                  <h4 className="cal-day-panel-title">
                    {formatDateLong(selectedDate)}
                  </h4>
                  <div className="cal-day-panel-meta">
                    <span className="cal-panel-pill">
                      <b>{selectedDayClasses.length}</b> {selectedDayClasses.length === 1 ? 'class' : 'classes'} scheduled
                    </span>
                    {selectedDayClasses.length > 0 && (
                      <span className="cal-panel-pill">
                        <b>{new Set(selectedDayClasses.flatMap(c => c.mainTrainers || [])).size}</b> mentors
                      </span>
                    )}
                    {selectedDayClasses.length > 0 && (
                      <span className="cal-panel-pill">
                        <b>{new Set(selectedDayClasses.map(c => c.venue)).size}</b> halls
                      </span>
                    )}
                  </div>
                </div>

                {selectedDayClasses.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm cal-panel-more-btn"
                    onClick={() => setInspectDay(selectedDate)}
                  >
                    Full Details Modal ↗
                  </button>
                )}
              </div>

              {!selectedDayClasses.length ? (
                <div className="cal-day-panel-empty">
                  <p>No training sessions scheduled for {formatDateLong(selectedDate)}.</p>
                  <span>
                    {!data.days.includes(WEEKDAYS[(new Date(selectedDate + 'T00:00:00').getDay() + 6) % 7])
                      ? 'Not a teaching day — no faculty or batches allocated.'
                      : 'Classes may be inactive or outside the tentative training dates.'}
                  </span>
                </div>
              ) : (
                <div className="cal-day-panel-cards">
                  {selectedDayClasses.map((c, i) => (
                    <div key={i} className={`cal-day-card ${getGroupClass(c.group)}`}>
                      <div className="cal-day-card-top">
                        <div className="cal-card-time-wrap">
                          <span className="cal-card-slot">{c.slotLabel}</span>
                          <span className="cal-card-time">{c.time}</span>
                        </div>
                        <span className="tag dept">{c.group}</span>
                      </div>
                      <div className="cal-day-card-subj">{c.subject}</div>
                      <div className="cal-day-card-batch">
                        <b>{c.batchName}</b>
                        {c.dept && <span> · Dept: {c.dept}</span>}
                        {c.count > 0 && <span> · ({c.count} students)</span>}
                      </div>
                      <div className="cal-day-card-meta">
                        <div className="meta-item">
                          <span className="lbl">Hall:</span>
                          <span className="val">📍 {c.venue}</span>
                        </div>
                        <div className="meta-item">
                          <span className="lbl">Mentors:</span>
                          <span className="val">
                            👨‍🏫 {(c.mainTrainers || []).join(', ') || 'TBA'}
                            {!!(c.supportTrainers || []).length && ` · (Support: ${c.supportTrainers.join(', ')})`}
                          </span>
                        </div>
                      </div>
                      {(c.startDate || c.endDate) && (
                        <div className="cal-day-card-window">
                          📅 Tentative Window: {formatDateRange(c.startDate, c.endDate)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Agenda View: Chronological Day-by-Day List ── */}
      {viewMode === 'agenda' && (
        <div className="cal-agenda-list rv">
          {calendarGrid.filter(c => c.isCurrentMonth).map((cell) => {
            const classes = dayClassesMap[cell.dateStr] || [];
            if (!classes.length) return null;

            return (
              <div key={cell.dateStr} className={`cal-agenda-day ${cell.isToday ? 'is-today' : ''}`}>
                <div className="cal-agenda-day-head">
                  <div className="cal-agenda-day-title">
                    <h3>{cell.dayName}</h3>
                    <span className="cal-agenda-date-badge">
                      {MONTH_NAMES[cell.month]} {cell.dayNumber}, {cell.year}
                    </span>
                    {cell.isToday && <span className="pill-tag" style={{ background: 'var(--accent)', color: '#fff' }}>Today</span>}
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setInspectDay(cell.dateStr)}
                  >
                    View Day Breakdown ({classes.length} classes) →
                  </button>
                </div>

                <div className="cal-agenda-grid">
                  {classes.map((c, i) => (
                    <div key={i} className={`cal-agenda-card ${getGroupClass(c.group)}`}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                        <span className="cal-chip-slot">{c.slotLabel} · {c.time}</span>
                        <span className="tag" style={{ fontSize: 10, background: 'var(--accent-tint)', color: 'var(--accent-deep)' }}>
                          {c.group}
                        </span>
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>{c.subject}</div>
                      <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>{c.batchName}</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, fontSize: 12, color: 'var(--ink-2)' }}>
                        <span>📍 {c.venue}</span>
                        <span>👨‍🏫 {(c.mainTrainers || []).join(', ') || 'TBA'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Interactive Day Detail Inspector Modal ── */}
      {inspectDay && (
        <div className="modal-back" onClick={() => setInspectDay(null)}>
          <div
            className="modal"
            style={{ maxWidth: 740 }}
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="cal-modal-day-head">
              <div className="cal-modal-day-title">
                <h2>{formatDateLong(inspectDay)}</h2>
                <span>Institutional Training Schedule & Mentor Assignments</span>
              </div>
              <div className="cal-modal-pills">
                <span className="cal-modal-pill">
                  <b>{inspectedDayClasses.length}</b> Classes
                </span>
                <span className="cal-modal-pill">
                  <b>{new Set(inspectedDayClasses.flatMap(c => c.mainTrainers || [])).size}</b> Mentors
                </span>
                <span className="cal-modal-pill">
                  <b>{new Set(inspectedDayClasses.map(c => c.venue)).size}</b> Halls
                </span>
              </div>
            </div>

            {!inspectedDayClasses.length ? (
              <div className="empty-state" style={{ padding: '36px 20px' }}>
                <h3>No classes scheduled for this date</h3>
                <p>There are no active batches training on {formatDateLong(inspectDay)}.</p>
              </div>
            ) : (
              <div className="cal-modal-sessions">
                {inspectedDayClasses.map((c, i) => (
                  <div key={i} className="cal-modal-session-card">
                    <div className="cal-modal-sess-top">
                      <div>
                        <h4 className="cal-modal-sess-title">{c.subject}</h4>
                        <div className="cal-modal-sess-batch">
                          <b>{c.batchName}</b>
                          {c.dept && <span> · Dept: {c.dept}</span>}
                          <span> · Year: {c.group}</span>
                          {c.count > 0 && <span> · ({c.count} students)</span>}
                        </div>
                      </div>
                      <span className="cal-modal-sess-time">
                        {c.slotLabel} · {c.time}
                      </span>
                    </div>

                    <div className="cal-modal-sess-body">
                      <div className="cal-modal-sess-item">
                        <span className="label">Training Hall</span>
                        <span className="val">📍 {c.venue}</span>
                      </div>
                      <div className="cal-modal-sess-item">
                        <span className="label">Main Mentor</span>
                        <span className="val">
                          {(c.mainTrainers || []).join(', ') || <span className="muted">To be assigned</span>}
                        </span>
                      </div>
                      {!!(c.supportTrainers || []).length && (
                        <div className="cal-modal-sess-item">
                          <span className="label">Support Mentor</span>
                          <span className="val">{(c.supportTrainers || []).join(', ')}</span>
                        </div>
                      )}
                    </div>

                    {(c.startDate || c.endDate) && (
                      <div className="cal-modal-period-badge">
                        📅 Tentative Training Window: {formatDateRange(c.startDate, c.endDate)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="modal-foot">
              <span className="spacer" />
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setInspectDay(null)}
              >
                Close Breakdown
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
