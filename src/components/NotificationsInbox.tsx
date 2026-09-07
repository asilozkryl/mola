import {
  ArrowRight,
  AtSign,
  CheckCheck,
  MessageCircle,
  Settings2,
} from "lucide-react";
import type { Channel } from "../../shared/types";
import type { NotificationState } from "../../shared/collaboration-types";
import { dateLabel, Spinner } from "./ui";
import "./collaboration.css";

export function NotificationsInbox({
  state,
  channels,
  onOpen,
  onChannel,
  onReadAll,
  onSettings,
  error,
  loading,
}: {
  state: NotificationState | null;
  channels: Channel[];
  onOpen: (messageId: string) => void;
  onChannel: (id: string) => void;
  onReadAll: () => void;
  onSettings: () => void;
  error: string;
  loading: boolean;
}) {
  const allowed = new Set(channels.map((c) => c.id));
  const notifications =
    state?.notifications.filter((n) => allowed.has(n.channelId)) || [];
  return (
    <section className="notification-center" aria-label="Bildirim merkezi">
      <div className="notification-heading">
        <div>
          <span className="eyebrow">SANA ULAŞANLAR</span>
          <h2>Sohbeti kaçırma.</h2>
          <p>Bahsedilmeler, yanıtlar ve özel mesajların burada.</p>
        </div>
        <button className="secondary-button" onClick={onSettings}>
          <Settings2 size={16} />
          Bildirim ayarları
        </button>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {loading && !state ? (
        <Spinner label="Bildirimler yükleniyor" />
      ) : (
        <>
          <div className="notification-toolbar">
            <strong>
              {state?.unreadNotifications || 0} okunmamış bildirim
            </strong>
            <button
              className="text-button"
              onClick={onReadAll}
              disabled={
                !state?.unreadNotifications &&
                !Object.values(state?.unreadByChannel || {}).some(Boolean)
              }
            >
              <CheckCheck size={16} />
              Tümünü okundu işaretle
            </button>
          </div>
          {!!Object.values(state?.unreadByChannel || {}).some(Boolean) && (
            <div className="unread-channels">
              {channels
                .filter((c) => (state?.unreadByChannel[c.id] || 0) > 0)
                .map((c) => (
                  <button key={c.id} onClick={() => onChannel(c.id)}>
                    <span>#{c.name}</span>
                    <b>{state!.unreadByChannel[c.id]}</b>
                  </button>
                ))}
            </div>
          )}
          {!notifications.length ? (
            <div className="notification-empty">
              <AtSign size={32} />
              <h3>Burada seni bekleyen bir şey yok.</h3>
              <p>
                Biri senden bahsettiğinde veya sana yanıt verdiğinde haberin
                olacak.
              </p>
            </div>
          ) : (
            <div className="notification-items">
              {notifications.map((n) => (
                <button
                  className={`notification-item ${n.read ? "" : "is-unread"}`}
                  key={n.id}
                  onClick={() => onOpen(n.messageId)}
                >
                  <span className="notification-symbol">
                    {n.kind === "mention" || n.kind === "channel" ? (
                      <AtSign size={20} />
                    ) : (
                      <MessageCircle size={20} />
                    )}
                  </span>
                  <span className="notification-copy">
                    <span>
                      <strong>{n.actorName}</strong>
                      <small>
                        {n.kind === "mention"
                          ? "senden bahsetti"
                          : n.kind === "reply"
                            ? "sohbete yanıt verdi"
                            : n.kind === "dm"
                              ? "sana yazdı"
                              : "kanala seslendi"}
                      </small>
                    </span>
                    <p>{n.preview || "Bir dosya paylaşıldı."}</p>
                    <small>
                      #{n.channelName} · {dateLabel(n.createdAt)}
                    </small>
                  </span>
                  <ArrowRight size={17} />
                  {!n.read && (
                    <span
                      className="notification-dot"
                      aria-label="Okunmadı"
                      role="img"
                    />
                  )}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
