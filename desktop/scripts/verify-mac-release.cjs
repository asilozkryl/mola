// Exercise the app users actually install, after ZIP/DMG creation. A successful
// electron-builder run alone does not prove that a rebranded bundle is sealed.
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { once } = require('node:events');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { mkdtemp, mkdir, rm, stat, open, readFile, writeFile, realpath } = require('node:fs/promises');
const { createServer } = require('node:http');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const { _electron, expect } = require('@playwright/test');
const { prepareMacUpdate } = require('../mac-update.cjs');

const run = promisify(execFile);
const { version } = require('../package.json');
const commandOptions = { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 };

async function verifyApplication(appPath, root) {
  const executable = path.join(appPath, 'Contents/MacOS/Mola');
  const updater = path.join(appPath, 'Contents/Resources/mac-updater');
  assert.ok((await stat(updater)).isFile(), 'The native macOS updater must be packaged before signing.');
  await run('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', updater], commandOptions);
  const helperArchitecture = await run('/usr/bin/lipo', ['-archs', updater], commandOptions);
  assert.equal(helperArchitecture.stdout.trim(), process.arch === 'arm64' ? 'arm64' : 'x86_64');
  assert.equal((await readFile(updater)).includes(Buffer.from('MOLA_UPDATER_TEST_SCENARIO')), false,
    'A production release must not contain the test-only updater build.');
  const resourceSeal = await stat(path.join(appPath, 'Contents/_CodeSignature/CodeResources'));
  assert.ok(resourceSeal.isFile() && resourceSeal.size > 0, 'Mola must have a sealed app bundle, not only Electron linker signatures.');
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], commandOptions);
  const signature = await run('/usr/bin/codesign', ['--display', '--verbose=4', appPath], commandOptions);
  assert.match(signature.stderr, /Identifier=app\.mola\.desktop\s/);
  const architecture = await run('/usr/bin/lipo', ['-archs', executable], commandOptions);
  assert.equal(architecture.stdout.trim(), process.arch === 'arm64' ? 'arm64' : 'x86_64');

  const server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><html lang="tr"><title>Mola paket testi</title><h1>Mola paket testi</h1></html>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/`;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.MOLA_SERVER_URL;
  let application;
  try {
    const profile = path.join(root, 'profile');
    await mkdir(profile);
    application = await _electron.launch({
      executablePath: executable,
      args: [`--user-data-dir=${profile}`],
      env,
      chromiumSandbox: true,
      timeout: 30_000,
    });
    assert.deepEqual(await application.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion() })), {
      packaged: true, version,
    });
    const setup = await application.firstWindow();
    await expect(setup.getByLabel('Sunucu adresi')).toBeVisible();
    await setup.getByLabel('Sunucu adresi').fill(url);
    await setup.getByRole('button', { name: 'Bağlan', exact: true }).click();
    await expect.poll(() => application.windows().some(page => page.url() === url)).toBe(true);
    const remote = application.windows().find(page => page.url() === url);
    await expect(remote.getByRole('heading', { name: 'Mola paket testi' })).toBeVisible();
    assert.deepEqual(await remote.evaluate(() => ({ require: typeof window.require, process: typeof window.process })), {
      require: 'undefined', process: 'undefined',
    });
    await remote.evaluate(() => window.open('mola-desktop://app/updates', '_blank'));
    await expect.poll(() => application.windows().some(page => page.url() === 'mola-desktop://app/updates.html')).toBe(true);
    const updates = application.windows().find(page => page.url() === 'mola-desktop://app/updates.html');
    await expect(updates.getByRole('heading', { name: 'Mola güncellemeleri', exact: true })).toBeVisible();
    const updateState = await updates.evaluate(() => window.molaDesktop.getUpdateState());
    assert.equal(updateState.currentVersion, version);
    assert.equal(updateState.format, 'dmg');
    assert.equal(updateState.installMode, 'relaunch');
    assert.notEqual(updateState.phase, 'unsupported');
    await updates.close();
    console.log(`Verified ${path.basename(root)}: ${architecture.stdout.trim()}, valid bundle signature, packaged ${version}, setup and sandboxed renderer.`);
  } finally {
    try {
      if (application) {
        let timer;
        try {
          await Promise.race([
            application.close(),
            new Promise((_, reject) => {
              timer = setTimeout(() => {
                application.process()?.kill('SIGKILL');
                reject(new Error('Packaged Mola did not close within 5 seconds.'));
              }, 5000);
            }),
          ]);
        } finally { clearTimeout(timer); }
      }
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  }
}

async function verifyUpdatePreparation(appPath, diskImage) {
  const canonicalApp = await realpath(appPath);
  const installed = await stat(canonicalApp);
  const file = await open(diskImage, 'r');
  const hash = createHash('sha256');
  for await (const bytes of file.createReadStream({ start: 0, autoClose: false })) hash.update(bytes);
  const release = { format: 'dmg', version, size: (await file.stat()).size, sha256: hash.digest('hex') };
  let inspected = false;
  let stopped = false;
  let preparedConfiguration;
  let inspection;
  const child = new EventEmitter();
  child.pid = process.pid + 1000;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => { stopped = true; };
  child.unref = () => {};
  try {
    await assert.rejects(prepareMacUpdate({ file }, release, {
      execPath: path.join(canonicalApp, 'Contents/MacOS/Mola'),
      resourcesPath: path.join(canonicalApp, 'Contents/Resources'),
      currentVersion: version, arch: process.arch, execFile: run,
      spawn(helper, args, spawnOptions) {
        assert.equal(helper, path.join(canonicalApp, 'Contents/Resources/mac-updater'));
        assert.equal(args.length, 1);
        assert.deepEqual(spawnOptions, { detached: true, stdio: 'ignore' });
        // Only the process handoff is substituted. Image mounting, copying,
        // metadata checks, codesign, architecture and quarantine all run natively.
        inspection = (async () => {
          const config = JSON.parse(await readFile(args[0], 'utf8'));
          preparedConfiguration = config;
          const candidate = config.candidatePath;
          assert.equal((await stat(path.dirname(candidate))).mode & 0o777, 0o700);
          await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', candidate], commandOptions);
          const attribute = await run('/usr/bin/xattr', ['-p', 'com.apple.quarantine', candidate], commandOptions);
          assert.match(attribute.stdout.trim(), /^0083;[a-f0-9]+;Mola;[a-f0-9-]+$/i);
          assert.equal((await stat(canonicalApp)).ino, installed.ino, 'Preparation must not modify the installed bundle');
          inspected = true;
          const temporary = config.readyPath + '.tmp';
          await writeFile(temporary, JSON.stringify({ schema: 1, phase: 'ready', pid: child.pid }), { mode: 0o600 });
          await require('node:fs/promises').rename(temporary, config.readyPath);
        })();
        // Surface any inspection failure to the production readiness waiter.
        inspection.catch(error => child.emit('error', error));
        return child;
      },
      quit: async () => {
        await inspection;
        assert.equal(inspected, true);
        const commit = JSON.parse(await readFile(preparedConfiguration.commitPath, 'utf8'));
        assert.deepEqual(commit, { schema: 1, parentPid: process.pid, helperPid: child.pid });
        throw Object.assign(new Error('Native preparation test stopped before quitting'), { userMessage: 'Native preparation test stopped before quitting' });
      },
    }), /Native preparation test stopped before quitting/);
    assert.equal(inspected, true);
    assert.equal(stopped, true);
    assert.equal((await stat(canonicalApp)).ino, installed.ino);
    await assert.rejects(stat(path.dirname(preparedConfiguration.candidatePath)), { code: 'ENOENT' });
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', canonicalApp], commandOptions);
    console.log('Verified native DMG update preparation: hdiutil, ditto, version, architecture, signature, quarantine and unchanged installed app.');
  } finally { await file.close(); }
}

async function main() {
  assert.equal(process.platform, 'darwin', 'Run this validation on a native macOS runner.');
  assert.ok(['arm64', 'x64'].includes(process.arch), 'Unsupported macOS architecture.');
  const root = await mkdtemp(path.join(tmpdir(), 'mola-mac-release-'));
  const stem = path.resolve(__dirname, '..', 'release', `Mola-${version}-mac-${process.arch}`);
  try {
    const zipRoot = path.join(root, 'zip');
    await mkdir(zipRoot);
    await run('/usr/bin/ditto', ['-x', '-k', `${stem}.zip`, zipRoot], commandOptions);
    await verifyApplication(path.join(zipRoot, 'Mola.app'), zipRoot);

    const mount = path.join(root, 'volume');
    const dmgRoot = path.join(root, 'dmg');
    await mkdir(mount);
    await mkdir(dmgRoot);
    await run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, `${stem}.dmg`], commandOptions);
    try {
      await run('/usr/bin/ditto', [path.join(mount, 'Mola.app'), path.join(dmgRoot, 'Mola.app')], commandOptions);
    } finally {
      await run('/usr/bin/hdiutil', ['detach', mount], commandOptions);
    }
    await verifyApplication(path.join(dmgRoot, 'Mola.app'), dmgRoot);
    await verifyUpdatePreparation(path.join(dmgRoot, 'Mola.app'), `${stem}.dmg`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  console.log('ZIP and DMG verified. This checks code integrity and launch, not Developer ID or notarization approval.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
