import { Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import Wordmark from '../components/Wordmark.jsx';
import ThemeButton from '../components/ThemeButton.jsx';
import { Spinner } from './ui.jsx';
import { useAdmin } from '../lib/useAdmin.js';
import { api } from '../lib/api.js';

const ICONS = {
  dashboard: <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7.5" height="7.5" rx="1.6" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" /></svg>,
  me:        <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4M8 14h3" /></svg>,
  workload:  <svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>,
  finder:    <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5M11 8v3l2 1.5" /></svg>,
  batches:   <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>,
  exceptions:<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4M9.5 13.5l5 5M14.5 13.5l-5 5" /></svg>,
  trainers:  <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.4" /><path d="M5 20c0-3.6 3-6 7-6s7 2.4 7 6" /></svg>,
  venues:    <svg viewBox="0 0 24 24"><path d="M4 21V8l8-5 8 5v13" /><path d="M9 21v-6h6v6" /></svg>,
  groups:    <svg viewBox="0 0 24 24"><path d="M3 7h18M3 12h18M3 17h18" /></svg>,
  data:      <svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5M4 21h16" /></svg>,
  notify:    <svg viewBox="0 0 24 24"><path d="M4 6h16v12H4z" /><path d="M4 7l8 6 8-6" /></svg>,
  periods:   <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7.4V12l3 1.8" /></svg>,
  users:     <svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 4.5a3 3 0 010 6M18 14.6c1.8.6 3 2.4 3 4.4" /></svg>,
  history:   <svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 109-9 9.7 9.7 0 00-6.7 2.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></svg>,
  settings:  <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2" /><path d="M12 2.6v3M12 18.4v3M2.6 12h3M18.4 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" /></svg>,
};

const ALL = ['admin', 'coordinator', 'trainer'];
const STAFF = ['admin', 'coordinator'];
/* each entry says which roles see it; the server enforces the same rules */
export const TABS = [
  { to: '/admin', end: true, key: 'dashboard', label: 'Dashboard', roles: STAFF },
  { to: '/admin/me', key: 'me', label: 'My Schedule', roles: ALL, linkedOnly: true },
  { to: '/admin/workload', key: 'workload', label: 'Workload', roles: STAFF },
  { to: '/admin/finder', key: 'finder', label: 'Free Finder', roles: ALL },
  { sep: true },
  { to: '/admin/batches', key: 'batches', label: 'Batches & Sessions', roles: STAFF, count: d => d?.batches.length },
  { to: '/admin/exceptions', key: 'exceptions', label: 'Holidays & Exceptions', roles: STAFF },
  { to: '/admin/trainers', key: 'trainers', label: 'Trainers', roles: ['admin'], count: d => d?.trainers.length },
  { to: '/admin/venues', key: 'venues', label: 'Training Halls', roles: ['admin'], count: d => d?.venues.length },
  { to: '/admin/groups', key: 'groups', label: 'Year Groups', roles: ['admin'], count: d => (d ? d.groups.length + d.upcoming.length : undefined) },
  { sep: true, roles: STAFF },
  { to: '/admin/data', key: 'data', label: 'Import & Export', roles: STAFF },
  { to: '/admin/notifications', key: 'notify', label: 'Notifications', roles: STAFF },
  { to: '/admin/periods', key: 'periods', label: 'Time Slots & Days', roles: ['admin'] },
  { to: '/admin/users', key: 'users', label: 'Users & Roles', roles: ['admin'] },
  { to: '/admin/history', key: 'history', label: 'Change History', roles: ['admin'] },
  { sep: true, roles: ALL },
  { to: '/admin/settings', key: 'settings', label: 'Settings', roles: ALL },
];

const ROLE_LABEL = { admin: 'Admin', coordinator: 'Coordinator', trainer: 'Trainer' };

export default function Console() {
  const { user, signOut } = useAdmin();
  const navigate = useNavigate();
  const [counts, setCounts] = useState(null);

  useEffect(() => { document.title = 'Console · Class Scheduler'; }, []);

  /* the sidebar counts come off the same public payload the board reads */
  const refreshCounts = () => api.schedule().then(setCounts).catch(() => {});
  useEffect(() => { refreshCounts(); }, []);

  /* Tabs fire this after any mutation so the sidebar never goes stale. */
  useEffect(() => {
    const onChanged = () => refreshCounts();
    addEventListener('schedule:changed', onChanged);
    return () => removeEventListener('schedule:changed', onChanged);
  }, []);

  const pending = user?.mustChangePassword;
  const tabs = TABS.filter(t => (!t.roles || t.roles.includes(user?.role)) && (!t.linkedOnly || user?.trainerId || user?.role === 'trainer'));
  /* drop separators that would sit first, last or doubled */
  const nav = tabs.filter((t, i) => !t.sep || (i > 0 && i < tabs.length - 1 && !tabs[i - 1].sep));

  return (
    <div className="console">
      <aside className="side">
        <div className="side-mark">
          <Wordmark size={34} />
          <div><span className="tag">{ROLE_LABEL[user?.role] || 'Console'}</span></div>
        </div>

        <nav className="nav" aria-label="Console">
          {pending ? (
            <NavLink to="/admin/settings" className={({ isActive }) => (isActive ? 'on' : '')}>{ICONS.settings}Set your password</NavLink>
          ) : nav.map((t, i) => t.sep
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
          <div className="who">{user?.name || user?.email}</div>
          <div>{user?.email}{user?.trainerName ? ` · ${user.trainerName}` : ''}</div>
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
        <Suspense fallback={<Spinner />}><Outlet /></Suspense>
      </main>
    </div>
  );
}

/* Any tab that changes data calls this so the sidebar counts and the
   dashboard refresh without threading a callback through every screen. */
export const announceChange = () => dispatchEvent(new Event('schedule:changed'));
