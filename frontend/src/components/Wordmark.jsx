/*
 * The Class Scheduler wordmark: a cobalt calendar tile beside the name. Drawn
 * inline rather than as an image so the name is set in the page's own font.
 * It always sits on the dark hero band (hero, login badge, console sidebar),
 * so it is drawn light-on-dark. `size` is the tile height in px.
 */
export default function Wordmark({ size = 40, className = '' }) {
  return (
    <span className={`wordmark ${className}`} style={{ '--wm': `${size}px` }} role="img" aria-label="Class Scheduler">
      <svg className="wm-mark" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#0047AB" />
        <rect x="7" y="9" width="18" height="16" rx="2.6" fill="none" stroke="#fff" strokeWidth="2" />
        <path d="M7 13.6h18" stroke="#fff" strokeWidth="2" />
        <path d="M12 6.6v4.4M20 6.6v4.4" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        <rect x="11" y="16.6" width="4" height="4" rx="1" fill="#fff" />
        <rect x="17" y="16.6" width="4" height="4" rx="1" fill="#fff" opacity=".45" />
      </svg>
      <span className="wm-text"><b>Class</b> Scheduler</span>
    </span>
  );
}
