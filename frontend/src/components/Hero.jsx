import { Link } from 'react-router-dom';
import { useAdmin, homeFor } from '../lib/useAdmin.js';
import Wordmark from './Wordmark.jsx';
import ThemeButton from './ThemeButton.jsx';
import { LockIcon } from './Icons.jsx';

/*
 * The hero, unchanged from the original board apart from the Admin button
 * that now sits beside the theme toggle.
 */
export default function Hero() {
  const { user } = useAdmin();
  return (
    <div className="hero">
      <div className="hero-actions">
        <Link className="admin-btn" to={user ? homeFor(user) : '/admin/login'}>
          <LockIcon />
          <span className="lbl-t">{user ? (user.role === 'trainer' ? 'My schedule' : 'Console') : 'Sign in'}</span>
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
