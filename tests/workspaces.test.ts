import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { createApp } from '../server/app.js';
import { createWorkspace } from '../server/seed.js';

const origin = 'http://workspaces.test';
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
type Session = { cookie: string; hash: string; userId: string };
async function fixture(run: (context: {
  runtime: ReturnType<typeof createApp>;
  primary: ReturnType<typeof createWorkspace>;
  second: ReturnType<typeof createWorkspace>;
  a: Session; aOther: Session; b: Session;
  session: (userId: string, workspaceId: string) => Session;
  request: (session: Session, path: string, method?: string, body?: unknown, expectedWorkspace?: string) => Promise<Response>;
  socket: (session: Session) => Promise<Socket>;
  invite: (session: Session) => Promise<string>;
}) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'mola-workspaces-'));
  const runtime = createApp({ dataDir: directory, appOrigin: origin, production: false, requireEmailVerification: false, mailTransport: async () => {}, mailEncryptionKey: '1'.repeat(64) });
  const sockets: Socket[] = [];
  await new Promise<void>(done => runtime.server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
  const session = (userId: string, workspaceId: string): Session => {
    const token = randomBytes(32).toString('hex');
    runtime.repo.run('INSERT INTO sessions(token_hash,user_id,expires_at,workspace_id) VALUES (?,?,?,?)', hash(token), userId, Date.now() + 60_000, workspaceId);
    return { cookie: `mola_session=${token}`, hash: hash(token), userId };
  };
  const request = (actor: Session, path: string, method = 'GET', body?: unknown, expectedWorkspace?: string) => fetch(base + '/api' + path, { method, headers: { Origin: origin, Cookie: actor.cookie, ...(expectedWorkspace ? { 'X-Workspace-Id': expectedWorkspace } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const socket = async (actor: Session) => {
    const client = connect(base, { transports: ['websocket'], forceNew: true, reconnection: false, timeout: 2500, extraHeaders: { Origin: origin, Cookie: actor.cookie } });
    sockets.push(client);
    await new Promise<void>((done, reject) => { client.once('connect', done); client.once('connect_error', reject); });
    return client;
  };
  const invite = async (actor: Session) => {
    const response = await request(actor, '/invites', 'POST'); assert.equal(response.status, 201);
    return new URL((await response.json()).url).searchParams.get('invite')!;
  };
  try {
    const primary = createWorkspace(runtime.repo, { name: 'Alpha', userName: 'Alpha Owner', email: 'alpha@teams.test', passwordHash: null });
    const second = createWorkspace(runtime.repo, { name: 'Beta', userName: 'Beta Owner', email: 'beta@teams.test', passwordHash: null });
    runtime.repo.run('UPDATE users SET email_verified=1');
    await run({ runtime, primary, second, a: session(primary.userId, primary.workspaceId), aOther: session(primary.userId, primary.workspaceId), b: session(second.userId, second.workspaceId), session, request, socket, invite });
  } finally { sockets.forEach(client => client.disconnect()); await runtime.close(); await rm(directory, { recursive: true, force: true }); }
}

test('registered accounts join and create workspaces with session-scoped roles, state and channel access', async () => fixture(async ({ runtime, primary, second, a, aOther, b, request, socket, invite }) => {
  const [firstSocket, otherSocket] = await Promise.all([socket(a), socket(aOther)]);
  const changed = new Promise<{ workspaceId: string }>(done => firstSocket.once('workspace:changed', done));
  const disconnected = new Promise<void>(done => firstSocket.once('disconnect', () => done()));
  const token = await invite(b);
  const joinedResponse = await request(a, '/workspaces/join', 'POST', { inviteToken: token }, primary.workspaceId);
  assert.equal(joinedResponse.status, 200); const joined = await joinedResponse.json();
  assert.equal(joined.user.id, primary.userId); assert.equal(joined.user.role, 'member');
  assert.equal(joined.workspace.id, second.workspaceId); assert.equal(joined.workspaces.length, 2);
  assert.equal((await changed).workspaceId, second.workspaceId); await disconnected;
  assert.equal(otherSocket.connected, true, 'a second device session stays in its workspace');
  const otherState = await (await request(aOther, '/auth/me')).json();
  assert.equal(otherState.workspace.id, primary.workspaceId); assert.equal(otherState.user.role, 'owner');
  assert.equal(runtime.repo.get('SELECT workspace_id FROM users WHERE id=?', primary.userId)!.workspace_id, primary.workspaceId, 'switches never mutate the shared identity');
  assert.equal(runtime.repo.get('SELECT count(*) AS n FROM users')!.n, 2);
  const alphaChannel = otherState.channels.find((channel: { kind: string }) => channel.kind === 'text').id;
  const betaChannel = joined.channels.find((channel: { kind: string }) => channel.kind === 'text').id;
  assert.equal((await request(a, `/channels/${alphaChannel}/messages`)).status, 404);
  assert.equal((await request(aOther, `/channels/${betaChannel}/messages`)).status, 404);
  const stale = await request(a, `/channels/${betaChannel}/messages`, 'POST', { content: 'stale tab' }, primary.workspaceId);
  assert.equal(stale.status, 409); assert.equal((await stale.json()).code, 'WORKSPACE_CHANGED');
  const refreshed = await request(a, '/auth/me', 'GET', undefined, primary.workspaceId);
  assert.equal(refreshed.status, 200); assert.equal((await refreshed.json()).workspace.id, second.workspaceId, 'stale tabs can bootstrap their actual session workspace');
  assert.equal((await request(a, '/workspaces', 'POST', { name: 'Stale creation' }, primary.workspaceId)).status, 409);
  assert.equal((await request(a, '/admin/workspace')).status, 403, 'ownership of Alpha cannot administer Beta');
  const repeated = await request(a, '/workspaces/join', 'POST', { inviteToken: token });
  assert.equal(repeated.status, 200);
  assert.equal(runtime.repo.get('SELECT uses FROM invites WHERE token_hash=?', hash(token))!.uses, 1, 'joining an existing membership does not consume another use');
  assert.equal((await request(a, '/workspaces/' + primary.workspaceId + '/switch', 'POST', {}, second.workspaceId)).status, 200);
  const created = await request(aOther, '/workspaces', 'POST', { name: 'Gamma' }, primary.workspaceId);
  assert.equal(created.status, 200); const gamma = await created.json();
  assert.equal(gamma.user.id, primary.userId); assert.equal(gamma.user.role, 'owner'); assert.equal(gamma.workspaces.length, 3);
  assert.equal((await (await request(a, '/auth/me')).json()).workspace.id, primary.workspaceId);
  assert.equal(runtime.repo.get('SELECT count(*) AS n FROM users')!.n, 2, 'new workspaces reuse the account');
  assert.equal((await request(b, '/workspaces/' + primary.workspaceId + '/switch', 'POST')).status, 404);
}));

test('workspace-bound sockets never receive DM or voice events for another active session workspace', async () => fixture(async ({ runtime, primary, second, a, aOther, b, request, socket, invite }) => {
  await request(a, '/workspaces/join', 'POST', { inviteToken: await invite(b) });
  const [betaSocket, alphaSocket] = await Promise.all([socket(a), socket(aOther)]);
  const alphaEvents: unknown[] = []; alphaSocket.on('channel:created', value => alphaEvents.push(value));
  const betaCreated = new Promise<{ id: string }>(done => betaSocket.once('channel:created', done));
  const dm = await request(b, '/dms', 'POST', { userId: primary.userId }); assert.equal(dm.status, 201);
  const dmChannel = await dm.json(); assert.equal((await betaCreated).id, dmChannel.id);
  await new Promise<void>(done => setTimeout(done, 100));
  assert.deepEqual(alphaEvents, []);
  const oldSocketServer = runtime.io.sockets.sockets.get(alphaSocket.id!)!;
  assert.equal(oldSocketServer.rooms.has(`channel:${dmChannel.id}`), false);
  assert.equal((await request(aOther, `/channels/${dmChannel.id}/messages`)).status, 404);
  const betaVoice = runtime.repo.get("SELECT id FROM channels WHERE workspace_id=? AND kind='voice' LIMIT 1", second.workspaceId)!.id;
  assert.equal((await alphaSocket.timeout(2500).emitWithAck('call:join', { channelId: betaVoice })).ok, false);
  assert.equal((await betaSocket.timeout(2500).emitWithAck('call:join', { channelId: betaVoice })).ok, true);
}));

test('team suspension and removal preserve shared accounts, other sessions and message history', async () => fixture(async ({ runtime, primary, second, a, aOther, b, request, socket, invite, session }) => {
  const token = await invite(b); await request(a, '/workspaces/join', 'POST', { inviteToken: token });
  const state = await (await request(a, '/auth/me')).json();
  const channel = state.channels.find((value: { kind: string }) => value.kind === 'text').id;
  const message = await (await request(a, `/channels/${channel}/messages`, 'POST', { content: 'History belongs to this workspace.' })).json();
  const [betaSocket, alphaSocket] = await Promise.all([socket(a), socket(aOther)]);
  const gone = new Promise<void>(done => betaSocket.once('disconnect', () => done()));
  assert.equal((await request(b, `/admin/workspace/members/${primary.userId}`, 'PATCH', { suspended: true })).status, 200);
  await gone;
  assert.equal((await request(a, '/auth/me')).status, 401); assert.equal((await request(aOther, '/auth/me')).status, 200);
  assert.equal(alphaSocket.connected, true); assert.equal(runtime.repo.get('SELECT suspended_at FROM users WHERE id=?', primary.userId)!.suspended_at, null);
  assert.equal((await request(aOther, '/workspaces/' + second.workspaceId + '/switch', 'POST')).status, 403);
  assert.equal((await request(aOther, '/workspaces/join', 'POST', { inviteToken: token })).status, 403);
  assert.equal(runtime.repo.member(primary.userId, primary.workspaceId)!.role, 'owner');
  assert.equal((await request(b, `/admin/workspace/members/${primary.userId}`, 'PATCH', { suspended: false })).status, 200);
  const next = session(primary.userId, second.workspaceId);
  assert.equal((await request(b, `/admin/workspace/members/${primary.userId}`, 'DELETE')).status, 204);
  assert.equal((await request(next, '/auth/me')).status, 401); assert.equal((await request(aOther, '/auth/me')).status, 200);
  assert.equal(runtime.repo.get('SELECT content FROM messages WHERE id=?', message.id)!.content, 'History belongs to this workspace.');
  assert.ok(runtime.repo.get('SELECT id FROM users WHERE id=?', primary.userId));
  assert.equal((await request(aOther, '/workspaces/join', 'POST', { inviteToken: token })).status, 403, 'an old invite cannot reverse an administrator removal');
  const remaining = await (await request(aOther, '/workspaces')).json();
  assert.deepEqual(remaining.workspaces.map((value: { id: string }) => value.id), [primary.workspaceId]);
}));

test('an in-flight administrator request cannot mutate a workspace after its session switches', async () => fixture(async ({ runtime, primary, a, request }) => {
  const another = createWorkspace(runtime.repo, { name: 'Another owned team', userName: '', email: '', passwordHash: null, existingUserId: primary.userId });
  const transaction = runtime.repo.transaction.bind(runtime.repo);
  let switched = false;
  runtime.repo.transaction = <T,>(fn: () => T): T => {
    if (!switched) { switched = true; runtime.repo.run('UPDATE sessions SET workspace_id=? WHERE token_hash=?', another.workspaceId, a.hash); }
    return transaction(fn);
  };
  const response = await request(a, '/admin/workspace', 'PATCH', { name: 'Wrong workspace' }, primary.workspaceId);
  assert.equal(response.status, 409); assert.equal((await response.json()).code, 'WORKSPACE_CHANGED');
  assert.equal(runtime.repo.workspace(primary.workspaceId).name, 'Alpha');
  assert.equal(runtime.repo.workspace(another.workspaceId).name, 'Another owned team');
  assert.equal(runtime.repo.get('SELECT count(*) AS n FROM audit_events')!.n, 0);
}));
