import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, readdir, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app.js';
// @ts-expect-error Operational scripts run directly under Node.
import { runBackup, verifyBackup } from '../scripts/backup-runner.mjs';

test('full snapshot survives concurrent upload deletion, verified retention and empty-directory restore', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mola-ops-'));
  const data = join(directory, 'data'); const target = join(directory, 'backups');
  const runtime = createApp({ dataDir: data, appOrigin: 'http://ops.test', production: false, mailTransport: async () => {} });
  await new Promise<void>(done => runtime.server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
  let cookie = '';
  const request = async (path: string, init: RequestInit = {}) => fetch(base + path, { ...init, headers: { Origin: 'http://ops.test', Cookie: cookie, ...init.headers } });
  const json = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await request('/internal/metrics')).status, 401);
    assert.equal((await request('/internal/snapshots', { method: 'POST' })).status, 401);
    const demo = await request('/api/auth/demo', { method: 'POST' }); cookie = demo.headers.get('set-cookie')!.split(';')[0];
    const state = await demo.json();
    const form = new FormData(); form.set('file', new Blob(['immutable backup payload'], { type: 'text/plain' }), 'proof.txt');
    const attachment = await (await request('/api/uploads', { method: 'POST', body: form })).json();
    const message = await (await request(`/api/channels/${state.channels[0].id}/messages`, json({ content: 'restorable message', attachmentIds: [attachment.id] }))).json();
    const token = (await readFile(join(data, '.ops-token'), 'utf8')).trim();
    const ops = { Authorization: `Bearer ${token}` };
    const snapshot = await (await request('/internal/snapshots', { method: 'POST', headers: ops })).json();
    assert.ok(snapshot.id);
    assert.equal((await request(`/api/messages/${message.id}`, { method: 'DELETE' })).status, 204);
    const staged = join(data, 'snapshots', snapshot.id);
    const verified = await verifyBackup(staged);
    assert.equal(verified.files, 1, 'database and hardlink survive deletion of live attachment');
    await writeFile(join(staged, 'checksums.json'), JSON.stringify(verified.checksums));
    assert.equal(await readFile(join(staged, 'uploads', `${attachment.id}.bin`), 'utf8'), 'immutable backup payload');
    const restored = join(directory, 'restored');
    const restore = spawnSync(process.execPath, ['scripts/restore-backup.mjs', staged, restored], { encoding: 'utf8' });
    assert.equal(restore.status, 0, restore.stderr);
    const restoredApp = createApp({ dataDir: restored, appOrigin: 'http://ops.test', production: false, mailTransport: async () => {} });
    await new Promise<void>(done => restoredApp.server.listen(0, '127.0.0.1', done));
    try {
      const restoredBase = `http://127.0.0.1:${(restoredApp.server.address() as AddressInfo).port}`;
      const download = await fetch(restoredBase + attachment.url, { headers: { Cookie: cookie } });
      assert.equal(download.status, 200); assert.equal(await download.text(), 'immutable backup payload');
      const row = restoredApp.repo.get('SELECT content FROM messages WHERE id=?', message.id); assert.equal(row!.content, 'restorable message');
    } finally { await restoredApp.close(); }
    assert.notEqual(spawnSync(process.execPath, ['scripts/restore-backup.mjs', staged, restored]).status, 0, 'existing data never overwritten');
    await request(`/internal/snapshots/${snapshot.id}`, { method: 'DELETE', headers: ops });
    await mkdir(target); await writeFile(join(target, 'unrelated.txt'), 'preserve');
    await runBackup({ source: data, target, app: base, token, keep: 1 });
    const completed = await runBackup({ source: data, target, app: base, token, keep: 1 });
    assert.equal((await readdir(target)).filter(name => name.startsWith('backup-')).length, 1);
    assert.equal(await readFile(join(target, 'unrelated.txt'), 'utf8'), 'preserve');
    assert.equal((await verifyBackup(join(target, completed.name))).files, 0);
    await writeFile(join(target, completed.name, 'manifest.json'), '{}');
    await assert.rejects(verifyBackup(join(target, completed.name)), /checksum mismatch/);
    const concurrent = await Promise.allSettled([runBackup({ source: data, target, app: base, token, keep: 1 }), runBackup({ source: data, target, app: base, token, keep: 1 })]);
    assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1, 'manual and scheduled runs serialize');
    assert.match(String((concurrent.find(result => result.status === 'rejected') as PromiseRejectedResult).reason), /Backup lock exists/);
    assert.equal((await readdir(target)).includes('.backup-lock'), false);
    const metrics = await (await request('/internal/metrics', { headers: ops })).text();
    assert.match(metrics, /mola_database_ready 1/); assert.match(metrics, /mola_snapshot_last_duration_seconds /);
    assert.match(metrics, /mola_mail_outbox\{status="pending"\}/);
    assert.equal(metrics.includes(state.user.email), false); assert.equal(metrics.includes(token), false);
  } finally { await runtime.close(); await rm(directory, { recursive: true, force: true }); }
});
