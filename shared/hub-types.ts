import type { NotificationItem } from "./collaboration-types";

export interface DirectConversation {
  channelId: string;
  userId: string;
  lastActivityAt: string;
  preview: string;
  hasDraft: boolean;
  unreadCount: number;
  lastMessageBySelf: boolean;
}

export interface DirectConversationsPage {
  workspaceId: string;
  userId: string;
  items: DirectConversation[];
  nextCursor: string | null;
}

export type ActivityKind = "all" | NotificationItem["kind"];
export interface ActivityItem extends NotificationItem {
  actorId: string;
}
export interface ActivityPage {
  workspaceId: string;
  userId: string;
  items: ActivityItem[];
  nextCursor: string | null;
}
