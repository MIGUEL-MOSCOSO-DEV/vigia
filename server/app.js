import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createBase, finishApi, problem, text } from './core.js';
import { hashToken, createToken } from './auth.js';
import { transaction } from './db.js';
import { probe, parseTarget } from './probe.js';
const monitorSchema = z.object({
  name: text(120).min(1),
  url: z
    .string()
    .max(2000)
    .refine((value) => {
      try {
        parseTarget(value);
        return true;
      } catch {
        return false;
      }
    }, 'La URL no está permitida.'),
  intervalMinutes: z.union([
    z.literal(1),
    z.literal(5),
    z.literal(15),
    z.literal(30),
    z.literal(60),
  ]),
});
const read = (row) => ({
  id: row.id,
  name: row.name,
  url: row.url,
  intervalMinutes: row.interval_minutes,
  active: Boolean(row.active),
  status: row.active ? row.status : 'paused',
  lastChecked: row.last_checked,
  latencyMs: row.latency_ms,
  httpStatus: row.http_status,
});
export function createApp(db, options = { appUrl: 'http://localhost:3400' }) {
  const { app, workspace, origin } = createBase(db, options);
  const checker = options.probe || probe;
  const running = new Set();
  let stopped = false;
  let busy = false;
  function own(id, userId) {
    const row = db.prepare('SELECT * FROM monitors WHERE id=? AND user_id=?').get(id, userId);
    if (!row) throw problem(404, 'No se encontró el monitor.');
    return row;
  }
  async function check(row) {
    if (running.has(row.id)) throw problem(409, 'Este monitor ya está comprobándose.');
    running.add(row.id);
    try {
      let result;
      try {
        result = await checker(row.url);
      } catch {
        result = { ok: false, status: null, latencyMs: 7000 };
      }
      const now = new Date().toISOString();
      transaction(db, () => {
        if (!db.prepare('SELECT id FROM monitors WHERE id=?').get(row.id)) return;
        db.prepare(
          'INSERT INTO checks(id,monitor_id,ok,latency_ms,http_status,checked_at) VALUES(?,?,?,?,?,?)',
        ).run(
          randomUUID(),
          row.id,
          Number(result.ok),
          Math.max(0, Math.round(result.latencyMs)),
          result.status || null,
          now,
        );
        db.prepare(
          'UPDATE monitors SET status=?,last_checked=?,latency_ms=?,http_status=?,next_check=? WHERE id=?',
        ).run(
          result.ok ? 'up' : 'down',
          now,
          Math.round(result.latencyMs),
          result.status || null,
          new Date(Date.now() + row.interval_minutes * 60000).toISOString(),
          row.id,
        );
        const open = db
          .prepare(
            "SELECT id FROM incidents WHERE monitor_id=? AND automatic=1 AND status!='resolved'",
          )
          .get(row.id);
        if (!result.ok && !open)
          db.prepare(
            'INSERT INTO incidents(id,user_id,monitor_id,title,body,status,automatic,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)',
          ).run(
            randomUUID(),
            row.user_id,
            row.id,
            row.name + ' no responde',
            'La comprobación HTTP falló.',
            'investigating',
            now,
            now,
          );
        if (result.ok && open)
          db.prepare("UPDATE incidents SET status='resolved',updated_at=? WHERE id=?").run(
            now,
            open.id,
          );
        db.prepare(
          'DELETE FROM checks WHERE monitor_id=? AND id NOT IN(SELECT id FROM checks WHERE monitor_id=? ORDER BY checked_at DESC LIMIT 500)',
        ).run(row.id, row.id);
      });
      return result;
    } finally {
      running.delete(row.id);
    }
  }
  function summary(userId, publicOnly = false) {
    const monitors = db
      .prepare('SELECT * FROM monitors WHERE user_id=? ORDER BY name')
      .all(userId)
      .map((row) => {
        const checks = db
          .prepare(
            'SELECT ok,latency_ms AS latencyMs,checked_at AS checkedAt FROM checks WHERE monitor_id=? ORDER BY checked_at DESC LIMIT 60',
          )
          .all(row.id);
        const count = checks.length;
        const value = {
          ...read(row),
          checks,
          uptime: count
            ? Math.round((checks.filter((item) => item.ok).length / count) * 10000) / 100
            : null,
        };
        if (publicOnly) delete value.url;
        return value;
      });
    return {
      monitors,
      incidents: db
        .prepare(
          'SELECT id,title,body,status,automatic,created_at AS createdAt,updated_at AS updatedAt FROM incidents WHERE user_id=? ORDER BY created_at DESC LIMIT 100',
        )
        .all(userId),
    };
  }
  workspace.get('/state', (req, res) => res.json(summary(req.user.id)));
  workspace.post('/monitors', (req, res) => {
    const input = monitorSchema.parse(req.body);
    if (db.prepare('SELECT count(*) AS n FROM monitors WHERE user_id=?').get(req.user.id).n >= 20)
      throw problem(409, 'El límite es de 20 monitores por cuenta.');
    const id = randomUUID();
    db.prepare(
      'INSERT INTO monitors(id,user_id,name,url,interval_minutes,next_check) VALUES(?,?,?,?,?,?)',
    ).run(id, req.user.id, input.name, input.url, input.intervalMinutes, new Date().toISOString());
    res.status(201).json({ id });
  });
  workspace.patch('/monitors/:id', (req, res) => {
    const input = z.object({ active: z.boolean() }).parse(req.body);
    own(req.params.id, req.user.id);
    db.prepare('UPDATE monitors SET active=? WHERE id=?').run(Number(input.active), req.params.id);
    res.json({ ok: true });
  });
  workspace.post('/monitors/:id/check', async (req, res) => {
    const row = own(req.params.id, req.user.id);
    if (!row.active) throw problem(409, 'Activa el monitor para comprobarlo.');
    if (row.last_checked && Date.now() - new Date(row.last_checked).getTime() < 60000)
      throw problem(429, 'Espera un minuto entre comprobaciones.');
    res.json(await check(row));
  });
  workspace.post('/incidents', (req, res) => {
    const input = z.object({ title: text(160).min(1), body: text(4000).min(1) }).parse(req.body);
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO incidents(id,user_id,title,body,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
    ).run(randomUUID(), req.user.id, input.title, input.body, 'investigating', now, now);
    res.status(201).json({ ok: true });
  });
  workspace.patch('/incidents/:id', (req, res) => {
    const input = z
      .object({
        status: z.enum(['investigating', 'identified', 'monitoring', 'resolved']),
        body: text(4000).min(1),
      })
      .parse(req.body);
    const row = db
      .prepare('SELECT id FROM incidents WHERE id=? AND user_id=?')
      .get(req.params.id, req.user.id);
    if (!row) throw problem(404, 'No se encontró el incidente.');
    db.prepare('UPDATE incidents SET status=?,body=?,updated_at=? WHERE id=?').run(
      input.status,
      input.body,
      new Date().toISOString(),
      row.id,
    );
    res.json({ ok: true });
  });
  workspace.post('/status-link', (req, res) => {
    const token = createToken();
    db.prepare(
      'INSERT INTO status_pages(user_id,token_hash) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash',
    ).run(req.user.id, hashToken(token));
    res.json({ url: origin + '/status/' + token });
  });
  app.get('/api/status/:token', (req, res) => {
    const row = db
      .prepare(
        'SELECT users.id,users.profile FROM status_pages JOIN users ON users.id=status_pages.user_id WHERE token_hash=?',
      )
      .get(hashToken(req.params.token));
    if (!row) throw problem(404, 'La página de estado no está disponible.');
    res.json({ name: JSON.parse(row.profile).label, ...summary(row.id, true) });
  });
  app.locals.startScheduler = () => {
    async function tick() {
      if (busy || stopped) return;
      busy = true;
      try {
        const rows = db
          .prepare(
            'SELECT * FROM monitors WHERE active=1 AND (next_check IS NULL OR next_check<=?) ORDER BY next_check LIMIT 20',
          )
          .all(new Date().toISOString());
        for (const row of rows) {
          if (stopped) break;
          await check(row).catch(() => {});
        }
      } finally {
        busy = false;
      }
    }
    const timer = setInterval(tick, 15000);
    timer.unref();
    tick();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  };
  app.locals.checkMonitor = check;
  return finishApi(app);
}
