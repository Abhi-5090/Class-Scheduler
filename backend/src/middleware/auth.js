import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export const COOKIE = 'cs_token';
const ALG = 'HS256';

export function signToken(user) {
  return jwt.sign(
    { sub: String(user._id), v: user.tokenVersion || 0 },
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

const expired = (res, message = 'Session expired — please sign in again') => {
  res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: undefined });
  return res.status(401).json({ error: message });
};

/*
 * Any signed-in, active account. A token is only good while its account
 * exists, is active, and its version matches (a password change, role change
 * or deactivation bumps the version and so ends every session).
 *
 * An account still on an admin-issued temporary password may only reach the
 * routes that let it change it — `allowPending` marks those.
 */
export function requireAuth({ allowPending = false } = {}) {
  return async (req, res, next) => {
    const token = req.cookies?.[COOKIE];
    if (!token) return res.status(401).json({ error: 'Not signed in' });

    let claims;
    try {
      claims = jwt.verify(token, process.env.JWT_SECRET, { algorithms: [ALG] });
    } catch {
      return expired(res);
    }

    try {
      const user = await User.findById(claims.sub, { email: 1, name: 1, role: 1, trainer: 1, active: 1, tokenVersion: 1, mustChangePassword: 1 }).lean();
      if (!user || !user.active || (user.tokenVersion || 0) !== (claims.v || 0)) return expired(res);
      req.user = {
        id: String(user._id), email: user.email, name: user.name || '', role: user.role,
        trainer: user.trainer ? String(user.trainer) : null, mustChangePassword: !!user.mustChangePassword,
      };
      if (user.mustChangePassword && !allowPending) {
        return res.status(403).json({ error: 'Change your temporary password before continuing', code: 'PASSWORD_CHANGE_REQUIRED' });
      }
      next();
    } catch (err) { next(err); }
  };
}

/* Only these roles past this point (use after requireAuth). */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Your account does not have access to this' });
    }
    next();
  };
}
