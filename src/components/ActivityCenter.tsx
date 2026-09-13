import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import {
  ArrowUpRight,
  AtSign,
  Bell,
  Check,
  CheckCheck,
  ChevronDown,
  Hash,
  LoaderCircle,
  Megaphone,
  MessageCircle,
  RefreshCw,
  Search,
  Settings2,
  X,
} from "lucide-react";
import type { Channel, User } from "../../shared/types";
import { mentionPreview } from "../../shared/mentions";
import type {
  NotificationItem,
  NotificationState,
} from "../../shared/collaboration-types";
import type { ActivityItem, ActivityPage } from "../../shared/hub-types";
import { api } from "../lib/api";
import { Avatar } from "./ui";
import "./conversation-hubs.css";

type Kind = "all" | NotificationItem["kind"];
type Snapshot = {
  scope: string;
  context: string;
  items: ActivityItem[];
  nextCursor: string | null;
  pages: number;
};
type LoadState = {
  context: string;
  pending: boolean;
  more: boolean;
  error: string;
};
const kindLabels = {
  mention: "Bahsetme",
  reply: "Yanıt",
  dm: "Özel mesaj",
  channel: "Kanal çağrısı",
};
const kindActions = {
  mention: "senden bahsetti",
  reply: "konuşmaya yanıt verdi",
  dm: "sana yazdı",
  channel: "kanala seslendi",
};
const kindIcons = {
  mention: AtSign,
  reply: MessageCircle,
  dm: MessageCircle,
  channel: Megaphone,
};
const fingerprint = (state: NotificationState | null, workspaceId: string) =>
  state?.workspaceId === workspaceId
    ? JSON.stringify([state.unreadNotifications, state.notifications])
    : "";

function dayLabel(value: string, now: number) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Önceki aktiviteler";
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Bugün";
  if (date.toDateString() === yesterday.toDateString()) return "Dün";
  return date.toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
    ...(date.getFullYear() !== today.getFullYear()
      ? { year: "numeric" as const }
      : {}),
  });
}

function relativeTime(value: string, now: number) {
  const elapsed = now - new Date(value).getTime();
  if (!Number.isFinite(elapsed)) return "";
  if (elapsed < 60_000) return "Az önce";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} dk önce`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} sa önce`;
  return new Date(value).toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ActivityCenter({
  workspaceId,
  userId,
  channels,
  members,
  state,
  connected,
  socket,
  onOpen,
  onSettings,
  onState,
}: {
  workspaceId: string;
  userId: string;
  channels: Channel[];
  members: User[];
  state: NotificationState | null;
  connected: boolean;
  socket: Socket | null;
  onOpen: (messageId: string) => Promise<void>;
  onSettings: () => void;
  onState: (state: NotificationState) => void;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [load, setLoad] = useState<LoadState>({
    context: "",
    pending: true,
    more: false,
    error: "",
  });
  const [actionError, setActionError] = useState<{
    scope: string;
    message: string;
    resync?: boolean;
  } | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [updatedContext, setUpdatedContext] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const scope = `${userId}:${workspaceId}`;
  const search = query.trim();
  const context = JSON.stringify([scope, kind, unreadOnly, search]);
  const liveFingerprint = fingerprint(state, workspaceId);
  const scopeRef = useRef(scope);
  const contextRef = useRef(context);
  const snapshotRef = useRef(snapshot);
  const generation = useRef(0);
  const mounted = useRef(true);
  const pageRequest = useRef<AbortController | null>(null);
  const readRequest = useRef<AbortController | null>(null);
  const openRequest = useRef<string | null>(null);
  const skipFingerprint = useRef("");
  const previousLive = useRef({ scope, value: liveFingerprint, connected });
  const previousQuery = useRef(search);
  const channelIds = useMemo(
    () => new Set(channels.map((channel) => channel.id)),
    [channels],
  );
  const memberById = useMemo(
    () => new Map(members.map((member) => [member.id, member])),
    [members],
  );
  const channelById = useMemo(
    () => new Map(channels.map((channel) => [channel.id, channel])),
    [channels],
  );
  const allowedRef = useRef(channelIds);
  scopeRef.current = scope;
  contextRef.current = context;
  snapshotRef.current = snapshot;
  allowedRef.current = channelIds;

  useEffect(() => {
    mounted.current = true;
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      mounted.current = false;
      generation.current++;
      pageRequest.current?.abort();
      readRequest.current?.abort();
      openRequest.current = null;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    readRequest.current?.abort();
    readRequest.current = null;
    openRequest.current = null;
    setReading(null);
    setOpening(null);
    setActionError(null);
    setUpdatedContext(null);
    return () => {
      readRequest.current?.abort();
    };
  }, [scope]);

  useEffect(() => {
    const controller = new AbortController();
    const version = ++generation.current;
    pageRequest.current?.abort();
    pageRequest.current = controller;
    const active = () =>
      mounted.current &&
      !controller.signal.aborted &&
      version === generation.current &&
      contextRef.current === context;
    setLoad({ context, pending: true, more: false, error: "" });
    setUpdatedContext(null);
    const delay = previousQuery.current === search ? 0 : 180;
    previousQuery.current = search;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const params = new URLSearchParams({ kind, limit: "30" });
          if (unreadOnly) params.set("unread", "true");
          if (search) params.set("q", search);
          const page = await api<ActivityPage>(`/activity?${params}`, {
            signal: controller.signal,
            headers: { "X-Workspace-Id": workspaceId, "X-User-Id": userId },
          });
          if (!active()) return;
          if (page.workspaceId !== workspaceId || page.userId !== userId)
            throw new Error(
              "Hesabın veya çalışma alanın değişti. Aktiviteyi yeniden yükleyebilirsin.",
            );
          setSnapshot({
            scope,
            context,
            items: page.items.filter(
              (item) =>
                item.workspaceId === workspaceId &&
                allowedRef.current.has(item.channelId),
            ),
            nextCursor: page.nextCursor,
            pages: 1,
          });
          setLoad({ context, pending: false, more: false, error: "" });
        } catch (error) {
          if (active())
            setLoad({
              context,
              pending: false,
              more: false,
              error:
                error instanceof Error
                  ? error.message
                  : "Aktivite yüklenemedi. Yeniden deneyebilirsin.",
            });
        } finally {
          if (pageRequest.current === controller) pageRequest.current = null;
        }
      })();
    }, delay);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [context, kind, search, unreadOnly, userId, workspaceId, revision]);

  useEffect(() => {
    const previous = previousLive.current;
    previousLive.current = { scope, value: liveFingerprint, connected };
    if (previous.scope !== scope) return;
    if (skipFingerprint.current === liveFingerprint && liveFingerprint) {
      skipFingerprint.current = "";
      setUpdatedContext(null);
      return;
    }
    const changed = Boolean(
      previous.value && liveFingerprint && previous.value !== liveFingerprint,
    );
    if (!changed && !(connected && !previous.connected)) return;
    const current = snapshotRef.current;
    if (!current || current.context !== context) return;
    if (current.pages > 1) setUpdatedContext(context);
    else setRevision((value) => value + 1);
  }, [liveFingerprint, connected, scope, context]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = (event: { channelId?: string }) => {
      if (!event?.channelId || !allowedRef.current.has(event.channelId)) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!mounted.current || scopeRef.current !== scope) return;
        const activeContext = contextRef.current;
        const current = snapshotRef.current;
        if (current?.context === activeContext && current.pages > 1)
          setUpdatedContext(activeContext);
        else setRevision((value) => value + 1);
      }, 80);
    };
    socket?.on("message:updated", changed);
    socket?.on("message:deleted", changed);
    return () => {
      clearTimeout(timer);
      socket?.off("message:updated", changed);
      socket?.off("message:deleted", changed);
    };
  }, [socket, scope]);

  const current = snapshot?.context === context ? snapshot : null;
  const currentLoad =
    load.context === context
      ? load
      : { context, pending: true, more: false, error: "" };
  const items =
    current?.items.filter(
      (item) =>
        item.workspaceId === workspaceId &&
        channelIds.has(item.channelId) &&
        (!unreadOnly || !item.read),
    ) || [];
  const groups = new Map<string, ActivityItem[]>();
  for (const item of items) {
    const label = dayLabel(item.createdAt, now);
    groups.set(label, [...(groups.get(label) || []), item]);
  }
  const unreadCount =
    state?.workspaceId === workspaceId
      ? state.unreadNotifications
      : items.filter((item) => !item.read).length;
  const filtered = Boolean(search || kind !== "all" || unreadOnly);

  const loadMore = async () => {
    if (!current?.nextCursor || pageRequest.current || currentLoad.pending)
      return;
    const controller = new AbortController();
    pageRequest.current = controller;
    const version = generation.current;
    const active = () =>
      mounted.current &&
      !controller.signal.aborted &&
      version === generation.current &&
      contextRef.current === context;
    setLoad({ context, pending: false, more: true, error: "" });
    try {
      const params = new URLSearchParams({
        kind,
        cursor: current.nextCursor,
        limit: "30",
      });
      if (unreadOnly) params.set("unread", "true");
      if (search) params.set("q", search);
      const page = await api<ActivityPage>(`/activity?${params}`, {
        signal: controller.signal,
        headers: { "X-Workspace-Id": workspaceId, "X-User-Id": userId },
      });
      if (!active()) return;
      if (page.workspaceId !== workspaceId || page.userId !== userId)
        throw new Error(
          "Aktivite bağlamı değişti. Listeyi yeniden yükleyebilirsin.",
        );
      setSnapshot((previous) => {
        if (previous?.context !== context) return previous;
        const merged = new Map(previous.items.map((item) => [item.id, item]));
        for (const item of page.items)
          if (
            item.workspaceId === workspaceId &&
            allowedRef.current.has(item.channelId)
          )
            merged.set(item.id, item);
        return {
          scope,
          context,
          items: [...merged.values()],
          nextCursor: page.nextCursor,
          pages: previous.pages + 1,
        };
      });
      setLoad({ context, pending: false, more: false, error: "" });
    } catch (error) {
      if (active())
        setLoad({
          context,
          pending: false,
          more: true,
          error:
            error instanceof Error
              ? error.message
              : "Önceki aktiviteler yüklenemedi.",
        });
    } finally {
      if (pageRequest.current === controller) pageRequest.current = null;
    }
  };

  const markRead = async (id?: string) => {
    if (readRequest.current) return;
    const controller = new AbortController();
    readRequest.current = controller;
    setReading(id || "all");
    setActionError(null);
    const active = () =>
      mounted.current &&
      !controller.signal.aborted &&
      scopeRef.current === scope;
    let saved = false;
    try {
      await api("/notifications/read", {
        method: "POST",
        signal: controller.signal,
        headers: { "X-Workspace-Id": workspaceId, "X-User-Id": userId },
        body: JSON.stringify(id ? { id } : { notificationsOnly: true }),
      });
      if (!active()) return;
      saved = true;
      setSnapshot((previous) =>
        previous?.scope === scope
          ? {
              ...previous,
              items: previous.items.map((item) =>
                !id || item.id === id ? { ...item, read: true } : item,
              ),
              ...(!id && unreadOnly ? { nextCursor: null } : {}),
            }
          : previous,
      );
      const next = await api<NotificationState>("/notifications", {
        signal: controller.signal,
        headers: { "X-Workspace-Id": workspaceId, "X-User-Id": userId },
      });
      if (!active()) return;
      if (next.workspaceId !== workspaceId)
        throw new Error("Çalışma alanın değişti.");
      skipFingerprint.current = fingerprint(next, workspaceId);
      onState(next);
    } catch (error) {
      if (active())
        setActionError({
          scope,
          resync: saved,
          message: saved
            ? "Bildirim okundu işaretlendi; güncel sayımlar alınamadı. Listeyi yenileyebilirsin."
            : error instanceof Error
              ? error.message
              : "Bildirim okundu işaretlenemedi. Yeniden deneyebilirsin.",
        });
    } finally {
      if (readRequest.current === controller) readRequest.current = null;
      if (active()) setReading(null);
    }
  };

  const open = async (item: ActivityItem) => {
    if (openRequest.current || !allowedRef.current.has(item.channelId)) return;
    openRequest.current = item.id;
    setOpening(item.id);
    setActionError(null);
    try {
      await onOpen(item.messageId);
    } catch (error) {
      if (mounted.current && contextRef.current === context)
        setActionError({
          scope,
          message:
            error instanceof Error
              ? error.message
              : "Mesaj açılamadı. Yeniden deneyebilirsin.",
        });
    } finally {
      if (openRequest.current === item.id) {
        openRequest.current = null;
        if (mounted.current && scopeRef.current === scope) setOpening(null);
      }
    }
  };

  const retryAction = async () => {
    setRevision((value) => value + 1);
    if (!actionError?.resync) {
      setActionError(null);
      return;
    }
    if (readRequest.current) return;
    const controller = new AbortController();
    readRequest.current = controller;
    setReading("refresh");
    const active = () =>
      mounted.current &&
      !controller.signal.aborted &&
      scopeRef.current === scope;
    try {
      const next = await api<NotificationState>("/notifications", {
        signal: controller.signal,
        headers: { "X-Workspace-Id": workspaceId, "X-User-Id": userId },
      });
      if (!active()) return;
      if (next.workspaceId !== workspaceId)
        throw new Error("Çalışma alanın değişti.");
      skipFingerprint.current = fingerprint(next, workspaceId);
      onState(next);
      setActionError(null);
    } catch {
      if (active())
        setActionError({
          scope,
          resync: true,
          message:
            "Bildirim sayımları yenilenemedi. Bağlantını kontrol edip yeniden deneyebilirsin.",
        });
    } finally {
      if (readRequest.current === controller) readRequest.current = null;
      if (active()) setReading(null);
    }
  };

  const resetFilters = () => {
    setQuery("");
    setKind("all");
    setUnreadOnly(false);
  };
  return (
    <section className="activity-center" aria-label="Aktivite akışı">
      <div className="activity-toolbar">
        <label className="activity-search">
          <Search size={16} aria-hidden="true" />
          <Input
            unstyled
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Kişi, kanal veya mesaj ara"
            aria-label="Aktivitelerde ara"
            maxLength={100}
          />
          {query && (
            <Button
              variant="unstyled"
              size="unset"
              type="button"
              aria-label="Aramayı temizle"
              onClick={() => setQuery("")}
            >
              <X size={15} />
            </Button>
          )}
        </label>
        <Button
          variant="unstyled"
          size="unset"
          type="button"
          className="activity-settings activity-icon-button"
          onClick={onSettings}
          title="Bildirim ayarları"
          aria-label="Bildirim ayarları"
        >
          <Settings2 size={17} />
        </Button>
      </div>
      <div className="activity-filters">
        <div className="activity-tabs" aria-label="Okunma durumu">
          <Button
            variant="unstyled"
            size="unset"
            type="button"
            aria-pressed={!unreadOnly}
            onClick={() => setUnreadOnly(false)}
          >
            Tümü
          </Button>
          <Button
            variant="unstyled"
            size="unset"
            type="button"
            aria-pressed={unreadOnly}
            onClick={() => setUnreadOnly(true)}
          >
            Okunmamış
            {unreadCount > 0 && (
              <span aria-hidden="true">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Button>
        </div>
        <label className="activity-kind">
          <NativeSelect
            unstyled
            aria-label="Aktivite türü"
            value={kind}
            onChange={(event) => setKind(event.target.value as Kind)}
          >
            <option value="all">Her tür</option>
            <option value="mention">Bahsetmeler</option>
            <option value="reply">Yanıtlar</option>
            <option value="dm">Özel mesajlar</option>
            <option value="channel">Kanal çağrıları</option>
          </NativeSelect>
          <ChevronDown size={13} aria-hidden="true" />
        </label>
        <Button
          variant="unstyled"
          size="unset"
          type="button"
          className="activity-read-all"
          disabled={Boolean(reading) || unreadCount === 0}
          onClick={() => void markRead()}
        >
          <CheckCheck size={15} />
          <span>
            {reading === "all" ? "İşaretleniyor…" : "Tümünü okundu işaretle"}
          </span>
        </Button>
      </div>
      {!connected && (
        <p className="activity-connection" role="status">
          Bağlantı bekleniyor. Yeniden bağlandığında aktiviten güncellenecek.
        </p>
      )}
      {updatedContext === context && (
        <div className="activity-update" role="status">
          <span>Aktivite güncellendi</span>
          <Button
            variant="unstyled"
            size="unset"
            type="button"
            onClick={() => setRevision((value) => value + 1)}
          >
            <RefreshCw size={14} />
            Yenile
          </Button>
        </div>
      )}
      {actionError?.scope === scope && (
        <div className="activity-error" role="alert">
          <span>{actionError.message}</span>
          <Button
            variant="unstyled"
            size="unset"
            type="button"
            disabled={Boolean(reading)}
            onClick={() => void retryAction()}
          >
            Yenile
          </Button>
        </div>
      )}
      {currentLoad.error && (
        <div className="activity-error" role="alert">
          <span>{currentLoad.error}</span>
          <Button
            variant="unstyled"
            size="unset"
            type="button"
            onClick={() =>
              currentLoad.more
                ? void loadMore()
                : setRevision((value) => value + 1)
            }
          >
            Yeniden dene
          </Button>
        </div>
      )}
      <div
        className="activity-feed"
        aria-busy={
          currentLoad.pending || (currentLoad.more && !currentLoad.error)
        }
      >
        {currentLoad.pending && !current ? (
          <div className="activity-loading" role="status">
            <LoaderCircle size={18} className="activity-spinner" />
            Aktivite yükleniyor…
          </div>
        ) : !items.length && !currentLoad.error ? (
          <div className="activity-empty">
            <span className="activity-empty-icon">
              {filtered ? <Search size={23} /> : <Bell size={23} />}
            </span>
            <h2>
              {filtered
                ? "Bu görünümde aktivite yok"
                : "Henüz bir aktiviten yok"}
            </h2>
            <p>
              {filtered
                ? "Başka bir arama veya filtreyle devam edebilirsin."
                : "Senden bahsedildiğinde, sana yazıldığında veya bir konuşmana yanıt geldiğinde burada göreceksin."}
            </p>
            {filtered && (
              <Button
                variant="unstyled"
                size="unset"
                type="button"
                onClick={resetFilters}
              >
                Filtreleri temizle
              </Button>
            )}
          </div>
        ) : (
          [...groups].map(([label, notifications]) => (
            <section className="activity-day" key={label} aria-label={label}>
              <h2>{label}</h2>
              <div className="activity-items">
                {notifications.map((item) => {
                  const actor = memberById.get(item.actorId);
                  const name = actor?.name || item.actorName;
                  const channel = channelById.get(item.channelId);
                  const channelName =
                    item.kind === "dm"
                      ? item.channelName
                      : channel?.name || item.channelName;
                  const Icon = kindIcons[item.kind];
                  const preview =
                    mentionPreview(item.preview, members)
                      .trim()
                      .replace(/\s+/g, " ") || "Bir dosya paylaşıldı.";
                  const absolute = new Date(item.createdAt);
                  return (
                    <article
                      className={`activity-item ${item.read ? "" : "is-unread"}`}
                      key={item.id}
                      data-notification-id={item.id}
                      aria-label={`${name}, ${kindLabels[item.kind]}, ${item.read ? "okundu" : "okunmamış"}`}
                    >
                      <Button
                        variant="unstyled"
                        size="unset"
                        type="button"
                        className="activity-open"
                        disabled={Boolean(opening)}
                        onClick={() => void open(item)}
                        aria-label={`${name} ${kindActions[item.kind]}, ${channelName}. ${preview}`}
                      >
                        <span className="activity-avatar">
                          <Avatar
                            user={actor || { name, color: "#e5ece9" }}
                            size="small"
                          />
                          <span
                            className="activity-kind-symbol"
                            title={kindLabels[item.kind]}
                          >
                            <Icon size={11} />
                          </span>
                        </span>
                        <span className="activity-copy">
                          <span className="activity-person">
                            <strong>{name}</strong>
                            <span>{kindActions[item.kind]}</span>
                          </span>
                          <span className="activity-preview">{preview}</span>
                          <span className="activity-context">
                            {item.kind === "dm" ? (
                              <MessageCircle size={12} />
                            ) : (
                              <Hash size={12} />
                            )}
                            <span>{channelName}</span>
                            <span
                              className="activity-time-separator"
                              aria-hidden="true"
                            >
                              ·
                            </span>
                            <time
                              dateTime={item.createdAt}
                              title={
                                Number.isFinite(absolute.getTime())
                                  ? absolute.toLocaleString("tr-TR", {
                                      dateStyle: "long",
                                      timeStyle: "short",
                                    })
                                  : undefined
                              }
                            >
                              {relativeTime(item.createdAt, now)}
                            </time>
                          </span>
                        </span>
                        <span
                          className="activity-open-affordance"
                          aria-hidden="true"
                        >
                          {opening === item.id ? (
                            <LoaderCircle
                              size={15}
                              className="activity-spinner"
                            />
                          ) : (
                            <ArrowUpRight size={15} />
                          )}
                        </span>
                      </Button>
                      {!item.read && (
                        <Button
                          variant="unstyled"
                          size="unset"
                          type="button"
                          className="activity-read activity-icon-button"
                          aria-label="Okundu işaretle"
                          title="Okundu işaretle"
                          disabled={Boolean(reading)}
                          onClick={() => void markRead(item.id)}
                        >
                          {reading === item.id ? (
                            <LoaderCircle
                              size={15}
                              className="activity-spinner"
                            />
                          ) : (
                            <Check size={15} />
                          )}
                        </Button>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          ))
        )}
        {current?.nextCursor && !currentLoad.error && (
          <div className="activity-pagination">
            <Button
              variant="unstyled"
              size="unset"
              type="button"
              disabled={currentLoad.pending || currentLoad.more}
              onClick={() => void loadMore()}
            >
              {currentLoad.more ? (
                <LoaderCircle size={15} className="activity-spinner" />
              ) : (
                <ChevronDown size={15} />
              )}
              {currentLoad.more ? "Yükleniyor…" : "Daha fazlasını yükle"}
            </Button>
          </div>
        )}
        {currentLoad.pending && current && (
          <p className="activity-refreshing" role="status">
            Aktivite güncelleniyor…
          </p>
        )}
      </div>
    </section>
  );
}
