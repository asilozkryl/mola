import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { createApp } from '../server/app.js';
import { createWorkspace } from '../server/seed.js';
import { getRtcConfig } from '../server/calls.js';

const origin = 'http://mola.test';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
let runtime: ReturnType<typeof createApp>;
let directory: string;
let base: string;
const users: Record<string, { id: string; cookie: string }> = {};
let workspace: string;
let channel: string;
let dm: string;
let message: string;
let dmMessage: string;
let privateFile: string;
let unpublishedFile: string;

async function api(path: string, options: { user?: string; method?: string; body?: unknown; origin?: string | null; cookie?: string } = {}) {
  const headers: Record<string, string> = {};
  const suppliedOrigin = options.origin === undefined ? origin : options.origin;
  if (suppliedOrigin) headers.Origin = suppliedOrigin;
  if (options.cookie || options.user) headers.Cookie = options.cookie || users[options.user!].cookie;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`${base}/api${path}`, { method: options.method || 'GET', headers, ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}) });
}

function session(name: string, id: string, expiresAt = Date.now() + 60_000) {
  const token = randomBytes(32).toString('hex');
  runtime.repo.run('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)', digest(token), id, expiresAt);
  users[name] = { id, cookie: `mola_session=${token}` };
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mola-security-'));
  runtime = createApp({ databasePath: join(directory, 'mola.sqlite'), uploadDir: join(directory, 'uploads'), appOrigin: origin, production: false });
  const alice = createWorkspace(runtime.repo, { name: 'Alpha', userName: 'Alice', email: 'alice@example.invalid', passwordHash: null });
  const eve = createWorkspace(runtime.repo, { name: 'Other workspace', userName: 'Eve', email: 'eve@example.invalid', passwordHash: null });
  workspace = alice.workspaceId;
  session('alice', alice.userId);
  session('eve', eve.userId);
  for (const name of ['bob', 'charlie']) {
    const id = randomUUID();
    runtime.repo.run('INSERT INTO users (id,workspace_id,name,email,password_hash,color,role,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)', id, workspace, name, `${name}@example.invalid`, null, '#abcdef', 'member', '', new Date().toISOString());
    session(name, id);
  }
  channel = runtime.repo.get("SELECT id FROM channels WHERE workspace_id=? AND kind='text' LIMIT 1", workspace)!.id;
  dm = randomUUID();
  runtime.repo.run('INSERT INTO channels (id,workspace_id,name,description,kind,created_at) VALUES (?,?,?,?,?,?)', dm, workspace, 'Private DM', '', 'dm', new Date().toISOString());
  for (const name of ['alice', 'bob']) runtime.repo.run('INSERT INTO channel_members VALUES (?,?)', dm, users[name].id);
  message = randomUUID(); dmMessage = randomUUID();
  for (const [id, channelId, content] of [[message, channel, 'workspace-secret-marker'], [dmMessage, dm, 'dm-secret-marker']]) {
    runtime.repo.run('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)', id, channelId, users.alice.id, content, new Date().toISOString(), null, null, 0);
  }
  for (const isPublished of [true, false]) {
    const id = randomUUID();
    await writeFile(join(directory, 'uploads', `${id}.bin`), 'private attachment');
    runtime.repo.run('INSERT INTO attachments VALUES (?,?,?,?,?,?,?,?,?)', id, workspace, users.alice.id, isPublished ? dmMessage : null, 'notes.txt', 18, 'text/plain', `${id}.bin`, new Date().toISOString());
    if (isPublished) privateFile = id; else unpublishedFile = id;
  }
  await new Promise<void>(done => runtime.server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
});

after(async () => {
  await runtime?.close();
  if (directory) {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + '\\') || resolve(directory).startsWith(resolve(tmpdir()) + '/'));
    assert.ok(directory.includes('mola-security-'));
    await rm(directory, { recursive: true, force: true });
  }
});

test('mutations require an allowed Origin even with a valid session', async () => {
  for (const suppliedOrigin of [null, 'https://evil.example', `${origin}.evil.example`]) {
    const result = await api(`/channels/${channel}/messages`, { user: 'alice', method: 'POST', body: { content: 'forged mutation' }, origin: suppliedOrigin });
    assert.equal(result.status, 403);
  }
  assert.equal(runtime.repo.get('SELECT count(*) AS n FROM messages WHERE content=?', 'forged mutation')!.n, 0);
});

test('unauthenticated, malformed and expired sessions cannot bootstrap', async () => {
  const expired = randomBytes(32).toString('hex');
  runtime.repo.run('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)', digest(expired), users.alice.id, Date.now() - 1000);
  for (const cookie of ['', 'mola_session=../../data.sqlite', `mola_session=${expired}`, `mola_session=${randomBytes(32).toString('hex')}`]) {
    assert.equal((await api('/auth/me', { cookie })).status, 401);
  }
});

test('cross-workspace access is rejected for messages, edits, reactions, threads, DMs and files', async () => {
  const requests: [string, string, unknown?][] = [
    [`/channels/${channel}/messages`, 'GET'],
    [`/channels/${channel}/messages`, 'POST', { content: 'intrusion' }],
    [`/channels/${channel}/messages?parentId=${message}`, 'GET'],
    [`/channels/${channel}/pins`, 'GET'],
    [`/channels/${channel}/files`, 'GET'],
    [`/messages/${message}`, 'GET'],
    [`/messages/${message}`, 'PATCH', { content: 'intrusion' }],
    [`/messages/${message}`, 'DELETE'],
    [`/messages/${message}/reactions`, 'POST', { emoji: '👍' }],
    [`/files/${privateFile}`, 'GET'],
  ];
  for (const [path, method, body] of requests) assert.equal((await api(path, { user: 'eve', method, body })).status, 404, `${method} ${path}`);
  assert.equal((await api('/dms', { user: 'eve', method: 'POST', body: { userId: users.alice.id } })).status, 400);
  const results = await (await api('/search?q=secret-marker', { user: 'eve' })).json();
  assert.deepEqual(results.messages, []);
});

test('a workspace member cannot discover or access another pair’s DM', async () => {
  const bootstrap = await (await api('/auth/me', { user: 'charlie' })).json();
  assert.equal(bootstrap.channels.some((entry: { id: string }) => entry.id === dm), false);
  for (const path of [`/channels/${dm}/messages`, `/channels/${dm}/pins`, `/channels/${dm}/files`, `/messages/${dmMessage}`, `/files/${privateFile}`]) assert.equal((await api(path, { user: 'charlie' })).status, 404);
  assert.equal((await api(`/messages/${dmMessage}/reactions`, { user: 'charlie', method: 'POST', body: { emoji: '👀' } })).status, 404);
  const search = await (await api('/search?q=dm-secret-marker', { user: 'charlie' })).json();
  assert.deepEqual(search.messages, []);
  assert.equal((await api(`/channels/${dm}/messages`, { user: 'bob' })).status, 200);
  assert.equal((await api(`/files/${privateFile}`, { user: 'bob' })).status, 200);
});

test('unpublished uploads are private and cannot be claimed by another member', async () => {
  assert.equal((await api(`/files/${unpublishedFile}`, { user: 'alice' })).status, 200);
  assert.equal((await api(`/files/${unpublishedFile}`, { user: 'bob' })).status, 404);
  const denied = await api(`/channels/${channel}/messages`, { user: 'bob', method: 'POST', body: { content: 'stolen file', attachmentIds: [unpublishedFile] } });
  assert.equal(denied.status, 409); assert.equal((await denied.json()).code, 'ATTACHMENT_UNAVAILABLE');
  assert.equal(runtime.repo.get('SELECT message_id FROM attachments WHERE id=?', unpublishedFile)!.message_id, null);
});

test('members cannot modify another member’s message or grant themselves owner rights', async () => {
  assert.equal((await api(`/messages/${message}`, { user: 'bob', method: 'PATCH', body: { content: 'edited' } })).status, 403);
  assert.equal((await api(`/messages/${message}`, { user: 'bob', method: 'DELETE' })).status, 403);
  assert.equal((await api('/invites', { user: 'bob', method: 'POST' })).status, 403);
  await api('/profile', { user: 'bob', method: 'PATCH', body: { name: 'Bob renamed', role: 'owner', workspaceId: 'another-workspace' } });
  const bob = runtime.repo.get('SELECT * FROM users WHERE id=?', users.bob.id)!;
  assert.equal(bob.role, 'member');
  assert.equal(bob.workspace_id, workspace);
  assert.equal(runtime.repo.get('SELECT content FROM messages WHERE id=?', message)!.content, 'workspace-secret-marker');
});

test('invites are hashed, scoped to their workspace, and reject expiration and exhaustion', async () => {
  const created = await api('/invites', { user: 'alice', method: 'POST' });
  assert.equal(created.status, 201);
  const invitation = await created.json();
  const token = new URL(invitation.url).searchParams.get('invite')!;
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(runtime.repo.get('SELECT workspace_id FROM invites WHERE token_hash=?', digest(token))!.workspace_id, workspace);
  assert.equal(runtime.repo.get('SELECT token_hash FROM invites WHERE token_hash=?', token), undefined);
  const response = await api('/auth/register', { method: 'POST', body: { name: 'Invited member', email: 'invitee@example.invalid', password: 'a-strong-invite-password', inviteToken: token, workspaceName: 'Attacker chosen workspace', role: 'owner' } });
  assert.equal(response.status, 200);
  const joined = await response.json();
  assert.equal(joined.workspace.id, workspace);
  assert.equal(joined.user.role, 'member');
  assert.equal(runtime.repo.get('SELECT uses FROM invites WHERE token_hash=?', digest(token))!.uses, 1);
  const cookie = response.headers.get('set-cookie')!;
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  const memberInvite = await api('/invites', { method: 'POST', cookie: cookie.split(';')[0] });
  assert.equal(memberInvite.status, 403);
  runtime.repo.run('UPDATE invites SET uses=max_uses WHERE token_hash=?', digest(token));
  assert.equal((await api('/auth/register', { method: 'POST', body: { name: 'Cannot join', email: 'exhausted@example.invalid', password: 'a-strong-invite-password', inviteToken: token } })).status, 400);
  runtime.repo.run('UPDATE invites SET uses=0,expires_at=? WHERE token_hash=?', Date.now() - 1, digest(token));
  assert.equal((await api('/auth/register', { method: 'POST', body: { name: 'Cannot join', email: 'expired@example.invalid', password: 'a-strong-invite-password', inviteToken: token } })).status, 400);
  assert.equal(runtime.repo.get('SELECT id FROM users WHERE email=?', 'expired@example.invalid'), undefined);
});

test('file downloads are isolated documents and bootstrap never exposes password or session hashes', async () => {
  const response = await api(`/files/${privateFile}`, { user: 'alice' });
  assert.match(response.headers.get('content-disposition')!, /^attachment;/);
  assert.match(response.headers.get('content-security-policy')!, /sandbox/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const bootstrap = await (await api('/auth/me', { user: 'alice' })).text();
  for (const forbidden of ['password_hash', 'token_hash', 'storage_name', users.alice.cookie]) assert.equal(bootstrap.includes(forbidden), false);
});

async function socketFor(name: string, socketOrigin = origin): Promise<Socket> {
  const socket = connect(base, { transports: ['websocket'], forceNew: true, reconnection: false, timeout: 2000, extraHeaders: { Origin: socketOrigin, Cookie: users[name].cookie } });
  return await new Promise<Socket>((done, reject) => {
    socket.once('connect', () => done(socket));
    socket.once('connect_error', error => { socket.disconnect(); reject(error); });
  });
}

test('Socket.IO rejects foreign origins, scopes DM events and prevents unauthorized call joins', async () => {
  await assert.rejects(socketFor('alice', 'https://evil.example'));
  const sockets = await Promise.all(['alice', 'bob', 'charlie', 'eve'].map(name => socketFor(name)));
  try {
    const [alice, bob, charlie, eve] = sockets;
    for (const socket of [charlie, eve]) {
      const result = await socket.timeout(2000).emitWithAck('call:join', { channelId: dm });
      assert.equal(result.ok, false);
    }
    const forbiddenEvents: unknown[] = [];
    charlie.on('message:created', event => forbiddenEvents.push(event));
    eve.on('message:created', event => forbiddenEvents.push(event));
    const received = new Promise<any>(done => bob.once('message:created', done));
    const sent = await api(`/channels/${dm}/messages`, { user: 'alice', method: 'POST', body: { content: 'only the private pair receives this' } });
    assert.equal(sent.status, 201);
    assert.equal((await Promise.race([received, new Promise((_, reject) => setTimeout(() => reject(new Error('Expected private message delivery')), 2000))])).channelId, dm);
    await new Promise(done => setTimeout(done, 150));
    assert.deepEqual(forbiddenEvents, []);

    assert.equal((await alice.timeout(2000).emitWithAck('call:join', { channelId: dm })).ok, true);
    assert.equal((await bob.timeout(2000).emitWithAck('call:join', { channelId: channel })).ok, true);
    const leakedSignals: unknown[] = [];
    bob.on('call:signal', signal => leakedSignals.push(signal));
    alice.emit('call:signal', { to: bob.id, description: { type: 'offer', sdp: 'must not cross room boundaries' } });
    await new Promise(done => setTimeout(done, 150));
    assert.deepEqual(leakedSignals, []);
    assert.equal((await bob.timeout(2000).emitWithAck('call:join', { channelId: dm })).ok, true);
    alice.emit('call:signal', { to: bob.id, description: { type: { toString: null, valueOf: null }, sdp: 'malformed type' } });
    await new Promise(done => setTimeout(done, 100));
    assert.deepEqual(leakedSignals, []);
    assert.equal((await api('/health')).status, 200);
    const forwarded = new Promise<any>(done => bob.once('call:signal', done));
    alice.emit('call:signal', { to: bob.id, description: { type: 'offer', sdp: 'valid same-room offer' } });
    const forwardedSignal = await Promise.race([forwarded, new Promise((_, reject) => setTimeout(() => reject(new Error('Valid signal was not forwarded')), 2000))]);
    assert.equal(forwardedSignal.description.sdp, 'valid same-room offer');
    assert.equal(forwardedSignal.from, alice.id);
  } finally { sockets.forEach(socket => socket.disconnect()); }
});

test('calls enforce the six connection room limit and release capacity after leaving', async () => {
  const sockets = await Promise.all(Array.from({ length: 7 }, () => socketFor('alice')));
  try {
    for (const socket of sockets.slice(0, 6)) assert.equal((await socket.timeout(2000).emitWithAck('call:join', { channelId: channel })).ok, true);
    assert.equal((await sockets[6].timeout(2000).emitWithAck('call:join', { channelId: channel })).ok, false);
    sockets[0].emit('call:leave');
    await new Promise(done => setTimeout(done, 100));
    assert.equal((await sockets[6].timeout(2000).emitWithAck('call:join', { channelId: channel })).ok, true);
  } finally { sockets.forEach(socket => socket.disconnect()); }
});

test('TURN credentials expire, match the shared-secret HMAC, and never expose that secret', () => {
  const previousUrls = process.env.TURN_URLS;
  const previousSecret = process.env.TURN_SECRET;
  try {
    process.env.TURN_URLS = 'turn:turn.example.com:3478, turns:turn.example.com:5349';
    process.env.TURN_SECRET = randomBytes(48).toString('hex');
    const configuration = getRtcConfig();
    assert.equal(configuration.relayConfigured, true);
    const relay = configuration.iceServers.find(entry => entry.username)!;
    const expiration = Number(relay.username!.split(':')[0]);
    const now = Math.floor(Date.now() / 1000);
    assert.ok(expiration >= now + 3598 && expiration <= now + 3601);
    assert.equal(relay.credential, createHmac('sha1', process.env.TURN_SECRET).update(relay.username!).digest('base64'));
    assert.equal(JSON.stringify(configuration).includes(process.env.TURN_SECRET), false);
    assert.notEqual(getRtcConfig().iceServers.find(entry => entry.username)!.username, relay.username);
  } finally {
    if (previousUrls === undefined) delete process.env.TURN_URLS; else process.env.TURN_URLS = previousUrls;
    if (previousSecret === undefined) delete process.env.TURN_SECRET; else process.env.TURN_SECRET = previousSecret;
  }
});

test('production rejects insecure origins and uses secure opaque session cookies', async () => {
  assert.throws(() => createApp({ production: true, appOrigin: 'http://public.example' }), /HTTPS/);
  const previousUrls = process.env.TURN_URLS;
  const previousSecret = process.env.TURN_SECRET;
  let production: ReturnType<typeof createApp> | undefined;
  try {
    process.env.TURN_URLS = 'turn:turn.example.com:3478';
    process.env.TURN_SECRET = randomBytes(48).toString('hex');
    production = createApp({ production: true, appOrigin: 'https://mola.test', databasePath: join(directory, 'production.sqlite'), uploadDir: join(directory, 'production-uploads'), mailEncryptionKey: 'a'.repeat(64), mailTransport: async () => {} });
    await new Promise<void>(done => production!.server.listen(0, '127.0.0.1', done));
    const port = (production.server.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: 'POST', headers: { Origin: 'https://mola.test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Production user', email: 'production@example.invalid', password: 'unique-production-test-password', workspaceName: 'Production test' }),
    });
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie')!;
    assert.match(cookie, /; Secure/i);
    assert.match(cookie, /; HttpOnly/i);
    assert.match(cookie, /; SameSite=Lax/i);
    const raw = cookie.split(';')[0].split('=')[1];
    assert.match(raw, /^[a-f0-9]{64}$/);
    assert.equal(production.repo.get('SELECT count(*) AS n FROM sessions WHERE token_hash=?', raw)!.n, 0);
    assert.equal(production.repo.get('SELECT count(*) AS n FROM sessions WHERE token_hash=?', digest(raw))!.n, 1);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally {
    await production?.close();
    if (previousUrls === undefined) delete process.env.TURN_URLS; else process.env.TURN_URLS = previousUrls;
    if (previousSecret === undefined) delete process.env.TURN_SECRET; else process.env.TURN_SECRET = previousSecret;
  }
});
