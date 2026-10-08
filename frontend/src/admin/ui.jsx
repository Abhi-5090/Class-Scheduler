import { Children, cloneElement, isValidElement, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useFeedback } from '../lib/feedback.jsx';
import { useFocusTrap } from '../lib/focus.js';

/* ── modal ─────────────────────────────────────────────────────────────── */
/*
 * `dirty` marks unsaved edits: a stray Escape or backdrop click then asks
 * before throwing them away, and leaving or reloading the page warns too.
 * The explicit Cancel button is the caller's own and closes straight away.
 * Focus is trapped inside while it is open and handed back on close.
 */
export function Modal({ title, sub, children, onClose, footer, wide, dirty = false }) {
  const { confirm } = useFeedback();
  const box = useRef(null);
  const titleId = useId();
  useFocusTrap(box);

  const dismiss = useCallback(async () => {
    if (dirty && !(await confirm({
      title: 'Discard unsaved changes?',
      body: 'You have edits in this form that have not been saved. Closing now will lose them.',
      confirmLabel: 'Discard changes',
      cancelLabel: 'Keep editing',
      danger: true,
    }))) return;
    onClose();
  }, [dirty, onClose, confirm]);

  useEffect(() => {
    const esc = e => {
      /* Escape inside an open <select> only closes the dropdown */
      if (e.key === 'Escape' && e.target?.tagName !== 'SELECT') dismiss();
    };
    addEventListener('keydown', esc);
    /* the page behind must not scroll while a modal is up */
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { removeEventListener('keydown', esc); document.body.style.overflow = prev; };
  }, [dismiss]);

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = e => { e.preventDefault(); e.returnValue = ''; };
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [dirty]);

  return (
    <div className="modal-back" onMouseDown={e => { if (e.target === e.currentTarget) dismiss(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} ref={box} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>{title}</h2>
        {sub && <p className="sub">{sub}</p>}
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ── page scaffolding ──────────────────────────────────────────────────── */
export function PageHead({ title, blurb, children }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{blurb && <p>{blurb}</p>}</div>
      {children && <div className="card-row" style={{ flex: 'none' }}>{children}</div>}
    </div>
  );
}

/* A labelled form field. When the field holds a single control, the label is
   tied to it (htmlFor/id) and the help text described by it, so screen readers
   announce the field's name and hint. */
export function Field({ label, help, children }) {
  const id = useId();
  const only = Children.count(children) === 1 && isValidElement(children) && ['input', 'select', 'textarea'].includes(children.type);
  const control = only
    ? cloneElement(children, { id: children.props.id || id, 'aria-describedby': help ? `${id}-help` : undefined })
    : children;
  return (
    <div className="field" role={!only && label ? 'group' : undefined} aria-labelledby={!only && label ? `${id}-label` : undefined}>
      {label && (only ? <label htmlFor={children.props.id || id}>{label}</label> : <label id={`${id}-label`}>{label}</label>)}
      {control}
      {help && <div className="help" id={`${id}-help`}>{help}</div>}
    </div>
  );
}

export function Notice({ error, ok }) {
  if (error) return <div className="form-error">{error}</div>;
  if (ok) return <div className="form-ok">{ok}</div>;
  return null;
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Spinner() {
  return <div style={{ display: 'grid', placeItems: 'center', padding: '54px 0' }}><div className="ldr" /></div>;
}


/* ── table search + sort ───────────────────────────────────────────────
 * const t = useTable(rows, { text: r => `${r.name} ${r.dept}`, sorts: { name: r => r.name, … }, initial: 'name' });
 * t.rows is filtered by t.query and ordered by t.sort ({ key, dir }); t.toggle(key) flips
 * a column between ascending and descending. Text compares case-insensitively and
 * numbers numerically, with blanks always last. */
export function useTable(rows, { text, sorts, initial, initialDir = 'asc' }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState({ key: initial, dir: initialDir });

  const view = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (rows || []).filter(r => !q || text(r).toLowerCase().includes(q));
    const get = sorts[sort.key];
    if (!get) return list;
    const dir = sort.dir === 'desc' ? -1 : 1;
    return [...list].sort((a, b) => {
      const x = get(a), y = get(b);
      const blankX = x === '' || x === null || x === undefined, blankY = y === '' || y === null || y === undefined;
      if (blankX || blankY) return blankX === blankY ? 0 : blankX ? 1 : -1;
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
      return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' }) * dir;
    });
  }, [rows, query, sort, text, sorts]);

  const toggle = key => setSort(s => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  return { rows: view, query, setQuery, sort, setSort, toggle };
}

/* A column header that sorts its column; announces the order to screen readers. */
export function SortTh({ label, k, table, className, style }) {
  const on = table.sort.key === k;
  return (
    <th className={className} style={style} aria-sort={on ? (table.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`th-sort ${on ? 'on' : ''}`} onClick={() => table.toggle(k)}>
        {label}<span className="th-arrow" aria-hidden="true">{on ? (table.sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );
}

export function SearchBox({ value, onChange, label, placeholder }) {
  return (
    <div className="search admin-search">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
      </svg>
      <input type="search" aria-label={label} placeholder={placeholder} value={value} maxLength={80} onChange={e => onChange(e.target.value)} />
    </div>
  );
}
