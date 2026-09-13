import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { _electron, expect } from '@playwright/test';
import { createApp } from '../../server/app.ts';

// Run from the repository root after npm run build:
// node --import tsx --test desktop/tests/mola.integration.mjs
test('packaged web UI sends and reloads messages through the real Mola API and Socket.IO in Electron', { timeout: 90_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'mola-desktop-integration-'));
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(done => reservation.close(done));
  const origin = `http://127.0.0.1:${port}`;
  const previousStatic = process.env.SERVE_STATIC;
  process.env.SERVE_STATIC = 'true';
  const runtime = createApp({
    appOrigin: origin, databasePath: ':memory:', dataDir: directory,
    uploadDir: join(directory, 'uploads'), production: false,
    mailEncryptionKey: 'a'.repeat(64), mailTransport: async () => {},
  });
  let application;
  t.after(async () => {
    await application?.close();
    await runtime.close();
    if (previousStatic === undefined) delete process.env.SERVE_STATIC;
    else process.env.SERVE_STATIC = previousStatic;
    await rm(directory, { recursive: true, force: true });
  });
  await new Promise(done => runtime.server.listen(port, '127.0.0.1', done));
  const env = { ...process.env, MOLA_SERVER_URL: origin };
  delete env.ELECTRON_RUN_AS_NODE;
  const require = createRequire(new URL('../package.json', import.meta.url));
  application = await _electron.launch({
    executablePath: require('electron'), chromiumSandbox: true,
    args: [resolve('desktop/main.cjs'), `--user-data-dir=${join(directory, 'profile')}`], env,
  });
  const page = await application.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const composer = page.getByRole('textbox', { name: /kanalına mesaj yaz/ });
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => runtime.io.engine.clientsCount).toBeGreaterThan(0);
  const text = `Masaüstünden merhaba ${Date.now()}`;
  await composer.fill(text);
  await page.getByRole('button', { name: 'Mesaj gönder', exact: true }).click();
  await expect(page.locator('p.message-text').filter({ hasText: text })).toBeVisible();
  await page.reload();
  await expect(page.locator('p.message-text').filter({ hasText: text })).toBeVisible();
  assert.equal(runtime.repo.get('SELECT COUNT(*) AS n FROM messages WHERE content = ?', text).n, 1);
  assert.deepEqual(errors, []);
  await mkdir(resolve('artifacts'), { recursive: true });
  await page.screenshot({ path: resolve('artifacts/mola-desktop.png'), animations: 'disabled' });
});
