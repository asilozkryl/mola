import type { User } from "./types";

export type MentionMember = Pick<User, "id" | "name">;
export const MENTION_TOKEN_SOURCE =
  "@\\[[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\]";

export interface MentionRange {
  start: number;
  end: number;
  userId: string;
  label: string;
}

export interface MentionText {
  text: string;
  mentions: MentionRange[];
}

export function mentionLabel(member?: MentionMember) {
  return `@${member?.name.replace(/\s+/g, " ").trim() || "Üye"}`;
}

/** The textarea shows names; only the serialized text contains stable IDs. */
export function decodeMentions(
  content: string,
  members: readonly MentionMember[],
): MentionText {
  const byId = new Map(
    members.map((member) => [member.id.toLowerCase(), member]),
  );
  const mentions: MentionRange[] = [];
  let text = "";
  let offset = 0;
  for (const match of content.matchAll(
    new RegExp(MENTION_TOKEN_SOURCE, "gi"),
  )) {
    text += content.slice(offset, match.index);
    const userId = match[0].slice(2, -1).toLowerCase();
    const label = mentionLabel(byId.get(userId));
    mentions.push({
      start: text.length,
      end: text.length + label.length,
      userId,
      label,
    });
    text += label;
    offset = match.index + match[0].length;
  }
  return { text: text + content.slice(offset), mentions };
}

export function encodeMentions(document: MentionText) {
  let content = "";
  let offset = 0;
  for (const mention of document.mentions) {
    if (
      mention.start < offset ||
      document.text.slice(mention.start, mention.end) !== mention.label
    )
      continue;
    content +=
      document.text.slice(offset, mention.start) + `@[${mention.userId}]`;
    offset = mention.end;
  }
  return content + document.text.slice(offset);
}

/** An edit inside a mention makes that text ordinary text; untouched targets survive. */
export function replaceMentionRange(
  document: MentionText,
  start: number,
  end: number,
  replacement: string,
  member?: MentionMember,
): MentionText {
  const shift = replacement.length - (end - start);
  const mentions = document.mentions.flatMap((mention) => {
    if (mention.end <= start) return [mention];
    if (mention.start >= end)
      return [
        { ...mention, start: mention.start + shift, end: mention.end + shift },
      ];
    return [];
  });
  if (member) {
    const label = mentionLabel(member);
    mentions.push({
      start,
      end: start + label.length,
      userId: member.id,
      label,
    });
    mentions.sort((a, b) => a.start - b.start);
  }
  return {
    text:
      document.text.slice(0, start) + replacement + document.text.slice(end),
    mentions,
  };
}

export function updateMentionText(
  document: MentionText,
  text: string,
  caret = text.length,
): MentionText {
  if (text === document.text) return document;
  // The resulting caret distinguishes removing the first of two identical names
  // from removing the second. A plain longest-prefix diff cannot do that.
  let start = 0;
  const prefixLimit = Math.min(document.text.length, text.length, caret);
  while (start < prefixLimit && document.text[start] === text[start]) start++;
  let end = document.text.length;
  let nextEnd = text.length;
  while (
    end > start &&
    nextEnd > Math.max(start, caret) &&
    document.text[end - 1] === text[nextEnd - 1]
  ) {
    end--;
    nextEnd--;
  }
  return replaceMentionRange(document, start, end, text.slice(start, nextEnd));
}

/** Resolve before shortening so preview boundaries cannot expose a partial UUID. */
export function mentionPreview(
  content: string,
  members: readonly MentionMember[],
) {
  return decodeMentions(content, members).text.replace(
    /@\[[0-9a-f-]*$/i,
    "@Üye",
  );
}
