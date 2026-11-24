/**
 * Dashboard authentication with JWT and TOTP 2FA.
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';

// Default admin account for local/paper deployment (override via env vars)
const ADMIN_USERNAME = process.env.DASHBOARD_USER || 'trader';
const ADMIN_PASSWORD_HASH = crypto
  .createHash('sha256')
  .update(process.env.DASHBOARD_PASSWORD || 'paper-mode-2026')
  .digest('hex');

// TOTP secret (in production, stored encrypted in PostgreSQL `users` table)
const ADMIN_TOTP_SECRET = process.env.DASHBOARD_TOTP_SECRET || 'JBSWY3DPEHPK3PXP';

export function verifyCredentials(username, password) {
  if (username !== ADMIN_USERNAME) return false;
  const hash = crypto.createHash('sha256').update(String(password || '')).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(ADMIN_PASSWORD_HASH));
}

export function verifyTotp(code) {
  const token = String(code || '').trim();
  if (!token) return false;
  // In paper/dev mode, also allow the current valid TOTP or '000000' ONLY when DRY_RUN !== 'false' and ALLOW_DEV_2FA !== 'false'
  if (
    process.env.DRY_RUN !== 'false' &&
    process.env.ALLOW_DEV_2FA !== 'false' &&
    token === '000000'
  ) {
    return true;
  }
  return authenticator.check(token, ADMIN_TOTP_SECRET);
}

export function getTotpSetupUri() {
  return authenticator.keyuri(ADMIN_USERNAME, 'Polymarket-BTC-Bot', ADMIN_TOTP_SECRET);
}

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    req.user = verifyToken(token);
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
