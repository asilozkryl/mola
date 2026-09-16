const assert = require('node:assert/strict');
const { once } = require('node:events');
const { mkdtemp, rm } = require('node:fs/promises');
const { createServer } = require('node:http');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createECDH } = require('node:crypto');
const { _electron, expect } = require('@playwright/test');

const desktopRoot = path.resolve(__dirname, '..');
const fixtureHtml = `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><title>Mola</title></head>
<body>
  <h1>Mola test sunucusu</h1>
  <p role="status" id="session">Kontrol ediliyor</p>
  <button id="login">Oturum aç</button>
  <button id="popout">Görüşmeyi ayrı pencerede aç</button>
  <button id="media">Mikrofon ve kamerayı dene</button>
  <p id="media-result"></p>
  <button id="notification">Bildirim izni iste</button>
  <p id="notification-result"></p>
  <button id="display">Ekran paylaşımını dene</button>
  <p id="display-result"></p>
  <a id="unsafe" href="file:///mola-smoke-test-must-not-open.html">Güvensiz bağlantı</a>
  <script>
    async function session() {
      const response = await fetch('/api/session', { credentials: 'same-origin' });
      const value = await response.json();
      document.querySelector('#session').textContent = value.authenticated ? 'Oturum açık' : 'Oturum kapalı';
    }
    document.querySelector('#login').onclick = async () => {
      await fetch('/api/login', { method: 'POST', credentials: 'same-origin' });
      await session();
    };
    document.querySelector('#popout').onclick = () => {
      const popup = window.open('about:blank', '', 'popup,width=880,height=540');
      if (!popup) return;
      popup.opener = null;
      popup.document.title = 'Mola görüşme';
      popup.document.body.textContent = 'Görüşme penceresi';
    };
    document.querySelector('#media').onclick = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        const kinds = stream.getTracks().map(track => track.kind).sort();
        stream.getTracks().forEach(track => track.stop());
        document.querySelector('#media-result').textContent = kinds.join(',');
      } catch (error) {
        document.querySelector('#media-result').textContent = error.name + ': ' + error.message;
      }
    };
    document.querySelector('#notification').onclick = async () => {
      document.querySelector('#notification-result').textContent = await Notification.requestPermission();
    };
    document.querySelector('#display').onclick = async () => {
      document.querySelector('#display-result').textContent = 'İsteniyor';
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        stream.getTracks().forEach(track => track.stop());
        document.querySelector('#display-result').textContent = 'Ekran yakalandı';
      } catch (error) {
        document.querySelector('#display-result').textContent = error.name;
      }
    };
    session();
  </script>
</body></html>`;

async function fixtureServer(unavailable = false) {
  const server = createServer((request, response) => {
    if (unavailable) { request.socket.destroy(); return; }
    response.setHeader('Cache-Control', 'no-store');
    if (request.url === '/api/session') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({
        authenticated: /(?:^|;\s*)mola_session=smoke-session(?:;|$)/.test(request.headers.cookie || ''),
      }));
    } else if (request.url === '/api/login' && request.method === 'POST') {
      response.setHeader('Set-Cookie', 'mola_session=smoke-session; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800');
      response.setHeader('Content-Type', 'application/json');
      response.end('{}');
    } else if (request.url === '/permission-worker.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(`
        self.addEventListener('install', () => self.skipWaiting());
        self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
        self.addEventListener('message', event => {
          event.waitUntil(navigator.permissions.query({ name: 'notifications' })
            .then(permission => event.ports[0].postMessage(permission.state)));
        });
      `);
    } else if (request.url === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(fixtureHtml);
    } else {
      response.writeHead(404).end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

async function launch(userData, serverUrl, fakeMedia = true) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.MOLA_SERVER_URL;
  if (serverUrl) env.MOLA_SERVER_URL = serverUrl;
  return _electron.launch({
    executablePath: require(path.join(desktopRoot, 'node_modules', 'electron')),
    args: [path.join(desktopRoot, 'main.cjs'), `--user-data-dir=${userData}`, ...(fakeMedia ? ['--use-fake-device-for-media-stream'] : [])],
    chromiumSandbox: true,
    env,
    timeout: 30_000,
  });
}

async function closeApplication(application) {
  if (!application) return;
  let timer;
  try {
    await Promise.race([
      application.close(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          application.process()?.kill('SIGKILL');
          reject(new Error('Electron did not close within 5 seconds; its isolated test process was stopped.'));
        }, 5000);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

async function cleanup(application, userData, ...servers) {
  try { await closeApplication(application); }
  finally {
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    await rm(userData, { recursive: true, force: true });
  }
}

async function assertSandbox(page) {
  assert.deepEqual(await page.evaluate(() => ({
    require: typeof window.require,
    process: typeof window.process,
    bridge: typeof window.molaDesktop,
  })), { require: 'undefined', process: 'undefined', bridge: 'undefined' });
}

test('desktop setup validates the server, isolates remote content, and preserves sign-in after restart', { timeout: 120_000 }, async (t) => {
  const userData = await mkdtemp(path.join(tmpdir(), 'mola-desktop-smoke-'));
  const { server, url } = await fixtureServer();
  let application;
  t.after(() => cleanup(application, userData, server));

  await t.test('first launch rejects plain HTTP on a public host and accepts loopback', async () => {
    application = await launch(userData);
    const setup = await application.firstWindow();
    await expect(setup.getByLabel('Sunucu adresi')).toBeVisible();
    await setup.getByLabel('Sunucu adresi').fill('http://example.com');
    await setup.getByRole('button', { name: 'Bağlan', exact: true }).click();
    await expect(setup.getByRole('alert')).toBeVisible();
    await expect(setup.getByRole('alert')).not.toHaveText('');
    assert.equal(new URL(setup.url()).protocol, 'mola-desktop:');

    await setup.getByLabel('Sunucu adresi').fill(url);
    await setup.getByRole('button', { name: 'Bağlan', exact: true }).click();
    await expect.poll(() => application.windows().find((page) => page.url() === url)).toBeTruthy();
    const remote = application.windows().find((page) => page.url() === url);
    await expect(remote.getByRole('heading', { name: 'Mola test sunucusu' })).toBeVisible();
    await expect(remote.getByRole('status')).toHaveText('Oturum kapalı');
  });

  await t.test('the authenticated renderer and call pop-out have no Node or desktop bridge', async () => {
    const remote = application.windows().find((page) => page.url() === url);
    assert.ok(remote, 'The configured server must remain open.');
    await assertSandbox(remote);
    await remote.getByRole('button', { name: 'Oturum aç', exact: true }).click();
    await expect(remote.getByRole('status')).toHaveText('Oturum açık');
    assert.equal(await remote.evaluate(() => document.cookie.includes('mola_session')), false);

    const popupEvent = remote.waitForEvent('popup');
    await remote.getByRole('button', { name: 'Görüşmeyi ayrı pencerede aç' }).click();
    const popup = await popupEvent;
    await expect(popup.locator('body')).toHaveText('Görüşme penceresi');
    await assertSandbox(popup);
    await popup.close();

    // This must be denied without invoking the user's external browser.
    await remote.getByRole('link', { name: 'Güvensiz bağlantı' }).click();
    await expect(remote.getByRole('heading', { name: 'Mola test sunucusu' })).toBeVisible();
    assert.equal(remote.url(), url);
  });

  await t.test('approved microphone and camera requests produce real media streams', async () => {
    const remote = application.windows().find((page) => page.url() === url);
    await application.evaluate(({ dialog }) => {
      const original = dialog.showMessageBox;
      globalThis.molaSmokeMediaPrompts = [];
      dialog.showMessageBox = (...args) => {
        const options = args.at(-1);
        if (options.title !== 'Mola izin isteği') return original.apply(dialog, args);
        globalThis.molaSmokeMediaPrompts.push(options.message);
        return Promise.resolve({ response: 1, checkboxChecked: false });
      };
    });
    await remote.getByRole('button', { name: 'Mikrofon ve kamerayı dene' }).click();
    await expect(remote.locator('#media-result')).toHaveText('audio,video');
    const prompts = await application.evaluate(() => globalThis.molaSmokeMediaPrompts);
    assert.equal(prompts.length, 1, 'A real media permission request must reach the native permission dialog.');
    assert.match(prompts[0], /mikrofon/);
    assert.match(prompts[0], /kamera/);

    const denied = await remote.evaluate(() => new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(() => resolve(false), (error) => resolve(error.code === 1));
    }));
    assert.equal(denied, true, 'Unrelated geolocation access must remain denied.');
  });

  await t.test('notification permission remains granted when queried after approval', async () => {
    const remote = application.windows().find((page) => page.url() === url);
    await application.evaluate(({ dialog }) => {
      const original = dialog.showMessageBox;
      let declined = false;
      dialog.showMessageBox = (...args) => {
        if (!declined && args.at(-1).message === 'bildirim erişimine izin verilsin mi?') {
          declined = true;
          return Promise.resolve({ response: 0, checkboxChecked: false });
        }
        return original.apply(dialog, args);
      };
    });
    await remote.getByRole('button', { name: 'Bildirim izni iste' }).click();
    await expect(remote.locator('#notification-result')).toHaveText('denied');
    // Electron initially reports denied when no grant exists. An explicit
    // action must still prompt, including after declining a previous request.
    await remote.getByRole('button', { name: 'Bildirim izni iste' }).click();
    await expect(remote.locator('#notification-result')).toHaveText('granted');
    const state = await remote.evaluate(async () => (await navigator.permissions.query({ name: 'notifications' })).state);
    assert.equal(state, 'granted');
    const workerState = await remote.evaluate(async () => {
      await navigator.serviceWorker.register('/permission-worker.js');
      const registration = await navigator.serviceWorker.ready;
      return new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        const timeout = setTimeout(() => reject(new Error('Notification permission worker did not answer.')), 5000);
        channel.port1.onmessage = (event) => { clearTimeout(timeout); resolve(event.data); channel.port1.close(); };
        registration.active.postMessage('permission', [channel.port2]);
      });
    });
    assert.equal(workerState, 'granted', 'The trusted service worker must see the notification permission granted by its window.');
  });

  await t.test('Electron exposes PushManager but cannot create a Web Push subscription', async () => {
    const remote = application.windows().find((page) => page.url() === url);
    const key = createECDH('prime256v1');
    key.generateKeys();
    const result = await remote.evaluate(async publicKey => {
      const registration = await navigator.serviceWorker.ready;
      try {
        await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: new Uint8Array(publicKey) });
        return null;
      } catch (error) { return { name: error.name, message: error.message }; }
    }, [...key.getPublicKey()]);
    assert.equal(result?.name, 'AbortError');
    assert.match(result.message, /push service not available/i);
  });

  await t.test('saved server and HTTP-only session survive a full app restart', async () => {
    await closeApplication(application);
    application = undefined;
    application = await launch(userData);
    const remote = await application.firstWindow();
    await expect(remote).toHaveURL(url);
    await expect(remote.getByRole('status')).toHaveText('Oturum açık');
    await assertSandbox(remote);
    assert.equal(await remote.evaluate(() => Notification.permission), 'granted',
      'Notification consent must survive restart without requesting permission or a Web Push subscription.');
    const soundState = await remote.evaluate(async () => {
      const context = new AudioContext();
      await context.resume();
      const state = context.state;
      await context.close();
      return state;
    });
    assert.equal(soundState, 'running', 'Opted-in notification sounds must work before the first interaction after restart.');
  });
});

test('MOLA_SERVER_URL selects the server without exposing another server\'s session', { timeout: 60_000 }, async (t) => {
  const userData = await mkdtemp(path.join(tmpdir(), 'mola-desktop-env-smoke-'));
  const { server, url } = await fixtureServer();
  const other = await fixtureServer();
  let application;
  t.after(() => cleanup(application, userData, server, other.server));
  application = await launch(userData, url);
  const remote = await application.firstWindow();
  await expect(remote).toHaveURL(url);
  await expect(remote.getByRole('heading', { name: 'Mola test sunucusu' })).toBeVisible();
  await assertSandbox(remote);
  await remote.getByRole('button', { name: 'Oturum aç', exact: true }).click();
  await expect(remote.getByRole('status')).toHaveText('Oturum açık');
  await application.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
  await remote.getByRole('button', { name: 'Bildirim izni iste' }).click();
  await expect(remote.locator('#notification-result')).toHaveText('granted');
  await closeApplication(application);
  application = undefined;

  // Cookies alone ignore ports. Separate server partitions must prevent a leak.
  application = await launch(userData, other.url);
  const otherRemote = await application.firstWindow();
  await expect(otherRemote).toHaveURL(other.url);
  await expect(otherRemote.getByRole('status')).toHaveText('Oturum kapalı');
  assert.notEqual(await otherRemote.evaluate(() => Notification.permission), 'granted',
    'A saved notification grant must never cross server origins or ports.');
});

test('an unavailable server change returns to setup and a corrected address connects', { timeout: 60_000 }, async (t) => {
  const userData = await mkdtemp(path.join(tmpdir(), 'mola-desktop-recovery-smoke-'));
  const { server, url } = await fixtureServer();
  const unavailable = await fixtureServer(true);
  let application;
  t.after(() => cleanup(application, userData, server, unavailable.server));
  // Playwright attaches through the initial renderer. Replacing that renderer
  // during launch can strand its attachment on CI; attach first, then exercise
  // the real menu/IPC connect and recovery path against a failed connection.
  t.diagnostic('Recovery: attaching to the ready test application.');
  application = await launch(userData, url);
  const initial = await application.firstWindow();
  await expect(initial.getByRole('heading', { name: 'Mola test sunucusu' })).toBeVisible();
  await application.evaluate(({ Menu, dialog }) => {
    const original = dialog.showMessageBox;
    dialog.showMessageBox = (...args) => args.at(-1).message === 'Sunucuya yeniden bağlanılsın mı?'
      ? Promise.resolve({ response: 1, checkboxChecked: false }) : original.apply(dialog, args);
    Menu.getApplicationMenu().items[0].submenu.items.find(item => item.label === 'Sunucu adresini değiştir…').click();
  });
  await expect.poll(() => application.windows().find((page) => page.url() === 'mola-desktop://app/setup.html')).toBeTruthy();
  const setup = application.windows().find((page) => page.url() === 'mola-desktop://app/setup.html');
  t.diagnostic('Recovery: requesting the unavailable server through setup.');
  await setup.getByLabel('Sunucu adresi').fill(unavailable.url);
  await setup.getByRole('button', { name: 'Bağlan', exact: true }).click();
  await expect(setup.getByRole('alert')).toBeVisible();
  await expect(setup.getByRole('alert')).not.toHaveText('');
  t.diagnostic('Recovery: correcting the address and checking the loaded server.');
  await setup.getByLabel('Sunucu adresi').fill(url);
  await setup.getByRole('button', { name: 'Bağlan', exact: true }).click();
  await expect.poll(() => application.windows().find((page) => page.url() === url)).toBeTruthy();
  const remote = application.windows().find((page) => page.url() === url);
  await expect(remote.getByRole('heading', { name: 'Mola test sunucusu' })).toBeVisible();
});

test('cancelling the Linux screen picker rejects capture', { skip: process.platform !== 'linux', timeout: 30_000 }, async (t) => {
  const userData = await mkdtemp(path.join(tmpdir(), 'mola-desktop-picker-smoke-'));
  const { server, url } = await fixtureServer();
  let application;
  t.after(() => cleanup(application, userData, server));
  application = await launch(userData, url, false);
  const remote = await application.firstWindow();
  await expect(remote).toHaveURL(url);
  // Only replace OS enumeration: exercise the real request handler, local picker,
  // IPC cancellation, and rejected browser stream without accessing a real screen.
  await application.evaluate(({ desktopCapturer, dialog }) => {
    desktopCapturer.getSources = async () => [];
    const original = dialog.showMessageBox;
    globalThis.molaSmokeScreenPrompts = [];
    dialog.showMessageBox = (...args) => {
      const options = args.at(-1);
      if (options.title !== 'Mola izin isteği') return original.apply(dialog, args);
      globalThis.molaSmokeScreenPrompts.push(options.message);
      return Promise.resolve({ response: 1, checkboxChecked: false });
    };
  });
  for (let attempt = 1; attempt <= 2; attempt++) {
    await remote.getByRole('button', { name: 'Ekran paylaşımını dene' }).click();
    await expect.poll(() => application.windows().find((page) => page.url() === 'mola-desktop://app/screen.html')).toBeTruthy();
    const picker = application.windows().find((page) => page.url() === 'mola-desktop://app/screen.html');
    await expect(picker.getByRole('alert')).toBeVisible();
    await picker.getByRole('button', { name: 'Vazgeç', exact: true }).click();
    await expect(remote.locator('#display-result')).toHaveText(/^(AbortError|NotAllowedError)$/);
    await expect.poll(() => picker.isClosed()).toBe(true);
    const prompts = await application.evaluate(() => globalThis.molaSmokeScreenPrompts);
    assert.equal(prompts.length, attempt, 'Each screen request must receive a fresh permission decision.');
    assert.match(prompts.at(-1), /ekran paylaşımı/);
  }
});
