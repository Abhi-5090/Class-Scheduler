import { useRef } from 'react';
import { toggleTheme, currentTheme } from '../lib/theme.js';
import { useState, useEffect } from 'react';

/* `surface` draws it for a light card or page instead of the dark hero band. */
export default function ThemeButton({ surface = false }) {
  const ref = useRef(null);
  const [theme, setTheme] = useState(currentTheme);

  /* another tab may have flipped it */
  useEffect(() => {
    const sync = e => { if (e.key === 'cs-theme' && e.newValue) setTheme(e.newValue); };
    addEventListener('storage', sync);
    return () => removeEventListener('storage', sync);
  }, []);

  return (
    <button
      ref={ref}
      className={surface ? 'theme-btn on-surface' : 'theme-btn'}
      type="button"
      aria-label="Toggle dark mode"
      onClick={() => toggleTheme(ref.current, setTheme)}
    >
      <span className="ic">
        <svg className="moon" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" /></svg>
        <svg className="sun" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2v2.4M12 19.6V22M2 12h2.4M19.6 12H22M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M19.1 4.9l-1.7 1.7M6.6 17.4l-1.7 1.7" />
        </svg>
      </span>
      <span className="lbl-t">{theme === 'dark' ? 'Light' : 'Dark'}</span>
    </button>
  );
}
