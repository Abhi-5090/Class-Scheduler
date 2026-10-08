/*
 * Brute-force brake for the login form. Failed attempts are counted per
 * caller IP and per email address inside a sliding window; past the limit,
 * further attempts are refused until the window clears, without even
 * checking the password (so a guesser also stops costing us bcrypt time).
 *
 * In-memory is enough for one API instance. If the API is ever scaled out to
 * several, move these counters to a shared store (Mongo/Redis).
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_IP = 20;          // a shared campus IP still gets room for honest typos
const MAX_PER_EMAIL = 6;        // the account being guessed at is the real target

const failures = new Map();     // key -> timestamps of recent failures

const recent = key => {
  const now = Date.now();
  const list = (failures.get(key) || []).filter(t => now - t < WINDOW_MS);
  if (list.length) failures.set(key, list); else failures.delete(key);
  return list;
};

/* the store must not grow without bound under a spray of random emails */
setInterval(() => { for (const key of failures.keys()) recent(key); }, WINDOW_MS).unref();

const keys = (ip, email) => [`ip:${ip}`, `em:${email}`];

/* Returns seconds to wait, or 0 if this caller may try now. */
export function lockedFor(ip, email) {
  const [ipKey, emKey] = keys(ip, email);
  const ipList = recent(ipKey), emList = recent(emKey);
  const blocked = [];
  if (ipList.length >= MAX_PER_IP) blocked.push(ipList[ipList.length - MAX_PER_IP]);
  if (email && emList.length >= MAX_PER_EMAIL) blocked.push(emList[emList.length - MAX_PER_EMAIL]);
  if (!blocked.length) return 0;
  return Math.ceil((Math.max(...blocked) + WINDOW_MS - Date.now()) / 1000);
}

export function recordFailure(ip, email) {
  const now = Date.now();
  for (const key of keys(ip, email)) {
    if (key === 'em:') continue;
    failures.set(key, [...recent(key), now]);
  }
}

/* a correct password clears that account's count (the IP's stays, so one
   valid login cannot be used to reset a guessing run on other accounts) */
export function recordSuccess(_ip, email) {
  failures.delete(`em:${email}`);
}
