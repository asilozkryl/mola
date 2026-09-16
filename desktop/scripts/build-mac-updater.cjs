const { execFile } = require('node:child_process');
const { mkdir } = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const run = promisify(execFile);

async function buildMacUpdater({ arch, output, testing = false }) {
  if (process.platform !== 'darwin') throw new Error('Compile the macOS updater on a native Mac runner.');
  if (!['arm64', 'x64'].includes(arch)) throw new Error(`Unsupported macOS updater architecture: ${arch}`);
  await mkdir(path.dirname(output), { recursive: true });
  const source = path.resolve(__dirname, '../native/mac-updater.swift');
  const target = `${arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx13.0`;
  await run('/usr/bin/xcrun', ['--sdk', 'macosx', 'swiftc', '-O', '-target', target,
    '-framework', 'AppKit', '-framework', 'Foundation',
    ...(testing ? ['-D', 'MOLA_UPDATER_TESTING'] : []), source, '-o', output],
  { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
  return output;
}

// electron-builder invokes beforePack before signing the finished .app. The
// helper must never be added to, or modified in, an already signed app bundle.
module.exports = async function beforePack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const { Arch } = require('builder-util');
  const arch = typeof context.arch === 'string' ? context.arch : Arch[context.arch];
  const output = path.resolve(__dirname, `../release/.native/mac-updater-${arch}`);
  await buildMacUpdater({ arch, output });
};
module.exports.buildMacUpdater = buildMacUpdater;
