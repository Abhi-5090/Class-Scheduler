import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useFocusTrap } from './focus.js';

/*
 * App-wide feedback: toasts and a confirmation dialog.
 *
 *   const { toast, confirm } = useFeedback();
 *   toast('Saved C · Batch-1');                       // success
 *   toast('Could not save', 'error');
 *   if (await confirm({ title, body, confirmLabel: 'Delete', danger: true })) …
 *   // with `alternate`, a third button resolves to the string 'alternate'
 *   const r = await confirm({ …, alternate: 'Delete & notify trainers' });   // false | true | 'alternate'
 *
 * Toasts sit fixed in a corner, so they are seen wherever the page is
 * scrolled, and are announced to screen readers. The dialog replaces the
 * browser's confirm(): it can say exactly what an action will affect, traps
 * focus while open and returns focus to where it came from.
 */
const Ctx = createContext(null);
let seq = 0;

export function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);     // { title, body, confirmLabel, cancelLabel, danger, resolve }

  const dismiss = useCallback(id => setToasts(list => list.filter(t => t.id !== id)), []);

  const toast = useCallback((message, kind = 'success', ms) => {
    const id = ++seq;
    setToasts(list => [...list.slice(-3), { id, message, kind }]);
    setTimeout(() => dismiss(id), ms ?? (kind === 'error' ? 7000 : 3600));
    return id;
  }, [dismiss]);

  const confirm = useCallback(opts => new Promise(resolve => {
    setDialog(prev => {
      prev?.resolve(false);            // never leave an earlier question hanging
      return { confirmLabel: 'Confirm', cancelLabel: 'Cancel', ...opts, resolve };
    });
  }), []);

  const settle = answer => { dialog?.resolve(answer); setDialog(null); };

  return (
    <Ctx.Provider value={{ toast, confirm }}>
      {children}

      <div className="toasts" role="region" aria-label="Notifications">
        <div aria-live="polite" aria-atomic="false">
          {toasts.map(t => (
            <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
              <span className="toast-ico" aria-hidden="true">{t.kind === 'error' ? '!' : '✓'}</span>
              <span className="toast-msg">{t.message}</span>
              <button type="button" className="toast-x" onClick={() => dismiss(t.id)} aria-label="Dismiss notification">×</button>
            </div>
          ))}
        </div>
      </div>

      {dialog && <ConfirmDialog {...dialog} onAnswer={settle} />}
    </Ctx.Provider>
  );
}

function ConfirmDialog({ title, body, confirmLabel, cancelLabel, alternate, danger, onAnswer }) {
  const box = useRef(null);
  useFocusTrap(box, { initial: '[data-autofocus]' });

  useEffect(() => {
    const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); onAnswer(false); } };
    addEventListener('keydown', esc, true);
    return () => removeEventListener('keydown', esc, true);
  }, [onAnswer]);

  return (
    <div className="modal-back confirm-back" onMouseDown={e => { if (e.target === e.currentTarget) onAnswer(false); }}>
      <div className="modal confirm" ref={box} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body">
        <h2 id="confirm-title">{title}</h2>
        <div id="confirm-body" className="confirm-body">{body}</div>
        <div className="modal-foot">
          <span className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={() => onAnswer(false)} data-autofocus>{cancelLabel}</button>
          {alternate && (
            <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-ghost'}`} onClick={() => onAnswer('alternate')}>{alternate}</button>
          )}
          <button type="button" className={`btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`} onClick={() => onAnswer(true)}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export const useFeedback = () => useContext(Ctx);
