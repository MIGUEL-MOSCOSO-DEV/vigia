import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { openStore } from '../server/db.js';
import { createApp } from '../server/app.js';

export async function fixture(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'vigia-tests-'));
  const db = openStore(':memory:');
  const server = createApp(db, {
    appUrl: 'http://localhost:3400',
    uploadDir: join(directory, 'uploads'),
    ...options,
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  async function request(path, { method = 'GET', body, cookie, headers = {} } = {}) {
    const multipart = body instanceof FormData;
    const response = await fetch(base + '/api' + path, {
      method,
      headers: {
        ...(multipart ? {} : { 'Content-Type': 'application/json' }),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
    });
    const data = response.headers.get('content-type')?.includes('application/json')
      ? await response.json()
      : await response.text();
    return {
      status: response.status,
      data,
      cookie: response.headers.get('set-cookie')?.split(';')[0],
      headers: response.headers,
    };
  }
  async function register(name) {
    const result = await request('/auth/register', {
      method: 'POST',
      body: {
        name,
        email: name.toLowerCase() + '@tests.invalid',
        password: 'test-password-that-is-long',
      },
    });
    if (result.status !== 201) throw new Error(JSON.stringify(result.data));
    return { ...result.data.user, cookie: result.cookie };
  }
  async function close() {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    const target = resolve(directory);
    if (!target.startsWith(resolve(tmpdir()) + sep) || !target.includes('vigia-tests-'))
      throw new Error('Ruta temporal no válida');
    await rm(target, { recursive: true, force: true });
  }
  return { db, server, base, request, register, close, directory };
}
