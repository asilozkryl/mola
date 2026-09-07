import { MicOff, MonitorUp, Video, Headphones } from "lucide-react";
import type { CallPeer, Channel } from "../../shared/types";
import { Avatar, Modal } from "./ui";

export function VoiceParticipants({
  peers,
  channelName,
  currentUserId,
}: {
  peers: CallPeer[];
  channelName: string;
  currentUserId: string;
}) {
  return (
    <ul
      className="voice-participants"
      aria-label={`${channelName} katılımcıları`}
    >
      {peers.map((peer) => (
        <li key={peer.socketId} className="voice-participant">
          <Avatar user={peer.user} size="tiny" />
          <span className="voice-participant-name" title={peer.user.name}>
            <span>{peer.user.name}</span>
            {peer.user.id === currentUserId ? " (sen)" : ""}
          </span>
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
      ))}
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
}: {
  channel: Channel;
  peers: CallPeer[];
  currentUserId: string;
  isCurrentCall: boolean;
  busy: boolean;
  connected: boolean;
  onJoin: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={channel.name} onClose={onClose}>
      <div className="voice-preview">
        <p className="voice-preview-description">
          {channel.description || "Sohbete katıl, ekibinle aynı odada buluş."}
        </p>
        {!connected ? (
          <p role="status" className="voice-preview-description">
            Katılımcı listesi için bağlantı kuruluyor…
          </p>
        ) : peers.length ? (
          <>
            <h3>Şu anda {peers.length} kişi burada</h3>
            <VoiceParticipants
              peers={peers}
              channelName={channel.name}
              currentUserId={currentUserId}
            />
          </>
        ) : (
          <div className="voice-preview-empty">
            <Headphones size={29} />
            <h3>Oda şu an boş</h3>
            <p>İlk katılan sen ol. Ekibin seni odanın altında görebilir.</p>
          </div>
        )}
        <button
          className="primary-button full-width"
          disabled={busy || !connected}
          onClick={onJoin}
        >
          <Headphones size={17} />
          {isCurrentCall ? "Görüşmeyi göster" : "Sesli odaya katıl"}
        </button>
      </div>
    </Modal>
  );
}
