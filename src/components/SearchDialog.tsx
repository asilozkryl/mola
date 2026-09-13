import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";
import { FileText, MessageCircle, Search } from "lucide-react";
import type { Bootstrap, Message } from "../../shared/types";
import type { MessageSearchPage } from "../../shared/collection-types";
import { mentionPreview } from "../../shared/mentions";
import { api, ApiError } from "../lib/api";
import { collectionDateRange } from "../lib/collection-filters";
import { conversationIdentity } from "../lib/conversationIdentity";
import { ConversationLabel } from "./ConversationLabel";
import { dateLabel, Modal, Spinner } from "./ui";
import "./search-collections.css";

type Props = {
  data: Bootstrap;
  onClose: () => void;
  onSelect: (message: Message) => Promise<void>;
  onAccessChanged?: () => void;
};
const emptyFilters = {
  channelId: "",
  userId: "",
  from: "",
  until: "",
  hasFiles: false,
};

export function SearchDialog(props: Props) {
  const accessKey = props.data.channels
    .map((c) => c.id)
    .sort()
    .join(",");
  return (
    <SearchContent
      key={`${props.data.user.id}:${props.data.workspace.id}:${accessKey}`}
      {...props}
    />
  );
}

function SearchContent({ data, onClose, onSelect, onAccessChanged }: Props) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(emptyFilters);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<
    (MessageSearchPage & { page: number }) | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [restart, setRestart] = useState(false);
  const [retry, setRetry] = useState(0);
  const [opening, setOpening] = useState<string | null>(null);
  const selection = useRef(0);
  const mounted = useRef(true);
  const range = collectionDateRange(filters.from, filters.until);
  const canSearch =
    query.trim().length >= 2 || Object.values(filters).some(Boolean);
  const cursor = cursors[page];
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      selection.current++;
    };
  }, []);
  function reset() {
    selection.current++;
    setOpening(null);
    setPage(0);
    setCursors([null]);
    setResult(null);
    setError("");
    setRestart(false);
  }
  function changeFilters(next: typeof filters) {
    reset();
    setFilters(next);
  }
  useEffect(() => {
    if (!canSearch || range.error) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q: query.trim() });
      if (cursor) params.set("cursor", cursor);
      if (filters.channelId) params.set("channelId", filters.channelId);
      if (filters.userId) params.set("userId", filters.userId);
      if (filters.hasFiles) params.set("hasFiles", "true");
      if (range.startAt) params.set("startAt", range.startAt);
      if (range.endBefore) params.set("endBefore", range.endBefore);
      api<MessageSearchPage>(`/search?${params}`, {
        signal: controller.signal,
        headers: {
          "X-Workspace-Id": data.workspace.id,
          "X-User-Id": data.user.id,
        },
      })
        .then((response) => {
          if (!controller.signal.aborted) setResult({ ...response, page });
        })
        .catch((reason: Error) => {
          if (!controller.signal.aborted) {
            setError(reason.message);
            if (reason instanceof ApiError) {
              setRestart(reason.code === "INVALID_COLLECTION_CURSOR");
              if (
                reason.status === 401 ||
                reason.status === 403 ||
                reason.status === 404
              )
                setResult(null);
            }
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    query,
    filters,
    cursor,
    page,
    retry,
    canSearch,
    range.startAt,
    range.endBefore,
    range.error,
    data.user.id,
    data.workspace.id,
  ]);

  async function open(message: Message) {
    if (opening) return;
    const sequence = ++selection.current;
    setOpening(message.id);
    setError("");
    try {
      const fresh = await api<Message>(
        `/messages/${encodeURIComponent(message.id)}`,
        {
          headers: {
            "X-Workspace-Id": data.workspace.id,
            "X-User-Id": data.user.id,
          },
        },
      );
      if (mounted.current && sequence === selection.current)
        await onSelect(fresh);
    } catch (reason) {
      if (mounted.current && sequence === selection.current) {
        setError((reason as Error).message);
        if (
          reason instanceof ApiError &&
          [401, 403, 404].includes(reason.status)
        ) {
          setResult((old) =>
            old
              ? {
                  ...old,
                  messages: old.messages.filter(
                    (item) => item.id !== message.id,
                  ),
                }
              : old,
          );
          onAccessChanged?.();
        }
      }
    } finally {
      if (mounted.current && sequence === selection.current) setOpening(null);
    }
  }
  return (
    <Modal title="Çalışma alanında ara" onClose={onClose} wide>
      <div className="search-input-wrap">
        <Search size={21} />
        <Input
          unstyled
          aria-label="Mesajlarda ara"
          data-autofocus
          value={query}
          onChange={(event) => {
            reset();
            setQuery(event.target.value);
          }}
          placeholder="Mesaj veya dosya adı ara…"
          autoFocus
          maxLength={100}
        />
        <kbd>Esc</kbd>
      </div>
      <div className="search-filters">
        <label>
          Kanal
          <NativeSelect
            unstyled
            aria-label="Kanal"
            value={filters.channelId}
            onChange={(e) =>
              changeFilters({ ...filters, channelId: e.target.value })
            }
          >
            <option value="">Tüm kanallar</option>
            {data.channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.kind === "dm"
                  ? "Özel mesaj · "
                  : c.visibility === "private"
                    ? "🔒 "
                    : ""}
                {conversationIdentity(c, data.user.id, data.members).name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label>
          Gönderen
          <NativeSelect
            unstyled
            aria-label="Gönderen"
            value={filters.userId}
            onChange={(e) =>
              changeFilters({ ...filters, userId: e.target.value })
            }
          >
            <option value="">Herkes</option>
            {data.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label>
          Başlangıç tarihi
          <Input
            unstyled
            type="date"
            value={filters.from}
            onChange={(e) =>
              changeFilters({ ...filters, from: e.target.value })
            }
          />
        </label>
        <label>
          Bitiş tarihi
          <Input
            unstyled
            type="date"
            value={filters.until}
            min={filters.from}
            onChange={(e) =>
              changeFilters({ ...filters, until: e.target.value })
            }
          />
        </label>
        <label className="search-files">
          <input
            type="checkbox"
            checked={filters.hasFiles}
            onChange={(e) =>
              changeFilters({ ...filters, hasFiles: e.target.checked })
            }
          />
          Yalnızca dosya içerenler
        </label>
        <Button
          variant="unstyled"
          size="unset"
          type="submit"
          className="text-button"
          onClick={() => changeFilters(emptyFilters)}
        >
          Filtreleri temizle
        </Button>
      </div>
      <div className="search-results" aria-busy={loading}>
        {(range.error || error) && (
          <div className="search-load-error" role="alert">
            <p>{range.error || error}</p>
            {!range.error && (
              <Button
                variant="outline"
                size="unset"
                type="submit"
                className="secondary-button"
                disabled={loading}
                onClick={() => {
                  if (restart) {
                    reset();
                    setRestart(false);
                  }
                  setRetry((value) => value + 1);
                }}
              >
                Tekrar dene
              </Button>
            )}
          </div>
        )}
        {loading && <Spinner label="Mesajlar aranıyor" />}
        {!canSearch ? (
          <div className="search-empty">
            <Search size={29} />
            <p>Aramak için en az 2 karakter yaz veya filtre seç.</p>
            <small>
              Erişebildiğin kanallarda ve özel mesajlarında, mesaj metni ve
              dosya adlarında arar.
            </small>
          </div>
        ) : result &&
          !result.messages.length &&
          !loading &&
          !error &&
          !range.error ? (
          <div className="search-empty">
            <MessageCircle size={29} />
            <p>Bu arama için bir sonuç bulamadık.</p>
            <small>Başka bir kelime dene veya filtreleri azalt.</small>
          </div>
        ) : (
          result && (
            <>
              <div className="search-count" aria-live="polite">
                {result.page * 50 + 1}–
                {result.page * 50 + result.messages.length}. sonuçlar
              </div>
              {result.messages.map((message) => (
                <Button
                  variant="unstyled"
                  size="unset"
                  type="submit"
                  key={message.id}
                  data-message-id={message.id}
                  className="search-result"
                  disabled={Boolean(opening) || loading}
                  onClick={() => void open(message)}
                >
                  <span className="search-result-channel">
                    <ConversationLabel
                      channel={data.channels.find(
                        (c) => c.id === message.channelId,
                      )}
                      selfId={data.user.id}
                      members={data.members}
                    />
                    <time>{dateLabel(message.createdAt)}</time>
                  </span>
                  <strong>
                    {data.members.find((m) => m.id === message.userId)?.name ||
                      "Eski üye"}
                  </strong>
                  {message.content && (
                    <p>{mentionPreview(message.content, data.members)}</p>
                  )}
                  {!!message.attachments.length && (
                    <span className="search-result-files">
                      {message.attachments.map((file) => (
                        <span key={file.id}>
                          <FileText size={14} aria-hidden="true" />
                          {file.name}
                        </span>
                      ))}
                    </span>
                  )}
                  {opening === message.id && (
                    <span role="status">Mesaj açılıyor…</span>
                  )}
                </Button>
              ))}
            </>
          )
        )}
      </div>
      {result && (result.page > 0 || result.nextCursor || page > 0) && (
        <div className="modal-actions">
          <Button
            variant="outline"
            size="unset"
            type="submit"
            className="secondary-button"
            disabled={!page || loading || Boolean(opening)}
            onClick={() => setPage((value) => value - 1)}
          >
            Önceki sayfa
          </Button>
          <Button
            variant="outline"
            size="unset"
            type="submit"
            className="secondary-button"
            disabled={
              !result.nextCursor ||
              result.page !== page ||
              loading ||
              Boolean(opening)
            }
            onClick={() => {
              setCursors((old) => [
                ...old.slice(0, page + 1),
                result.nextCursor,
              ]);
              setPage((value) => value + 1);
            }}
          >
            Sonraki sayfa
          </Button>
        </div>
      )}
    </Modal>
  );
}
