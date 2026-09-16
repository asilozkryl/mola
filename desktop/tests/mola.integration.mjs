import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { _electron, expect } from '@playwright/test';
import { createApp } from '../../server/app.ts';

async function closeApplication(application) {
  if (!application) return;
  let timeout;
  try {
    await Promise.race([
      application.close(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          application.process()?.kill('SIGKILL');
          reject(new Error('The isolated Electron test process did not close within 5 seconds.'));
        }, 5000);
      }),
    ]);
  } finally { clearTimeout(timeout); }
}

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
    try { await closeApplication(application); }
    finally {
      await runtime.close();
      if (previousStatic === undefined) delete process.env.SERVE_STATIC;
      else process.env.SERVE_STATIC = previousStatic;
      await rm(directory, { recursive: true, force: true });
    }
  });
  await new Promise(done => runtime.server.listen(port, '127.0.0.1', done));
  const env = { ...process.env, MOLA_SERVER_URL: origin };
  delete env.ELECTRON_RUN_AS_NODE;
  const require = createRequire(new URL('../package.json', import.meta.url));
  await mkdir(join(directory, 'profile'), { recursive: true });
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

test('the real desktop notification settings recover from denial and retain consent and sound preferences after restart', { timeout: 90_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'mola-desktop-notification-integration-'));
  const profile = join(directory, 'profile');
  await mkdir(profile, { recursive: true });
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
    mailEncryptionKey: 'b'.repeat(64), mailTransport: async () => {},
  });
  let application;
  t.after(async () => {
    try { await closeApplication(application); }
    finally {
      await runtime.close();
      if (previousStatic === undefined) delete process.env.SERVE_STATIC;
      else process.env.SERVE_STATIC = previousStatic;
      await rm(directory, { recursive: true, force: true });
    }
  });
  await new Promise(done => runtime.server.listen(port, '127.0.0.1', done));
  const env = { ...process.env, MOLA_SERVER_URL: origin };
  delete env.ELECTRON_RUN_AS_NODE;
  const require = createRequire(new URL('../package.json', import.meta.url));
  const launch = () => _electron.launch({
    executablePath: require('electron'), chromiumSandbox: true,
    args: [resolve('desktop/main.cjs'), `--user-data-dir=${profile}`], env,
  });
  application = await launch();
  let page = await application.firstWindow();
  const errors = [];
  const browserPushRequests = [];
  const observe = current => {
    current.on('pageerror', error => errors.push(error.message));
    current.on('request', request => {
      if (/^\/api\/notifications\/(?:preferences|subscriptions)$/.test(new URL(request.url()).pathname)) browserPushRequests.push(request.url());
    });
  };
  observe(page);
  await expect(page.getByRole('textbox', { name: /kanalına mesaj yaz/ })).toBeVisible({ timeout: 30_000 });
  await application.evaluate(({ dialog }) => {
    const original = dialog.showMessageBox;
    globalThis.molaNotificationPrompts = [];
    const decisions = [0, 1];
    dialog.showMessageBox = (...args) => {
      const options = args.at(-1);
      if (options.title !== 'Mola izin isteği') return original.apply(dialog, args);
      globalThis.molaNotificationPrompts.push(options.message);
      return Promise.resolve({ response: decisions.shift() ?? 0, checkboxChecked: false });
    };
  });
  // Keep the real Notification implementation and permission handler. Only make
  // an accidental Web Push call observable; desktop delivery must never use it.
  await page.evaluate(() => {
    window.molaPushAttempts = 0;
    PushManager.prototype.subscribe = async () => { window.molaPushAttempts++; throw new Error('Desktop must not subscribe to Web Push.'); };
  });
  await page.getByRole('button', { name: 'Bildirimler ve uygulama', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Masaüstü bildirimleri', exact: true })).toBeVisible();
  const enable = page.getByRole('button', { name: 'Bu cihazda bildirimleri aç', exact: true });
  await expect(enable).toBeEnabled();
  await enable.click();
  await expect(page.locator('.notification-error')).toContainText('İzin verilmedi');
  assert.equal(await page.evaluate(() => Notification.permission), 'denied');
  await enable.click();
  await expect(page.locator('.notification-device-state')).toHaveAttribute('data-state', 'enabled');
  assert.equal(await page.evaluate(() => Notification.permission), 'granted');
  assert.equal((await application.evaluate(() => globalThis.molaNotificationPrompts)).length, 2);
  assert.equal(await page.evaluate(() => window.molaPushAttempts), 0);

  const sound = await page.evaluate(async () => {
    const response = await fetch('/sounds/mola.wav');
    const context = new AudioContext();
    try {
      const decoded = await context.decodeAudioData(await response.arrayBuffer());
      return { status: response.status, duration: decoded.duration, channels: decoded.numberOfChannels };
    } finally { await context.close(); }
  });
  assert.equal(sound.status, 200);
  assert.ok(sound.duration > 0.1 && sound.duration < 2, 'The built WAV must decode as a short notification sound.');
  assert.ok(sound.channels === 1 || sound.channels === 2);
  await page.getByRole('checkbox', { name: 'Mola bildirim sesi' }).uncheck();

  // Exercise the real OS path once with synthetic fixture text. A CI host can
  // have no notification daemon; that must surface honestly instead of claiming
  // success merely because the Notification constructor returned.
  await page.getByRole('button', { name: 'Test bildirimi gönder', exact: true }).click();
  await expect.poll(async () => {
    if (await page.locator('.notification-error').count()) return 'unavailable';
    return (await page.locator('.notification-success').textContent())?.includes('sistemine gönderildi') ? 'shown' : 'pending';
  }, { timeout: 12_000 }).not.toBe('pending');
  if (await page.locator('.notification-error').count()) {
    await expect(page.locator('.notification-success')).toHaveCount(0);
    t.diagnostic(`Native notification service reported: ${await page.locator('.notification-error').textContent()}`);
  } else t.diagnostic('The host notification service acknowledged the synthetic test notification.');

  // Delivery probes are installed only after both native permission decisions
  // above. Preserve the actual permission getter and request API.
  await page.evaluate(() => {
    const Native = Notification;
    window.molaNotificationDelivery = { fail: true, options: [], instances: [] };
    class DeliveryProbe {
      static get permission() { return Native.permission; }
      static requestPermission(...args) { return Native.requestPermission(...args); }
      constructor(_title, options) {
        window.molaNotificationDelivery.options.push(options);
        window.molaNotificationDelivery.instances.push(this);
        setTimeout(() => window.molaNotificationDelivery.fail ? this.onerror?.() : this.onshow?.(), 0);
      }
      close() { this.onclose?.(); }
    }
    window.Notification = DeliveryProbe;
  });
  await page.getByRole('button', { name: 'Test bildirimi gönder', exact: true }).click();
  await expect(page.locator('.notification-error')).toContainText('gönderilemedi');
  await expect(page.locator('.notification-success')).toHaveCount(0);
  await page.evaluate(() => { window.molaNotificationDelivery.fail = false; });
  await page.getByRole('button', { name: 'Test bildirimi gönder', exact: true }).click();
  await expect(page.locator('.notification-success')).toContainText('sistemine gönderildi');
  assert.ok((await page.evaluate(() => window.molaNotificationDelivery.options)).every(options => options.silent === true));

  const beforeFocusUrl = page.url();
  const beforeFocusWindows = application.windows().length;
  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().startsWith('http:'));
    const originalIsMinimized = window.isMinimized.bind(window);
    const originalRestore = window.restore.bind(window);
    const handler = window.webContents._windowOpenHandler;
    globalThis.molaNotificationFocus = { restores: 0, requests: [], reset: () => {
      window.isMinimized = originalIsMinimized; window.restore = originalRestore;
      window.webContents.setWindowOpenHandler(handler);
    } };
    window.webContents.setWindowOpenHandler(details => {
      globalThis.molaNotificationFocus.requests.push({ url: details.url, referrer: details.referrer });
      return handler(details);
    });
    // CI has no window manager. Simulate only the minimized state and observe
    // the real click -> custom scheme -> guarded main-process restore path.
    window.isMinimized = () => true;
    window.restore = () => { globalThis.molaNotificationFocus.restores++; originalRestore(); };
  });
  await page.evaluate(() => window.molaNotificationDelivery.instances.at(-1).onclick());
  await expect.poll(() => application.evaluate(() => globalThis.molaNotificationFocus.requests.length)).toBe(1);
  t.diagnostic(`Notification focus request: ${JSON.stringify(await application.evaluate(() => globalThis.molaNotificationFocus.requests[0]))}`);
  await expect.poll(() => application.evaluate(() => globalThis.molaNotificationFocus.restores)).toBe(1);
  assert.equal(page.url(), beforeFocusUrl, 'A test-notification click must focus without navigation or reload.');
  assert.equal(application.windows().length, beforeFocusWindows, 'A notification click must not create a new BrowserWindow.');
  await application.evaluate(() => globalThis.molaNotificationFocus.reset());

  await page.keyboard.press('Escape');
  const bootstrap = await page.evaluate(() => fetch('/api/auth/me').then(response => response.json()));
  const channel = bootstrap.channels.find(candidate => candidate.name === 'genel');
  assert.ok(channel, 'The fixture must have the default open channel.');
  await page.getByRole('button', { name: channel.name, exact: true }).click();
  await expect(page.getByRole('button', { name: channel.name, exact: true })).toHaveAttribute('aria-current', 'page');
  const room = `workspace-user:${bootstrap.workspace.id}:${bootstrap.user.id}`;
  await expect.poll(() => runtime.io.sockets.adapter.rooms.get(room)?.size ?? 0).toBeGreaterThan(0);
  const emitAttention = messageId => runtime.io.to(room).emit('notifications:attention', {
    workspaceId: bootstrap.workspace.id, channelId: channel.id, messageId,
  });
  const firstDeliveryCount = await page.evaluate(() => window.molaNotificationDelivery.options.length);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.hasFocus = () => true;
  });
  emitAttention(randomUUID());
  // A fetch round trip lets the already-enqueued Socket.IO frame be processed.
  await page.evaluate(() => fetch('/api/auth/me').then(response => response.json()));
  assert.equal(await page.evaluate(() => window.molaNotificationDelivery.options.length), firstDeliveryCount,
    'A visible, focused current conversation must not generate another alert.');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.hasFocus = () => false;
  });
  emitAttention(randomUUID());
  await expect.poll(() => page.evaluate(() => window.molaNotificationDelivery.options.length)).toBe(firstDeliveryCount + 1);
  await page.evaluate(() => { delete document.visibilityState; delete document.hasFocus; });

  await closeApplication(application);
  application = undefined;
  application = await launch();
  page = await application.firstWindow();
  observe(page);
  await expect(page.getByRole('textbox', { name: /kanalına mesaj yaz/ })).toBeVisible({ timeout: 30_000 });
  assert.equal(await page.evaluate(() => Notification.permission), 'granted');
  await page.getByRole('button', { name: 'Bildirimler ve uygulama', exact: true }).click();
  await expect(page.locator('.notification-device-state')).toHaveAttribute('data-state', 'enabled');
  await expect(page.getByRole('checkbox', { name: 'Mola bildirim sesi' })).not.toBeChecked();
  await page.getByRole('button', { name: 'Bu cihazda kapat', exact: true }).click();
  await expect(page.locator('.notification-device-state')).toHaveAttribute('data-state', 'disabled');
  await page.reload();
  await page.getByRole('button', { name: 'Bildirimler ve uygulama', exact: true }).click();
  await expect(page.locator('.notification-device-state')).toHaveAttribute('data-state', 'disabled');
  await expect.poll(() => runtime.io.sockets.adapter.rooms.get(room)?.size ?? 0).toBeGreaterThan(0);
  await page.evaluate(() => {
    const Native = Notification;
    window.molaDisabledNotificationAttempts = 0;
    window.Notification = class {
      static get permission() { return Native.permission; }
      constructor() { window.molaDisabledNotificationAttempts++; }
    };
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.hasFocus = () => false;
  });
  emitAttention(randomUUID());
  await page.evaluate(() => fetch('/api/auth/me').then(response => response.json()));
  assert.equal(await page.evaluate(() => window.molaDisabledNotificationAttempts), 0,
    'An opted-out account must not show notifications even with a saved OS permission and an incoming attention event.');
  assert.deepEqual(browserPushRequests, [], 'Desktop settings must not read or mutate browser push preferences.');
  assert.deepEqual(errors, []);
});
