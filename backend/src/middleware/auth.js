import jwt from 'jsonwebtoken';
import Admin from '../models/Admin.js';

export const COOKIE = 'cs_token';
const ALG = 'HS256';

export function signToken(admin) {
  return jwt.sign(
    { sub: String(admin._id), v: admin.tokenVersion || 0 },
    process.env.JWT_SECRET,
    { expiresIn: '12h', algorithm: ALG },
  );
}

/* Sent as an httpOnly cookie so no token ever touches client-side JS.
   sameSite 'none' + secure: true in production lets the cookie travel between
   the board's host and the API's host; CORS and the X-Requested-With check in
   server.js are what stop other sites from riding on it. */
export function cookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
    maxAge: 12 * 60 * 60 * 1000,
    path: '/',
  };
}

/* A token is only good while the account it names still exists and its
   password has not changed since it was issued. */
export async function requireAdmin(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token) return res.status(401).json({ error: 'Not signed in' });

  let claims;
  try {
    claims = jwt.verify(token, process.env.JWT_SECRET, { algorithms: [ALG] });
  } catch {
    return res.status(401).json({ error: 'Session expired — please sign in again' });
  }

  try {
    const admin = await Admin.findById(claims.sub, { email: 1, name: 1, tokenVersion: 1 }).lean();
    if (!admin || (admin.tokenVersion || 0) !== (claims.v || 0)) {
      res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: undefined });
      return res.status(401).json({ error: 'Session expired — please sign in again' });
    }
    req.admin = { sub: String(admin._id), email: admin.email, name: admin.name };
    next();
  } catch (err) { next(err); }
}
