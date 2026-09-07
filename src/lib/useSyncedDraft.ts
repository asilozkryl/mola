import { useCallback, useEffect, useRef, useState } from "react";
import type { DraftState } from "../../shared/collaboration-types";
import { api, ApiError } from "./api";

function cachedDraft(key: string) {
  let content = "",
    base = "",
    revision = 0;
  try {
    content = sessionStorage.getItem(key) || "";
    const cached = JSON.parse(sessionStorage.getItem(`${key}:sync`) || "null");
    if (
      cached &&
      typeof cached.base === "string" &&
      Number.isSafeInteger(cached.revision) &&
      cached.revision >= 0
    ) {
      base = cached.base;
      revision = cached.revision;
    }
  } catch {
    /* Restricted storage still permits drafts in memory. */
  }
  return { content, base, revision };
}

export function useSyncedDraft(
  userId: string,
  workspaceId: string,
  channelId: string,
  parentId = "",
) {
  const key = `mola:draft:${userId}:${channelId}:${parentId}`;
  const path = `/channels/${channelId}/draft${parentId ? `?parentId=${encodeURIComponent(parentId)}` : ""}`;
  const initial = useRef(cachedDraft(key));
  const [content, setContent] = useState(initial.current.content);
  const [status, setStatus] = useState<
    "loading" | "saved" | "saving" | "offline" | "conflict"
  >("loading");
  const [conflict, setConflict] = useState<DraftState | null>(null);
  const state = useRef({
    ...initial.current,
    ready: false,
    alive: true,
    conflict: null as DraftState | null,
    pending: null as string | null,
    busy: false,
    sending: null as string | null,
    observed: false,
  });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queue = useRef<Promise<void> | null>(null);
  const reload = useRef<() => Promise<void>>(async () => {});
  const persist = useCallback(() => {
    const s = state.current;
    try {
      sessionStorage.setItem(key, s.content);
      sessionStorage.setItem(
        `${key}:sync`,
        JSON.stringify({ base: s.base, revision: s.revision }),
      );
    } catch {
      /* Keep the live draft if browser storage is unavailable. */
    }
  }, [key]);
  const show = useCallback(
    (next: string) => {
      state.current.content = next;
      persist();
      if (state.current.alive) setContent(next);
    },
    [persist],
  );
  const receive = useCallback(
    (remote: DraftState) => {
      const s = state.current;
      if (remote.revision < s.revision) return;
      s.observed = true;
      const dirty = s.content !== s.base;
      if (!dirty || remote.content === s.content) {
        s.base = remote.content;
        s.revision = remote.revision;
        s.conflict = null;
        show(remote.content);
        if (s.alive) {
          setConflict(null);
          setStatus("saved");
        }
      } else if (s.pending === remote.content) {
        // Acknowledging previous text must not replace a newer local edit.
        s.base = remote.content;
        s.revision = remote.revision;
      } else if (remote.revision > s.revision && remote.content !== s.base) {
        s.conflict = remote;
        if (s.alive) {
          setConflict(remote);
          setStatus("conflict");
        }
      } else {
        s.revision = remote.revision;
        s.base = remote.content;
      }
      persist();
    },
    [persist, show],
  );
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    // Recheck after every wait: multiple callers may await the same old PUT.
    while (queue.current) await queue.current;
    const s = state.current;
    if (!s.ready || s.conflict || s.busy || s.content === s.base) return;
    const sent = s.content;
    s.pending = sent;
    if (s.alive) setStatus("saving");
    const work = (async () => {
      try {
        const remote = await api<DraftState>(path, {
          method: "PUT",
          headers: { "X-Workspace-Id": workspaceId, "X-User-Id": userId },
          body: JSON.stringify({ content: sent, revision: s.revision }),
        });
        receive(remote);
        if (s.alive && !s.conflict)
          setStatus(s.content === s.base ? "saved" : "saving");
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.code === "DRAFT_CONFLICT" &&
          error.details?.draft
        )
          receive(error.details.draft as DraftState);
        else if (s.alive) setStatus("offline");
      } finally {
        s.pending = null;
        queue.current = null;
      }
    })();
    queue.current = work;
    await work;
  }, [path, workspaceId, receive]);
  useEffect(() => {
    let disposed = false,
      loading: Promise<void> | null = null;
    state.current.alive = true;
    const load = async () => {
      if (loading) return loading;
      const work = (async () => {
        try {
          const remote = await api<DraftState>(path, {
            headers: { "X-Workspace-Id": workspaceId, "X-User-Id": userId },
          });
          if (disposed) return;
          const s = state.current;
          if (!s.ready) {
            s.ready = true;
            // Restoring an older database can lower the server revision.
            if (remote.revision < s.revision && !s.observed) {
              if (s.content !== s.base && remote.content !== s.content) {
                s.conflict = remote;
                setConflict(remote);
                setStatus("conflict");
                return;
              }
              s.revision = remote.revision;
            }
          }
          receive(remote);
          if (!s.conflict) void flush();
        } catch {
          if (!disposed) setStatus("offline");
        } finally {
          loading = null;
        }
      })();
      loading = work;
      return work;
    };
    reload.current = load;
    void load();
    const changed = (event: Event) => {
      const remote = (event as CustomEvent).detail;
      if (
        remote.workspaceId === workspaceId &&
        remote.channelId === channelId &&
        (remote.parentId || "") === parentId
      )
        receive(remote);
    };
    window.addEventListener("mola:draft-changed", changed);
    window.addEventListener("online", load);
    window.addEventListener("focus", load);
    return () => {
      disposed = true;
      state.current.alive = false;
      clearTimeout(timer.current);
      void flush();
      window.removeEventListener("mola:draft-changed", changed);
      window.removeEventListener("online", load);
      window.removeEventListener("focus", load);
    };
  }, [key, path, workspaceId, channelId, parentId, flush, receive]);
  function update(value: string) {
    if (state.current.busy) return;
    show(value);
    clearTimeout(timer.current);
    if (!state.current.conflict) {
      setStatus((current) =>
        state.current.ready
          ? "saving"
          : current === "loading"
            ? "loading"
            : "offline",
      );
      timer.current = setTimeout(() => void flush(), 500);
    }
  }
  function resolve(useRemote: boolean) {
    const remote = state.current.conflict;
    if (!remote) return;
    state.current.base = remote.content;
    state.current.revision = remote.revision;
    state.current.conflict = null;
    setConflict(null);
    persist();
    if (useRemote) {
      show(remote.content);
      setStatus("saved");
    } else {
      setStatus("saving");
      void flush();
    }
  }
  async function beginSend(expectedContent = state.current.content) {
    if (!state.current.ready) await reload.current();
    await flush();
    const s = state.current;
    if (!s.alive)
      throw new Error("Kanal değişti. Mesaj gönderilmedi; taslağın korunuyor.");
    if (s.conflict || s.content !== expectedContent)
      throw new Error(
        "Taslak başka bir cihazda değişti. Göndermeden önce taslağını kontrol et.",
      );
    if (!s.ready || s.content !== s.base)
      throw new Error(
        "Taslak eşitlenemedi. Bağlantını kontrol edip yeniden dene.",
      );
    s.busy = true;
    s.sending = expectedContent;
  }
  async function sent() {
    const s = state.current;
    if (s.content === s.sending) {
      s.base = "";
      show("");
    }
    s.busy = false;
    s.sending = null;
    if (s.alive && !s.conflict) setStatus("saved");
    try {
      receive(
        await api<DraftState>(path, {
          headers: { "X-Workspace-Id": workspaceId, "X-User-Id": userId },
        }),
      );
    } catch {
      if (s.alive) setStatus("offline");
    }
  }
  function failed() {
    state.current.busy = false;
    state.current.sending = null;
  }
  return {
    content,
    update,
    status,
    conflict,
    resolve,
    beginSend,
    sent,
    failed,
    retry: async () => {
      await reload.current();
      await flush();
    },
  };
}
