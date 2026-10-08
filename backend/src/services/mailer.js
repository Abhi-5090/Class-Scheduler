import nodemailer from 'nodemailer';

/*
 * Outgoing mail over SMTP, configured from .env:
 *   SMTP_HOST, SMTP_PORT (587), SMTP_SECURE (true for port 465),
 *   SMTP_USER, SMTP_PASS, MAIL_FROM ("Class Scheduler <timetable@college.edu>")
 * Until SMTP_HOST and MAIL_FROM are set, nothing is sent and every attempt is
 * logged as skipped — the app never pretends an email went out.
 */
let transport = null;

export const mailConfigured = () => !!(process.env.SMTP_HOST && process.env.MAIL_FROM);

function getTransport() {
  if (!mailConfigured()) return null;
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
  return transport;
}

export async function sendMail({ to, subject, text, html }) {
  const t = getTransport();
  if (!t) throw Object.assign(new Error('Email is not configured on the server'), { skipped: true });
  await t.sendMail({ from: process.env.MAIL_FROM, to, subject, text, html });
}

/* Everything that goes into an HTML email body passes through here. */
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Header values must not carry line breaks (header injection). */
export const oneLine = s => String(s ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
