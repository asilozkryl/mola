const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { mkdtemp, realpath, mkdir, writeFile, readFile, cp, rm, readdir, chmod } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { launchUpdateInstaller } = require('../update-installers.cjs');

async function fixture(t, overrides = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'mola-mac-update-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = join(directory, 'Mola.app');
  const execPath = join(target, 'Contents/MacOS/Mola');
  const resourcesPath = join(target, 'Contents/Resources');
  await mkdir(resourcesPath, { recursive: true });
  await mkdir(join(target, 'Contents/MacOS'));
  await writeFile(execPath, 'old executable', { mode: 0o755 });
  await writeFile(join(resourcesPath, 'mac-updater'), 'bundled helper', { mode: 0o755 });
  const payload = Buffer.from('verified dmg bytes');
  const filePath = join(directory, 'Mola-1.0.8-mac-arm64.dmg');
  await writeFile(filePath, payload, { mode: 0o600 });
  const release = { version: '1.0.8', format: 'dmg', size: payload.length,
    sha256: createHash('sha256').update(payload).digest('hex') };
  const commands = [];
  let config;
  let quit = false;
  let spawned = false;
  const options = {
    platform: 'darwin', arch: 'arm64', currentVersion: '1.0.7', execPath, resourcesPath,
    helperReadyTimeoutMs: 2000,
    async execFile(executable, args) {
      commands.push([executable, args]);
      if (executable === '/usr/bin/hdiutil' && args[0] === 'attach') {
        const mount = args[args.indexOf('-mountpoint') + 1];
        await mkdir(join(mount, 'Mola.app/Contents/MacOS'), { recursive: true });
        await writeFile(join(mount, 'Mola.app/Contents/MacOS/Mola'), 'new executable');
      }
      if (executable === '/usr/bin/ditto') await cp(args[0], args[1], { recursive: true });
      if (executable === '/usr/libexec/PlistBuddy') {
        const field = args[1];
        return { stdout: field.endsWith('CFBundleIdentifier') ? 'app.mola.desktop\n'
          : field.endsWith('CFBundleExecutable') ? 'Mola\n' : '1.0.8\n' };
      }
      return { stdout: executable === '/usr/bin/lipo' ? 'arm64\n' : '' };
    },
    spawn(executable, args, spawnOptions) {
      spawned = true;
      assert.match(executable, /mac-updater$/);
      assert.equal(spawnOptions.detached, true);
      const child = new EventEmitter();
      child.pid = 98765;
      child.unref = () => {};
      child.kill = () => { child.killed = true; };
      void (async () => {
        config = JSON.parse(await readFile(args[0], 'utf8'));
        assert.equal(config.targetPath, target);
        assert.equal(config.version, '1.0.8');
        assert.equal(await readFile(join(config.candidatePath, 'Contents/MacOS/Mola'), 'utf8'), 'new executable');
        await writeFile(config.readyPath, JSON.stringify({ schema: 1, phase: 'ready', pid: child.pid }));
      })().catch(error => child.emit('error', error));
      return child;
    },
    openPath: () => assert.fail('macOS updates must not open a DMG or a download page'),
    async quit() {
      assert.deepEqual(JSON.parse(await readFile(config.commitPath, 'utf8')), { schema: 1, parentPid: process.pid, helperPid: 98765 });
      quit = true;
    },
    ...overrides,
  };
  return { directory, target, filePath, release, options, commands,
    get config() { return config; }, get quit() { return quit; }, get spawned() { return spawned; } };
}

test('macOS prepares a verified whole bundle and commits to the helper before quitting without opening Finder', async t => {
  const f = await fixture(t);
  const result = await launchUpdateInstaller(f.filePath, f.release, f.options);
  assert.equal(result.mode, 'relaunch');
  assert.equal(f.quit, true);
  assert.equal(await readFile(join(f.target, 'Contents/MacOS/Mola'), 'utf8'), 'old executable', 'Only the helper replaces the app after parent exit');
  assert.ok(f.commands.some(([exe, args]) => exe === '/usr/bin/hdiutil' && args[0] === 'detach'));
  assert.ok(f.commands.some(([exe, args]) => exe === '/usr/bin/codesign' && args.includes('--strict')));
  assert.ok(f.commands.some(([exe, args]) => exe === '/usr/bin/xattr' && args[1] === 'com.apple.quarantine' && args.at(-1) === f.config.candidatePath));
  assert.ok(!f.commands.some(([exe, args]) => exe === '/usr/bin/xattr' && args.some(arg => ['-d', '-c', '-dr'].includes(arg))));
});

test('macOS does not quit or leave staging files when bundle validation fails', async t => {
  const f = await fixture(t);
  const original = f.options.execFile;
  f.options.execFile = async (exe, args) => {
    if (exe === '/usr/bin/codesign') throw new Error('invalid signature');
    return original(exe, args);
  };
  await assert.rejects(launchUpdateInstaller(f.filePath, f.release, f.options), /imza|signature/);
  assert.equal(f.quit, false);
  assert.equal(f.spawned, false);
  assert.deepEqual((await readdir(f.directory)).sort(), ['Mola-1.0.8-mac-arm64.dmg', 'Mola.app']);
});

test('macOS rejects wrong bundle metadata and incompatible architecture before handing off', async t => {
  for (const [binary, output] of [['/usr/libexec/PlistBuddy', 'another.app'], ['/usr/bin/lipo', 'x86_64']]) {
    const f = await fixture(t);
    const original = f.options.execFile;
    f.options.execFile = (exe, args) => exe === binary ? Promise.resolve({ stdout: output }) : original(exe, args);
    await assert.rejects(launchUpdateInstaller(f.filePath, f.release, f.options), /kimli|sürüm|mimari/);
    assert.equal(f.quit, false);
    assert.equal(f.spawned, false);
  }
});

test('macOS helper startup failure keeps the current application intact', async t => {
  const f = await fixture(t, { spawn() { const child = new EventEmitter(); child.kill = () => {}; process.nextTick(() => child.emit('error', new Error('spawn denied'))); return child; } });
  await assert.rejects(launchUpdateInstaller(f.filePath, f.release, f.options), /başlat|spawn denied/);
  assert.equal(f.quit, false);
  assert.equal(await readFile(join(f.target, 'Contents/MacOS/Mola'), 'utf8'), 'old executable');
});

test('macOS refuses translocated and unwritable installations before preparing or quitting', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t);
  await assert.rejects(launchUpdateInstaller(f.filePath, f.release, { ...f.options, execPath: '/private/var/AppTranslocation/test/Mola.app/Contents/MacOS/Mola' }), /Uygulamalar|kurul/);
  await chmod(f.target, 0o555);
  try { await assert.rejects(launchUpdateInstaller(f.filePath, f.release, f.options), /yaz|izin/); }
  finally { await chmod(f.target, 0o755); }
  assert.equal(f.quit, false);
  assert.equal(f.spawned, false);
});

test('macOS does not close the app if the helper fails to acknowledge preparation', async t => {
  const f = await fixture(t, { helperReadyTimeoutMs: 200, spawn() { const child = new EventEmitter(); child.pid = 9; child.kill = () => {}; child.unref = () => {}; return child; } });
  await assert.rejects(launchUpdateInstaller(f.filePath, f.release, f.options), /hazır|yanıt|zaman/);
  assert.equal(f.quit, false);
});
