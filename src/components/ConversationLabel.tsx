import { Hash, Lock, MessageCircle } from "lucide-react";
import type { Channel, User } from "../../shared/types";
import { conversationIdentity } from "../lib/conversationIdentity";

export function ConversationLabel({
  channel,
  selfId,
  members,
}: {
  channel?: Channel;
  selfId: string;
  members: readonly User[];
}) {
  const identity = conversationIdentity(channel, selfId, members);
  const Icon = identity.direct
    ? MessageCircle
    : channel?.visibility === "private"
      ? Lock
      : Hash;
  return (
    <>
      <Icon size={13} aria-hidden="true" />
      {identity.name}
    </>
  );
}
