import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "./ui/dialog";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Headphones,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Signal,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  Settings2,
  PictureInPicture2,
  MessageSquare,
  AlertCircle,
  X,
} from "lucide-react";
import type { CallController, CallParticipant } from "../lib/useCall";
import type { ConnectionQuality } from "../../shared/call-types";
import { MediaSettings } from "./CallSetup";
import { Avatar } from "./ui";
import { ProfileIdentity } from "./ProfileIdentity";
import "./call.css";
import "./call-panel-polish.css";

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
  outputDeviceId,
  onOutputError,
}: {
  stream: MediaStream | null;
  muted: boolean;
  onBlocked: () => void;
  playbackAttempt: number;
  outputDeviceId: string;
  onOutputError: () => void;
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
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof element.setSinkId !== "function") return;
    let cancelled = false;
    void element.setSinkId(outputDeviceId).catch(() => {
      if (!cancelled) onOutputError();
    });
    return () => {
      cancelled = true;
    };
  }, [outputDeviceId, onOutputError]);
  return <audio ref={ref} autoPlay muted={muted} />;
}

const qualityLabel = {
  unknown: "Ölçülüyor",
  good: "İyi",
  fair: "Orta",
  poor: "Zayıf",
};
function QualityBadge({ quality }: { quality?: ConnectionQuality }) {
  const details = quality
    ? [
        quality.rttMs !== null
          ? `Gecikme: ${Math.round(quality.rttMs)} ms`
          : "",
        quality.jitterMs !== null
          ? `Ses dalgalanması: ${Math.round(quality.jitterMs)} ms`
          : "",
        quality.packetLossPercent !== null
          ? `Paket kaybı: %${quality.packetLossPercent.toFixed(1)}`
          : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : "İlk bağlantı ölçümü bekleniyor";
  return (
    <span
      className={`call-quality call-quality-${quality?.level ?? "unknown"}`}
      title={details}
      aria-label={`Bağlantı kalitesi: ${qualityLabel[quality?.level ?? "unknown"]}. ${details}`}
    >
      <Signal size={13} />
      {qualityLabel[quality?.level ?? "unknown"]}
    </span>
  );
}

function useShareWindow(stream: MediaStream | null, title: string) {
  const external = useRef<Window | null>(null);
  const current = useRef(stream);
  current.current = stream;
  const request = useRef(0);
  const [error, setError] = useState("");
  const close = () => {
    request.current++;
    const target = external.current;
    external.current = null;
    if (target && !target.closed) {
      try {
        const video = target.document.querySelector("video");
        if (video) video.srcObject = null;
      } catch {
        /* A user may have navigated the separate window. */
      }
      target.close();
    }
  };
  useEffect(() => {
    const target = external.current;
    if (!stream) close();
    else if (target && !target.closed) {
      try {
        const video = target.document.querySelector("video");
        if (video) {
          video.srcObject = stream;
          void video.play().catch(() => {});
        }
        target.document.title = title;
        const heading = target.document.querySelector("p");
        if (heading) heading.textContent = title;
      } catch {
        close();
      }
    }
  }, [stream, title]);
  useEffect(() => {
    window.addEventListener("pagehide", close);
    return () => {
      window.removeEventListener("pagehide", close);
      close();
    };
  }, []);
  const open = async () => {
    if (!stream) return;
    setError("");
    if (external.current && !external.current.closed) {
      external.current.focus();
      return;
    }
    const version = ++request.current;
    try {
      const pip = (
        window as Window & {
          documentPictureInPicture?: {
            requestWindow(options: {
              width: number;
              height: number;
            }): Promise<Window>;
          };
        }
      ).documentPictureInPicture;
      const target = pip
        ? await pip.requestWindow({ width: 880, height: 540 })
        : window.open("about:blank", "", "popup,width=880,height=540");
      if (!target) throw new Error("window-blocked");
      if (version !== request.current || !current.current) {
        target.close();
        return;
      }
      external.current = target;
      if (!pip) target.opener = null;
      target.document.title = title;
      const style = target.document.createElement("style");
      style.textContent =
        "body{margin:0;background:#153d36;color:white;font:14px system-ui;display:flex;flex-direction:column;height:100vh}p{padding:14px 18px;margin:0}video{width:100%;height:0;flex:1;min-height:0;object-fit:contain;background:#092118}button{align-self:flex-end;margin:10px 16px;padding:8px 12px;border:0;border-radius:8px;background:#c0e1ad;color:#153d36;cursor:pointer}";
      const heading = target.document.createElement("p");
      heading.textContent = title;
      const video = target.document.createElement("video");
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      video.srcObject = current.current;
      const button = target.document.createElement("button");
      button.textContent = "Pencereyi kapat";
      button.onclick = close;
      target.document.head.append(style);
      target.document.body.replaceChildren(heading, video, button);
      target.addEventListener(
        "pagehide",
        () => {
          video.srcObject = null;
          if (external.current === target) external.current = null;
        },
        { once: true },
      );
      await video.play().catch(() => {});
    } catch {
      setError(
        "Ayrı pencere açılamadı. Tarayıcıda açılır pencerelere izin verin veya tam ekranı kullanın.",
      );
    }
  };
  return { open, error };
}

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
  selfId,
  onOpenProfile,
}: {
  peer: CallParticipant;
  local?: boolean;
  selfId: string;
  onOpenProfile?: (id: string) => void;
}) {
  const connected = local || peer.connectionState === "connected";
  const speaking = connected && peer.speaking && peer.mic;
  const cameraVisible = peer.camera && connected && Boolean(peer.stream);
  const identity = (
    <>
      {!cameraVisible && (
        <span className="call-person-avatar">
          <Avatar user={peer.user} />
        </span>
      )}
      <span className="call-person-caption">
        <span className="call-person-name">
          {peer.user.name}
          {local && <small> (siz)</small>}
        </span>
        <span className="call-person-status">
          {peer.mic ? <Mic size={13} /> : <MicOff size={13} />}
          {!connected
            ? connectionLabel(peer.connectionState)
            : speaking
              ? "Konuşuyor"
              : peer.mic
                ? "Mikrofon açık"
                : "Mikrofon kapalı"}
        </span>
      </span>
    </>
  );
  return (
    <div
      className={`call-person ${cameraVisible ? "call-person-camera" : "call-person-audio"} ${speaking ? "call-person-speaking" : ""}`}
      aria-label={`${peer.user.name}${speaking ? ": konuşuyor" : ""}`}
    >
      {cameraVisible && <MediaVideo stream={peer.stream} mirror={local} />}
      {onOpenProfile && !peer.user.suspended ? (
        <ProfileIdentity
          user={peer.user}
          online={connected}
          connected={connected}
          selfId={selfId}
          onOpen={onOpenProfile}
          className="call-person-identity"
        >
          {identity}
        </ProfileIdentity>
      ) : (
        <div className="call-person-identity">{identity}</div>
      )}
      <div className="call-person-meta">
        {peer.sharing && (
          <span className="call-person-sharing">
            <MonitorUp size={13} />
            <span>Ekran paylaşıyor</span>
          </span>
        )}
        {!local && connected && (
          <div className="call-person-quality">
            <QualityBadge quality={peer.quality} />
          </div>
        )}
      </div>
    </div>
  );
}

export function CallPanel({
  call,
  onClose,
  minimized = false,
  onExpand,
  onOpenProfile,
}: {
  call: CallController;
  onClose: () => void;
  minimized?: boolean;
  onExpand?: () => void;
  onOpenProfile?: (id: string) => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const screenStage = useRef<HTMLDivElement>(null);
  const [deafened, setDeafened] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [playbackAttempt, setPlaybackAttempt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [selectedSharing, setSelectedSharing] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [roomExpanded, setRoomExpanded] = useState(false);
  const [expandedScreen, setExpandedScreen] = useState(false);
  const [fullscreenScreen, setFullscreenScreen] = useState(false);
  const [screenError, setScreenError] = useState("");
  const [outputError, setOutputError] = useState(false);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const roomExpandButton = useRef<HTMLButtonElement>(null);
  const escapeCallback = useRef<() => void>(() => {});
  const outputErrorCallback = useRef(() => setOutputError(true));
  const blockedCallback = useRef(() => setAudioBlocked(true));
  const closeCallback = useRef(onClose);
  closeCallback.current = () => {
    if (!call.joined) call.leave();
    onClose();
  };
  escapeCallback.current = () => {
    if (document.fullscreenElement) {
      void document
        .exitFullscreen()
        .catch(() =>
          setScreenError("Tam ekrandan çıkılamadı. Escape tuşunu kullanın."),
        );
    } else if (expandedScreen) {
      setExpandedScreen(false);
      expandButton.current?.focus();
    } else if (settingsOpen) {
      setSettingsOpen(false);
      settingsButton.current?.focus();
    } else if (roomExpanded) {
      setRoomExpanded(false);
      roomExpandButton.current?.focus();
    } else closeCallback.current();
  };
  const visible = !minimized && Boolean(call.channelId || call.error);
  useEffect(() => {
    setRoomExpanded(false);
  }, [call.channelId]);
  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 560px)");
    const update = () => {
      if (mobile.matches) setRoomExpanded(false);
    };
    update();
    mobile.addEventListener("change", update);
    return () => mobile.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const update = () =>
      setFullscreenScreen(
        Boolean(
          screenStage.current &&
          document.fullscreenElement === screenStage.current,
        ),
      );
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
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
    if (!visible || !settingsOpen) return;
    const frame = window.requestAnimationFrame(() => {
      const section = dialog.current?.querySelector<HTMLElement>(
        ".call-settings-section",
      );
      const target =
        section?.querySelector<HTMLElement>(
          "select:not([disabled]), button:not([disabled]), input:not([disabled])",
        ) || section;
      target?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [visible, settingsOpen]);

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
          speaking: call.localSpeaking,
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
  const shareWindow = useShareWindow(
    activeShare?.screen ?? null,
    activeShare ? `${activeShare.user.name} · Ekran paylaşımı` : "Mola",
  );
  useEffect(() => {
    if (!activeShare) setExpandedScreen(false);
    if (!call.joined) {
      setSettingsOpen(false);
      setOutputError(false);
      setScreenError("");
    }
  }, [Boolean(activeShare), call.joined]);
  if (!call.channelId && !call.error) return null;
  const time = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  const leaveCall = () => {
    call.leave();
    onClose();
  };
  const openProfile = onOpenProfile
    ? (id: string) => {
        onClose();
        onOpenProfile(id);
      }
    : undefined;
  const audioOnly = !participants.some(
    (peer) =>
      peer.camera &&
      peer.stream &&
      (peer.socketId === "local" || peer.connectionState === "connected"),
  );
  const dockNotice =
    call.error ||
    (outputError
      ? "Hoparlör bağlantısını kontrol edin"
      : audioBlocked
        ? "Sesi etkinleştirin"
        : screenError || shareWindow.error);

  return (
    <>
      {call.peers.map((peer) => (
        <RemoteAudio
          key={peer.socketId}
          stream={peer.stream}
          muted={deafened}
          onBlocked={blockedCallback.current}
          playbackAttempt={playbackAttempt}
          outputDeviceId={call.preferences.outputDeviceId}
          onOutputError={outputErrorCallback.current}
        />
      ))}
      {minimized && (
        <div
          className="call-dock call-dock-polished"
          role="region"
          aria-label="Devam eden görüşme"
        >
          <Button
            variant="unstyled"
            size="unset"
            type="submit"
            className="call-dock-main"
            onClick={onExpand}
            title="Görüşmeyi aç"
          >
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
                      ? `${participants.length} kişi · ${time}`
                      : "Görüşme bildirimi"}
              </small>
              {deafened && (
                <small className="call-dock-listening-off">
                  Hoparlör kapalı
                </small>
              )}
            </span>
            <ArrowUpRight size={18} />
          </Button>
          {call.joined && (
            <Button
              variant="unstyled"
              size="unset"
              type="submit"
              className={`call-dock-button ${!call.mic ? "call-dock-muted" : ""}`}
              aria-label={call.mic ? "Mikrofonu kapat" : "Mikrofonu aç"}
              title={call.mic ? "Mikrofonu kapat" : "Mikrofonu aç"}
              aria-pressed={call.mic}
              onClick={call.toggleMic}
            >
              {call.mic ? <Mic size={18} /> : <MicOff size={18} />}
            </Button>
          )}
          {call.joined && (
            <Button
              variant="unstyled"
              size="unset"
              type="submit"
              className={`call-dock-button ${deafened ? "call-dock-muted" : ""}`}
              aria-label={
                deafened
                  ? "Katılımcıların sesini aç"
                  : "Katılımcıların sesini kapat"
              }
              title={
                deafened
                  ? "Katılımcıların sesini aç"
                  : "Katılımcıların sesini kapat"
              }
              aria-pressed={!deafened}
              onClick={() => setDeafened((value) => !value)}
            >
              {deafened ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </Button>
          )}
          <Button
            variant="unstyled"
            size="unset"
            type="submit"
            className="call-dock-button call-dock-leave"
            aria-label="Görüşmeden ayrıl"
            title="Görüşmeden ayrıl"
            onClick={leaveCall}
          >
            <PhoneOff size={18} />
          </Button>
          {call.sharing && (
            <Button
              variant="unstyled"
              size="unset"
              type="submit"
              className="call-dock-sharing"
              onClick={() => void call.toggleScreen()}
              disabled={call.mediaBusy}
              aria-label="Ekran paylaşımını durdur"
            >
              <MonitorUp size={14} /> Paylaşımı bitir
            </Button>
          )}
          {call.camera && (
            <span className="call-dock-camera">
              <Video size={13} /> Kamera açık
            </span>
          )}
          {dockNotice && (
            <Button
              variant="unstyled"
              size="unset"
              type="submit"
              className="call-dock-notice"
              onClick={onExpand}
            >
              <AlertCircle size={14} />
              <span>{dockNotice}</span>
              <ArrowUpRight size={14} />
            </Button>
          )}
        </div>
      )}
      {/* Keep the dialog controller mounted while its dock appears. Base UI
          resolves final focus when closing finishes, after the dock is present. */}
      <Dialog
        open={visible}
        disablePointerDismissal
        onOpenChange={(open) => {
          if (!open) escapeCallback.current();
        }}
      >
        <DialogContent
          className={`call-dialog call-panel ${audioOnly && !activeShare ? "call-panel-audio" : "call-panel-media"}${roomExpanded ? " call-panel-expanded" : ""}`}
          overlayClassName="call-backdrop"
          showCloseButton={false}
          aria-labelledby="call-heading"
          ref={dialog}
          tabIndex={-1}
          initialFocus={() => {
            if (
              document.activeElement instanceof HTMLElement &&
              !dialog.current?.contains(document.activeElement)
            ) {
              opener.current = document.activeElement;
            }
            return dialog.current;
          }}
          finalFocus={() => {
            const dock =
              document.querySelector<HTMLButtonElement>(".call-dock-main");
            if (dock) return dock;
            return opener.current !== document.body &&
              opener.current?.isConnected &&
              opener.current.getClientRects().length
              ? opener.current
              : false;
          }}
          onKeyDown={(event) => {
            const stage = screenStage.current;
            // The share stage has its own fullscreen boundary inside the call.
            if (
              event.key !== "Tab" ||
              !stage ||
              !(document.fullscreenElement === stage || expandedScreen)
            )
              return;
            const items = [
              ...stage.querySelectorAll<HTMLElement>(
                'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), [tabindex="0"]',
              ),
            ].filter((node) => node.getClientRects().length > 0);
            const first = items[0],
              last = items.at(-1);
            if (
              event.shiftKey &&
              (document.activeElement === first ||
                !stage.contains(document.activeElement))
            ) {
              event.preventDefault();
              last?.focus();
            } else if (
              !event.shiftKey &&
              (document.activeElement === last ||
                !stage.contains(document.activeElement))
            ) {
              event.preventDefault();
              first?.focus();
            }
          }}
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
                      {participants.length > 1
                        ? `${participants.length} kişi görüşmede`
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
            <div className="call-header-actions">
              <Button
                variant="unstyled"
                size="unset"
                type="button"
                className="call-icon-button call-room-expand"
                aria-label={
                  roomExpanded ? "Normal görünüme dön" : "Görüşmeyi genişlet"
                }
                title={
                  roomExpanded ? "Normal görünüme dön" : "Görüşmeyi genişlet"
                }
                aria-pressed={roomExpanded}
                ref={roomExpandButton}
                onClick={() => setRoomExpanded((value) => !value)}
              >
                {roomExpanded ? (
                  <Minimize2 size={18} />
                ) : (
                  <Maximize2 size={18} />
                )}
                <span>{roomExpanded ? "Normal görünüm" : "Genişlet"}</span>
              </Button>
              <Button
                variant="unstyled"
                size="unset"
                type="submit"
                className="call-icon-button"
                aria-label={call.joined ? "Görüşmeyi küçült" : "Kapat"}
                title={call.joined ? "Görüşmeyi küçült" : "Kapat"}
                onClick={() => closeCallback.current()}
              >
                {call.joined ? <ChevronDown size={21} /> : <X size={21} />}
              </Button>
            </div>
          </header>

          {outputError && (
            <div className="call-error" role="alert">
              <span>
                Seçili hoparlöre ses aktarılamadı. Ses ayarlarından sistem
                varsayılanını veya bağlı bir cihazı seçin.
              </span>
              <Button
                variant="unstyled"
                size="unset"
                type="submit"
                aria-label="Hoparlör uyarısını kapat"
                onClick={() => setOutputError(false)}
              >
                <X size={16} />
              </Button>
            </div>
          )}
          {(screenError || shareWindow.error) && (
            <div className="call-error" role="alert">
              {screenError || shareWindow.error}
            </div>
          )}
          {settingsOpen && call.joined && (
            <section
              className="call-settings-section"
              aria-label="Görüşme ses ayarları"
              id="call-media-settings"
              tabIndex={-1}
            >
              <MediaSettings call={call} />
            </section>
          )}

          {call.error && (
            <div className="call-error" role="alert">
              <span>{call.error}</span>
              <Button
                variant="unstyled"
                size="unset"
                type="submit"
                aria-label="Uyarıyı kapat"
                onClick={call.clearError}
              >
                <X size={16} />
              </Button>
            </div>
          )}
          {call.joined && !call.relayConfigured && (
            <div className="call-audio-prompt" role="status">
              <Signal size={17} />
              <span>
                Bazı mobil ve kurumsal ağlarda görüşme bağlanamayabilir. Ses
                gelmiyorsa başka bir ağ deneyin veya yöneticinize bildirin.
              </span>
            </div>
          )}
          {audioBlocked && call.joined && (
            <div className="call-audio-prompt" role="status">
              <Volume2 size={17} />
              <span>Tarayıcınız sesi başlatmak için onay bekliyor.</span>
              <Button
                variant="unstyled"
                size="unset"
                type="submit"
                onClick={() => {
                  setPlaybackAttempt((value) => value + 1);
                  setAudioBlocked(false);
                }}
              >
                Sesi etkinleştir
              </Button>
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
                <Button
                  variant="unstyled"
                  size="unset"
                  type="submit"
                  className="call-secondary"
                  onClick={leaveCall}
                >
                  İptal et
                </Button>
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
                  <Button
                    variant="unstyled"
                    size="unset"
                    type="submit"
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
                  </Button>
                )}
              </div>
            ) : (
              <>
                {activeShare && (
                  <div
                    className={`call-share-stage ${expandedScreen ? "call-share-expanded" : ""}`}
                    ref={screenStage}
                    tabIndex={-1}
                  >
                    <div className="call-share-heading">
                      <span>
                        <MonitorUp size={15} />
                        {activeShare.socketId === "local"
                          ? "Ekranınızı paylaşıyorsunuz"
                          : `${activeShare.user.name} ekranını paylaşıyor`}
                      </span>
                      <div className="call-share-actions">
                        <Button
                          variant="unstyled"
                          size="unset"
                          type="submit"
                          className="call-icon-button"
                          aria-label="Paylaşılan ekranı ayrı pencerede aç"
                          title="Ayrı pencerede aç"
                          onClick={() => void shareWindow.open()}
                        >
                          <PictureInPicture2 size={17} />
                        </Button>
                        <Button
                          variant="unstyled"
                          size="unset"
                          type="submit"
                          className="call-icon-button"
                          aria-label="Paylaşılan ekranı büyüt"
                          title={
                            expandedScreen || fullscreenScreen
                              ? "Paylaşımı küçült"
                              : "Paylaşımı büyüt"
                          }
                          aria-pressed={expandedScreen || fullscreenScreen}
                          ref={expandButton}
                          onClick={() => {
                            setScreenError("");
                            if (document.fullscreenElement)
                              void document
                                .exitFullscreen()
                                .catch(() =>
                                  setScreenError(
                                    "Tam ekrandan çıkılamadı. Escape tuşunu kullanın.",
                                  ),
                                );
                            else if (
                              document.fullscreenEnabled &&
                              screenStage.current?.requestFullscreen
                            )
                              void screenStage.current
                                .requestFullscreen()
                                .catch(() =>
                                  setExpandedScreen((value) => !value),
                                );
                            else setExpandedScreen((value) => !value);
                          }}
                        >
                          <Maximize2 size={17} />
                        </Button>
                      </div>
                    </div>
                    <MediaVideo
                      stream={activeShare.screen}
                      className="call-screen-video"
                    />
                    {shares.length > 1 && (
                      <div className="call-share-tabs">
                        {shares.map((p) => (
                          <Button
                            variant="unstyled"
                            size="unset"
                            type="submit"
                            key={p.socketId}
                            onClick={() => setSelectedSharing(p.socketId)}
                            aria-pressed={p.socketId === activeShare.socketId}
                          >
                            {p.socketId === activeShare.socketId && (
                              <Check size={13} />
                            )}
                            {p.user.name}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div
                  className={`call-people call-people-${Math.min(participants.length, 4)} ${audioOnly ? "call-people-audio" : "call-people-video"}`}
                  data-count={participants.length}
                  aria-label="Görüşmedeki katılımcılar"
                >
                  {participants.map((peer) => (
                    <ParticipantTile
                      key={peer.socketId}
                      peer={peer}
                      local={peer.socketId === "local"}
                      selfId={call.user?.id || ""}
                      onOpenProfile={openProfile}
                    />
                  ))}
                  {participants.length === 1 && !activeShare && (
                    <div className="call-invite-space">
                      <span>
                        <Headphones size={20} />
                      </span>
                      <h3>Görüşmedeki ilk kişisiniz</h3>
                      <p>
                        Ekip arkadaşların bu odadan katılabilir. Sohbete
                        döndüğünde görüşme devam eder.
                      </p>
                      <div className="call-invite-detail">
                        <Button
                          variant="unstyled"
                          size="unset"
                          type="submit"
                          className="call-chat-return"
                          onClick={() => closeCallback.current()}
                        >
                          <MessageSquare size={14} />
                          Sohbette bekle
                        </Button>
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
                <Button
                  variant="unstyled"
                  size="unset"
                  type="submit"
                  className="call-chat-return"
                  onClick={() => closeCallback.current()}
                >
                  <MessageSquare size={15} />
                  Sohbete dön
                </Button>
                <small>Görüşme devam eder</small>
              </div>
              <div
                className="call-controls"
                role="group"
                aria-label="Görüşme kontrolleri"
              >
                <div className="call-control-wrap">
                  <Button
                    variant="unstyled"
                    size="unset"
                    type="submit"
                    className={`call-control ${!call.mic ? "call-control-off" : "call-control-active"}`}
                    aria-label={call.mic ? "Mikrofonu kapat" : "Mikrofonu aç"}
                    aria-pressed={call.mic}
                    onClick={call.toggleMic}
                  >
                    {call.mic ? <Mic size={21} /> : <MicOff size={21} />}
                  </Button>
                  <span>
                    Mikrofon <small>{call.mic ? "Açık" : "Kapalı"}</small>
                  </span>
                </div>
                <div className="call-control-wrap">
                  <Button
                    variant="unstyled"
                    size="unset"
                    type="submit"
                    className={`call-control ${call.camera ? "call-control-active" : ""}`}
                    aria-label={call.camera ? "Kamerayı kapat" : "Kamerayı aç"}
                    aria-pressed={call.camera}
                    disabled={call.mediaBusy}
                    onClick={() => void call.toggleCamera()}
                  >
                    {call.camera ? <Video size={21} /> : <VideoOff size={21} />}
                  </Button>
                  <span>
                    Kamera <small>{call.camera ? "Açık" : "Kapalı"}</small>
                  </span>
                </div>
                <div className="call-control-wrap">
                  <Button
                    variant="unstyled"
                    size="unset"
                    type="submit"
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
                  </Button>
                  <span>
                    {call.sharing ? "Paylaşımı bitir" : "Ekran paylaş"}
                  </span>
                </div>
                <div className="call-control-wrap">
                  <Button
                    variant="unstyled"
                    size="unset"
                    type="submit"
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
                  </Button>
                  <span>
                    Hoparlör <small>{deafened ? "Kapalı" : "Açık"}</small>
                  </span>
                </div>
                <span className="call-controls-divider" />
                <div className="call-control-wrap">
                  <Button
                    variant="unstyled"
                    size="unset"
                    type="submit"
                    className={`call-control ${settingsOpen ? "call-control-active" : ""}`}
                    aria-label="Ses ayarları"
                    aria-expanded={settingsOpen}
                    aria-controls="call-media-settings"
                    ref={settingsButton}
                    onClick={() => setSettingsOpen((value) => !value)}
                  >
                    <Settings2 size={21} />
                  </Button>
                  <span>Ayarlar</span>
                </div>
                <div className="call-control-wrap">
                  <Button
                    variant="unstyled"
                    size="unset"
                    type="submit"
                    className="call-control call-control-leave"
                    aria-label="Görüşmeden ayrıl"
                    onClick={leaveCall}
                  >
                    <PhoneOff size={21} />
                  </Button>
                  <span>Ayrıl</span>
                </div>
              </div>
              <span className="call-footer-size" role="status">
                {call.mediaBusy
                  ? "Cihaz yanıtı bekleniyor…"
                  : `${participants.length}/6 kişi`}
              </span>
            </footer>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
