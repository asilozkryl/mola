import { Button } from "@/components/ui/button";
import { ArrowUpRight, Lock, MessageCircle } from "lucide-react";
import type { User } from "../../shared/types";
import { ProfileIdentity, ProfilePresence } from "./ProfileIdentity";
import { Avatar } from "./ui";
import "./direct-conversation.css";

type PersonProps = {
  peer?: User;
  name: string;
  selfId: string;
  online: boolean;
  connected: boolean;
  onProfile: (id: string) => void;
};

export function DirectConversationIdentity({
  peer,
  name,
  selfId,
  online,
  connected,
  onProfile,
}: PersonProps) {
  const available = peer && !peer.suspended;
  return (
    <>
      {available ? (
        <ProfileIdentity
          user={peer}
          selfId={selfId}
          online={online}
          connected={connected}
          onOpen={onProfile}
          className="direct-person-avatar"
        >
          <Avatar user={peer} online={connected && online} />
        </ProfileIdentity>
      ) : (
        <span className="direct-person-avatar">
          <Avatar user={peer} />
        </span>
      )}
      <div className="channel-title direct-person-title">
        <h1 aria-label={name}>
          {available ? (
            <ProfileIdentity
              user={peer}
              selfId={selfId}
              online={online}
              connected={connected}
              onOpen={onProfile}
              className="direct-person-name"
            >
              <strong>{name}</strong>
            </ProfileIdentity>
          ) : (
            name
          )}
        </h1>
        <div className="direct-person-detail">
          <span role="status" aria-atomic="true" data-connected={connected}>
            {peer?.suspended ? (
              "Hesap etkin değil"
            ) : (
              <ProfilePresence online={online} connected={connected} />
            )}
          </span>
          {(peer?.status || peer?.jobTitle) && (
            <span
              className="direct-person-note"
              title={peer.status || peer.jobTitle}
            >
              {peer.status || peer.jobTitle}
            </span>
          )}
        </div>
      </div>
    </>
  );
}

export function DirectConversationIntro({
  peer,
  name,
  selfId,
  online,
  connected,
  onProfile,
  hasMessages,
  onCompose,
}: PersonProps & { hasMessages: boolean; onCompose: () => void }) {
  if (hasMessages)
    return (
      <div className="direct-history-start">
        <Lock size={12} aria-hidden="true" />
        <span>{name} ile özel sohbetin</span>
      </div>
    );
  return (
    <div className="direct-conversation-intro">
      <Avatar user={peer} />
      <h2>{name} ile konuşmaya başla</h2>
      <p>
        Bir fikir paylaş veya merhaba de. Bu konuşmayı yalnızca ikiniz
        görebilirsiniz.
      </p>
      <div className="direct-intro-actions">
        <Button
          variant="outline"
          size="unset"
          type="button"
          className="secondary-button"
          onClick={onCompose}
        >
          <MessageCircle size={16} /> Mesaj yaz
        </Button>
        {peer && !peer.suspended && (
          <ProfileIdentity
            user={peer}
            selfId={selfId}
            online={online}
            connected={connected}
            onOpen={onProfile}
            className="direct-intro-profile"
          >
            Profili görüntüle <ArrowUpRight size={14} />
          </ProfileIdentity>
        )}
      </div>
    </div>
  );
}
