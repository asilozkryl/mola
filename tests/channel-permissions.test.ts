import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { createApp } from '../server/app.js';
import { createWorkspace } from '../server/seed.js';
import type { WorkspaceRole } from '../shared/types.js';
import { canCreateChannel, canInviteMembers, canManageWorkspace, canModerateMessages } from '../server/permissions.js';

type Session = { cookie: string; id: string };
const origin = 'http://channel-permissions.test';
async function fixture(run: (ctx: {
  runtime: ReturnType<typeof createApp>; workspaceId: string; owner: Session; member: Session; admin: Session; moderator: Session; guest: Session;
  request: (session: Session, path: string, method?: string, body?: unknown) => Promise<Response>;
  socket: (session: Session) => Promise<Socket>;
  channel: (name: string, visibility?: 'public' | 'private', memberIds?: string[], kind?: 'text' | 'voice') => string;
}) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'mola-permissions-'));
  const runtime = createApp({ dataDir: directory, appOrigin: origin, production: false, requireEmailVerification: false, mailTransport: async () => {}, mailEncryptionKey: '1'.repeat(64) });
  const sockets: Socket[] = [];
  await new Promise<void>(resolve => runtime.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
  const seed = createWorkspace(runtime.repo, { name: 'Permissions', userName: 'Owner', email: 'owner@permissions.test', passwordHash: null });
  const workspaceId = seed.workspaceId;
  const account = (role: WorkspaceRole): Session => {
    const id = role === 'owner' ? seed.userId : randomUUID();
    if (role !== 'owner') {
      runtime.repo.run('INSERT INTO users(id,workspace_id,name,email,color,role,created_at) VALUES (?,?,?,?,?,?,?)', id, workspaceId, role, `${role}@permissions.test`, '#abcdef', 'member', new Date().toISOString());
      runtime.repo.run('UPDATE workspace_members SET role=? WHERE user_id=? AND workspace_id=?', role, id, workspaceId);
    }
    runtime.repo.run('UPDATE users SET email_verified=1 WHERE id=?', id);
    const token = randomBytes(32).toString('hex');
    runtime.repo.run('INSERT INTO sessions(token_hash,user_id,expires_at,workspace_id) VALUES (?,?,?,?)', createHash('sha256').update(token).digest('hex'), id, Date.now() + 600_000, workspaceId);
    return { id, cookie: `mola_session=${token}` };
  };
  const request = (session: Session, path: string, method = 'GET', body?: unknown) => fetch(base + '/api' + path, { method, headers: { Origin: origin, Cookie: session.cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const socket = async (session: Session) => {
    const client = connect(base, { transports: ['websocket'], forceNew: true, reconnection: false, timeout: 2500, extraHeaders: { Origin: origin, Cookie: session.cookie } });
    sockets.push(client);
    await new Promise<void>((resolve, reject) => { client.once('connect', resolve); client.once('connect_error', reject); });
    return client;
  };
  const channel = (name: string, visibility: 'public' | 'private' = 'public', members: string[] = [], kind: 'text' | 'voice' = 'text') => {
    const id = randomUUID();
    runtime.repo.run('INSERT INTO channels(id,workspace_id,name,kind,visibility,created_at) VALUES (?,?,?,?,?,?)', id, workspaceId, name, kind, visibility, new Date().toISOString());
    for (const member of members) runtime.repo.run('INSERT INTO channel_members VALUES (?,?)', id, member);
    return id;
  };
  try { await run({ runtime, workspaceId, owner: account('owner'), admin: account('admin'), member: account('member'), moderator: account('moderator'), guest: account('guest'), request, socket, channel }); }
  finally { sockets.forEach(client => client.disconnect()); await runtime.close(); await rm(directory, { recursive: true, force: true }); }
}

test('workspace role capabilities do not elevate guests, members or moderators to administration', () => {
  for (const role of ['owner', 'admin', 'moderator', 'member', 'guest'] as const) {
    assert.equal(canManageWorkspace({ role }), ['owner', 'admin'].includes(role));
    assert.equal(canInviteMembers({ role }), ['owner', 'admin'].includes(role));
    assert.equal(canCreateChannel({ role }), role !== 'guest');
    assert.equal(canModerateMessages({ role }), ['owner', 'admin', 'moderator'].includes(role));
  }
  assert.equal(canCreateChannel({}), false, 'missing roles never acquire default privileges');
});

test('private content requires explicit channel membership even for owners and admins; guests require assignment', async () => fixture(async ({ runtime, workspaceId, owner, admin, member, guest, channel, request }) => {
  const privateId = channel('Private', 'private', [member.id]);
  const publicId = channel('Public');
  for (const actor of [owner, admin, guest]) {
    assert.equal(runtime.repo.canAccessChannel(actor.id, privateId, workspaceId), false);
    assert.equal((await request(actor, `/channels/${privateId}/messages`)).status, 404);
    const state = await (await request(actor, '/auth/me')).json();
    assert.ok(!state.channels.some((item: { id: string }) => item.id === privateId));
  }
  assert.equal((await request(member, `/channels/${privateId}/messages`)).status, 200);
  assert.equal(runtime.repo.canAccessChannel(guest.id, publicId, workspaceId), false);
  runtime.repo.run('INSERT INTO channel_members VALUES (?,?)', publicId, guest.id);
  assert.equal(runtime.repo.canAccessChannel(guest.id, publicId, workspaceId), true);
  assert.equal((await request(guest, `/channels/${publicId}/messages`, 'POST', { content: 'Assigned guest conversation' })).status, 201);
}));

test('privacy changes revoke existing socket subscriptions before further messages and grant selected guests', async () => fixture(async ({ runtime, owner, member, guest, channel, request, socket }) => {
  const id = channel('Planning');
  const [ownerSocket, memberSocket, guestSocket] = await Promise.all([socket(owner), socket(member), socket(guest)]);
  const disconnected = new Promise<void>(resolve => memberSocket.once('disconnect', () => resolve()));
  const changed = await request(owner, `/channels/${id}/access`, 'PATCH', { visibility: 'private', memberIds: [owner.id, guest.id] });
  assert.equal(changed.status, 200); await disconnected;
  assert.equal(ownerSocket.connected, true, 'an authorized participant keeps their connection');
  assert.equal(runtime.io.sockets.sockets.get(guestSocket.id!)!.rooms.has(`channel:${id}`), true);
  const delivered = new Promise<{ content: string }>(resolve => guestSocket.once('message:created', resolve));
  assert.equal((await request(owner, `/channels/${id}/messages`, 'POST', { content: 'Only invited guests can read this' })).status, 201);
  assert.equal((await delivered).content, 'Only invited guests can read this');
  assert.equal((await request(member, `/channels/${id}/messages`)).status, 404);
  const audit = runtime.repo.get("SELECT details FROM audit_events WHERE target_id=? AND action='channel.access.updated'", id)!;
  assert.match(audit.details, /private; 2/);
}));

test('channel access changes reject outsiders, moderators and empty private membership atomically', async () => fixture(async ({ runtime, owner, moderator, member, channel, request }) => {
  const id = channel('Review');
  for (const actor of [member, moderator]) assert.equal((await request(actor, `/channels/${id}/access`, 'PATCH', { visibility: 'private', memberIds: [actor.id] })).status, 403);
  assert.equal((await request(owner, `/channels/${id}/access`, 'PATCH', { visibility: 'private', memberIds: [] })).status, 400);
  const other = createWorkspace(runtime.repo, { name: 'Other', userName: 'Other', email: 'other@permissions.test', passwordHash: null });
  assert.equal((await request(owner, `/channels/${id}/access`, 'PATCH', { visibility: 'private', memberIds: [owner.id, other.userId] })).status, 400);
  assert.equal(runtime.repo.get('SELECT visibility FROM channels WHERE id=?', id)!.visibility, 'public');
  assert.equal(runtime.repo.get('SELECT count(*) AS n FROM channel_members WHERE channel_id=?', id)!.n, 0);
}));

test('only owners manage admins; admins can manage standard roles but cannot alter themselves or ownership', async () => fixture(async ({ runtime, workspaceId, owner, admin, moderator, member, request }) => {
  assert.equal((await request(admin, '/admin/workspace')).status, 200);
  assert.equal((await request(moderator, '/admin/workspace')).status, 403);
  assert.equal((await request(admin, `/admin/workspace/members/${member.id}/role`, 'PATCH', { role: 'moderator' })).status, 200);
  assert.equal(runtime.repo.member(member.id, workspaceId)!.role, 'moderator');
  assert.equal((await request(admin, `/admin/workspace/members/${member.id}/role`, 'PATCH', { role: 'admin' })).status, 403);
  assert.equal((await request(owner, `/admin/workspace/members/${member.id}/role`, 'PATCH', { role: 'admin' })).status, 200);
  assert.equal((await request(admin, `/admin/workspace/members/${member.id}`, 'PATCH', { suspended: true })).status, 403);
  assert.equal((await request(admin, `/admin/workspace/members/${member.id}`, 'DELETE')).status, 403);
  assert.equal((await request(admin, `/admin/workspace/members/${member.id}/role`, 'PATCH', { role: 'guest' })).status, 403);
  assert.equal((await request(owner, `/admin/workspace/members/${owner.id}/role`, 'PATCH', { role: 'guest' })).status, 409);
  assert.equal((await request(owner, `/admin/workspace/members/${member.id}/role`, 'PATCH', { role: 'owner' })).status, 400);
}));

test('guest downgrade keeps identity but removes unassigned channels and existing sockets', async () => fixture(async ({ runtime, workspaceId, owner, member, channel, request, socket }) => {
  const assigned = channel('Assigned', 'public', [member.id]);
  const unassigned = channel('Unassigned');
  const client = await socket(member);
  const disconnected = new Promise<void>(resolve => client.once('disconnect', () => resolve()));
  assert.equal((await request(owner, `/admin/workspace/members/${member.id}/role`, 'PATCH', { role: 'guest' })).status, 200);
  await disconnected;
  const state = await (await request(member, '/auth/me')).json();
  assert.equal(state.user.id, member.id); assert.equal(state.user.role, 'guest');
  assert.deepEqual(state.channels.map((item: { id: string }) => item.id), [assigned]);
  assert.equal(runtime.repo.canAccessChannel(member.id, unassigned, workspaceId), false);
}));

test('moderators can moderate public channels and messages but cannot manage private metadata', async () => fixture(async ({ owner, moderator, member, channel, request }) => {
  const publicId = channel('Moderated'); const privateId = channel('Restricted', 'private', [moderator.id]);
  const created = await request(member, `/channels/${publicId}/messages`, 'POST', { content: 'Moderated content' });
  const message = await created.json();
  assert.equal((await request(moderator, `/messages/${message.id}`, 'DELETE')).status, 204);
  assert.equal((await request(moderator, `/admin/workspace/channels/${publicId}`, 'PATCH', { archived: true })).status, 200);
  assert.equal((await request(moderator, `/admin/workspace/channels/${privateId}`, 'PATCH', { archived: true })).status, 403);
  assert.equal((await request(owner, `/admin/workspace/channels/${privateId}`, 'PATCH', { archived: true })).status, 200, 'owners can administer metadata without reading private content');
}));

test('new private channels are invisible to observers and guests cannot create channels or invite', async () => fixture(async ({ owner, member, guest, request, socket }) => {
  const client = await socket(member); const events: unknown[] = [];
  client.on('channel:created', value => events.push(value));
  const created = await request(owner, '/channels', 'POST', { name: 'Secret plans', kind: 'text', visibility: 'private' });
  assert.equal(created.status, 201); const channel = await created.json();
  assert.equal(channel.visibility, 'private'); assert.ok(channel.memberIds.includes(owner.id));
  assert.equal((await request(member, `/channels/${channel.id}/messages`)).status, 404);
  await new Promise(resolve => setTimeout(resolve, 60)); assert.deepEqual(events, []);
  assert.equal((await request(guest, '/channels', 'POST', { name: 'Guest escape', kind: 'text' })).status, 403);
  assert.equal((await request(guest, '/invites', 'POST')).status, 403);
  assert.equal((await request(guest, '/dms', 'POST', { userId: owner.id })).status, 403);
}));
