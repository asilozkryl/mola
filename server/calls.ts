import { createHmac, randomBytes } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import type { CallPeer, User, VoiceChannelRoster, VoiceRoster } from '../shared/types';

type CallRoom = Map<string, CallPeer>;
interface CallRegistry {
  rooms: Map<string, CallRoom>;
  channels: Map<string, string>;
  workspaces: Map<string, string>;
  voiceChannels: Set<string>;
}
const registries = new WeakMap<Server, CallRegistry>();
const MAX_PARTICIPANTS = 6;
const roomName = (channelId: string) => `call:${channelId}`;

/** Only public voice channels appear in workspace presence. DMs and text calls stay private. */
export function getVoiceRoster(io: Server, workspaceId: string, channelIds?: readonly string[]): VoiceChannelRoster[] {
  const registry = registries.get(io);
  if (!registry) return [];
  const allowed = channelIds && new Set(channelIds);
  return [...registry.voiceChannels]
    .filter(channelId => registry.workspaces.get(channelId) === workspaceId && (!allowed || allowed.has(channelId)))
    .map(channelId => ({ channelId, peers: [...(registry.rooms.get(channelId)?.values() ?? [])].map(peer => ({ ...peer, user: { ...peer.user } })) }))
    .filter(channel => channel.peers.length > 0);
}

function publishVoiceRoster(io: Server, workspaceId: string) {
  const payload: VoiceRoster = { workspaceId, channels: getVoiceRoster(io, workspaceId) };
  io.to(`workspace:${workspaceId}`).emit('voice:roster', payload);
}

/** Keep identity and workspace role changes visible without interrupting media. */
export function updateCallUser(io: Server, workspaceId: string, user: User) {
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.workspaceId === workspaceId && socket.data.user?.id === user.id)
      socket.data.user = { ...user };
  }
  const registry = registries.get(io);
  if (!registry) return;
  let voiceChanged = false;
  for (const [channelId, room] of registry.rooms) {
    if (registry.workspaces.get(channelId) !== workspaceId) continue;
    let changed = false;
    for (const [socketId, peer] of room) if (peer.user.id === user.id) {
      room.set(socketId, { ...peer, user: { ...user } });
      changed = true;
    }
    if (!changed) continue;
    io.to(roomName(channelId)).emit('call:peers', { channelId, peers: [...room.values()] });
    if (registry.voiceChannels.has(channelId)) voiceChanged = true;
  }
  if (voiceChanged) publishVoiceRoster(io, workspaceId);
}

/** Remove only the archived call; participants keep their ordinary chat connection. */
export function closeCallRoom(io: Server, channelId: string, error: string) {
  const registry = registries.get(io);
  if (!registry) return;
  const workspaceId = registry.workspaces.get(channelId);
  const wasVoice = registry.voiceChannels.has(channelId);
  for (const socketId of registry.rooms.get(channelId)?.keys() ?? []) {
    registry.channels.delete(socketId);
    const socket = io.sockets.sockets.get(socketId);
    socket?.emit('call:closed', { channelId, error });
    void socket?.leave(roomName(channelId));
  }
  registry.rooms.delete(channelId);
  registry.workspaces.delete(channelId);
  registry.voiceChannels.delete(channelId);
  if (wasVoice && workspaceId) publishVoiceRoster(io, workspaceId);
}

/** Coturn REST authentication: credentials expire after one hour. Never return the shared secret. */
export function getRtcConfig() {
  const iceServers: { urls: string | string[]; username?: string; credential?: string }[] = [
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];
  const urls = (process.env.TURN_URLS ?? '').split(',').map(url => url.trim()).filter(Boolean);
  if (urls.length && process.env.TURN_SECRET) {
    const username = `${Math.floor(Date.now() / 1000) + 3600}:${randomBytes(8).toString('hex')}`;
    iceServers.push({ urls, username, credential: createHmac('sha1', process.env.TURN_SECRET).update(username).digest('base64') });
  }
  return { iceServers, relayConfigured: urls.length > 0 && Boolean(process.env.TURN_SECRET) };
}

export function registerCallHandlers(io: Server, socket: Socket, options: {
  user: User;
  workspaceId: string;
  getVoiceChannelIds: () => string[];
  canAccessChannel: (channelId: string) => boolean | Promise<boolean>;
}) {
  let registry = registries.get(io);
  if (!registry) { registry = { rooms: new Map(), channels: new Map(), workspaces: new Map(), voiceChannels: new Set() }; registries.set(io, registry); }
  const { rooms, channels, workspaces, voiceChannels } = registry;
  let joining = false;
  let joinVersion = 0;
  let windowStart = Date.now();
  let signals = 0;
  let stateWindowStart = Date.now();
  let stateChanges = 0;
  let joinWindowStart = Date.now();
  let joinRequests = 0;
  let rosterWindowStart = Date.now();
  let rosterRequests = 0;
  const publish = (channelId: string) => {
    io.to(roomName(channelId)).emit('call:peers', { channelId, peers: [...(rooms.get(channelId)?.values() ?? [])] });
    const workspaceId = workspaces.get(channelId);
    if (voiceChannels.has(channelId) && workspaceId) publishVoiceRoster(io, workspaceId);
  };
  const sendRoster = () => {
    const payload: VoiceRoster = { workspaceId: options.workspaceId, channels: getVoiceRoster(io, options.workspaceId, options.getVoiceChannelIds()) };
    socket.emit('voice:roster', payload);
  };
  socket.on('voice:roster:request', () => {
    if (Date.now() - rosterWindowStart > 10_000) { rosterRequests = 0; rosterWindowStart = Date.now(); }
    if (++rosterRequests <= 20) sendRoster();
  });
  // The client also requests after installing listeners, covering reconnect and bootstrap races.
  sendRoster();
  function leave() {
    const channelId = channels.get(socket.id);
    if (!channelId) return;
    channels.delete(socket.id);
    const room = rooms.get(channelId);
    room?.delete(socket.id);
    void socket.leave(roomName(channelId));
    // Publish an empty roster as well, so observers remove the last departing person.
    publish(channelId);
    if (!room?.size) {
      rooms.delete(channelId);
      workspaces.delete(channelId);
      voiceChannels.delete(channelId);
    }
  }

  socket.on('call:join', async (payload: unknown, ack: unknown) => {
    if (typeof ack !== 'function') return;
    const reply = ack as (response: unknown) => void;
    if (Date.now() - joinWindowStart > 10_000) { joinRequests = 0; joinWindowStart = Date.now(); }
    if (++joinRequests > 20) return reply({ ok: false, error: 'Çok fazla görüşme isteği. Birkaç saniye sonra tekrar deneyin.' });
    const channelId = (payload as { channelId?: unknown } | null)?.channelId;
    if (typeof channelId !== 'string' || channelId.length > 128) return reply({ ok: false, error: 'Geçersiz görüşme kanalı.' });
    if (joining) return reply({ ok: false, error: 'Görüşmeye katılma işlemi devam ediyor.' });
    joining = true;
    const version = ++joinVersion;
    try {
      if (!await options.canAccessChannel(channelId)) return reply({ ok: false, error: 'Bu görüşmeye erişiminiz yok.' });
      if (!socket.connected || version !== joinVersion) return reply({ ok: false, error: 'Görüşme isteği iptal edildi.' });
      const existing = rooms.get(channelId);
      if (existing && workspaces.get(channelId) !== options.workspaceId) return reply({ ok: false, error: 'Bu görüşmeye erişiminiz yok.' });
      if (existing && !existing.has(socket.id) && existing.size >= MAX_PARTICIPANTS) return reply({ ok: false, error: 'Bu görüşme dolu. En fazla 6 kişi katılabilir.' });
      const isVoice = options.getVoiceChannelIds().includes(channelId);
      if (channels.get(socket.id) !== channelId) leave();
      const room = rooms.get(channelId) ?? new Map<string, CallPeer>();
      const user = socket.data.user?.id === options.user.id ? socket.data.user as User : options.user;
      if (!room.has(socket.id)) room.set(socket.id, { socketId: socket.id, user, mic: true, camera: false, sharing: false });
      rooms.set(channelId, room);
      workspaces.set(channelId, options.workspaceId);
      if (isVoice) voiceChannels.add(channelId);
      channels.set(socket.id, channelId);
      await socket.join(roomName(channelId));
      if (!socket.connected || channels.get(socket.id) !== channelId) { leave(); return; }
      reply({ ok: true, peers: [...room.values()] });
      publish(channelId);
    } catch {
      if (channels.get(socket.id) === channelId) leave();
      reply({ ok: false, error: 'Görüşmeye katılınamadı. Yeniden deneyin.' });
    }
    finally { joining = false; }
  });

  socket.on('call:leave', () => { joinVersion++; leave(); });
  socket.on('disconnect', () => { joinVersion++; leave(); });
  socket.on('call:state', (payload: unknown) => {
    if (!payload || typeof payload !== 'object') return;
    if (Date.now() - stateWindowStart > 10_000) { stateChanges = 0; stateWindowStart = Date.now(); }
    if (++stateChanges > 50) return;
    const channelId = channels.get(socket.id);
    const peer = channelId ? rooms.get(channelId)?.get(socket.id) : undefined;
    if (!peer || !channelId) return;
    const state = payload as Partial<CallPeer>;
    for (const key of ['mic', 'camera', 'sharing'] as const) if (typeof state[key] === 'boolean') peer[key] = state[key];
    publish(channelId);
  });

  socket.on('call:signal', (payload: unknown) => {
    if (!payload || typeof payload !== 'object') return;
    if (Date.now() - windowStart > 10_000) { signals = 0; windowStart = Date.now(); }
    if (++signals > 300) return;
    const p = payload as { to?: unknown; description?: { type?: unknown; sdp?: unknown }; candidate?: Record<string, unknown>; renegotiate?: unknown };
    if (typeof p.to !== 'string' || p.to === socket.id) return;
    const channelId = channels.get(socket.id);
    if (!channelId || channels.get(p.to) !== channelId) return;
    if (p.description && typeof p.description.type === 'string' && ['offer', 'answer'].includes(p.description.type) && typeof p.description.sdp === 'string' && p.description.sdp.length <= 128_000) {
      io.to(p.to).emit('call:signal', { from: socket.id, channelId, description: { type: p.description.type, sdp: p.description.sdp } });
    } else if (p.candidate && typeof p.candidate.candidate === 'string' && p.candidate.candidate.length <= 4096
      && (p.candidate.sdpMid == null || typeof p.candidate.sdpMid === 'string' && p.candidate.sdpMid.length < 128)
      && (p.candidate.sdpMLineIndex == null || Number.isInteger(p.candidate.sdpMLineIndex) && Number(p.candidate.sdpMLineIndex) >= 0 && Number(p.candidate.sdpMLineIndex) < 16)
      && (p.candidate.usernameFragment == null || typeof p.candidate.usernameFragment === 'string' && p.candidate.usernameFragment.length < 256)) {
      io.to(p.to).emit('call:signal', { from: socket.id, channelId, candidate: { candidate: p.candidate.candidate, sdpMid: p.candidate.sdpMid, sdpMLineIndex: p.candidate.sdpMLineIndex, usernameFragment: p.candidate.usernameFragment } });
    } else if (p.renegotiate === true) {
      io.to(p.to).emit('call:signal', { from: socket.id, channelId, renegotiate: true });
    }
  });
}
