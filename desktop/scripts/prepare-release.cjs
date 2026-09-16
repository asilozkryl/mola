const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const { copyFile, lstat, mkdir, readdir, readFile, writeFile } = require('node:fs/promises');
const { join, resolve } = require('node:path');

function installerGroups(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('A stable desktop version is required.');
  return {
    'linux-x64': [`Mola-${version}-linux-amd64.deb`, `Mola-${version}-linux-x86_64.AppImage`],
    'windows-x64': [`Mola-${version}-win-x64.exe`],
    'macos-x64': [`Mola-${version}-mac-x64.dmg`, `Mola-${version}-mac-x64.zip`],
    'macos-arm64': [`Mola-${version}-mac-arm64.dmg`, `Mola-${version}-mac-arm64.zip`],
  };
}

async function sha256(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

// Keep each runner's checksum file separate until every expected installer has
// been verified. Merging artifacts first would overwrite three SHA256SUMS files.
async function prepareRelease(inputDirectory, outputDirectory, version) {
  const groups = installerGroups(version);
  const verified = [];
  for (const [platform, filenames] of Object.entries(groups)) {
    const directory = join(inputDirectory, `mola-desktop-${platform}`);
    const entries = (await readdir(directory)).sort();
    const expected = [...filenames, 'SHA256SUMS'].sort();
    if (entries.length !== expected.length || entries.some((name, i) => name !== expected[i])) {
      throw new Error(`Installer set does not match ${platform} at version ${version}.`);
    }
    const sums = new Map();
    for (const line of (await readFile(join(directory, 'SHA256SUMS'), 'utf8')).trim().split('\n')) {
      const match = /^([a-f0-9]{64})  (Mola-[\w.-]+)$/.exec(line);
      if (!match || !filenames.includes(match[2]) || sums.has(match[2])) {
        throw new Error(`Invalid checksum entry for ${platform}.`);
      }
      sums.set(match[2], match[1]);
    }
    for (const filename of filenames) {
      const path = join(directory, filename);
      const stat = await lstat(path);
      if (!stat.isFile() || stat.size === 0 || !sums.has(filename)) {
        throw new Error(`Missing or invalid installer: ${filename}.`);
      }
      const digest = await sha256(path);
      if (sums.get(filename) !== digest) throw new Error(`Checksum mismatch: ${filename}.`);
      verified.push({ filename, path, digest });
    }
  }

  await mkdir(outputDirectory, { recursive: true });
  if ((await readdir(outputDirectory)).length) throw new Error('Release output directory must be empty.');
  verified.sort((a, b) => a.filename.localeCompare(b.filename, 'en'));
  for (const entry of verified) await copyFile(entry.path, join(outputDirectory, entry.filename));
  await writeFile(join(outputDirectory, 'SHA256SUMS'), verified.map(entry => `${entry.digest}  ${entry.filename}\n`).join(''));
  return verified.map(entry => entry.filename);
}

if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error('Usage: node desktop/scripts/prepare-release.cjs <downloaded-artifacts> <empty-output-directory>');
    process.exitCode = 1;
  } else {
    prepareRelease(resolve(input), resolve(output), require('../package.json').version)
      .then(files => console.log(`Verified ${files.length} desktop installers and generated SHA256SUMS.`))
      .catch(error => { console.error(error.message); process.exitCode = 1; });
  }
}

module.exports = { installerGroups, prepareRelease };
