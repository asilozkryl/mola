import type { Attachment, Message, User } from "./types";

/** Date bounds are absolute instants: start inclusive, end exclusive. */
export interface CollectionFilters {
  q?: string;
  userId?: string;
  startAt?: string;
  endBefore?: string;
}
export interface CollectionQuery extends CollectionFilters {
  cursor?: string;
  limit?: number;
}
export interface ChannelFile extends Attachment {
  messageId: string;
  channelId: string;
  parentId: string | null;
  /** Upload timestamp; this is also the file list's stable sort key. */
  createdAt: string;
  user: User;
}
export interface ChannelFilesPage {
  files: ChannelFile[];
  nextCursor: string | null;
  total: number;
}
export interface ChannelPinsPage {
  messages: Message[];
  nextCursor: string | null;
  total: number;
}
export type PinnedMessagesPage = ChannelPinsPage;
/** Each history page is chronological; nextCursor loads an older page. */
export interface MessageHistoryPage {
  messages: Message[];
  hasMore: boolean;
  nextCursor: string | null;
}
/** Search pages are newest first. */
export interface MessageSearchPage extends MessageHistoryPage {}
