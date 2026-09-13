const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, session, shell, desktopCapturer, systemPreferences } = require('electron');
const { join, basename, resolve } = require('node:path');
const { readFile } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { normalizeServerUrl, isTrustedUrl, isTrustedDownloadUrl, popupAction, permissionKinds, isDisplayCapturePermission } = require('./policy.cjs');
const { readSettings, saveSettings } = require('./settings.cjs');

app.setName('Mola');
if (app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', resolve(app.commandLine.getSwitchValue('user-data-dir')));
}
protocol.registerSchemesAsPrivileged([{
  scheme: 'mola-desktop', privileges: { standard: true, secure: true, supportFetchAPI: true },
}]);

const localOrigin = 'mola-desktop://app';
const settingsFile = join(app.getPath('userData'), 'desktop-settings.json');
const icon = join(__dirname, 'assets', 'icon.png');
const remotePreferences = {
  nodeIntegration: false, contextIsolation: true, sandbox: true,
  webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
};
let mainWindow = null;
let setupWindow = null;
let serverUrl = '';
let setupError = '';
let connecting = false;
let quitting = false;
let picker = null;
const configuredSessions = new WeakSet();

function localWindow(page, options = {}) {
  const window = new BrowserWindow({
    width: 540, height: 650, minWidth: 420, minHeight: 520,
    title: 'Mola', backgroundColor: '#153d36', icon,
    ...options,
    webPreferences: { ...remotePreferences, preload: join(__dirname, 'ui', 'preload.cjs') },
  });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-redirect', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  void window.loadURL(`${localOrigin}/${page}`).catch(() => {
    dialog.showErrorBox('Mola açılamadı', 'Uygulama dosyaları okunamadı. Mola’yı yeniden kurun.');
  });
  return window;
}

function showSetup(error = '') {
  setupError = error;
  if (setupWindow && !setupWindow.isDestroyed()) {
    void setupWindow.webContents.reload();
    setupWindow.show();
    setupWindow.focus();
    return;
  }
  setupWindow = localWindow('setup.html');
  setupWindow.on('closed', () => { setupWindow = null; });
}

function validateLocalSender(event, window, page) {
  if (!window || window.isDestroyed() || event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== `${localOrigin}/${page}`) {
    throw new Error('Bu işlem yalnızca Mola’nın yerel penceresinden yapılabilir.');
  }
}

function trustedMain(contents, origin) {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && contents === mainWindow.webContents &&
    isTrustedUrl(contents.getURL(), origin));
}

async function openExternal(url) {
  if (popupAction(url, serverUrl) !== 'external') return;
  try { await shell.openExternal(url); }
  catch { if (mainWindow) void dialog.showMessageBox(mainWindow, { type: 'error', message: 'Bağlantı tarayıcıda açılamadı.' }); }
}

function guardRemoteWindow(window, origin, callPopup = false) {
  const contents = window.webContents;
  contents.on('will-attach-webview', event => event.preventDefault());
  const navigation = event => {
    const url = event.url;
    if (!callPopup && isTrustedUrl(url, origin)) return;
    event.preventDefault();
    // Redirects never launch applications. Only explicit navigations open a browser.
    if (!callPopup) void openExternal(url);
  };
  contents.on('will-navigate', navigation);
  contents.on('will-redirect', event => {
    if (callPopup || !isTrustedUrl(event.url, origin)) event.preventDefault();
  });
  contents.on('will-frame-navigate', event => {
    if (!event.isMainFrame || (callPopup && event.url !== 'about:blank')) event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (callPopup || !trustedMain(contents, origin)) return { action: 'deny' };
    const action = popupAction(url, origin);
    if (action === 'call') {
      return { action: 'allow', overrideBrowserWindowOptions: {
        width: 880, height: 540, title: 'Mola görüşmesi', autoHideMenuBar: true,
        webPreferences: { ...remotePreferences, session: contents.session, preload: undefined },
      } };
    }
    if (action === 'download') contents.downloadURL(url);
    if (action === 'navigate') void window.loadURL(url).catch(() => showSetup('Bağlantı açılamadı. Sunucunuza yeniden bağlanın.'));
    if (action === 'external') void openExternal(url);
    return { action: 'deny' };
  });
  contents.on('did-create-window', child => {
    child.setMenu(null);
    guardRemoteWindow(child, origin, true);
    window.once('closed', () => { if (!child.isDestroyed()) child.destroy(); });
  });
}

function configureSession(ses, origin) {
  if (configuredSessions.has(ses)) return;
  configuredSessions.add(ses);
  // Decisions last for this process. Restarting lets a previously denied device prompt again.
  const grants = new Map();
  const passivePermissions = new Set(['fullscreen', 'clipboard-sanitized-write']);
  let permissionPending = false;
  ses.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
    // Service workers have no WebContents. They may observe an existing grant
    // for the active server, but cannot create a grant or inherit another origin's.
    if (contents === null && permission === 'notifications') {
      return serverUrl === origin && isTrustedUrl(requestingOrigin, origin) &&
        (!details.requestingUrl || isTrustedUrl(details.requestingUrl, origin)) && grants.get('notifications') === true;
    }
    if (!trustedMain(contents, origin) || !isTrustedUrl(requestingOrigin, origin) ||
        details.isMainFrame === false || (details.requestingUrl && !isTrustedUrl(details.requestingUrl, origin))) return false;
    if (passivePermissions.has(permission)) return true;
    if (permission === 'display-capture') return false;
    if (permission === 'media') {
      const kind = details.mediaType === 'audio' ? 'microphone' : details.mediaType === 'video' ? 'camera' : null;
      return Boolean(kind && grants.get(kind));
    }
    return grants.get(permission) === true;
  });
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (!trustedMain(contents, origin) || details.isMainFrame === false ||
        !isTrustedUrl(details.requestingUrl, origin)) return callback(false);
    if (passivePermissions.has(permission)) return callback(true);
    // Display access is confirmed each time, including legacy chromeMediaSource
    // requests which do not pass through the getDisplayMedia source picker.
    const kinds = isDisplayCapturePermission(permission, details) ? ['screen'] : permissionKinds(permission, details);
    if (!kinds || kinds.some(kind => grants.get(kind) === false)) return callback(false);
    if (kinds.every(kind => grants.get(kind) === true)) return callback(true);
    if (permissionPending) return callback(false);
    permissionPending = true;
    const labels = { microphone: 'mikrofon', camera: 'kamera', screen: 'ekran paylaşımı', notifications: 'bildirim', 'speaker-selection': 'ses çıkış aygıtı' };
    const owner = mainWindow;
    void (async () => {
      try {
        const result = await dialog.showMessageBox(owner, {
          type: 'question', title: 'Mola izin isteği',
          message: `${kinds.map(kind => labels[kind]).join(' ve ')} erişimine izin verilsin mi?`,
          detail: origin, buttons: ['İzin verme', 'İzin ver'], defaultId: 0, cancelId: 0, noLink: true,
        });
        let allowed = result.response === 1 && trustedMain(contents, origin);
        if (allowed && process.platform === 'darwin') {
          for (const kind of kinds) {
            if (kind === 'microphone' || kind === 'camera') {
              allowed = await systemPreferences.askForMediaAccess(kind) && allowed;
            }
          }
        }
        for (const kind of kinds) if (kind !== 'screen') grants.set(kind, allowed);
        callback(allowed);
      } catch { callback(false); }
      finally { permissionPending = false; }
    })();
  });
  ses.setDisplayMediaRequestHandler((request, callback) => {
    if (!mainWindow || mainWindow.isDestroyed() || request.frame !== mainWindow.webContents.mainFrame ||
        !isTrustedUrl(request.securityOrigin, origin) || !request.userGesture || !request.videoRequested || request.audioRequested) {
      return callback({});
    }
    void chooseScreen(request, origin).then(source => callback(source ? { video: source } : {})).catch(() => callback({}));
  }, { useSystemPicker: true });
  ses.on('will-download', (event, item, contents) => {
    if (!trustedMain(contents, origin) || !item.getURLChain().every(url => isTrustedDownloadUrl(url, origin))) {
      event.preventDefault();
      return;
    }
    item.setSaveDialogOptions({
      title: 'Dosyayı kaydet', defaultPath: join(app.getPath('downloads'), basename(item.getFilename().replaceAll('\\', '/'))),
    });
    item.once('done', (_event, state) => {
      if (state === 'interrupted' && mainWindow && !mainWindow.isDestroyed()) {
        void dialog.showMessageBox(mainWindow, { type: 'error', message: 'Dosya indirilemedi. Bağlantınızı kontrol edip tekrar deneyin.' });
      }
    });
  });
}

async function chooseScreen(request, origin) {
  if (picker) return null;
  const owner = mainWindow;
  // Reserve the request before enumerating, so rapid calls cannot open multiple pickers.
  const pending = { window: null, sources: [], error: '', finish: (_id) => {} };
  picker = pending;
  try {
    pending.sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
  } catch { pending.error = 'Ekranlar alınamadı. Sistem ayarlarında Mola için ekran kaydı iznini kontrol edin.'; }
  if (picker !== pending || !owner || owner.isDestroyed() || request.frame !== owner.webContents.mainFrame ||
      !isTrustedUrl(owner.webContents.getURL(), origin)) { picker = null; return null; }
  return new Promise(resolveChoice => {
    const window = localWindow('screen.html', { width: 780, height: 610, parent: owner, modal: true, minWidth: 520 });
    pending.window = window;
    let finished = false;
    const cancel = () => pending.finish(null);
    pending.finish = id => {
      if (finished) return;
      finished = true;
      owner.webContents.removeListener('did-start-navigation', cancel);
      owner.removeListener('closed', cancel);
      const stillTrusted = !owner.isDestroyed() && request.frame === owner.webContents.mainFrame && isTrustedUrl(owner.webContents.getURL(), origin);
      const selected = stillTrusted ? pending.sources.find(source => source.id === id) : null;
      if (picker === pending) picker = null;
      resolveChoice(selected || null);
      if (!window.isDestroyed()) window.close();
    };
    window.on('closed', cancel);
    owner.once('closed', cancel);
    owner.webContents.once('did-start-navigation', cancel);
  });
}

async function connect(value) {
  const origin = normalizeServerUrl(value);
  const partition = `persist:mola-${createHash('sha256').update(origin).digest('hex').slice(0, 24)}`;
  const ses = session.fromPartition(partition);
  configureSession(ses, origin);
  const previous = mainWindow;
  const window = new BrowserWindow({
    width: 1380, height: 900, minWidth: 800, minHeight: 600,
    title: 'Mola', backgroundColor: '#153d36', icon, show: false,
    webPreferences: { ...remotePreferences, session: ses },
  });
  mainWindow = window;
  serverUrl = origin;
  guardRemoteWindow(window, origin);
  window.on('closed', () => { if (mainWindow === window) mainWindow = null; });
  window.webContents.on('render-process-gone', () => {
    if (!quitting && mainWindow === window) showSetup('Mola penceresi beklenmedik şekilde kapandı. Yeniden bağlanabilirsiniz.');
  });
  if (previous && !previous.isDestroyed()) previous.destroy();
  let timeout;
  try {
    await Promise.race([
      window.loadURL(origin),
      new Promise((_, reject) => { timeout = setTimeout(() => {
        if (!window.isDestroyed()) window.webContents.stop();
        reject(new Error('Bağlantı zaman aşımına uğradı.'));
      }, 20_000); }),
    ]);
    if (window.isDestroyed() || mainWindow !== window) return;
    window.show();
    window.focus();
    if (setupWindow && !setupWindow.isDestroyed()) setupWindow.close();
  } catch {
    if (!quitting && mainWindow === window) {
      showSetup('Sunucuya bağlanılamadı. Adresi ve internet bağlantınızı kontrol edip yeniden deneyin.');
      window.destroy();
    }
    throw new Error('Sunucuya bağlanılamadı. Adresi ve internet bağlantınızı kontrol edip yeniden deneyin.');
  } finally { clearTimeout(timeout); }
}

function installMenu() {
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const macItems = process.platform === 'darwin' ? [{ role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }] : [];
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Mola', submenu: [
      { label: 'Mola hakkında', click: () => dialog.showMessageBox({ type: 'info', title: 'Mola', message: `Mola ${app.getVersion()}`, detail: 'Birlikte, aynı yerde.\nLinux, macOS ve Windows masaüstü istemcisi.' }) },
      { label: 'Sunucu adresini değiştir…', accelerator: 'CmdOrCtrl+,', click: () => showSetup() },
      { type: 'separator' },
      ...macItems,
      { label: 'Çıkış', role: 'quit', accelerator: 'CmdOrCtrl+Q' },
    ] },
    { label: 'Düzenle', submenu: [{ role: 'undo', label: 'Geri al' }, { role: 'redo', label: 'Yinele' }, { type: 'separator' },
      { role: 'cut', label: 'Kes' }, { role: 'copy', label: 'Kopyala' }, { role: 'paste', label: 'Yapıştır' }, { role: 'selectAll', label: 'Tümünü seç' }] },
    { label: 'Görünüm', submenu: [{ role: 'reload', label: 'Yenile' }, { role: 'resetZoom', label: 'Gerçek boyut' },
      { role: 'zoomIn', label: 'Yakınlaştır' }, { role: 'zoomOut', label: 'Uzaklaştır' }, { role: 'togglefullscreen', label: 'Tam ekran' }] },
    { label: 'Pencere', submenu: [{ role: 'minimize', label: 'Küçült' }, { role: 'close', label: 'Kapat' }] },
  ]));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const window = setupWindow || mainWindow;
    if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
  });
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (serverUrl) void connect(serverUrl).catch(() => {});
      else showSetup();
    }
  });
  void app.whenReady().then(async () => {
    app.setAppUserModelId('app.mola.desktop');
    const localFiles = { 'setup.html': 'text/html', 'screen.html': 'text/html', 'setup.js': 'text/javascript', 'screen.js': 'text/javascript', 'styles.css': 'text/css' };
    protocol.handle('mola-desktop', async request => {
      const url = new URL(request.url);
      const name = url.pathname.slice(1);
      if (url.hostname !== 'app' || !Object.hasOwn(localFiles, name) || request.method !== 'GET') return new Response(null, { status: 404 });
      try { return new Response(await readFile(join(__dirname, 'ui', name)), { headers: { 'Content-Type': `${localFiles[name]}; charset=utf-8` } }); }
      catch { return new Response(null, { status: 404 }); }
    });
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    ipcMain.handle('desktop:state', event => {
      validateLocalSender(event, setupWindow, 'setup.html');
      return { serverUrl, error: setupError };
    });
    ipcMain.handle('desktop:connect', async (event, value) => {
      validateLocalSender(event, setupWindow, 'setup.html');
      if (connecting) return { ok: false, error: 'Bağlantı kuruluyor. Lütfen bekleyin.' };
      connecting = true;
      try {
        const origin = normalizeServerUrl(value);
        if (mainWindow && !mainWindow.isDestroyed()) {
          const answer = await dialog.showMessageBox(setupWindow, {
            type: 'question', message: 'Sunucuya yeniden bağlanılsın mı?',
            detail: 'Açık görüşmeniz kapanır. Gönderilmemiş mesajınızı kontrol edin.',
            buttons: ['Vazgeç', 'Bağlan'], defaultId: 0, cancelId: 0, noLink: true,
          });
          if (answer.response !== 1) return { ok: false, error: 'Sunucu bağlantısı değiştirilmedi.' };
        }
        await saveSettings(settingsFile, origin);
        await connect(origin);
        return { ok: true };
      } catch (error) { return { ok: false, error: error.message }; }
      finally { connecting = false; }
    });
    ipcMain.handle('desktop:sources', event => {
      validateLocalSender(event, picker?.window, 'screen.html');
      return { sources: picker.sources.map(source => ({ id: source.id, name: source.name, thumbnail: source.thumbnail.toDataURL() })), error: picker.error };
    });
    ipcMain.handle('desktop:select-source', (event, id) => {
      validateLocalSender(event, picker?.window, 'screen.html');
      if (id !== null && (typeof id !== 'string' || !picker.sources.some(source => source.id === id))) throw new Error('Geçersiz ekran seçimi.');
      picker.finish(id);
    });
    installMenu();
    try {
      serverUrl = process.env.MOLA_SERVER_URL !== undefined ? normalizeServerUrl(process.env.MOLA_SERVER_URL) : await readSettings(settingsFile) || '';
      if (serverUrl) await connect(serverUrl);
      else showSetup();
    } catch (error) { showSetup(error.message); }
  }).catch(error => {
    dialog.showErrorBox('Mola başlatılamadı', error.message);
    app.quit();
  });
}
