const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtemp, readFile, writeFile, mkdir, rm, stat } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createNotificationPermissionStore } = require('../notification-permissions.cjs');

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mola-notification-permissions-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, 'permissions.json');
}

test('notification consent persists independently for each normalized server origin', async (t) => {
  const file = await fixture(t);
  const store = await createNotificationPermissionStore(file);
  assert.equal(store.get('https://mola.example'), undefined);
  await store.set('https://mola.example/', true);
  await store.set('https://other.example', false);
  const restarted = await createNotificationPermissionStore(file);
  assert.equal(restarted.get('https://mola.example'), true);
  assert.equal(restarted.get('https://other.example'), false);
  assert.equal(restarted.get('https://third.example'), undefined);
  await restarted.set('https://other.example', true);
  assert.equal((await createNotificationPermissionStore(file)).get('https://other.example'), true);
  if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test('corrupt, oversized and unsupported permission data never grants consent', async (t) => {
  const file = await fixture(t);
  for (const data of ['{', 'null', '{}', JSON.stringify({ version: 2, origins: [['https://mola.example', true]] }),
    JSON.stringify({ version: 1, origins: [['http://public.example', true], ['https://mola.example', 'true']] }),
    ' '.repeat(64 * 1024 + 1)]) {
    await writeFile(file, data);
    const store = await createNotificationPermissionStore(file);
    assert.equal(store.get('https://mola.example'), undefined);
    assert.equal(store.get('http://public.example'), undefined);
  }
});

test('writes are serialized, bounded, and reject unsupported values without losing consent', async (t) => {
  const file = await fixture(t);
  const store = await createNotificationPermissionStore(file);
  await Promise.all(Array.from({ length: 70 }, (_, index) => store.set(`https://mola${index}.example`, true)));
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(saved.origins.length, 64);
  assert.equal(store.get('https://mola0.example'), undefined);
  assert.equal(store.get('https://mola69.example'), true);
  await assert.rejects(store.set('https://mola69.example', 'yes'));
  await assert.rejects(store.set('https://mola69.example/path', true));
  assert.equal((await createNotificationPermissionStore(file)).get('https://mola69.example'), true);
});

test('failed persistence cannot grant in-memory notification permission', async (t) => {
  const file = await fixture(t);
  const store = await createNotificationPermissionStore(file);
  await mkdir(`${file}.tmp`);
  await assert.rejects(store.set('https://mola.example', true));
  assert.equal(store.get('https://mola.example'), undefined);
  await rm(`${file}.tmp`, { recursive: true });
  await store.set('https://mola.example', true);
  assert.equal(store.get('https://mola.example'), true);
});
