import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { z, ZodError } from 'zod';
import {
  hashPassword,
  verifyPassword,
  startSession,
  sessionToken,
  hashToken,
  requireSession,
} from './auth.js';

export const problem = (status, message) => Object.assign(new Error(message), { status });
export const text = (max) => z.string().trim().max(max);
export const money = z.number().int().min(1).max(100000000);
export const currencies = ['USD', 'PEN', 'EUR', 'MXN', 'COP', 'CLP', 'ARS', 'GBP'];
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(value + 'T00:00:00Z');
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'La fecha no es válida.');
const credentials = z.object({
  email: z
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  password: z.string().min(10).max(128),
});
const profileSchema = z.object({
  name: text(100).min(2),
  label: text(160).min(1),
  currency: z.enum(currencies),
});
export const account = (user) => ({ id: user.id, email: user.email, ...JSON.parse(user.profile) });

export function createBase(db, { appUrl, production = false, profileGuard = () => {} }) {
  const app = express();
  const origin = new URL(appUrl).origin;
  const secure = new URL(appUrl).protocol === 'https:';
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: production
        ? { directives: { upgradeInsecureRequests: secure ? [] : null } }
        : false,
      strictTransportSecurity: secure ? undefined : false,
    }),
  );
  app.use(express.json({ limit: '256kb' }));
  app.use('/api', (req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.headers.origin && req.headers.origin !== origin)
        return next(problem(403, 'El origen de la solicitud no está permitido.'));
      if (req.headers['sec-fetch-site'] === 'cross-site')
        return next(problem(403, 'Solicitud no permitida.'));
      const hasBody = Number(req.headers['content-length']) > 0 || req.headers['transfer-encoding'];
      if (
        (req.method !== 'DELETE' || hasBody) &&
        !req.is('application/json') &&
        !req.is('multipart/form-data')
      )
        return next(problem(415, 'Formato de solicitud no permitido.'));
    }
    next();
  });
  const limit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Demasiados intentos. Inténtalo en unos minutos.' },
  });
  app.post('/api/auth/register', limit, async (req, res) => {
    const input = credentials.extend({ name: text(100).min(2) }).parse(req.body);
    const passwordHash = await hashPassword(input.password);
    const id = randomUUID();
    const profile = { name: input.name, label: input.name, currency: 'USD' };
    try {
      db.prepare('INSERT INTO users (id,email,password_hash,profile) VALUES (?,?,?,?)').run(
        id,
        input.email,
        passwordHash,
        JSON.stringify(profile),
      );
    } catch (error) {
      if (db.prepare('SELECT id FROM users WHERE email=?').get(input.email))
        throw problem(409, 'Ya existe una cuenta con ese correo.');
      throw error;
    }
    startSession(db, res, id, secure);
    res.status(201).json({ user: { id, email: input.email, ...profile } });
  });
  app.post('/api/auth/login', limit, async (req, res) => {
    const input = credentials.parse(req.body);
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(input.email);
    const valid = await verifyPassword(
      input.password,
      user?.password_hash || '0'.repeat(32) + ':' + '00'.repeat(64),
    );
    if (!user || !valid) throw problem(401, 'Correo o contraseña incorrectos.');
    startSession(db, res, user.id, secure);
    res.json({ user: account(user) });
  });
  app.post('/api/auth/logout', (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(sessionToken(req)));
    res.clearCookie('vigia_session', { path: '/', httpOnly: true, sameSite: 'lax', secure });
    res.json({ ok: true });
  });
  app.get('/api/auth/me', requireSession(db), (req, res) => res.json({ user: account(req.user) }));
  const workspace = express.Router();
  app.use('/api/workspace', requireSession(db), workspace);
  workspace.put('/profile', (req, res) => {
    const profile = profileSchema.parse(req.body);
    profileGuard(req.user, profile);
    db.prepare('UPDATE users SET profile=? WHERE id=?').run(JSON.stringify(profile), req.user.id);
    res.json({ user: { id: req.user.id, email: req.user.email, ...profile } });
  });
  return { app, workspace, origin };
}

export function finishApi(app) {
  app.use('/api', (req, res) => res.status(404).json({ error: 'No se encontró el recurso.' }));
  app.use((error, req, res, next) => {
    if (error instanceof ZodError)
      return res.status(400).json({
        error:
          'Revisa los datos: ' +
          (error.issues[0]?.path.join('.') || error.issues[0]?.message || 'campo no válido'),
        issues: error.issues.map(({ path, message }) => ({ path, message })),
      });
    if (error.type === 'entity.parse.failed')
      return res.status(400).json({ error: 'El JSON no es válido.' });
    if (error.type === 'entity.too.large' || error.code === 'LIMIT_FILE_SIZE')
      return res.status(413).json({ error: 'El archivo o contenido supera el tamaño permitido.' });
    if (error.code?.startsWith('LIMIT_'))
      return res.status(400).json({ error: 'Revisa la cantidad de archivos y campos enviados.' });
    if (!error.status) console.error(error);
    res
      .status(error.status || 500)
      .json({ error: error.status ? error.message : 'No se pudo completar la operación.' });
  });
  return app;
}
