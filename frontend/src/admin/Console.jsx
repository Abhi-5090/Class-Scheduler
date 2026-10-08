import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import Wordmark from '../components/Wordmark.jsx';
import ThemeButton from '../components/ThemeButton.jsx';
import { useAdmin } from '../lib/useAdmin.js';
import { api } from '../lib/api.js';

const ICONS = {
  dashboard: <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7.5" height="7.5" rx="1.6" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" /></svg>,
  batches:   <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>,
  trainers:  <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.4" /><path d="M5 20c0-3.6 3-6 7-6s7 2.4 7 6" /></svg>,
  venues:    <svg viewBox="0 0 24 24"><path d="M4 21V8l8-5 8 5v13" /><path d="M9 21v-6h6v6" /></svg>,
  groups:    <svg viewBox="0 0 24 24"><path d="M3 7h18M3 12h18M3 17h18" /></svg>,
  periods:   <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7.4V12l3 1.8" /></svg>,
  settings:  <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2" /><path d="M12 2.6v3M12 18.4v3M2.6 12h3M18.4 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" /></svg>,
};

const TABS = [
  { to: '/admin', end: true, key: 'dashboard', label: 'Dashboard' },
  { sep: true },
  { to: '/admin/batches',  key: 'batches',  label: 'Batches & Sessions', count: d => d?.batches.length },
  { to: '/admin/trainers', key: 'trainers', label: 'Trainers',           count: d => d?.trainers.length },
  { to: '/admin/venues',   key: 'venues',   label: 'Training Halls',     count: d => d?.venues.length },
  { to: '/admin/groups',   key: 'groups',   label: 'Year Groups',        count: d => (d ? d.groups.length + d.upcoming.length : undefined) },
  { sep: true },
  { to: '/admin/periods',  key: 'periods',  label: 'Time Slots & Days' },
  { to: '/admin/settings', key: 'settings', label: 'Settings' },
];

export default function Console() {
  const { admin, signOut } = useAdmin();
  const navigate = useNavigate();
  const [counts, setCounts] = useState(null);

  useEffect(() => { document.title = 'Admin Console · Class Scheduler'; }, []);

  /* the sidebar counts come off the same public payload the board reads */
  const refreshCounts = () => api.schedule().then(setCounts).catch(() => {});
  useEffect(() => { refreshCounts(); }, []);

  /* Tabs fire this after any mutation so the sidebar never goes stale. */
  useEffect(() => {
    const onChanged = () => refreshCounts();
    addEventListener('schedule:changed', onChanged);
    return () => removeEventListener('schedule:changed', onChanged);
  }, []);

  return (
    <div className="console">
      <aside className="side">
        <div className="side-mark">
          <Wordmark size={34} />
          <div><span className="tag">Admin Console</span></div>
        </div>

        <nav className="nav">
          {TABS.map((t, i) => t.sep
            ? <div className="nav-sep" key={`s${i}`} />
            : (
              <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? 'on' : '')}>
                {ICONS[t.key]}
                {t.label}
                {t.count?.(counts) !== undefined && <span className="n">{t.count(counts)}</span>}
              </NavLink>
            ))}
        </nav>

        <div className="side-foot">
          <div className="who">{admin?.email}</div>
          <div>Signed in · full schedule control</div>
          <div className="row">
            <Link to="/">View board</Link>
            <button type="button" onClick={async () => { await signOut(); navigate('/admin/login', { replace: true }); }}>
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="console-bar"><ThemeButton surface /></div>
        <Outlet />
      </main>
    </div>
  );
}

/* Any tab that changes data calls this so the sidebar counts and the
   dashboard refresh without threading a callback through every screen. */
export const announceChange = () => dispatchEvent(new Event('schedule:changed'));
