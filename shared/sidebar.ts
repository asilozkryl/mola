import type { Channel } from "./types";

export type SidebarSection = "favorites" | "channels" | "voice" | "dms";
export type SidebarOrder = "text" | "voice" | "favorites";
export interface SidebarPreferences {
  textOrder: string[];
  voiceOrder: string[];
  favoriteIds: string[];
  collapsedSections: SidebarSection[];
  width?: number;
}
export interface SidebarPreferencesState {
  userId: string;
  workspaceId: string;
  revision: number;
  preferences: SidebarPreferences;
}
export interface SidebarConversation {
  channelId: string;
  userId: string;
  lastActivityAt: string;
  preview: string;
  hasDraft: boolean;
}
export interface SidebarConversationsState {
  userId: string;
  workspaceId: string;
  conversations: SidebarConversation[];
}
export const SIDEBAR_SECTIONS: SidebarSection[] = [
  "favorites",
  "channels",
  "voice",
  "dms",
];
export function normalizeSidebarPreferences(
  value: Partial<SidebarPreferences>,
  channels: Channel[],
): SidebarPreferences {
  const active = channels.filter(
    (channel) => !channel.archived && channel.kind !== "dm",
  );
  const order = (ids: string[] | undefined, kind: "text" | "voice") => {
    const allowed = active
      .filter((channel) => channel.kind === kind)
      .map((channel) => channel.id);
    const available = new Set(allowed);
    return [
      ...new Set([
        ...(ids || []).filter((id) => available.has(id)),
        ...allowed,
      ]),
    ];
  };
  const allowed = new Set(active.map((channel) => channel.id));
  return {
    textOrder: order(value.textOrder, "text"),
    voiceOrder: order(value.voiceOrder, "voice"),
    favoriteIds: [...new Set(value.favoriteIds || [])].filter((id) =>
      allowed.has(id),
    ),
    collapsedSections: [...new Set(value.collapsedSections || [])].filter(
      (section) => SIDEBAR_SECTIONS.includes(section),
    ),
    ...(typeof value.width === "number" && Number.isFinite(value.width)
      ? { width: Math.min(340, Math.max(240, Math.round(value.width))) }
      : {}),
  };
}
