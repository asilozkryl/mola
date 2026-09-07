import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Headphones,
  LoaderCircle,
  Maximize2,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Signal,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { CallController, CallParticipant } from "../lib/useCall";
import "./call.css";

function MediaVideo({
  stream,
  mirror = false,
  className = "",
}: {
  stream: MediaStream | null;
  mirror?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.srcObject = stream;
    void element.play().catch(() => {
      /* A changing stream can interrupt autoplay. */
    });
    return () => {
      element.srcObject = null;
    };
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className={`${className} ${mirror ? "call-video-mirror" : ""}`}
    />
  );
}

function RemoteAudio({
  stream,
  muted,
  onBlocked,
  playbackAttempt,
}: {
  stream: MediaStream | null;
  muted: boolean;
  onBlocked: () => void;
  playbackAttempt: number;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const audioTrackIds =
    stream
      ?.getAudioTracks()
      .map((track) => track.id)
      .join(",") ?? "";
  useEffect(() => {
    const element = ref.current;
    if (!element || !stream || !audioTrackIds) return;
    // A negotiated camera track can remain muted until its owner opens the
    // camera. Keep it out of the audio element so it cannot stall audio readiness.
    element.srcObject = new MediaStream(stream.getAudioTracks());
    const play = () => {
      void element.play().catch((error: unknown) => {
        // Replacing a stream (and React's development remount) can interrupt a
        // pending play request. Only an actual autoplay denial needs user action.
        if (error instanceof DOMException && error.name === "NotAllowedError")
          onBlocked();
      });
    };
    element.addEventListener("loadedmetadata", play);
    play();
    return () => {
      element.removeEventListener("loadedmetadata", play);
      element.srcObject = null;
    };
  }, [stream, audioTrackIds, onBlocked, playbackAttempt]);
  return <audio ref={ref} autoPlay muted={muted} />;
}

const initials = (name: string) =>
  name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toLocaleUpperCase("tr");
const connectionLabel = (state: RTCPeerConnectionState) =>
  ({
    new: "Bağlantı hazırlanıyor",
    connecting: "Bağlanıyor",
    connected: "Bağlandı",
    disconnected: "Bağlantı kesildi",
    failed: "Bağlantı kurulamadı",
    closed: "Ayrıldı",
  })[state];

function ParticipantTile({
  peer,
  local = false,
}: {
  peer: CallParticipant;
  local?: boolean;
}) {
  const connected = local || peer.connectionState === "connected";
  return (
    <div
      className={`call-person ${peer.camera && connected ? "call-person-camera" : ""}`}
    >
      {peer.camera && connected && peer.stream ? (
        <MediaVideo stream={peer.stream} mirror={local} />
      ) : (
        <div
          className="call-person-avatar"
          style={{ background: peer.user.color || "#b8cabe" }}
        >
          {initials(peer.user.name)}
        </div>
      )}
      {!connected && (
        <span
          className={`call-connection-badge ${peer.connectionState === "failed" ? "call-connection-failed" : ""}`}
        >
          <Signal size={12} />
          {connectionLabel(peer.connectionState)}
        </span>
      )}
      <div className="call-person-caption">
        <span>
          {peer.user.name}
          {local && <small> (siz)</small>}
        </span>
        {peer.mic ? (
          <Mic size={14} />
        ) : (
          <span className="call-muted-mark" title="Mikrofon kapalı">
            <MicOff size={14} />
          </span>
        )}
      </div>
      {peer.sharing && (
        <span className="call-person-sharing">
          <MonitorUp size={13} />
          <span>Ekran paylaşıyor</span>
        </span>
      )}
    </div>
  );
}

export function CallPanel({
  call,
  onClose,
  minimized = false,
  onExpand,
}: {
  call: CallController;
  onClose: () => void;
  minimized?: boolean;
  onExpand?: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const screenStage = useRef<HTMLDivElement>(null);
  const [deafened, setDeafened] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [playbackAttempt, setPlaybackAttempt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [selectedSharing, setSelectedSharing] = useState<string | null>(null);
  const blockedCallback = useRef(() => setAudioBlocked(true));
  const closeCallback = useRef(onClose);
  closeCallback.current = () => {
    if (!call.joined) call.leave();
    onClose();
  };
  const visible = !minimized && Boolean(call.channelId || call.error);
  useEffect(() => {
    if (!call.joined) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [call.joined]);
  useEffect(() => {
    if (!visible) return;
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCallback.current();
      }
      if (event.key !== "Tab" || !element) return;
      const focusable = [
        ...element.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, select, [tabindex="0"]',
        ),
      ].filter((node) => node.offsetParent !== null);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === element)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, [visible]);

  if (!call.channelId && !call.error) return null;
  const localPeer: CallParticipant | null =
    call.user && call.joined
      ? {
          socketId: "local",
          user: call.user,
          mic: call.mic,
          camera: call.camera,
          sharing: call.sharing,
          stream: call.localStream,
          screen: call.localScreen,
          connectionState: "connected",
        }
      : null;
  const participants = [...(localPeer ? [localPeer] : []), ...call.peers];
  const shares = participants.filter(
    (p) =>
      p.sharing &&
      p.screen &&
      (p.socketId === "local" || p.connectionState === "connected"),
  );
  const activeShare =
    shares.find((p) => p.socketId === selectedSharing) ?? shares[0];
  const connectedCount = call.peers.filter(
    (p) => p.connectionState === "connected",
  ).length;
  const time = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  const leaveCall = () => {
    call.leave();
    onClose();
  };

  return (
    <>
      {call.peers.map((peer) => (
        <RemoteAudio
          key={peer.socketId}
          stream={peer.stream}
          muted={deafened}
          onBlocked={blockedCallback.current}
          playbackAttempt={playbackAttempt}
        />
      ))}
      {minimized ? (
        <div
          className="call-dock"
          role="region"
          aria-label="Devam eden görüşme"
        >
          <button className="call-dock-main" onClick={onExpand}>
            <span className="call-dock-icon">
              {call.sharing ? (
                <MonitorUp size={19} />
              ) : (
                <Headphones size={19} />
              )}
            </span>
            <span>
              <strong>{call.channelName || "Görüşme"}</strong>
              <small>
                {call.joining
                  ? "Katılınıyor…"
                  : call.sharing
                    ? `Ekran paylaşılıyor · ${time}`
                    : call.joined
                      ? `${connectedCount + 1} kişi · ${time}`
                      : "Görüşme bildirimi"}
              </small>
            </span>
            <ArrowUpRight size={18} />
          </button>
          {call.joined && (
            <button
              className={`call-dock-button ${!call.mic ? "call-dock-muted" : ""}`}
              aria-label={call.mic ? "Mikrofonu kapat" : "Mikrofonu aç"}
              onClick={call.toggleMic}
            >
              {call.mic ? <Mic size={18} /> : <MicOff size={18} />}
            </button>
          )}
          <button
            className="call-dock-button call-dock-leave"
            aria-label="Görüşmeden ayrıl"
            onClick={leaveCall}
          >
            <PhoneOff size={18} />
          </button>
        </div>
      ) : (
        <div className="call-backdrop">
          <div
            className="call-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="call-heading"
            ref={dialog}
            tabIndex={-1}
          >
            <header className="call-header">
              <div className="call-header-title">
                <span className="call-header-icon">
                  <Headphones size={21} />
                </span>
                <div>
                  <h2 id="call-heading">{call.channelName || "Görüşme"}</h2>
                  <p>
                    {call.joining ? (
                      "Mikrofon ve bağlantı hazırlanıyor"
                    ) : call.joined ? (
                      <>
                        <span className="call-live-dot" />
                        {connectedCount
                          ? `${connectedCount + 1} kişi görüşmede`
                          : "Katılımcılar bekleniyor"}
                        <span className="call-header-divider" />
                        {time}
                      </>
                    ) : (
                      "Sesli ve görüntülü görüşme"
                    )}
                  </p>
                </div>
              </div>
              <button
                className="call-icon-button"
                aria-label={call.joined ? "Görüşmeyi küçült" : "Kapat"}
                title={call.joined ? "Görüşmeyi küçült" : "Kapat"}
                onClick={() => closeCallback.current()}
              >
                {call.joined ? <ChevronDown size={21} /> : <X size={21} />}
              </button>
            </header>

            {call.error && (
              <div className="call-error" role="alert">
                <span>{call.error}</span>
                <button aria-label="Uyarıyı kapat" onClick={call.clearError}>
                  <X size={16} />
                </button>
              </div>
            )}
            {call.joined && !call.relayConfigured && (
              <div className="call-audio-prompt" role="status">
                <Signal size={17} />
                <span>
                  Görüşmeler doğrudan bağlantıyla çalışıyor. Bağlantı hizmeti
                  henüz kurulmadığı için bazı mobil ve kurumsal ağlarda ses,
                  kamera veya ekran paylaşımı bağlanamayabilir.
                </span>
              </div>
            )}
            {audioBlocked && call.joined && (
              <div className="call-audio-prompt">
                <Volume2 size={17} />
                <span>Tarayıcınız sesi başlatmak için onay bekliyor.</span>
                <button
                  onClick={() => {
                    setPlaybackAttempt((value) => value + 1);
                    setAudioBlocked(false);
                  }}
                >
                  Sesi etkinleştir
                </button>
              </div>
            )}

            <div
              className={`call-body ${activeShare ? "call-body-sharing" : ""}`}
            >
              {call.joining ? (
                <div className="call-waiting">
                  <div className="call-joining-symbol">
                    <LoaderCircle size={30} />
                  </div>
                  <h3>Görüşmeye katılıyorsunuz</h3>
                  <p>Tarayıcınız sorarsa mikrofon erişimine izin verin.</p>
                  <button className="call-secondary" onClick={leaveCall}>
                    İptal et
                  </button>
                </div>
              ) : !call.joined ? (
                <div className="call-waiting">
                  <span className="call-waiting-symbol">
                    <Headphones size={33} />
                  </span>
                  <h3>Bir araya gelelim</h3>
                  <p>
                    Sesli konuşun, kameranızı açın ve ekranınızı paylaşın.
                    <br />
                    Bu odada en fazla 6 kişi birlikte görüşebilir.
                  </p>
                  {call.channelId && (
                    <button
                      className="call-primary"
                      disabled={!call.canJoin}
                      onClick={() =>
                        void call.join({
                          id: call.channelId!,
                          name: call.channelName,
                        })
                      }
                    >
                      <Headphones size={17} />
                      Yeniden katıl
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {activeShare && (
                    <div className="call-share-stage" ref={screenStage}>
                      <div className="call-share-heading">
                        <span>
                          <MonitorUp size={15} />
                          {activeShare.socketId === "local"
                            ? "Ekranınızı paylaşıyorsunuz"
                            : `${activeShare.user.name} ekranını paylaşıyor`}
                        </span>
                        <button
                          className="call-icon-button"
                          aria-label="Paylaşılan ekranı büyüt"
                          onClick={() => {
                            if (document.fullscreenElement)
                              void document.exitFullscreen();
                            else
                              void screenStage.current
                                ?.requestFullscreen()
                                .catch(() => undefined);
                          }}
                        >
                          <Maximize2 size={17} />
                        </button>
                      </div>
                      <MediaVideo
                        stream={activeShare.screen}
                        className="call-screen-video"
                      />
                      {shares.length > 1 && (
                        <div className="call-share-tabs">
                          {shares.map((p) => (
                            <button
                              key={p.socketId}
                              onClick={() => setSelectedSharing(p.socketId)}
                              aria-pressed={p.socketId === activeShare.socketId}
                            >
                              {p.socketId === activeShare.socketId && (
                                <Check size={13} />
                              )}
                              {p.user.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <div
                    className={`call-people call-people-${Math.min(participants.length, 4)}`}
                  >
                    {participants.map((peer) => (
                      <ParticipantTile
                        key={peer.socketId}
                        peer={peer}
                        local={peer.socketId === "local"}
                      />
                    ))}
                    {participants.length === 1 && !activeShare && (
                      <div className="call-invite-space">
                        <span>
                          <Headphones size={26} />
                        </span>
                        <h3>Diğerleri de birazdan burada.</h3>
                        <p>
                          Ekip arkadaşlarınız aynı kanaldan
                          <br />
                          görüşmeye katılabilir.
                        </p>
                        <div className="call-invite-detail">
                          <span className="call-live-dot" />
                          Mikrofonunuz {call.mic ? "açık" : "kapalı"}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {call.joined && (
              <footer className="call-footer">
                <div className="call-footer-note">
                  <span className="call-live-dot" />
                  <span>
                    {call.sharing
                      ? "Ekranınız paylaşılıyor"
                      : "Sohbet burada devam ediyor"}
                  </span>
                </div>
                <div className="call-controls">
                  <div className="call-control-wrap">
                    <button
                      className={`call-control ${!call.mic ? "call-control-off" : ""}`}
                      aria-label={call.mic ? "Mikrofonu kapat" : "Mikrofonu aç"}
                      aria-pressed={call.mic}
                      onClick={call.toggleMic}
                    >
                      {call.mic ? <Mic size={21} /> : <MicOff size={21} />}
                    </button>
                    <span>Mikrofon</span>
                  </div>
                  <div className="call-control-wrap">
                    <button
                      className={`call-control ${call.camera ? "call-control-active" : ""}`}
                      aria-label={
                        call.camera ? "Kamerayı kapat" : "Kamerayı aç"
                      }
                      aria-pressed={call.camera}
                      disabled={call.mediaBusy}
                      onClick={() => void call.toggleCamera()}
                    >
                      {call.camera ? (
                        <Video size={21} />
                      ) : (
                        <VideoOff size={21} />
                      )}
                    </button>
                    <span>Kamera</span>
                  </div>
                  <div className="call-control-wrap">
                    <button
                      className={`call-control ${call.sharing ? "call-control-active" : ""}`}
                      aria-label={
                        call.sharing
                          ? "Ekran paylaşımını durdur"
                          : "Ekranı paylaş"
                      }
                      aria-pressed={call.sharing}
                      disabled={call.mediaBusy}
                      onClick={() => void call.toggleScreen()}
                    >
                      <MonitorUp size={21} />
                    </button>
                    <span>
                      {call.sharing ? "Paylaşımı bitir" : "Ekran paylaş"}
                    </span>
                  </div>
                  <div className="call-control-wrap">
                    <button
                      className={`call-control ${deafened ? "call-control-off" : ""}`}
                      aria-label={
                        deafened
                          ? "Katılımcıların sesini aç"
                          : "Katılımcıların sesini kapat"
                      }
                      aria-pressed={!deafened}
                      onClick={() => setDeafened((value) => !value)}
                    >
                      {deafened ? <VolumeX size={21} /> : <Volume2 size={21} />}
                    </button>
                    <span>Hoparlör</span>
                  </div>
                  <span className="call-controls-divider" />
                  <div className="call-control-wrap">
                    <button
                      className="call-control call-control-leave"
                      aria-label="Görüşmeden ayrıl"
                      onClick={leaveCall}
                    >
                      <PhoneOff size={21} />
                    </button>
                    <span>Ayrıl</span>
                  </div>
                </div>
                <span className="call-footer-size">
                  {participants.length}/6
                </span>
              </footer>
            )}
          </div>
        </div>
      )}
    </>
  );
}
