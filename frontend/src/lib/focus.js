import { useEffect } from 'react';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

/*
 * Keeps keyboard focus inside a dialog while it is open: Tab and Shift+Tab
 * wrap around inside it, the first field (or `initial`) is focused on open,
 * and focus goes back to whatever opened it when it closes.
 */
export function useFocusTrap(ref, { initial } = {}) {
  useEffect(() => {
    const box = ref.current;
    if (!box) return undefined;
    const opener = document.activeElement;

    const items = () => [...box.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null || el === document.activeElement);
    const first = (initial && box.querySelector(initial)) || items()[0] || box;
    if (first === box) box.setAttribute('tabindex', '-1');
    requestAnimationFrame(() => first.focus({ preventScroll: true }));

    const onKey = e => {
      if (e.key !== 'Tab') return;
      const list = items();
      if (!list.length) { e.preventDefault(); return; }
      const head = list[0], tail = list[list.length - 1];
      if (e.shiftKey && document.activeElement === head) { e.preventDefault(); tail.focus(); }
      else if (!e.shiftKey && document.activeElement === tail) { e.preventDefault(); head.focus(); }
    };
    box.addEventListener('keydown', onKey);
    return () => {
      box.removeEventListener('keydown', onKey);
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [ref, initial]);
}
