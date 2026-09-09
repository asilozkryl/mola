import type { DraftState } from "../../shared/collaboration-types";
import type { Attachment } from "../../shared/types";

export type DraftValue = { content: string; attachmentIds: string[] };
export type DraftScope = {
  userId: string;
  workspaceId: string;
  channelId: string;
  parentId: string;
};

/** Conflict choices are scoped and validated independently of the editable cache. */
export function readDraftConflict(
  cache: unknown,
  scope: DraftScope,
): DraftState | null {
  if (!cache || typeof cache !== "object") return null;
  const record = cache as { scope?: DraftScope; conflict?: DraftState };
  if (
    !record.scope ||
    (Object.keys(scope) as (keyof DraftScope)[]).some(
      (key) => record.scope![key] !== scope[key],
    )
  )
    return null;
  const draft = record.conflict;
  if (
    !draft ||
    typeof draft !== "object" ||
    typeof draft.content !== "string" ||
    draft.content.length > 10000 ||
    !Number.isSafeInteger(draft.revision) ||
    draft.revision < 0 ||
    (draft.updatedAt !== null && typeof draft.updatedAt !== "string")
  )
    return null;
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (
    !Array.isArray(draft.attachmentIds) ||
    draft.attachmentIds.length > 4 ||
    draft.attachmentIds.some(
      (id) => typeof id !== "string" || !uuid.test(id),
    ) ||
    new Set(draft.attachmentIds).size !== draft.attachmentIds.length
  )
    return null;
  if (
    !Array.isArray(draft.unavailableAttachmentIds) ||
    draft.unavailableAttachmentIds.some(
      (id) => !draft.attachmentIds.includes(id),
    )
  )
    return null;
  const attachments = attachmentMetadata(draft.attachments);
  if (
    !Array.isArray(draft.attachments) ||
    attachments.length !== draft.attachments.length ||
    attachments.some((file) => !draft.attachmentIds.includes(file.id))
  )
    return null;
  return {
    ...draftValue(draft),
    attachments,
    unavailableAttachmentIds: [...new Set(draft.unavailableAttachmentIds)],
    revision: draft.revision,
    updatedAt: draft.updatedAt,
  };
}
export function sameDraft(left: DraftValue, right: DraftValue) {
  return (
    left.content === right.content &&
    left.attachmentIds.length === right.attachmentIds.length &&
    left.attachmentIds.every((id, index) => id === right.attachmentIds[index])
  );
}
export function draftValue(value: DraftValue): DraftValue {
  return { content: value.content, attachmentIds: [...value.attachmentIds] };
}
/** A late acknowledgement must advance the base without replacing newer edits. */
export function draftReception(
  local: DraftValue,
  base: DraftValue,
  pending: DraftValue | null,
  revision: number,
  remote: DraftState,
) {
  if (remote.revision < revision) return "stale";
  if (sameDraft(local, base) || sameDraft(local, remote)) return "accept";
  if (pending && sameDraft(pending, remote)) return "acknowledge";
  if (remote.revision > revision && !sameDraft(remote, base)) return "conflict";
  return "base";
}
export function draftMatchesSent(
  local: DraftValue,
  revision: number,
  sent: DraftValue & { draftRevision: number },
) {
  return (
    revision <= sent.draftRevision &&
    sameDraft({ ...local, content: local.content.trim() }, sent)
  );
}
export function attachmentMetadata(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (file): file is Attachment =>
        Boolean(file) &&
        typeof file.id === "string" &&
        typeof file.name === "string" &&
        typeof file.size === "number" &&
        Number.isFinite(file.size) &&
        typeof file.mime === "string" &&
        typeof file.url === "string",
    )
    .map(({ id, name, size, mime, url }) => ({ id, name, size, mime, url }));
}
export function mergeDraftAttachments(
  ids: string[],
  previous: Attachment[],
  remote: Attachment[],
) {
  const byId = new Map([...previous, ...remote].map((file) => [file.id, file]));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}
