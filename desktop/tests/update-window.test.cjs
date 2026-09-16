const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');

function fixture({ packaged = true, answer = 0 } = {}) {
  const handlers = new Map();
  const windows = [];
  const notifications = [];
  const timers = [];
  const calls = { check: 0, download: 0, install: 0, cancel: 0, prompts: 0 };
  let state = { phase: 'ready', currentVersion: '1.0.6', latestVersion: '1.0.7', format: 'dmg', canInstall: true };
  let publish;
  const menuItem = { label: '' };
  const dependencies = {
    app: { isPackaged: packaged, getVersion: () => '1.0.6' },
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    Menu: { getApplicationMenu: () => ({ getMenuItemById: () => menuItem }) },
    Notification: class {
      static isSupported() { return true; }
      constructor(options) { this.options = options; this.events = {}; notifications.push(this); }
      on(name, callback) { this.events[name] = callback; }
      show() { this.shown = true; }
      close() {}
    },
    dialog: { showMessageBox: async () => { calls.prompts++; return { response: answer }; } },
    localWindow(page) {
      const window = new EventEmitter();
      Object.assign(window, { destroyed: false, isDestroyed: () => window.destroyed, show() {}, focus() {}, isMinimized: () => false,
        webContents: { mainFrame: { url: `mola-desktop://app/${page}` }, send() {} } });
      windows.push(window);
      return window;
    },
    validateLocalSender(event, window, page) {
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== `mola-desktop://app/${page}`) throw new Error('Untrusted sender');
    },
    cacheDir: '/unused-mola-test-cache', platform: 'darwin', arch: 'arm64', packageType: 'dmg',
    launchInstaller: async () => { throw new Error('No actual installer may run in controller tests'); },
    setTimeout: callback => { timers.push(callback); return { unref() {} }; },
    setInterval: callback => { timers.push(callback); return { unref() {} }; },
    clearTimeout() {}, clearInterval() {},
    createManager(options) {
      publish = options.onChange;
      return {
        getState: () => state,
        async check() { calls.check++; return state; },
        async download() { calls.download++; return state; },
        cancel() { calls.cancel++; return state; },
        async install() { calls.install++; return state; },
      };
    },
  };
  const controller = require('../update-window.cjs').createUpdateWindowController(dependencies);
  return { controller, handlers, windows, notifications, timers, calls, dependencies, menuItem,
    setState(next) { state = { ...state, ...next }; publish(state); },
    event() { const window = windows.at(-1); return { sender: window.webContents, senderFrame: window.webContents.mainFrame }; },
  };
}

test('only the exact updater main frame can check, download, or install', async () => {
  const f = fixture();
  f.controller.show();
  for (const name of ['state', 'check', 'download', 'cancel', 'install']) {
    const handler = f.handlers.get(`desktop:updates:${name}`);
    assert.equal(typeof handler, 'function');
    await assert.rejects(async () => handler({ sender: {}, senderFrame: { url: 'https://workspace.example/' } }), /Untrusted/);
    await assert.rejects(async () => handler({ sender: f.event().sender, senderFrame: { url: 'mola-desktop://app/updates.html' } }), /Untrusted/);
  }
  assert.equal(f.calls.download, 0);
  assert.equal(f.calls.install, 0);
  await f.handlers.get('desktop:updates:download')(f.event());
  assert.equal(f.calls.download, 1);
  assert.equal(f.calls.install, 0);
});

test('installation requires a fresh native confirmation and never runs on cancellation', async () => {
  const declined = fixture();
  declined.controller.show();
  await declined.handlers.get('desktop:updates:install')(declined.event());
  assert.equal(declined.calls.prompts, 1);
  assert.equal(declined.calls.install, 0);
  const accepted = fixture({ answer: 1 });
  accepted.controller.show();
  await accepted.handlers.get('desktop:updates:install')(accepted.event());
  assert.equal(accepted.calls.install, 1);
});

test('closing the updater while the confirmation is pending prevents installation', async () => {
  const f = fixture();
  let respond;
  f.dependencies.dialog.showMessageBox = () => new Promise(resolve => { respond = resolve; });
  f.controller.show();
  const operation = f.handlers.get('desktop:updates:install')(f.event());
  const second = f.handlers.get('desktop:updates:install')(f.event());
  f.windows[0].destroyed = true;
  f.windows[0].emit('closed');
  respond({ response: 1 });
  await Promise.allSettled([operation, second]);
  assert.equal(f.calls.install, 0);
});

test('background discovery advertises once without download, installation, or opening a window', async () => {
  const f = fixture();
  f.setState({ phase: 'available', canInstall: false });
  await f.timers[0]();
  await f.timers[1]();
  assert.equal(f.notifications.length, 1);
  assert.equal(f.notifications[0].options.silent, true);
  assert.equal(f.windows.length, 0);
  assert.equal(f.calls.download, 0);
  assert.equal(f.calls.install, 0);
  assert.match(f.menuItem.label, /1\.0\.7/);
  f.notifications[0].events.click();
  assert.equal(f.windows.length, 1);
  const development = fixture({ packaged: false });
  assert.equal(development.timers.length, 0);
});

test('periodic checks preserve a prepared installer and never race a native confirmation', async () => {
  const f = fixture();
  f.controller.show();
  let respond;
  f.dependencies.dialog.showMessageBox = () => new Promise(resolve => { respond = resolve; });
  const installing = f.handlers.get('desktop:updates:install')(f.event());
  await f.timers[0]();
  await f.timers[1]();
  assert.equal(f.calls.check, 0);
  respond({ response: 1 });
  await installing;
  assert.equal(f.calls.install, 1);
});
