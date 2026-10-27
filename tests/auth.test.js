import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
let f, alice, bob;
before(async () => {
  f = await fixture();
});
after(async () => {
  await f.close();
});
test('la instalación empieza sin cuentas y protege el espacio', async () => {
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM users').get().n, 0);
  assert.equal((await f.request('/workspace/state')).status, 401);
});
test('crea sesiones separadas y no expone credenciales', async () => {
  alice = await f.register('Alice');
  bob = await f.register('Bob');
  assert.notEqual(alice.cookie, bob.cookie);
  assert.equal((await f.request('/auth/me', { cookie: alice.cookie })).data.user.id, alice.id);
  assert.equal('password_hash' in alice, false);
  const session = f.db.prepare('SELECT token_hash FROM sessions LIMIT 1').get();
  assert.equal(session.token_hash.length, 64);
  assert.equal(session.token_hash.includes(alice.cookie), false);
});
test('rechaza accesos incorrectos y permite volver a iniciar sesión', async () => {
  assert.equal(
    (
      await f.request('/auth/login', {
        method: 'POST',
        body: { email: alice.email, password: 'incorrect-password-123' },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await f.request('/auth/login', {
        method: 'POST',
        body: { email: alice.email, password: 'test-password-that-is-long' },
      })
    ).status,
    200,
  );
});
test('rechaza correo repetido y solicitudes desde otro origen', async () => {
  assert.equal(
    (
      await f.request('/auth/register', {
        method: 'POST',
        body: { name: 'Alice', email: alice.email, password: 'test-password-that-is-long' },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.request('/workspace/profile', {
        cookie: alice.cookie,
        method: 'PUT',
        headers: { Origin: 'https://untrusted.invalid' },
        body: { name: 'Alice', label: 'Studio', currency: 'USD' },
      })
    ).status,
    403,
  );
});
test('el perfil es independiente y cerrar sesión invalida la cookie', async () => {
  assert.equal(
    (
      await f.request('/workspace/profile', {
        cookie: alice.cookie,
        method: 'PUT',
        body: { name: 'Alice', label: 'Mi espacio', currency: 'PEN' },
      })
    ).status,
    200,
  );
  assert.equal((await f.request('/auth/me', { cookie: bob.cookie })).data.user.currency, 'USD');
  await f.request('/auth/logout', { method: 'POST', cookie: alice.cookie, body: {} });
  assert.equal((await f.request('/auth/me', { cookie: alice.cookie })).status, 401);
});
