import { useCallback, useEffect, useState } from 'react';

/* ── modal ─────────────────────────────────────────────────────────────── */
/*
 * `dirty` marks unsaved edits: a stray Escape or backdrop click then asks
 * before throwing them away, and leaving or reloading the page warns too.
 * The explicit Cancel button is the caller's own and closes straight away.
 */
export function Modal({ title, sub, children, onClose, footer, wide, dirty = false }) {
  const dismiss = useCallback(() => {
    if (dirty && !window.confirm('Discard your unsaved changes?')) return;
    onClose();
  }, [dirty, onClose]);

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
      <div className="modal" style={wide ? { maxWidth: 980 } : undefined} role="dialog" aria-modal="true">
        <h2>{title}</h2>
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

export function Field({ label, help, children }) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {children}
      {help && <div className="help">{help}</div>}
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

/*
 * One collection's worth of state: the rows, a load/refresh, and mutations
 * that surface the server's own message rather than a generic failure.
 */
export function useCollection(kind) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  const load = useCallback(async (apiRef) => {
    try { setRows(await apiRef.list(kind)); }
    catch (e) { setError(e.message); setRows([]); }
  }, [kind]);

  const flash = msg => { setOk(msg); setError(''); setTimeout(() => setOk(''), 2600); };

  return { rows, setRows, error, setError, ok, setOk, flash, load };
}

/* Reads better at a call site than a bare window.confirm. */
export function confirmDelete(what) {
  return window.confirm(`Delete ${what}?\n\nThis cannot be undone.`);
}
