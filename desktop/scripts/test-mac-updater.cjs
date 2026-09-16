// Native tests use locally built fixture apps, never a customer's installation.
// Their unquarantined launch proves the replacement/LaunchServices mechanism;
// it does not imply Gatekeeper approval of an ad-hoc internet download.
const assert = require('node:assert/strict');
const { spawn, execFile } = require('node:child_process');
const { once } = require('node:events');
const { mkdtemp, mkdir, readFile, writeFile, copyFile, rm, realpath, stat } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const { buildMacUpdater } = require('./build-mac-updater.cjs');

const run = promisify(execFile);
const options = { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 };
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

async function readJSON(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function until(fn, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await delay(30);
  }
  throw new Error('Timed out waiting for the native updater test');
}

const fixtureSource = `
import AppKit
import Foundation
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let info = Bundle.main.infoDictionary!
let receipt = info["MolaFixtureReceipt"] as! String
let data = try! JSONSerialization.data(withJSONObject: ["pid": ProcessInfo.processInfo.processIdentifier, "version": info["CFBundleShortVersionString"] as! String])
try! data.write(to: URL(fileURLWithPath: receipt), options: .atomic)
app.run()
`;

// The driver is the helper's real parent. It publishes explicit installation
// consent and then exits, just as Electron does in production.
const driverSource = String.raw`
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { spawn } = require('node:child_process');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const [helper, configFile, scenario] = process.argv.slice(2);
  const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
  config.parentPid = process.pid;
  await fs.writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
  const log = fsSync.openSync(configFile + '.helper.log', 'wx', 0o600);
  const child = spawn(helper, [configFile], { detached: true, stdio: ['ignore', log, log] });
  fsSync.closeSync(log);
  child.on('error', error => { console.error(error); process.exit(1); });
  child.unref();
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    try {
      const result = JSON.parse(await fs.readFile(config.resultPath, 'utf8'));
      if (result.phase === 'failed') return;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    let ready;
    try { ready = JSON.parse(await fs.readFile(config.readyPath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (ready) {
      if (scenario === 'no-commit') { await delay(2000); return; }
      if (scenario === 'tamper-after-ready') await fs.appendFile(config.candidatePath + '/Contents/Info.plist', '\nchanged');
      const temporary = config.commitPath + '.tmp';
      await fs.writeFile(temporary, JSON.stringify({ schema: 1, parentPid: process.pid, helperPid: ready.pid }), { mode: 0o600 });
      await fs.rename(temporary, config.commitPath);
      if (scenario === 'parent-stays-alive') await delay(2000);
      return;
    }
    await delay(25);
  }
  throw new Error('Helper did not become ready');
})().catch(error => { console.error(error); process.exitCode = 1; });
`;

async function main() {
  assert.equal(process.platform, 'darwin', 'Run native updater tests on macOS.');
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'mola-native-updater-')));
  const running = new Set();
  try {
    const helper = path.join(root, 'mac-updater-test');
    await buildMacUpdater({ arch: process.arch, output: helper, testing: true });
    const source = path.join(root, 'Fixture.swift');
    const executable = path.join(root, 'Fixture');
    const driver = path.join(root, 'driver.cjs');
    await writeFile(source, fixtureSource);
    await writeFile(driver, driverSource);
    await run('/usr/bin/xcrun', ['--sdk', 'macosx', 'swiftc', '-O', '-framework', 'AppKit', source, '-o', executable], options);

    async function app(appPath, version, receipt, identifier = 'app.mola.desktop') {
      await mkdir(path.join(appPath, 'Contents/MacOS'), { recursive: true });
      await copyFile(executable, path.join(appPath, 'Contents/MacOS/Mola'));
      const properties = { CFBundleIdentifier: identifier, CFBundleName: 'Mola Updater Test', CFBundleExecutable: 'Mola',
        CFBundlePackageType: 'APPL', CFBundleShortVersionString: version, CFBundleVersion: version, MolaFixtureReceipt: receipt };
      await writeFile(path.join(appPath, 'Contents/Info.plist'), '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>' +
        Object.entries(properties).map(([key, value]) => `<key>${key}</key><string>${xml(value)}</string>`).join('') + '</dict></plist>');
      await run('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', appPath], options);
    }

    async function fixture(name, { scenario = '', quarantine = false, identifier = 'app.mola.desktop', arch = process.arch } = {}) {
      const directory = path.join(root, name);
      await mkdir(directory, { mode: 0o700 });
      const staging = await mkdtemp(path.join(directory, '.mola-update-'));
      const targetPath = path.join(directory, 'Mola.app');
      const candidatePath = path.join(staging, 'Mola.app');
      const previousReceipt = path.join(directory, 'previous-started.json');
      const receipt = path.join(directory, 'updated-started.json');
      await app(targetPath, '1.2.2', previousReceipt);
      await app(candidatePath, '1.2.3', receipt, identifier);
      const quarantineValue = '0083;65000000;MolaNativeUpdaterTest;A791C83A-24F3-43B6-BF79-197DEB915A2A';
      if (quarantine) await run('/usr/bin/xattr', ['-w', 'com.apple.quarantine', quarantineValue, candidatePath], options);
      const config = { schema: 1, parentPid: 0, targetPath, candidatePath, currentVersion: '1.2.2', version: '1.2.3',
        bundleId: 'app.mola.desktop', arch, resultPath: path.join(staging, 'result.json'), readyPath: path.join(staging, 'ready.json'), commitPath: path.join(staging, 'commit.json') };
      const installedIdentity = await stat(targetPath);
      const candidateIdentity = await stat(candidatePath);
      const configFile = path.join(staging, 'config.json');
      await writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
      const child = spawn(process.execPath, [driver, helper, configFile, scenario], {
        stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, MOLA_UPDATER_TEST_SCENARIO: scenario },
      });
      const childExit = once(child, 'exit');
      let stderr = '';
      child.stderr.on('data', bytes => { stderr += bytes; });
      let result;
      try {
        // LaunchServices has a 45-second native deadline. Wait long enough to
        // receive that explicit outcome rather than masking it with a fixture timeout.
        result = await until(() => readJSON(config.resultPath), 70_000);
      } catch (error) {
        console.error(`Native fixture ${name}: driver stderr: ${stderr}`);
        console.error(await readFile(configFile + '.helper.log', 'utf8').catch(() => 'No helper log'));
        console.error({ ready: await readJSON(config.readyPath), commit: await readJSON(config.commitPath), result: await readJSON(config.resultPath) });
        throw error;
      }
      const [code] = await childExit;
      assert.equal(code, 0, stderr);
      const ready = await readJSON(config.readyPath);
      if (ready) await until(() => {
        try { process.kill(ready.pid, 0); return false; }
        catch (error) { if (error.code === 'ESRCH') return true; throw error; }
      }, 70_000);
      const started = await readJSON(receipt);
      const previousStarted = await readJSON(previousReceipt);
      if (started) running.add(started.pid);
      if (previousStarted) running.add(previousStarted.pid);
      if (name === 'successful-update' && result.phase !== 'installed') {
        console.error(await readFile(configFile + '.helper.log', 'utf8'));
        console.error(result);
      }
      return { ...config, result, receipt, previousReceipt, installedIdentity, candidateIdentity, quarantineValue };
    }

    const success = await fixture('successful-update');
    assert.equal(success.result.phase, 'installed', JSON.stringify(success.result));
    assert.equal(success.result.backupPath, success.candidatePath);
    assert.equal((await stat(success.targetPath)).ino, success.candidateIdentity.ino, 'New bundle replaces the complete old bundle');
    assert.equal((await stat(success.candidatePath)).ino, success.installedIdentity.ino, 'Previous bundle is preserved intact');
    const opened = await until(() => readJSON(success.receipt));
    running.add(opened.pid);
    assert.equal(opened.version, '1.2.3', 'LaunchServices starts the actual updated app');
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', success.targetPath], options);
    process.kill(opened.pid, 'SIGTERM');
    running.delete(opened.pid);
    console.log('Passed: atomic bundle replacement, retained backup, valid signature and real LaunchServices launch.');

    const denied = await fixture('launch-denied', { scenario: 'deny-launch', quarantine: true });
    assert.equal(denied.result.phase, 'failed');
    assert.equal(denied.result.rolledBack, true);
    assert.equal((await stat(denied.targetPath)).ino, denied.installedIdentity.ino);
    assert.equal((await stat(denied.candidatePath)).ino, denied.candidateIdentity.ino);
    const quarantine = await run('/usr/bin/xattr', ['-p', 'com.apple.quarantine', denied.candidatePath], options);
    assert.equal(quarantine.stdout.trim(), denied.quarantineValue, 'A rejected candidate keeps its quarantine marker');
    console.log('Passed: denied launch restores the previous bundle without stripping quarantine.');

    for (const scenario of ['launch-timeout', 'unverified-live-launch']) {
      const pending = await fixture(scenario, { scenario });
      assert.equal(pending.result.phase, 'failed');
      assert.equal(pending.result.rolledBack, false);
      assert.equal((await stat(pending.targetPath)).ino, pending.candidateIdentity.ino, 'Never swap underneath a possibly running update');
      assert.equal((await stat(pending.candidatePath)).ino, pending.installedIdentity.ino, 'Keep the original bundle for recovery');
      assert.equal(await readJSON(pending.previousReceipt), null, 'Never launch the old app against the running update');
      const started = await readJSON(pending.receipt);
      if (scenario === 'unverified-live-launch') {
        assert.ok(started, 'The live launch fixture really started');
        process.kill(started.pid, 'SIGTERM');
        running.delete(started.pid);
      }
      console.log(`Passed: ${scenario} preserves the live bundle and original backup.`);
    }

    for (const [name, settings] of [
      ['wrong-identity', { identifier: 'app.other.desktop' }],
      ['wrong-architecture', { arch: process.arch === 'arm64' ? 'x64' : 'arm64' }],
      ['missing-consent', { scenario: 'no-commit' }],
      ['parent-timeout', { scenario: 'parent-stays-alive' }],
      ['modified-candidate', { scenario: 'tamper-after-ready' }],
    ]) {
      const failed = await fixture(name, settings);
      assert.equal(failed.result.phase, 'failed', `${name} must fail`);
      assert.equal((await stat(failed.targetPath)).ino, failed.installedIdentity.ino, `${name} must preserve the installed bundle`);
      assert.equal(await readJSON(failed.receipt), null, `${name} must never launch the candidate`);
      if (name === 'modified-candidate') {
        const restored = await readJSON(failed.previousReceipt);
        assert.equal(restored?.version, '1.2.2', 'An intact previous app reopens after post-exit candidate validation fails');
      }
      console.log(`Passed: ${name} preserves the installed app.`);
    }
  } finally {
    for (const pid of running) { try { process.kill(pid, 'SIGTERM'); } catch {} }
    await rm(root, { recursive: true, force: true });
  }
  console.log('Native helper tests passed. Ad-hoc fixture launch is not a Gatekeeper/notarization acceptance test.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
