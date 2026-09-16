import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import type { CallPeer, User, VoiceChannelRoster, VoiceRoster } from '../shared/types';
import type { CallDevice, CallTransfer, CallTransferStatus } from '../shared/call-types';

type CallRoom = Map<string, CallPeer>;
interface CallSubscriber {
  workspaceId: string;
  userId: string;
  device?: CallDevice;
  readyForTransfer: boolean;
  isJoining: () => boolean;
  sendRoster: () => void;
  canAccessChannel: (channelId: string) => boolean | Promise<boolean>;
  leave: () => void;
}
interface PendingTransfer {
  info: CallTransfer;
  workspaceId: string;
  userId: string;
  targetSocketId: string;
  state: 'pending' | 'staged' | 'committing';
  timer: ReturnType<typeof setTimeout>;
}
interface CallRegistry {
  rooms: Map<string, CallRoom>;
  channels: Map<string, string>;
  workspaces: Map<string, string>;
  voiceChannels: Set<string>;
  subscribers: Map<string, CallSubscriber>;
  transfers: Map<string, PendingTransfer>;
}
const registries = new WeakMap<Server, CallRegistry>();
const MAX_PARTICIPANTS = 6;
const roomName = (channelId: string) => `call:${channelId}`;

function publishDevices(io: Server, userId: string) {
  for (const [socketId, subscriber] of registries.get(io)?.subscribers ?? []) {
    if (subscriber.userId === userId && subscriber.readyForTransfer)
      io.sockets.sockets.get(socketId)?.emit('call:devices:changed');
  }
}

function transferForSocket(registry: CallRegistry, socketId: string) {
  return [...registry.transfers.values()].find(transfer =>
    transfer.info.sourceSocketId === socketId || transfer.targetSocketId === socketId);
}

function cancelTransfer(io: Server, transfer: PendingTransfer, reason: string) {
  const registry = registries.get(io);
  if (registry?.transfers.get(transfer.info.id) !== transfer) return;
  registry.transfers.delete(transfer.info.id);
  clearTimeout(transfer.timer);
  const status: CallTransferStatus = { id: transfer.info.id, state: 'cancelled', reason };
  io.to(transfer.info.sourceSocketId).to(transfer.targetSocketId).emit('call:transfer:status', status);
  // Delete the transfer first: leave() also cancels transfers involving its socket.
  if (transfer.state !== 'pending' && registry.channels.get(transfer.targetSocketId) === transfer.info.channelId)
    registry.subscribers.get(transfer.targetSocketId)?.leave();
  publishDevices(io, transfer.userId);
}

async function transferHasAccess(io: Server, registry: CallRegistry, transfer: PendingTransfer) {
  const source = registry.subscribers.get(transfer.info.sourceSocketId);
  const target = registry.subscribers.get(transfer.targetSocketId);
  if (!source || !target || source.userId !== transfer.userId || target.userId !== transfer.userId
    || source.workspaceId !== transfer.workspaceId || target.workspaceId !== transfer.workspaceId
    || !io.sockets.sockets.get(transfer.info.sourceSocketId)?.connected
    || !io.sockets.sockets.get(transfer.targetSocketId)?.connected
    || registry.channels.get(transfer.info.sourceSocketId) !== transfer.info.channelId
    || Date.now() >= transfer.info.expiresAt) return false;
  try {
    const allowed = await Promise.all([source.canAccessChannel(transfer.info.channelId), target.canAccessChannel(transfer.info.channelId)]);
    return allowed.every(Boolean) && registry.transfers.get(transfer.info.id) === transfer;
  } catch { return false; }
}

/** Filter voice presence by the recipient's current channel access. DMs and text calls stay private. */
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
  for (const subscriber of registries.get(io)?.subscribers.values() ?? []) {
    if (subscriber.workspaceId === workspaceId) subscriber.sendRoster();
  }
}

/** Recheck call access and replace observers' complete roster after permission changes. */
export async function refreshVoiceAccess(io: Server, workspaceId: string) {
  const registry = registries.get(io);
  if (!registry) return;
  await Promise.all([...registry.subscribers.entries()].map(async ([socketId, subscriber]) => {
    if (subscriber.workspaceId !== workspaceId) return;
    const channelId = registry.channels.get(socketId);
    if (!channelId) return;
    let allowed = false;
    try { allowed = await subscriber.canAccessChannel(channelId); } catch { /* Revoked identities have no access. */ }
    if (!allowed && registry.channels.get(socketId) === channelId) {
      io.sockets.sockets.get(socketId)?.emit('call:closed', { channelId, error: 'Bu görüşmeye erişiminiz kaldırıldı.' });
      subscriber.leave();
    }
  }));
  await Promise.all([...registry.transfers.values()].map(async transfer => {
    if (transfer.workspaceId === workspaceId && !await transferHasAccess(io, registry, transfer))
      cancelTransfer(io, transfer, 'Görüşme erişimi değişti. Aktarım iptal edildi.');
  }));
  publishVoiceRoster(io, workspaceId);
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
  for (const transfer of registry.transfers.values())
    if (transfer.info.channelId === channelId) cancelTransfer(io, transfer, error);
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
  device?: CallDevice;
  getChannelName?: (channelId: string) => string;
  transferTimeoutMs?: number;
}) {
  let registry = registries.get(io);
  if (!registry) { registry = { rooms: new Map(), channels: new Map(), workspaces: new Map(), voiceChannels: new Set(), subscribers: new Map(), transfers: new Map() }; registries.set(io, registry); }
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
  let deviceWindowStart = Date.now();
  let deviceRequests = 0;
  let transferWindowStart = Date.now();
  let transferRequests = 0;
  const publish = (channelId: string) => {
    io.to(roomName(channelId)).emit('call:peers', { channelId, peers: [...(rooms.get(channelId)?.values() ?? [])] });
    const workspaceId = workspaces.get(channelId);
    if (voiceChannels.has(channelId) && workspaceId) publishVoiceRoster(io, workspaceId);
  };
  const sendRoster = () => {
    if (!socket.connected) return;
    const payload: VoiceRoster = { workspaceId: options.workspaceId, channels: getVoiceRoster(io, options.workspaceId, options.getVoiceChannelIds()) };
    socket.emit('voice:roster', payload);
  };
  const subscriber: CallSubscriber = { workspaceId: options.workspaceId, userId: options.user.id,
    device: options.device, readyForTransfer: false, isJoining: () => joining,
    sendRoster, canAccessChannel: options.canAccessChannel, leave: () => { joinVersion++; leave(); } };
  registry.subscribers.set(socket.id, subscriber);
  socket.on('voice:roster:request', () => {
    if (Date.now() - rosterWindowStart > 10_000) { rosterRequests = 0; rosterWindowStart = Date.now(); }
    if (++rosterRequests <= 20) sendRoster();
  });
  // The client also requests after installing listeners, covering reconnect and bootstrap races.
  sendRoster();
  function leave(preserveTransferId?: string) {
    for (const transfer of registry!.transfers.values())
      if (transfer.info.id !== preserveTransferId && (transfer.info.sourceSocketId === socket.id || transfer.targetSocketId === socket.id))
        cancelTransfer(io, transfer, 'Cihaz görüşmeden ayrıldı. Aktarım iptal edildi.');
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
    publishDevices(io, options.user.id);
  }

  const eligibleTarget = (socketId: string, target: CallSubscriber) =>
    socketId !== socket.id && target.userId === options.user.id
    && target.workspaceId === options.workspaceId && Boolean(target.device)
    && target.device!.id !== options.device?.id && target.readyForTransfer
    && Boolean(io.sockets.sockets.get(socketId)?.connected) && !target.isJoining()
    && !channels.has(socketId) && !transferForSocket(registry!, socketId)
    && ![...registry!.subscribers].some(([otherId, other]) => other.userId === target.userId
      && other.device?.id === target.device!.id
      && (channels.has(otherId) || other.isJoining() || Boolean(transferForSocket(registry!, otherId))));

  socket.on('call:devices:register', (ack: unknown) => {
    subscriber.readyForTransfer = Boolean(options.device);
    if (typeof ack === 'function') ack({ ok: true });
    publishDevices(io, options.user.id);
  });

  socket.on('call:devices:list', async (ack: unknown) => {
    if (typeof ack !== 'function') return;
    if (Date.now() - deviceWindowStart > 10_000) { deviceRequests = 0; deviceWindowStart = Date.now(); }
    if (++deviceRequests > 30) return ack({ ok: false, error: 'Cihaz listesini yenilemeden önce birkaç saniye bekleyin.' });
    const channelId = channels.get(socket.id);
    if (!channelId || !options.device || !subscriber.readyForTransfer) return ack({ ok: true, devices: [] });
    try {
      if (!await options.canAccessChannel(channelId)) return ack({ ok: false, error: 'Bu görüşmeye erişiminiz yok.' });
      const devices = new Map<string, CallDevice>();
      for (const [targetId, target] of registry!.subscribers) {
        if (!eligibleTarget(targetId, target)) continue;
        if (await target.canAccessChannel(channelId) && eligibleTarget(targetId, target))
          devices.set(target.device!.id, target.device!);
      }
      if (!socket.connected || channels.get(socket.id) !== channelId) return ack({ ok: true, devices: [] });
      ack({ ok: true, devices: [...devices.values()] });
    } catch { ack({ ok: false, error: 'Cihaz listesi alınamadı. Yeniden deneyin.' }); }
  });

  socket.on('call:transfer:request', async (payload: unknown, ack: unknown) => {
    if (typeof ack !== 'function') return;
    if (Date.now() - transferWindowStart > 10_000) { transferRequests = 0; transferWindowStart = Date.now(); }
    if (++transferRequests > 8) return ack({ ok: false, error: 'Yeni aktarım için birkaç saniye bekleyin.' });
    const deviceId = (payload as { deviceId?: unknown } | null)?.deviceId;
    const channelId = channels.get(socket.id);
    if (typeof deviceId !== 'string' || deviceId.length > 128 || !channelId || !options.device
      || !subscriber.readyForTransfer || joining || transferForSocket(registry!, socket.id))
      return ack({ ok: false, error: 'Bu görüşme şu anda aktarılamıyor.' });
    if ([...registry!.transfers.values()].some(item => item.info.channelId === channelId))
      return ack({ ok: false, error: 'Bu görüşmede başka bir cihaz aktarımı sürüyor. Tamamlanmasını bekleyin.' });
    const candidate = [...registry!.subscribers].find(([targetId, target]) => target.device?.id === deviceId && eligibleTarget(targetId, target));
    if (!candidate) return ack({ ok: false, error: 'Cihaz artık uygun değil. Cihaz listesini yenileyin.' });
    const [targetSocketId, target] = candidate;
    try {
      if (!(await Promise.all([options.canAccessChannel(channelId), target.canAccessChannel(channelId)])).every(Boolean)
        || !socket.connected || channels.get(socket.id) !== channelId
        || [...registry!.transfers.values()].some(item => item.info.channelId === channelId)
        || transferForSocket(registry!, socket.id) || !eligibleTarget(targetSocketId, target))
        return ack({ ok: false, error: 'Görüşme veya cihaz erişimi değişti. Yeniden deneyin.' });
      const info: CallTransfer = {
        id: randomUUID(), channelId, channelName: options.getChannelName?.(channelId) ?? channelId,
        sourceSocketId: socket.id, sourceDevice: options.device.name, targetDevice: target.device!.name,
        expiresAt: Date.now() + (options.transferTimeoutMs ?? 60_000),
        mic: rooms.get(channelId)?.get(socket.id)?.mic ?? false,
      };
      const transfer: PendingTransfer = {
        info, workspaceId: options.workspaceId, userId: options.user.id, targetSocketId, state: 'pending',
        timer: setTimeout(() => cancelTransfer(io, transfer, 'Aktarım isteğinin süresi doldu. Görüşme önceki cihazda devam ediyor.'), Math.max(1, info.expiresAt - Date.now())),
      };
      transfer.timer.unref();
      registry!.transfers.set(info.id, transfer);
      io.to(targetSocketId).emit('call:transfer:incoming', info);
      ack({ ok: true, transfer: info });
      publishDevices(io, options.user.id);
    } catch { ack({ ok: false, error: 'Aktarım başlatılamadı. Yeniden deneyin.' }); }
  });

  socket.on('call:transfer:cancel', (payload: unknown, ack: unknown) => {
    const id = (payload as { transferId?: unknown } | null)?.transferId;
    const transfer = typeof id === 'string' ? registry!.transfers.get(id) : undefined;
    if (!transfer || (transfer.info.sourceSocketId !== socket.id && transfer.targetSocketId !== socket.id)) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Aktarım isteği artık geçerli değil.' });
      return;
    }
    cancelTransfer(io, transfer, socket.id === transfer.targetSocketId
      ? 'Aktarım kabul edilmedi. Görüşme önceki cihazda devam ediyor.'
      : 'Aktarım iptal edildi. Görüşme önceki cihazda devam ediyor.');
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('call:transfer:ready', async (payload: unknown, ack: unknown) => {
    if (typeof ack !== 'function') return;
    const id = (payload as { transferId?: unknown } | null)?.transferId;
    const transfer = typeof id === 'string' ? registry!.transfers.get(id) : undefined;
    if (!transfer || transfer.targetSocketId !== socket.id || transfer.state !== 'staged'
      || channels.get(socket.id) !== transfer.info.channelId)
      return ack({ ok: false, error: 'Aktarım isteği artık geçerli değil.' });
    transfer.state = 'committing';
    if (!await transferHasAccess(io, registry!, transfer)
      || channels.get(socket.id) !== transfer.info.channelId
      || registry!.transfers.get(transfer.info.id) !== transfer) {
      cancelTransfer(io, transfer, 'Aktarım tamamlanamadı. Görüşme önceki cihazda devam ediyor.');
      return ack({ ok: false, error: 'Aktarım tamamlanamadı. Yeniden deneyin.' });
    }
    const mic = rooms.get(transfer.info.channelId)?.get(transfer.info.sourceSocketId)?.mic ?? false;
    registry!.transfers.delete(transfer.info.id);
    clearTimeout(transfer.timer);
    const status: CallTransferStatus = { id: transfer.info.id, state: 'completed', mic };
    // Both clients learn the result before the roster removes the source. No
    // call:closed error is emitted for a successful, intentional transfer.
    io.to(transfer.info.sourceSocketId).to(socket.id).emit('call:transfer:status', status);
    registry!.subscribers.get(transfer.info.sourceSocketId)?.leave();
    const peer = rooms.get(transfer.info.channelId)?.get(socket.id);
    if (peer) peer.mic = mic;
    publish(transfer.info.channelId);
    publishDevices(io, options.user.id);
    ack({ ok: true, mic });
  });

  socket.on('call:join', async (payload: unknown, ack: unknown) => {
    if (typeof ack !== 'function') return;
    const reply = ack as (response: unknown) => void;
    if (Date.now() - joinWindowStart > 10_000) { joinRequests = 0; joinWindowStart = Date.now(); }
    if (++joinRequests > 20) return reply({ ok: false, error: 'Çok fazla görüşme isteği. Birkaç saniye sonra tekrar deneyin.' });
    const channelId = (payload as { channelId?: unknown } | null)?.channelId;
    const transferId = (payload as { transferId?: unknown } | null)?.transferId;
    if (typeof channelId !== 'string' || channelId.length > 128) return reply({ ok: false, error: 'Geçersiz görüşme kanalı.' });
    if (joining) return reply({ ok: false, error: 'Görüşmeye katılma işlemi devam ediyor.' });
    joining = true;
    const version = ++joinVersion;
    try {
      const transfer = typeof transferId === 'string' ? registry!.transfers.get(transferId) : undefined;
      if (transferId !== undefined && (!transfer || transfer.targetSocketId !== socket.id
        || transfer.info.channelId !== channelId || transfer.state !== 'pending' || channels.has(socket.id)
        || !await transferHasAccess(io, registry!, transfer)))
        return reply({ ok: false, error: 'Aktarım isteği artık geçerli değil.' });
      if (!await options.canAccessChannel(channelId)) return reply({ ok: false, error: 'Bu görüşmeye erişiminiz yok.' });
      if (!socket.connected || version !== joinVersion) return reply({ ok: false, error: 'Görüşme isteği iptal edildi.' });
      if (transfer && (registry!.transfers.get(transfer.info.id) !== transfer || channels.get(transfer.info.sourceSocketId) !== channelId))
        return reply({ ok: false, error: 'Aktarım isteği iptal edildi.' });
      const existing = rooms.get(channelId);
      if (existing && workspaces.get(channelId) !== options.workspaceId) return reply({ ok: false, error: 'Bu görüşmeye erişiminiz yok.' });
      const stagedCount = [...registry!.transfers.values()].filter(item => item.info.channelId === channelId
        && item.state !== 'pending' && existing?.has(item.targetSocketId)).length;
      if (!transfer && existing && !existing.has(socket.id) && existing.size - stagedCount >= MAX_PARTICIPANTS) return reply({ ok: false, error: 'Bu görüşme dolu. En fazla 6 kişi katılabilir.' });
      const isVoice = options.getVoiceChannelIds().includes(channelId);
      if (channels.get(socket.id) !== channelId) leave(transfer?.info.id);
      const room = rooms.get(channelId) ?? new Map<string, CallPeer>();
      const user = socket.data.user?.id === options.user.id ? socket.data.user as User : options.user;
      if (!room.has(socket.id)) room.set(socket.id, { socketId: socket.id, user, mic: !transfer, camera: false, sharing: false });
      rooms.set(channelId, room);
      workspaces.set(channelId, options.workspaceId);
      if (isVoice) voiceChannels.add(channelId);
      channels.set(socket.id, channelId);
      if (transfer) transfer.state = 'staged';
      await socket.join(roomName(channelId));
      if (!socket.connected || channels.get(socket.id) !== channelId) { leave(); return; }
      reply({ ok: true, peers: [...room.values()], ...(transfer ? { transferId: transfer.info.id } : {}) });
      publish(channelId);
      publishDevices(io, options.user.id);
    } catch {
      if (channels.get(socket.id) === channelId) leave();
      reply({ ok: false, error: 'Görüşmeye katılınamadı. Yeniden deneyin.' });
    }
    finally { joining = false; }
  });

  socket.on('call:leave', () => { joinVersion++; leave(); });
  socket.on('disconnect', () => { registry.subscribers.delete(socket.id); joinVersion++; leave(); publishDevices(io, options.user.id); });
  socket.on('call:state', (payload: unknown) => {
    if (!payload || typeof payload !== 'object') return;
    if (Date.now() - stateWindowStart > 10_000) { stateChanges = 0; stateWindowStart = Date.now(); }
    if (++stateChanges > 50) return;
    const channelId = channels.get(socket.id);
    const peer = channelId ? rooms.get(channelId)?.get(socket.id) : undefined;
    if (!peer || !channelId) return;
    const transfer = transferForSocket(registry!, socket.id);
    if (transfer?.targetSocketId === socket.id) return;
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
