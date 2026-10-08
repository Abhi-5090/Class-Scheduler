/*
 * Everything the board renders is computed here from one source of truth:
 * the sessions stored on each batch. The admin never hand-edits a trainer
 * grid or a hall grid, so the three views cannot drift apart.
 */

import { today, rangeStatus, sessionRange } from './dates.js';

/* Slot labels are written 12-hour without AM/PM ("9:00–9:50", "1:40–2:30").
   A college day runs roughly 8 AM to 7 PM, so 8–11 is morning and 12 and
   1–7 are afternoon. A label already in 24-hour form (13:00+) is read as PM. */
function meridiem(hhmm) {
  const hour = parseInt(hhmm.split(':')[0], 10);
  return hour >= 12 || hour <= 7 ? 'PM' : 'AM';
}

function stamp(hhmm) {
  return `${hhmm} ${meridiem(hhmm)}`;
}

/* '9:00–9:50' + '9:50–10:50' -> '9:00 AM – 10:50 AM' */
export function timeLabel(slots, indexes) {
  const lo = Math.min(...indexes), hi = Math.max(...indexes);
  const start = String(slots[lo] || '').split(/[–-]/)[0].trim();
  const end = String(slots[hi] || '').split(/[–-]/).pop().trim();
  if (!start || !end) return '';
  return `${stamp(start)} – ${stamp(end)}`;
}

/* Slots are stored zero-based but everyone at the college counts from 1. */
export function slotLabel(indexes) {
  const sorted = [...indexes].sort((a, b) => a - b).map(i => i + 1);
  return sorted.length > 1
    ? `${sorted[0]}–${sorted[sorted.length - 1]}`
    : String(sorted[0]);
}

/**
 * Calculates unique enrolled students by deduplicating student cohorts
 * across multiple subject modules or tracks within each year group and section.
 */
export function calculateUniqueStudents(batches = []) {
  if (!Array.isArray(batches)) return 0;
  const byGroup = {};
  for (const b of batches) {
    const grp = (b.group || 'Default').trim();
    if (!byGroup[grp]) byGroup[grp] = [];
    byGroup[grp].push(b);
  }

  let totalUnique = 0;
  for (const groupBatches of Object.values(byGroup)) {
    const sectionMap = {};
    for (const b of groupBatches) {
      const count = Number(b.count) || 0;
      const dept = (b.dept || '').trim().toLowerCase();
      let sectionKey = '';
      if (dept) {
        sectionKey = 'dept:' + dept;
      } else {
        const match = (b.name || '').match(/(batch\s*[-_]?\s*[0-9]+|sec\s*[-_]?\s*[a-z0-9]+|section\s*[-_]?\s*[a-z0-9]+)/i);
        if (match) {
          sectionKey = 'sec:' + match[1].toLowerCase().replace(/\s+/g, '');
        } else {
          sectionKey = 'name:' + (b.name || '').trim().toLowerCase();
        }
      }
      if (!sectionMap[sectionKey] || count > sectionMap[sectionKey]) {
        sectionMap[sectionKey] = count;
      }
    }
    totalUnique += Object.values(sectionMap).reduce((a, c) => a + c, 0);
  }
  return totalUnique;
}

function emptyGrid(days, slotCount) {
  const g = {};
  for (const d of days) g[d] = Array(slotCount).fill('');
  return g;
}

/* Sessions that differ only by day are written as one row, the way the
   original board read "Monday – Wednesday" instead of three separate lines. */
function collapseRows(sessions, config) {
  const { slots, days } = config;
  const buckets = new Map();

  for (const s of sessions) {
    const slotList = [...s.slots].sort((a, b) => a - b);
    const key = JSON.stringify([
      slotList, s.subject, s.venue || '',
      [...(s.mainTrainers || [])], [...(s.supportTrainers || [])],
      s.startDate || '', s.endDate || '',
    ]);
    if (!buckets.has(key)) buckets.set(key, { session: s, slotList, dayIdx: [] });
    const idx = days.indexOf(s.day);
    if (idx !== -1) buckets.get(key).dayIdx.push(idx);
  }

  const rows = [];
  for (const { session, slotList, dayIdx } of buckets.values()) {
    const sorted = [...new Set(dayIdx)].sort((a, b) => a - b);
    if (!sorted.length) continue;                   // every day it named has left the grid

    /* walk the sorted day indexes, breaking into runs of consecutive days */
    let run = [sorted[0]];
    const runs = [];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === sorted[i - 1] + 1) run.push(sorted[i]);
      else { runs.push(run); run = [sorted[i]]; }
    }
    if (run.length) runs.push(run);

    for (const r of runs) {
      const main = session.mainTrainers || [];
      const support = session.supportTrainers || [];
      rows.push({
        day: r.length > 1 ? `${days[r[0]]} – ${days[r[r.length - 1]]}` : days[r[0]],
        dayIndexes: r,
        time: timeLabel(slots, slotList),
        slot: slotLabel(slotList),
        slots: slotList,
        subject: session.subject,
        venue: session.venue || '',
        trainer: main.length ? main.join(', ') : 'To be assigned',
        support: support.length ? support.join(', ') : '—',
        mainList: main,
        supportList: support,
        startDate: session.startDate || '',
        endDate: session.endDate || '',
      });
    }
  }

  const dayRank = r => Math.min(...r.dayIndexes);
  rows.sort((a, b) => dayRank(a) - dayRank(b) || a.slots[0] - b.slots[0]);
  return rows;
}

/*
 * Builds the whole payload the board consumes.
 * `config` is { slots, days, lunchIndex }.
 */
export function buildSchedule({ config, groups, trainers, venues, batches, activities = [], on = today() }) {
  const { slots, days, lunchIndex } = config;
  const slotCount = slots.length;

  /* ── batch cards, grouped by year ──
     Every batch is listed (the monthly calendar needs past and future ones),
     each tagged upcoming / current / ended for `on`. The weekly views — the
     year cards and every trainer and hall grid below — only take what is
     running on `on`, so a finished or not-yet-started batch never shows up
     as this week's class or blocks a trainer's free period. */
  const isLive = (s, b) => {
    const { start, end } = sessionRange(s, b);
    return rangeStatus(start, end, on) === 'current';
  };

  const batchCards = batches.map(b => {
    const batchSessions = (b.sessions || []).map(s => {
      const { start, end } = sessionRange(s, b);
      return { ...s, venue: s.venue || '', startDate: start, endDate: end };
    });
    const liveSessions = batchSessions.filter(s => rangeStatus(s.startDate, s.endDate, on) === 'current');
    const statuses = batchSessions.map(s => rangeStatus(s.startDate, s.endDate, on));
    const status = (b.startDate || b.endDate) ? rangeStatus(b.startDate || '', b.endDate || '', on)
      : statuses.includes('current') || !statuses.length ? 'current'
      : statuses.includes('upcoming') ? 'upcoming' : 'ended';

    const rows = collapseRows(status === 'current' ? liveSessions : batchSessions, config);
    /* A batch can meet in different halls on different days now, so there is
       no single "the" venue any more — just the distinct set actually in use,
       read off the rows so it always agrees with what's displayed. */
    const venues = [...new Set(rows.map(r => r.venue).filter(Boolean))];
    return {
      id: String(b._id || b.id || b.name),
      name: b.name,
      group: b.group,
      dept: b.dept || '',
      venues,
      count: b.count || 0,
      order: Number(b.order) || 0,
      startDate: b.startDate || '',
      endDate: b.endDate || '',
      status,
      rows,
      sessions: batchSessions,
    };
  });

  const ordered = [...groups].sort((a, b) => (a.order || 0) - (b.order || 0));
  const groupViews = ordered
    .filter(g => !g.pending)
    .map(g => ({
      group: g.name,
      batches: batchCards
        .filter(b => b.group === g.name && b.status === 'current' && b.rows.length)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name)),
    }))
    .filter(g => g.batches.length);

  /* what is off this week's board and why, so the board can say so */
  const offBoard = batchCards
    .filter(b => b.status !== 'current')
    .map(b => ({ name: b.name, group: b.group, status: b.status, startDate: b.startDate, endDate: b.endDate }));

  const upcoming = ordered
    .filter(g => g.pending)
    .map(g => ({ group: g.name, note: g.note || '' }));

  /* ── trainer grids ── */
  const tGrid = {}, tRole = {}, tVenue = {};
  const ensureTrainer = name => {
    if (!tGrid[name]) {
      tGrid[name] = emptyGrid(days, slotCount);
      tRole[name] = emptyGrid(days, slotCount);
      tVenue[name] = emptyGrid(days, slotCount);
    }
  };
  for (const t of trainers) ensureTrainer(t.name);

  /* ── venue grids ── */
  const vGrid = {};
  for (const v of venues) vGrid[v.name] = emptyGrid(days, slotCount);

  /* One pass over every session fills both sets of grids and records any
     cell that two batches are fighting over. */
  const conflicts = [];
  const claim = (bucket, key, day, i, batchName, kind) => {
    const held = bucket[key][day][i];
    if (held && held !== batchName) {
      conflicts.push({ kind, subject: key, day, slot: slots[i], slotIndex: i, batches: [held, batchName] });
    }
    bucket[key][day][i] = batchName;
  };

  for (const b of batches) {
    for (const s of b.sessions || []) {
      if (!days.includes(s.day) || !isLive(s, b)) continue;
      const main = s.mainTrainers || [], support = s.supportTrainers || [];
      const venueName = s.venue || '';

      for (const name of main) {
        ensureTrainer(name);
        for (const i of s.slots) {
          if (i < 0 || i >= slotCount) continue;
          claim(tGrid, name, s.day, i, b.name, 'trainer');
          tRole[name][s.day][i] = 'main';
          if (venueName) tVenue[name][s.day][i] = venueName;
        }
      }
      for (const name of support) {
        ensureTrainer(name);
        for (const i of s.slots) {
          if (i < 0 || i >= slotCount) continue;
          claim(tGrid, name, s.day, i, b.name, 'trainer');
          tRole[name][s.day][i] = 'support';
          if (venueName) tVenue[name][s.day][i] = venueName;
        }
      }
      if (venueName && vGrid[venueName]) {
        for (const i of s.slots) {
          if (i < 0 || i >= slotCount) continue;
          claim(vGrid, venueName, s.day, i, b.name, 'venue');
        }
      }
    }
  }

  /* A logged activity (lunch taken outside the standard break, or anything
     else — design work, social media, requirements gathering) fills in a
     trainer's own free time. A real class always wins: this only touches a
     cell that no session has already claimed, so a note can never mask one. */
  for (const a of activities) {
    if (!days.includes(a.day) || a.slot < 0 || a.slot >= slotCount) continue;
    ensureTrainer(a.trainer);
    if (tGrid[a.trainer][a.day][a.slot]) continue;              // a class already owns it
    tGrid[a.trainer][a.day][a.slot] = a.kind === 'lunch' ? 'Lunch' : (a.label || 'Other');
    tRole[a.trainer][a.day][a.slot] = a.kind;                    // 'lunch' | 'other'
  }

  /* Lunch is a break for everyone, so it is neither free nor occupied. It is
     stamped in only where no class was booked over it — First Year's slot 3–4
     sessions legitimately run through 11:50–12:50. */
  const summarise = (grid, withRoles) => {
    const free = {};
    let totalFree = 0, mainCount = 0, supportCount = 0, totalBusy = 0, lunchCount = 0, otherCount = 0;
    const activitiesBreakdown = {};
    const trainingsBreakdown = {};

    for (const d of days) {
      free[d] = [];
      for (let i = 0; i < slotCount; i++) {
        const v = grid[d][i];
        if (i === lunchIndex && !v) { grid[d][i] = 'Lunch Break'; continue; }
        if (!v) { free[d].push(slots[i]); totalFree++; continue; }
        totalBusy++;
        if (withRoles) {
          const role = withRoles[d][i];
          if (role === 'support') {
            supportCount++;
            if (v) trainingsBreakdown[v] = (trainingsBreakdown[v] || 0) + 1;
          } else if (role === 'main') {
            mainCount++;
            if (v) trainingsBreakdown[v] = (trainingsBreakdown[v] || 0) + 1;
          } else if (role === 'lunch') {
            lunchCount++;
          } else if (role === 'other') {
            otherCount++;
            const label = v || 'Assigned Task';
            activitiesBreakdown[label] = (activitiesBreakdown[label] || 0) + 1;
          }
        }
      }
    }
    const totalTrainings = mainCount + supportCount;
    return {
      free, totalFree, totalBusy, totalTrainings, mainCount, supportCount,
      trainingsBreakdown, lunchCount, otherCount, activitiesBreakdown,
    };
  };

  const trainerViews = trainers.map(t => {
    const grid = tGrid[t.name], roles = tRole[t.name], venues = tVenue[t.name];
    const s = summarise(grid, roles);
    return {
      id: String(t._id || t.id || t.name),
      name: t.name,
      track: (t.track === 'non-teaching' || t.track === 'non-technical') ? 'non-teaching' : 'teaching',
      grid, roles, venues,
      free: s.free, totalFree: s.totalFree, totalBusy: s.totalBusy,
      totalTrainings: s.totalTrainings,
      trainingsBreakdown: s.trainingsBreakdown,
      mainCount: s.mainCount, supportCount: s.supportCount,
      lunchCount: s.lunchCount, otherCount: s.otherCount,
      activitiesBreakdown: s.activitiesBreakdown,
    };
  });

  const venueViews = venues.map(v => {
    const grid = vGrid[v.name];
    const s = summarise(grid, null);
    return {
      id: String(v._id || v.id || v.name),
      name: v.name, grid,
      free: s.free, totalFree: s.totalFree, totalBusy: s.totalBusy,
    };
  });

  return {
    slots, days, lunchIndex,
    trainers: trainerViews,
    venues: venueViews,
    batches: batchCards,
    groups: groupViews,
    upcoming,
    conflicts,
    offBoard,
    today: on,
    uniqueStudents: calculateUniqueStudents(batchCards.filter(b => b.status === 'current')),
  };
}
