import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import { getVoiceRoster, registerCallHandlers } from '../server/calls.js';
import type { CallPeer, User, VoiceRoster } from '../shared/types.js';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

interface ClientOptions { name: string; user?: string; workspace?: string; session?: string }
interface Closed { channelId: string; reason?: string; error: string }

async function fixture(run: (context: {
  io: Server;
  client: (options: ClientOptions) => Promise<Socket>;
  access: Map<string, boolean | (() => Promise<boolean>)>;
  peers: (workspace?: string) => CallPeer[];
}) => Promise<void>) {
  const server = createServer();
  const io = new Server(server);
  const clients: Socket[] = [];
  const access = new Map<string, boolean | (() => Promise<boolean>)>();
  io.on('connection', socket => {
    const options = socket.handshake.auth as ClientOptions;
    const userId = options.user ?? 'owner';
    const workspaceId = options.workspace ?? 'alpha';
    const user: User = { id: userId, name: userId, email: `${userId}@example.invalid`, role: 'member', color: '#b8cabe', emailVerified: true };
    socket.data.user = user;
    socket.data.workspaceId = workspaceId;
    registerCallHandlers(io, socket, {
      user, workspaceId,
      ...(options.session ? { device: { id: options.session, name: options.name } } : {}),
      getVoiceChannelIds: () => [`voice-${workspaceId}`, `voice-${workspaceId}-other`],
      canAccessChannel: channelId => {
        if (![ `voice-${workspaceId}`, `voice-${workspaceId}-other` ].includes(channelId)) return false;
        const permission = access.get(options.name);
        return typeof permission === 'function' ? permission() : permission !== false;
      },
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = async (options: ClientOptions) => {
    const socket = connect(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, { auth: options, transports: ['websocket'], forceNew: true, reconnection: false });
    clients.push(socket);
    await new Promise<void>(resolve => socket.once('connect', resolve));
    return socket;
  };
  try { await run({ io, client, access, peers: (workspace = 'alpha') => getVoiceRoster(io, workspace).flatMap(channel => channel.peers) }); }
  finally {
    clients.forEach(socket => socket.disconnect());
    await new Promise<void>(resolve => io.close(() => resolve()));
  }
}

const join = (socket: Socket, channelId = 'voice-alpha') => socket.timeout(2500).emitWithAck('call:join', { channelId });
const flush = (socket: Socket) => socket.timeout(2500).emitWithAck('call:devices:list');

test('joining on another device replaces the account once, inherits mute and stops old signaling without disconnecting chat', async () => fixture(async ({ client, peers }) => {
  const source = await client({ name: 'desktop' });
  const target = await client({ name: 'phone' });
  const other = await client({ name: 'colleague', user: 'colleague' });
  const closed: Closed[] = [];
  const rosters: VoiceRoster[] = [];
  source.on('call:closed', value => closed.push(value));
  other.on('voice:roster', value => rosters.push(value));
  await join(source);
  await join(other);
  source.emit('call:state', { mic: false, camera: true, sharing: true });
  await flush(source);
  const result = await join(target);
  await flush(source);
  assert.equal(result.ok, true);
  assert.equal(result.mic, false, 'the new device retains the current mute state');
  assert.deepEqual(peers().filter(peer => peer.user.id === 'owner').map(peer => peer.socketId), [target.id]);
  assert.deepEqual(closed, [{ channelId: 'voice-alpha', reason: 'device-switch', error: 'Görüşme başka bir cihazına aktarıldı.' }]);
  assert.equal(source.connected, true);
  assert.equal(rosters.every(roster => roster.channels.every(channel => new Set(channel.peers.map(peer => peer.user.id)).size === channel.peers.length)), true, 'no broadcast contains duplicate participants');
  const signals: unknown[] = [];
  other.on('call:signal', value => signals.push(value));
  source.emit('call:state', { mic: true });
  source.emit('call:signal', { to: other.id, renegotiate: true });
  await flush(source);
  await flush(other);
  assert.deepEqual(signals, []);
  assert.equal(peers().find(peer => peer.socketId === target.id)?.mic, false);
  source.emit('call:leave');
  source.disconnect();
  await flush(target);
  assert.equal(peers().some(peer => peer.socketId === target.id), true, 'late departure from the old device cannot end the replacement');
}));

test('ownership is global across workspaces and same-session browser tabs without affecting another account', async () => fixture(async ({ client, peers }) => {
  const source = await client({ name: 'first-tab', session: 'same-browser' });
  const target = await client({ name: 'second-tab', session: 'same-browser' });
  const anotherWorkspace = await client({ name: 'other-workspace', workspace: 'beta' });
  const colleague = await client({ name: 'colleague', user: 'colleague' });
  await join(source);
  await join(colleague);
  await join(target);
  assert.deepEqual(peers().filter(peer => peer.user.id === 'owner').map(peer => peer.socketId), [target.id]);
  const result = await join(anotherWorkspace, 'voice-beta');
  assert.equal(result.ok, true);
  assert.equal('mic' in result, false, 'a different conversation uses the new device preferences');
  assert.deepEqual(peers().map(peer => peer.socketId), [colleague.id]);
  assert.deepEqual(peers('beta').map(peer => peer.socketId), [anotherWorkspace.id]);
}));

test('a full room admits an account replacement but denied or full other-room joins preserve its current call', async () => fixture(async ({ client, access, peers }) => {
  const source = await client({ name: 'source' });
  const target = await client({ name: 'target' });
  await join(source);
  for (let index = 0; index < 5; index++) await join(await client({ name: `person-${index}`, user: `person-${index}` }));
  access.set('target', false);
  assert.equal((await join(target)).ok, false);
  assert.equal(peers().some(peer => peer.socketId === source.id), true);
  access.set('target', true);
  assert.equal((await join(target)).ok, true, 'replacement must not count as a seventh person');
  assert.equal(peers().length, 6);
  assert.equal(peers().some(peer => peer.socketId === source.id), false);
  for (let index = 0; index < 6; index++) await join(await client({ name: `full-${index}`, user: `full-${index}` }), 'voice-alpha-other');
  assert.equal((await join(source, 'voice-alpha-other')).ok, false);
  assert.equal(peers().find(peer => peer.user.id === 'owner')?.socketId, target.id);
}));

test('a newer successful join cancels an older permission check before it can reclaim the account', async () => fixture(async ({ client, access, peers }) => {
  const old = await client({ name: 'slow-device' });
  const newer = await client({ name: 'new-device' });
  const entered = deferred();
  const permission = deferred<boolean>();
  access.set('slow-device', () => { entered.resolve(); return permission.promise; });
  const closed: Closed[] = [];
  old.on('call:closed', value => closed.push(value));
  const slowJoin = join(old);
  await entered.promise;
  assert.equal((await join(newer)).ok, true);
  permission.resolve(true);
  assert.equal((await slowJoin).ok, false);
  assert.deepEqual(peers().map(peer => peer.socketId), [newer.id]);
  assert.equal(closed[0]?.reason, 'device-switch');
}));

test('a late Socket.IO adapter join is removed after device takeover and returns a cancelled acknowledgement', async () => fixture(async ({ io, client, peers }) => {
  const old = await client({ name: 'slow-adapter' });
  const newer = await client({ name: 'new-device' });
  const entered = deferred();
  const release = deferred();
  const native = io.sockets.sockets.get(old.id!)!;
  const nativeJoin = native.join.bind(native);
  native.join = async room => {
    if (room === 'call:voice-alpha') { entered.resolve(); await release.promise; }
    await nativeJoin(room);
  };
  const slowJoin = join(old);
  await entered.promise;
  assert.equal((await join(newer)).ok, true);
  release.resolve();
  assert.equal((await slowJoin).ok, false);
  assert.deepEqual(peers().map(peer => peer.socketId), [newer.id]);
  assert.equal(native.rooms.has('call:voice-alpha'), false, 'late adapter completion cannot retain an observer in the call room');
}));

test('adapter failure and access revoked during admission preserve the existing device and clean provisional room membership', async () => fixture(async ({ io, client, access, peers }) => {
  const source = await client({ name: 'source' });
  const target = await client({ name: 'target' });
  await join(source);
  const native = io.sockets.sockets.get(target.id!)!;
  const nativeJoin = native.join.bind(native);
  native.join = async () => { throw new Error('Adapter unavailable'); };
  assert.equal((await join(target)).ok, false);
  assert.deepEqual(peers().map(peer => peer.socketId), [source.id]);
  assert.equal(native.rooms.has('call:voice-alpha'), false);

  const entered = deferred();
  const release = deferred();
  native.join = async room => { entered.resolve(); await release.promise; await nativeJoin(room); };
  const pending = join(target);
  await entered.promise;
  access.set('target', false);
  release.resolve();
  assert.equal((await pending).ok, false);
  await flush(target);
  assert.deepEqual(peers().map(peer => peer.socketId), [source.id]);
  assert.equal(native.rooms.has('call:voice-alpha'), false);
}));

test('a newer valid request may finish after an older admission and remains the final device', async () => fixture(async ({ client, access, peers }) => {
  const older = await client({ name: 'older' });
  const newer = await client({ name: 'newer' });
  const oldEntered = deferred();
  const oldPermission = deferred<boolean>();
  const newEntered = deferred();
  const newPermission = deferred<boolean>();
  access.set('older', () => { oldEntered.resolve(); return oldPermission.promise; });
  access.set('newer', () => { newEntered.resolve(); return newPermission.promise; });
  const oldJoin = join(older);
  await oldEntered.promise;
  const newJoin = join(newer);
  await newEntered.promise;
  oldPermission.resolve(true);
  assert.equal((await oldJoin).ok, true);
  newPermission.resolve(true);
  assert.equal((await newJoin).ok, true, 'finishing the older request must not invalidate a newer pending one');
  assert.deepEqual(peers().map(peer => peer.socketId), [newer.id]);
}));
