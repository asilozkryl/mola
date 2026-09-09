import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { createApp } from '../server/app.js';
import { createWorkspace } from '../server/seed.js';
import type { WorkspaceRole } from '../shared/types.js';

type Session = { id: string; workspaceId: string; cookie: string; hash: string };
const origin = 'http://channel-deletion.test';
async function fixture(run: (context: {
  runtime: ReturnType<typeof createApp>; directory: string; owner: Session; admin: Session; moderator: Session; member: Session; guest: Session; foreign: Session;
  request: (actor: Session | null, path: string, method?: string, body?: unknown) => Promise<Response>;
  channel: (name: string, kind?: 'text' | 'voice' | 'dm', visibility?: 'public' | 'private') => string;
  upload: (actor: Session, content: string) => Promise<{ id: string; url: string }>;
  socket: (actor: Session) => Promise<Socket>;
}) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'mola-channel-deletion-'));
  const runtime = createApp({ dataDir: directory, production: false, appOrigin: origin, requireEmailVerification: false, mailTransport: async () => {}, mailEncryptionKey: '6'.repeat(64) });
  const sockets: Socket[] = [];
  await new Promise<void>(done => runtime.server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
  const seed = createWorkspace(runtime.repo, { name: 'Deletion tests', userName: 'Owner', email: 'owner@delete.test', passwordHash: null });
  const other = createWorkspace(runtime.repo, { name: 'Retained team', userName: 'Foreign owner', email: 'foreign@delete.test', passwordHash: null });
  const account = (role: WorkspaceRole, workspaceId = seed.workspaceId, existingId?: string): Session => {
    const id = existingId ?? randomUUID();
    if (!existingId) {
      runtime.repo.run('INSERT INTO users(id,workspace_id,name,email,color,role,created_at) VALUES (?,?,?,?,?,?,?)', id, workspaceId, role, `${id}@delete.test`, '#abcdef', 'member', new Date().toISOString());
      runtime.repo.run('UPDATE workspace_members SET role=? WHERE user_id=? AND workspace_id=?', role, id, workspaceId);
    }
    runtime.repo.run('UPDATE users SET email_verified=1 WHERE id=?', id);
    const token = randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(token).digest('hex');
    runtime.repo.run('INSERT INTO sessions(token_hash,user_id,workspace_id,expires_at) VALUES (?,?,?,?)', hash, id, workspaceId, Date.now() + 600_000);
    return { id, workspaceId, hash, cookie: `mola_session=${token}` };
  };
  const request = (actor: Session | null, path: string, method = 'GET', body?: unknown) => fetch(base + '/api' + path, { method, headers: { Origin: origin, ...(actor ? { Cookie: actor.cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const channel = (name: string, kind: 'text' | 'voice' | 'dm' = 'text', visibility: 'public' | 'private' = 'public') => {
    const id = randomUUID();
    runtime.repo.run('INSERT INTO channels(id,workspace_id,name,kind,visibility,created_at) VALUES (?,?,?,?,?,?)', id, seed.workspaceId, name, kind, visibility, new Date().toISOString());
    return id;
  };
  const upload = async (actor: Session, content: string) => {
    const form = new FormData(); form.set('file', new Blob([content], { type: 'text/plain' }), 'document.txt');
    const response = await fetch(base + '/api/uploads', { method: 'POST', headers: { Origin: origin, Cookie: actor.cookie }, body: form });
    assert.equal(response.status, 201); return response.json();
  };
  const socket = async (actor: Session) => {
    const client = connect(base, { transports: ['websocket'], forceNew: true, reconnection: false, timeout: 2500, extraHeaders: { Origin: origin, Cookie: actor.cookie } });
    sockets.push(client);
    await new Promise<void>((done, reject) => { client.once('connect', done); client.once('connect_error', reject); });
    return client;
  };
  try {
    await run({ runtime, directory, owner: account('owner', seed.workspaceId, seed.userId), admin: account('admin'), moderator: account('moderator'), member: account('member'), guest: account('guest'), foreign: account('owner', other.workspaceId, other.userId), request, channel, upload, socket });
  } finally {
    sockets.forEach(client => client.disconnect()); await runtime.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory, { recursive: true, force: true });
  }
}

test('channel deletion requires exact confirmation, current workspace scope and channel management permission', async () => fixture(async ({ runtime, owner, admin, moderator, member, guest, foreign, channel, request }) => {
  const id = channel('Exact channel'); const path = `/admin/workspace/channels/${id}`;
  assert.equal((await request(null, path, 'DELETE', { confirmName: 'Exact channel' })).status, 401);
  for (const body of [{}, { confirmName: '' }, { confirmName: 'exact channel' }, { confirmName: ' Exact channel ' }, { confirmName: 'Exact channel', force: true }]) assert.equal((await request(owner, path, 'DELETE', body)).status, 400);
  for (const actor of [member, guest]) assert.equal((await request(actor, path, 'DELETE', { confirmName: 'Exact channel' })).status, 403);
  assert.equal((await request(foreign, path, 'DELETE', { confirmName: 'Exact channel' })).status, 404);
  assert.equal((await request(owner, '/admin/workspace/channels/not-an-id', 'DELETE', { confirmName: 'Exact channel' })).status, 404);
  const dm = channel('Direct conversation', 'dm', 'private');
  assert.equal((await request(owner, `/admin/workspace/channels/${dm}`, 'DELETE', { confirmName: 'Direct conversation' })).status, 404);
  assert.ok(runtime.repo.get('SELECT id FROM channels WHERE id=?', id));
  assert.equal(runtime.repo.get("SELECT count(*) AS n FROM audit_events WHERE action='channel.deleted'")!.n, 0);

  const privateId = channel('Private channel', 'text', 'private');
  runtime.repo.run('INSERT INTO channel_members VALUES (?,?)', privateId, moderator.id);
  assert.equal((await request(moderator, `/admin/workspace/channels/${privateId}`, 'DELETE', { confirmName: 'Private channel' })).status, 403);
  assert.equal((await request(owner, `/admin/workspace/channels/${privateId}`, 'DELETE', { confirmName: 'Private channel' })).status, 204, 'owners retain metadata administration for private channels');
  assert.equal((await request(moderator, path, 'DELETE', { confirmName: 'Exact channel' })).status, 204);
  const archived = channel('Archived room');
  runtime.repo.run('UPDATE channels SET archived_at=? WHERE id=?', new Date().toISOString(), archived);
  assert.equal((await request(admin, `/admin/workspace/channels/${archived}`, 'DELETE', { confirmName: 'Archived room' })).status, 204);
  assert.equal((await request(owner, path, 'DELETE', { confirmName: 'Exact channel' })).status, 404, 'repeat deletion cannot create another audit event');
  assert.ok(runtime.repo.get('SELECT id FROM channels WHERE id=?', dm));
  assert.equal(runtime.repo.get("SELECT count(*) AS n FROM audit_events WHERE action='channel.deleted'")!.n, 3);
}));

test('deletion cascades channel history and queued work, removes attached files and preserves unrelated content', async () => fixture(async ({ runtime, directory, owner, member, foreign, channel, request, upload }) => {
  const id = channel('Remove history'); const retained = channel('Retained channel'); const now = new Date().toISOString();
  const [file, replyFile, keepFile, pendingFile] = await Promise.all([upload(owner, 'remove parent'), upload(owner, 'remove reply'), upload(owner, 'keep unrelated'), upload(owner, 'keep pending upload')]);
  const send = async (target: string, body: unknown) => { const response = await request(owner, `/channels/${target}/messages`, 'POST', body); assert.equal(response.status, 201); return response.json(); };
  const parent = await send(id, { content: 'Deleted parent', attachmentIds: [file.id] });
  const reply = await send(id, { content: 'Deleted reply', parentId: parent.id, attachmentIds: [replyFile.id] });
  const keep = await send(retained, { content: 'Retained message', attachmentIds: [keepFile.id] });
  runtime.repo.run('INSERT INTO channel_members VALUES (?,?)', id, member.id);
  runtime.repo.run('INSERT INTO reactions VALUES (?,?,?)', reply.id, member.id, '👍');
  runtime.repo.run('INSERT OR REPLACE INTO channel_reads VALUES (?,?,?,?)', member.id, id, 0, now);
  runtime.repo.run('INSERT INTO message_drafts VALUES (?,?,?,?,?,?)', owner.id, id, '', 'Root draft', 1, now);
  runtime.repo.run('INSERT INTO message_drafts VALUES (?,?,?,?,?,?)', member.id, id, parent.id, 'Thread draft', 1, now);
  runtime.repo.run('INSERT INTO message_drafts VALUES (?,?,?,?,?,?)', owner.id, retained, '', 'Keep this draft', 1, now);
  const notificationId = randomUUID(); const subscriptionId = randomUUID();
  runtime.repo.run('INSERT INTO notifications VALUES (?,?,?,?,?,?,?,?)', notificationId, member.id, owner.workspaceId, id, reply.id, 'mention', now, null);
  runtime.repo.run('INSERT INTO push_subscriptions VALUES (?,?,?,?,?,?,?)', subscriptionId, member.id, member.hash, `https://updates.push.services.mozilla.com/wpush/v2/${randomUUID()}`, 'key', 'auth', now);
  runtime.repo.run('INSERT INTO push_outbox(id,notification_id,subscription_id,attempts,next_attempt) VALUES (?,?,?,?,?)', randomUUID(), notificationId, subscriptionId, 0, Date.now() + 600_000);
  const createdIntegration = await request(owner, '/integrations', 'POST', { channelId: id, name: 'Channel bot', kind: 'webhook' });
  assert.equal(createdIntegration.status, 201);
  const integration = await createdIntegration.json();
  const botId = runtime.repo.get('SELECT bot_user_id FROM integrations WHERE id=?', integration.id)!.bot_user_id;
  runtime.repo.run('INSERT INTO integration_deliveries VALUES (?,?,?,?)', integration.id, 'test-delivery', parent.id, now);
  const retainedBotMessage = randomUUID();
  runtime.repo.run('INSERT INTO messages(id,channel_id,user_id,content,created_at) VALUES (?,?,?,?,?)', retainedBotMessage, retained, botId, 'Historical bot content elsewhere', now);
  const foreignChannel = runtime.repo.get('SELECT id FROM channels WHERE workspace_id=? LIMIT 1', foreign.workspaceId)!.id;
  const foreignMessage = randomUUID();
  runtime.repo.run('INSERT INTO messages(id,channel_id,user_id,content,created_at) VALUES (?,?,?,?,?)', foreignMessage, foreignChannel, foreign.id, 'Other workspace history', now);

  assert.equal((await request(owner, `/admin/workspace/channels/${id}`, 'DELETE', { confirmName: 'Remove history' })).status, 204);
  for (const table of ['channel_members', 'channel_reads', 'messages', 'message_drafts', 'notifications', 'integrations']) assert.equal(runtime.repo.get(`SELECT count(*) AS n FROM ${table} WHERE channel_id=?`, id)!.n, 0, `${table} is cleaned`);
  for (const table of ['attachments', 'reactions', 'message_order']) assert.equal(runtime.repo.get(`SELECT count(*) AS n FROM ${table} WHERE message_id IN (?,?)`, parent.id, reply.id)!.n, 0, `${table} is cleaned`);
  assert.equal(runtime.repo.get('SELECT count(*) AS n FROM push_outbox WHERE notification_id=?', notificationId)!.n, 0);
  assert.equal(runtime.repo.get('SELECT count(*) AS n FROM integration_deliveries WHERE integration_id=?', integration.id)!.n, 0);
  assert.equal(runtime.repo.get('SELECT count(*) AS n FROM bot_accounts WHERE integration_id=?', integration.id)!.n, 0);
  assert.equal(runtime.repo.get('SELECT id FROM channels WHERE id=?', id), undefined);
  assert.equal((await request(owner, file.url.replace('/api', ''))).status, 404);
  assert.deepEqual((await readdir(join(directory, 'uploads'))).sort(), [`${keepFile.id}.bin`, `${pendingFile.id}.bin`].sort());
  assert.equal(await (await request(owner, keepFile.url.replace('/api', ''))).text(), 'keep unrelated');
  assert.ok(runtime.repo.get('SELECT id FROM messages WHERE id=?', keep.id));
  assert.ok(runtime.repo.get('SELECT id FROM messages WHERE id=?', retainedBotMessage), 'do not cascade account deletion into another channel');
  assert.ok(runtime.repo.get('SELECT id FROM messages WHERE id=?', foreignMessage));
  assert.ok(runtime.repo.get('SELECT content FROM message_drafts WHERE channel_id=?', retained));
  assert.ok(runtime.repo.get('SELECT id FROM push_subscriptions WHERE id=?', subscriptionId));
  assert.deepEqual(runtime.repo.all('PRAGMA foreign_key_check'), []);
  const audit = runtime.repo.get("SELECT * FROM audit_events WHERE action='channel.deleted' AND target_id=?", id)!;
  assert.equal(audit.actor_id, owner.id); assert.equal(audit.workspace_id, owner.workspaceId); assert.equal(audit.target_type, 'channel');
}));

test('deleting a voice channel ends active calls and removes subscriptions while other chat connections remain usable', async () => fixture(async ({ runtime, owner, member, channel, request, socket }) => {
  const id = channel('Voice room', 'voice'); const retained = channel('Continue here');
  const clients = await Promise.all([socket(owner), socket(member)]);
  for (const client of clients) assert.equal((await client.timeout(2500).emitWithAck('call:join', { channelId: id })).ok, true);
  const event = (client: Socket, name: string) => new Promise<any>((done, reject) => {
    const timer = setTimeout(() => reject(new Error(`Missing ${name}`)), 2500);
    client.once(name, payload => { clearTimeout(timer); done(payload); });
  });
  const closed = clients.map(client => event(client, 'call:closed'));
  const refreshed = clients.map(client => event(client, 'admin:refresh'));
  assert.equal((await request(owner, `/admin/workspace/channels/${id}`, 'DELETE', { confirmName: 'Voice room' })).status, 204);
  for (const payload of await Promise.all(closed)) { assert.equal(payload.channelId, id); assert.match(payload.error, /silindi/); }
  await Promise.all(refreshed);
  for (const client of clients) {
    assert.equal(client.connected, true);
    const serverSocket = runtime.io.sockets.sockets.get(client.id!)!;
    assert.equal(serverSocket.rooms.has(`call:${id}`), false);
    assert.equal(serverSocket.rooms.has(`channel:${id}`), false);
    assert.equal((await client.timeout(2500).emitWithAck('call:join', { channelId: id })).ok, false);
  }
  assert.equal((await request(member, `/channels/${id}/messages`)).status, 404);
  assert.equal((await request(member, `/channels/${retained}/messages`, 'POST', { content: 'Still connected' })).status, 201);
  const bootstrap = await (await request(member, '/auth/me')).json();
  assert.equal(bootstrap.channels.some((item: { id: string }) => item.id === id), false);
}));

test('channel deletion retires integration bots only in its workspace and preserves identities and history elsewhere', async () => fixture(async ({ runtime, owner, foreign, channel, request, socket }) => {
  const id = channel('Bot channel'); const now = new Date().toISOString();
  const response = await request(owner, '/integrations', 'POST', { channelId: id, name: 'Retired bot', kind: 'webhook' });
  assert.equal(response.status, 201);
  const integration = await response.json();
  const botId = runtime.repo.get('SELECT bot_user_id FROM integrations WHERE id=?', integration.id)!.bot_user_id;
  runtime.repo.run("INSERT INTO workspace_members(workspace_id,user_id,role,joined_at) VALUES (?,?,'guest',?)", foreign.workspaceId, botId, now);
  const foreignChannel = runtime.repo.get('SELECT id FROM channels WHERE workspace_id=? LIMIT 1', foreign.workspaceId)!.id;
  runtime.repo.run('INSERT INTO channel_members VALUES (?,?)', foreignChannel, botId);
  const messageId = randomUUID();
  runtime.repo.run('INSERT INTO messages(id,channel_id,user_id,content,created_at) VALUES (?,?,?,?,?)', messageId, foreignChannel, botId, 'Bot history retained in another workspace', now);
  const session = (workspaceId: string): Session => {
    const token = randomBytes(32).toString('hex'); const hash = createHash('sha256').update(token).digest('hex');
    runtime.repo.run('INSERT INTO sessions(token_hash,user_id,workspace_id,expires_at) VALUES (?,?,?,?)', hash, botId, workspaceId, Date.now() + 600_000);
    return { id: botId, workspaceId, hash, cookie: `mola_session=${token}` };
  };
  const primarySession = session(owner.workspaceId); const foreignSession = session(foreign.workspaceId);
  const [primarySocket, foreignSocket] = await Promise.all([socket(primarySession), socket(foreignSession)]);
  const disconnected = new Promise<void>((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Retired integration bot stayed connected.')), 2500);
    primarySocket.once('disconnect', () => { clearTimeout(timer); done(); });
  });
  assert.equal((await request(owner, `/admin/workspace/channels/${id}`, 'DELETE', { confirmName: 'Bot channel' })).status, 204);
  await disconnected;
  assert.equal(foreignSocket.connected, true, 'another workspace connection remains active');
  assert.ok(runtime.repo.member(botId, owner.workspaceId)!.membership_removed_at);
  assert.equal(runtime.repo.member(botId, foreign.workspaceId)!.membership_removed_at, null);
  assert.equal(runtime.repo.get('SELECT suspended_at FROM users WHERE id=?', botId)!.suspended_at, null, 'keep the shared account itself');
  assert.equal(runtime.repo.get('SELECT token_hash FROM sessions WHERE token_hash=?', primarySession.hash), undefined);
  assert.ok(runtime.repo.get('SELECT token_hash FROM sessions WHERE token_hash=?', foreignSession.hash));
  assert.equal((await request(primarySession, '/auth/me')).status, 401);
  assert.equal((await request(foreignSession, '/auth/me')).status, 200);
  assert.equal(runtime.repo.canAccessChannel(botId, foreignChannel, foreign.workspaceId), true);
  assert.ok(runtime.repo.get('SELECT id FROM messages WHERE id=?', messageId));
  const bootstrap = await (await request(owner, '/auth/me')).json();
  assert.equal(bootstrap.members.find((item: { id: string }) => item.id === botId)?.suspended, true, 'history keeps an inactive author instead of an active ordinary guest');
  const administration = await (await request(owner, '/admin/workspace')).json();
  assert.equal(administration.members.some((item: { id: string }) => item.id === botId), false);
  assert.equal((await request(owner, `/admin/workspace/members/${botId}/role`, 'PATCH', { role: 'admin' })).status, 404, 'retired bots cannot be promoted after their bot marker is removed');
}));

test('channel deletion rechecks session, membership, workspace access and the confirmed name under the write lock', async () => fixture(async ({ runtime, owner, foreign, channel, request }) => {
  const id = channel('Current name'); const path = `/admin/workspace/channels/${id}`;
  const transaction = runtime.repo.transaction.bind(runtime.repo);
  let beforeTransaction: (() => void) | undefined;
  runtime.repo.transaction = <T,>(fn: () => T): T => { const hook = beforeTransaction; beforeTransaction = undefined; hook?.(); return transaction(fn); };
  const now = new Date().toISOString();
  const races = [
    { status: 401, mutate: () => runtime.repo.run('DELETE FROM sessions WHERE token_hash=?', owner.hash), reset: () => runtime.repo.run('INSERT INTO sessions(token_hash,user_id,workspace_id,expires_at) VALUES (?,?,?,?)', owner.hash, owner.id, owner.workspaceId, Date.now() + 600_000) },
    { status: 403, mutate: () => runtime.repo.run("UPDATE workspace_members SET role='member' WHERE user_id=? AND workspace_id=?", owner.id, owner.workspaceId), reset: () => runtime.repo.run("UPDATE workspace_members SET role='owner' WHERE user_id=? AND workspace_id=?", owner.id, owner.workspaceId) },
    { status: 403, mutate: () => runtime.repo.run('UPDATE users SET suspended_at=? WHERE id=?', now, owner.id), reset: () => runtime.repo.run('UPDATE users SET suspended_at=NULL WHERE id=?', owner.id) },
    { status: 403, mutate: () => runtime.repo.run('UPDATE workspace_members SET suspended_at=? WHERE user_id=? AND workspace_id=?', now, owner.id, owner.workspaceId), reset: () => runtime.repo.run('UPDATE workspace_members SET suspended_at=NULL WHERE user_id=? AND workspace_id=?', owner.id, owner.workspaceId) },
    { status: 403, mutate: () => runtime.repo.run('UPDATE workspace_members SET removed_at=? WHERE user_id=? AND workspace_id=?', now, owner.id, owner.workspaceId), reset: () => runtime.repo.run('UPDATE workspace_members SET removed_at=NULL WHERE user_id=? AND workspace_id=?', owner.id, owner.workspaceId) },
    { status: 403, mutate: () => runtime.repo.run('UPDATE workspaces SET suspended_at=? WHERE id=?', now, owner.workspaceId), reset: () => runtime.repo.run('UPDATE workspaces SET suspended_at=NULL WHERE id=?', owner.workspaceId) },
    { status: 400, mutate: () => runtime.repo.run("UPDATE channels SET name='Renamed concurrently' WHERE id=?", id), reset: () => runtime.repo.run("UPDATE channels SET name='Current name' WHERE id=?", id) },
  ];
  for (const race of races) {
    beforeTransaction = race.mutate;
    assert.equal((await request(owner, path, 'DELETE', { confirmName: 'Current name' })).status, race.status);
    assert.ok(runtime.repo.get('SELECT id FROM channels WHERE id=?', id));
    assert.equal(runtime.repo.get("SELECT count(*) AS n FROM audit_events WHERE action='channel.deleted'")!.n, 0);
    race.reset();
  }
  runtime.repo.run("INSERT INTO workspace_members(workspace_id,user_id,role,joined_at) VALUES (?,?,'member',?)", foreign.workspaceId, owner.id, now);
  beforeTransaction = () => runtime.repo.run('UPDATE sessions SET workspace_id=? WHERE token_hash=?', foreign.workspaceId, owner.hash);
  assert.equal((await request(owner, path, 'DELETE', { confirmName: 'Current name' })).status, 409);
  assert.ok(runtime.repo.get('SELECT id FROM channels WHERE id=?', id));
  runtime.repo.run('UPDATE sessions SET workspace_id=? WHERE token_hash=?', owner.workspaceId, owner.hash);
  assert.equal((await request(owner, path, 'DELETE', { confirmName: 'Current name' })).status, 204);
}));
