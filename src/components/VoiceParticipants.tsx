import { Button } from "@/components/ui/button";
import {
  MicOff,
  MonitorUp,
  Video,
  Headphones,
  Lock,
  Users,
  WifiOff,
  ArrowRight,
} from "lucide-react";
import type { CallPeer, Channel } from "../../shared/types";
import { Avatar, Modal } from "./ui";
import { ProfileIdentity } from "./ProfileIdentity";
import "./voice-participant-profile.css";
import "./voice-room-polish.css";

export function VoiceParticipants({
  peers,
  channelName,
  currentUserId,
  connected = true,
  onOpenProfile,
  detailed = false,
}: {
  peers: CallPeer[];
  channelName: string;
  currentUserId: string;
  connected?: boolean;
  onOpenProfile?: (id: string) => void;
  detailed?: boolean;
}) {
  return (
    <ul
      className={`voice-participants ${detailed ? "voice-participants-detailed" : ""}`}
      aria-label={`${channelName} katılımcıları`}
    >
      {peers.map((peer) => {
        const identity = (
          <>
            <Avatar user={peer.user} size={detailed ? "small" : "tiny"} />
            <span className="voice-participant-name" title={peer.user.name}>
              <span>
                <span>{peer.user.name}</span>
                {peer.user.id === currentUserId ? " (sen)" : ""}
              </span>
              {detailed && (
                <small>{peer.mic ? "Mikrofon açık" : "Mikrofon kapalı"}</small>
              )}
            </span>
          </>
        );
        return (
          <li key={peer.socketId} className="voice-participant">
            {onOpenProfile ? (
              <ProfileIdentity
                user={peer.user}
                online
                connected={connected}
                selfId={currentUserId}
                onOpen={onOpenProfile}
                className="voice-participant-profile"
              >
                {identity}
              </ProfileIdentity>
            ) : (
              identity
            )}
            <span className="voice-media-state">
              {!peer.mic && (
                <MicOff
                  size={13}
                  role="img"
                  aria-label={`${peer.user.name}: mikrofon kapalı`}
                />
              )}
              {peer.camera && (
                <Video
                  size={13}
                  role="img"
                  aria-label={`${peer.user.name}: kamera açık`}
                />
              )}
              {peer.sharing && (
                <MonitorUp
                  size={13}
                  className="is-sharing"
                  role="img"
                  aria-label={`${peer.user.name}: ekran paylaşıyor`}
                />
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function VoiceRoomPreview({
  channel,
  peers,
  currentUserId,
  isCurrentCall,
  busy,
  connected,
  onJoin,
  onClose,
  onOpenProfile,
  activeChannelName,
}: {
  channel: Channel;
  peers: CallPeer[];
  currentUserId: string;
  isCurrentCall: boolean;
  busy: boolean;
  connected: boolean;
  onJoin: () => void;
  onClose: () => void;
  onOpenProfile?: (id: string) => void;
  activeChannelName?: string;
}) {
  const full = connected && peers.length >= 6 && !isCurrentCall;
  return (
    <Modal title={channel.name} onClose={onClose}>
      <div className="voice-preview">
        <div className="voice-room-summary">
          <span className="voice-room-symbol">
            <Headphones size={22} aria-hidden="true" />
          </span>
          <div>
            <strong>
              {!connected
                ? "Bağlantı bekleniyor"
                : isCurrentCall
                  ? "Bu odadasın"
                  : full
                    ? "Oda dolu"
                    : peers.length
                      ? "Sohbet devam ediyor"
                      : "Sohbeti sen başlat"}
            </strong>
            <span>
              {channel.visibility === "private" ? (
                <>
                  <Lock size={12} aria-hidden="true" /> Özel sesli oda
                </>
              ) : (
                <>
                  <Users size={12} aria-hidden="true" /> Ekibe açık sesli oda
                </>
              )}
            </span>
          </div>
          {connected && (
            <span
              className="voice-room-capacity"
              aria-label={`${peers.length} kişi, kapasite 6 kişi`}
            >
              {peers.length}
              <span>/ 6</span>
            </span>
          )}
        </div>
        <p className="voice-preview-description">
          {channel.description || "Sohbete katıl, ekibinle aynı odada buluş."}
        </p>
        {!connected ? (
          <p role="status" className="voice-room-notice">
            <WifiOff size={16} aria-hidden="true" /> Katılımcı listesi bağlantı
            kurulduğunda güncellenecek.
          </p>
        ) : peers.length ? (
          <>
            <h3 className="voice-room-list-heading">
              Katılımcılar <span>{peers.length}</span>
            </h3>
            <VoiceParticipants
              peers={peers}
              channelName={channel.name}
              currentUserId={currentUserId}
              connected={connected}
              onOpenProfile={onOpenProfile}
              detailed
            />
          </>
        ) : (
          <div className="voice-preview-empty">
            <Headphones size={22} aria-hidden="true" />
            <div>
              <h3>Oda şu an boş</h3>
              <p>Katıldığında ekip arkadaşların seni bu odada görebilir.</p>
            </div>
          </div>
        )}
        {activeChannelName && !isCurrentCall && (
          <p className="voice-room-notice">
            Şu an <strong>{activeChannelName}</strong> görüşmesindesin. Geçmeden
            önce mevcut görüşmeden ayrılman istenecek.
          </p>
        )}
        {full && (
          <p className="voice-room-notice" role="status">
            Bu odada en fazla 6 kişi bulunabilir. Bir kişi ayrıldığında
            katılabilirsin.
          </p>
        )}
        <div className="voice-room-footer">
          <span>
            {isCurrentCall
              ? "Ses bağlantın devam ediyor."
              : "Katılmadan önce mikrofonunu ayarlayabilirsin."}
          </span>
          <Button
            variant="default"
            size="unset"
            type="submit"
            className="primary-button full-width"
            disabled={(busy && !isCurrentCall) || !connected || full}
            onClick={onJoin}
          >
            <Headphones size={17} aria-hidden="true" />
            {isCurrentCall
              ? "Görüşmeyi göster"
              : full
                ? "Oda dolu"
                : "Sesli odaya katıl"}
            <ArrowRight size={15} aria-hidden="true" />
          </Button>
        </div>
      </div>
    </Modal>
  );
}
