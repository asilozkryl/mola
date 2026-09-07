import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app.js';
import { createWorkspace } from '../server/seed.js';

test('administrative transactions reject a session or global role revoked after the initial permission check', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mola-admin-race-'));
  const runtime = createApp({ dataDir: directory, production: false, appOrigin: 'http://admin-race.test', requireEmailVerification: false, mailTransport: async () => {}, mailEncryptionKey: 'd'.repeat(64) });
  await new Promise<void>(done => runtime.server.listen(0, '127.0.0.1', done));
  try {
    const seed = createWorkspace(runtime.repo, { name: 'Original team', userName: 'Original owner', email: 'owner@race.test', passwordHash: 'existing-password-hash' });
    const token = randomBytes(32).toString('hex'); const tokenHash = createHash('sha256').update(token).digest('hex');
    const session = () => runtime.repo.run('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)', tokenHash, seed.userId, Date.now() + 60_000);
    session(); runtime.repo.run('UPDATE users SET email_verified=1,site_admin=1 WHERE id=?', seed.userId);
    const base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
    const request = (path: string, body: unknown) => fetch(base + '/api' + path, { method: 'PATCH', headers: { Origin: 'http://admin-race.test', Cookie: `mola_session=${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const transaction = runtime.repo.transaction.bind(runtime.repo);
    let beforeTransaction: (() => void) | undefined;
    // Models another process committing a CLI revocation between HTTP authentication
    // and BEGIN IMMEDIATE, without relying on a nondeterministic scheduling race.
    runtime.repo.transaction = <T,>(fn: () => T): T => { const hook = beforeTransaction; beforeTransaction = undefined; hook?.(); return transaction(fn); };
    beforeTransaction = () => { runtime.repo.run('DELETE FROM sessions WHERE token_hash=?', tokenHash); };
    const renamed = await request('/admin/workspace', { name: 'Must never persist' });
    assert.equal(renamed.status, 401);
    assert.equal(runtime.repo.workspace(seed.workspaceId).name, 'Original team');
    assert.equal(runtime.repo.get('SELECT count(*) AS n FROM audit_events')!.n, 0);
    session();
    beforeTransaction = () => { runtime.repo.run('UPDATE users SET site_admin=0 WHERE id=?', seed.userId); };
    const suspended = await request(`/admin/system/workspaces/${seed.workspaceId}`, { suspended: true });
    assert.equal(suspended.status, 403);
    assert.equal(runtime.repo.workspace(seed.workspaceId).suspended, false);
    assert.equal(runtime.repo.get('SELECT count(*) AS n FROM audit_events')!.n, 0);
    assert.equal(runtime.repo.get('SELECT count(*) AS n FROM sessions WHERE user_id=?', seed.userId)!.n, 1, 'a denied mutation cannot revoke another session as a side effect');
  } finally { await runtime.close(); await rm(directory, { recursive: true, force: true }); }
});
