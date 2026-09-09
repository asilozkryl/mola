import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ChannelFile,
  ChannelFilesPage,
  ChannelPinsPage,
} from "../../shared/collection-types";
import type { Message } from "../../shared/types";
import { api, ApiError } from "./api";
import { collectionDateRange } from "./collection-filters";

export type CollectionKind = "files" | "pins";
type Filters = {
  query: string;
  senderId: string;
  startDate: string;
  endDate: string;
};
type Snapshot = {
  context: string;
  files: ChannelFile[];
  messages: Message[];
  total: number;
  nextCursor: string | null;
  pages: number;
};
type LoadState = {
  context: string;
  loading: boolean;
  more: boolean;
  error: string;
  failedMore: boolean;
};
const emptyFilters: Filters = {
  query: "",
  senderId: "",
  startDate: "",
  endDate: "",
};
const noFiles: ChannelFile[] = [];
const noMessages: Message[] = [];

export function useChannelCollection({
  userId,
  workspaceId,
  channelId,
  kind,
  version = 0,
}: {
  userId: string;
  workspaceId: string;
  channelId: string;
  kind: CollectionKind;
  version?: number;
}) {
  const scope = `${userId}:${workspaceId}:${channelId}:${kind}`;
  const [filterState, setFilterState] = useState({ scope, ...emptyFilters });
  const filters = filterState.scope === scope ? filterState : emptyFilters;
  const search = filters.query.trim().slice(0, 200);
  const dates = collectionDateRange(filters.startDate, filters.endDate);
  const context = JSON.stringify([
    scope,
    search,
    filters.senderId,
    dates.startAt,
    dates.endBefore,
    dates.error,
  ]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [load, setLoad] = useState<LoadState>({
    context: "",
    loading: false,
    more: false,
    error: "",
    failedMore: false,
  });
  const live = useRef({ alive: true, context, version });
  live.current = { ...live.current, context, version };
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const request = useRef<AbortController | null>(null);
  const requestVersion = useRef(0);
  const loading = useRef(false);

  const run = useCallback(
    async (more: boolean): Promise<boolean> => {
      if (
        !live.current.alive ||
        live.current.context !== context ||
        live.current.version !== version ||
        dates.error
      )
        return false;
      const previous =
        snapshotRef.current?.context === context ? snapshotRef.current : null;
      if (more && (loading.current || !previous?.nextCursor)) return false;
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      const generation = ++requestVersion.current;
      const current = () =>
        live.current.alive &&
        live.current.context === context &&
        live.current.version === version &&
        generation === requestVersion.current &&
        !controller.signal.aborted;
      loading.current = true;
      setLoad({ context, loading: !more, more, error: "", failedMore: false });
      const pages = more ? 1 : Math.max(1, previous?.pages || 1);
      let cursor = more ? previous!.nextCursor : null;
      const files = more ? [...previous!.files] : [];
      const messages = more ? [...previous!.messages] : [];
      let total = previous?.total || 0,
        loadedPages = more ? previous!.pages : 0;
      try {
        for (let page = 0; page < pages; page++) {
          const params = new URLSearchParams();
          if (search) params.set("q", search);
          if (filters.senderId) params.set("userId", filters.senderId);
          if (dates.startAt) params.set("startAt", dates.startAt);
          if (dates.endBefore) params.set("endBefore", dates.endBefore);
          if (cursor) params.set("cursor", cursor);
          // The server's default page size is 50; an unfiltered first URL stays stable.
          const suffix = params.size ? `?${params}` : "";
          const result = await api<ChannelFilesPage | ChannelPinsPage>(
            `/channels/${channelId}/${kind}${suffix}`,
            {
              headers: { "X-Workspace-Id": workspaceId, "X-User-Id": userId },
              signal: controller.signal,
            },
          );
          if (!current()) return false;
          if (kind === "files")
            files.push(...(result as ChannelFilesPage).files);
          else messages.push(...(result as ChannelPinsPage).messages);
          total = result.total;
          cursor = result.nextCursor;
          loadedPages++;
          if (!cursor) break;
        }
        if (!current()) return false;
        const next = {
          context,
          files: [...new Map(files.map((file) => [file.id, file])).values()],
          messages: [
            ...new Map(
              messages.map((message) => [message.id, message]),
            ).values(),
          ],
          total,
          nextCursor: cursor,
          pages: loadedPages,
        };
        snapshotRef.current = next;
        setSnapshot(next);
        setLoad({
          context,
          loading: false,
          more: false,
          error: "",
          failedMore: false,
        });
        return true;
      } catch (error) {
        if (!current()) return false;
        const inaccessible =
          error instanceof ApiError &&
          (error.status === 403 || error.status === 404);
        if (inaccessible) {
          snapshotRef.current = null;
          setSnapshot(null);
        }
        setLoad({
          context,
          loading: false,
          more: false,
          error:
            error instanceof Error
              ? error.message
              : "Liste yüklenemedi. Yeniden deneyebilirsin.",
          failedMore:
            more &&
            !inaccessible &&
            !(
              error instanceof ApiError &&
              error.code === "INVALID_COLLECTION_CURSOR"
            ),
        });
        return false;
      } finally {
        if (generation === requestVersion.current) loading.current = false;
      }
    },
    [
      context,
      version,
      dates.error,
      dates.startAt,
      dates.endBefore,
      search,
      filters.senderId,
      channelId,
      kind,
      workspaceId,
      userId,
    ],
  );

  useEffect(() => {
    live.current.alive = true;
    return () => {
      live.current.alive = false;
      request.current?.abort();
      ++requestVersion.current;
    };
  }, []);
  useEffect(() => {
    request.current?.abort();
    ++requestVersion.current;
    loading.current = false;
    const timeout = window.setTimeout(
      () => {
        void run(false);
      },
      search ? 200 : 0,
    );
    return () => {
      window.clearTimeout(timeout);
      request.current?.abort();
      ++requestVersion.current;
    };
  }, [run, search]);

  const setFilter = (field: keyof Filters, value: string) =>
    setFilterState((old) => ({
      ...(old.scope === scope ? old : emptyFilters),
      scope,
      [field]: value,
    }));
  const shown = snapshot?.context === context ? snapshot : null;
  const shownLoad = load.context === context ? load : null;
  return {
    ...filters,
    context,
    files: shown?.files || noFiles,
    messages: shown?.messages || noMessages,
    total: shown?.total || 0,
    hasMore: Boolean(shown?.nextCursor),
    loading: !dates.error && (shownLoad ? shownLoad.loading : !shown),
    loadingMore: shownLoad?.more || false,
    error: shownLoad?.error || "",
    filterError: dates.error,
    filtered: Boolean(
      search || filters.senderId || filters.startDate || filters.endDate,
    ),
    setQuery: (value: string) => setFilter("query", value),
    setSenderId: (value: string) => setFilter("senderId", value),
    setStartDate: (value: string) => setFilter("startDate", value),
    setEndDate: (value: string) => setFilter("endDate", value),
    clearFilters: () => setFilterState({ scope, ...emptyFilters }),
    refresh: () => run(false),
    retry: () => run(shownLoad?.failedMore || false),
    loadMore: () => run(true),
  };
}
