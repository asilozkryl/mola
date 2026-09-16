const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { installerGroups, prepareRelease } = require('../scripts/prepare-release.cjs');

test('Mac release runners seal the app bundle and validate packaged installers before publishing', async () => {
  const { load } = require('js-yaml');
  const { configureBuildCommand, normalizeOptions } = require('electron-builder/out/builder');
  const yargs = require('yargs/yargs');
  const workflow = load(await readFile(join(__dirname, '..', '..', '.github', 'workflows', 'desktop.yml'), 'utf8'));
  const job = workflow.jobs.package;
  const macRunners = job.strategy.matrix.include.filter(runner => runner.name.startsWith('macos-'));
  assert.equal(macRunners.length, 2);
  for (const runner of macRunners) {
    const parsed = configureBuildCommand(yargs(runner.args.split(/\s+/))).exitProcess(false).parse();
    const options = normalizeOptions(parsed);
    assert.equal(options.config.mac.identity, '-', `${runner.name} must create an ad-hoc bundle signature`);
    assert.equal(options.config.mac.hardenedRuntime, 'false');
  }
  const build = job.steps.findIndex(step => step.run?.includes('npm run dist'));
  const verification = job.steps.findIndex(step => step.run === 'node scripts/verify-mac-release.cjs');
  const checksums = job.steps.findIndex(step => step.name === 'Create installer integrity checksums');
  assert.ok(build < verification && verification < checksums, 'Verify the actual installers before checksumming and uploading them');
  assert.equal(job.steps[verification].if, "runner.os == 'macOS'");
});

test('Mac packaging honors each native runner architecture and the combined local command', async () => {
  const { load } = require('js-yaml');
  const { normalizeOptions } = require('electron-builder/out/builder');
  const { computeArchToTargetNamesMap } = require('app-builder-lib/out/targets/targetFactory');
  const { Platform } = require('app-builder-lib');
  const { Arch } = require('builder-util');
  const config = load(await readFile(join(__dirname, '..', 'electron-builder.yml'), 'utf8'));
  for (const flags of [{ x64: true }, { arm64: true }, { x64: true, arm64: true }]) {
    const options = normalizeOptions({ mac: [], ...flags });
    const targets = computeArchToTargetNamesMap(options.targets.get(Platform.MAC), {
      platformSpecificBuildOptions: config.mac, defaultTarget: ['dmg', 'zip'],
    }, Platform.MAC);
    assert.deepEqual([...targets.keys()].map(value => Arch[value]).sort(), Object.keys(flags).sort());
    for (const formats of targets.values()) assert.deepEqual([...formats].sort(), ['dmg', 'zip']);
  }
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'mola-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = join(root, 'input');
  const output = join(root, 'output');
  for (const [platform, files] of Object.entries(installerGroups('1.2.3'))) {
    const directory = join(input, `mola-desktop-${platform}`);
    await mkdir(directory, { recursive: true });
    const sums = [];
    for (const filename of files) {
      const bytes = Buffer.from(`installer bytes for ${filename}`);
      await writeFile(join(directory, filename), bytes);
      sums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${filename}`);
    }
    await writeFile(join(directory, 'SHA256SUMS'), sums.join('\n') + '\n');
  }
  return { root, input, output, linux: join(input, 'mola-desktop-linux-x64') };
}

test('release assembly preserves all seven verified installers and merges every runner checksum', async t => {
  const { input, output } = await fixture(t);
  const files = await prepareRelease(input, output, '1.2.3');
  assert.equal(files.length, 7);
  assert.deepEqual((await readdir(output)).sort(), [...files, 'SHA256SUMS'].sort());
  const sums = (await readFile(join(output, 'SHA256SUMS'), 'utf8')).trim().split('\n');
  assert.equal(sums.length, 7);
  for (const filename of files) {
    const digest = createHash('sha256').update(await readFile(join(output, filename))).digest('hex');
    assert.ok(sums.includes(`${digest}  ${filename}`));
  }
});

test('a missing platform or mismatched version prevents any release output', async t => {
  const { input, output } = await fixture(t);
  await assert.rejects(prepareRelease(input, output, '1.2.4'), /Installer set/);
  await rm(join(input, 'mola-desktop-macos-arm64'), { recursive: true });
  await assert.rejects(prepareRelease(input, output, '1.2.3'), /ENOENT/);
  await assert.rejects(readdir(output), /ENOENT/);
});

test('corrupt bytes and unsafe checksum entries cannot enter a public release', async t => {
  const { input, output, linux } = await fixture(t);
  await writeFile(join(linux, 'Mola-1.2.3-linux-amd64.deb'), 'tampered');
  await assert.rejects(prepareRelease(input, output, '1.2.3'), /Checksum mismatch/);
  await writeFile(join(linux, 'SHA256SUMS'), `${'a'.repeat(64)}  ../outside.deb\n`);
  await assert.rejects(prepareRelease(input, output, '1.2.3'), /Invalid checksum entry/);
  await assert.rejects(readdir(output), /ENOENT/);
});

test('unexpected artifacts, empty files, and symbolic links are rejected', async t => {
  const { input, output, linux, root } = await fixture(t);
  await writeFile(join(linux, 'surprise.exe'), 'extra');
  await assert.rejects(prepareRelease(input, output, '1.2.3'), /Installer set/);
  await rm(join(linux, 'surprise.exe'));
  const deb = join(linux, 'Mola-1.2.3-linux-amd64.deb');
  await writeFile(deb, '');
  await assert.rejects(prepareRelease(input, output, '1.2.3'), /invalid installer/);
  await rm(deb);
  const outside = join(root, 'outside');
  await writeFile(outside, 'external');
  await symlink(outside, deb);
  await assert.rejects(prepareRelease(input, output, '1.2.3'), /invalid installer/);
});

test('release assembly never mixes output with an existing release or uses prerelease versions', async t => {
  const { input, output } = await fixture(t);
  await mkdir(output);
  await writeFile(join(output, 'existing-installer.exe'), 'keep');
  await assert.rejects(prepareRelease(input, output, '1.2.3'), /must be empty/);
  assert.equal(await readFile(join(output, 'existing-installer.exe'), 'utf8'), 'keep');
  assert.throws(() => installerGroups('1.2.3-beta.1'), /stable desktop version/);
});
