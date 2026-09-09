import { useCallback, useSyncExternalStore } from "react";
import type { Attachment, Message } from "../../shared/types";
import { api, ApiError } from "./api";

export interface DraftSendSnapshot {
  content: string;
  attachmentIds: string[];
  attachments: Attachment[];
  draftRevision: number;
}
type SubmissionScope = {
  userId: string;
  workspaceId: string;
  channelId: string;
  parentId?: string;
};
export interface MessageSubmissionSnapshot
  extends DraftSendSnapshot, SubmissionScope {
  clientMessageId: string;
}
type SubmissionState = {
  status: "idle" | "sending" | "failed" | "succeeded";
  snapshot: MessageSubmissionSnapshot | null;
  message: Message | null;
  error: string;
  ambiguous: boolean;
  canRelease: boolean;
  restoreOnRelease: boolean;
};
type Entry = {
  key: string;
  scope: SubmissionScope;
  state: SubmissionState;
  listeners: Set<() => void>;
  promise: Promise<Message> | null;
  corrupt: boolean;
};
const entries = new Map<string, Entry>();
const empty = (): SubmissionState => ({
  status: "idle",
  snapshot: null,
  message: null,
  error: "",
  ambiguous: false,
  canRelease: false,
  restoreOnRelease: false,
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uncertain = "Sunucudan gönderim onayı alınamadı.";
const storageFailure =
  "Gönderim bilgisi bu tarayıcıda korunamadı. Tarayıcı depolama iznini kontrol edip yeniden dene.";

function scopeKey(scope: SubmissionScope) {
  return `mola:submission:${scope.userId}:${scope.workspaceId}:${scope.channelId}:${scope.parentId || ""}`;
}
function isSnapshot(
  value: unknown,
  scope: SubmissionScope,
): value is MessageSubmissionSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as MessageSubmissionSnapshot;
  return (
    snapshot.userId === scope.userId &&
    snapshot.workspaceId === scope.workspaceId &&
    snapshot.channelId === scope.channelId &&
    (snapshot.parentId || "") === (scope.parentId || "") &&
    typeof snapshot.clientMessageId === "string" &&
    uuid.test(snapshot.clientMessageId) &&
    typeof snapshot.content === "string" &&
    snapshot.content.length <= 10000 &&
    Array.isArray(snapshot.attachmentIds) &&
    snapshot.attachmentIds.length <= 4 &&
    snapshot.attachmentIds.every(
      (id) => typeof id === "string" && uuid.test(id),
    ) &&
    Array.isArray(snapshot.attachments) &&
    snapshot.attachments.every(
      (file) =>
        file &&
        typeof file.id === "string" &&
        typeof file.name === "string" &&
        typeof file.size === "number" &&
        typeof file.mime === "string" &&
        typeof file.url === "string",
    ) &&
    Number.isSafeInteger(snapshot.draftRevision) &&
    snapshot.draftRevision >= 0
  );
}
function isMessage(value: unknown, scope: SubmissionScope): value is Message {
  if (!value || typeof value !== "object") return false;
  const message = value as Message;
  return (
    typeof message.id === "string" &&
    uuid.test(message.id) &&
    message.channelId === scope.channelId &&
    message.userId === scope.userId &&
    (message.parentId || "") === (scope.parentId || "") &&
    typeof message.content === "string" &&
    Array.isArray(message.attachments)
  );
}
function entryFor(scope: SubmissionScope) {
  const key = scopeKey(scope);
  const existing = entries.get(key);
  if (existing) return existing;
  const entry: Entry = {
    key,
    scope: { ...scope },
    state: empty(),
    listeners: new Set(),
    promise: null,
    corrupt: false,
  };
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) {
      const stored = JSON.parse(raw);
      if (!isSnapshot(stored.snapshot, scope))
        throw new Error("invalid snapshot");
      if (stored.status === "succeeded" && isMessage(stored.message, scope))
        entry.state = {
          ...empty(),
          status: "succeeded",
          snapshot: stored.snapshot,
          message: stored.message,
        };
      else
        entry.state = {
          status: "failed",
          snapshot: stored.snapshot,
          message: null,
          error:
            stored.status === "failed" && typeof stored.error === "string"
              ? stored.error
              : uncertain,
          ambiguous:
            stored.status === "failed" ? stored.ambiguous !== false : true,
          canRelease: stored.status === "failed" && stored.canRelease === true,
          restoreOnRelease:
            stored.status === "failed" && stored.restoreOnRelease === true,
        };
    }
  } catch (error) {
    // An unreadable existing record must not silently generate a replacement ID.
    if (!(error instanceof DOMException)) {
      entry.corrupt = true;
      entry.state = {
        ...empty(),
        status: "failed",
        error:
          "Önceki gönderim kaydı okunamadı. Bu sekmede yeni bir gönderim başlatılamıyor.",
      };
    }
  }
  entries.set(key, entry);
  return entry;
}
function publish(entry: Entry, state: SubmissionState) {
  entry.state = state;
  entry.listeners.forEach((listener) => listener());
}
function persist(entry: Entry) {
  try {
    if (entry.state.status === "idle") sessionStorage.removeItem(entry.key);
    else sessionStorage.setItem(entry.key, JSON.stringify(entry.state));
    return true;
  } catch {
    return false;
  }
}
function perform(entry: Entry): Promise<Message> {
  if (entry.promise) return entry.promise;
  if (entry.state.status === "succeeded" && entry.state.message)
    return Promise.resolve(entry.state.message);
  const snapshot = entry.state.snapshot;
  if (!snapshot || entry.corrupt)
    return Promise.reject(
      new Error(entry.state.error || "Gönderilecek mesaj bulunamadı."),
    );
  const wasAmbiguous = entry.state.ambiguous;
  publish(entry, {
    ...entry.state,
    status: "sending",
    error: "",
    ambiguous: wasAmbiguous,
    canRelease: false,
  });
  if (!persist(entry)) {
    publish(entry, {
      ...entry.state,
      status: "failed",
      error: storageFailure,
      ambiguous: wasAmbiguous,
      canRelease: !wasAmbiguous,
      restoreOnRelease: !wasAmbiguous,
    });
    return Promise.reject(new Error(storageFailure));
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  const work = (async () => {
    try {
      const message = await api<Message>(
        `/channels/${snapshot.channelId}/messages`,
        {
          method: "POST",
          headers: {
            "X-Workspace-Id": snapshot.workspaceId,
            "X-User-Id": snapshot.userId,
          },
          signal: controller.signal,
          body: JSON.stringify({
            content: snapshot.content,
            attachmentIds: snapshot.attachmentIds,
            ...(snapshot.parentId ? { parentId: snapshot.parentId } : {}),
            clientMessageId: snapshot.clientMessageId,
            draftRevision: snapshot.draftRevision,
          }),
        },
      );
      if (!isMessage(message, entry.scope))
        throw new Error("Gönderim yanıtı doğrulanamadı.");
      publish(entry, { ...empty(), status: "succeeded", snapshot, message });
      persist(entry);
      return message;
    } catch (error) {
      const canRelease =
        error instanceof ApiError &&
        ((!wasAmbiguous && error.status === 400) ||
          error.code === "ATTACHMENT_UNAVAILABLE" ||
          error.code === "MESSAGE_ALREADY_DELETED");
      const text = error instanceof ApiError ? error.message : uncertain;
      publish(entry, {
        status: "failed",
        snapshot,
        message: null,
        error: text,
        ambiguous: !canRelease,
        canRelease,
        restoreOnRelease:
          canRelease &&
          error instanceof ApiError &&
          error.code !== "MESSAGE_ALREADY_DELETED",
      });
      persist(entry);
      throw new Error(text);
    } finally {
      clearTimeout(timeout);
      entry.promise = null;
    }
  })();
  entry.promise = work;
  return work;
}

/** One durable, manually retried attempt per full draft scope; never an outbox. */
export function useMessageSubmission(scope: SubmissionScope) {
  const entry = entryFor(scope);
  const subscribe = useCallback(
    (listener: () => void) => {
      entry.listeners.add(listener);
      return () => {
        entry.listeners.delete(listener);
      };
    },
    [entry],
  );
  const state = useSyncExternalStore(
    subscribe,
    () => entry.state,
    () => entry.state,
  );
  function submit(snapshot: DraftSendSnapshot) {
    if (entry.corrupt) return Promise.reject(new Error(entry.state.error));
    if (!entry.state.snapshot) {
      const frozen: MessageSubmissionSnapshot = {
        ...entry.scope,
        content: snapshot.content,
        attachmentIds: [...snapshot.attachmentIds],
        attachments: snapshot.attachments.map((file) => ({ ...file })),
        draftRevision: snapshot.draftRevision,
        clientMessageId: crypto.randomUUID(),
      };
      publish(entry, { ...empty(), snapshot: frozen });
    }
    return perform(entry);
  }
  function acknowledge() {
    if (entry.state.status !== "succeeded") return;
    publish(entry, empty());
    persist(entry);
  }
  function release() {
    if (entry.state.status !== "failed" || !entry.state.canRelease) return null;
    const snapshot = entry.state.restoreOnRelease ? entry.state.snapshot : null;
    publish(entry, empty());
    persist(entry);
    return snapshot;
  }
  return {
    ...state,
    submit,
    retry: () => perform(entry),
    acknowledge,
    release,
  };
}
