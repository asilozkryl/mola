const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const { mkdtemp, readFile, writeFile, mkdir, rm, stat, symlink, link, chmod, readdir, utimes } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { promisify } = require('node:util');
const { launchUpdateInstaller } = require('../update-installers.cjs');

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const appImage = (body) => Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0x41, 0x49, 2]), Buffer.from(body)]);

async function fixture(t, format = 'deb', bytes = Buffer.from('verified installer')) {
  assert.equal(typeof launchUpdateInstaller, 'function', 'The installer handoff must be implemented');
  const directory = await mkdtemp(join(tmpdir(), 'mola-update-installers-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, `Mola-1.2.3.${format}`);
  await writeFile(filePath, bytes, { mode: 0o600 });
  return {
    directory, filePath, bytes,
    release: { format, name: `Mola-1.2.3.${format}`, version: '1.2.3', size: bytes.length, sha256: digest(bytes), url: `https://github.com/asilozkryl/mola/releases/download/desktop-v1.2.3/Mola-1.2.3.${format}` },
  };
}

test('package handoff waits for the OS installer before quitting, and propagates launch failure', async (t) => {
  const { filePath, release } = await fixture(t);
  const actions = [];
  const result = await launchUpdateInstaller(filePath, release, {
    platform: 'linux',
    openPath: async (path) => { assert.equal(path, filePath); actions.push('open'); return ''; },
    quit: () => actions.push('quit'),
  });
  assert.deepEqual(actions, ['open', 'quit']);
  assert.equal(result.mode, 'installer');
  actions.length = 0;
  await assert.rejects(launchUpdateInstaller(filePath, release, {
    platform: 'linux', openPath: async () => 'No application is registered for this file', quit: () => actions.push('quit'),
  }), /No application is registered/);
  assert.deepEqual(actions, []);
});

test('macOS disk images are quarantined before opening without clearing Gatekeeper protection', async (t) => {
  const { filePath, release } = await fixture(t, 'dmg');
  const actions = [];
  await launchUpdateInstaller(filePath, release, {
    platform: 'darwin',
    execFile: async (executable, args) => {
      assert.equal(executable, '/usr/bin/xattr');
      assert.deepEqual(args.slice(0, 2), ['-w', 'com.apple.quarantine']);
      assert.match(args[2], /^0083;[a-f0-9]+;Mola;[a-f0-9-]+$/i);
      assert.equal(args[3], filePath);
      actions.push('quarantine');
    },
    openPath: async () => { actions.push('open'); return ''; },
    quit: () => actions.push('quit'),
  });
  assert.deepEqual(actions, ['quarantine', 'open', 'quit']);
  await assert.rejects(launchUpdateInstaller(filePath, release, {
    platform: 'darwin', execFile: async () => { throw new Error('quarantine denied'); },
    openPath: async () => { assert.fail('Unmarked downloads must not be opened'); },
    quit: () => assert.fail('Mola must remain running'),
  }), /quarantine denied/);
});

test('Windows installers keep the Internet zone marker before shell handoff', async (t) => {
  const { filePath, release } = await fixture(t, 'exe');
  await launchUpdateInstaller(filePath, release, {
    platform: 'win32',
    openPath: async () => {
      const metadata = await readFile(`${filePath}:Zone.Identifier`, 'utf8');
      assert.match(metadata, /^\[ZoneTransfer\]\r?\nZoneId=3\r?\n/);
      assert.ok(metadata.includes(`HostUrl=${release.url}`));
      return '';
    },
  });
});

test('native macOS keeps a readable quarantine attribute on the downloaded disk image', { skip: process.platform !== 'darwin' }, async (t) => {
  const { filePath, release } = await fixture(t, 'dmg');
  await launchUpdateInstaller(filePath, release, {
    openPath: async (path) => {
      const { stdout } = await promisify(require('node:child_process').execFile)('/usr/bin/xattr', ['-p', 'com.apple.quarantine', path]);
      assert.match(stdout.trim(), /^0083;[a-f0-9]+;Mola;[a-f0-9-]+$/i);
      return '';
    },
  });
});

test('download metadata may change file timestamps but never permits changed installer contents', async (t) => {
  const { filePath, release, bytes } = await fixture(t, 'dmg');
  let opened = false;
  await launchUpdateInstaller(filePath, release, {
    platform: 'darwin', execFile: async () => utimes(filePath, new Date(0), new Date(0)),
    openPath: async () => { opened = true; return ''; },
  });
  assert.equal(opened, true);
  await assert.rejects(launchUpdateInstaller(filePath, release, {
    platform: 'darwin', execFile: async () => writeFile(filePath, Buffer.alloc(bytes.length, 0x41)),
    openPath: async () => assert.fail('Changed installer cannot be launched'),
  }), /hash|doğrula|checksum/i);
});

test('modified installers never reach the OS or close the app', async (t) => {
  const { filePath, release } = await fixture(t);
  await writeFile(filePath, 'modified installer');
  await assert.rejects(launchUpdateInstaller(filePath, release, {
    platform: 'linux', openPath: async () => assert.fail('Modified installer launched'), quit: () => assert.fail('App quit'),
  }), /hash|doğrula|checksum|boyut/i);
});

test('wrong platform, relative paths and misleading filename extensions are rejected before launch', async (t) => {
  const { directory, filePath, release } = await fixture(t);
  const wrongName = join(directory, 'Mola.desktop');
  await writeFile(wrongName, 'verified installer');
  for (const [path, platform] of [[filePath, 'darwin'], ['Mola-1.2.3.deb', 'linux'], [wrongName, 'linux']]) {
    await assert.rejects(launchUpdateInstaller(path, release, {
      platform, openPath: async () => assert.fail('Unsupported installer launched'), quit: () => assert.fail('App quit'),
    }));
  }
});

test('symlinked or shared downloaded files are never launched', { skip: process.platform === 'win32' }, async (t) => {
  const { directory, filePath, release } = await fixture(t);
  const alias = join(directory, 'alias.deb');
  await symlink(filePath, alias);
  const options = { platform: 'linux', openPath: async () => assert.fail('Unsafe path opened') };
  await assert.rejects(launchUpdateInstaller(alias, release, options));
  await rm(alias);
  await link(filePath, alias);
  await assert.rejects(launchUpdateInstaller(filePath, release, options));
});

test('AppImage replacement is atomic, preserves execution mode, keeps recovery copy and schedules restart before quit', { skip: process.platform === 'win32' }, async (t) => {
  const { directory, filePath, release, bytes } = await fixture(t, 'AppImage', appImage('new version'));
  const appImagePath = join(directory, 'Installed Mola.AppImage');
  const previous = appImage('old version');
  await writeFile(appImagePath, previous, { mode: 0o740 });
  const actions = [];
  const result = await launchUpdateInstaller(filePath, release, {
    platform: 'linux', appImagePath,
    relaunch: async (path) => {
      assert.equal(path, appImagePath);
      assert.deepEqual(await readFile(path), bytes);
      actions.push('relaunch');
    },
    quit: () => actions.push('quit'),
    openPath: async () => assert.fail('AppImages must not use the OS package installer'),
  });
  assert.equal(result.mode, 'relaunch');
  assert.deepEqual(await readFile(result.backupPath), previous);
  assert.equal((await stat(appImagePath)).mode & 0o777, 0o751);
  assert.deepEqual(actions, ['relaunch', 'quit']);
});

test('AppImage restart scheduling failure restores the previous executable without quitting', { skip: process.platform === 'win32' }, async (t) => {
  const { directory, filePath, release } = await fixture(t, 'AppImage', appImage('new'));
  const appImagePath = join(directory, 'Mola.AppImage');
  const previous = appImage('old');
  await writeFile(appImagePath, previous, { mode: 0o755 });
  await assert.rejects(launchUpdateInstaller(filePath, release, {
    platform: 'linux', appImagePath,
    relaunch: async () => { throw new Error('Cannot schedule relaunch'); },
    quit: () => assert.fail('Failed restart cannot quit Mola'),
  }), /Cannot schedule relaunch/);
  assert.deepEqual(await readFile(appImagePath), previous);
  assert.deepEqual((await readdir(directory)).sort(), ['Mola-1.2.3.AppImage', 'Mola.AppImage']);
});

test('AppImage rollback never overwrites a file changed after replacement and keeps the recovery copy', { skip: process.platform === 'win32' }, async (t) => {
  const { directory, filePath, release } = await fixture(t, 'AppImage', appImage('new'));
  const appImagePath = join(directory, 'Mola.AppImage');
  const previous = appImage('old');
  const changed = appImage('changed by another process');
  await writeFile(appImagePath, previous, { mode: 0o755 });
  await assert.rejects(launchUpdateInstaller(filePath, release, {
    platform: 'linux', appImagePath,
    relaunch: async () => { await writeFile(appImagePath, changed); throw new Error('Restart failed'); },
    quit: () => assert.fail('Failed restart cannot quit Mola'),
  }), /Önceki uygulama.*previous\.AppImage/);
  assert.deepEqual(await readFile(appImagePath), changed);
  const [recovery] = (await readdir(directory)).filter((entry) => entry.startsWith('.mola-update-'));
  assert.deepEqual(await readFile(join(directory, recovery, 'previous.AppImage')), previous);
});

test('AppImage refuses missing or relative installation paths and invalid runtime headers', { skip: process.platform === 'win32' }, async (t) => {
  const { directory, filePath, release } = await fixture(t, 'AppImage', appImage('new'));
  const target = join(directory, 'target.AppImage');
  await writeFile(target, 'not an AppImage', { mode: 0o755 });
  for (const appImagePath of ['', undefined, 'relative.AppImage', target, join(directory, 'missing.AppImage')]) {
    await assert.rejects(launchUpdateInstaller(filePath, release, {
      platform: 'linux', appImagePath, relaunch: async () => assert.fail('Invalid installation restarted'), quit: () => assert.fail('App quit'),
    }));
  }
  const previous = appImage('old');
  await writeFile(target, previous);
  const bad = Buffer.from('not an AppImage');
  await writeFile(filePath, bad);
  await assert.rejects(launchUpdateInstaller(filePath, { ...release, sha256: digest(bad), size: bad.length }, {
    platform: 'linux', appImagePath: target, relaunch: async () => assert.fail('Invalid payload restarted'),
  }));
  assert.deepEqual(await readFile(target), previous);
});

test('AppImage refuses symlink, hardlink and unwritable installations without touching them', { skip: process.platform === 'win32' }, async (t) => {
  const { directory, filePath, release } = await fixture(t, 'AppImage', appImage('new'));
  const target = join(directory, 'target.AppImage');
  const previous = appImage('old');
  await writeFile(target, previous, { mode: 0o755 });
  const alias = join(directory, 'alias.AppImage');
  const options = { platform: 'linux', relaunch: async () => assert.fail('Unsafe installation restarted') };
  await symlink(target, alias);
  await assert.rejects(launchUpdateInstaller(filePath, release, { ...options, appImagePath: alias }));
  await rm(alias);
  await link(target, alias);
  await assert.rejects(launchUpdateInstaller(filePath, release, { ...options, appImagePath: target }));
  await rm(alias);
  await chmod(target, 0o555);
  await assert.rejects(launchUpdateInstaller(filePath, release, { ...options, appImagePath: target }));
  assert.deepEqual(await readFile(target), previous);
  const locked = join(directory, 'locked');
  await mkdir(locked, { mode: 0o755 });
  const lockedTarget = join(locked, 'Mola.AppImage');
  await writeFile(lockedTarget, previous, { mode: 0o755 });
  await chmod(locked, 0o555);
  try {
    await assert.rejects(launchUpdateInstaller(filePath, release, { ...options, appImagePath: lockedTarget }));
    assert.deepEqual(await readFile(lockedTarget), previous);
  } finally {
    await chmod(locked, 0o755);
  }
});
