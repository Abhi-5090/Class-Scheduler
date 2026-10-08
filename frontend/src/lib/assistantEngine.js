/**
 * RAG Schedule Assistant
 * Professional, institutional schedule intelligence engine.
 * Delivers clear, structured, and accurate responses directly from the live database.
 */

import { calculateUniqueStudents } from './studentStats.js';

// ── Text Normalization & Cleaning ──
function norm(str) {
  return String(str || '')
    .toLowerCase()
    .trim()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?"']/g, ' ')
    .replace(/\s+/g, ' ');
}

function cleanQuery(str) {
  let q = norm(str);
  q = q.replace(/\b(sir|madam|mam|maam|miss|mr|mrs|dr|prof|professor|mentor|trainer|teacher|faculty)\b/g, ' ');
  q = q.replace(/\b(please|can you|tell me|what is|whats|show me|give me|check|find|who is|where is|when is|schedule of|timetable of|schedule for|timetable for|details of|classes of|class of|on|at|in|the)\b/g, ' ');
  return q.replace(/\s+/g, ' ').trim();
}

function hasAny(q, ...keywords) {
  const nq = norm(q);
  return keywords.some(k => {
    const nk = norm(k);
    if (!nk) return false;
    const regex = new RegExp(`\\b${nk}\\b`, 'i');
    return regex.test(nq) || nq.includes(nk);
  });
}

/* Does a row cover `day`? A row can stand for a run ("Monday – Wednesday"),
   so it is matched on the day positions it spans, not the words in its label. */
function covers(r, day, days = []) {
  if (Array.isArray(r.dayIndexes)) return r.dayIndexes.some(i => days[i] === day);
  return String(r.day || '').toLowerCase().includes(String(day).toLowerCase());
}

// ── Temporal Extractors ──
function extractDay(q, days = []) {
  const nq = norm(q);
  const dayMap = [
    { patterns: ['monday', 'mon', 'mondy', 'mnday'], standard: 'Monday' },
    { patterns: ['tuesday', 'tue', 'tues', 'tuseday', 'tusday'], standard: 'Tuesday' },
    { patterns: ['wednesday', 'wed', 'wednes', 'wensday', 'wendsday', 'wedday'], standard: 'Wednesday' },
    { patterns: ['thursday', 'thu', 'thur', 'thurs', 'thrusday', 'thruday'], standard: 'Thursday' },
    { patterns: ['friday', 'fri', 'firday', 'fridy', 'frday'], standard: 'Friday' },
    { patterns: ['saturday', 'sat', 'satur', 'saterday'], standard: 'Saturday' },
    { patterns: ['sunday', 'sun', 'sundy'], standard: 'Sunday' },
  ];

  if (/\b(today|todays|now|right now|currently)\b/i.test(nq)) {
    const jsDay = new Date().getDay(); // 0 = Sun, 1 = Mon...
    const map = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const current = map[jsDay];
    /* a non-teaching day is still the answer — "no classes on Sunday" —
       rather than quietly substituting the first teaching day */
    return current;
  }

  if (/\b(tomorrow|tomorrows)\b/i.test(nq)) {
    const jsDay = (new Date().getDay() + 1) % 7;
    const map = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const tomorrow = map[jsDay];
    if (days.includes(tomorrow)) return tomorrow;
    return days[0] || 'Monday';
  }

  for (const d of dayMap) {
    for (const pat of d.patterns) {
      if (new RegExp(`\\b${pat}\\b`, 'i').test(nq)) {
        const found = days.find(x => x.toLowerCase() === d.standard.toLowerCase());
        return found || d.standard;
      }
    }
  }

  return null;
}

function extractSlot(q, slots = []) {
  const nq = norm(q);
  const match = nq.match(/\b(slot|period|hour|session|p)\s*([0-9]+)\b/i);
  if (match) {
    const num = parseInt(match[2], 10);
    if (!isNaN(num) && num >= 1 && num <= slots.length) {
      return { index: num - 1, number: num, label: slots[num - 1] || `Period ${num}` };
    }
  }
  return null;
}

function extractMonth(q) {
  const nq = norm(q);
  const monthMap = [
    { patterns: ['january', 'jan'], index: 0, name: 'January' },
    { patterns: ['february', 'feb'], index: 1, name: 'February' },
    { patterns: ['march', 'mar'], index: 2, name: 'March' },
    { patterns: ['april', 'apr'], index: 3, name: 'April' },
    { patterns: ['may'], index: 4, name: 'May' },
    { patterns: ['june', 'jun'], index: 5, name: 'June' },
    { patterns: ['july', 'jul'], index: 6, name: 'July' },
    { patterns: ['august', 'aug'], index: 7, name: 'August' },
    { patterns: ['september', 'sep', 'sept'], index: 8, name: 'September' },
    { patterns: ['october', 'oct'], index: 9, name: 'October' },
    { patterns: ['november', 'nov'], index: 10, name: 'November' },
    { patterns: ['december', 'dec'], index: 11, name: 'December' },
  ];

  if (/\b(this month|current month)\b/i.test(nq)) {
    const m = new Date().getMonth();
    return { index: m, name: monthMap[m].name, year: new Date().getFullYear() };
  }
  if (/\b(next month)\b/i.test(nq)) {
    const nextDate = new Date();
    nextDate.setMonth(nextDate.getMonth() + 1);
    const m = nextDate.getMonth();
    return { index: m, name: monthMap[m].name, year: nextDate.getFullYear() };
  }

  for (const m of monthMap) {
    for (const pat of m.patterns) {
      if (new RegExp(`\\b${pat}\\b`, 'i').test(nq)) {
        /* a bare month name means its next occurrence within the academic
           year: more than ~4 months back reads as next year's */
        const now = new Date();
        const year = m.index < now.getMonth() - 4 ? now.getFullYear() + 1 : now.getFullYear();
        return { index: m.index, name: m.name, year };
      }
    }
  }

  if (/\b(monthly|calendar|monthly calendar|tentative dates|training dates)\b/i.test(nq)) {
    const m = new Date().getMonth();
    return { index: m, name: monthMap[m].name, year: new Date().getFullYear(), isGeneralCalendar: true };
  }

  return null;
}

// ── RAG Knowledge Index Builder ──
function buildKnowledgeBase(scheduleData) {
  const { slots = [], days = [], batches = [], trainers = [], venues = [], groups = [] } = scheduleData;
  const facts = [];

  // Batch Session Facts
  batches.forEach(b => {
    (b.rows || []).forEach(r => {
      const supportText = r.support && r.support !== '—' ? r.support : 'None';
      facts.push({
        type: 'session',
        entity: b.name,
        group: b.group,
        dept: b.dept,
        day: r.day,
        time: r.time,
        slot: r.slot,
        subject: r.subject,
        venue: r.venue,
        trainers: r.trainer,
        mainTrainers: r.mainList || [],
        supportTrainers: r.supportList || [],
        text: `Batch ${b.name} (${b.group}${b.dept ? ` · ${b.dept}` : ''}) has ${r.subject} on ${r.day} from ${r.time} (Slot ${r.slot}) in ${r.venue || 'TBA'} with Lead Trainer: ${r.trainer} and Support Mentor: ${supportText}.`,
      });
    });
  });

  // Trainer Facts
  trainers.forEach(t => {
    const isNonTeaching = t.track === 'non-teaching' || t.track === 'non-technical';
    const trackLabel = isNonTeaching ? 'Non-Teaching' : 'Teaching';
    facts.push({
      type: 'trainer',
      entity: t.name,
      track: isNonTeaching ? 'non-teaching' : 'teaching',
      email: t.email,
      phone: t.phone,
      totalTrainings: t.totalTrainings || 0,
      mainCount: t.mainCount || 0,
      supportCount: t.supportCount || 0,
      text: `Trainer ${t.name} (${trackLabel} Mentor) handles ${t.totalTrainings || 0} weekly training sessions (Lead: ${t.mainCount || 0}, Support: ${t.supportCount || 0})${t.email ? ` [${t.email}]` : ''}.`,
    });
  });

  // Venue Facts
  venues.forEach(v => {
    facts.push({
      type: 'venue',
      entity: v.name,
      capacity: v.capacity || 0,
      text: `Training Venue ${v.name} has a capacity of ${v.capacity || 60} seats.`,
    });
  });

  return facts;
}

/**
 * Main RAG Question Answering System
 */
export function answerScheduleQuery(userQuery, scheduleData) {
  if (!scheduleData) {
    return "Connecting to the live timetable database. Please try again in a moment.";
  }

  const rawQ = String(userQuery || '').trim();
  if (!rawQ) {
    return "Please specify a query regarding trainers, batches, training venues, subjects, or daily schedules.";
  }

  const slots = scheduleData.slots || scheduleData.config?.slots || [];
  const days = scheduleData.days || scheduleData.config?.days || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const lunchIndex = scheduleData.lunchIndex !== undefined ? scheduleData.lunchIndex : (scheduleData.config?.lunchIndex ?? 3);

  const trainers = scheduleData.trainers || [];
  const venues = scheduleData.venues || [];
  /* weekly questions are about what is running now, not finished or future batches */
  const batches = (scheduleData.batches || []).filter(b => !b.status || b.status === 'current');
  const groups = scheduleData.groups || [];
  const upcoming = scheduleData.upcoming || [];
  const conflicts = scheduleData.conflicts || [];

  const nq = norm(rawQ);
  const cq = cleanQuery(rawQ);
  const targetDay = extractDay(rawQ, days);
  const targetSlot = extractSlot(rawQ, slots);
  const targetMonth = extractMonth(rawQ);

  // ── 1. GREETINGS & SYSTEM OVERVIEW ──
  if (/^(hi|hello|hey|greetings|hola|namaste|yo|good\s*(morning|afternoon|evening))\b/i.test(nq)) {
    return `Hello. I am the live **Schedule Assistant** for **Class Scheduler**.\n\nDatabase status: **${batches.length} Batches**, **${trainers.length} Trainers**, and **${venues.length} Venues** active.\n\n**Example queries:**\n- 📅 *"Show today's schedule"* or *"Monday timetable"*\n- 🗓️ *"What is the schedule for September?"* or *"October schedule"*\n- 🟢 *"Who is free today?"* or *"Who is free on Friday slot 2?"*\n- 👨‍🏫 *"Who are the teaching trainers?"* or *"Who are the non-teaching trainers?"*\n- 🎓 *"When is Batch 1 class?"*\n- 🏢 *"Which halls are available on Wednesday?"*`;
  }

  if (hasAny(nq, 'who are you', 'what are you', 'your name', 'about you')) {
    return `I am the **Schedule Assistant** for **Class Scheduler** at NCET.\n\nI provide real-time schedule information directly from the database for:\n- 🗓️ **Monthly Calendar & Tentative Training Dates**\n- 📅 **Batch Timetables & Venues**\n- 👨‍🏫 **Teaching & Non-Teaching Faculty**\n- 🟢 **Trainer Availability & Free Periods**\n- 🏛️ **Venue Occupancy & Room Allocations**\n- ⏰ **Campus Period Timings & Breaks**`;
  }

  // ── 1.2 MONTHLY CALENDAR & TENTATIVE SCHEDULE QUERIES ──
  const isCalendarQuery = !!targetMonth || hasAny(nq, 'calendar schedule', 'monthly calendar', 'month calendar', 'month schedule', 'tentative dates', 'training dates');
  if (isCalendarQuery) {
    const mIdx = targetMonth ? targetMonth.index : (new Date().getMonth());
    const now = new Date();
    const mName = targetMonth ? targetMonth.name : now.toLocaleDateString('en-US', { month: 'long' });
    const mYear = targetMonth?.year || now.getFullYear();

    const mStart = `${mYear}-${String(mIdx + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(mYear, mIdx + 1, 0).getDate();
    const mEnd = `${mYear}-${String(mIdx + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    /* a month question spans past and future batches too, so use the full list */
    const activeBatchesInMonth = (scheduleData.batches || []).filter(b => {
      if (!b.startDate && !b.endDate) return true;
      if (b.startDate && b.startDate > mEnd) return false;
      if (b.endDate && b.endDate < mStart) return false;
      return true;
    });

    let res = `🗓️ **${mName.toUpperCase()} ${mYear} · MONTHLY TRAINING SCHEDULE**\n\n`;
    res += `For **${mName} ${mYear}**, there are **${activeBatchesInMonth.length} active batches** with scheduled training classes:\n\n`;

    const byGroup = {};
    activeBatchesInMonth.forEach(b => {
      if (!byGroup[b.group]) byGroup[b.group] = [];
      byGroup[b.group].push(b);
    });

    Object.entries(byGroup).forEach(([grp, list]) => {
      res += `🎓 **${grp} (${list.length} Batches):**\n`;
      list.forEach(b => {
        const periodStr = (b.startDate || b.endDate)
          ? ` · *[${b.startDate || 'start'} to ${b.endDate || 'end'}]*`
          : ' · *[Ongoing]*';
        res += `- **${b.name}**${b.dept ? ` (${b.dept})` : ''}: ${(b.sessions || []).length} weekly sessions${periodStr}\n`;
      });
      res += `\n`;
    });

    res += `📌 **Note:** You can open the **Monthly Calendar** tab on the main board to see the complete 7-day calendar matrix for ${mName} ${mYear}, inspect day-by-day class allocations, or export a PDF!`;
    return res;
  }

  // ── 1.1 TRAINER TRACK QUERIES (TEACHING vs NON-TEACHING) ──
  const hasNonTeachingWord = /\bnon\s*(teach|tech)/i.test(nq);
  const isNonTeachingQuery = hasNonTeachingWord || hasAny(nq, 'who are non teaching', 'who is non teaching', 'list non teaching', 'show non teaching', 'who are non technical', 'who is non technical', 'list non technical', 'show non tech');
  const isTeachingQuery = !hasNonTeachingWord && hasAny(nq, 'teaching trainer', 'teaching trainers', 'teaching faculty', 'teaching mentors', 'who are teaching', 'who is teaching', 'list teaching', 'show teaching', 'technical trainer', 'technical trainers', 'technical faculty', 'tech trainer', 'tech trainers', 'technical mentors', 'tech mentors', 'who are technical', 'who is technical', 'list technical', 'show technical', 'technical');

  if (isNonTeachingQuery) {
    const nonTeachingList = trainers.filter(t => t.track === 'non-teaching' || t.track === 'non-technical');
    let res = `👥 **Non-Teaching Mentors (${nonTeachingList.length}):**\n\n`;
    nonTeachingList.forEach((t, i) => {
      res += `${i + 1}. **${t.name}** *(${t.totalTrainings || 0} weekly slots, Lead: ${t.mainCount || 0}, Support: ${t.supportCount || 0})*\n`;
    });
    res += `\n*Non-Teaching faculty specialize in soft skills, aptitude, verbal ability, design, operations, and career readiness.*`;
    return res;
  }

  if (isTeachingQuery) {
    const teachingList = trainers.filter(t => (t.track || 'teaching') !== 'non-teaching' && t.track !== 'non-technical');
    let res = `💻 **Teaching Mentors (${teachingList.length}):**\n\n`;
    teachingList.forEach((t, i) => {
      res += `${i + 1}. **${t.name}** *(${t.totalTrainings || 0} weekly slots, Lead: ${t.mainCount || 0}, Support: ${t.supportCount || 0})*\n`;
    });
    res += `\n*Teaching faculty deliver core computer science, software engineering, and technical curricula.*`;
    return res;
  }

  if (hasAny(nq, 'who are the trainers', 'all trainers', 'list trainers', 'show trainers', 'faculty list', 'trainers list', 'who are trainers', 'show mentors')) {
    const teachingList = trainers.filter(t => (t.track || 'teaching') !== 'non-teaching' && t.track !== 'non-technical');
    const nonTeachingList = trainers.filter(t => t.track === 'non-teaching' || t.track === 'non-technical');
    let res = `👨‍🏫 **Faculty Directory (${trainers.length} Trainers)**\n\n`;
    res += `💻 **Teaching Mentors (${teachingList.length}):**\n`;
    teachingList.forEach((t, i) => {
      res += `${i + 1}. **${t.name}** *(${t.totalTrainings || 0} weekly slots)*\n`;
    });
    res += `\n👥 **Non-Teaching Mentors (${nonTeachingList.length}):**\n`;
    nonTeachingList.forEach((t, i) => {
      res += `${i + 1}. **${t.name}** *(${t.totalTrainings || 0} weekly slots)*\n`;
    });
    return res;
  }

  // ── 2. TRAINER AVAILABILITY & FREE TIME (INTENT: FREE_TRAINERS) ──
  const isFreeTrainersQuery =
    hasAny(nq, 'who is free', 'who are free', 'who has no class', 'who is available', 'which trainers are free', 'which trainer is free', 'free trainers', 'available trainers', 'anyone free', 'is anyone free', 'free staff', 'free faculty') &&
    !hasAny(nq, 'free hall', 'free halls', 'free venue', 'free venues', 'free room', 'free rooms');

  if (isFreeTrainersQuery) {
    const d = targetDay || days[0];

    // Case A: Free at a specific SLOT
    if (targetSlot) {
      const freeAtSlot = [];
      const busyAtSlot = [];

      trainers.forEach(t => {
        const item = t.grid?.[d]?.[targetSlot.index];
        if (!item || item === 'Lunch Break' || item === 'Free') {
          freeAtSlot.push(t.name);
        } else {
          busyAtSlot.push({ name: t.name, task: item });
        }
      });

      let res = `🟢 **Trainer Availability — ${d} (Slot ${targetSlot.number} · ${targetSlot.label})**\n\n`;
      if (freeAtSlot.length > 0) {
        res += `**Available Trainers (${freeAtSlot.length}):**\n`;
        freeAtSlot.forEach((name, i) => {
          res += `${i + 1}. **${name}**\n`;
        });
      } else {
        res += `*All trainers are currently assigned to training sessions during this period.*\n`;
      }

      if (busyAtSlot.length > 0) {
        res += `\n**Assigned Trainers (${busyAtSlot.length}):**\n`;
        busyAtSlot.forEach((b, i) => {
          res += `${i + 1}. **${b.name}** — *${b.task}*\n`;
        });
      }
      return res;
    }

    // Case B: General Free Trainers for the Day
    const fullyFree = [];
    const partiallyFree = [];

    trainers.forEach(t => {
      const dayGrid = t.grid?.[d] || [];
      const busyPeriods = [];
      const freePeriods = [];

      slots.forEach((s, idx) => {
        if (idx === lunchIndex) return; // Skip lunch
        const item = dayGrid[idx];
        if (item && item !== 'Lunch Break' && item !== 'Free') {
          busyPeriods.push({ slot: idx + 1, time: s, task: item });
        } else {
          freePeriods.push({ slot: idx + 1, time: s });
        }
      });

      if (busyPeriods.length === 0) {
        fullyFree.push(t);
      } else if (freePeriods.length > 0) {
        partiallyFree.push({ trainer: t, freePeriods, busyPeriods });
      }
    });

    let res = `🟢 **Trainer Availability Overview — ${d}**\n\n`;

    if (fullyFree.length > 0) {
      res += `**Fully Available All Day (No Assigned Sessions):**\n`;
      fullyFree.forEach((t, i) => {
        res += `${i + 1}. **${t.name}** ${t.email ? `*(${t.email})*` : ''}\n`;
      });
      res += `\n`;
    }

    if (partiallyFree.length > 0) {
      res += `**Partially Available (Free during specific periods):**\n`;
      partiallyFree.forEach(({ trainer, freePeriods }) => {
        const slotNumbers = freePeriods.map(p => `Slot ${p.slot}`).join(', ');
        res += `- **${trainer.name}**: Free during **${slotNumbers}** (${freePeriods.length} periods open)\n`;
      });
    }

    res += `\n*You may query specific slots (e.g., "Who is free at Slot 2 on ${d}?") for exact period details.*`;
    return res;
  }

  // ── 3. VENUE AVAILABILITY (INTENT: FREE_VENUES) ──
  if (hasAny(nq, 'free hall', 'free halls', 'free venue', 'free venues', 'empty room', 'available hall', 'available room', 'free rooms', 'which halls are free', 'which rooms are free', 'hall availability', 'venue availability')) {
    const d = targetDay || days[0];
    let res = `🏢 **Venue Availability — ${d}**\n\n`;

    venues.forEach(v => {
      const freeSlots = v.free?.[d] || [];
      if (freeSlots.length >= slots.length - 1) {
        res += `- 🟢 **${v.name}**: **Fully Available All Day** (${v.capacity || 60} seats)\n`;
      } else if (freeSlots.length > 0) {
        res += `- 🟡 **${v.name}**: Available during **${freeSlots.length} periods** (${freeSlots.join(', ')})\n`;
      } else {
        res += `- 🔴 **${v.name}**: Fully Occupied\n`;
      }
    });

    return res;
  }

  // ── 4. LUNCH BREAK & COLLEGE TIMINGS ──
  if (hasAny(nq, 'lunch', 'lunch break', 'recess', 'interval', 'break time')) {
    const lunchSlotName = slots[lunchIndex] || '11:50 – 12:40';
    return `🍽️ **Campus Lunch Break Schedule**\n\n- **Period:** Slot ${lunchIndex + 1} (\`${lunchSlotName}\`)\n- **Details:** Campus-wide break. All morning sessions conclude before Slot ${lunchIndex + 1}, and afternoon training resumes in Slot ${lunchIndex + 2}.`;
  }

  if (hasAny(nq, 'slots', 'periods', 'timings', 'bell schedule', 'what time does slot', 'class hours', 'time table timing')) {
    let res = `⏰ **Master Period Schedule (${slots.length} Slots)**\n\n`;
    slots.forEach((s, idx) => {
      const isLunch = idx === lunchIndex;
      res += `- **Slot ${idx + 1}:** \`${s}\` ${isLunch ? '🍱 *(Lunch Break)*' : ''}\n`;
    });
    res += `\n**Teaching Days:** ${days.join(', ')}`;
    return res;
  }

  // ── 5. SCHEDULE CONFLICTS ──
  if (hasAny(nq, 'conflict', 'conflicts', 'double booking', 'clash', 'overlap')) {
    if (!conflicts || conflicts.length === 0) {
      return `✅ **Schedule Integrity Verified**\n\nZero scheduling conflicts detected across **${batches.length} batches**, **${trainers.length} trainers**, and **${venues.length} venues**. All room and trainer allocations are consistent.`;
    }
    let res = `⚠️ **Schedule Conflicts Detected (${conflicts.length}):**\n\n`;
    conflicts.forEach((c, idx) => {
      res += `${idx + 1}. **${c.kind === 'trainer' ? 'Trainer Overlap' : 'Venue Overlap'}:** \`${c.subject}\` on **${c.day}** (${c.slot}) between **${c.batches.join('** and **')}**\n`;
    });
    return res;
  }

  // ── 6. OVERALL STATS & SUMMARY ──
  if (hasAny(nq, 'stats', 'statistics', 'summary', 'overview', 'how many', 'total count', 'numbers', 'student count', 'students')) {
    const totalStudents = calculateUniqueStudents(batches);
    const totalSessions = batches.reduce((acc, b) => acc + (b.rows || []).length, 0);
    const activeTrainers = trainers.filter(t => (t.totalTrainings || 0) > 0).length;

    let res = `📊 **Training Program Summary**\n\n`;
    res += `- **Year Groups:** ${groups.length} Active ${upcoming.length > 0 ? `(+ ${upcoming.length} Awaiting Schedule)` : ''}\n`;
    res += `- **Total Batches:** ${batches.length} (${totalStudents > 0 ? totalStudents.toLocaleString() + ' Unique Enrolled Students' : 'Configured'})\n`;
    res += `- **Weekly Class Blocks:** ${totalSessions} Sessions\n`;
    res += `- **Faculty / Trainers:** ${trainers.length} (${activeTrainers} Actively Assigned)\n`;
    res += `- **Training Venues:** ${venues.length} Locations\n`;
    res += `- **Operating Days:** ${days.join(', ')}\n\n`;

    if (upcoming.length > 0) {
      res += `⏳ **Upcoming Bands:** ${upcoming.map(u => `*${u.group}*`).join(', ')}\n`;
    }
    return res;
  }

  // ── 7. SPECIFIC TRAINER SCHEDULE (INTENT: TRAINER_SCHEDULE) ──
  const queryTokens = nq.split(' ').filter(w => w.length >= 2);
  const cleanedTokens = cq.split(' ').filter(w => w.length >= 2);

  const matchedTrainer = trainers.find(t => {
    const tn = norm(t.name);
    const parts = tn.split(' ');
    if (nq.includes(tn) || cq.includes(tn)) return true;
    return parts.some(p => p.length >= 3 && (queryTokens.includes(p) || cleanedTokens.includes(p)));
  });

  if (matchedTrainer) {
    if (targetDay) {
      const d = targetDay;
      const dayClasses = [];
      batches.forEach(b => {
        (b.rows || []).forEach(r => {
          if (covers(r, d, days)) {
            const isMain = (r.mainList || []).includes(matchedTrainer.name);
            const isSupport = (r.supportList || []).includes(matchedTrainer.name);
            if (isMain || isSupport) {
              dayClasses.push({
                batch: b.name,
                group: b.group,
                dept: b.dept,
                subject: r.subject,
                time: r.time,
                slot: r.slot,
                slots: r.slots || [],
                venue: r.venue,
                role: isMain ? 'Lead Trainer' : 'Support Mentor',
                mainList: r.mainList || [],
                supportList: r.supportList || [],
                support: r.support,
              });
            }
          }
        });
      });

      // Sort chronologically by start slot
      dayClasses.sort((a, b) => (a.slots[0] ?? 0) - (b.slots[0] ?? 0));

      let dayRes = `📋 **Schedule for ${matchedTrainer.name} — ${d}**\n\n`;

      if (dayClasses.length > 0) {
        dayClasses.forEach((c, idx) => {
          const supportDisplay = c.support && c.support !== '—' ? c.support : 'None';
          dayRes += `**${idx + 1}. ${c.subject}** — **${c.batch}** *(${c.group}${c.dept ? ` · ${c.dept}` : ''})*\n`;
          dayRes += `- ⏰ **Time:** ${c.time} *(Slot ${c.slot})*\n`;
          dayRes += `- 🏛️ **Venue:** ${c.venue || 'To be assigned'}\n`;
          dayRes += `- 👨‍🏫 **Lead Trainer:** ${c.mainList.join(', ')}\n`;
          dayRes += `- 🤝 **Support Mentor:** ${supportDisplay}\n`;
          dayRes += `- 📌 **Assigned Role:** **${c.role}**\n\n`;
        });

        const lunchSlot = slots[lunchIndex] || '11:50 – 12:40';
        dayRes += `🍱 **Lunch Break:** Slot ${lunchIndex + 1} (\`${lunchSlot}\`)\n`;

        const freeSlots = matchedTrainer.free?.[d] || [];
        if (freeSlots.length > 0) {
          dayRes += `🟢 **Available Free Periods:** ${freeSlots.length} slot(s) open.`;
        }
      } else {
        dayRes += `🟢 *No training sessions scheduled for ${matchedTrainer.name} on ${d}. Trainer is available for mentoring, reviews, or consultations.*`;
      }

      return dayRes;
    }

    // Weekly Trainer Overview
    const isNonTeaching = matchedTrainer.track === 'non-teaching' || matchedTrainer.track === 'non-technical';
    const trackName = isNonTeaching ? 'Non-Teaching Mentor' : 'Teaching Mentor';
    let res = `👨‍🏫 **Trainer Profile — ${matchedTrainer.name}** *(${trackName})*\n\n`;
    res += `- **Domain / Track:** **${trackName}**\n`;
    if (matchedTrainer.email) res += `- **Email:** ${matchedTrainer.email}\n`;
    if (matchedTrainer.phone) res += `- **Contact:** ${matchedTrainer.phone}\n`;
    res += `- **Weekly Workload:** **${matchedTrainer.totalTrainings || 0} Total Sessions** (Lead: ${matchedTrainer.mainCount || 0}, Support: ${matchedTrainer.supportCount || 0})\n\n`;

    const allTaught = [];
    batches.forEach(b => {
      (b.rows || []).forEach(r => {
        const isMain = (r.mainList || []).includes(matchedTrainer.name);
        const isSupport = (r.supportList || []).includes(matchedTrainer.name);
        if (isMain || isSupport) {
          allTaught.push({
            batch: b.name,
            group: b.group,
            dept: b.dept,
            subject: r.subject,
            day: r.day,
            dayIndexes: r.dayIndexes,
            time: r.time,
            slot: r.slot,
            venue: r.venue,
            mainList: r.mainList || [],
            supportList: r.supportList || [],
            support: r.support,
            role: isMain ? 'Lead Trainer' : 'Support Mentor',
          });
        }
      });
    });

    if (allTaught.length > 0) {
      res += `**Weekly Class Assignments:**\n`;
      allTaught.forEach((s, idx) => {
        const supportDisplay = s.support && s.support !== '—' ? s.support : 'None';
        res += `**${idx + 1}. ${s.subject}** — **${s.batch}** *(${s.group}${s.dept ? ` · ${s.dept}` : ''})*\n`;
        res += `- 📅 **Day & Time:** ${s.day} · ${s.time} *(Slot ${s.slot})*\n`;
        res += `- 🏛️ **Venue:** ${s.venue || 'To be assigned'}\n`;
        res += `- 👨‍🏫 **Lead Trainer:** ${s.mainList.join(', ')}\n`;
        res += `- 🤝 **Support Mentor:** ${supportDisplay}\n`;
        res += `- 📌 **Role:** **${s.role}**\n\n`;
      });
    } else {
      res += `*No active training sessions currently assigned in the database.*`;
    }

    return res;
  }

  // ── 8. SPECIFIC BATCH SCHEDULE (INTENT: BATCH_SCHEDULE) ──
  const genericBatchWords = new Set(['batch', 'batches', 'class', 'classes', 'year', 'group', 'the', 'a', 'all', 'who', 'where', 'when']);
  const matchedBatch = batches.find(b => {
    const bn = norm(b.name);
    if (nq.includes(bn) || cq.includes(bn)) return true;
    const parts = bn.split(' ').filter(w => w.length >= 2 && !genericBatchWords.has(w));
    return parts.length >= 1 && parts.every(p => nq.includes(p) || cq.includes(p));
  });

  if (matchedBatch) {
    let res = `🎓 **Batch Schedule — ${matchedBatch.name}** *(${matchedBatch.group})*\n\n`;
    if (matchedBatch.dept) res += `- **Department:** ${matchedBatch.dept}\n`;
    if (matchedBatch.count) res += `- **Student Strength:** ${matchedBatch.count} Students\n`;
    if (matchedBatch.venues && matchedBatch.venues.length) {
      res += `- **Designated Venue(s):** ${matchedBatch.venues.join(', ')}\n`;
    }
    res += `\n`;

    if (targetDay) {
      res += `**Schedule for ${targetDay}:**\n\n`;
      const filteredRows = (matchedBatch.rows || []).filter(r => covers(r, targetDay, days));
      if (filteredRows.length === 0) {
        res += `*No classes scheduled for ${matchedBatch.name} on ${targetDay}.*\n`;
      } else {
        filteredRows.forEach((r, idx) => {
          const supportDisplay = r.support && r.support !== '—' ? r.support : 'None';
          res += `**${idx + 1}. ${r.subject}**\n`;
          res += `- ⏰ **Timing:** ${r.time} *(Slot ${r.slot})*\n`;
          res += `- 🏛️ **Venue:** ${r.venue || 'To be assigned'}\n`;
          res += `- 👨‍🏫 **Lead Trainer:** ${r.trainer}\n`;
          res += `- 🤝 **Support Mentor:** ${supportDisplay}\n\n`;
        });
      }
    } else {
      res += `**Weekly Timetable (${(matchedBatch.rows || []).length} Sessions):**\n\n`;
      if (!matchedBatch.rows || matchedBatch.rows.length === 0) {
        res += `*No sessions currently configured for this batch.*`;
      } else {
        matchedBatch.rows.forEach((r, idx) => {
          const supportDisplay = r.support && r.support !== '—' ? r.support : 'None';
          res += `**${idx + 1}. ${r.subject}**\n`;
          res += `- 📅 **Day & Time:** ${r.day} · ${r.time} *(Slot ${r.slot})*\n`;
          res += `- 🏛️ **Venue:** ${r.venue || 'To be assigned'}\n`;
          res += `- 👨‍🏫 **Lead Trainer:** ${r.trainer}\n`;
          res += `- 🤝 **Support Mentor:** ${supportDisplay}\n\n`;
        });
      }
    }
    return res;
  }

  // ── 9. SUBJECT SEARCH (INTENT: SUBJECT_SEARCH) ──
  const allSubjects = new Set();
  batches.forEach(b => (b.rows || []).forEach(r => { if (r.subject) allSubjects.add(r.subject); }));

  const matchedSubject = Array.from(allSubjects).find(s => {
    const sn = norm(s);
    return nq.includes(sn) || cq.includes(sn) || sn.split(' ').some(part => part.length >= 3 && nq.includes(part));
  });

  if (matchedSubject) {
    let subjectSessions = [];
    batches.forEach(b => {
      (b.rows || []).forEach(r => {
        if (r.subject.toLowerCase() === matchedSubject.toLowerCase()) {
          subjectSessions.push({
            batch: b.name,
            group: b.group,
            dept: b.dept,
            day: r.day,
            dayIndexes: r.dayIndexes,
            time: r.time,
            slot: r.slot,
            venue: r.venue,
            trainer: r.trainer,
            support: r.support,
          });
        }
      });
    });

    if (targetDay) {
      subjectSessions = subjectSessions.filter(s => covers(s, targetDay, days));
    }

    let res = `📚 **Subject Allocation — ${matchedSubject}** ${targetDay ? `(${targetDay})` : ''}\n\n`;
    if (subjectSessions.length === 0) {
      res += `*No ${matchedSubject} sessions are scheduled ${targetDay ? `on ${targetDay}` : 'in the timetable'}.*`;
    } else {
      subjectSessions.forEach((s, idx) => {
        const supportDisplay = s.support && s.support !== '—' ? s.support : 'None';
        res += `**${idx + 1}. ${s.batch}** *(${s.group}${s.dept ? ` · ${s.dept}` : ''})*\n`;
        res += `- 📅 **Day & Time:** ${s.day} · ${s.time} *(Slot ${s.slot})*\n`;
        res += `- 🏛️ **Venue:** ${s.venue || 'To be assigned'}\n`;
        res += `- 👨‍🏫 **Lead Trainer:** ${s.trainer}\n`;
        res += `- 🤝 **Support Mentor:** ${supportDisplay}\n\n`;
      });
    }
    return res;
  }

  // ── 10. SPECIFIC VENUE SEARCH (INTENT: VENUE_SEARCH) ──
  const genericVenueWords = new Set(['hall', 'halls', 'venue', 'venues', 'room', 'rooms', 'block', 'floor', 'training', 'the', 'a', 'an', 'which', 'free', 'available']);
  const matchedVenue = venues.find(v => {
    const vn = norm(v.name);
    if (nq.includes(vn) || cq.includes(vn)) return true;
    const parts = vn.split(' ').filter(w => w.length >= 3 && !genericVenueWords.has(w));
    if (parts.length === 0) return false;
    return parts.every(part => nq.includes(part) || cq.includes(part));
  });

  if (matchedVenue) {
    let res = `🏛️ **Venue Allocation — ${matchedVenue.name}**\n\n`;
    if (matchedVenue.capacity) res += `- **Capacity:** ${matchedVenue.capacity} Seats\n\n`;

    let venueSessions = [];
    batches.forEach(b => {
      (b.rows || []).forEach(r => {
        if (r.venue && r.venue.toLowerCase() === matchedVenue.name.toLowerCase()) {
          venueSessions.push({
            batch: b.name,
            group: b.group,
            dept: b.dept,
            subject: r.subject,
            day: r.day,
            dayIndexes: r.dayIndexes,
            time: r.time,
            slot: r.slot,
            trainer: r.trainer,
            support: r.support,
          });
        }
      });
    });

    if (targetDay) {
      venueSessions = venueSessions.filter(s => covers(s, targetDay, days));
    }

    if (venueSessions.length === 0) {
      res += `🟢 *Venue is unoccupied ${targetDay ? `on ${targetDay}` : 'throughout the week'}.*`;
    } else {
      res += `**Scheduled Sessions (${venueSessions.length}):**\n\n`;
      venueSessions.forEach((s, idx) => {
        const supportDisplay = s.support && s.support !== '—' ? s.support : 'None';
        res += `**${idx + 1}. ${s.subject}** — **${s.batch}** *(${s.group})*\n`;
        res += `- 📅 **Day & Time:** ${s.day} · ${s.time} *(Slot ${s.slot})*\n`;
        res += `- 👨‍🏫 **Lead Trainer:** ${s.trainer}\n`;
        res += `- 🤝 **Support Mentor:** ${supportDisplay}\n\n`;
      });
    }

    return res;
  }

  // ── 11. GENERAL DAY-WISE / TODAY'S TIMETABLE (INTENT: DAY_TIMETABLE) ──
  if (targetDay && (hasAny(nq, 'schedule', 'timetable', 'classes', 'sessions', 'what is happening', 'what is scheduled', 'day wise', 'today', 'todays') || queryTokens.length <= 2)) {
    const d = targetDay;
    const daySessions = [];

    batches.forEach(b => {
      (b.rows || []).forEach(r => {
        if (covers(r, d, days)) {
          daySessions.push({
            batch: b.name,
            group: b.group,
            dept: b.dept,
            subject: r.subject,
            time: r.time,
            slot: r.slot,
            slots: r.slots || [],
            venue: r.venue,
            trainer: r.trainer,
            support: r.support,
            mainList: r.mainList || [],
            supportList: r.supportList || [],
          });
        }
      });
    });

    if (daySessions.length === 0) {
      return `📅 **Master Schedule — ${d}**\n\nNo training sessions are scheduled on this day.`;
    }

    // Sort chronologically by start slot
    daySessions.sort((a, b) => (a.slots[0] ?? 0) - (b.slots[0] ?? 0));

    let res = `📅 **Master Schedule — ${d} (${daySessions.length} Active Sessions)**\n\n`;
    daySessions.forEach((s, idx) => {
      const supportDisplay = s.support && s.support !== '—' ? s.support : 'None';
      res += `**${idx + 1}. ${s.subject}** — **${s.batch}** *(${s.group}${s.dept ? ` · ${s.dept}` : ''})*\n`;
      res += `- ⏰ **Timing:** ${s.time} *(Slot ${s.slot})*\n`;
      res += `- 🏛️ **Venue:** ${s.venue || 'To be assigned'}\n`;
      res += `- 👨‍🏫 **Lead Trainer:** ${s.trainer}\n`;
      res += `- 🤝 **Support Mentor:** ${supportDisplay}\n\n`;
    });

    const lunchSlot = slots[lunchIndex] || '11:50 – 12:40';
    res += `🍱 **Campus Lunch Break:** Slot ${lunchIndex + 1} (\`${lunchSlot}\`)`;
    return res;
  }

  // ── 12. RAG SEMANTIC RETRIEVAL FALLBACK ──
  const kb = buildKnowledgeBase(scheduleData);
  const searchWords = cq.split(' ').filter(w => w.length >= 3);

  if (searchWords.length > 0) {
    const scoredFacts = kb.map(f => {
      const fText = norm(f.text);
      let score = 0;
      searchWords.forEach(w => {
        if (fText.includes(w)) score += 2;
      });
      return { fact: f, score };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);

    if (scoredFacts.length > 0) {
      const topFacts = scoredFacts.slice(0, 4);
      let res = `🔍 **Schedule Search Results for "${rawQ}":**\n\n`;
      topFacts.forEach(({ fact }, i) => {
        res += `${i + 1}. ${fact.text}\n\n`;
      });
      return res;
    }
  }

  // ── 13. FALLBACK PROMPT ──
  return `No direct match found for **"${rawQ}"** in the timetable database.\n\n**Suggested Queries:**\n- 📅 **Day Timetable:** *"Show today's schedule"* or *"Monday timetable"*\n- 🟢 **Trainer Availability:** *"Who is free today?"* or *"Who is free at Slot 2?"*\n- 👨‍🏫 **Trainer Schedule:** *"What is Sudhir's Friday schedule?"*\n- 🎓 **Batch Schedule:** *"Show Batch 1 timetable"*\n- 🏢 **Venue Availability:** *"Which halls are free on Wednesday?"*`;
}
