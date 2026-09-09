export interface NotificationItem {
  id: string;
  workspaceId: string;
  channelId: string;
  messageId: string;
  kind: "mention" | "channel" | "reply" | "dm";
  actorName: string;
  channelName: string;
  preview: string;
  createdAt: string;
  read: boolean;
}
export interface NotificationState {
  workspaceId: string;
  notifications: NotificationItem[];
  unreadByChannel: Record<string, number>;
  unreadNotifications: number;
}
export interface DraftState {
  content: string;
  attachmentIds: string[];
  attachments: Attachment[];
  unavailableAttachmentIds: string[];
  revision: number;
  updatedAt: string | null;
}
export interface NotificationPreferences {
  pushEnabled: boolean;
}
import type { Attachment } from "./types";
