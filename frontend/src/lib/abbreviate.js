/**
 * Abbreviate batch/subject names for compact or mobile timetable slot views.
 * Examples:
 *   "AI Ready 2027 · Batch-1" => "AIR '27 · B1"
 *   "AI Ready 2028 · Batch-2" => "AIR '28 · B2"
 *   "C & Data Structures · Batch-1" => "C & DS · B1"
 *   "Java Full Stack · Batch-2" => "Java FS · B2"
 *   "Designing Work" => "Design"
 *   "Development" => "Dev"
 */
export function abbreviateBatch(str) {
  if (!str) return '';
  let s = String(str)
    .replace(/AI Ready\s*20(\d{2})/gi, "AIR '$1")
    .replace(/Artificial Intelligence/gi, 'AI')
    .replace(/Machine Learning/gi, 'ML')
    .replace(/Data Structures/gi, 'DS')
    .replace(/Full Stack/gi, 'FS')
    .replace(/Batch[- ]?(\d+)/gi, 'B$1')
    .replace(/Development/gi, 'Dev')
    .replace(/Designing Work/gi, 'Design')
    .replace(/Curriculum Design/gi, 'Curriculum')
    .replace(/App Testing/gi, 'Testing')
    .replace(/Social Media/gi, 'Social');

  return s.trim();
}

/**
 * Abbreviate venue / hall names for compact or mobile timetable slot views.
 * Examples:
 *   "Training Block · 1st Floor Hall" => "Training · 1F"
 *   "Training Block · 2nd Floor Hall" => "Training · 2F"
 *   "Examination Block · 3rd Floor Hall" => "Exam · 3F"
 *   "Main Block · Seminar Hall 1" => "Main · Sem Hall 1"
 */
export function abbreviateVenue(str) {
  if (!str) return '';
  let s = String(str)
    .replace(/Examination Block/gi, 'Exam')
    .replace(/Training Block/gi, 'Training')
    .replace(/(\d+)(?:st|nd|rd|th)\s+Floor\s+(?:Hall|Auditorium|Lab)?/gi, '$1F')
    .replace(/Ground\s+Floor/gi, 'GF')
    .replace(/Seminar Hall/gi, 'Sem Hall')
    .replace(/Auditorium/gi, 'Audi')
    .replace(/Laboratory/gi, 'Lab')
    .replace(/Block/gi, 'Blk')
    .replace(/\s*·\s*/g, ' · ')
    .replace(/\s+/g, ' ');

  return s.trim();
}

export const DAY_MAP = {
  Monday: 'Mon',
  Tuesday: 'Tue',
  Wednesday: 'Wed',
  Thursday: 'Thu',
  Friday: 'Fri',
  Saturday: 'Sat',
  Sunday: 'Sun',
};

export function formatDayShort(d) {
  if (!d) return '';
  return DAY_MAP[d] || d.slice(0, 3);
}


