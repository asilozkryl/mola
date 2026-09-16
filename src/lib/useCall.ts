import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import type { CallPeer, User, VoiceChannelRoster } from "../../shared/types";
import { subscribeVoiceRoster } from "./voiceRoster";
import type {
  CallPreferences,
  ConnectionQuality,
  CallTransfer,
  CallTransferStatus,
  CallTransferAck,
  CallDevicesAck,
} from "../../shared/call-types";
import { useCallActivity } from "./useCallActivity";

export interface CallParticipant extends CallPeer {
  stream: MediaStream | null;
  screen: MediaStream | null;
  connectionState: RTCPeerConnectionState;
  speaking?: boolean;
  quality?: ConnectionQuality;
}
interface PeerSession {
  pc: RTCPeerConnection;
  user: CallPeer;
  stream: MediaStream;
  screen: MediaStream;
  makingOffer: boolean;
  ignoreOffer: boolean;
  remoteAnswerPending: boolean;
  candidates: RTCIceCandidateInit[];
  initiator: boolean;
  audio?: RTCRtpTransceiver;
  camera?: RTCRtpTransceiver;
  display?: RTCRtpTransceiver;
  iceRestarts: number;
  chain: Promise<void>;
}
type CallSignal = {
  from: string;
  channelId: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  renegotiate?: boolean;
};
type JoinAck = { ok: boolean; error?: string; peers?: CallPeer[] };
type TransferState = {
  details: CallTransfer;
  direction: "incoming" | "outgoing";
  phase: "waiting" | "connecting";
};

function mediaError(
  error: unknown,
  kind: "microphone" | "camera" | "screen",
): string {
  const name = error instanceof DOMException ? error.name : "";
  const device =
    kind === "camera"
      ? "Kamera"
      : kind === "screen"
        ? "Ekran paylaşımı"
        : "Mikrofon";
  if (name === "NotAllowedError" || name === "PermissionDeniedError")
    return `${device} izni verilmedi. Tarayıcınızın site izinlerinden erişimi açıp yeniden deneyin.`;
  if (name === "NotFoundError" || name === "DevicesNotFoundError")
    return `${device} bulunamadı. Cihaz bağlantınızı kontrol edin.`;
  if (name === "NotReadableError")
    return `${device} başka bir uygulama tarafından kullanılıyor olabilir. Diğer uygulamayı kapatıp yeniden deneyin.`;
  return `${device} başlatılamadı. Cihazınızı ve tarayıcı izinlerinizi kontrol edin.`;
}
const stopStream = (stream: MediaStream | null) =>
  stream?.getTracks().forEach((track) => track.stop());
const disconnectedMicrophone =
  "Mikrofon bağlantısı kesildi. Ses ayarlarından başka bir mikrofon seçin.";

export function useCall({
  socket,
  user,
  workspaceId,
  initialVoiceChannels,
}: {
  socket: Socket | null;
  user: User | null;
  workspaceId: string | null;
  initialVoiceChannels?: VoiceChannelRoster[];
}) {
  const [voiceRoster, setVoiceRoster] = useState<{
    workspaceId: string | null;
    channels: VoiceChannelRoster[];
  }>({ workspaceId, channels: initialVoiceChannels ?? [] });
  const [channelId, setChannelId] = useState<string | null>(null);
  const [channelName, setChannelName] = useState("");
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [localScreen, setLocalScreen] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState<CallParticipant[]>([]);
  const [mic, setMic] = useState(true);
  const [camera, setCamera] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [relayConfigured, setRelayConfigured] = useState(true);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [transfer, setTransfer] = useState<TransferState | null>(null);
  const transferRef = useRef<TransferState | null>(null);
  const requestInFlight = useRef(false);
  const [transferRequesting, setTransferRequesting] = useState(false);
  const [transferNotice, setTransferNotice] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const [devicesRevision, setDevicesRevision] = useState(0);
  const completedTransfers = useRef(new Map<string, CallTransferStatus>());
  const receiveTransferStatus = useRef<(status: CallTransferStatus) => void>(
    () => {},
  );
  const cancelInFlight = useRef<string | null>(null);
  const readySent = useRef<string | null>(null);
  const [preferences, updatePreferences] = useState<CallPreferences>({
    inputDeviceId: "",
    outputDeviceId: "",
    startMuted: false,
  });
  const preferencesRef = useRef(preferences);
  const currentChannel = useRef<string | null>(null);
  const joinTarget = useRef<{ id: string; name: string } | null>(null);
  const sessionVersion = useRef(0);
  const local = useRef<MediaStream | null>(null);
  const screen = useRef<MediaStream | null>(null);
  const connections = useRef(new Map<string, PeerSession>());
  const iceConfig = useRef<RTCConfiguration>({ iceServers: [] });
  const mediaOperation = useRef(false);
  const joiningRef = useRef(false);
  const joinedRef = useRef(false);
  const pendingSignals = useRef<CallSignal[]>([]);
  const stateRef = useRef({ mic: true, camera: false, sharing: false });

  const setPreferences = useCallback((patch: Partial<CallPreferences>) => {
    preferencesRef.current = { ...preferencesRef.current, ...patch };
    updatePreferences(preferencesRef.current);
  }, []);

  const { speaking, quality } = useCallActivity({
    joined,
    localStream,
    connections,
    stateRef,
  });

  useEffect(() => {
    setVoiceRoster({ workspaceId, channels: initialVoiceChannels ?? [] });
    if (!socket || !workspaceId) return;
    return subscribeVoiceRoster(socket, workspaceId, (channels) =>
      setVoiceRoster({ workspaceId, channels }),
    );
  }, [socket, workspaceId, initialVoiceChannels]);

  const syncPeers = useCallback(() => {
    setPeers(
      [...connections.current.values()].map((p) => ({
        ...p.user,
        stream: p.stream,
        screen: p.screen,
        connectionState: p.pc.connectionState,
      })),
    );
  }, []);

  const leave = useCallback(() => {
    if (transferRef.current)
      socket?.emit("call:transfer:cancel", {
        transferId: transferRef.current.details.id,
      });
    transferRef.current = null;
    setTransfer(null);
    readySent.current = null;
    sessionVersion.current += 1;
    if (currentChannel.current || joiningRef.current)
      socket?.emit("call:leave");
    currentChannel.current = null;
    joinTarget.current = null;
    joinedRef.current = false;
    joiningRef.current = false;
    // A dismissed browser picker may settle long after leaving. The next call
    // must be able to start its own media operation immediately.
    mediaOperation.current = false;
    setMediaBusy(false);
    for (const p of connections.current.values()) {
      p.pc.onconnectionstatechange = null;
      p.pc.onicecandidate = null;
      p.pc.onnegotiationneeded = null;
      p.pc.close();
      stopStream(p.stream);
      stopStream(p.screen);
    }
    connections.current.clear();
    pendingSignals.current = [];
    stopStream(local.current);
    stopStream(screen.current);
    local.current = null;
    screen.current = null;
    stateRef.current = { mic: true, camera: false, sharing: false };
    setChannelId(null);
    setChannelName("");
    setJoined(false);
    setJoining(false);
    setLocalStream(null);
    setLocalScreen(null);
    setPeers([]);
    setMic(true);
    setCamera(false);
    setSharing(false);
    setError(null);
  }, [socket]);

  const publishState = useCallback(
    (patch: Partial<typeof stateRef.current>) => {
      stateRef.current = { ...stateRef.current, ...patch };
      socket?.emit("call:state", stateRef.current);
    },
    [socket],
  );

  useEffect(() => {
    if (!socket || !workspaceId) return;
    const register = () => socket.emit("call:devices:register", () => {});
    const changed = () => setDevicesRevision((value) => value + 1);
    const incoming = (details: CallTransfer) => {
      if (
        joinedRef.current ||
        joiningRef.current ||
        transferRef.current ||
        requestInFlight.current
      ) {
        socket.emit("call:transfer:cancel", { transferId: details.id });
        return;
      }
      const next: TransferState = {
        details,
        direction: "incoming",
        phase: "waiting",
      };
      transferRef.current = next;
      setTransfer(next);
    };
    const status = (result: CallTransferStatus) => {
      completedTransfers.current.set(result.id, result);
      if (completedTransfers.current.size > 64)
        completedTransfers.current.delete(
          completedTransfers.current.keys().next().value!,
        );
      const current = transferRef.current;
      if (!current || current.details.id !== result.id) return;
      transferRef.current = null;
      setTransfer(null);
      readySent.current = null;
      if (result.state === "completed") {
        if (current.direction === "outgoing") leave();
        else if (joinedRef.current) {
          const enabled = result.mic ?? current.details.mic;
          local.current?.getAudioTracks().forEach((track) => {
            track.enabled = enabled;
          });
          setMic(enabled);
          publishState({ mic: enabled });
        }
        setTransferNotice({
          message:
            current.direction === "outgoing"
              ? `Görüşme ${current.details.targetDevice} cihazına aktarıldı.`
              : "Görüşme bu cihazda devam ediyor.",
          error: false,
        });
      } else {
        if (current.direction === "incoming" && current.phase === "connecting")
          leave();
        setTransferNotice({
          message:
            result.reason ||
            "Aktarım iptal edildi. Görüşme önceki cihazda devam ediyor.",
          error: false,
        });
      }
    };
    const disconnected = () => {
      transferRef.current = null;
      setTransfer(null);
      requestInFlight.current = false;
      setTransferRequesting(false);
      changed();
    };
    receiveTransferStatus.current = status;
    socket.on("connect", register);
    socket.on("call:devices:changed", changed);
    socket.on("call:transfer:incoming", incoming);
    socket.on("call:transfer:status", status);
    socket.on("disconnect", disconnected);
    if (socket.connected) register();
    return () => {
      socket.off("connect", register);
      socket.off("call:devices:changed", changed);
      socket.off("call:transfer:incoming", incoming);
      socket.off("call:transfer:status", status);
      socket.off("disconnect", disconnected);
    };
  }, [socket, workspaceId, leave, publishState]);

  const getTransferDevices = useCallback(async () => {
    if (!socket?.connected)
      throw new Error("Cihazları görmek için sunucu bağlantısını bekleyin.");
    const result = (await socket
      .timeout(8_000)
      .emitWithAck("call:devices:list")) as CallDevicesAck;
    if (!result.ok) throw new Error(result.error);
    return result.devices;
  }, [socket]);

  const requestTransfer = useCallback(
    async (deviceId: string) => {
      if (
        !socket?.connected ||
        !joinedRef.current ||
        transferRef.current ||
        requestInFlight.current
      )
        return;
      const version = sessionVersion.current;
      requestInFlight.current = true;
      setTransferRequesting(true);
      try {
        const result = (await socket
          .timeout(8_000)
          .emitWithAck("call:transfer:request", {
            deviceId,
          })) as CallTransferAck;
        if (!result.ok) throw new Error(result.error);
        if (version !== sessionVersion.current || !joinedRef.current) {
          socket.emit("call:transfer:cancel", {
            transferId: result.transfer.id,
          });
          return;
        }
        const next: TransferState = {
          details: result.transfer,
          direction: "outgoing",
          phase: "waiting",
        };
        transferRef.current = next;
        setTransfer(next);
        const terminal = completedTransfers.current.get(result.transfer.id);
        if (terminal) receiveTransferStatus.current(terminal);
      } catch (error) {
        if (version === sessionVersion.current)
          setTransferNotice({
            message:
              error instanceof Error
                ? error.message
                : "Aktarım isteği gönderilemedi.",
            error: true,
          });
      } finally {
        requestInFlight.current = false;
        setTransferRequesting(false);
      }
    },
    [socket],
  );

  const cancelTransfer = useCallback(() => {
    const current = transferRef.current;
    if (
      !current ||
      !socket?.connected ||
      cancelInFlight.current === current.details.id
    )
      return;
    const id = current.details.id;
    cancelInFlight.current = id;
    // Completion may have committed before this click. Preserve media/state
    // until the server's ordered terminal event decides which action won.
    void socket
      .timeout(8_000)
      .emitWithAck("call:transfer:cancel", { transferId: id })
      .then((result: { ok: boolean }) => {
        if (result.ok && transferRef.current?.details.id === id)
          receiveTransferStatus.current({ id, state: "cancelled" });
      })
      .catch(() => {
        if (transferRef.current?.details.id === id)
          setTransferNotice({
            message:
              "İptal sonucu henüz doğrulanamadı. Sunucu yanıtı bekleniyor.",
            error: true,
          });
      })
      .finally(() => {
        if (cancelInFlight.current === id) cancelInFlight.current = null;
      });
  }, [socket]);

  const clearTransferNotice = useCallback(() => setTransferNotice(null), []);

  const createPeer = useCallback(
    (peer: CallPeer) => {
      const existing = connections.current.get(peer.socketId);
      if (existing) {
        existing.user = peer;
        return existing;
      }
      const pc = new RTCPeerConnection(iceConfig.current);
      const session: PeerSession = {
        pc,
        user: peer,
        stream: new MediaStream(),
        screen: new MediaStream(),
        makingOffer: false,
        ignoreOffer: false,
        remoteAnswerPending: false,
        candidates: [],
        initiator: String(socket?.id) < peer.socketId,
        iceRestarts: 0,
        chain: Promise.resolve(),
      };
      connections.current.set(peer.socketId, session);
      const send = (data: object) => {
        if (
          currentChannel.current &&
          connections.current.get(peer.socketId) === session
        )
          socket?.emit("call:signal", { to: peer.socketId, ...data });
      };
      // The designated offerer creates the media slots. The answerer adopts them after
      // setRemoteDescription so concurrent joins cannot duplicate transceivers.
      if (session.initiator) {
        session.audio = pc.addTransceiver(
          local.current?.getAudioTracks()[0] ?? "audio",
          { direction: "sendrecv" },
        );
        session.camera = pc.addTransceiver(
          local.current?.getVideoTracks()[0] ?? "video",
          { direction: "sendrecv" },
        );
        session.display = pc.addTransceiver(
          screen.current?.getVideoTracks()[0] ?? "video",
          { direction: "sendrecv" },
        );
      }
      pc.onicecandidate = ({ candidate }) => {
        if (candidate) send({ candidate: candidate.toJSON() });
      };
      pc.ontrack = (event) => {
        const streamTarget =
          event.transceiver.mid === "2" ? session.screen : session.stream;
        if (
          !streamTarget.getTracks().some((track) => track.id === event.track.id)
        )
          streamTarget.addTrack(event.track);
        event.track.onunmute = syncPeers;
        event.track.onended = () => {
          streamTarget.removeTrack(event.track);
          syncPeers();
        };
        syncPeers();
      };
      pc.onconnectionstatechange = () => {
        syncPeers();
        if (pc.connectionState === "failed") {
          if (session.iceRestarts < 2) {
            session.iceRestarts++;
            if (session.initiator) pc.restartIce();
            else send({ renegotiate: true });
          } else
            setError(
              `${peer.user.name} ile ses bağlantısı kurulamadı. Ağınızı kontrol edip görüşmeye yeniden katılın.`,
            );
        }
      };
      pc.onnegotiationneeded = async () => {
        if (!session.initiator || pc.signalingState === "closed") return;
        try {
          session.makingOffer = true;
          await pc.setLocalDescription();
          if (pc.localDescription)
            send({
              description: {
                type: pc.localDescription.type,
                sdp: pc.localDescription.sdp,
              },
            });
        } catch {
          if (pc.connectionState !== "closed")
            setError(
              "Görüşme bağlantısı kurulamadı. Yeniden katılmayı deneyin.",
            );
        } finally {
          session.makingOffer = false;
        }
      };
      return session;
    },
    [socket, syncPeers],
  );

  const handleSignal = useCallback(
    (signal: CallSignal) => {
      if (signal.channelId !== currentChannel.current) return;
      const p = connections.current.get(signal.from);
      if (!p) {
        if (pendingSignals.current.length < 128)
          pendingSignals.current.push(signal);
        return;
      }
      // Serialize descriptions and ICE: addIceCandidate must follow the associated SDP.
      p.chain = p.chain
        .then(async () => {
          const { pc } = p;
          if (pc.signalingState === "closed") return;
          if (signal.renegotiate && p.initiator) {
            pc.restartIce();
            return;
          }
          if (signal.description) {
            const ready =
              !p.makingOffer &&
              (pc.signalingState === "stable" || p.remoteAnswerPending);
            const collision = signal.description.type === "offer" && !ready;
            p.ignoreOffer = p.initiator && collision;
            if (p.ignoreOffer) return;
            p.remoteAnswerPending = signal.description.type === "answer";
            await pc.setRemoteDescription(signal.description);
            p.remoteAnswerPending = false;
            if (!p.audio) {
              const transceivers = pc.getTransceivers();
              p.audio = transceivers.find((t) => t.mid === "0");
              p.camera = transceivers.find((t) => t.mid === "1");
              p.display = transceivers.find((t) => t.mid === "2");
              for (const t of [p.audio, p.camera, p.display])
                if (t) t.direction = "sendrecv";
              await Promise.all([
                p.audio?.sender.replaceTrack(
                  local.current?.getAudioTracks()[0] ?? null,
                ),
                p.camera?.sender.replaceTrack(
                  local.current?.getVideoTracks()[0] ?? null,
                ),
                p.display?.sender.replaceTrack(
                  screen.current?.getVideoTracks()[0] ?? null,
                ),
              ]);
            }
            for (const candidate of p.candidates.splice(0))
              await pc.addIceCandidate(candidate);
            if (signal.description.type === "offer") {
              await pc.setLocalDescription();
              if (pc.localDescription)
                socket?.emit("call:signal", {
                  to: signal.from,
                  description: {
                    type: pc.localDescription.type,
                    sdp: pc.localDescription.sdp,
                  },
                });
            }
          } else if (signal.candidate && !p.ignoreOffer) {
            if (pc.remoteDescription)
              await pc.addIceCandidate(signal.candidate);
            else if (p.candidates.length < 128)
              p.candidates.push(signal.candidate);
          }
        })
        .catch(() => {
          if (p.pc.signalingState !== "closed")
            setError(
              "Bir katılımcıyla bağlantı kurulamadı. Yeniden katılmayı deneyin.",
            );
        });
    },
    [socket],
  );

  const updatePeers = useCallback(
    (list: CallPeer[]) => {
      const others = list.filter((p) => p.socketId !== socket?.id);
      const ids = new Set(others.map((p) => p.socketId));
      for (const [id, p] of connections.current)
        if (!ids.has(id)) {
          p.pc.onconnectionstatechange = null;
          p.pc.close();
          stopStream(p.stream);
          stopStream(p.screen);
          connections.current.delete(id);
        }
      for (const peer of others) createPeer(peer);
      syncPeers();
      const queued = pendingSignals.current.splice(0);
      queued.forEach(handleSignal);
    },
    [socket, createPeer, syncPeers, handleSignal],
  );

  useEffect(() => {
    if (!socket) return;
    const onPeers = (payload: { channelId: string; peers: CallPeer[] }) => {
      if (payload.channelId === currentChannel.current && joinedRef.current)
        updatePeers(payload.peers);
    };
    const onDisconnect = () => {
      if (currentChannel.current || joiningRef.current) {
        const retry = joinTarget.current;
        leave();
        // Keep only the retry destination; all media and peer state stay closed.
        if (retry) {
          setChannelId(retry.id);
          setChannelName(retry.name);
        }
        setError(
          "Sunucu bağlantısı kesildi. Bağlantı döndüğünde görüşmeye yeniden katılın.",
        );
      }
    };
    const onClosed = (payload: { channelId: string; error: string }) => {
      if (payload.channelId !== currentChannel.current) return;
      leave();
      setError(payload.error || "Bu görüşme yönetici tarafından kapatıldı.");
    };
    socket.on("call:peers", onPeers);
    socket.on("call:closed", onClosed);
    socket.on("call:signal", handleSignal);
    socket.on("disconnect", onDisconnect);
    return () => {
      socket.off("call:peers", onPeers);
      socket.off("call:closed", onClosed);
      socket.off("call:signal", handleSignal);
      socket.off("disconnect", onDisconnect);
      leave();
    };
  }, [socket, workspaceId, updatePeers, handleSignal, leave]);

  useEffect(() => {
    if (!joined) return;
    // Refresh expiring TURN credentials before the one-hour lease, including the
    // credentials used by an ICE restart after a network change in a long call.
    const timer = window.setInterval(() => {
      const version = sessionVersion.current;
      void fetch("/api/rtc/config", {
        credentials: "same-origin",
        signal: AbortSignal.timeout(8_000),
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("rtc-config");
          const config = (await response.json()) as {
            iceServers: RTCIceServer[];
          };
          if (version !== sessionVersion.current || !joinedRef.current) return;
          iceConfig.current = {
            iceServers: config.iceServers,
            bundlePolicy: "max-bundle",
          };
          for (const p of connections.current.values())
            if (p.pc.connectionState !== "closed") {
              p.pc.setConfiguration(iceConfig.current);
              if (p.initiator) p.pc.restartIce();
            }
        })
        .catch(() => {
          if (version === sessionVersion.current)
            setError(
              "Görüşme bağlantısı yenilenemedi. Ağ bağlantınızı kontrol edin.",
            );
        });
    }, 25 * 60_000);
    return () => window.clearInterval(timer);
  }, [joined]);

  const join = useCallback(
    async (channel: { id: string; name: string }, handoff?: CallTransfer) => {
      if (
        joiningRef.current ||
        (currentChannel.current === channel.id && joinedRef.current)
      )
        return;
      // Keep the accepted offer while resetting any earlier local call state.
      if (handoff) transferRef.current = null;
      leave();
      if (handoff) {
        const next: TransferState = {
          details: handoff,
          direction: "incoming",
          phase: "connecting",
        };
        transferRef.current = next;
        setTransfer(next);
      }
      const version = sessionVersion.current;
      setChannelId(channel.id);
      setChannelName(channel.name);
      joinTarget.current = channel;
      setJoining(true);
      setError(null);
      joiningRef.current = true;
      if (!socket?.connected || !user) {
        if (handoff) cancelTransfer();
        setError("Görüşmeye katılmak için sunucu bağlantısını bekleyin.");
        setJoining(false);
        joiningRef.current = false;
        return;
      }
      if (
        !window.isSecureContext ||
        !navigator.mediaDevices?.getUserMedia ||
        !window.RTCPeerConnection
      ) {
        if (handoff) cancelTransfer();
        setError(
          "Görüşmeler için HTTPS bağlantısı ve güncel bir tarayıcı gerekli.",
        );
        setJoining(false);
        joiningRef.current = false;
        return;
      }
      let acquired: MediaStream | null = null;
      try {
        try {
          acquired = await navigator.mediaDevices.getUserMedia({
            audio: {
              ...(preferencesRef.current.inputDeviceId
                ? { deviceId: { exact: preferencesRef.current.inputDeviceId } }
                : {}),
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video: false,
          });
        } catch (err) {
          throw new Error(mediaError(err, "microphone"));
        }
        if (version !== sessionVersion.current) {
          stopStream(acquired);
          return;
        }
        // Make capture immediately reachable by leave(), including while the RTC
        // configuration request is still in flight.
        local.current = acquired;
        if (
          !acquired
            .getAudioTracks()
            .some((track) => track.readyState === "live")
        )
          throw new Error("Mikrofon bulunamadı.");
        acquired.getAudioTracks().forEach((track) => {
          track.enabled = !handoff && !preferencesRef.current.startMuted;
        });
        let config: { iceServers: RTCIceServer[]; relayConfigured?: boolean };
        try {
          const response = await fetch("/api/rtc/config", {
            credentials: "same-origin",
            signal: AbortSignal.timeout(8_000),
          });
          if (!response.ok) throw new Error("rtc-config");
          config = (await response.json()) as typeof config;
          if (!Array.isArray(config.iceServers)) throw new Error("rtc-config");
        } catch {
          throw new Error(
            "Görüşme ayarları alınamadı. Ağ bağlantınızı kontrol edip yeniden deneyin.",
          );
        }
        if (version !== sessionVersion.current) {
          stopStream(acquired);
          return;
        }
        iceConfig.current = {
          iceServers: config.iceServers,
          bundlePolicy: "max-bundle",
        };
        setRelayConfigured(config.relayConfigured !== false);
        setLocalStream(acquired);
        acquired.getAudioTracks().forEach((track) => {
          track.onended = () => {
            if (version !== sessionVersion.current) return;
            setMic(false);
            publishState({ mic: false });
            setError(disconnectedMicrophone);
          };
        });
        currentChannel.current = channel.id;
        const ack = await new Promise<JoinAck>((resolve, reject) =>
          socket.timeout(8_000).emit(
            "call:join",
            {
              channelId: channel.id,
              ...(handoff ? { transferId: handoff.id } : {}),
            },
            (err: Error | null, result: JoinAck) =>
              err
                ? reject(
                    new Error(
                      "Görüşme isteği zaman aşımına uğradı. Tekrar deneyin.",
                    ),
                  )
                : resolve(result),
          ),
        );
        if (version !== sessionVersion.current) {
          stopStream(acquired);
          return;
        }
        if (!ack.ok) throw new Error(ack.error ?? "Görüşmeye katılınamadı.");
        joinedRef.current = true;
        setJoined(true);
        setJoining(false);
        joiningRef.current = false;
        setMic(!handoff && !preferencesRef.current.startMuted);
        publishState({ mic: !handoff && !preferencesRef.current.startMuted });
        updatePeers(ack.peers ?? []);
      } catch (err) {
        stopStream(acquired);
        if (version !== sessionVersion.current) return;
        const message =
          err instanceof Error
            ? err.message
            : "Görüşmeye katılınamadı. Yeniden deneyin.";
        leave();
        setChannelId(channel.id);
        setChannelName(channel.name);
        setError(message);
      }
    },
    [socket, user, leave, updatePeers, publishState, cancelTransfer],
  );

  const acceptTransfer = useCallback(async () => {
    const current = transferRef.current;
    if (
      !current ||
      current.direction !== "incoming" ||
      current.phase !== "waiting" ||
      joinedRef.current ||
      joiningRef.current
    )
      return;
    await join(
      { id: current.details.channelId, name: current.details.channelName },
      current.details,
    );
  }, [join]);

  useEffect(() => {
    if (
      !socket ||
      !joined ||
      transfer?.direction !== "incoming" ||
      transfer.phase !== "connecting" ||
      readySent.current === transfer.details.id
    )
      return;
    // The join ACK only confirms room admission. Keep both capture and playback
    // silent until WebRTC has connected to everyone except the departing device.
    if (
      !local.current
        ?.getAudioTracks()
        .some((track) => track.readyState === "live")
    )
      return;
    if (
      [...connections.current.values()].some(
        (peer) =>
          peer.user.socketId !== transfer.details.sourceSocketId &&
          peer.pc.connectionState !== "connected",
      )
    )
      return;
    const id = transfer.details.id;
    readySent.current = id;
    void socket
      .timeout(8_000)
      .emitWithAck("call:transfer:ready", { transferId: id })
      .then((result: { ok: boolean; error?: string }) => {
        if (!result.ok && transferRef.current?.details.id === id) {
          cancelTransfer();
          setTransferNotice({
            message:
              result.error ||
              "Aktarım tamamlanamadı. Önceki cihazda devam edebilirsin.",
            error: true,
          });
        }
      })
      .catch(() => {
        if (transferRef.current?.details.id !== id) return;
        cancelTransfer();
        setTransferNotice({
          message:
            "Aktarım bağlantısı zaman aşımına uğradı. Önceki cihazda devam edebilirsin.",
          error: true,
        });
      });
  }, [socket, joined, transfer, peers, cancelTransfer]);

  const toggleMic = useCallback(() => {
    if (!joinedRef.current || transferRef.current?.direction === "incoming")
      return;
    if (
      !local.current
        ?.getAudioTracks()
        .some((track) => track.readyState === "live")
    ) {
      setError(disconnectedMicrophone);
      return;
    }
    const enabled = !stateRef.current.mic;
    local.current?.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
    setMic(enabled);
    publishState({ mic: enabled });
  }, [publishState]);

  const selectInputDevice = useCallback(
    async (deviceId: string) => {
      if (transferRef.current?.direction === "incoming")
        throw new Error(
          "Cihaz değişimi için aktarımın tamamlanmasını bekleyin.",
        );
      if (!joinedRef.current) {
        setPreferences({ inputDeviceId: deviceId });
        return;
      }
      if (mediaOperation.current)
        throw new Error("Devam eden cihaz işlemini bekleyin.");
      mediaOperation.current = true;
      setMediaBusy(true);
      const version = sessionVersion.current;
      let acquired: MediaStream | null = null;
      const oldTrack = local.current?.getAudioTracks()[0] ?? null;
      try {
        acquired = await navigator.mediaDevices.getUserMedia({
          audio: {
            ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
        if (version !== sessionVersion.current) {
          stopStream(acquired);
          return;
        }
        const track = acquired.getAudioTracks()[0];
        if (!track) throw new Error("Mikrofon bulunamadı.");
        // Senders may switch at different times. Keep the candidate silent while
        // the old local track still owns the microphone toggle, then apply the
        // latest state once replacement succeeds for the whole call.
        track.enabled = false;
        const results = await Promise.allSettled(
          [...connections.current.values()].map((p) =>
            p.audio?.sender.replaceTrack(track),
          ),
        );
        if (version !== sessionVersion.current) {
          stopStream(acquired);
          return;
        }
        if (results.some((result) => result.status === "rejected")) {
          await Promise.allSettled(
            [...connections.current.values()].map((p) =>
              p.audio?.sender.replaceTrack(oldTrack),
            ),
          );
          throw new Error("Mikrofon değiştirilemedi. Yeniden deneyin.");
        }
        if (oldTrack) {
          oldTrack.onended = null;
          local.current?.removeTrack(oldTrack);
          oldTrack.stop();
        }
        local.current?.addTrack(track);
        track.enabled = stateRef.current.mic;
        track.onended = () => {
          if (version !== sessionVersion.current) return;
          setMic(false);
          publishState({ mic: false });
          setError(disconnectedMicrophone);
        };
        setLocalStream(new MediaStream(local.current?.getTracks() ?? [track]));
        setPreferences({ inputDeviceId: deviceId });
        setError((current) =>
          current === disconnectedMicrophone ? null : current,
        );
      } catch (err) {
        stopStream(acquired);
        if (version === sessionVersion.current)
          throw new Error(mediaError(err, "microphone"));
      } finally {
        if (version === sessionVersion.current) {
          mediaOperation.current = false;
          setMediaBusy(false);
        }
      }
    },
    [setPreferences, publishState],
  );

  const toggleCamera = useCallback(async () => {
    if (
      !joinedRef.current ||
      mediaOperation.current ||
      transferRef.current?.direction === "incoming"
    )
      return;
    mediaOperation.current = true;
    setMediaBusy(true);
    setError(null);
    const version = sessionVersion.current;
    let acquired: MediaStream | null = null;
    try {
      if (stateRef.current.camera) {
        local.current?.getVideoTracks().forEach((track) => {
          local.current?.removeTrack(track);
          track.stop();
        });
        setCamera(false);
        publishState({ camera: false });
        await Promise.allSettled(
          [...connections.current.values()].map((p) =>
            p.camera?.sender.replaceTrack(null),
          ),
        );
      } else {
        acquired = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280, max: 1280 },
            height: { ideal: 720, max: 720 },
            frameRate: { ideal: 24, max: 30 },
          },
          audio: false,
        });
        if (version !== sessionVersion.current) {
          stopStream(acquired);
          return;
        }
        const track = acquired.getVideoTracks()[0];
        local.current?.addTrack(track);
        await Promise.all(
          [...connections.current.values()].map((p) =>
            p.camera?.sender.replaceTrack(track),
          ),
        );
        if (version !== sessionVersion.current) {
          stopStream(acquired);
          return;
        }
        track.onended = () => {
          if (version !== sessionVersion.current) return;
          local.current?.removeTrack(track);
          void Promise.allSettled(
            [...connections.current.values()].map((p) =>
              p.camera?.sender.replaceTrack(null),
            ),
          );
          setCamera(false);
          publishState({ camera: false });
          if (local.current)
            setLocalStream(new MediaStream(local.current.getTracks()));
          setError(
            "Kamera bağlantısı kesildi. Cihazınızı kontrol edip kamerayı yeniden açın.",
          );
        };
        setCamera(true);
        publishState({ camera: true });
      }
      if (local.current)
        setLocalStream(new MediaStream(local.current.getTracks()));
    } catch (err) {
      acquired
        ?.getTracks()
        .forEach((track) => local.current?.removeTrack(track));
      stopStream(acquired);
      if (version === sessionVersion.current) {
        void Promise.allSettled(
          [...connections.current.values()].map((p) =>
            p.camera?.sender.replaceTrack(null),
          ),
        );
        setError(mediaError(err, "camera"));
      }
    } finally {
      if (version === sessionVersion.current) {
        mediaOperation.current = false;
        setMediaBusy(false);
      }
    }
  }, [publishState]);

  const toggleScreen = useCallback(async () => {
    if (
      !joinedRef.current ||
      mediaOperation.current ||
      transferRef.current?.direction === "incoming"
    )
      return;
    if (!stateRef.current.sharing && !navigator.mediaDevices.getDisplayMedia) {
      setError(
        "Ekran paylaşımı bu tarayıcıda desteklenmiyor. Bilgisayarınızın tarayıcısından katılmayı deneyin.",
      );
      return;
    }
    mediaOperation.current = true;
    setMediaBusy(true);
    setError(null);
    const version = sessionVersion.current;
    let acquired: MediaStream | null = null;
    const stop = async (expected = screen.current) => {
      if (!expected || screen.current !== expected) return;
      expected.getTracks().forEach((track) => {
        track.onended = null;
      });
      stopStream(expected);
      screen.current = null;
      setLocalScreen(null);
      setSharing(false);
      publishState({ sharing: false });
      await Promise.allSettled(
        [...connections.current.values()].map((p) =>
          p.display?.sender.replaceTrack(null),
        ),
      );
    };
    try {
      if (stateRef.current.sharing) await stop();
      else {
        acquired = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { max: 1920 },
            height: { max: 1080 },
            frameRate: { ideal: 15, max: 30 },
          },
          audio: false,
        });
        if (version !== sessionVersion.current) {
          stopStream(acquired);
          return;
        }
        const track = acquired.getVideoTracks()[0];
        screen.current = acquired;
        await Promise.all(
          [...connections.current.values()].map((p) =>
            p.display?.sender.replaceTrack(track),
          ),
        );
        if (version !== sessionVersion.current) {
          stopStream(acquired);
          return;
        }
        setLocalScreen(acquired);
        setSharing(true);
        publishState({ sharing: true });
        track.onended = () => {
          if (version === sessionVersion.current) void stop(acquired);
        };
      }
    } catch (err) {
      stopStream(acquired);
      if (version === sessionVersion.current) {
        if (screen.current === acquired) screen.current = null;
        void Promise.allSettled(
          [...connections.current.values()].map((p) =>
            p.display?.sender.replaceTrack(null),
          ),
        );
        if (!(err instanceof DOMException && err.name === "NotAllowedError"))
          setError(mediaError(err, "screen"));
      }
    } finally {
      if (version === sessionVersion.current) {
        mediaOperation.current = false;
        setMediaBusy(false);
      }
    }
  }, [publishState]);

  return {
    voiceChannels:
      voiceRoster.workspaceId === workspaceId ? voiceRoster.channels : [],
    channelId,
    channelName,
    canJoin: Boolean(socket?.connected),
    joining,
    joined,
    localStream,
    localScreen,
    peers: peers.map((peer) => ({
      ...peer,
      speaking: Boolean(speaking[peer.socketId]) && peer.mic,
      quality: quality[peer.socketId],
    })),
    localSpeaking: Boolean(speaking.local) && mic,
    preferences,
    setPreferences,
    selectInputDevice,
    mic,
    camera,
    sharing,
    error,
    relayConfigured,
    mediaBusy: mediaBusy || transfer?.direction === "incoming",
    transfer,
    transferRequesting,
    transferNotice,
    clearTransferNotice,
    devicesRevision,
    getTransferDevices,
    requestTransfer,
    acceptTransfer,
    cancelTransfer,
    receivingTransfer:
      transfer?.direction === "incoming" && transfer.phase === "connecting",
    user,
    join,
    leave,
    toggleMic,
    toggleCamera,
    toggleScreen,
    clearError: () => setError(null),
  };
}
export type CallController = ReturnType<typeof useCall>;
