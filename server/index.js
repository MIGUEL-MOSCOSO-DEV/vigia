import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import express from 'express';
import { openStore } from './db.js';
import { createApp } from './app.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const production = process.argv.includes('--production');
const port = Number(process.env.PORT || 3400);
const host = process.env.HOST || '127.0.0.1';
const appUrl = process.env.APP_URL || 'http://localhost:' + port;
const db = openStore(resolve(process.env.DATABASE_PATH || './data/vigia.sqlite'));
const app = createApp(db, { appUrl, production });
const stopScheduler = app.locals.startScheduler();
let vite;

if (production) {
  if (!existsSync('dist/index.html'))
    throw new Error('Ejecuta npm run build antes de iniciar en producción.');
  app.use(express.static(resolve('dist'), { index: false }));
  app.get('/{*path}', (req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  const { createServer } = await import('vite');
  vite = await createServer({
    server: { middlewareMode: true, hmr: { port: port + 1 } },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

const server = app.listen(port, host, () => console.log('Vigía disponible en ' + appUrl));
server.on('error', (error) => {
  console.error(error.message);
  db.close();
  process.exit(1);
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () =>
    server.close(async () => {
      stopScheduler();
      await vite?.close();
      db.close();
      process.exit(0);
    }),
  );
}
