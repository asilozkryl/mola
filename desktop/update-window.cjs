// The remote workspace can open this window, but only this packaged main frame
// may request a check, download, or an explicitly confirmed installation.
function createUpdateWindowController(options) {
  const { app, ipcMain, Menu, Notification, dialog, localWindow, validateLocalSender, cacheDir,
    platform = process.platform, arch = process.arch, packageType,
    createManager = require('./updater.cjs').createUpdateManager,
    launchInstaller = require('./update-installers.cjs').launchUpdateInstaller,
    setTimeout: schedule = setTimeout, setInterval: repeat = setInterval,
    clearTimeout: unschedule = clearTimeout, clearInterval: unrepeat = clearInterval } = options;
  let window = null;
  let confirming = false;
  let disposed = false;
  let lastOfferedVersion = '';
  let notice = null;
  const manager = createManager({
    currentVersion: app.getVersion(), platform, arch,
    packageType: app.isPackaged ? packageType : null, cacheDir,
    onChange: state => {
      if (disposed) return;
      if (window && !window.isDestroyed()) window.webContents.send('desktop:updates:state', state);
      const menu = Menu.getApplicationMenu()?.getMenuItemById('mola-updates');
      if (menu) menu.label = state.latestVersion && ['available', 'downloading', 'ready'].includes(state.phase)
        ? `Mola ${state.latestVersion} güncellemesi…` : 'Güncellemeleri kontrol et…';
    },
    install: (filePath, release) => launchInstaller(filePath, release, {
      platform, arch, currentVersion: app.getVersion(),
      resourcesPath: process.resourcesPath, execPath: process.execPath, openPath: options.openPath,
      relaunch: imagePath => app.relaunch({ execPath: imagePath, args: [] }),
      quit: () => app.quit(),
    }),
  });

  function show() {
    if (disposed) return;
    if (!window || window.isDestroyed()) {
      window = localWindow('updates.html', {
        width: 620, height: 680, minWidth: 420, minHeight: 520,
        title: 'Mola güncellemeleri', backgroundColor: '#242329',
      });
      const owner = window;
      window.on('closed', () => { if (window === owner) window = null; });
    }
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    if (['idle', 'current', 'error'].includes(manager.getState().phase)) void manager.check();
  }

  for (const [action, perform] of Object.entries({
    state: () => manager.getState(), check: () => manager.check(),
    download: () => manager.download(), cancel: () => manager.cancel(),
  })) {
    ipcMain.handle(`desktop:updates:${action}`, event => {
      validateLocalSender(event, window, 'updates.html');
      return perform();
    });
  }
  ipcMain.handle('desktop:updates:install', async event => {
    validateLocalSender(event, window, 'updates.html');
    if (confirming || !manager.getState().canInstall) return manager.getState();
    confirming = true;
    const owner = window;
    try {
      const { format, installMode } = manager.getState();
      const restarts = installMode === 'relaunch';
      const answer = await dialog.showMessageBox(owner, {
        type: 'question', title: 'Mola güncellemesi',
        message: restarts ? 'Mola güncellenip yeniden açılsın mı?' : 'Kurulum açılsın ve Mola kapatılsın mı?',
        detail: 'Açık görüşmeniz kapanır. Gönderilmemiş mesajınızı kontrol edin.' +
          (restarts && format === 'dmg' ? '\nMola kapandıktan sonra uygulama güncellenir ve yeniden açılır. macOS güvenlik onayı isteyebilir.' : ''),
        buttons: ['Vazgeç', restarts ? 'Güncelle ve yeniden aç' : 'Kurulumu başlat'],
        defaultId: 0, cancelId: 0, noLink: true,
      });
      if (answer.response !== 1 || disposed || owner !== window || owner.isDestroyed()) return manager.getState();
      validateLocalSender(event, owner, 'updates.html');
      return await manager.install();
    } finally { confirming = false; }
  });

  async function checkInBackground() {
    if (disposed || confirming) return;
    if (['checking', 'downloading', 'ready', 'installing', 'installed'].includes(manager.getState().phase)) return;
    const state = await manager.check();
    if (disposed || state.phase !== 'available' || state.latestVersion === lastOfferedVersion) return;
    lastOfferedVersion = state.latestVersion;
    // A silent system notification does not steal focus or interrupt a call.
    // The menu remains an entry point if system notifications are unavailable.
    if (!Notification.isSupported()) return;
    try {
      notice?.close();
      notice = new Notification({ title: `Mola ${state.latestVersion} hazır`,
        body: 'Güncellemeyi uygulamadan indirebilirsin. Kurulum sen başlattığında yapılır.', silent: true });
      notice.on('click', show);
      notice.on('failed', () => {});
      notice.show();
    } catch { /* The menu continues to show the available version. */ }
  }
  const firstCheck = app.isPackaged ? schedule(checkInBackground, 60_000) : null;
  const periodicCheck = app.isPackaged ? repeat(checkInBackground, 6 * 60 * 60_000) : null;
  firstCheck?.unref?.();
  periodicCheck?.unref?.();
  return {
    show,
    dispose() {
      disposed = true;
      if (firstCheck) unschedule(firstCheck);
      if (periodicCheck) unrepeat(periodicCheck);
      notice?.close();
      manager.cancel();
    },
  };
}

module.exports = { createUpdateWindowController };
