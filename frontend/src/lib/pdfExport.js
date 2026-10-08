import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { abbreviateVenue } from './abbreviate.js';
import { calculateUniqueStudents } from './studentStats.js';
import { getClassesForDate, holidayOn } from './calendarUtils.js';

const BRAND_ACCENT = [0, 71, 171];      // #0047AB cobalt
const DARK_INK = [10, 10, 10];          // #0A0A0A
const MUTED_INK = [100, 107, 118];     // #646B76
const ACCENT_BG = [239, 244, 252];      // #EFF4FC
const LINE_BORDER = [226, 231, 239];    // #E2E7EF
const LIGHT_GREY = [246, 248, 251];

function addDocHeader(doc, title, subtitle) {
  const pageWidth = doc.internal.pageSize.getWidth();
  
  // Header background banner
  doc.setFillColor(...DARK_INK);
  doc.rect(0, 0, pageWidth, 24, 'F');

  // Cobalt accent strip
  doc.setFillColor(...BRAND_ACCENT);
  doc.rect(0, 24, pageWidth, 2.5, 'F');

  // Title & subtitle text
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('CLASS SCHEDULER · NCET TRAINING MANAGEMENT', 14, 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(169, 196, 238);
  doc.text(subtitle || 'Weekly Training & Workload Report', 14, 19);

  // Document title below header banner
  doc.setTextColor(...DARK_INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(title, 14, 38);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED_INK);
  const now = new Date().toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  doc.text(`Generated: ${now}  |  Official Timetable Record`, 14, 44);
}

function addDocFooter(doc) {
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    doc.setDrawColor(...LINE_BORDER);
    doc.setLineWidth(0.5);
    doc.line(14, pageHeight - 12, pageWidth - 14, pageHeight - 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED_INK);
    doc.text('Class Scheduler  |  Nagarjuna College of Engineering & Technology', 14, pageHeight - 7);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - 14, pageHeight - 7, { align: 'right' });
  }
}

// Helper to extract detailed trainings and activities breakdowns with venue details
function getTrainerBreakdowns(trainer, days = []) {
  const trainingsMap = {};
  const activitiesBreakdown = {};

  if (trainer.grid && trainer.roles) {
    for (const d of Object.keys(trainer.grid)) {
      const gRow = trainer.grid[d] || [];
      const rRow = trainer.roles[d] || [];
      const vRow = trainer.venues ? trainer.venues[d] || [] : [];

      for (let i = 0; i < gRow.length; i++) {
        const val = gRow[i];
        const role = rRow[i];
        const venue = vRow[i] || '';

        if ((role === 'main' || role === 'support') && val) {
          const key = venue ? `${val}__${venue}` : val;
          if (!trainingsMap[key]) {
            trainingsMap[key] = {
              batchName: val,
              venue: venue || '',
              slots: 0,
              mainSlots: 0,
              supportSlots: 0,
            };
          }
          trainingsMap[key].slots++;
          if (role === 'main') trainingsMap[key].mainSlots++;
          if (role === 'support') trainingsMap[key].supportSlots++;
        } else if (role === 'other' && val) {
          activitiesBreakdown[val] = (activitiesBreakdown[val] || 0) + 1;
        }
      }
    }
  }

  // Fallback to pre-calculated breakdowns if grid was empty
  if (!Object.keys(trainingsMap).length && trainer.trainingsBreakdown) {
    for (const [key, count] of Object.entries(trainer.trainingsBreakdown)) {
      trainingsMap[key] = {
        batchName: key,
        venue: '',
        slots: count,
        mainSlots: count,
        supportSlots: 0,
      };
    }
  }
  if (!Object.keys(activitiesBreakdown).length && trainer.activitiesBreakdown) {
    Object.assign(activitiesBreakdown, trainer.activitiesBreakdown);
  }

  const trainingsList = Object.values(trainingsMap);
  const totalTrainings = (trainer.mainCount || 0) + (trainer.supportCount || 0);
  const totalOther = trainer.otherCount || Object.values(activitiesBreakdown).reduce((s, n) => s + n, 0);

  return {
    trainingsList,
    activitiesBreakdown,
    totalTrainings,
    totalOther,
  };
}

/* ───────────────────────────────────────────────────────────────────────────
   1. EXPORT MASTER BATCHES SCHEDULE PDF
   ─────────────────────────────────────────────────────────────────────────── */
export function exportBatchesPDF(data) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  addDocHeader(doc, 'Master Batches & Sessions Schedule', 'Academic Training Timetable');

  // Summary Metrics Bar
  const totalStudents = calculateUniqueStudents(data.batches);
  const totalSessions = data.batches.reduce((s, b) => s + (b.rows || []).length, 0);

  autoTable(doc, {
    startY: 48,
    margin: { left: 14, right: 14 },
    theme: 'plain',
    styles: { fontSize: 8.5, cellPadding: 2.5, font: 'helvetica' },
    body: [[
      `Total Batches: ${data.batches.length}`,
      `Active Year Groups: ${data.groups.length}`,
      `Enrolled Students: ${totalStudents.toLocaleString()}`,
      `Weekly Sessions: ${totalSessions}`,
      `Training Halls: ${data.venues.length}`,
      `Trainers: ${data.trainers.length}`,
    ]],
    didParseCell: (dataCell) => {
      dataCell.cell.styles.fillColor = ACCENT_BG;
      dataCell.cell.styles.textColor = BRAND_ACCENT;
      dataCell.cell.styles.fontStyle = 'bold';
      dataCell.cell.styles.halign = 'center';
    },
  });

  let currentY = doc.lastAutoTable.finalY + 6;

  for (const group of data.groups) {
    if (currentY > doc.internal.pageSize.getHeight() - 40) {
      doc.addPage();
      currentY = 20;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...BRAND_ACCENT);
    doc.text(`${group.group} (${group.batches.length} ${group.batches.length > 1 ? 'Batches' : 'Batch'})`, 14, currentY);

    const rows = [];
    for (const b of group.batches) {
      for (const r of b.rows || []) {
        rows.push([
          b.name + (b.dept ? `\n[${b.dept}]` : ''),
          b.count ? `${b.count} stds` : '—',
          r.day,
          r.time + (r.slot ? `\n(Slot ${r.slot})` : ''),
          r.subject,
          r.venue || '—',
          r.trainer || 'To be assigned',
          r.support && r.support !== '—' ? r.support : '—',
        ]);
      }
    }

    autoTable(doc, {
      startY: currentY + 3,
      margin: { left: 14, right: 14 },
      head: [['Batch / Department', 'Size', 'Days', 'Time & Slots', 'Subject', 'Training Hall', 'Main Mentor(s)', 'Support Mentor(s)']],
      body: rows,
      theme: 'grid',
      headStyles: {
        fillColor: DARK_INK,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8,
        halign: 'center',
      },
      styles: {
        font: 'helvetica',
        fontSize: 7.5,
        cellPadding: 2,
        valign: 'middle',
        lineColor: LINE_BORDER,
        lineWidth: 0.15,
      },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 42 },
        1: { halign: 'center', cellWidth: 16 },
        2: { fontStyle: 'bold', halign: 'center', cellWidth: 26 },
        3: { halign: 'center', cellWidth: 38 },
        4: { fontStyle: 'bold', cellWidth: 34 },
        5: { halign: 'center', cellWidth: 38 },
        6: { cellWidth: 38 },
        7: { cellWidth: 34 },
      },
      alternateRowStyles: {
        fillColor: LIGHT_GREY,
      },
    });

    currentY = doc.lastAutoTable.finalY + 8;
  }

  addDocFooter(doc);
  doc.save('Class_Scheduler_Batches_Schedule.pdf');
}

/* ───────────────────────────────────────────────────────────────────────────
   2. EXPORT SINGLE TRAINER TIMETABLE & WORKLOAD PDF
   ─────────────────────────────────────────────────────────────────────────── */
export function exportTrainerPDF(trainer, config) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const isNonTeaching = trainer.track === 'non-teaching' || trainer.track === 'non-technical';
  const trackLabel = isNonTeaching ? 'Non-Teaching Mentor' : 'Teaching Mentor';

  addDocHeader(doc, `Trainer Timetable: ${trainer.name} (${trackLabel})`, 'Individual Mentor Weekly Schedule & Venue Deployment');

  const { trainingsList, activitiesBreakdown, totalTrainings, totalOther } = getTrainerBreakdowns(trainer, days);

  const totalOccupied = totalTrainings + totalOther + (trainer.lunchCount || 0);

  const bodyRows = [
    [
      `Total Trainings: ${totalTrainings} slots\n(${trainer.mainCount || 0} Main, ${trainer.supportCount || 0} Support)`,
      `Other Activities: ${totalOther} slots`,
      `Free Periods: ${trainer.totalFree || 0} slots`,
      `Total Active Load: ${totalOccupied} slots`,
    ],
  ];

  if (trainingsList.length > 0) {
    const bulletList = trainingsList.map(t => {
      const roleStr = t.mainSlots && t.supportSlots
        ? `(${t.mainSlots} Main, ${t.supportSlots} Support)`
        : (t.supportSlots ? '(Support Mentor)' : '(Main Mentor)');
      const vStr = t.venue ? ` | Venue: ${t.venue}` : '';
      return `•  ${t.batchName}${vStr}  —  ${t.slots} Slot(s)  ${roleStr}`;
    }).join('\n');

    bodyRows.push([{
      content: `ASSIGNED ACADEMIC TRAININGS & VENUES:\n${bulletList}`,
      colSpan: 4,
      styles: { fontStyle: 'bold', textColor: [0, 42, 102], fillColor: [246, 248, 251], cellPadding: 3, lineHeightFactor: 1.35 },
    }]);
  }

  const otherEntries = Object.entries(activitiesBreakdown);
  if (otherEntries.length > 0) {
    const otherBullets = otherEntries.map(([task, count]) => {
      return `•  ${task}: ${count} Slot(s)`;
    }).join('\n');

    bodyRows.push([{
      content: `OTHER ASSIGNED WORK & SPECIAL DUTIES:\n${otherBullets}`,
      colSpan: 4,
      styles: { fontStyle: 'bold', textColor: [46, 51, 59], fillColor: [237, 241, 246], cellPadding: 3, lineHeightFactor: 1.35 },
    }]);
  }

  autoTable(doc, {
    startY: 48,
    margin: { left: 14, right: 14 },
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2, font: 'helvetica', lineColor: LINE_BORDER },
    body: bodyRows,
    didParseCell: (dataCell) => {
      if (dataCell.row.index === 0) {
        dataCell.cell.styles.fillColor = ACCENT_BG;
        dataCell.cell.styles.textColor = BRAND_ACCENT;
        dataCell.cell.styles.fontStyle = 'bold';
        dataCell.cell.styles.halign = 'center';
      }
    },
  });

  // Timetable Grid
  const gridHead = ['Period / Time', ...days];
  const gridRows = slots.map((timeLabel, slotIdx) => {
    const row = [`Slot ${slotIdx + 1}\n${timeLabel}`];
    for (const day of days) {
      const val = trainer.grid?.[day]?.[slotIdx] || '';
      const role = trainer.roles?.[day]?.[slotIdx] || '';
      const venue = trainer.venues?.[day]?.[slotIdx] || '';
      
      if (role === 'main') {
        row.push(`${val}${venue ? `\n@ ${abbreviateVenue(venue)}` : ''}\n[MAIN MENTOR]`);
      } else if (role === 'support') {
        row.push(`${val}${venue ? `\n@ ${abbreviateVenue(venue)}` : ''}\n[SUPPORT]`);
      } else if (role === 'other') {
        row.push(`${val}\n[ASSIGNED]`);
      } else if (role === 'lunch' || (slotIdx === lunchIndex && (!val || val.toLowerCase().includes('lunch')))) {
        row.push('Lunch Break');
      } else if (!val) {
        row.push('Free');
      } else {
        row.push(val);
      }
    }
    return row;
  });

  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 6,
    margin: { left: 14, right: 14 },
    head: [gridHead],
    body: gridRows,
    theme: 'grid',
    headStyles: {
      fillColor: DARK_INK,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8.5,
      halign: 'center',
    },
    styles: {
      font: 'helvetica',
      fontSize: 7.5,
      cellPadding: 2.2,
      halign: 'center',
      valign: 'middle',
      lineColor: LINE_BORDER,
      lineWidth: 0.15,
    },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 30, fillColor: LIGHT_GREY },
    },
    didParseCell: (dataCell) => {
      if (dataCell.section === 'body' && dataCell.column.index > 0) {
        const text = String(dataCell.cell.raw || '');
        if (text.includes('[MAIN MENTOR]')) {
          dataCell.cell.styles.fillColor = [220, 231, 248];
          dataCell.cell.styles.textColor = [0, 42, 102];
          dataCell.cell.styles.fontStyle = 'bold';
        } else if (text.includes('[SUPPORT]')) {
          dataCell.cell.styles.fillColor = [239, 244, 252];
          dataCell.cell.styles.textColor = [0, 51, 125];
        } else if (text.includes('[ASSIGNED]')) {
          dataCell.cell.styles.fillColor = [237, 241, 246];
          dataCell.cell.styles.textColor = [46, 51, 59];
          dataCell.cell.styles.fontStyle = 'bold';
        } else if (text === 'Lunch Break') {
          dataCell.cell.styles.fillColor = [246, 248, 251];
          dataCell.cell.styles.textColor = [100, 107, 118];
        } else if (text === 'Free') {
          dataCell.cell.styles.fillColor = [255, 255, 255];
          dataCell.cell.styles.textColor = [163, 172, 185];
        }
      }
    },
  });

  addDocFooter(doc);
  doc.save(`Class_Scheduler_Trainer_${trainer.name.replace(/\s+/g, '_')}_Schedule.pdf`);
}

/* ───────────────────────────────────────────────────────────────────────────
   3. EXPORT CONSOLIDATED ALL TRAINERS WORKLOAD & TIMETABLES PDF
   ─────────────────────────────────────────────────────────────────────────── */
export function exportAllTrainersPDF(scheduleData) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const { trainers, slots, days, lunchIndex } = scheduleData;

  // Page 1: Executive Trainer Workload Summary Matrix
  addDocHeader(doc, 'Consolidated Trainer Workload & Deployment Matrix', 'Faculty & Mentor Master Workload and Venue Deployment Summary');

  const summaryRows = trainers.map((t, idx) => {
    const { trainingsList, activitiesBreakdown, totalTrainings, totalOther } = getTrainerBreakdowns(t, days);

    const trainingsBullets = trainingsList.length > 0
      ? trainingsList.map(item => {
          const vStr = item.venue ? ` [${abbreviateVenue(item.venue)}]` : '';
          const roleStr = item.mainSlots && item.supportSlots
            ? ` (${item.mainSlots}M, ${item.supportSlots}S)`
            : (item.supportSlots ? ' (Supp)' : ' (Main)');
          return `• ${item.batchName}${vStr} — ${item.slots}h${roleStr}`;
        }).join('\n')
      : '— None';

    const otherEntries = Object.entries(activitiesBreakdown);
    const otherBullets = otherEntries.length > 0
      ? otherEntries.map(([task, count]) => `• ${task} — ${count}h`).join('\n')
      : '—';

    const totalActive = totalTrainings + totalOther;

    const isNonTeaching = t.track === 'non-teaching' || t.track === 'non-technical';
    return [
      idx + 1,
      t.name,
      isNonTeaching ? 'Non-Teaching' : 'Teaching',
      `${totalTrainings} slots\n(${t.mainCount || 0} Main, ${t.supportCount || 0} Supp)`,
      trainingsBullets,
      otherBullets,
      totalActive,
      t.totalFree || 0,
    ];
  });

  autoTable(doc, {
    startY: 48,
    margin: { left: 14, right: 14 },
    head: [['#', 'Trainer Name', 'Track', 'Total Trainings', 'Assigned Trainings (Batches, Venues & Hours)', 'Other Assigned Tasks', 'Total Load', 'Free Slots']],
    body: summaryRows,
    theme: 'grid',
    headStyles: {
      fillColor: DARK_INK,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8.5,
      halign: 'center',
    },
    styles: {
      font: 'helvetica',
      fontSize: 7.5,
      cellPadding: 2.2,
      valign: 'middle',
      lineColor: LINE_BORDER,
      lineWidth: 0.15,
      lineHeightFactor: 1.25,
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 8 },
      1: { fontStyle: 'bold', cellWidth: 32 },
      2: { halign: 'center', cellWidth: 22, fontStyle: 'bold' },
      3: { halign: 'center', cellWidth: 26, fontStyle: 'bold', textColor: [0, 42, 102] },
      4: { cellWidth: 86 },
      5: { cellWidth: 42 },
      6: { fontStyle: 'bold', halign: 'center', cellWidth: 22, textColor: BRAND_ACCENT },
      7: { halign: 'center', cellWidth: 18 },
    },
    didParseCell: (dataCell) => {
      if (dataCell.section === 'body' && dataCell.column.index === 2) {
        if (dataCell.cell.raw === 'Non-Teaching' || dataCell.cell.raw === 'Non-Tech') {
          dataCell.cell.styles.textColor = [10, 10, 10]; // non-teaching: ink
        } else {
          dataCell.cell.styles.textColor = [0, 42, 102]; // teaching: cobalt
        }
      }
    },
    alternateRowStyles: {
      fillColor: LIGHT_GREY,
    },
  });

  // Individual Timetable Pages for each Trainer
  for (const t of trainers) {
    doc.addPage();
    const isNonTeaching = t.track === 'non-teaching' || t.track === 'non-technical';
    const trackLabel = isNonTeaching ? 'Non-Teaching Mentor' : 'Teaching Mentor';
    addDocHeader(doc, `Timetable: ${t.name} (${trackLabel})`, `Weekly Timetable, Trainings & Assigned Venues — ${t.email || t.phone || 'Mentor'}`);

    const { trainingsList, activitiesBreakdown, totalTrainings, totalOther } = getTrainerBreakdowns(t, days);

    const totalOccupied = totalTrainings + totalOther + (t.lunchCount || 0);

    const bodyRows = [
      [
        `Total Trainings: ${totalTrainings} slots\n(${t.mainCount || 0} Main, ${t.supportCount || 0} Support)`,
        `Other Activities: ${totalOther} slots`,
        `Free Periods: ${t.totalFree || 0} slots`,
        `Total Active Load: ${totalOccupied} slots`,
      ],
    ];

    if (trainingsList.length > 0) {
      const bulletList = trainingsList.map(item => {
        const roleStr = item.mainSlots && item.supportSlots
          ? `(${item.mainSlots} Main, ${item.supportSlots} Support)`
          : (item.supportSlots ? '(Support Mentor)' : '(Main Mentor)');
        const vStr = item.venue ? ` | Venue: ${item.venue}` : '';
        return `•  ${item.batchName}${vStr}  —  ${item.slots} Slot(s)  ${roleStr}`;
      }).join('\n');

      bodyRows.push([{
        content: `ASSIGNED ACADEMIC TRAININGS & VENUES:\n${bulletList}`,
        colSpan: 4,
        styles: { fontStyle: 'bold', textColor: [0, 42, 102], fillColor: [246, 248, 251], cellPadding: 3, lineHeightFactor: 1.35 },
      }]);
    }

    const otherEntries = Object.entries(activitiesBreakdown);
    if (otherEntries.length > 0) {
      const otherBullets = otherEntries.map(([task, count]) => {
        return `•  ${task}: ${count} Slot(s)`;
      }).join('\n');

      bodyRows.push([{
        content: `OTHER ASSIGNED WORK & SPECIAL DUTIES:\n${otherBullets}`,
        colSpan: 4,
        styles: { fontStyle: 'bold', textColor: [46, 51, 59], fillColor: [237, 241, 246], cellPadding: 3, lineHeightFactor: 1.35 },
      }]);
    }

    autoTable(doc, {
      startY: 48,
      margin: { left: 14, right: 14 },
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2, font: 'helvetica', lineColor: LINE_BORDER },
      body: bodyRows,
      didParseCell: (dataCell) => {
        if (dataCell.row.index === 0) {
          dataCell.cell.styles.fillColor = ACCENT_BG;
          dataCell.cell.styles.textColor = BRAND_ACCENT;
          dataCell.cell.styles.fontStyle = 'bold';
          dataCell.cell.styles.halign = 'center';
        }
      },
    });

    const gridHead = ['Period / Time', ...days];
    const gridRows = slots.map((timeLabel, slotIdx) => {
      const row = [`Slot ${slotIdx + 1}\n${timeLabel}`];
      for (const day of days) {
        const val = t.grid?.[day]?.[slotIdx] || '';
        const role = t.roles?.[day]?.[slotIdx] || '';
        const venue = t.venues?.[day]?.[slotIdx] || '';
        
        if (role === 'main') {
          row.push(`${val}${venue ? `\n@ ${abbreviateVenue(venue)}` : ''}\n[MAIN MENTOR]`);
        } else if (role === 'support') {
          row.push(`${val}${venue ? `\n@ ${abbreviateVenue(venue)}` : ''}\n[SUPPORT]`);
        } else if (role === 'other') {
          row.push(`${val}\n[ASSIGNED]`);
        } else if (role === 'lunch' || (slotIdx === lunchIndex && (!val || val.toLowerCase().includes('lunch')))) {
          row.push('Lunch Break');
        } else if (!val) {
          row.push('Free');
        } else {
          row.push(val);
        }
      }
      return row;
    });

    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 6,
      margin: { left: 14, right: 14 },
      head: [gridHead],
      body: gridRows,
      theme: 'grid',
      headStyles: {
        fillColor: DARK_INK,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8.5,
        halign: 'center',
      },
      styles: {
        font: 'helvetica',
        fontSize: 7.5,
        cellPadding: 2.2,
        halign: 'center',
        valign: 'middle',
        lineColor: LINE_BORDER,
        lineWidth: 0.15,
      },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 30, fillColor: LIGHT_GREY },
      },
      didParseCell: (dataCell) => {
        if (dataCell.section === 'body' && dataCell.column.index > 0) {
          const text = String(dataCell.cell.raw || '');
          if (text.includes('[MAIN MENTOR]')) {
            dataCell.cell.styles.fillColor = [220, 231, 248];
            dataCell.cell.styles.textColor = [0, 42, 102];
            dataCell.cell.styles.fontStyle = 'bold';
          } else if (text.includes('[SUPPORT]')) {
            dataCell.cell.styles.fillColor = [239, 244, 252];
            dataCell.cell.styles.textColor = [0, 51, 125];
          } else if (text.includes('[ASSIGNED]')) {
            dataCell.cell.styles.fillColor = [237, 241, 246];
            dataCell.cell.styles.textColor = [46, 51, 59];
            dataCell.cell.styles.fontStyle = 'bold';
          } else if (text === 'Lunch Break') {
            dataCell.cell.styles.fillColor = [246, 248, 251];
            dataCell.cell.styles.textColor = [100, 107, 118];
          } else if (text === 'Free') {
            dataCell.cell.styles.fillColor = [255, 255, 255];
            dataCell.cell.styles.textColor = [163, 172, 185];
          }
        }
      },
    });
  }

  addDocFooter(doc);
  doc.save('Class_Scheduler_Consolidated_Trainers_Schedule.pdf');
}

/* ───────────────────────────────────────────────────────────────────────────
   4. EXPORT SINGLE DAY SCHEDULE PDF
   ─────────────────────────────────────────────────────────────────────────── */
export function exportDayPDF(data, dayName) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const dayIdx = data.days.indexOf(dayName);

  addDocHeader(doc, `Daily Academic Schedule: ${dayName}`, 'Official Day-Wise Training & Hall Deployment Record');

  // Collect all sessions for this day
  const rows = [];
  let totalBatches = 0;
  const venuesSet = new Set();
  const trainersSet = new Set();

  for (const group of data.groups) {
    for (const b of group.batches) {
      const dayRows = (b.rows || []).filter(r => dayIdx !== -1 && r.dayIndexes && r.dayIndexes.includes(dayIdx));
      if (dayRows.length > 0) {
        totalBatches++;
        for (const r of dayRows) {
          if (r.venue) venuesSet.add(r.venue);
          (r.mainList || []).forEach(t => trainersSet.add(t));
          (r.supportList || []).forEach(t => trainersSet.add(t));

          rows.push([
            group.group,
            b.name + (b.dept ? `\n[${b.dept}]` : ''),
            r.time + (r.slot ? `\n(Slot ${r.slot})` : ''),
            r.subject,
            r.venue || '—',
            r.trainer || 'To be assigned',
            r.support && r.support !== '—' ? r.support : '—',
            b.count ? `${b.count}` : '—',
          ]);
        }
      }
    }
  }

  // Summary Metrics Bar
  autoTable(doc, {
    startY: 48,
    margin: { left: 14, right: 14 },
    theme: 'plain',
    styles: { fontSize: 8.5, cellPadding: 2.5, font: 'helvetica' },
    body: [[
      `Day: ${dayName}`,
      `Active Batches: ${totalBatches}`,
      `Total Sessions: ${rows.length}`,
      `Mentors on Duty: ${trainersSet.size}`,
      `Halls in Use: ${venuesSet.size}`,
    ]],
    didParseCell: (dataCell) => {
      dataCell.cell.styles.fillColor = ACCENT_BG;
      dataCell.cell.styles.textColor = BRAND_ACCENT;
      dataCell.cell.styles.fontStyle = 'bold';
      dataCell.cell.styles.halign = 'center';
    },
  });

  if (rows.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(11);
    doc.setTextColor(...MUTED_INK);
    doc.text(`No academic sessions scheduled for ${dayName}.`, 14, doc.lastAutoTable.finalY + 15);
  } else {
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 6,
      margin: { left: 14, right: 14 },
      head: [['Year Group', 'Batch / Dept', 'Time & Slots', 'Subject', 'Training Hall', 'Main Mentor(s)', 'Support Mentor(s)', 'Students']],
      body: rows,
      theme: 'grid',
      headStyles: {
        fillColor: DARK_INK,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8.5,
        halign: 'center',
      },
      styles: {
        font: 'helvetica',
        fontSize: 7.5,
        cellPadding: 2.2,
        valign: 'middle',
        lineColor: LINE_BORDER,
        lineWidth: 0.15,
      },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 28, halign: 'center' },
        1: { fontStyle: 'bold', cellWidth: 40 },
        2: { halign: 'center', cellWidth: 36 },
        3: { fontStyle: 'bold', cellWidth: 38 },
        4: { halign: 'center', cellWidth: 36 },
        5: { cellWidth: 38 },
        6: { cellWidth: 34 },
        7: { halign: 'center', cellWidth: 18 },
      },
      alternateRowStyles: {
        fillColor: LIGHT_GREY,
      },
    });
  }

  addDocFooter(doc);
  doc.save(`Class_Scheduler_Schedule_${dayName}.pdf`);
}

/**
 * Generates an executive Monthly Schedule Calendar PDF for a given year & month.
 */
export function exportMonthCalendarPDF(schedule, year, monthIndex, filterGroup = 'All') {
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  const monthName = monthNames[monthIndex] || `Month ${monthIndex + 1}`;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  const title = `${monthName.toUpperCase()} ${year} · TRAINING CALENDAR SCHEDULE`;
  const subtitle = filterGroup !== 'All'
    ? `Monthly Timetable Schedule — Year Group: ${filterGroup}`
    : 'Monthly Institutional Timetable Schedule & Faculty Deployment';

  addDocHeader(doc, title, subtitle);

  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const rows = [];
  let trainingDays = 0;
  let totalClasses = 0;
  const activeBatches = new Set();
  const activeMentors = new Set();
  const activeVenues = new Set();

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dateObj = new Date(year, monthIndex, d);
    const dayOfWeek = weekdays[(dateObj.getDay() + 6) % 7];
    /* the same classes the on-screen calendar shows for this date: teaching
       days only, batch and session dates, holidays, cancellations and
       substitutions all applied */
    const holiday = holidayOn(dateStr, schedule.exceptions);
    const dayClasses = getClassesForDate(dateStr, schedule)
      .filter(c => !c.cancelled && (filterGroup === 'All' || c.group === filterGroup))
      .map(c => {
        activeBatches.add(c.batchName);
        if (c.venue && c.venue !== 'Unassigned') activeVenues.add(c.venue);
        [...c.mainTrainers, ...c.supportTrainers].forEach(m => activeMentors.add(m));
        return {
          batch: c.batchName, group: c.group, dept: c.dept,
          time: `${c.slotLabel} (${c.time})`,
          subject: c.subject,
          venue: abbreviateVenue(c.venue || 'Unassigned'),
          main: (c.mainTrainers.join(', ') || 'Unassigned') + (c.substitute ? ` (covering ${c.substitute.from})` : ''),
          support: c.supportTrainers.join(', ') || '—',
        };
      });
    if (holiday && schedule.days?.includes(dayOfWeek)) {
      rows.push([`${monthName.slice(0, 3)} ${d}`, dayOfWeek, `Holiday — ${holiday.label}`, '', '', '', '', '', '']);
    }

    if (dayClasses.length > 0) {
      trainingDays++;
      totalClasses += dayClasses.length;
      dayClasses.forEach((c, idx) => {
        rows.push([
          idx === 0 ? `${monthName.slice(0, 3)} ${d}` : '',
          idx === 0 ? dayOfWeek : '',
          c.batch + (c.dept ? ` (${c.dept})` : ''),
          c.group,
          c.time,
          c.subject,
          c.venue,
          c.main,
          c.support,
        ]);
      });
    }
  }

  // Monthly summary metrics cards
  const statsY = 50;
  const metrics = [
    ['Month Days', `${daysInMonth} Days`],
    ['Training Days', `${trainingDays} Days`],
    ['Total Classes', `${totalClasses} Classes`],
    ['Active Batches', `${activeBatches.size} Batches`],
    ['Faculty Deployed', `${activeMentors.size} Mentors`],
    ['Halls Utilized', `${activeVenues.size} Halls`],
  ];

  const cardW = (pageWidth - 28 - (metrics.length - 1) * 3) / metrics.length;
  metrics.forEach(([label, val], i) => {
    const x = 14 + i * (cardW + 3);
    doc.setFillColor(...ACCENT_BG);
    doc.setDrawColor(...LINE_BORDER);
    doc.roundedRect(x, statsY, cardW, 13, 1.5, 1.5, 'FD');

    doc.setFillColor(...BRAND_ACCENT);
    doc.rect(x, statsY, 1.5, 13, 'F');

    doc.setTextColor(...BRAND_ACCENT);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(val, x + 4, statsY + 5.5);

    doc.setTextColor(...MUTED_INK);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.text(label.toUpperCase(), x + 4, statsY + 10);
  });

  if (rows.length === 0) {
    doc.setTextColor(...MUTED_INK);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(11);
    doc.text('No training classes scheduled in this month for the selected filter.', 14, 76);
  } else {
    autoTable(doc, {
      startY: 68,
      margin: { left: 14, right: 14 },
      head: [['Date', 'Day', 'Batch / Section', 'Year Group', 'Period & Time', 'Subject', 'Training Hall', 'Main Mentor(s)', 'Support Mentor(s)']],
      body: rows,
      theme: 'grid',
      headStyles: {
        fillColor: DARK_INK,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8,
        halign: 'center',
      },
      styles: {
        font: 'helvetica',
        fontSize: 7.2,
        cellPadding: 2,
        valign: 'middle',
        lineColor: LINE_BORDER,
        lineWidth: 0.15,
      },
      columnStyles: {
        0: { fontStyle: 'bold', halign: 'center', cellWidth: 18 },
        1: { halign: 'center', cellWidth: 22 },
        2: { fontStyle: 'bold', cellWidth: 42 },
        3: { halign: 'center', cellWidth: 26 },
        4: { halign: 'center', cellWidth: 38 },
        5: { fontStyle: 'bold', cellWidth: 34 },
        6: { halign: 'center', cellWidth: 32 },
        7: { cellWidth: 32 },
        8: { cellWidth: 25 },
      },
      alternateRowStyles: {
        fillColor: LIGHT_GREY,
      },
    });
  }

  addDocFooter(doc);
  doc.save(`Class_Scheduler_Monthly_Schedule_${monthName}_${year}.pdf`);
}


