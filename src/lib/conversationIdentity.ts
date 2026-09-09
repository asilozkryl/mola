import type { Channel, User } from "../../shared/types";

export function getConversationMembers(
  channel: Channel | undefined,
  members: readonly User[],
) {
  if (!channel) return [];
  return members.filter(
    (member) =>
      !member.suspended &&
      (channel.kind === "dm" || channel.visibility === "private"
        ? channel.memberIds?.includes(member.id)
        : member.role !== "guest" || channel.memberIds?.includes(member.id)),
  );
}

export function conversationIdentity(
  channel: Channel | undefined,
  selfId: string,
  members: readonly User[],
) {
  const direct = channel?.kind === "dm";
  const peer = direct
    ? members.find(
        (member) =>
          member.id !== selfId && channel.memberIds?.includes(member.id),
      )
    : undefined;
  return {
    direct,
    peer,
    name: direct ? peer?.name || "Özel konuşma" : channel?.name || "Kanal",
  };
}
