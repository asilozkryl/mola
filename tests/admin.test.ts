import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { createApp } from '../server/app.js';
import { createWorkspace } from '../server/seed.js';
import { manageSiteAdmin } from '../server/admin-cli.js';
import { request as httpRequest, type ClientRequest } from 'node:http';

const origin = 'http://admin.test';
const password = 'admin-test-password-2026';
type Account = { id: string; workspaceId: string; email: string; cookie: string };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

async function fixture(run: (context: {
  runtime: ReturnType<typeof createApp>;
  accounts: Record<'owner' | 'member' | 'foreign' | 'admin', Account>;
  channel: string;
  base: string;
  directory: string;
  request: (actor: Account | null, path: string, method?: string, body?: unknown) => Promise<Response>;
  upload: (actor: Account) => Promise<{ id: string; url: string }>;
  socket: (actor: Account) => Promise<Socket>;
}) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'mola-admin-'));
  const runtime = createApp({ dataDir: directory, appOrigin: origin, production: false, requireEmailVerification: false, mailTransport: async () => {}, mailEncryptionKey: 'a'.repeat(64) });
  await new Promise<void>(done => runtime.server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
  const sockets: Socket[] = [];
  const request = (actor: Account | null, path: string, method = 'GET', body?: unknown) => fetch(base + '/api' + path, { method, headers: { Origin: origin, ...(actor ? { Cookie: actor.cookie } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  try {
    const response = await request(null, '/auth/register', 'POST', { name: 'Workspace Owner', email: 'owner@admin.test', password, workspaceName: 'Primary team', siteAdmin: true });
    assert.equal(response.status, 200); const state = await response.json();
    const owner: Account = { id: state.user.id, workspaceId: state.workspace.id, email: state.user.email, cookie: response.headers.get('set-cookie')!.split(';')[0] };
    assert.equal(Boolean(state.user.siteAdmin), false, 'public registration cannot grant site administration');
    runtime.repo.run('UPDATE users SET email_verified=1 WHERE id=?', owner.id);
    const passwordHash = runtime.repo.get('SELECT password_hash FROM users WHERE id=?', owner.id)!.password_hash;
    const session = (id: string, workspaceId: string, email: string): Account => {
      const token = randomBytes(32).toString('hex');
      runtime.repo.run('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)', hash(token), id, Date.now() + 60_000);
      return { id, workspaceId, email, cookie: `mola_session=${token}` };
    };
    const memberId = randomUUID();
    runtime.repo.run('INSERT INTO users (id,workspace_id,name,email,password_hash,color,role,status,created_at,email_verified) VALUES (?,?,?,?,?,?,?,?,?,?)', memberId, owner.workspaceId, 'Team Member', 'member@admin.test', passwordHash, '#426037', 'member', '', new Date().toISOString(), 1);
    const member = session(memberId, owner.workspaceId, 'member@admin.test');
    const foreignSeed = createWorkspace(runtime.repo, { name: 'Other team', userName: 'Foreign Owner', email: 'foreign@admin.test', passwordHash });
    const adminSeed = createWorkspace(runtime.repo, { name: 'Operator team', userName: 'Site Operator', email: 'admin@admin.test', passwordHash });
    runtime.repo.run('UPDATE users SET email_verified=1 WHERE id IN (?,?)', foreignSeed.userId, adminSeed.userId);
    runtime.repo.run('UPDATE users SET site_admin=1 WHERE id=?', adminSeed.userId);
    const accounts = { owner, member, foreign: session(foreignSeed.userId, foreignSeed.workspaceId, 'foreign@admin.test'), admin: session(adminSeed.userId, adminSeed.workspaceId, 'admin@admin.test') };
    const socket = async (actor: Account) => {
      const client = connect(base, { transports: ['websocket'], forceNew: true, reconnection: false, timeout: 2500, extraHeaders: { Origin: origin, Cookie: actor.cookie } });
      sockets.push(client);
      await new Promise<void>((done, reject) => { client.once('connect', done); client.once('connect_error', reject); });
      return client;
    };
    const upload = async (actor: Account) => {
      const form = new FormData(); form.set('file', new Blob(['retain this member attachment'], { type: 'text/plain' }), 'member.txt');
      const uploaded = await fetch(base + '/api/uploads', { method: 'POST', headers: { Origin: origin, Cookie: actor.cookie }, body: form });
      assert.equal(uploaded.status, 201); return uploaded.json();
    };
    await run({ runtime, accounts, channel: state.channels[0].id, base, directory, request, upload, socket });
  } finally { sockets.forEach(socket => socket.disconnect()); await runtime.close(); await rm(directory, { recursive: true, force: true }); }
}

test('admin boundaries reject ordinary members, foreign workspace mutations, and forged site administrator flags', async () => fixture(async ({ accounts: a, channel, request, runtime }) => {
  assert.equal((await request(null, '/admin/workspace')).status, 401);
  assert.equal((await request(a.member, '/admin/workspace')).status, 403);
  assert.equal((await request(a.owner, '/admin/workspace')).status, 200);
  for (const actor of [a.member, a.owner, a.foreign]) assert.equal((await request(actor, '/admin/system')).status, 403);
  assert.equal((await request(a.admin, '/admin/system')).status, 200);
  for (const [path, body] of [[`/admin/workspace/members/${a.member.id}`, { suspended: true }], [`/admin/workspace/channels/${channel}`, { archived: true }]] as const) assert.equal((await request(a.foreign, path, 'PATCH', body)).status, 404);
  await request(a.member, '/profile', 'PATCH', { name: 'Still Member', role: 'owner', siteAdmin: true, suspended: false });
  assert.equal(runtime.repo.get('SELECT role,site_admin FROM users WHERE id=?', a.member.id)!.role, 'member');
  assert.equal(runtime.repo.get('SELECT site_admin FROM users WHERE id=?', a.member.id)!.site_admin, 0);
  assert.equal((await request(a.member, '/admin/system')).status, 403);
  const system = await (await request(a.admin, '/admin/system')).text();
  for (const secret of ['password_hash', 'token_hash', 'payload', a.owner.cookie]) assert.equal(system.includes(secret), false);
  assert.equal((await request(a.owner, '/admin/workspace', 'PATCH', { name: 'Renamed safely' })).status, 200);
  assert.equal(runtime.repo.workspace(a.owner.workspaceId).name, 'Renamed safely');
  assert.equal(runtime.repo.workspace(a.foreign.workspaceId).name, 'Other team');
}));

test('suspending a member revokes sessions and calls while preserving their messages and files', async () => fixture(async ({ accounts: a, channel, request, upload, socket, runtime }) => {
  const attachment = await upload(a.member);
  const sent = await request(a.member, `/channels/${channel}/messages`, 'POST', { content: 'History stays after suspension', attachmentIds: [attachment.id] });
  assert.equal(sent.status, 201); const message = await sent.json();
  const [ownerSocket, memberSocket] = await Promise.all([socket(a.owner), socket(a.member)]);
  assert.equal((await ownerSocket.timeout(2500).emitWithAck('call:join', { channelId: channel })).ok, true);
  assert.equal((await memberSocket.timeout(2500).emitWithAck('call:join', { channelId: channel })).ok, true);
  const disconnected = new Promise<void>((done, reject) => { const timer = setTimeout(() => reject(new Error('Suspended member socket stayed connected.')), 2500); memberSocket.once('disconnect', () => { clearTimeout(timer); done(); }); });
  const removed = new Promise<void>((done, reject) => { const timer = setTimeout(() => reject(new Error('Suspended member stayed in the call.')), 2500); ownerSocket.on('call:peers', event => { if (event.channelId === channel && !event.peers.some((peer: { user: { id: string } }) => peer.user.id === a.member.id)) { clearTimeout(timer); done(); } }); });
  assert.equal((await request(a.owner, `/admin/workspace/members/${a.member.id}`, 'PATCH', { suspended: true })).status, 200);
  await Promise.all([disconnected, removed]);
  assert.equal((await request(a.member, '/auth/me')).status, 401);
  assert.equal(runtime.repo.get('SELECT COUNT(*) AS count FROM sessions WHERE user_id=?', a.member.id)!.count, 0);
  assert.ok(runtime.repo.get('SELECT suspended_at FROM users WHERE id=?', a.member.id)!.suspended_at);
  assert.equal(runtime.repo.get('SELECT content FROM messages WHERE id=?', message.id)!.content, 'History stays after suspension');
  assert.equal(await (await request(a.owner, attachment.url.replace('/api', ''))).text(), 'retain this member attachment');
  assert.ok([401, 403].includes((await request(null, '/auth/login', 'POST', { email: a.member.email, password })).status));
  assert.equal((await request(a.owner, `/admin/workspace/members/${a.member.id}`, 'PATCH', { suspended: false })).status, 200);
  assert.equal((await request(a.member, '/auth/me')).status, 401, 'un-suspending cannot resurrect an old session');
  assert.equal((await request(null, '/auth/login', 'POST', { email: a.member.email, password })).status, 200);
}));

test('archived channels preserve readable history and reject writes or new calls until restored', async () => fixture(async ({ accounts: a, channel, request, socket }) => {
  const created = await request(a.member, `/channels/${channel}/messages`, 'POST', { content: 'Before archive' });
  const message = await created.json();
  const [memberSocket, ownerSocket] = await Promise.all([socket(a.member), socket(a.owner)]);
  for (const client of [memberSocket, ownerSocket]) assert.equal((await client.timeout(2500).emitWithAck('call:join', { channelId: channel })).ok, true);
  const closures = [memberSocket, ownerSocket].map(client => new Promise<{ channelId: string }>((done, reject) => { const timer = setTimeout(() => reject(new Error('Archived room did not close active call.')), 2500); client.once('call:closed', event => { clearTimeout(timer); done(event); }); }));
  assert.equal((await request(a.owner, `/admin/workspace/channels/${channel}`, 'PATCH', { name: 'Renamed channel', description: 'Read only history', archived: true })).status, 200);
  for (const event of await Promise.all(closures)) assert.equal(event.channelId, channel);
  assert.equal(memberSocket.connected, true); assert.equal(ownerSocket.connected, true);
  const history = await request(a.member, `/channels/${channel}/messages`); assert.equal(history.status, 200);
  assert.ok((await history.json()).messages.some((item: { id: string }) => item.id === message.id));
  assert.ok([403, 409].includes((await request(a.member, `/channels/${channel}/messages`, 'POST', { content: 'Blocked write' })).status));
  assert.ok([403, 409].includes((await request(a.member, `/messages/${message.id}/reactions`, 'POST', { emoji: '👍' })).status));
  assert.equal((await memberSocket.timeout(2500).emitWithAck('call:join', { channelId: channel })).ok, false);
  assert.equal((await request(a.owner, `/admin/workspace/channels/${channel}`, 'PATCH', { archived: false })).status, 200);
  assert.equal((await request(a.member, `/channels/${channel}/messages`, 'POST', { content: 'Restored write' })).status, 201);
  const rejoined = await memberSocket.timeout(2500).emitWithAck('call:join', { channelId: channel });
  assert.equal(rejoined.ok, true); assert.equal(rejoined.peers.length, 1, 'archived room retains no stale call peers');
}));

test('invite revocation keeps an auditable record but prevents registration and hides bearer secrets', async () => fixture(async ({ accounts: a, request, runtime }) => {
  const invitation = await (await request(a.owner, '/invites', 'POST')).json();
  const token = new URL(invitation.url).searchParams.get('invite')!;
  const overview = await (await request(a.owner, '/admin/workspace')).json();
  assert.equal(overview.invites.length, 1); const id = overview.invites[0].id;
  assert.equal(JSON.stringify(overview).includes(token), false);
  assert.equal(JSON.stringify(overview).includes(hash(token)), false);
  assert.equal((await request(a.foreign, `/admin/workspace/invites/${id}`, 'DELETE')).status, 404);
  assert.equal((await request(a.owner, `/admin/workspace/invites/${id}`, 'DELETE')).status, 200);
  const blocked = await request(null, '/auth/register', 'POST', { name: 'Blocked invitee', email: 'revoked@admin.test', password, inviteToken: token });
  assert.equal(blocked.status, 400);
  assert.equal(runtime.repo.get('SELECT id FROM users WHERE email=?', 'revoked@admin.test'), undefined);
  assert.ok(runtime.repo.get('SELECT revoked_at FROM invites WHERE id=?', id)!.revoked_at);
  const updated = await (await request(a.owner, '/admin/workspace')).json();
  assert.equal(updated.invites[0].revoked, true); assert.ok(updated.audit.length > 0);
}));

test('ownership transfer needs the current password and preserves one active owner', async () => fixture(async ({ accounts: a, request, runtime }) => {
  const denied = await request(a.owner, `/admin/workspace/members/${a.owner.id}`, 'PATCH', { suspended: true }); assert.ok([400, 403, 409].includes(denied.status));
  const wrong = await request(a.owner, '/admin/workspace/transfer', 'POST', { userId: a.member.id, currentPassword: 'wrong-password' }); assert.ok([400, 401, 403].includes(wrong.status));
  assert.equal(runtime.repo.get('SELECT role FROM users WHERE id=?', a.owner.id)!.role, 'owner');
  assert.equal((await request(a.owner, '/admin/workspace/transfer', 'POST', { userId: a.foreign.id, currentPassword: password })).status, 404);
  assert.equal((await request(a.owner, '/admin/workspace/transfer', 'POST', { userId: a.member.id, currentPassword: password })).status, 200);
  assert.equal(runtime.repo.get('SELECT role FROM users WHERE id=?', a.owner.id)!.role, 'member');
  assert.equal(runtime.repo.get('SELECT role FROM users WHERE id=?', a.member.id)!.role, 'owner');
  assert.equal(runtime.repo.get("SELECT COUNT(*) AS count FROM users WHERE workspace_id=? AND role='owner' AND suspended_at IS NULL", a.owner.workspaceId)!.count, 1);
  assert.equal((await request(a.owner, '/admin/workspace')).status, 403);
  assert.equal((await request(a.member, '/admin/workspace')).status, 200);
}));

test('site administrators can suspend another workspace without deleting history and cannot disable themselves', async () => fixture(async ({ accounts: a, channel, request, runtime, socket }) => {
  await request(a.member, `/channels/${channel}/messages`, 'POST', { content: 'Workspace suspension retains this' });
  assert.equal((await request(a.owner, `/admin/system/workspaces/${a.foreign.workspaceId}`, 'PATCH', { suspended: true })).status, 403);
  const own = await request(a.admin, `/admin/system/users/${a.admin.id}`, 'PATCH', { suspended: true }); assert.ok([400, 403, 409].includes(own.status));
  assert.equal((await request(a.admin, `/admin/system/workspaces/${a.owner.workspaceId}`, 'PATCH', { suspended: true })).status, 200);
  assert.equal((await request(a.owner, '/auth/me')).status, 401);
  assert.equal((await request(a.member, `/channels/${channel}/messages`)).status, 401);
  assert.ok(runtime.repo.get('SELECT suspended_at FROM workspaces WHERE id=?', a.owner.workspaceId)!.suspended_at);
  assert.equal(runtime.repo.get('SELECT COUNT(*) AS count FROM messages WHERE channel_id=?', channel)!.count, 1);
  assert.equal((await request(a.admin, '/admin/system')).status, 200);
  assert.equal((await request(a.admin, `/admin/system/workspaces/${a.owner.workspaceId}`, 'PATCH', { suspended: false })).status, 200);
  const login = await request(null, '/auth/login', 'POST', { email: a.owner.email, password }); assert.equal(login.status, 200);
  const state = await login.json(); assert.equal(state.workspace.suspended, false);
  assert.equal((await request(a.admin, `/admin/system/workspaces/${a.admin.workspaceId}`, 'PATCH', { suspended: true })).status, 200);
  const restricted = await request(a.admin, '/auth/me'); assert.equal(restricted.status, 200);
  const restrictedState = await restricted.json(); assert.deepEqual(restrictedState.channels, []); assert.deepEqual(restrictedState.members, []);
  assert.equal((await request(a.admin, '/admin/workspace')).status, 403);
  const adminChannel = runtime.repo.get('SELECT id FROM channels WHERE workspace_id=? LIMIT 1', a.admin.workspaceId)!.id;
  assert.equal((await request(a.admin, `/channels/${adminChannel}/messages`)).status, 403);
  await assert.rejects(socket(a.admin));
  assert.equal((await request(a.admin, '/admin/system')).status, 200, 'operator keeps a recovery path when their own workspace is paused');
  assert.equal((await request(a.admin, `/admin/system/workspaces/${a.admin.workspaceId}`, 'PATCH', { suspended: false })).status, 200);
}));

test('suspension during an in-flight multipart upload prevents both database rows and physical files', { timeout: 10000 }, async () => fixture(async ({ accounts: a, runtime, base, directory, request }) => {
  const boundary = `admin-upload-${randomUUID()}`;
  let upload: ClientRequest | undefined;
  let firstChunk!: () => void;
  const received = new Promise<void>(done => { firstChunk = done; });
  const observe = (req: import('node:http').IncomingMessage) => { if (req.url?.endsWith('/uploads')) req.once('readable', firstChunk); };
  runtime.server.on('request', observe);
  try {
    const completed = new Promise<number>((done, reject) => {
      upload = httpRequest(base + '/api/uploads', { method: 'POST', headers: { Origin: origin, Cookie: a.member.cookie, 'Content-Type': `multipart/form-data; boundary=${boundary}` } }, response => { response.resume(); response.once('end', () => done(response.statusCode!)); });
      upload.once('error', reject);
      upload.write(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="paused-upload.txt"\r\nContent-Type: text/plain\r\n\r\nfirst chunk`);
    });
    await received;
    assert.equal((await request(a.owner, `/admin/workspace/members/${a.member.id}`, 'PATCH', { suspended: true })).status, 200);
    upload!.end(` last chunk\r\n--${boundary}--\r\n`);
    assert.ok([401, 403].includes(await completed));
    assert.equal(runtime.repo.get('SELECT COUNT(*) AS count FROM attachments WHERE user_id=?', a.member.id)!.count, 0);
    assert.deepEqual(await readdir(join(directory, 'uploads')), []);
  } finally { runtime.server.off('request', observe); upload?.destroy(); }
}));

test('operator CLI requires eligible real accounts, preserves a last administrator and revokes affected sessions', async () => fixture(async ({ accounts: a, runtime, directory, socket, request }) => {
  const database = join(directory, 'mola.sqlite');
  assert.throws(() => manageSiteAdmin(join(directory, 'missing.sqlite'), 'grant', a.member.email), /Veritabanı/);
  await assert.rejects(readdir(join(directory, 'missing.sqlite')), { code: 'ENOENT' });
  assert.throws(() => manageSiteAdmin(database, 'grant', 'missing@admin.test'), /gerçek bir hesap/);
  runtime.repo.run('UPDATE users SET email_verified=0 WHERE id=?', a.foreign.id);
  assert.throws(() => manageSiteAdmin(database, 'grant', a.foreign.email), /gerçek bir hesap/);
  runtime.repo.run('UPDATE users SET email_verified=1,suspended_at=? WHERE id=?', new Date().toISOString(), a.foreign.id);
  assert.throws(() => manageSiteAdmin(database, 'grant', a.foreign.email), /gerçek bir hesap/);
  runtime.repo.run('UPDATE users SET suspended_at=NULL,password_hash=NULL WHERE id=?', a.foreign.id);
  assert.throws(() => manageSiteAdmin(database, 'grant', a.foreign.email), /gerçek bir hesap/);
  const demo = createWorkspace(runtime.repo, { name: 'Demo forbidden', userName: 'Demo Owner', email: 'demo-cli@admin.test', passwordHash: runtime.repo.get('SELECT password_hash FROM users WHERE id=?', a.owner.id)!.password_hash, demo: true });
  assert.throws(() => manageSiteAdmin(database, 'grant', 'demo-cli@admin.test'), /gerçek bir hesap/);
  assert.equal(runtime.repo.get('SELECT site_admin FROM users WHERE id=?', demo.userId)!.site_admin, 0);
  assert.throws(() => manageSiteAdmin(database, 'revoke', a.admin.email), /Son uygulama yöneticisi/);
  const memberSocket = await socket(a.member);
  const disconnected = new Promise<void>((done, reject) => { const timer = setTimeout(() => reject(new Error('CLI session revocation did not close socket within seven seconds.')), 7000); memberSocket.once('disconnect', () => { clearTimeout(timer); done(); }); });
  assert.equal(manageSiteAdmin(database, 'grant', a.member.email.toUpperCase()).granted, true);
  assert.equal((await request(a.member, '/auth/me')).status, 401);
  await disconnected;
  assert.equal(runtime.repo.get('SELECT site_admin FROM users WHERE id=?', a.member.id)!.site_admin, 1);
  assert.equal(manageSiteAdmin(database, 'revoke', a.admin.email).granted, false);
  assert.equal((await request(a.admin, '/auth/me')).status, 401);
  assert.throws(() => manageSiteAdmin(database, 'revoke', a.member.email), /Son uygulama yöneticisi/);
  assert.equal(runtime.repo.get('SELECT COUNT(*) AS count FROM audit_events WHERE action IN (?,?)', 'site_admin.granted', 'site_admin.revoked')!.count, 2);
  assert.equal(JSON.stringify(runtime.repo.all('SELECT * FROM audit_events')).includes(password), false);
}));
