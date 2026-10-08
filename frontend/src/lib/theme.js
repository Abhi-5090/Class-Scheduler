/*
 * The theme reveal, ported unchanged from the original board: the incoming
 * theme opens as a feathered circle growing from the toggle out past the
 * farthest corner. The comments explaining why each piece is here were
 * written against the original and still apply.
 */
const root = document.documentElement;
export const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;

const REVEAL_MS = 1100, FEATHER = 96;

export function applyTheme(t) {
  root.dataset.theme = t;
  try { localStorage.setItem('cs-theme', t); } catch (e) {}
}

export function currentTheme() {
  return root.dataset.theme === 'dark' ? 'dark' : 'light';
}

/* Radius from the button past the farthest corner. visualViewport is asked
   first because on a phone innerHeight lies while the browser chrome slides.
   The 18% overshoot spends the curve's slow tail off-screen, so the part of
   the wave you can actually see never decelerates — it crosses and leaves. */
function reachFrom(x, y) {
  const vw = Math.max(root.clientWidth, (window.visualViewport && visualViewport.width) || innerWidth);
  const vh = Math.max(root.clientHeight, (window.visualViewport && visualViewport.height) || innerHeight);
  return Math.hypot(Math.max(x, vw - x), Math.max(y, vh - y)) * 1.18;
}

/* A view transition paints two frozen snapshots. Scrolling while they are up
   moves the live document beneath them and the two tear apart along the
   circle, so the page is pinned for as long as the wave takes to cross. */
const SCROLL_KEYS = { 32: 1, 33: 1, 34: 1, 35: 1, 36: 1, 37: 1, 38: 1, 39: 1, 40: 1 };
let pinY = 0;
const swallow = e => e.preventDefault();
const swallowKey = e => { if (SCROLL_KEYS[e.keyCode]) e.preventDefault(); };
function pinScroll() {
  if (pageYOffset === pinY) return;
  try { scrollTo({ top: pinY, left: 0, behavior: 'instant' }); } catch (e) { scrollTo(0, pinY); }
}
function holdScroll(on) {
  const fn = on ? 'addEventListener' : 'removeEventListener';
  if (on) pinY = pageYOffset;
  window[fn]('wheel', swallow, { passive: false });
  window[fn]('touchmove', swallow, { passive: false });
  window[fn]('keydown', swallowKey, false);
  window[fn]('scroll', pinScroll, false);
}

/* No View Transitions API: same wave and curve, but with nothing to snapshot
   it carries the destination colour, swaps underneath, then fades off. */
function fallbackReveal(x, y, end, next) {
  const at = ` at ${x}px ${y}px`;
  const soft = r => `radial-gradient(circle${at}, #000 ${r}px, rgba(0,0,0,0) ${r + FEATHER}px)`;
  const veil = document.createElement('div');
  veil.className = 'veil';
  veil.style.background = next === 'dark' ? '#070708' : '#F6F8FB';
  veil.style.clipPath = `circle(${FEATHER}px${at})`;
  veil.style.webkitMaskImage = veil.style.maskImage = soft(0);
  document.body.appendChild(veil);
  veil.getBoundingClientRect();                       /* force layout so it animates */
  const E = 'cubic-bezier(.22,.61,.36,1)';
  veil.style.transition = `clip-path ${REVEAL_MS}ms ${E}, mask-image ${REVEAL_MS}ms ${E}, -webkit-mask-image ${REVEAL_MS}ms ${E}`;
  veil.style.clipPath = `circle(${end + FEATHER}px${at})`;
  veil.style.webkitMaskImage = veil.style.maskImage = soft(end);
  setTimeout(() => {
    applyTheme(next);
    veil.style.transition = 'opacity 280ms cubic-bezier(.4,0,.2,1)';
    veil.style.opacity = '0';
    setTimeout(() => { veil.remove(); holdScroll(false); }, 300);
  }, REVEAL_MS);
}

let busy = false;                     /* a second click mid-flight is ignored */

export function toggleTheme(originEl, onChange) {
  if (busy) return;
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  const commit = () => { applyTheme(next); onChange?.(next); };

  if (RM || !originEl) { commit(); return; }

  const box = originEl.getBoundingClientRect();
  const x = box.left + box.width / 2, y = box.top + box.height / 2;
  const end = reachFrom(x, y);

  /* hand the geometry to the stylesheet before anything is captured */
  root.style.setProperty('--reveal-x', `${x}px`);
  root.style.setProperty('--reveal-y', `${y}px`);
  root.style.setProperty('--reveal-r', `${end}px`);
  root.style.setProperty('--reveal-ms', `${REVEAL_MS}ms`);
  holdScroll(true);

  if (!document.startViewTransition) {
    fallbackReveal(x, y, end, next);
    onChange?.(next);
    return;
  }

  busy = true;
  /* one release, whichever way the transition ends; the timer is the floor
     under a promise that never settles, so the page can never stay locked */
  let released = false;
  const release = () => { if (released) return; released = true; busy = false; holdScroll(false); };
  const vt = document.startViewTransition(commit);
  vt.finished.then(release, release);
  if (vt.ready && vt.ready.catch) vt.ready.catch(() => {});
  setTimeout(release, REVEAL_MS + 400);
}
