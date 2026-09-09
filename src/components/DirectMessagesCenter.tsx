import { useEffect, useRef, useState } from "react";
import { mentionPreview } from "../../shared/mentions";
import type { Socket } from "socket.io-client";
import {
  ArrowUpRight,
  MessageCircle,
  PenLine,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import type { Bootstrap } from "../../shared/types";
import type { NotificationState } from "../../shared/collaboration-types";
import type {
  DirectConversation,
  DirectConversationsPage,
} from "../../shared/hub-types";
import { api } from "../lib/api";
import { Avatar, Spinner } from "./ui";
import { ProfileIdentity } from "./ProfileIdentity";
import "./direct-messages-center.css";

function conversationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  if (date.toDateString() === today.toDateString())
    return date.toLocaleTimeString("tr-TR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  today.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Dün";
  return date.toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() !== new Date().getFullYear()
      ? { year: "numeric" }
      : {}),
  });
}

export function DirectMessagesCenter({
  data,
  unread,
  state,
  refreshToken,
  connected,
  socket,
  onSelect,
  onNewMessage,
  onProfile,
}: {
  data: Bootstrap;
  unread: Record<string, number>;
  state: NotificationState | null;
  refreshToken: unknown;
  connected: boolean;
  socket: Socket | null;
  onSelect: (channelId: string) => void;
  onNewMessage: () => void;
  onProfile: (userId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [revision, setRevision] = useState(0);
  const criteria = `${data.user.id}:${data.workspace.id}:${unreadOnly}:${query.trim()}`;
  const [result, setResult] = useState<{
    criteria: string;
    items: DirectConversation[];
    cursor: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [updates, setUpdates] = useState(false);
  const generation = useRef(0);
  const live = useRef({ criteria, alive: true, pages: 1 });
  live.current.criteria = criteria;
  const request = useRef<AbortController | null>(null);
  const pendingMore = useRef(false);
  const current = result?.criteria === criteria ? result : null;
  const allowed = new Set(
    data.channels
      .filter((c) => c.kind === "dm" && !c.archived)
      .map((c) => c.id),
  );
  const members = new Map(
    data.members
      .filter((u) => !u.suspended && !u.isBot && u.id !== data.user.id)
      .map((u) => [u.id, u]),
  );
  const unreadSignature = JSON.stringify(
    [...allowed].map((id) => [id, unread[id] || 0]),
  );
  const previousUpdate = useRef({ refreshToken, unreadSignature, connected });
  const allowedRef = useRef(allowed);
  allowedRef.current = allowed;
  const readCount = (item: DirectConversation) =>
    state?.workspaceId === data.workspace.id
      ? unread[item.channelId] || 0
      : item.unreadCount;
  const rows = (current?.items || []).filter(
    (item) =>
      allowed.has(item.channelId) &&
      members.has(item.userId) &&
      (!unreadOnly || readCount(item) > 0),
  );
  const headers = {
    "X-Workspace-Id": data.workspace.id,
    "X-User-Id": data.user.id,
  };
  function path(cursor?: string | null) {
    const params = new URLSearchParams({ limit: "30" });
    if (query.trim()) params.set("q", query.trim());
    if (unreadOnly) params.set("unread", "true");
    if (cursor) params.set("cursor", cursor);
    return `/direct-conversations?${params}`;
  }
  useEffect(() => {
    live.current.alive = true;
    return () => {
      live.current.alive = false;
      request.current?.abort();
      generation.current++;
    };
  }, []);
  useEffect(() => {
    const version = ++generation.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setLoadingMore(false);
    pendingMore.current = false;
    setError("");
    const timer = setTimeout(
      () => {
        void api<DirectConversationsPage>(path(), {
          headers,
          signal: controller.signal,
        })
          .then((next) => {
            if (
              version !== generation.current ||
              controller.signal.aborted ||
              next.workspaceId !== data.workspace.id ||
              next.userId !== data.user.id
            )
              return;
            setResult({ criteria, items: next.items, cursor: next.nextCursor });
            live.current.pages = 1;
            setUpdates(false);
          })
          .catch((e) => {
            if (version === generation.current && !controller.signal.aborted)
              setError(e.message);
          })
          .finally(() => {
            if (version === generation.current && !controller.signal.aborted)
              setLoading(false);
          });
      },
      query ? 180 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [criteria, revision]);
  useEffect(() => {
    const previous = previousUpdate.current;
    previousUpdate.current = { refreshToken, unreadSignature, connected };
    if (
      previous.refreshToken === refreshToken &&
      previous.unreadSignature === unreadSignature &&
      previous.connected === connected
    )
      return;
    if (live.current.pages > 1) setUpdates(true);
    else setRevision((n) => n + 1);
  }, [refreshToken, unreadSignature, connected]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = (event: { channelId?: string }) => {
      if (!event?.channelId || !allowedRef.current.has(event.channelId)) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (live.current.pages > 1) setUpdates(true);
        else setRevision((n) => n + 1);
      }, 80);
    };
    socket?.on("message:updated", changed);
    socket?.on("message:deleted", changed);
    socket?.on("draft:changed", changed);
    return () => {
      clearTimeout(timer);
      socket?.off("message:updated", changed);
      socket?.off("message:deleted", changed);
      socket?.off("draft:changed", changed);
    };
  }, [socket, data.workspace.id, data.user.id]);

  async function more() {
    if (!current?.cursor || loading || pendingMore.current) return;
    const version = generation.current,
      scope = criteria;
    pendingMore.current = true;
    setLoadingMore(true);
    setError("");
    const controller = new AbortController();
    request.current = controller;
    try {
      const next = await api<DirectConversationsPage>(path(current.cursor), {
        headers,
        signal: controller.signal,
      });
      if (
        !live.current.alive ||
        live.current.criteria !== scope ||
        version !== generation.current ||
        controller.signal.aborted ||
        next.userId !== data.user.id ||
        next.workspaceId !== data.workspace.id
      )
        return;
      setResult((old) =>
        old?.criteria === scope
          ? {
              criteria: scope,
              items: [
                ...new Map(
                  [...old.items, ...next.items].map((item) => [
                    item.channelId,
                    item,
                  ]),
                ).values(),
              ],
              cursor: next.nextCursor,
            }
          : old,
      );
      live.current.pages++;
    } catch (e) {
      if (
        live.current.alive &&
        live.current.criteria === scope &&
        version === generation.current &&
        !controller.signal.aborted
      )
        setError((e as Error).message);
    } finally {
      if (
        live.current.alive &&
        live.current.criteria === scope &&
        version === generation.current
      ) {
        pendingMore.current = false;
        setLoadingMore(false);
      }
    }
  }

  return (
    <section className="dm-center" aria-label="Özel konuşmalar">
      <div className="dm-center-toolbar">
        <div className="dm-center-search">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            aria-label="Özel konuşmalarda ara"
            placeholder="Kişi veya mesaj ara…"
            value={query}
            maxLength={200}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              className="icon-button"
              aria-label="Konuşma aramasını temizle"
              onClick={() => setQuery("")}
            >
              <X size={16} />
            </button>
          )}
        </div>
        <button type="button" className="primary-button" onClick={onNewMessage}>
          <PenLine size={17} />
          Yeni mesaj
        </button>
      </div>
      <div className="dm-center-filters">
        <div className="dm-center-segments" aria-label="Konuşma filtresi">
          <button
            type="button"
            aria-pressed={!unreadOnly}
            onClick={() => setUnreadOnly(false)}
          >
            Tümü
          </button>
          <button
            type="button"
            aria-pressed={unreadOnly}
            onClick={() => setUnreadOnly(true)}
          >
            Okunmamış
          </button>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Konuşmaları yenile"
          disabled={loading || loadingMore}
          onClick={() => setRevision((n) => n + 1)}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      {updates && (
        <div className="dm-center-update" role="status">
          Konuşmalar güncellendi.
          <button type="button" onClick={() => setRevision((n) => n + 1)}>
            Yenile
          </button>
        </div>
      )}
      {!connected && (
        <p className="dm-center-note" role="status">
          Bağlantı bekleniyor. Yeni mesajlar bağlandığında güncellenecek.
        </p>
      )}
      {error && (
        <div className="dm-center-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setRevision((n) => n + 1)}>
            Tekrar dene
          </button>
        </div>
      )}
      {loading && !current ? (
        <div className="dm-center-loading">
          <Spinner label="Konuşmalar yükleniyor" />
        </div>
      ) : (
        <>
          {rows.length > 0 ? (
            <ul
              className="dm-center-list"
              aria-label="Konuşmalar"
              aria-busy={loading}
            >
              {rows.map((item) => {
                const user = members.get(item.userId)!;
                const count = readCount(item);
                return (
                  <li
                    key={item.channelId}
                    className={`dm-center-row ${count ? "is-unread" : ""}`}
                  >
                    <ProfileIdentity
                      user={user}
                      online={data.onlineIds.includes(user.id)}
                      connected={connected}
                      selfId={data.user.id}
                      onOpen={onProfile}
                    >
                      <Avatar
                        user={user}
                        online={connected && data.onlineIds.includes(user.id)}
                      />
                    </ProfileIdentity>
                    <button
                      type="button"
                      className="dm-center-conversation"
                      aria-label={`${user.name} ile konuşmayı aç`}
                      onClick={() => onSelect(item.channelId)}
                    >
                      <span className="dm-center-conversation-main">
                        <span className="dm-center-person">
                          {user.name}
                          {item.hasDraft && (
                            <span className="dm-center-draft">
                              <PenLine size={11} />
                              Taslak
                            </span>
                          )}
                        </span>
                        <span className="dm-center-preview">
                          {item.lastMessageBySelf && item.preview
                            ? "Sen: "
                            : ""}
                          {mentionPreview(item.preview, data.members) ||
                            (item.hasDraft
                              ? "Yazmaya başladığın mesaj seni bekliyor."
                              : "İlk mesajı gönder.")}
                        </span>
                      </span>
                      <span className="dm-center-meta">
                        <time
                          dateTime={item.lastActivityAt}
                          title={new Date(item.lastActivityAt).toLocaleString(
                            "tr-TR",
                          )}
                        >
                          {conversationTime(item.lastActivityAt)}
                        </time>
                        {count > 0 ? (
                          <span
                            className="dm-center-count"
                            aria-label={`${count} okunmamış mesaj`}
                          >
                            {count > 99 ? "99+" : count}
                          </span>
                        ) : (
                          <ArrowUpRight
                            size={15}
                            className="dm-center-open-icon"
                            aria-hidden="true"
                          />
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            !error && (
              <div className="dm-center-empty">
                <MessageCircle size={28} />
                <h2>
                  {query
                    ? "Bu aramada konuşma bulunamadı."
                    : unreadOnly
                      ? "Özel mesajların güncel."
                      : "Bir konuşma başlat."}
                </h2>
                <p>
                  {query
                    ? "Bir kişi adı veya son mesajdan bir kelime deneyebilirsin."
                    : unreadOnly
                      ? "Yeni bir özel mesaj geldiğinde burada göreceksin."
                      : "Ekibinden birini seç. Özel konuşmalarınız burada bir arada kalır."}
                </p>
                {query || unreadOnly ? (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setQuery("");
                      setUnreadOnly(false);
                    }}
                  >
                    Filtreleri temizle
                  </button>
                ) : (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={onNewMessage}
                  >
                    <PenLine size={16} />
                    Konuşma başlat
                  </button>
                )}
              </div>
            )
          )}
          {current?.cursor && (
            <div className="dm-center-more">
              <button
                type="button"
                className="secondary-button"
                disabled={loading || loadingMore}
                onClick={() => void more()}
              >
                {loadingMore ? (
                  <Spinner label="Konuşmalar yükleniyor" />
                ) : (
                  "Daha fazla konuşma yükle"
                )}
              </button>
            </div>
          )}
          {loading && current && (
            <span className="visually-hidden" role="status">
              Konuşmalar güncelleniyor
            </span>
          )}
        </>
      )}
    </section>
  );
}
