const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtemp, readFile, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { readSettings, saveSettings } = require('../settings.cjs');

test('server configuration survives restart and invalid data never replaces it', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'mola-settings-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'settings.json');
  assert.equal(await readSettings(file), null);
  await saveSettings(file, 'https://mola.example/');
  assert.equal(await readSettings(file), 'https://mola.example');
  await assert.rejects(saveSettings(file, 'http://unsafe.example'));
  assert.equal(await readSettings(file), 'https://mola.example');
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { serverUrl: 'https://mola.example' });
});

test('corrupt or insecure saved settings return to setup instead of loading a page', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'mola-settings-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'settings.json');
  for (const content of ['{', 'null', '{}', '{"serverUrl":"http://unsafe.example"}']) {
    await writeFile(file, content);
    assert.equal(await readSettings(file), null);
  }
});
