import { calculateUniqueStudents } from '../lib/studentStats.js';

export default function Stats({ data }) {
  /* "active" means running today — finished and not-yet-started batches are
     on the calendar but not in this week's numbers */
  const active = data.batches.filter(b => !b.status || b.status === 'current');
  const students = data.uniqueStudents ?? calculateUniqueStudents(active);
  const cells = [
    ['', data.trainers.length, 'Trainers'],
    ['dark', active.length, 'Active Batches'],
    ['', data.venues.length, 'Training Halls'],
    ['dark', students.toLocaleString(), 'Students'],
    ['', data.days.length, 'Teaching Days'],
  ];
  return (
    <div className="stats">
      {cells.map(([c, n, l]) => (
        <div className={`stat ${c}`} key={l}>
          <div className="n">{n}</div><div className="l">{l}</div>
        </div>
      ))}
    </div>
  );
}
