import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { DraftState } from "../../shared/collaboration-types";
import type { Attachment } from "../../shared/types";
import { api, ApiError } from "./api";
import {
  attachmentMetadata,
  draftMatchesSent,
  draftReception,
  draftValue,
  mergeDraftAttachments,
  readDraftConflict,
  sameDraft,
  type DraftScope,
  type DraftValue,
} from "./draft-value";
import type { DraftSendSnapshot } from "./useMessageSubmission";

type DraftStatus = "loading" | "saved" | "saving" | "offline" | "conflict";
type DraftView = DraftValue & {
  attachments: Attachment[];
  unavailableAttachmentIds: string[];
  status: DraftStatus;
  conflict: DraftState | null;
};
const owners = new Map<string, symbol>();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const attachmentIds = (value: unknown): string[] =>
  Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (id): id is string => typeof id === "string" && uuid.test(id),
          ),
        ),
      ].slice(0, 4)
    : [];

function cachedDraft(key: string, legacyKey: string, scope: DraftScope) {
  let content = "",
    base = "",
    revision = 0;
  let ids: string[] = [],
    baseIds: string[] = [],
    unavailableIds: string[] = [];
  let attachments: Attachment[] = [];
  let migratedFrom: string | null = null;
  let conflict: DraftState | null = null;
  try {
    const current = sessionStorage.getItem(key),
      sync = sessionStorage.getItem(`${key}:sync`);
    const source = current === null && sync === null ? legacyKey : key;
    content = sessionStorage.getItem(source) || "";
    const cached = JSON.parse(
      sessionStorage.getItem(`${source}:sync`) || "null",
    );
    if (source === legacyKey && (content || cached)) migratedFrom = legacyKey;
    if (
      cached &&
      typeof cached.base === "string" &&
      Number.isSafeInteger(cached.revision) &&
      cached.revision >= 0
    ) {
      base = cached.base;
      revision = cached.revision;
      ids = attachmentIds(cached.attachmentIds);
      baseIds = attachmentIds(cached.baseAttachmentIds);
      attachments = mergeDraftAttachments(
        ids,
        [],
        attachmentMetadata(cached.attachments),
      );
      unavailableIds = attachmentIds(cached.unavailableAttachmentIds).filter(
        (id) => ids.includes(id),
      );
      conflict = readDraftConflict(cached, scope);
    }
  } catch {
    /* Restricted storage still permits drafts in memory. */
  }
  return {
    content,
    base,
    revision,
    ids,
    baseIds,
    attachments,
    unavailableIds,
    migratedFrom,
    conflict,
  };
}

/** A scope owns its writes even when a previous Composer finishes after navigation. */
class DraftSession {
  readonly key: string;
  readonly path: string;
  readonly token = Symbol("draft-session");
  readonly listeners = new Set<() => void>();
  view: DraftView;
  base: DraftValue;
  revision: number;
  ready = false;
  alive = false;
  observed = false;
  busy = false;
  pending: DraftValue | null = null;
  sending: DraftSendSnapshot | null = null;
  queue: Promise<void> | null = null;
  loading: Promise<void> | null = null;
  loadVersion = 0;
  lastRemote: DraftState | null = null;
  timer: ReturnType<typeof setTimeout> | undefined;
  migratedFrom: string | null;

  constructor(readonly scope: DraftScope) {
    this.key = `mola:draft:${scope.userId}:${scope.workspaceId}:${scope.channelId}:${scope.parentId}`;
    this.path = `/channels/${scope.channelId}/draft${scope.parentId ? `?parentId=${encodeURIComponent(scope.parentId)}` : ""}`;
    const cache = cachedDraft(
      this.key,
      `mola:draft:${scope.userId}:${scope.channelId}:${scope.parentId}`,
      scope,
    );
    this.view = {
      content: cache.content,
      attachmentIds: cache.ids,
      attachments: cache.attachments,
      unavailableAttachmentIds: cache.unavailableIds,
      status: cache.conflict ? "conflict" : "loading",
      conflict: cache.conflict,
    };
    this.base = { content: cache.base, attachmentIds: cache.baseIds };
    this.revision = cache.revision;
    this.migratedFrom = cache.migratedFrom;
    this.lastRemote = cache.conflict;
  }
  owns = () => owners.get(this.key) === this.token;
  headers = () => ({
    "X-Workspace-Id": this.scope.workspaceId,
    "X-User-Id": this.scope.userId,
  });
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.view;
  publish(patch: Partial<DraftView>) {
    if (!this.owns()) return;
    this.view = { ...this.view, ...patch };
    this.persist();
    if (this.alive) this.listeners.forEach((listener) => listener());
  }
  persist() {
    if (!this.owns()) return;
    try {
      sessionStorage.setItem(this.key, this.view.content);
      sessionStorage.setItem(
        `${this.key}:sync`,
        JSON.stringify({
          scope: this.scope,
          base: this.base.content,
          baseAttachmentIds: this.base.attachmentIds,
          revision: this.revision,
          attachmentIds: this.view.attachmentIds,
          attachments: this.view.attachments,
          unavailableAttachmentIds: this.view.unavailableAttachmentIds,
          conflict: this.view.conflict,
        }),
      );
      if (this.migratedFrom) {
        sessionStorage.removeItem(this.migratedFrom);
        sessionStorage.removeItem(`${this.migratedFrom}:sync`);
        this.migratedFrom = null;
      }
    } catch {
      /* Keep the live draft if browser storage is unavailable. */
    }
  }
  receive = (remote: DraftState) => {
    if (!this.owns()) return;
    const reception = draftReception(
      this.view,
      this.base,
      this.pending,
      this.revision,
      remote,
    );
    if (reception === "stale") return;
    this.observed = true;
    this.lastRemote = remote;
    if (reception === "conflict") {
      this.publish({ conflict: remote, status: "conflict" });
      return;
    }
    this.base = draftValue(remote);
    this.revision = remote.revision;
    const ids =
      reception === "accept" ? remote.attachmentIds : this.view.attachmentIds;
    const unavailable =
      reception === "accept"
        ? remote.unavailableAttachmentIds
        : [
            ...this.view.unavailableAttachmentIds.filter(
              (id) => !remote.attachmentIds.includes(id),
            ),
            ...remote.unavailableAttachmentIds.filter((id) => ids.includes(id)),
          ];
    this.publish({
      ...(reception === "accept"
        ? { ...draftValue(remote), conflict: null, status: "saved" as const }
        : {}),
      attachments: mergeDraftAttachments(
        ids,
        this.view.attachments,
        remote.attachments,
      ),
      unavailableAttachmentIds: [...new Set(unavailable)],
    });
  };
  flush = async (): Promise<void> => {
    clearTimeout(this.timer);
    // Multiple callers can await the same old PUT; each rechecks the current base.
    while (this.queue) await this.queue;
    if (!this.owns() || !this.ready || this.view.conflict || this.busy) return;
    if (sameDraft(this.view, this.base)) {
      if (this.view.status === "saving") this.publish({ status: "saved" });
      return;
    }
    const sent = draftValue(this.view),
      revision = this.revision;
    this.pending = sent;
    this.publish({ status: "saving" });
    const work = (async () => {
      try {
        const remote = await api<DraftState>(this.path, {
          method: "PUT",
          headers: this.headers(),
          body: JSON.stringify({ ...sent, revision }),
        });
        this.receive(remote);
        if (this.owns() && !this.view.conflict)
          this.publish({
            status: sameDraft(this.view, this.base) ? "saved" : "saving",
          });
      } catch (error) {
        if (!this.owns()) return;
        if (
          error instanceof ApiError &&
          error.code === "DRAFT_CONFLICT" &&
          error.details?.draft
        )
          this.receive(error.details.draft as DraftState);
        else {
          const unavailable =
            error instanceof ApiError && error.code === "ATTACHMENT_UNAVAILABLE"
              ? attachmentIds(error.details?.unavailableAttachmentIds)
              : [];
          this.publish({
            status: "offline",
            unavailableAttachmentIds: [
              ...new Set([
                ...this.view.unavailableAttachmentIds,
                ...unavailable.filter((id) =>
                  this.view.attachmentIds.includes(id),
                ),
              ]),
            ],
          });
        }
      } finally {
        this.pending = null;
        this.queue = null;
      }
    })();
    this.queue = work;
    await work;
  };
  load = async (): Promise<void> => {
    if (!this.alive || !this.owns()) return;
    if (this.loading) return this.loading;
    const version = ++this.loadVersion;
    const work = (async () => {
      try {
        const remote = await api<DraftState>(this.path, {
          headers: this.headers(),
        });
        if (!this.alive || !this.owns() || version !== this.loadVersion) return;
        if (!this.ready) {
          this.ready = true;
          // A restored database can legitimately have a lower revision.
          if (remote.revision < this.revision && !this.observed) {
            if (
              !sameDraft(this.view, this.base) &&
              !sameDraft(remote, this.view)
            ) {
              this.publish({ conflict: remote, status: "conflict" });
              return;
            }
            this.revision = remote.revision;
          }
        }
        this.receive(remote);
        if (!this.view.conflict) void this.flush();
      } catch {
        if (this.alive && this.owns() && version === this.loadVersion)
          this.publish({ status: "offline" });
      } finally {
        if (version === this.loadVersion) this.loading = null;
      }
    })();
    this.loading = work;
    return work;
  };
  changed = (event: Event) => {
    const remote = (event as CustomEvent).detail;
    if (
      remote.workspaceId === this.scope.workspaceId &&
      remote.channelId === this.scope.channelId &&
      (remote.parentId || "") === this.scope.parentId &&
      (!remote.userId || remote.userId === this.scope.userId)
    )
      this.receive(remote);
  };
  connect = () => {
    owners.set(this.key, this.token);
    this.alive = true;
    this.persist();
    void this.load();
    window.addEventListener("mola:draft-changed", this.changed);
    window.addEventListener("online", this.load);
    window.addEventListener("focus", this.load);
    return () => {
      this.alive = false;
      clearTimeout(this.timer);
      void this.flush();
      window.removeEventListener("mola:draft-changed", this.changed);
      window.removeEventListener("online", this.load);
      window.removeEventListener("focus", this.load);
    };
  };
  edited(patch: Partial<DraftView>) {
    if (!this.alive || !this.owns() || this.busy) return;
    this.publish(patch);
    clearTimeout(this.timer);
    if (!this.view.conflict) {
      this.publish({
        status: this.ready
          ? "saving"
          : this.view.status === "loading"
            ? "loading"
            : "offline",
      });
      this.timer = setTimeout(() => void this.flush(), 500);
    }
  }
  update = (content: string) => this.edited({ content });
  updateAttachments = (
    next: Attachment[] | ((current: Attachment[]) => Attachment[]),
  ) => {
    const files = attachmentMetadata(
      typeof next === "function" ? next([...this.view.attachments]) : next,
    );
    // Missing server files may have no metadata; keep those IDs until explicitly removed.
    const unknownIds = this.view.attachmentIds.filter(
      (id) => !this.view.attachments.some((file) => file.id === id),
    );
    const ids = attachmentIds([...unknownIds, ...files.map((file) => file.id)]);
    this.edited({
      attachmentIds: ids,
      attachments: mergeDraftAttachments(ids, [], files),
      unavailableAttachmentIds: this.view.unavailableAttachmentIds.filter(
        (id) => ids.includes(id),
      ),
    });
  };
  removeAttachment = (id: string) =>
    this.edited({
      attachmentIds: this.view.attachmentIds.filter((item) => item !== id),
      attachments: this.view.attachments.filter((file) => file.id !== id),
      unavailableAttachmentIds: this.view.unavailableAttachmentIds.filter(
        (item) => item !== id,
      ),
    });
  resolve = (useRemote: boolean) => {
    const remote = this.view.conflict;
    if (!remote || !this.alive || !this.owns() || this.busy) return;
    this.base = draftValue(remote);
    this.revision = remote.revision;
    if (useRemote)
      this.publish({
        ...draftValue(remote),
        attachments: mergeDraftAttachments(
          remote.attachmentIds,
          this.view.attachments,
          remote.attachments,
        ),
        unavailableAttachmentIds: [...remote.unavailableAttachmentIds],
        conflict: null,
        status: "saved",
      });
    else {
      this.publish({ conflict: null, status: "saving" });
      void this.flush();
    }
  };
  beginSend = async (
    expectedContent = this.view.content,
  ): Promise<DraftSendSnapshot> => {
    const expected = {
      content: expectedContent,
      attachmentIds: [...this.view.attachmentIds],
    };
    if (!this.ready) await this.load();
    await this.flush();
    if (!this.alive || !this.owns())
      throw new Error("Kanal değişti. Mesaj gönderilmedi; taslağın korunuyor.");
    if (this.view.conflict || !sameDraft(this.view, expected))
      throw new Error(
        "Taslak başka bir cihazda değişti. Göndermeden önce taslağını kontrol et.",
      );
    if (this.view.unavailableAttachmentIds.length)
      throw new Error(
        "Kullanılamayan dosyaları kaldırıp yeniden eklemeden mesaj gönderilemez.",
      );
    if (!this.ready || !sameDraft(this.view, this.base))
      throw new Error(
        "Taslak eşitlenemedi. Bağlantını kontrol edip yeniden dene.",
      );
    this.busy = true;
    this.sending = {
      content: this.view.content.trim(),
      attachmentIds: [...this.view.attachmentIds],
      attachments: attachmentMetadata(this.view.attachments),
      draftRevision: this.revision,
    };
    return this.sending;
  };
  sent = async (snapshot = this.sending): Promise<void> => {
    if (!this.owns()) return;
    // A GET started before the POST cannot restore the just-sent draft.
    ++this.loadVersion;
    this.loading = null;
    if (snapshot && draftMatchesSent(this.view, this.revision, snapshot)) {
      this.base = { content: "", attachmentIds: [] };
      this.publish({
        content: "",
        attachmentIds: [],
        attachments: [],
        unavailableAttachmentIds: [],
      });
    }
    this.busy = false;
    this.sending = null;
    if (!this.view.conflict) this.publish({ status: "saved" });
    await this.load();
  };
  restoreSnapshot = async (snapshot: DraftSendSnapshot): Promise<void> => {
    if (!this.alive || !this.owns()) return;
    this.busy = true;
    await this.load();
    if (!this.alive || !this.owns()) return;
    const remote: DraftState = this.lastRemote || {
      ...draftValue(this.base),
      revision: this.revision,
      attachments: mergeDraftAttachments(
        this.base.attachmentIds,
        this.view.attachments,
        [],
      ),
      unavailableAttachmentIds: this.view.unavailableAttachmentIds.filter(
        (id) => this.base.attachmentIds.includes(id),
      ),
      updatedAt: null,
    };
    const conflict =
      remote.revision !== snapshot.draftRevision && !sameDraft(remote, snapshot)
        ? remote
        : null;
    this.busy = false;
    this.sending = null;
    this.publish({
      ...draftValue(snapshot),
      attachments: mergeDraftAttachments(
        snapshot.attachmentIds,
        snapshot.attachments,
        remote.attachments,
      ),
      unavailableAttachmentIds: remote.unavailableAttachmentIds.filter((id) =>
        snapshot.attachmentIds.includes(id),
      ),
      conflict,
      status: conflict ? "conflict" : this.ready ? "saving" : "offline",
    });
    if (!conflict) await this.flush();
  };
  failed = () => {
    this.busy = false;
    this.sending = null;
  };
  retry = async () => {
    await this.load();
    await this.flush();
  };
}

export function useSyncedDraft(
  userId: string,
  workspaceId: string,
  channelId: string,
  parentId = "",
) {
  const session = useMemo(
    () => new DraftSession({ userId, workspaceId, channelId, parentId }),
    [userId, workspaceId, channelId, parentId],
  );
  const view = useSyncExternalStore(
    session.subscribe,
    session.snapshot,
    session.snapshot,
  );
  useEffect(session.connect, [session]);
  return {
    ...view,
    update: session.update,
    updateAttachments: session.updateAttachments,
    removeAttachment: session.removeAttachment,
    resolve: session.resolve,
    beginSend: session.beginSend,
    sent: session.sent,
    failed: session.failed,
    restoreSnapshot: session.restoreSnapshot,
    retry: session.retry,
  };
}
