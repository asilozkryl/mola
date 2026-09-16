const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtemp, mkdir, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { _electron, expect } = require('@playwright/test');

// Exercise the packaged renderer. Only privileged network/download/install IPC
// is replaced; this fixture never contacts GitHub or touches an installed app.
test('updater renderer separates verified downloads from explicit platform installation', { timeout: 90_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mola-update-ui-'));
  const profile = join(directory, 'profile');
  await mkdir(profile);
  let application;
  t.after(async () => {
    if (application) {
      let timeout;
      try {
        await Promise.race([
          application.close(),
          new Promise((_, reject) => {
            timeout = setTimeout(() => {
              application.process()?.kill('SIGKILL');
              reject(new Error('The isolated updater UI test did not close.'));
            }, 5000);
          }),
        ]);
      } finally { clearTimeout(timeout); }
    }
    await rm(directory, { recursive: true, force: true });
  });
  await writeFile(join(directory, 'preload.cjs'), `
    const { contextBridge, ipcRenderer } = require('electron');
    contextBridge.exposeInMainWorld('molaDesktop', {
      getUpdateState: () => ipcRenderer.invoke('update', 'state'),
      checkUpdates: () => ipcRenderer.invoke('update', 'check'),
      downloadUpdate: () => ipcRenderer.invoke('update', 'download'),
      cancelUpdate: () => ipcRenderer.invoke('update', 'cancel'),
      installUpdate: () => ipcRenderer.invoke('update', 'install'),
      onUpdateState: callback => {
        const listener = (_event, state) => callback(state);
        ipcRenderer.on('update-state', listener);
        return () => { ipcRenderer.removeListener('update-state', listener); ipcRenderer.send('unsubscribed'); };
      },
    });
  `);
  await writeFile(join(directory, 'main.cjs'), `
    const { app, BrowserWindow, ipcMain } = require('electron');
    app.setPath('userData', ${JSON.stringify(profile)});
    globalThis.calls = [];
    globalThis.unsubscribed = 0;
    globalThis.state = {
      phase: 'idle', currentVersion: '1.0.5', latestVersion: null, format: 'dmg', installMode: 'relaunch',
      platform: 'darwin', progress: 0, transferred: 0, total: 0,
      releaseUrl: null, error: '', lastCheckedAt: null,
    };
    globalThis.setState = state => {
      globalThis.state = { ...globalThis.state, ...state };
      globalThis.window.webContents.send('update-state', globalThis.state);
    };
    ipcMain.on('unsubscribed', () => { globalThis.unsubscribed++; });
    ipcMain.handle('update', (_event, action) => {
      globalThis.calls.push(action);
      if (globalThis.failAction === action) throw new Error('İşlem tamamlanamadı. Yeniden deneyin.');
      if (action === 'check') globalThis.setState({ phase: 'available', latestVersion: '1.1.0', total: 100000000, error: '' });
      if (action === 'download') {
        globalThis.setState({ phase: 'downloading', progress: 0, transferred: 0 });
        if (globalThis.holdDownload) {
          const reply = { ...globalThis.state };
          return new Promise(resolve => { globalThis.finishDownload = () => resolve(reply); });
        }
      }
      if (action === 'cancel') globalThis.setState({ phase: 'available', progress: 0, transferred: 0 });
      if (action === 'install') globalThis.setState({ phase: 'installed' });
      return globalThis.state;
    });
    app.whenReady().then(() => {
      globalThis.window = new BrowserWindow({
        width: 620, height: 650,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: ${JSON.stringify(join(directory, 'preload.cjs'))} },
      });
      globalThis.window.setMenu(null);
      globalThis.window.loadFile(${JSON.stringify(resolve(__dirname, '../ui/updates.html'))});
    });
    app.on('window-all-closed', () => app.quit());
  `);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  application = await _electron.launch({
    executablePath: require('electron'), args: [join(directory, 'main.cjs')],
    chromiumSandbox: true, env, timeout: 30_000,
  });
  const page = await application.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(5000);

  await t.test('explicit checking and downloading never install or close the window', async () => {
    await expect(page.getByRole('heading', { name: 'Mola güncellemeleri', exact: true })).toBeVisible();
    await expect(page.locator('#current-version')).toHaveText('1.0.5');
    await page.getByRole('button', { name: 'Güncellemeleri kontrol et', exact: true }).click();
    await expect(page.locator('#latest-version')).toHaveText('1.1.0');
    await expect(page.getByRole('button', { name: /indir/i })).toBeVisible();
    await page.getByRole('button', { name: /indir/i }).click();
    await application.evaluate(() => globalThis.setState({ progress: 37, transferred: 37000000 }));
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '37');
    await expect(page.locator('#transfer-size')).toHaveText('37,0 MB / 100,0 MB');
    await expect(page.getByRole('button', { name: 'İndirmeyi iptal et', exact: true })).toBeVisible();
    assert.equal((await application.evaluate(() => globalThis.calls)).includes('install'), false);
    await page.getByRole('button', { name: 'İndirmeyi iptal et', exact: true }).click();
    await expect(page.getByRole('progressbar')).toBeHidden();
    await expect(page.getByRole('button', { name: /indir/i })).toBeVisible();
  });

  await t.test('installer actions are honest about each native package format', async () => {
    for (const [format, installMode, label, copy] of [
      ['dmg', 'relaunch', 'Güncelle ve yeniden aç', /macOS.*güvenlik onayı/],
      ['exe', 'installer', 'Kurulumu başlat', /kurulum/i],
      ['deb', 'installer', 'Kurulumu başlat', /paket/i],
      ['AppImage', 'relaunch', 'Güncelle ve yeniden aç', /yeniden aç/i],
    ]) {
      await application.evaluate((_electron, state) => globalThis.setState(state), { phase: 'ready', format, installMode, progress: 100 });
      await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
      await expect(page.locator('#installation-help')).toContainText(copy);
    }
    await application.evaluate(() => globalThis.setState({ phase: 'ready', format: 'dmg', installMode: 'relaunch' }));
    await page.getByRole('button', { name: 'Güncelle ve yeniden aç', exact: true }).click();
    await expect(page.locator('#state-title')).toHaveText('Mola yeniden açılmak üzere');
    await expect(page.locator('#state-description')).toContainText('Mola kapandıktan sonra');
    await expect(page.locator('body')).not.toContainText(/Mola güncellendi|Güncelleme uygulandı|sürükle|DMG açıldı/);
  });

  await t.test('package format alone cannot promise an automatic restart', async () => {
    await application.evaluate(() => globalThis.setState({ phase: 'ready', format: 'dmg', installMode: 'installer' }));
    await expect(page.getByRole('button', { name: 'Kurulumu başlat', exact: true })).toBeVisible();
    await expect(page.locator('#installation-help')).not.toContainText('otomatik');
    await application.evaluate(() => globalThis.setState({ installMode: 'unknown' }));
    await expect(page.locator('#install-update')).toBeDisabled();
  });

  await t.test('a pending download can be cancelled without a late reply restoring stale progress', async () => {
    await application.evaluate(() => {
      globalThis.holdDownload = true;
      globalThis.setState({ phase: 'available', format: 'dmg', installMode: 'relaunch', error: '' });
    });
    await page.getByRole('button', { name: /indir/i }).click();
    await expect(page.getByRole('progressbar')).toBeVisible();
    await page.getByRole('button', { name: 'İndirmeyi iptal et', exact: true }).click();
    await application.evaluate(() => { globalThis.finishDownload(); globalThis.holdDownload = false; });
    await expect(page.getByRole('button', { name: /indir/i })).toBeEnabled();
    await expect(page.getByRole('progressbar')).toBeHidden();
    await expect(page.getByRole('alert')).toBeHidden();
  });

  await t.test('errors remain actionable, callback text is not HTML, and narrow layouts fit', async () => {
    await application.evaluate(() => globalThis.setState({ phase: 'error', error: '<img src=x onerror=alert(1)> İndirme başarısız.', canDownload: true, canInstall: false }));
    await expect(page.getByRole('alert')).toContainText('<img src=x onerror=alert(1)>');
    assert.equal(await page.locator('img').count(), 0);
    await expect(page.getByRole('button', { name: /indir/i })).toBeVisible();
    await application.evaluate(() => { globalThis.failAction = 'download'; });
    await page.getByRole('button', { name: /indir/i }).click();
    await expect(page.getByRole('alert')).toContainText('İşlem tamamlanamadı');
    await expect(page.getByRole('alert')).not.toContainText('remote method');
    await expect(page.getByRole('button', { name: /indir/i })).toBeEnabled();
    await application.evaluate(() => { globalThis.failAction = undefined; globalThis.window.setSize(420, 520); });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: join(tmpdir(), 'mola-updates-420-error.png') });
    await application.evaluate(() => globalThis.window.setSize(620, 650));
    await application.evaluate(() => globalThis.setState({ phase: 'available', error: '', canDownload: true, format: 'dmg' }));
    await page.screenshot({ path: join(tmpdir(), 'mola-updates-620-available.png') });
    assert.deepEqual(errors, []);
  });

  await t.test('closing the local window releases the update subscription', async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await expect.poll(() => application.evaluate(() => globalThis.unsubscribed)).toBe(1);
    const closed = page.waitForEvent('close', { timeout: 5000 });
    await Promise.all([
      closed,
      page.getByRole('button', { name: 'Sonra', exact: true }).click().catch(error => {
        // Electron can close its last window before Playwright receives the
        // click acknowledgement. Only that already-observed close is expected.
        if (!page.isClosed() || !/^locator\.click: Target page, context or browser has been closed(?:\n|$)/.test(error.message)) throw error;
      }),
    ]);
    assert.equal(page.isClosed(), true);
  });
});
