import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

import { connectDB } from './db.js';
import Admin from './models/Admin.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import scheduleRoutes from './routes/schedule.js';

const isProd = process.env.NODE_ENV === 'production';

/* The session cookie is signed with this; a missing or guessable key would let
   anyone mint an admin session, so refuse to start without a real one. */
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('\n  JWT_SECRET must be set to a random string of at least 32 characters.\n');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
/* Render (and most hosts) sit behind one proxy; trusting it makes req.ip the
   caller's address, which the login limiter keys on. */
if (isProd) app.set('trust proxy', 1);

/* An API only ever answers with JSON, so the strictest headers cost nothing. */
app.use(helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  crossOriginResourcePolicy: { policy: 'same-site' },
}));

/* Only the board's own origin(s) may call the API with the admin cookie.
   CLIENT_ORIGIN is a comma-separated list; in development any localhost port
   is allowed too, since Vite may pick another one. */
const allowed = new Set(String(process.env.CLIENT_ORIGIN || '').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean));
const isLocal = origin => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);               // same-origin and non-browser callers
    if (allowed.has(origin) || (!isProd && isLocal(origin))) return callback(null, true);
    return callback(null, false);                           // no CORS headers → the browser blocks it
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'X-Requested-With'],
  maxAge: 600,
}));

app.use(express.json({ limit: '200kb' }));
app.use(cookieParser());

/* CSRF guard. Every state-changing call from the app carries this header; a
   form or <img> on another site cannot add a custom header, and a script on
   another site cannot either without a CORS preflight, which the allow-list
   above refuses. Together that means a forged cross-site write never lands. */
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (req.get('X-Requested-With') !== 'fetch') return res.status(403).json({ error: 'Request blocked' });
  next();
});

/* Admin and auth answers carry personal data and session state — never cache them. */
app.use(['/api/admin', '/api/auth'], (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/schedule', scheduleRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

app.use((_req, res) => res.status(404).json({ error: 'No such endpoint' }));

app.use((err, _req, res, _next) => {
  /* Mongo's duplicate-key error is a user mistake, not a server fault. */
  if (err.code === 11000) {
    return res.status(409).json({ error: `That ${Object.keys(err.keyPattern || {})[0] || 'value'} is already taken` });
  }
  /* bad JSON, oversize bodies, malformed ids and schema rules are the caller's
     to fix, and their messages are safe to show */
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed request body' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large' });
  if (err.name === 'CastError') return res.status(400).json({ error: 'Invalid value in request' });
  if (err.name === 'ValidationError') {
    return res.status(400).json({ error: Object.values(err.errors || {}).map(e => e.message).join('; ') || 'Invalid input' });
  }

  const status = err.status || 500;
  if (status >= 500) {
    /* the detail goes to the server log only; the caller learns nothing about internals */
    console.error(err);
    return res.status(status).json({ error: status === 503 ? err.message : 'Something went wrong on the server' });
  }
  res.status(status).json({ error: err.message || 'Request failed' });
});

/* The single admin account lives in .env and is hashed into Mongo on first
   boot. Later boots leave it alone, so a password changed in the UI sticks. */
async function ensureAdmin() {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn('  admin   ADMIN_EMAIL / ADMIN_PASSWORD not set — no account seeded');
    return;
  }
  if (await Admin.findOne({ email })) {
    console.log('  admin  ', email, '(existing)');
    return;
  }
  await Admin.create({ email, passwordHash: await Admin.hash(password) });
  console.log('  admin  ', email, '(created)');
}

const PORT = process.env.PORT || 4000;

connectDB()
  .then(ensureAdmin)
  .then(() => app.listen(PORT, () => {
    console.log(`  api     http://localhost:${PORT}\n`);
  }))
  .catch(err => { console.error(err); process.exit(1); });

export default app;
