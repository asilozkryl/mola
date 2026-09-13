const { readFile, writeFile, rename, mkdir } = require('node:fs/promises');
const { dirname } = require('node:path');
const { normalizeServerUrl } = require('./policy.cjs');

async function readSettings(file) {
  try { return normalizeServerUrl(JSON.parse(await readFile(file, 'utf8')).serverUrl); }
  catch (error) {
    if (error.code && error.code !== 'ENOENT') throw error;
    return null;
  }
}

async function saveSettings(file, value) {
  const serverUrl = normalizeServerUrl(value);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify({ serverUrl }, null, 2), { mode: 0o600 });
  await rename(`${file}.tmp`, file);
}

module.exports = { readSettings, saveSettings };
