import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import type { User, VoiceRoster } from '../shared/types.js';
import { closeCallRoom, getVoiceRoster, registerCallHandlers, updateCallUser, refreshVoiceAccess } from '../server/calls.js';
import { subscribeVoiceRoster } from '../src/lib/voiceRoster.js';

function event<T>(socket: Socket, name: string, predicate: (value: T) => boolean = () => true) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => { socket.off(name, receive); reject(new Error(`Missing ${name} event`)); }, 2500);
    const receive = (value: T) => {
      if (!predicate(value)) return;
      clearTimeout(timeout); socket.off(name, receive); resolve(value);
    };
    socket.on(name, receive);
  });
}

async function fixture(run: (context: {
  io: Server;
  socket: (name: string) => Promise<Socket>;
  voiceIds: Map<string, Set<string>>;
  access: Map<string, Set<string>>;
  memberAccess: Map<string, Set<string>>;
}) => Promise<void>) {
  const server = createServer();
  const io = new Server(server);
  const clients: Socket[] = [];
  const memberAccess = new Map<string, Set<string>>();
  const access = new Map([
    ['alpha', new Set(['voice-a', 'voice-a2', 'text-a', 'dm-a'])],
    ['beta', new Set(['voice-b'])],
  ]);
  const voiceIds = new Map([
    ['alpha', new Set(['voice-a', 'voice-a2'])],
    ['beta', new Set(['voice-b'])],
  ]);
  io.on('connection', socket => {
    const name = socket.handshake.auth.name as string;
    const workspaceId = name.startsWith('beta-') ? 'beta' : 'alpha';
    const user: User = { id: name, name, email: `${name}@example.invalid`, role: 'member', color: '#b8cabe', emailVerified: true };
    socket.data.user = user;
    socket.data.workspaceId = workspaceId;
    void socket.join(`workspace:${workspaceId}`);
    registerCallHandlers(io, socket, {
      user, workspaceId,
      getVoiceChannelIds: () => [...voiceIds.get(workspaceId)!].filter(id => !memberAccess.has(name) || memberAccess.get(name)!.has(id)),
      canAccessChannel: channelId => access.get(workspaceId)!.has(channelId) && (!memberAccess.has(name) || memberAccess.get(name)!.has(channelId)),
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const socket = async (name: string) => {
    const client = connect(url, { auth: { name }, autoConnect: false, transports: ['websocket'], forceNew: true, reconnection: false });
    clients.push(client);
    const ready = event(client, 'connect');
    client.connect();
    await ready;
    return client;
  };
  try { await run({ io, socket, voiceIds, access, memberAccess }); }
  finally {
    for (const client of clients) client.disconnect();
    await new Promise<void>(resolve => io.close(() => resolve()));
  }
}

async function snapshot(socket: Socket) {
  const result = event<VoiceRoster>(socket, 'voice:roster');
  socket.emit('voice:roster:request');
  return result;
}

test('private voice presence is filtered on every broadcast and access revocation evicts callers', async () => fixture(async ({ io, socket, memberAccess }) => {
  memberAccess.set('outsider', new Set(['voice-a2']));
  const outsider = await socket('outsider');
  const member = await socket('member');
  const alice = await socket('alice');
  const roster = event<VoiceRoster>(outsider, 'voice:roster');
  assert.equal((await alice.timeout(2500).emitWithAck('call:join', { channelId: 'voice-a' })).ok, true);
  assert.deepEqual((await roster).channels, [], 'join broadcast must not expose private participants');
  assert.equal((await snapshot(member)).channels[0].peers[0].user.name, 'alice');
  const media = event<VoiceRoster>(outsider, 'voice:roster');
  alice.emit('call:state', { sharing: true });
  assert.deepEqual((await media).channels, [], 'media broadcasts preserve privacy');
  memberAccess.set('member', new Set(['voice-a2']));
  const revoked = event<VoiceRoster>(member, 'voice:roster');
  await refreshVoiceAccess(io, 'alpha');
  assert.deepEqual((await revoked).channels, [], 'revoked observers immediately receive an empty replacement');
  memberAccess.set('alice', new Set(['voice-a2']));
  const closed = event<{ channelId: string }>(alice, 'call:closed');
  await refreshVoiceAccess(io, 'alpha');
  assert.equal((await closed).channelId, 'voice-a');
  assert.deepEqual(getVoiceRoster(io, 'alpha'), []);
  assert.equal((await alice.timeout(2500).emitWithAck('call:join', { channelId: 'voice-a' })).ok, false);
}));

test('voice observers see initial participants, media changes, moves and the last departure without joining a call', async () => fixture(async ({ io, socket }) => {
  const observer = await socket('observer');
  assert.deepEqual((await snapshot(observer)).channels, []);
  const alice = await socket('alice');
  const joined = event<VoiceRoster>(observer, 'voice:roster', roster => roster.channels[0]?.peers.length === 1);
  assert.equal((await alice.timeout(2500).emitWithAck('call:join', { channelId: 'voice-a' })).ok, true);
  assert.equal((await joined).channels[0].peers[0].user.name, 'alice');

  const stateChanged = event<VoiceRoster>(observer, 'voice:roster', roster => roster.channels[0]?.peers[0].sharing === true);
  alice.emit('call:state', { mic: false, camera: true, sharing: true });
  const peer = (await stateChanged).channels[0].peers[0];
  assert.deepEqual([peer.mic, peer.camera, peer.sharing], [false, true, true]);
  assert.equal((await alice.timeout(2500).emitWithAck('call:join', { channelId: 'voice-a' })).peers[0].mic, false, 'repeated joins preserve media state');

  const newcomer = await socket('newcomer');
  assert.equal((await snapshot(newcomer)).channels[0].peers[0].user.id, 'alice');
  const bob = await socket('bob');
  assert.equal((await bob.timeout(2500).emitWithAck('call:join', { channelId: 'voice-a' })).ok, true);
  assert.equal((await snapshot(observer)).channels[0].peers.length, 2);

  assert.equal((await alice.timeout(2500).emitWithAck('call:join', { channelId: 'voice-a2' })).ok, true);
  const moved = await snapshot(observer);
  assert.equal(moved.channels.find(channel => channel.channelId === 'voice-a')!.peers[0].user.id, 'bob');
  assert.equal(moved.channels.find(channel => channel.channelId === 'voice-a2')!.peers[0].user.id, 'alice');
  assert.deepEqual(getVoiceRoster(io, 'alpha', ['voice-a2']).map(channel => channel.channelId), ['voice-a2'], 'bootstrap whitelist limits returned channels');
  const cloned = getVoiceRoster(io, 'alpha');
  cloned[0].peers[0].user.name = 'mutated snapshot';
  assert.notEqual(getVoiceRoster(io, 'alpha')[0].peers[0].user.name, 'mutated snapshot');

  const left = event<VoiceRoster>(observer, 'voice:roster', roster => !roster.channels.some(channel => channel.channelId === 'voice-a2'));
  alice.emit('call:leave');
  await left;
  const empty = event<VoiceRoster>(observer, 'voice:roster', roster => roster.channels.length === 0);
  bob.disconnect();
  assert.deepEqual((await empty).channels, []);
  assert.deepEqual(getVoiceRoster(io, 'alpha'), []);
}));

test('voice rosters exclude text calls, DMs and other workspaces; archived calls clear all observers', async () => fixture(async ({ io, socket, access, voiceIds }) => {
  const observer = await socket('observer');
  const foreign = await socket('beta-observer');
  const alice = await socket('alice');
  const eve = await socket('beta-eve');
  const leaks: VoiceRoster[] = [];
  foreign.on('voice:roster', roster => { if (roster.workspaceId !== 'beta' || roster.channels.some((channel: { channelId: string }) => channel.channelId.startsWith('voice-a'))) leaks.push(roster); });
  for (const channelId of ['text-a', 'dm-a']) {
    assert.equal((await alice.timeout(2500).emitWithAck('call:join', { channelId })).ok, true);
    assert.deepEqual((await snapshot(observer)).channels, []);
    assert.deepEqual(getVoiceRoster(io, 'alpha'), []);
  }
  assert.equal((await alice.timeout(2500).emitWithAck('call:join', { channelId: 'voice-a' })).ok, true);
  assert.equal((await eve.timeout(2500).emitWithAck('call:join', { channelId: 'voice-b' })).ok, true);
  assert.deepEqual((await snapshot(foreign)).channels.map(channel => channel.channelId), ['voice-b']);
  assert.deepEqual((await snapshot(observer)).channels.map(channel => channel.channelId), ['voice-a']);
  assert.equal((await eve.timeout(2500).emitWithAck('call:join', { channelId: 'voice-a' })).ok, false);
  assert.deepEqual(leaks, []);

  const closed = event<{ channelId: string }>(alice, 'call:closed');
  const empty = event<VoiceRoster>(observer, 'voice:roster', roster => roster.channels.length === 0);
  access.get('alpha')!.delete('voice-a'); voiceIds.get('alpha')!.delete('voice-a');
  closeCallRoom(io, 'voice-a', 'Kanal arşivlendi.');
  assert.equal((await closed).channelId, 'voice-a');
  assert.deepEqual((await empty).channels, []);
  assert.equal(alice.connected, true, 'archival does not close ordinary chat');
  assert.equal((await alice.timeout(2500).emitWithAck('call:join', { channelId: 'voice-a' })).ok, false);
  assert.deepEqual(getVoiceRoster(io, 'alpha'), []);
  assert.equal(getVoiceRoster(io, 'beta')[0].peers[0].user.id, 'beta-eve');
}));

test('server revocation clears old voice presence and reconnect receives the current roster', async () => fixture(async ({ io, socket }) => {
  const observer = await socket('observer');
  const alice = await socket('alice');
  await alice.timeout(2500).emitWithAck('call:join', { channelId: 'voice-a' });
  const empty = event<VoiceRoster>(observer, 'voice:roster', roster => roster.channels.length === 0);
  io.sockets.sockets.get(alice.id!)!.disconnect(true);
  await empty;
  const reconnected = await socket('alice');
  assert.deepEqual((await snapshot(reconnected)).channels, []);
  assert.equal((await reconnected.timeout(2500).emitWithAck('call:join', { channelId: 'voice-a' })).peers.length, 1);
  assert.equal((await snapshot(observer)).channels[0].peers.length, 1, 'old socket never remains as a duplicate participant');
}));

test('profile and workspace role changes update observers and call peers without restarting the call', async () => fixture(async ({ io, socket }) => {
  const observer = await socket('observer');
  const alice = await socket('alice');
  await alice.timeout(2500).emitWithAck('call:join', { channelId: 'voice-a' });
  const original = getVoiceRoster(io, 'alpha')[0].peers[0];
  const updated: User = { ...original.user, name: 'Alice updated', role: 'owner' };
  updateCallUser(io, 'beta', updated);
  assert.equal(getVoiceRoster(io, 'alpha')[0].peers[0].user.name, 'alice', 'another workspace cannot change this role or display name');
  const peers = event<{ peers: { user: User }[] }>(alice, 'call:peers', payload => payload.peers[0]?.user.name === updated.name);
  const roster = event<VoiceRoster>(observer, 'voice:roster', payload => payload.channels[0]?.peers[0].user.name === updated.name);
  updateCallUser(io, 'alpha', updated);
  assert.equal((await peers).peers[0].user.role, 'owner');
  assert.equal((await roster).channels[0].peers[0].socketId, original.socketId);
  assert.equal(alice.connected, true);
  await alice.timeout(2500).emitWithAck('call:join', { channelId: 'voice-a2' });
  assert.equal(getVoiceRoster(io, 'alpha')[0].peers[0].user.name, updated.name, 'later joins on the same socket use the updated identity');
}));

test('roster subscriptions reject stale workspaces, refresh after reconnect and clean up only their own listeners', () => {
  class FakeSocket extends EventEmitter {
    connected = true;
    requests = 0;
    override emit(name: string, ...args: unknown[]) {
      if (name === 'voice:roster:request') { this.requests++; return true; }
      return super.emit(name, ...args);
    }
  }
  const socket = new FakeSocket();
  const unrelated = () => undefined;
  for (const name of ['voice:roster', 'connect', 'disconnect']) socket.on(name, unrelated);
  const received: string[] = [];
  const unsubscribe = subscribeVoiceRoster(socket as unknown as Socket, 'alpha', channels => received.push(channels[0]?.channelId ?? 'empty'));
  assert.equal(socket.requests, 1, 'request follows listener registration');
  socket.emit('voice:roster', { workspaceId: 'beta', channels: [{ channelId: 'private', peers: [] }] });
  socket.emit('voice:roster', { workspaceId: 'alpha', channels: [{ channelId: 'voice-a', peers: [] }] });
  socket.emit('disconnect');
  socket.emit('connect');
  assert.equal(socket.requests, 2);
  assert.deepEqual(received, ['voice-a', 'empty']);
  unsubscribe();
  for (const name of ['voice:roster', 'connect', 'disconnect']) assert.equal(socket.listenerCount(name), 1);
  socket.emit('voice:roster', { workspaceId: 'alpha', channels: [{ channelId: 'stale', peers: [] }] });
  socket.emit('connect');
  assert.equal(socket.requests, 2);
  assert.deepEqual(received, ['voice-a', 'empty']);
});
