import { createContext, useContext, useEffect, useState, createElement } from 'react';
import { api, AUTH_EXPIRED } from './api.js';

const Ctx = createContext(null);

/* The session lives in an httpOnly cookie, so the only way to know whether we
   are signed in is to ask the server once on boot. */
export function AdminProvider({ children }) {
  const [admin, setAdmin] = useState(null);
  const [ready, setReady] = useState(false);
  /* set when a signed-in session dies mid-use, so the login page can say why */
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    api.me()
      .then(r => setAdmin(r.admin))
      .catch(() => setAdmin(null))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    const onExpired = () => setAdmin(a => { if (a) setExpired(true); return null; });
    addEventListener(AUTH_EXPIRED, onExpired);
    return () => removeEventListener(AUTH_EXPIRED, onExpired);
  }, []);

  const value = {
    admin,
    ready,
    expired,
    signIn: async (email, password) => {
      const r = await api.login(email, password);
      setExpired(false);
      setAdmin(r.admin);
      return r.admin;
    },
    signOut: async () => {
      await api.logout().catch(() => {});
      setAdmin(null);
    },
    clear: () => setAdmin(null),
  };

  return createElement(Ctx.Provider, { value }, children);
}

export const useAdmin = () => useContext(Ctx);
