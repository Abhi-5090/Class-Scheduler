import { Link } from 'react-router-dom';
import Wordmark from './Wordmark.jsx';
import ThemeButton from './ThemeButton.jsx';
import { LockIcon } from './Icons.jsx';

/*
 * The hero, unchanged from the original board apart from the Admin button
 * that now sits beside the theme toggle.
 */
export default function Hero({ admin }) {
  return (
    <div className="hero">
      <div className="hero-actions">
        <Link className="admin-btn" to={admin ? '/admin' : '/admin/login'}>
          <LockIcon />
          <span className="lbl-t">{admin ? 'Admin console' : 'Admin'}</span>
        </Link>
        <ThemeButton />
      </div>

      <div className="hero-inner">
        <Wordmark size={46} className="logo" />
        <p className="eyebrow">NCET · Training Management</p>
        <h1>Weekly <span className="o">Schedule</span> Board</h1>
        <p className="lede">
          Three connected views of one master timetable — the full class schedule by year,
          every trainer's free and occupied periods, and each training hall's live occupancy.
        </p>
      </div>
    </div>
  );
}
