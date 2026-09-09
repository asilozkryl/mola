export type NotificationMode = "all" | "mentions" | "off";
export interface QuietHours {
  enabled: boolean;
  timeZone: string;
  start: string;
  end: string;
}
export interface ChannelNotificationPreference {
  channelId: string;
  mode: NotificationMode | "inherit";
  effectiveMode: NotificationMode;
  mutedUntil: string | null;
}
export interface WorkspaceNotificationSettings {
  workspaceId: string;
  defaultMode: NotificationMode;
  mutedUntil: string | null;
  quietHours: QuietHours;
  channels: ChannelNotificationPreference[];
  serverNow: string;
}
export interface ChannelNotificationSettings extends ChannelNotificationPreference {
  workspaceId: string;
  workspaceMutedUntil: string | null;
  quietHours: QuietHours;
  serverNow: string;
}
export interface PushDiagnostic {
  id: string;
  workspaceId: string;
  status: "queued" | "providerAccepted" | "failed";
  attempts: number;
  createdAt: string;
  updatedAt: string;
  nextAttemptAt: string | null;
  reasonCode: string | null;
  lastFailureCode?: string | null;
  lastFailureAt?: string | null;
}
