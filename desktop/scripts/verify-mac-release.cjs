// Exercise the app users actually install, after ZIP/DMG creation. A successful
// electron-builder run alone does not prove that a rebranded bundle is sealed.
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { once } = require('node:events');
const { mkdtemp, mkdir, rm, stat } = require('node:fs/promises');
const { createServer } = require('node:http');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const { _electron, expect } = require('@playwright/test');

const run = promisify(execFile);
const { version } = require('../package.json');
const commandOptions = { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 };

async function verifyApplication(appPath, root) {
  const executable = path.join(appPath, 'Contents/MacOS/Mola');
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
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  console.log('ZIP and DMG verified. This checks code integrity and launch, not Developer ID or notarization approval.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
