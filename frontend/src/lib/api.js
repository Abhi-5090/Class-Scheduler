/* Same-origin /api by default: the Vite dev server proxies it to the local
   backend. For a deploy, set VITE_API_URL to the backend's public URL. */
const RAW_API_URL = import.meta.env.VITE_API_URL || '/api';
const API_BASE = RAW_API_URL.replace(/\/+$/, '');

/* Fired when a signed-in call comes back 401: the session expired or the
   password was changed elsewhere. useAdmin listens and drops to signed-out. */
export const AUTH_EXPIRED = 'auth:expired';

/* Every call carries the session cookie; nothing here reads or stores a token.
   X-Requested-With is the API's CSRF check — a page on another site cannot
   send it, so the API refuses any write that lacks it. */
async function call(path, { method = 'GET', body } = {}) {
  const url = API_BASE.startsWith('http') ? `${API_BASE}/api${path}` : `${API_BASE}${path}`;
  const headers = { 'X-Requested-With': 'fetch' };
  if (body) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: 'include',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error('Cannot reach the server — check your connection and try again'), { status: 0 });
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* a proxy or host error page — never echo its HTML into the UI */
    data = { error: `The server returned an unexpected response (${res.status})` };
  }

  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    if (res.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/me')) {
      dispatchEvent(new Event(AUTH_EXPIRED));
    }
    throw err;
  }
  return data;
}

export const api = {
  schedule: () => call('/schedule'),

  login: (email, password) => call('/auth/login', { method: 'POST', body: { email, password } }),
  logout: () => call('/auth/logout', { method: 'POST' }),
  me: () => call('/auth/me'),
  changePassword: (currentPassword, newPassword) =>
    call('/auth/password', { method: 'POST', body: { currentPassword, newPassword } }),

  config: () => call('/admin/config'),

  /* ── people and access (admin) ── */
  users: () => call('/admin/users'),
  createUser: body => call('/admin/users', { method: 'POST', body }),
  updateUser: (id, body) => call(`/admin/users/${id}`, { method: 'PUT', body }),
  deleteUser: id => call(`/admin/users/${id}`, { method: 'DELETE' }),

  /* ── holidays and one-off exceptions ── */
  exceptions: (range = {}) => call(`/admin/exceptions?${new URLSearchParams(range)}`),
  createException: (body, notify) => call(`/admin/exceptions${notify ? '?notify=1' : ''}`, { method: 'POST', body }),
  updateException: (id, body) => call(`/admin/exceptions/${id}`, { method: 'PUT', body }),
  deleteException: (id, notify) => call(`/admin/exceptions/${id}${notify ? '?notify=1' : ''}`, { method: 'DELETE' }),

  /* ── spreadsheet import: rows already parsed in the browser ── */
  importRows: (kind, rows, dryRun) => call('/admin/import', { method: 'POST', body: { kind, rows, dryRun } }),

  /* ── read-only views ── */
  analytics: () => call('/insights/analytics'),
  finder: params => call(`/insights/finder?${new URLSearchParams(params)}`),
  mySchedule: () => call('/insights/me'),
  audit: params => call(`/logs/audit?${new URLSearchParams(params)}`),
  notifications: (status = '') => call(`/logs/notifications${status ? `?status=${status}` : ''}`),
  mailStatus: () => call('/logs/mail'),
  mailTest: to => call('/logs/mail/test', { method: 'POST', body: { to } }),
  saveConfig: body => call('/admin/config', { method: 'PUT', body }),

  /* `when` is [{day, slots}] — one entry for a single session, every session
     on the batch when checking a hall. */
  availability: (when, excludeBatch, range = {}) => {
    const q = when
      .filter(w => w.day && w.slots.length)
      .map(w => `when=${encodeURIComponent(`${w.day}:${[...w.slots].sort((a, b) => a - b).join(',')}`)}`);
    if (!q.length) return Promise.resolve({ when: [], trainers: [], venues: [] });
    if (excludeBatch) q.push(`excludeBatch=${encodeURIComponent(excludeBatch)}`);
    if (range.from) q.push(`from=${encodeURIComponent(range.from)}`);
    if (range.to) q.push(`to=${encodeURIComponent(range.to)}`);
    return call(`/admin/availability?${q.join('&')}`);
  },

  /* groups / trainers / venues / batches all share one CRUD shape */
  list:   kind => call(`/admin/${kind}`),
  /* `notify` (batches, activities) also emails every trainer the change touches */
  create: (kind, body, notify) => call(`/admin/${kind}${notify ? '?notify=1' : ''}`, { method: 'POST', body }),
  update: (kind, id, body, notify) => call(`/admin/${kind}/${id}${notify ? '?notify=1' : ''}`, { method: 'PUT', body }),
  remove: (kind, id, notify) => call(`/admin/${kind}/${id}${notify ? '?notify=1' : ''}`, { method: 'DELETE' }),

  reorderBatches: items =>
    Promise.all(items.map(item => call(`/admin/batches/${item.id || item._id}`, { method: 'PUT', body: { order: Number(item.order) || 0 } }))),
  reorderGroupBatches: (group, orderedIds) =>
    Promise.all(orderedIds.map((id, index) => call(`/admin/batches/${id}`, { method: 'PUT', body: { order: index } }))),

  /* what a trainer is doing during a period that isn't a class */
  setActivity: ({ trainer, day, slots, kind, label }, notify) =>
    call(`/admin/activities${notify ? '?notify=1' : ''}`, { method: 'PUT', body: { trainer, day, slots, kind, label } }),
  clearActivity: ({ trainer, day, slots }, notify) => {
    const q = new URLSearchParams({ trainer, day, slots: slots.join(',') });
    if (notify) q.set('notify', '1');
    return call(`/admin/activities?${q}`, { method: 'DELETE' });
  },
};
