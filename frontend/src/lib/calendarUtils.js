/**
 * calendarUtils.js
 * Comprehensive date, calendar grid, and monthly schedule intelligence utilities.
 */

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const MONTH_NAMES_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Checks if a specific date string (YYYY-MM-DD) falls within an optional tentative range [start, end].
 * If start or end are missing/empty, it assumes open-ended (continuous).
 */
export function isDateInRange(dateStr, startStr, endStr) {
  if (!dateStr) return false;
  if (startStr && dateStr < startStr) return false;
  if (endStr && dateStr > endStr) return false;
  return true;
}

/**
 * Checks if a batch overlaps with a given month (0-indexed month: 0 = Jan, 8 = Sep, 9 = Oct).
 */
export function isBatchActiveInMonth(batch, year, monthIndex) {
  if (!batch) return false;
  if (!batch.startDate && !batch.endDate) return true; // Ongoing

  const monthStart = `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const monthEnd = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  if (batch.startDate && batch.startDate > monthEnd) return false;
  if (batch.endDate && batch.endDate < monthStart) return false;
  return true;
}

/**
 * Formats a YYYY-MM-DD string into a human-friendly format (e.g., "Sep 30, 2026")
 */
export function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  return `${MONTH_NAMES_SHORT[m - 1]} ${d}, ${y}`;
}

/**
 * Formats a date range into a readable period string:
 * e.g., "Sep 1 – Oct 31, 2026" or "Sep 1 – Sep 30, 2026" or "Ongoing / All Year"
 */
export function formatDateRange(startStr, endStr) {
  if (!startStr && !endStr) return 'Ongoing';
  if (startStr && !endStr) return `From ${formatDateShort(startStr)}`;
  if (!startStr && endStr) return `Until ${formatDateShort(endStr)}`;

  const [sy, sm, sd] = startStr.split('-').map(Number);
  const [ey, em, ed] = endStr.split('-').map(Number);

  if (sy === ey) {
    if (sm === em) {
      if (sd === 1 && ed === new Date(sy, sm, 0).getDate()) {
        return `${MONTH_NAMES[sm - 1]} ${sy}`;
      }
      return `${MONTH_NAMES_SHORT[sm - 1]} ${sd} – ${ed}, ${sy}`;
    }
    return `${MONTH_NAMES_SHORT[sm - 1]} ${sd} – ${MONTH_NAMES_SHORT[em - 1]} ${ed}, ${sy}`;
  }
  return `${formatDateShort(startStr)} – ${formatDateShort(endStr)}`;
}

/**
 * Formats full human date: "Wednesday, September 30, 2026"
 */
export function formatDateLong(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const weekday = WEEKDAYS[((dateObj.getDay() + 6) % 7)];
  return `${weekday}, ${MONTH_NAMES[m - 1]} ${d}, ${y}`;
}

/**
 * Generates the full 7-column calendar grid for a given year and month (0-indexed).
 * Each cell includes date information, whether it is in the current month, today, weekend, etc.
 */
export function getMonthCalendarGrid(year, monthIndex, teachingDays = []) {
  /* "off" means not one of the configured teaching days (Sat/Sun by default) */
  const off = i => (teachingDays.length ? !teachingDays.includes(WEEKDAYS[i]) : i >= 5);
  const firstDayOfMonth = new Date(year, monthIndex, 1);
  const lastDayOfMonth = new Date(year, monthIndex + 1, 0);
  const totalDays = lastDayOfMonth.getDate();

  // Convert Sunday (0) to Monday-first (0 = Mon, 6 = Sun)
  const startDayOfWeek = (firstDayOfMonth.getDay() + 6) % 7;

  // Previous month trailing days
  const prevMonthLastDay = new Date(year, monthIndex, 0).getDate();
  const prevMonthDays = [];
  const prevYear = monthIndex === 0 ? year - 1 : year;
  const prevMonthIdx = monthIndex === 0 ? 11 : monthIndex - 1;

  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const dayNum = prevMonthLastDay - i;
    const dateStr = `${prevYear}-${String(prevMonthIdx + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    const dayOfWeekIdx = (new Date(prevYear, prevMonthIdx, dayNum).getDay() + 6) % 7;
    prevMonthDays.push({
      dateStr,
      dayNumber: dayNum,
      month: prevMonthIdx,
      year: prevYear,
      dayName: WEEKDAYS[dayOfWeekIdx],
      dayShort: WEEKDAYS_SHORT[dayOfWeekIdx],
      isCurrentMonth: false,
      isPrevMonth: true,
      isNextMonth: false,
      isWeekend: off(dayOfWeekIdx),
    });
  }

  // Current month days
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const currentMonthDays = [];
  for (let d = 1; d <= totalDays; d++) {
    const dateStr = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayOfWeekIdx = (new Date(year, monthIndex, d).getDay() + 6) % 7;
    currentMonthDays.push({
      dateStr,
      dayNumber: d,
      month: monthIndex,
      year,
      dayName: WEEKDAYS[dayOfWeekIdx],
      dayShort: WEEKDAYS_SHORT[dayOfWeekIdx],
      isCurrentMonth: true,
      isPrevMonth: false,
      isNextMonth: false,
      isToday: dateStr === todayStr,
      isWeekend: off(dayOfWeekIdx),
    });
  }

  // Next month leading days to complete row (to multiple of 7)
  const nextMonthDays = [];
  const nextYear = monthIndex === 11 ? year + 1 : year;
  const nextMonthIdx = monthIndex === 11 ? 0 : monthIndex + 1;
  const filledCount = prevMonthDays.length + currentMonthDays.length;
  const remainder = filledCount % 7;
  const daysNeeded = remainder === 0 ? 0 : 7 - remainder;

  for (let d = 1; d <= daysNeeded; d++) {
    const dateStr = `${nextYear}-${String(nextMonthIdx + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayOfWeekIdx = (new Date(nextYear, nextMonthIdx, d).getDay() + 6) % 7;
    nextMonthDays.push({
      dateStr,
      dayNumber: d,
      month: nextMonthIdx,
      year: nextYear,
      dayName: WEEKDAYS[dayOfWeekIdx],
      dayShort: WEEKDAYS_SHORT[dayOfWeekIdx],
      isCurrentMonth: false,
      isPrevMonth: false,
      isNextMonth: true,
      isWeekend: off(dayOfWeekIdx),
    });
  }

  return [...prevMonthDays, ...currentMonthDays, ...nextMonthDays];
}

/**
 * Extracts and derives all scheduled sessions running on a specific calendar date (dateStr).
 * Correctly checks batch tentative date ranges and individual session dates.
 */
/* The holiday covering `dateStr`, if any (exceptions come with /api/schedule). */
export function holidayOn(dateStr, exceptions = []) {
  return exceptions.find(e => e.type === 'holiday' && e.date <= dateStr && (e.endDate || e.date) >= dateStr) || null;
}

export function getClassesForDate(dateStr, scheduleData) {
  if (!dateStr || !scheduleData) return [];
  /* a holiday stops every class that day */
  if (holidayOn(dateStr, scheduleData.exceptions)) return [];
  const dayEx = new Map((scheduleData.exceptions || []).filter(e => e.date === dateStr && e.sessionId).map(e => [e.sessionId, e]));

  const [y, m, d] = dateStr.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const dayIndex = (dateObj.getDay() + 6) % 7; // 0 = Monday, 6 = Sunday
  const dayName = WEEKDAYS[dayIndex];

  /* the board only knows the configured teaching days; nothing runs on the others */
  const configDays = scheduleData.days || [];
  if (configDays.length && !configDays.includes(dayName)) return [];

  const classes = [];

  for (const batch of scheduleData.batches || []) {
    // 1. Check if the batch is tentatively active on this date
    if (!isDateInRange(dateStr, batch.startDate, batch.endDate)) {
      continue;
    }

    // 2. Check sessions of this batch
    const sessions = batch.sessions || [];
    for (const s of sessions) {
      if (s.day !== dayName) continue;

      // Check session-level tentative dates override if present
      const sessionStart = s.startDate || batch.startDate || '';
      const sessionEnd = s.endDate || batch.endDate || '';
      if (!isDateInRange(dateStr, sessionStart, sessionEnd)) {
        continue;
      }

      // Slot and timing details
      const slots = [...(s.slots || [])].sort((a, b) => a - b);
      const minSlot = slots.length ? slots[0] : 0;
      const maxSlot = slots.length ? slots[slots.length - 1] : 0;

      let timeLabel = '';
      if (scheduleData.slots && slots.length) {
        const startRaw = String(scheduleData.slots[minSlot] || '').split(/[–-]/)[0].trim();
        const endRaw = String(scheduleData.slots[maxSlot] || '').split(/[–-]/).pop().trim();
        if (startRaw && endRaw) {
          const meridiem = h => {
            const hr = parseInt(h.split(':')[0], 10);
            return hr >= 12 || hr <= 7 ? 'PM' : 'AM';   // 8–11 morning; 12 and 1–7 afternoon
          };
          timeLabel = `${startRaw} ${meridiem(startRaw)} – ${endRaw} ${meridiem(endRaw)}`;
        }
      }

      const slotLabel = slots.length > 1
        ? `Slot ${minSlot + 1}–${maxSlot + 1}`
        : `Slot ${minSlot + 1}`;

      /* one-off changes for this class on this date */
      const ex = dayEx.get(String(s._id));
      const swap = list => (ex?.type === 'substitute' ? list.map(n => (n === ex.fromTrainer ? ex.toTrainer : n)) : list);

      classes.push({
        cancelled: ex?.type === 'cancel',
        cancelReason: ex?.type === 'cancel' ? ex.label || '' : '',
        substitute: ex?.type === 'substitute' ? { from: ex.fromTrainer, to: ex.toTrainer, reason: ex.label || '' } : null,
        batchId: batch.id || batch._id || batch.name,
        batchName: batch.name,
        group: batch.group,
        dept: batch.dept || '',
        count: batch.count || 0,
        subject: s.subject,
        venue: s.venue || batch.venue || 'Unassigned',
        slots,
        slotStart: minSlot,
        slotLabel,
        time: timeLabel,
        mainTrainers: swap(s.mainTrainers || []),
        supportTrainers: swap(s.supportTrainers || []),
        startDate: sessionStart,
        endDate: sessionEnd,
      });
    }
  }

  // Sort sessions chronologically by starting slot
  classes.sort((a, b) => a.slotStart - b.slotStart || a.batchName.localeCompare(b.batchName));

  return classes;
}

/**
 * Computes monthly aggregated metrics for a specific month and year.
 */
export function getMonthStats(year, monthIndex, scheduleData, filterGroup = 'All') {
  if (!scheduleData) {
    return {
      totalDays: 0,
      trainingDays: 0,
      totalClasses: 0,
      activeBatchesCount: 0,
      activeMentorsCount: 0,
      activeVenuesCount: 0,
    };
  }

  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  let trainingDays = 0;
  let totalClasses = 0;
  const activeBatches = new Set();
  const activeMentors = new Set();
  const activeVenues = new Set();

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    /* a cancelled class still shows on the calendar, but it is not a class held */
    let classes = getClassesForDate(dateStr, scheduleData).filter(c => !c.cancelled);

    if (filterGroup !== 'All') {
      classes = classes.filter(c => c.group === filterGroup);
    }

    if (classes.length > 0) {
      trainingDays++;
      totalClasses += classes.length;
      classes.forEach(c => {
        activeBatches.add(c.batchName);
        if (c.venue && c.venue !== 'Unassigned') activeVenues.add(c.venue);
        (c.mainTrainers || []).forEach(m => activeMentors.add(m));
        (c.supportTrainers || []).forEach(s => activeMentors.add(s));
      });
    }
  }

  return {
    totalDays: daysInMonth,
    trainingDays,
    totalClasses,
    activeBatchesCount: activeBatches.size,
    activeMentorsCount: activeMentors.size,
    activeVenuesCount: activeVenues.size,
  };
}
