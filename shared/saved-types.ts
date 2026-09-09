import type { Message } from "./types";

export interface SavedMessagesPage {
  items: Message[];
  nextCursor: string | null;
  total: number;
}

export interface SavedMessageIds {
  ids: string[];
}

export interface SavedMessagesChanged {
  workspaceId: string;
}
