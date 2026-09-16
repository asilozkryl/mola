const assert = require('node:assert/strict');
const { test } = require('node:test');
const { once } = require('node:events');
const { createServer } = require('node:http');
const { createHash } = require('node:crypto');
const { mkdtemp, mkdir, realpath, writeFile, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { _electron, expect } = require('@playwright/test');

test('real desktop updater verifies its native download and preserves calls until confirmed installer handoff', {
  timeout: 90_000, skip: process.platform !== 'linux' || process.arch !== 'x64',
}, async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'mola-update-integration-')));
  const profile = join(directory, 'profile');
  await mkdir(profile);
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Referrer-Policy': 'no-referrer' });
    response.end(`<!doctype html><html lang="tr"><title>Mola test çalışma alanı</title>
      <h1>Mola test çalışma alanı</h1><button id="call">Görüşmeyi aç</button><button id="updates">Güncellemeleri aç</button>
      <script>
        document.querySelector('#call').onclick = () => {
          const child = window.open('about:blank', '', 'popup,width=600,height=400');
          child.document.title = 'Mola test görüşmesi'; child.document.body.textContent = 'Görüşme devam ediyor';
        };
        document.querySelector('#updates').onclick = () => window.open('mola-desktop://app/updates', '_blank');
      </script></html>`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  let application;
  t.after(async () => {
    try {
      if (application) {
        await application.evaluate(({ app }) => { app.quit = globalThis.realQuit; });
        let timeout;
        try {
          await Promise.race([
            application.close(),
            new Promise((_, reject) => {
              timeout = setTimeout(() => {
                application.process()?.kill('SIGKILL');
                reject(new Error('The isolated updater integration did not close within five seconds.'));
              }, 5000);
            }),
          ]);
        } finally { clearTimeout(timeout); }
      }
    } finally {
      server.closeAllConnections();
      await new Promise(done => server.close(done));
      await rm(directory, { recursive: true, force: true });
    }
  });

  const version = '1.0.7';
  const names = [`Mola-${version}-linux-amd64.deb`, `Mola-${version}-linux-x86_64.AppImage`, `Mola-${version}-win-x64.exe`,
    `Mola-${version}-mac-x64.dmg`, `Mola-${version}-mac-x64.zip`, `Mola-${version}-mac-arm64.dmg`, `Mola-${version}-mac-arm64.zip`];
  const files = Object.fromEntries(names.map(name => [name, `Isolated non-executable installer fixture: ${name}`]));
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  files.SHA256SUMS = names.map(name => `${hash(files[name])}  ${name}\n`).join('');
  const root = `https://github.com/asilozkryl/mola/releases`;
  const release = { tag_name: `desktop-v${version}`, draft: false, prerelease: false, html_url: `${root}/tag/desktop-v${version}`,
    assets: Object.entries(files).map(([name, body]) => ({ name, state: 'uploaded', size: Buffer.byteLength(body),
      digest: `sha256:${hash(body)}`, browser_download_url: `${root}/download/desktop-v${version}/${name}` })) };
  const launcher = join(directory, 'launcher.cjs');
  await writeFile(launcher, `
    const electron = require('electron');
    const { createHash } = require('node:crypto');
    const { readFile } = require('node:fs/promises');
    Object.defineProperty(electron.app, 'isPackaged', { value: true });
    electron.app.getVersion = () => '1.0.5';
    globalThis.realQuit = electron.app.quit.bind(electron.app);
    globalThis.quitRequests = 0; electron.app.quit = () => { globalThis.quitRequests++; };
    globalThis.opens = []; globalThis.fetches = []; globalThis.prompts = [];
    const decisions = [0, 1, 1];
    const realDialog = electron.dialog.showMessageBox.bind(electron.dialog);
    electron.dialog.showMessageBox = (...args) => {
      const options = args.at(-1);
      if (options.title !== 'Mola güncellemesi') return realDialog(...args);
      globalThis.prompts.push(options);
      return Promise.resolve({ response: decisions.shift() ?? 0 });
    };
    electron.shell.openPath = async path => {
      const bytes = await readFile(path);
      globalThis.opens.push({ path, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length });
      return '';
    };
    const release = ${JSON.stringify(release)}; const files = ${JSON.stringify(files)};
    let firstDownload = true;
    globalThis.fetch = async url => {
      globalThis.fetches.push(url);
      if (url === 'https://api.github.com/repos/asilozkryl/mola/releases?per_page=100') return Response.json([release]);
      const asset = release.assets.find(asset => asset.browser_download_url === url);
      if (!asset) throw new Error('Unexpected fixture URL');
      const bytes = Buffer.from(files[asset.name]);
      if (asset.name.endsWith('.deb') && firstDownload) {
        firstDownload = false;
        return new Response(new ReadableStream({ start(controller) {
          controller.enqueue(bytes.subarray(0, 10));
          globalThis.finishDownload = () => { controller.enqueue(bytes.subarray(10)); controller.close(); };
        } }));
      }
      return new Response(bytes);
    };
    require(${JSON.stringify(resolve(__dirname, '../main.cjs'))});
  `);
  const env = { ...process.env, MOLA_SERVER_URL: origin };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.APPIMAGE;
  application = await _electron.launch({ executablePath: require('electron'), args: [launcher, `--user-data-dir=${profile}`],
    chromiumSandbox: true, env, timeout: 30_000 });
  const remote = await application.firstWindow();
  const errors = [];
  remote.on('pageerror', error => errors.push(error.message));
  await expect(remote.getByRole('heading', { name: 'Mola test çalışma alanı' })).toBeVisible();
  assert.equal(await remote.evaluate(() => typeof window.molaDesktop), 'undefined');
  const popupEvent = remote.waitForEvent('popup');
  await remote.getByRole('button', { name: 'Görüşmeyi aç', exact: true }).click();
  const call = await popupEvent;
  await expect(call.locator('body')).toHaveText('Görüşme devam ediyor');
  await remote.getByRole('button', { name: 'Güncellemeleri aç', exact: true }).click();
  await expect.poll(() => application.windows().some(page => page.url() === 'mola-desktop://app/updates.html')).toBe(true);
  const updates = application.windows().find(page => page.url() === 'mola-desktop://app/updates.html');
  updates.on('pageerror', error => errors.push(error.message));
  await expect(updates.locator('#latest-version')).toHaveText('1.0.7');
  await updates.getByRole('button', { name: 'Güncellemeyi indir', exact: true }).click();
  await expect.poll(async () => Number(await updates.getByRole('progressbar').getAttribute('aria-valuenow'))).toBeGreaterThan(0);
  await expect(call.locator('body')).toHaveText('Görüşme devam ediyor');
  assert.equal(await application.evaluate(() => globalThis.quitRequests), 0);
  await application.evaluate(() => globalThis.finishDownload());
  await expect(updates.getByRole('button', { name: 'Kurulumu başlat', exact: true })).toBeEnabled();
  const cached = join(profile, 'updates', names[0]);
  assert.equal(hash(await readFile(cached)), hash(files[names[0]]));

  await updates.getByRole('button', { name: 'Kurulumu başlat', exact: true }).click();
  await expect(updates.getByRole('button', { name: 'Kurulumu başlat', exact: true })).toBeEnabled();
  assert.equal(await application.evaluate(() => globalThis.prompts.length), 1);
  assert.deepEqual(await application.evaluate(() => [globalThis.opens.length, globalThis.quitRequests]), [0, 0]);
  await expect(call.locator('body')).toHaveText('Görüşme devam ediyor');
  assert.equal(remote.url(), `${origin}/`);

  await writeFile(cached, 'tampered after download');
  await updates.getByRole('button', { name: 'Kurulumu başlat', exact: true }).click();
  await expect(updates.getByRole('alert')).toBeVisible();
  assert.deepEqual(await application.evaluate(() => [globalThis.opens.length, globalThis.quitRequests]), [0, 0]);
  await expect(call.locator('body')).toHaveText('Görüşme devam ediyor');
  await updates.getByRole('button', { name: 'Güncellemeyi indir', exact: true }).click();
  await expect(updates.getByRole('button', { name: 'Kurulumu başlat', exact: true })).toBeEnabled();
  await updates.getByRole('button', { name: 'Kurulumu başlat', exact: true }).click();
  await expect(updates.locator('#state-title')).toHaveText('Kurulum açıldı');
  assert.deepEqual(await application.evaluate(() => globalThis.opens), [{ path: cached, sha256: hash(files[names[0]]), size: Buffer.byteLength(files[names[0]]) }]);
  assert.equal(await application.evaluate(() => globalThis.quitRequests), 1);
  const observed = await application.evaluate(() => ({ prompts: globalThis.prompts, fetches: globalThis.fetches }));
  assert.equal(observed.prompts.length, 3);
  assert.ok(observed.prompts.every(prompt => prompt.defaultId === 0 && prompt.cancelId === 0 && /görüşmeniz kapanır/.test(prompt.detail)));
  assert.equal(observed.fetches.filter(url => url.endsWith('.deb')).length, 2);
  assert.equal(observed.fetches.filter(url => /\.(dmg|exe|AppImage|zip)$/.test(url)).length, 0);
  assert.deepEqual(errors, []);
});
