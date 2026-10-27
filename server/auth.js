import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const SESSION_DURATION = 1000 * 60 * 60 * 24 * 7;
export const hashToken = (token) => createHash('sha256').update(token).digest('hex');
export const createToken = () => randomBytes(32).toString('base64url');

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return salt + ':' + derived.toString('hex');
}

export async function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const derived = await scrypt(password, salt, 64);
  return timingSafeEqual(derived, Buffer.from(hash, 'hex'));
}

export function sessionToken(req) {
  const cookie = req.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('vigia_session='));
  return cookie?.slice('vigia_session='.length) || '';
}

export function startSession(db, res, userId, secure) {
  const token = createToken();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
    hashToken(token),
    userId,
    Date.now() + SESSION_DURATION,
  );
  res.cookie('vigia_session', token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DURATION,
  });
}

export function requireSession(db) {
  return (req, res, next) => {
    const user = db
      .prepare(
        'SELECT users.* FROM users JOIN sessions ON sessions.user_id = users.id WHERE sessions.token_hash = ? AND sessions.expires_at > ?',
      )
      .get(hashToken(sessionToken(req)), Date.now());
    if (!user) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
    req.user = user;
    next();
  };
}
