import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import { closeCallRoom, getVoiceRoster, refreshVoiceAccess, registerCallHandlers } from '../server/calls.js';
import type { CallTransfer, CallTransferStatus } from '../shared/call-types.js';
import type { CallPeer, User } from '../shared/types.js';

function event<T>(socket: Socket, name: string, predicate: (value: T) => boolean = () => true) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(name, receive); reject(new Error(`Missing ${name}`)); }, 2500);
    const receive = (value: T) => {
      if (!predicate(value)) return;
      clearTimeout(timer);
      socket.off(name, receive);
      resolve(value);
    };
    socket.on(name, receive);
  });
}

interface ClientOptions {
  name: string;
  user?: string;
  workspace?: string;
  session?: string;
  registered?: boolean;
}

async function fixture(run: (context: {
  io: Server;
  client: (options: ClientOptions) => Promise<Socket>;
  access: Map<string, boolean>;
  peers: () => CallPeer[];
}) => Promise<void>, timeoutMs = 60_000) {
  const server = createServer();
  const io = new Server(server);
  const clients: Socket[] = [];
  const access = new Map<string, boolean>();
  io.on('connection', socket => {
    const options = socket.handshake.auth as ClientOptions;
    const userId = options.user ?? 'owner';
    const workspaceId = options.workspace ?? 'alpha';
    const user: User = { id: userId, name: userId, email: `${userId}@example.invalid`, role: 'member', color: '#b8cabe', emailVerified: true };
    socket.data.user = user;
    socket.data.workspaceId = workspaceId;
    registerCallHandlers(io, socket, {
      user, workspaceId,
      device: { id: options.session ?? options.name, name: `${options.name} device` },
      getChannelName: () => 'Tasarım odası',
      getVoiceChannelIds: () => access.get(options.name) !== false ? [`voice-${workspaceId}`] : [],
      canAccessChannel: channelId => access.get(options.name) !== false && channelId === `voice-${workspaceId}`,
      transferTimeoutMs: timeoutMs,
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const client = async (options: ClientOptions) => {
    const socket = connect(url, { auth: options, autoConnect: false, transports: ['websocket'], forceNew: true, reconnection: false });
    clients.push(socket);
    const connected = event(socket, 'connect');
    socket.connect();
    await connected;
    if (options.registered !== false) assert.equal((await socket.timeout(2500).emitWithAck('call:devices:register')).ok, true);
    return socket;
  };
  const peers = () => getVoiceRoster(io, 'alpha', ['voice-alpha'])[0]?.peers ?? [];
  try { await run({ io, client, access, peers }); }
  finally {
    clients.forEach(socket => socket.disconnect());
    await new Promise<void>(resolve => io.close(() => resolve()));
  }
}

const join = (socket: Socket, transferId?: string) => socket.timeout(2500).emitWithAck('call:join', { channelId: 'voice-alpha', ...(transferId ? { transferId } : {}) });
const request = (socket: Socket, deviceId: string) => socket.timeout(2500).emitWithAck('call:transfer:request', { deviceId });
const ready = (socket: Socket, transferId: string) => socket.timeout(2500).emitWithAck('call:transfer:ready', { transferId });
const cancel = (socket: Socket, transferId: string) => socket.timeout(2500).emitWithAck('call:transfer:cancel', { transferId });

test('only ready idle own other sessions in the same authorized workspace are discoverable', async () => fixture(async ({ client, access }) => {
  const source = await client({ name: 'source', session: 'desktop-session' });
  await join(source);
  await client({ name: 'phone', session: 'phone-session' });
  await client({ name: 'phone-other-tab', session: 'phone-session' });
  await client({ name: 'same-browser-tab', session: 'desktop-session' });
  await client({ name: 'other-person', user: 'other' });
  await client({ name: 'other-workspace', workspace: 'beta' });
  await client({ name: 'old-app', registered: false });
  const busy = await client({ name: 'busy', session: 'busy-session' });
  await join(busy);
  await client({ name: 'busy-browser-other-tab', session: 'busy-session' });
  access.set('revoked', false);
  await client({ name: 'revoked' });
  const result = await source.timeout(2500).emitWithAck('call:devices:list');
  assert.equal(result.ok, true);
  assert.equal(result.devices.length, 1);
  assert.equal(result.devices[0].id, 'phone-session');
  assert.deepEqual(Object.keys(result.devices[0]).sort(), ['id', 'name']);
  for (const deviceId of ['desktop-session', 'other-person', 'other-workspace', 'old-app', 'busy-session', 'revoked'])
    assert.equal((await request(source, deviceId)).ok, false);
}));

test('a transfer stages muted without evicting source and commits latest microphone state only on target ready', async () => fixture(async ({ client, peers }) => {
  const source = await client({ name: 'desktop' });
  const target = await client({ name: 'phone' });
  const outsider = await client({ name: 'outsider', user: 'other' });
  await join(source);
  const incoming = event<CallTransfer>(target, 'call:transfer:incoming');
  const result = await request(source, 'phone');
  assert.equal(result.ok, true);
  const transfer = await incoming;
  assert.equal(transfer.id, result.transfer.id);
  assert.equal(transfer.channelName, 'Tasarım odası');
  assert.equal(transfer.sourceSocketId, source.id);
  assert.equal(peers().length, 1);
  assert.equal((await ready(target, transfer.id)).ok, false, 'ready before staged join must not evict');
  assert.equal((await join(outsider, transfer.id)).ok, false);
  assert.equal((await cancel(outsider, transfer.id)).ok, false);
  assert.equal((await ready(source, transfer.id)).ok, false);
  assert.equal((await join(target, transfer.id)).ok, true);
  assert.equal(peers().length, 2);
  assert.equal(peers().find(peer => peer.socketId === target.id)?.mic, false);
  target.emit('call:state', { mic: true, camera: true, sharing: true });
  // An ack on the same ordered socket confirms the earlier event was processed.
  await target.timeout(2500).emitWithAck('call:devices:list');
  assert.deepEqual(peers().find(peer => peer.socketId === target.id), {
    socketId: target.id, user: peers()[0].user, mic: false, camera: false, sharing: false,
  });
  source.emit('call:state', { mic: false });
  await source.timeout(2500).emitWithAck('call:devices:list');
  const sourceStatus = event<CallTransferStatus>(source, 'call:transfer:status');
  const targetStatus = event<CallTransferStatus>(target, 'call:transfer:status');
  assert.deepEqual(await ready(target, transfer.id), { ok: true, mic: false });
  assert.deepEqual(await sourceStatus, { id: transfer.id, state: 'completed', mic: false });
  assert.deepEqual(await targetStatus, { id: transfer.id, state: 'completed', mic: false });
  assert.deepEqual(peers().map(peer => peer.socketId), [target.id]);
  assert.equal((await ready(target, transfer.id)).ok, false, 'completed id cannot be replayed');
  assert.equal((await join(outsider, transfer.id)).ok, false);
}));

test('a full six-person call permits only its validated replacement and retains the normal capacity limit', async () => fixture(async ({ client, peers }) => {
  const source = await client({ name: 'source' });
  const target = await client({ name: 'target' });
  const ordinary = await client({ name: 'ordinary', user: 'seventh' });
  await join(source);
  for (let index = 0; index < 5; index++) await join(await client({ name: `person-${index}`, user: `person-${index}` }));
  assert.equal((await join(ordinary)).ok, false);
  assert.equal((await join(target, 'forged')).ok, false);
  const { transfer } = await request(source, 'target');
  assert.equal((await join(target, transfer.id)).ok, true);
  assert.equal(peers().length, 7);
  assert.equal((await join(ordinary)).ok, false);
  assert.equal((await ready(target, transfer.id)).ok, true);
  assert.equal(peers().length, 6);
  assert.equal((await join(ordinary)).ok, false);
}));

test('declining and cancelling staged transfers preserve source and make the target available again', async () => fixture(async ({ client, peers }) => {
  const source = await client({ name: 'source' });
  const target = await client({ name: 'target' });
  await join(source);
  for (const staged of [false, true]) {
    const { transfer } = await request(source, 'target');
    if (staged) await join(target, transfer.id);
    const status = event<CallTransferStatus>(source, 'call:transfer:status');
    assert.equal((await cancel(staged ? source : target, transfer.id)).ok, true);
    assert.equal((await status).state, 'cancelled');
    assert.deepEqual(peers().map(peer => peer.socketId), [source.id]);
    assert.equal((await join(target, transfer.id)).ok, false);
    const listed = await source.timeout(2500).emitWithAck('call:devices:list');
    assert.deepEqual(listed.devices.map((device: { id: string }) => device.id), ['target']);
  }
}));

test('expiry releases only the staged target and leaves the source call connected', async () => fixture(async ({ client, peers }) => {
  const source = await client({ name: 'source' });
  const target = await client({ name: 'target' });
  await join(source);
  const status = event<CallTransferStatus>(source, 'call:transfer:status');
  const { transfer } = await request(source, 'target');
  await join(target, transfer.id);
  assert.equal((await status).state, 'cancelled');
  assert.deepEqual(peers().map(peer => peer.socketId), [source.id]);
  assert.equal((await ready(target, transfer.id)).ok, false);
}, 120));

test('target disconnect cancels pending or staged handoff without disconnecting source', async () => fixture(async ({ client, peers }) => {
  const source = await client({ name: 'source' });
  await join(source);
  for (const staged of [false, true]) {
    const target = await client({ name: `target-${staged}` });
    const { transfer } = await request(source, `target-${staged}`);
    if (staged) await join(target, transfer.id);
    const status = event<CallTransferStatus>(source, 'call:transfer:status');
    target.disconnect();
    assert.equal((await status).state, 'cancelled');
    assert.deepEqual(peers().map(peer => peer.socketId), [source.id]);
    assert.equal(source.connected, true);
  }
}));

test('source disconnect releases the staged target instead of leaving an orphan participant', async () => fixture(async ({ client, peers }) => {
  const source = await client({ name: 'source' });
  const target = await client({ name: 'target' });
  await join(source);
  const { transfer } = await request(source, 'target');
  await join(target, transfer.id);
  const status = event<CallTransferStatus>(target, 'call:transfer:status');
  source.disconnect();
  assert.equal((await status).state, 'cancelled');
  assert.deepEqual(peers(), []);
  assert.equal((await ready(target, transfer.id)).ok, false);
  assert.equal(target.connected, true, 'ordinary chat connection remains usable');
}));

test('fresh access checks reject revoked target at join and cancel a staged target at commit', async () => fixture(async ({ client, access, peers }) => {
  const source = await client({ name: 'source' });
  const target = await client({ name: 'target' });
  await join(source);
  let { transfer } = await request(source, 'target');
  access.set('target', false);
  assert.equal((await join(target, transfer.id)).ok, false);
  await cancel(source, transfer.id);
  access.set('target', true);
  ({ transfer } = await request(source, 'target'));
  await join(target, transfer.id);
  access.set('target', false);
  assert.equal((await ready(target, transfer.id)).ok, false);
  assert.deepEqual(peers().map(peer => peer.socketId), [source.id]);
}));

test('permission refresh and channel close cancel invitations before they can be accepted', async () => fixture(async ({ io, client, access, peers }) => {
  const source = await client({ name: 'source' });
  const target = await client({ name: 'target' });
  await join(source);
  let { transfer } = await request(source, 'target');
  access.set('target', false);
  await refreshVoiceAccess(io, 'alpha');
  assert.equal((await join(target, transfer.id)).ok, false);
  assert.deepEqual(peers().map(peer => peer.socketId), [source.id]);
  access.set('target', true);
  ({ transfer } = await request(source, 'target'));
  closeCallRoom(io, 'voice-alpha', 'Görüşme kapatıldı.');
  assert.equal((await join(target, transfer.id)).ok, false);
  assert.deepEqual(peers(), []);
}));

test('concurrent requests reserve one target and stale requests cannot disturb a newer transfer', async () => fixture(async ({ client, peers }) => {
  const source = await client({ name: 'source' });
  const first = await client({ name: 'first' });
  const second = await client({ name: 'second' });
  await join(source);
  const results = await Promise.all([request(source, 'first'), request(source, 'second')]);
  assert.equal(results.filter(result => result.ok).length, 1);
  const old = results.find(result => result.ok).transfer as CallTransfer;
  await cancel(source, old.id);
  const { transfer } = await request(source, 'second');
  assert.equal((await cancel(first, old.id)).ok, false);
  assert.equal((await join(first, old.id)).ok, false);
  assert.equal((await join(second, transfer.id)).ok, true);
  assert.equal((await ready(second, transfer.id)).ok, true);
  assert.deepEqual(peers().map(peer => peer.socketId), [second.id]);
}));
