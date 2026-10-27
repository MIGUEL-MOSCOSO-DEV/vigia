import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { probe, isPublicAddress, parseTarget } from '../server/probe.js';
let f, owner, other, id, token;
let healthy = false;
before(async () => {
  f = await fixture({
    probe: async () => ({ ok: healthy, status: healthy ? 200 : 503, latencyMs: 42 }),
  });
  owner = await f.register('Owner');
  other = await f.register('Other');
});
after(async () => f.close());
test('bloquea redes privadas, loopback y puertos alternativos', async () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '::1',
    'fc00::1',
    '::ffff:192.168.1.1',
  ])
    assert.equal(isPublicAddress(address), false);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.throws(() => parseTarget('http://example.com:22'));
  assert.throws(() => parseTarget('https://user:pass@example.com'));
  await assert.rejects(() => probe('http://127.0.0.1'));
  await assert.rejects(() =>
    probe('https://example.com', { resolver: async () => [{ address: '10.0.0.1', family: 4 }] }),
  );
});
test('aísla monitores entre cuentas', async () => {
  const result = await f.request('/workspace/monitors', {
    cookie: owner.cookie,
    method: 'POST',
    body: { name: 'Service', url: 'https://example.com', intervalMinutes: 5 },
  });
  assert.equal(result.status, 201);
  id = result.data.id;
  assert.equal(
    (await f.request('/workspace/state', { cookie: other.cookie })).data.monitors.length,
    0,
  );
  assert.equal(
    (
      await f.request('/workspace/monitors/' + id, {
        cookie: other.cookie,
        method: 'PATCH',
        body: { active: false },
      })
    ).status,
    404,
  );
});
test('registra una caída y crea un incidente automático', async () => {
  const result = await f.request('/workspace/monitors/' + id + '/check', {
    cookie: owner.cookie,
    method: 'POST',
    body: {},
  });
  assert.equal(result.status, 200);
  const state = (await f.request('/workspace/state', { cookie: owner.cookie })).data;
  assert.equal(state.monitors[0].status, 'down');
  assert.equal(state.incidents[0].status, 'investigating');
  assert.equal(state.monitors[0].uptime, 0);
});
test('limita comprobaciones manuales y resuelve al recuperarse', async () => {
  assert.equal(
    (
      await f.request('/workspace/monitors/' + id + '/check', {
        cookie: owner.cookie,
        method: 'POST',
        body: {},
      })
    ).status,
    429,
  );
  healthy = true;
  await f.server;
  const row = f.db.prepare('SELECT * FROM monitors WHERE id=?').get(id);
  const app = f.server.listeners('request')[0];
  await app.locals.checkMonitor(row);
  const state = (await f.request('/workspace/state', { cookie: owner.cookie })).data;
  assert.equal(state.monitors[0].status, 'up');
  assert.equal(state.monitors[0].uptime, 50);
  assert.equal(state.incidents[0].status, 'resolved');
});
test('la página pública oculta las URLs y renovar retira el enlace anterior', async () => {
  let result = await f.request('/workspace/status-link', {
    cookie: owner.cookie,
    method: 'POST',
    body: {},
  });
  token = new URL(result.data.url).pathname.split('/')[2];
  const page = await f.request('/status/' + token);
  assert.equal('url' in page.data.monitors[0], false);
  result = await f.request('/workspace/status-link', {
    cookie: owner.cookie,
    method: 'POST',
    body: {},
  });
  assert.equal((await f.request('/status/' + token)).status, 404);
});
test('un monitor pausado no admite comprobación manual', async () => {
  await f.request('/workspace/monitors/' + id, {
    cookie: owner.cookie,
    method: 'PATCH',
    body: { active: false },
  });
  assert.equal(
    (
      await f.request('/workspace/monitors/' + id + '/check', {
        cookie: owner.cookie,
        method: 'POST',
        body: {},
      })
    ).status,
    409,
  );
});
