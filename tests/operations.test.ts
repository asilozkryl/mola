import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest, type ClientRequest } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.js';
import { recordPushOutcome } from '../server/notification-controls.js';
// @ts-expect-error Operational scripts run directly under Node.
import { runBackup, verifyBackup } from '../scripts/backup-runner.mjs';

const origin = 'http://operations.test';
async function fixture(run: (context: { runtime: ReturnType<typeof createApp>; base: string; directory: string; token: string; cookie: string; channelId: string }) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), 'mola-operations-'));
  const runtime = createApp({ dataDir: join(directory, 'data'), production: false, appOrigin: origin, mailEncryptionKey: 'c'.repeat(64), mailTransport: async () => {} });
  await new Promise<void>(done => runtime.server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
  try {
    const response = await fetch(base + '/api/auth/demo', { method: 'POST', headers: { Origin: origin } });
    assert.equal(response.status, 200);
    const state = await response.json();
    const cookie = response.headers.get('set-cookie')!.split(';')[0];
    const token = readFileSync(join(directory, 'data', '.ops-token'), 'utf8').trim();
    await run({ runtime, base, directory, token, cookie, channelId: state.channels[0].id });
  } finally { await runtime.close(); rmSync(directory, { recursive: true, force: true }); }
}

test('a normal authenticated workspace owner cannot read metrics or mutate operational snapshots', async () => fixture(async ({ base, cookie, token }) => {
  for (const path of ['/internal/metrics', '/internal/snapshots']) {
    const method = path.endsWith('snapshots') ? 'POST' : 'GET';
    for (const authorization of [undefined, `Bearer ${'x'.repeat(token.length)}`, 'Bearer short']) {
      const response = await fetch(base + path, { method, headers: { Cookie: cookie, Origin: origin, ...(authorization ? { Authorization: authorization } : {}) } });
      assert.equal(response.status, 401, `${method} ${path}`);
    }
  }
  assert.equal((await fetch(base + '/internal/snapshots/snapshot-' + randomUUID(), { method: 'DELETE', headers: { Cookie: cookie, Origin: origin } })).status, 401);
  const response = await fetch(base + '/internal/metrics?token=never-log-this-token', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  const metrics = await response.text();
  assert.equal(metrics.includes('never-log-this-token'), false); assert.equal(metrics.includes(token), false);
  assert.match(metrics, /mola_database_ready 1/);
  assert.match(metrics, /mola_push_queued 0/);
  assert.match(metrics, /mola_push_oldest_queue_age_seconds 0/);
  assert.match(metrics, /mola_push_delivery_total\{outcome="provider_accepted"\} 0/);
  assert.match(metrics, /mola_push_delivery_total\{outcome="subscription_expired"\} 0/);
}));

test('snapshots remain consistent across a half-sent multipart upload and detect same-size backup corruption', { timeout: 20000 }, async () => fixture(async ({ runtime, base, directory, token, cookie, channelId }) => {
  const boundary = `mola-${randomUUID()}`;
  const payload = 'A file written only after the complete multipart upload.';
  let upload: ClientRequest | undefined;
  let receivedFirstChunk!: () => void;
  const firstChunk = new Promise<void>(done => { receivedFirstChunk = done; });
  const observe = (request: import('node:http').IncomingMessage) => { if (request.url?.endsWith('/uploads')) request.once('readable', receivedFirstChunk); };
  runtime.server.on('request', observe);
  try {
    const uploadResponse = new Promise<{ status: number; body: any }>((done, reject) => {
      upload = httpRequest(base + '/api/uploads', { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': `multipart/form-data; boundary=${boundary}` } }, response => {
        const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => { try { done({ status: response.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()) }); } catch (error) { reject(error); } });
      });
      upload.on('error', reject);
      upload.write(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="slow.txt"\r\nContent-Type: text/plain\r\n\r\n${payload.slice(0, 12)}`);
    });
    await firstChunk;
    const first = await fetch(base + '/internal/snapshots', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    assert.equal(first.status, 201);
    const firstSnapshot = await first.json();
    const snapshotDb = new DatabaseSync(join(directory, 'data', 'snapshots', firstSnapshot.id, 'mola.sqlite'), { readOnly: true });
    try { assert.equal(snapshotDb.prepare('SELECT COUNT(*) AS count FROM attachments').get()!.count, 0); }
    finally { snapshotDb.close(); }
    assert.equal(firstSnapshot.files, 0, 'An upload still buffered by multer never produces a dangling snapshot row');
    upload!.end(`${payload.slice(12)}\r\n--${boundary}--\r\n`);
    const completedUpload = await uploadResponse; assert.equal(completedUpload.status, 201);
    const attachment = completedUpload.body;
    const message = await fetch(base + `/api/channels/${channelId}/messages`, { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'Consistent upload', attachmentIds: [attachment.id] }) });
    assert.equal(message.status, 201);
    const completed = await runBackup({ source: join(directory, 'data'), target: join(directory, 'backups'), app: base, token, keep: 2 });
    const backupPath = join(directory, 'backups', completed.name);
    const verified = await verifyBackup(backupPath, { requireChecksums: true });
    assert.equal(verified.files, 1);
    const expectedHash = createHash('sha256').update(payload).digest('hex');
    assert.equal(verified.checksums[`uploads/${attachment.id}.bin`], expectedHash);
    const filePath = join(backupPath, 'uploads', `${attachment.id}.bin`);
    const corrupted = readFileSync(filePath); corrupted[0] ^= 1; writeFileSync(filePath, corrupted);
    assert.equal(corrupted.length, Buffer.byteLength(payload));
    await assert.rejects(verifyBackup(backupPath, { requireChecksums: true }), /checksum mismatch/i);
    assert.equal(readFileSync(join(directory, 'data', 'uploads', `${attachment.id}.bin`), 'utf8'), payload, 'Backup copies do not mutate the live immutable upload');
  } finally { runtime.server.off('request', observe); upload?.destroy(); }
}));

test("push operations metrics expose queue age and fixed failure categories without device or message data", async () =>
  fixture(async ({ runtime, base, token, cookie, channelId }) => {
    const sessionHash = createHash("sha256")
      .update(cookie.split("=")[1])
      .digest("hex");
    const actor = runtime.repo.session(sessionHash)!;
    const message = runtime.repo.get(
      "SELECT id FROM messages WHERE channel_id=? LIMIT 1",
      channelId,
    )!;
    const subscriptionId = randomUUID(),
      notificationId = randomUUID(),
      endpoint = "https://fcm.googleapis.com/private-device-proof";
    runtime.repo.run(
      "INSERT INTO push_subscriptions VALUES(?,?,?,?,?,?,?)",
      subscriptionId,
      actor.id,
      sessionHash,
      endpoint,
      "private-key-proof",
      "private-auth-proof",
      Date.now(),
    );
    runtime.repo.run(
      "INSERT INTO notifications(id,user_id,workspace_id,channel_id,message_id,kind,created_at) VALUES(?,?,?,?,?,'mention',?)",
      notificationId,
      actor.id,
      actor.workspace_id,
      channelId,
      message.id,
      new Date(Date.now() - 120_000).toISOString(),
    );
    // Future due time leaves this fixture in the queue without contacting a provider.
    runtime.repo.run(
      "INSERT INTO push_outbox(id,notification_id,subscription_id,next_attempt) VALUES(?,?,?,?)",
      randomUUID(),
      notificationId,
      subscriptionId,
      Date.now() + 3_600_000,
    );
    recordPushOutcome(runtime.repo, "provider_timeout");
    const response = await fetch(base + "/internal/metrics", {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const metrics = await response.text();
    assert.match(metrics, /mola_push_queued 1/);
    assert.ok(
      Number(metrics.match(/mola_push_oldest_queue_age_seconds (\d+)/)?.[1]) >=
        119,
    );
    assert.match(
      metrics,
      /mola_push_delivery_total\{outcome="provider_timeout"\} 1/,
    );
    assert.match(
      metrics,
      /mola_push_last_failure\{category="provider_timeout"\} 1/,
    );
    assert.ok(
      Number(
        metrics.match(/mola_push_last_failure_timestamp_seconds (\d+)/)?.[1],
      ) > 0,
    );
    for (const secret of [
      token,
      actor.id,
      actor.email,
      message.id,
      notificationId,
      subscriptionId,
      endpoint,
      "private-key-proof",
      "private-auth-proof",
    ])
      assert.equal(metrics.includes(secret), false);
  }));
