import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import type { Channel, Message } from "../../shared/types";
import type {
  SavedMessagesPage as SavedPage,
  SavedMessageIds,
} from "../../shared/saved-types";
import { api } from "./api";
import { migrateSavedMessages, SavedMigrationError } from "./saved-migration";

type PageSnapshot = SavedPage & { context: string; pages: number };
const errorText = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;
const emptyIds = new Set<string>();

export function useSavedMessages({
  userId,
  workspaceId,
  active,
  socket,
  onError,
  enabled: allowed = true,
  channels,
}: {
  userId: string;
  workspaceId: string;
  active: boolean;
  enabled?: boolean;
  channels: readonly Channel[];
  socket: Socket | null;
  onError?: (message: string) => void;
}) {
  const scope = `${userId}:${workspaceId}`;
  const enabled = Boolean(allowed && userId && workspaceId);
  const channelIds = new Set(channels.map((channel) => channel.id));
  const channelSignature = [...channelIds].sort().join(":");
  const [query, setQuery] = useState("");
  const search = query.trim().slice(0, 200);
  const context = JSON.stringify([scope, search]);
  const [revision, setRevision] = useState(0);
  const [migrationRetry, setMigrationRetry] = useState(0);
  const [identity, setIdentity] = useState<{
    scope: string;
    ids: Set<string>;
    ready: boolean;
    loading: boolean;
    error: string;
  }>({ scope: "", ids: emptyIds, ready: false, loading: false, error: "" });
  const [snapshot, setSnapshot] = useState<PageSnapshot | null>(null);
  const [load, setLoad] = useState({
    context: "",
    loading: false,
    more: false,
    error: "",
  });
  const [pending, setPending] = useState<{ scope: string; ids: Set<string> }>({
    scope: "",
    ids: emptyIds,
  });
  const [importIssue, setImportIssue] = useState({ scope: "", error: "" });
  const [actionIssue, setActionIssue] = useState({ scope: "", error: "" });
  const live = useRef({ scope, context, alive: true, active, enabled });
  live.current = { ...live.current, scope, context, active, enabled };
  const identityRef = useRef(identity);
  const snapshotRef = useRef(snapshot);
  identityRef.current = identity;
  snapshotRef.current = snapshot;
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const idsRequest = useRef<AbortController | null>(null);
  const pageRequest = useRef<AbortController | null>(null);
  const bootRequest = useRef<AbortController | null>(null);
  const mutations = useRef(new Map<string, AbortController>());
  const pageVersion = useRef(0);
  const idsVersion = useRef(0);
  const mutationVersion = useRef(0);
  const migrating = useRef(false);
  const refreshQueued = useRef(false);
  const morePending = useRef(false);
  const headers = { "X-Workspace-Id": workspaceId, "X-User-Id": userId };
  const currentScope = () =>
    live.current.alive && live.current.enabled && live.current.scope === scope;

  const refreshIds = useCallback(async () => {
    if (!userId || !workspaceId || !live.current.enabled) return;
    idsRequest.current?.abort();
    const controller = new AbortController();
    idsRequest.current = controller;
    const version = ++idsVersion.current;
    const changes = mutationVersion.current;
    const current = () =>
      live.current.alive &&
      live.current.enabled &&
      live.current.scope === scope &&
      !controller.signal.aborted &&
      version === idsVersion.current &&
      changes === mutationVersion.current;
    setIdentity((old) => ({
      scope,
      ids: old.scope === scope ? old.ids : new Set(),
      ready: old.scope === scope && old.ready,
      loading: true,
      error: "",
    }));
    try {
      const next = await api<SavedMessageIds>("/saved/ids", {
        headers: { "X-Workspace-Id": workspaceId, "X-User-Id": userId },
        signal: controller.signal,
      });
      if (current())
        setIdentity({
          scope,
          ids: new Set(next.ids),
          ready: true,
          loading: false,
          error: "",
        });
    } catch (error) {
      if (current())
        setIdentity((old) => ({
          ...old,
          loading: false,
          error: errorText(
            error,
            "Kayıt durumları yüklenemedi. Yeniden deneyebilirsin.",
          ),
        }));
    }
  }, [scope, userId, workspaceId]);

  const refresh = useCallback(() => {
    if (!live.current.enabled) return;
    if (migrating.current || mutations.current.size) {
      refreshQueued.current = true;
      return;
    }
    refreshQueued.current = false;
    void refreshIds();
    pageVersion.current++;
    setRevision((value) => value + 1);
  }, [refreshIds]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    live.current.alive = true;
    return () => {
      live.current.alive = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    if (identityRef.current.scope !== scope) setQuery("");
    bootRequest.current = controller;
    idsRequest.current?.abort();
    pageRequest.current?.abort();
    idsVersion.current++;
    pageVersion.current++;
    for (const request of mutations.current.values()) request.abort();
    mutations.current.clear();
    setPending({ scope, ids: new Set() });
    setImportIssue({ scope, error: "" });
    setActionIssue({ scope, error: "" });
    setIdentity((old) => ({
      scope,
      ids: old.scope === scope ? old.ids : new Set(),
      ready: old.scope === scope && old.ready,
      loading: enabled,
      error: "",
    }));
    const current = () =>
      live.current.alive &&
      live.current.enabled &&
      live.current.scope === scope &&
      !controller.signal.aborted;
    if (enabled) {
      migrating.current = true;
      void (async () => {
        try {
          const ids = await migrateSavedMessages({
            storage: window.localStorage,
            userId,
            workspaceId,
            current,
            importBatch: (messageIds) =>
              api("/saved/import", {
                method: "POST",
                headers,
                signal: controller.signal,
                body: JSON.stringify({ messageIds }),
              }),
            readIds: async () =>
              (
                await api<SavedMessageIds>("/saved/ids", {
                  headers,
                  signal: controller.signal,
                })
              ).ids,
          });
          if (current() && ids)
            setIdentity({
              scope,
              ids: new Set(ids),
              ready: true,
              loading: false,
              error: "",
            });
        } catch (error) {
          if (!current()) return;
          if (
            error instanceof SavedMigrationError ||
            error instanceof DOMException
          )
            setImportIssue({
              scope,
              error:
                "Bu tarayıcıdaki kayıtların aktarımı tamamlanamadı. Yerel kayıtların korunuyor. Kaydetmeye devam etmek için aktarımı yeniden dene.",
            });
          await refreshIds();
        } finally {
          if (current()) {
            migrating.current = false;
            if (refreshQueued.current) refreshRef.current();
          }
        }
      })();
    } else migrating.current = false;
    return () => {
      controller.abort();
      idsRequest.current?.abort();
      pageRequest.current?.abort();
      for (const request of mutations.current.values()) request.abort();
    };
  }, [scope, enabled, migrationRetry, refreshIds]);

  const idsReady = enabled && identity.scope === scope && identity.ready;
  const saveReady =
    idsReady &&
    !migrating.current &&
    !(importIssue.scope === scope && importIssue.error);
  const previousChannels = useRef({ scope, channelSignature });
  useEffect(() => {
    const previous = previousChannels.current;
    previousChannels.current = { scope, channelSignature };
    if (
      previous.scope === scope &&
      previous.channelSignature !== channelSignature
    )
      refresh();
  }, [scope, channelSignature, refresh]);
  useEffect(() => {
    if (!enabled || !active || !idsReady || mutations.current.size) return;
    const controller = new AbortController();
    pageRequest.current?.abort();
    pageRequest.current = controller;
    const version = ++pageVersion.current;
    morePending.current = false;
    const current = () =>
      live.current.alive &&
      live.current.enabled &&
      live.current.context === context &&
      !controller.signal.aborted &&
      version === pageVersion.current;
    const previous = snapshotRef.current;
    const pages = previous?.context === context ? previous.pages : 1;
    setLoad({ context, loading: true, more: false, error: "" });
    const timer = window.setTimeout(
      () => {
        void (async () => {
          try {
            const items = new Map<string, Message>();
            let cursor: string | null = null;
            let total = 0;
            let loaded = 0;
            do {
              const params = new URLSearchParams({ limit: "50" });
              if (search) params.set("q", search);
              if (cursor) params.set("cursor", cursor);
              const page = await api<SavedPage>(`/saved?${params}`, {
                headers,
                signal: controller.signal,
              });
              if (!current()) return;
              page.items.forEach((message) => items.set(message.id, message));
              cursor = page.nextCursor;
              total = page.total;
              loaded++;
            } while (cursor && loaded < pages);
            setSnapshot({
              context,
              items: [...items.values()],
              nextCursor: cursor,
              total,
              pages: loaded,
            });
            setLoad({ context, loading: false, more: false, error: "" });
          } catch (error) {
            if (current())
              setLoad({
                context,
                loading: false,
                more: false,
                error: errorText(error, "Kaydedilen mesajlar yüklenemedi."),
              });
          }
        })();
      },
      previous?.context === context ? 0 : search ? 180 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [context, enabled, active, idsReady, revision]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => refreshRef.current(), 80);
    };
    const savedChanged = (event: { workspaceId?: string }) => {
      if (event?.workspaceId === workspaceId) schedule();
    };
    const messageChanged = (event: { id?: string }) => {
      if (
        event?.id &&
        identityRef.current.scope === scope &&
        identityRef.current.ids.has(event.id)
      )
        schedule();
    };
    window.addEventListener("focus", schedule);
    socket?.on("connect", schedule);
    socket?.on("saved:changed", savedChanged);
    socket?.on("message:updated", messageChanged);
    socket?.on("message:deleted", messageChanged);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", schedule);
      socket?.off("connect", schedule);
      socket?.off("saved:changed", savedChanged);
      socket?.off("message:updated", messageChanged);
      socket?.off("message:deleted", messageChanged);
    };
  }, [scope, workspaceId, socket]);

  async function loadMore() {
    const previous = snapshotRef.current;
    if (
      !active ||
      mutations.current.size > 0 ||
      previous?.context !== context ||
      !previous.nextCursor ||
      morePending.current ||
      (load.context === context && load.loading)
    )
      return;
    morePending.current = true;
    const controller = new AbortController();
    pageRequest.current?.abort();
    pageRequest.current = controller;
    const version = ++pageVersion.current;
    const current = () =>
      currentScope() &&
      live.current.context === context &&
      version === pageVersion.current &&
      !controller.signal.aborted;
    setLoad({ context, loading: false, more: true, error: "" });
    try {
      const params = new URLSearchParams({
        limit: "50",
        cursor: previous.nextCursor,
      });
      if (search) params.set("q", search);
      const next = await api<SavedPage>(`/saved?${params}`, {
        headers,
        signal: controller.signal,
      });
      if (!current()) return;
      setSnapshot({
        context,
        items: [
          ...new Map(
            [...previous.items, ...next.items].map((message) => [
              message.id,
              message,
            ]),
          ).values(),
        ],
        nextCursor: next.nextCursor,
        total: next.total,
        pages: previous.pages + 1,
      });
      setLoad({ context, loading: false, more: false, error: "" });
    } catch (error) {
      if (current())
        setLoad({
          context,
          loading: false,
          more: false,
          error: errorText(error, "Diğer kayıtlar yüklenemedi."),
        });
    } finally {
      if (current()) morePending.current = false;
    }
  }

  function invalidateUnavailable(messageId: string) {
    if (!currentScope()) return;
    // A confirmed 403/404 invalidates cached content, not the server bookmark.
    // Other pending bookmark actions still complete independently.
    mutations.current.get(messageId)?.abort();
    mutations.current.delete(messageId);
    mutationVersion.current++;
    idsVersion.current++;
    pageVersion.current++;
    idsRequest.current?.abort();
    pageRequest.current?.abort();
    morePending.current = false;
    setPending({ scope, ids: new Set(mutations.current.keys()) });
    setIdentity((old) => {
      if (old.scope !== scope) return old;
      const ids = new Set(old.ids);
      ids.delete(messageId);
      return { ...old, ids, loading: false };
    });
    setSnapshot((old) =>
      old
        ? {
            ...old,
            items: old.items.filter((message) => message.id !== messageId),
            total: Math.max(
              0,
              old.total -
                (old.items.some((message) => message.id === messageId) ? 1 : 0),
            ),
          }
        : old,
    );
    setLoad((old) => ({ ...old, loading: false, more: false }));
    refresh();
  }

  async function toggle(message: Message) {
    if (
      !enabled ||
      !saveReady ||
      migrating.current ||
      mutations.current.has(message.id)
    )
      return false;
    const controller = new AbortController();
    mutations.current.set(message.id, controller);
    mutationVersion.current++;
    idsRequest.current?.abort();
    pageRequest.current?.abort();
    pageVersion.current++;
    morePending.current = false;
    setLoad((old) =>
      old.context === context ? { ...old, loading: false, more: false } : old,
    );
    const wasSaved = identityRef.current.ids.has(message.id);
    setPending({ scope, ids: new Set(mutations.current.keys()) });
    setActionIssue({ scope, error: "" });
    try {
      await api(`/saved/${encodeURIComponent(message.id)}`, {
        method: wasSaved ? "DELETE" : "PUT",
        headers,
        signal: controller.signal,
      });
      if (!currentScope() || controller.signal.aborted) return false;
      setIdentity((old) => {
        if (old.scope !== scope) return old;
        const ids = new Set(old.ids);
        if (wasSaved) ids.delete(message.id);
        else ids.add(message.id);
        return { ...old, ids, loading: false, error: "" };
      });
      if (wasSaved)
        setSnapshot((old) =>
          old?.context === context
            ? {
                ...old,
                items: old.items.filter((item) => item.id !== message.id),
                total: Math.max(
                  0,
                  old.total -
                    (old.items.some((item) => item.id === message.id) ? 1 : 0),
                ),
              }
            : old,
        );
      return true;
    } catch (error) {
      if (currentScope() && !controller.signal.aborted) {
        const text = errorText(
          error,
          "Kayıt durumu değiştirilemedi. Yeniden deneyebilirsin.",
        );
        setActionIssue({ scope, error: text });
        errorRef.current?.(text);
      }
      return false;
    } finally {
      if (mutations.current.get(message.id) === controller) {
        mutations.current.delete(message.id);
        if (currentScope()) {
          setPending({ scope, ids: new Set(mutations.current.keys()) });
          refresh();
        }
      }
    }
  }

  function retry() {
    setActionIssue({ scope, error: "" });
    if (importIssue.scope === scope && importIssue.error)
      setMigrationRetry((value) => value + 1);
    else refresh();
  }
  const page = snapshot?.context === context ? snapshot : null;
  return {
    ids: identity.scope === scope ? identity.ids : emptyIds,
    idsReady,
    saveReady,
    idsLoading: enabled && (identity.scope !== scope || identity.loading),
    idsError: identity.scope === scope ? identity.error : "",
    pendingIds: pending.scope === scope ? pending.ids : emptyIds,
    items: enabled
      ? (page?.items || []).filter((message) =>
          channelIds.has(message.channelId),
        )
      : [],
    total: page?.total ?? 0,
    query,
    setQuery,
    loading:
      enabled &&
      active &&
      ((!idsReady && !identity.error) ||
        (idsReady && (load.context !== context || load.loading))),
    loadingMore: load.context === context && load.more,
    error: load.context === context ? load.error : "",
    importError: importIssue.scope === scope ? importIssue.error : "",
    actionError: actionIssue.scope === scope ? actionIssue.error : "",
    hasMore: Boolean(page?.nextCursor),
    loadMore,
    retry,
    refresh,
    toggle,
    invalidateUnavailable,
  };
}

export type SavedMessagesState = ReturnType<typeof useSavedMessages>;
