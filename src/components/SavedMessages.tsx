import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Bookmark,
  LoaderCircle,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import type { Channel, Message, User } from "../../shared/types";
import type { SavedMessagesState } from "../lib/useSavedMessages";
import { conversationIdentity } from "../lib/conversationIdentity";
import { ConversationLabel } from "./ConversationLabel";
import { IconButton } from "./ui";
import "./saved-messages.css";

export function SavedMessages({
  state,
  channels,
  members,
  selfId,
  renderMessage,
  onOpen,
}: {
  state: SavedMessagesState;
  channels: readonly Channel[];
  members: readonly User[];
  selfId: string;
  renderMessage: (message: Message) => ReactNode;
  onOpen: (messageId: string) => Promise<void>;
}) {
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState("");
  const alive = useRef(true);
  const openingRef = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const byChannel = new Map(channels.map((channel) => [channel.id, channel]));
  const items = state.items.filter((message) =>
    byChannel.has(message.channelId),
  );
  const errors = [
    ...new Set(
      [
        state.idsError,
        state.importError,
        state.error,
        state.actionError,
      ].filter(Boolean),
    ),
  ];
  async function open(messageId: string) {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(messageId);
    setOpenError("");
    try {
      await onOpen(messageId);
    } catch (error) {
      if (alive.current)
        setOpenError(
          error instanceof Error
            ? error.message
            : "Mesaj açılamadı. Yeniden deneyebilirsin.",
        );
    } finally {
      openingRef.current = false;
      if (alive.current) setOpening(null);
    }
  }
  return (
    <section className="saved-center" aria-label="Kaydedilen mesajlar">
      <div className="saved-center-toolbar">
        <div className="saved-center-search">
          <Search size={16} aria-hidden="true" />
          <Input
            unstyled
            type="search"
            aria-label="Kaydedilen mesajlarda ara"
            placeholder="Kaydettiklerinde ara…"
            value={state.query}
            maxLength={200}
            onChange={(event) => state.setQuery(event.target.value)}
          />
          {state.query && (
            <IconButton
              label="Kaydedilenler aramasını temizle"
              onClick={() => state.setQuery("")}
            >
              <X size={15} />
            </IconButton>
          )}
        </div>
        <IconButton
          label="Kaydedilenleri yenile"
          disabled={state.loading || state.idsLoading}
          onClick={state.refresh}
        >
          <RefreshCw size={16} />
        </IconButton>
      </div>
      <p className="saved-center-count" role="status" aria-live="polite">
        {state.loading
          ? "Kayıtlar yükleniyor…"
          : state.idsReady && !state.error
            ? `${state.total} ${state.query.trim() ? "sonuç" : "kayıt"}`
            : "Kayıtlar güncellenemedi"}
      </p>
      {!!errors.length && (
        <div className="saved-center-error" role="alert">
          <div>
            {errors.map((error) => (
              <p key={error}>{error}</p>
            ))}
          </div>
          <Button
            variant="outline"
            size="unset"
            type="button"
            className="secondary-button"
            onClick={state.retry}
            disabled={state.loading || state.idsLoading}
          >
            <RefreshCw size={14} /> Yeniden dene
          </Button>
        </div>
      )}
      {openError && (
        <p className="saved-center-open-error" role="alert">
          {openError}
        </p>
      )}
      {!items.length && state.loading ? (
        <div className="saved-center-loading" aria-hidden="true">
          <LoaderCircle size={20} className="spin" />
        </div>
      ) : null}
      {!items.length && !state.loading && !errors.length && state.idsReady && (
        <div className="saved-center-empty">
          {state.query.trim() ? (
            <Search size={25} aria-hidden="true" />
          ) : (
            <Bookmark size={25} aria-hidden="true" />
          )}
          <h3>
            {state.query.trim()
              ? "Eşleşen kayıt yok"
              : "Kaydettiğin mesajlar burada"}
          </h3>
          <p>
            {state.query.trim()
              ? "Başka bir kelimeyle ara veya aramayı temizle."
              : "Bir mesajdaki yer imi simgesine bas. Kayıtlarına diğer cihazlarından da ulaşabilirsin."}
          </p>
          {state.query.trim() && (
            <Button
              variant="outline"
              size="unset"
              type="button"
              className="secondary-button"
              onClick={() => state.setQuery("")}
            >
              Aramayı temizle
            </Button>
          )}
        </div>
      )}
      {!!items.length && (
        <div
          className="saved-center-list"
          aria-busy={state.loading || state.loadingMore}
        >
          {items.map((message) => {
            const channel = byChannel.get(message.channelId);
            const name = conversationIdentity(channel, selfId, members).name;
            return (
              <div className="saved-center-item" key={message.id}>
                <Button
                  variant="unstyled"
                  size="unset"
                  type="button"
                  className="saved-channel-label"
                  aria-label={`${name} içindeki mesaja git`}
                  disabled={opening !== null}
                  aria-busy={opening === message.id}
                  onClick={() => void open(message.id)}
                >
                  <span>
                    <ConversationLabel
                      channel={channel}
                      selfId={selfId}
                      members={members}
                    />
                  </span>
                  {opening === message.id ? (
                    <LoaderCircle size={14} className="spin" />
                  ) : (
                    <ArrowUpRight size={14} aria-hidden="true" />
                  )}
                </Button>
                {renderMessage(message)}
              </div>
            );
          })}
        </div>
      )}
      {state.hasMore && (
        <div className="saved-center-more">
          <Button
            variant="outline"
            size="unset"
            type="button"
            className="secondary-button"
            disabled={state.loading || state.loadingMore}
            onClick={() => void state.loadMore()}
          >
            {state.loadingMore && <LoaderCircle size={15} className="spin" />}
            {state.loadingMore ? "Yükleniyor…" : "Daha fazla göster"}
          </Button>
        </div>
      )}
    </section>
  );
}
