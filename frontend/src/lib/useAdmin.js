import { createContext, useContext, useEffect, useState, createElement } from 'react';
import { api, AUTH_EXPIRED } from './api.js';

const Ctx = createContext(null);

/*
 * The signed-in account, if any. The session lives in an httpOnly cookie, so
 * the only way to know who we are is to ask the server once on boot.
 *
 *   user   { email, name, role: 'admin' | 'coordinator' | 'trainer',
 *            trainerId, trainerName, mustChangePassword } or null
 *   admin  the user when they may edit the timetable (admin or coordinator),
 *          else null — what the public board checks before making cells editable
 *   can('admin', 'coordinator')  true when the user holds one of the roles
 *
 * The server enforces every one of these rules; the client only uses them to
 * decide what to show.
 */
export function AdminProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  /* set when a signed-in session dies mid-use, so the login page can say why */
  const [expired, setExpired] = useState(false);

  const refresh = () => api.me().then(r => setUser(r.user)).catch(() => setUser(null));

  useEffect(() => { refresh().finally(() => setReady(true)); }, []);

  useEffect(() => {
    const onExpired = () => setUser(u => { if (u) setExpired(true); return null; });
    addEventListener(AUTH_EXPIRED, onExpired);
    return () => removeEventListener(AUTH_EXPIRED, onExpired);
  }, []);

  const can = (...roles) => !!user && roles.includes(user.role);

  const value = {
    user,
    admin: can('admin', 'coordinator') ? user : null,
    can,
    ready,
    expired,
    refresh,
    signIn: async (email, password) => {
      const r = await api.login(email, password);
      setExpired(false);
      setUser(r.user);
      return r.user;
    },
    signOut: async () => {
      await api.logout().catch(() => {});
      setUser(null);
    },
    clear: () => setUser(null),
  };

  return createElement(Ctx.Provider, { value }, children);
}

export const useAdmin = () => useContext(Ctx);

/* where an account lands when it opens the console */
export const homeFor = user => (user?.role === 'trainer' ? '/admin/me' : '/admin');
