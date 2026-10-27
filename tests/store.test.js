import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, transaction } from '../server/db.js';

test('los datos sobreviven al cierre y las migraciones se pueden volver a abrir', () => {
  const directory = mkdtempSync(join(tmpdir(), 'vigia-store-'));
  const filename = join(directory, 'database.sqlite');
  let db;
  try {
    db = openStore(filename);
    db.prepare('INSERT INTO users (id, email, password_hash, profile) VALUES (?, ?, ?, ?)').run(
      'test-user',
      'store@test.invalid',
      'test-hash',
      '{}',
    );
    db.close();
    db = openStore(filename);
    assert.equal(db.prepare('SELECT email FROM users').get().email, 'store@test.invalid');
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
  } finally {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('una transacción interrumpida revierte todos sus cambios', () => {
  const db = openStore(':memory:');
  try {
    db.prepare('INSERT INTO users(id,email,password_hash,profile) VALUES(?,?,?,?)').run(
      'test-user',
      'transaction@test.invalid',
      'test-hash',
      '{}',
    );
    assert.throws(() =>
      transaction(db, () => {
        db.prepare('UPDATE users SET email=? WHERE id=?').run('changed@test.invalid', 'test-user');
        throw new Error('Interrupción controlada');
      }),
    );
    assert.equal(
      db.prepare('SELECT email FROM users WHERE id=?').get('test-user').email,
      'transaction@test.invalid',
    );
  } finally {
    db.close();
  }
});
