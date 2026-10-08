import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAdmin } from '../lib/useAdmin.js';
import { useFeedback } from '../lib/feedback.jsx';
import { PageHead, Field, Notice } from './ui.jsx';

const ROLE = { admin: 'Admin', coordinator: 'Coordinator', trainer: 'Trainer' };

export default function SettingsTab() {
  const { user, clear, can } = useAdmin();
  const { toast } = useFeedback();
  const navigate = useNavigate();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [mail, setMail] = useState(null);
  const [testTo, setTestTo] = useState(user?.email || '');
  const [testing, setTesting] = useState(false);

  useEffect(() => { if (can('admin', 'coordinator')) api.mailStatus().then(setMail).catch(() => {}); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (next !== again) { setError('The two new passwords do not match'); return; }
    if (next.length < 8 || next.length > 72) { setError('The new password must be 8–72 characters'); return; }

    setBusy(true);
    try {
      await api.changePassword(current, next);
      /* the server ends every session on purpose, so sign in again */
      clear();
      navigate('/admin/login', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setTesting(true);
    try { await api.mailTest(testTo); toast(`Test email sent to ${testTo}`); }
    catch (e) { toast(e.message, 'error'); }
    finally { setTesting(false); }
  }

  return (
    <>
      <PageHead title="Settings" blurb="Your account, and how the timetable reaches people." />

      {user?.mustChangePassword && (
        <div className="admin-hint">Welcome! Your account was set up with a temporary password. Choose your own password below to continue.</div>
      )}

      <div className="card" style={{ maxWidth: 620 }}>
        <h2>Signed in as</h2>
        <p className="sub" style={{ marginBottom: 0 }}>
          <b className="mono">{user?.email}</b>{user?.name ? ` · ${user.name}` : ''}<br />
          Role: <b>{ROLE[user?.role]}</b>{user?.trainerName ? <> · linked to trainer <b>{user.trainerName}</b></> : ''}.
          {user?.role === 'admin' ? ' Accounts are managed under Users & Roles.' : ' An admin manages your access.'}
        </p>
      </div>

      <div className="card" style={{ maxWidth: 620 }}>
        <h2>{user?.mustChangePassword ? 'Set your password' : 'Change password'}</h2>
        <p className="sub">Changing it signs out every open session, including this one, so you will sign in again straight after.</p>
        <Notice error={error} />
        <form onSubmit={submit}>
          <Field label={user?.mustChangePassword ? 'Temporary password' : 'Current password'}>
            <input type="password" autoComplete="current-password" required value={current} onChange={e => setCurrent(e.target.value)} />
          </Field>
          <Field label="New password" help="8–72 characters.">
            <input type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={next} onChange={e => setNext(e.target.value)} />
          </Field>
          <Field label="New password again">
            <input type="password" autoComplete="new-password" required value={again} onChange={e => setAgain(e.target.value)} />
          </Field>
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Updating…' : user?.mustChangePassword ? 'Set password' : 'Change password'}</button>
        </form>
      </div>

      {mail && (
        <div className="card" style={{ maxWidth: 620 }}>
          <h2>Email notifications</h2>
          {mail.configured ? (
            <p className="sub">Sending from <b className="mono">{mail.from}</b>. “Save &amp; notify trainers” emails every trainer a change affects.</p>
          ) : (
            <p className="sub">
              Not configured — notifications are logged but not sent. Add <span className="mono">SMTP_HOST</span>, <span className="mono">SMTP_PORT</span>,
              <span className="mono"> SMTP_USER</span>, <span className="mono">SMTP_PASS</span> and <span className="mono">MAIL_FROM</span> to the backend
              <span className="mono"> .env</span> and restart the API. Trainers also need an email address on their record.
            </p>
          )}
          {can('admin') && mail.configured && (
            <div className="card-row">
              <Field label="Send a test to"><input type="email" value={testTo} onChange={e => setTestTo(e.target.value.trim())} /></Field>
              <button className="btn btn-ghost" style={{ alignSelf: 'flex-end' }} disabled={testing || !testTo} onClick={test}>{testing ? 'Sending…' : 'Send test email'}</button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
