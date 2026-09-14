import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  CornerDownLeft,
  FileText,
  MessageCircle,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { Bootstrap, Message } from "../../shared/types";
import type { MessageSearchPage } from "../../shared/collection-types";
import { mentionPreview } from "../../shared/mentions";
import { api, ApiError } from "../lib/api";
import { collectionDateRange } from "../lib/collection-filters";
import { conversationIdentity } from "../lib/conversationIdentity";
import {
  EMPTY_SEARCH_FILTERS,
  parseSearchQuery,
  type SearchFilters,
} from "../lib/search-query";
import { highlightSearchText } from "../lib/search-highlight";
import { ConversationLabel } from "./ConversationLabel";
import { Avatar, dateLabel, Modal, Spinner } from "./ui";
import "./search-collections.css";

type Props = {
  data: Bootstrap;
  onClose: () => void;
  onSelect: (message: Message) => Promise<void>;
  onAccessChanged?: () => void;
};
const fileTypes = [
  ["pdf", "PDF", "pdf"],
  ["image", "Görsel", "görsel"],
  ["video", "Video", "video"],
  ["audio", "Ses", "ses"],
  ["docx", "Word · DOCX", "docx"],
  ["xlsx", "Excel · XLSX", "xlsx"],
  ["pptx", "Sunum · PPTX", "pptx"],
  ["zip", "Arşiv · ZIP", "zip"],
] as const;
const fold = (value: string) =>
  value.normalize("NFKC").toLocaleLowerCase("tr-TR");
const quote = (value: string) =>
  /[\s"\\]/.test(value) ? JSON.stringify(value) : value;
function Highlight({ text, query }: { text: string; query: string }) {
  return highlightSearchText(text, query).map((part, index) =>
    part.match ? <mark key={index}>{part.text}</mark> : part.text,
  );
}

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
  const [manualFilters, setManualFilters] =
    useState<SearchFilters>(EMPTY_SEARCH_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [inputFocused, setInputFocused] = useState(true);
  const [caretAtEnd, setCaretAtEnd] = useState(true);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<
    string | null
  >(null);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const channels = useMemo(
    () =>
      data.channels.map((channel) => ({
        id: channel.id,
        name: conversationIdentity(channel, data.user.id, data.members).name,
      })),
    [data.channels, data.user.id, data.members],
  );
  const parsed = useMemo(
    () =>
      parseSearchQuery(query, {
        channels,
        members: data.members,
        selfId: data.user.id,
      }),
    [query, channels, data.members, data.user.id],
  );
  const filters = { ...manualFilters, ...parsed.filters };
  const range = collectionDateRange(filters.from, filters.until);
  const queryError = parsed.error || range.error;
  const canSearch =
    parsed.text.trim().length >= 2 || Object.values(filters).some(Boolean);
  const queryKey = JSON.stringify([
    parsed.text,
    filters.channelId,
    filters.userId,
    filters.from,
    filters.until,
    filters.hasFiles,
    filters.fileType,
  ]);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState(0);
  const [response, setResponse] = useState<
    (MessageSearchPage & { page: number; queryKey: string }) | null
  >(null);
  const result = response?.queryKey === queryKey ? response : null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [restart, setRestart] = useState(false);
  const [retry, setRetry] = useState(0);
  const [opening, setOpening] = useState<string | null>(null);
  const selection = useRef(0);
  const mounted = useRef(true);
  const cursor = cursors[page];
  const completion =
    /(?:^|\s)(kanal|in|kimden|gönderen|from|tarih|dosya):(?:"([^"\\]*)|([^\s"\\]*))$/iu.exec(
      query,
    );
  const suggestions = useMemo(() => {
    if (!completion) return [];
    const operator = fold(completion[1]);
    const needle = fold(completion[2] ?? completion[3] ?? "").replace(
      /^[#@]/,
      "",
    );
    const items =
      operator === "kanal" || operator === "in"
        ? channels.map((channel) => ({
            label: channel.name,
            detail: "Konuşmada ara",
            value: `kanal:${quote(channel.name)}`,
          }))
        : ["kimden", "gönderen", "from"].includes(operator)
          ? [
              {
                label: "Ben",
                detail: "Gönderdiğim mesajlar",
                value: "kimden:ben",
              },
              ...data.members.map((member) => ({
                label: member.name,
                detail: "Gönderen",
                value: `kimden:${quote(member.name)}`,
              })),
            ]
          : operator === "tarih"
            ? [
                {
                  label: "Bugün",
                  detail: "Bugün gönderilenler",
                  value: "tarih:bugün",
                },
                {
                  label: "Dün",
                  detail: "Dün gönderilenler",
                  value: "tarih:dün",
                },
                {
                  label: "Son 7 gün",
                  detail: "Bugün dahil",
                  value: "tarih:son7gün",
                },
              ]
            : [
                {
                  label: "Tüm dosyalar",
                  detail: "Dosya içeren mesajlar",
                  value: "dosya:var",
                },
                ...fileTypes.map(([, label, value]) => ({
                  label,
                  detail: "Dosya türü",
                  value: `dosya:${value}`,
                })),
              ];
    return items
      .filter(
        (item) =>
          !needle ||
          fold(item.label).includes(needle) ||
          fold(item.value.split(":")[1]).includes(needle),
      )
      .slice(0, 6);
  }, [query, channels, data.members]);
  const showSuggestions =
    inputFocused &&
    caretAtEnd &&
    dismissedSuggestions !== query &&
    suggestions.length > 0;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      selection.current++;
    };
  }, []);
  useEffect(() => {
    if (showSuggestions && activeSuggestion >= 0)
      document
        .getElementById(`search-suggestion-${activeSuggestion}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [activeSuggestion, showSuggestions]);
  function reset() {
    selection.current++;
    setOpening(null);
    setPage(0);
    setCursors([null]);
    setResponse(null);
    setError("");
    setRestart(false);
  }
  function updateQuery(value: string, focus = false) {
    reset();
    setQuery(value);
    setActiveSuggestion(-1);
    setDismissedSuggestions(null);
    if (focus) {
      inputRef.current?.focus();
      setCaretAtEnd(true);
    }
  }
  function changeFilters(next: SearchFilters) {
    reset();
    setManualFilters(next);
  }
  function removeToken(start: number, end: number) {
    updateQuery(
      `${query.slice(0, start).trimEnd()} ${query.slice(end).trimStart()}`.trim(),
      true,
    );
  }
  function applySuggestion(index: number) {
    if (!completion || !suggestions[index]) return;
    const start = completion.index + (/^\s/.test(completion[0]) ? 1 : 0);
    updateQuery(`${query.slice(0, start)}${suggestions[index].value} `, true);
  }
  const typedKeys = new Set(Object.keys(parsed.filters));
  const manualLabels: Record<keyof SearchFilters, string> = {
    channelId: `Kanal: ${channels.find((c) => c.id === filters.channelId)?.name || ""}`,
    userId: `Kimden: ${data.members.find((member) => member.id === filters.userId)?.name || ""}`,
    from: `Başlangıç: ${filters.from}`,
    until: `Bitiş: ${filters.until}`,
    hasFiles: "Dosya içerenler",
    fileType: `Dosya: ${fileTypes.find((type) => type[0] === filters.fileType)?.[1] || ""}`,
  };
  const manualKeys = (
    Object.keys(manualFilters) as (keyof SearchFilters)[]
  ).filter(
    (key) =>
      manualFilters[key] &&
      !typedKeys.has(key) &&
      !(key === "hasFiles" && filters.fileType),
  );
  const filterCount = parsed.tokens.length + manualKeys.length;
  useEffect(() => {
    if (!canSearch || queryError) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q: parsed.text.trim() });
      if (cursor) params.set("cursor", cursor);
      if (filters.channelId) params.set("channelId", filters.channelId);
      if (filters.userId) params.set("userId", filters.userId);
      if (filters.hasFiles) params.set("hasFiles", "true");
      if (filters.fileType) params.set("fileType", filters.fileType);
      if (range.startAt) params.set("startAt", range.startAt);
      if (range.endBefore) params.set("endBefore", range.endBefore);
      api<MessageSearchPage>(`/search?${params}`, {
        signal: controller.signal,
        headers: {
          "X-Workspace-Id": data.workspace.id,
          "X-User-Id": data.user.id,
        },
      })
        .then((value) => {
          if (!controller.signal.aborted)
            setResponse({ ...value, page, queryKey });
        })
        .catch((reason: Error) => {
          if (!controller.signal.aborted) {
            setError(reason.message);
            if (reason instanceof ApiError) {
              setRestart(reason.code === "INVALID_COLLECTION_CURSOR");
              if ([401, 403, 404].includes(reason.status)) setResponse(null);
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
    parsed.text,
    filters.channelId,
    filters.userId,
    filters.hasFiles,
    filters.fileType,
    cursor,
    page,
    retry,
    canSearch,
    queryError,
    queryKey,
    range.startAt,
    range.endBefore,
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
          setResponse((old) =>
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
      <div className="search-dialog">
        <div className="search-query-field">
          <div className="search-input-wrap">
            <Search size={20} aria-hidden="true" />
            <Input
              unstyled
              ref={inputRef}
              aria-label="Mesajlarda ara"
              aria-describedby="search-query-help"
              aria-autocomplete="list"
              aria-controls={showSuggestions ? "search-suggestions" : undefined}
              aria-activedescendant={
                showSuggestions && activeSuggestion >= 0
                  ? `search-suggestion-${activeSuggestion}`
                  : undefined
              }
              data-autofocus
              value={query}
              autoFocus
              maxLength={600}
              autoComplete="off"
              spellCheck={false}
              placeholder="Bir kelime, cümle veya dosya adı yaz…"
              onChange={(event) => updateQuery(event.target.value)}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              onSelect={(event) =>
                setCaretAtEnd(
                  event.currentTarget.selectionStart ===
                    event.currentTarget.value.length &&
                    event.currentTarget.selectionEnd ===
                      event.currentTarget.value.length,
                )
              }
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (
                  showSuggestions &&
                  ["ArrowDown", "ArrowUp"].includes(event.key)
                ) {
                  event.preventDefault();
                  setActiveSuggestion((index) =>
                    event.key === "ArrowDown"
                      ? (index + 1) % suggestions.length
                      : (index <= 0 ? suggestions.length : index) - 1,
                  );
                } else if (
                  showSuggestions &&
                  event.key === "Enter" &&
                  activeSuggestion >= 0
                ) {
                  event.preventDefault();
                  applySuggestion(activeSuggestion);
                } else if (showSuggestions && event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setDismissedSuggestions(query);
                  setActiveSuggestion(-1);
                } else if (!showSuggestions && event.key === "ArrowDown") {
                  const first =
                    resultsRef.current?.querySelector<HTMLButtonElement>(
                      ".search-result:not(:disabled)",
                    );
                  if (first) {
                    event.preventDefault();
                    first.focus();
                  }
                }
              }}
            />
            {query ? (
              <Button
                variant="unstyled"
                size="unset"
                type="button"
                className="search-clear"
                aria-label="Aramayı temizle"
                onClick={() => {
                  changeFilters(EMPTY_SEARCH_FILTERS);
                  updateQuery("", true);
                }}
              >
                <X size={16} aria-hidden="true" />
              </Button>
            ) : (
              <kbd aria-hidden="true">Esc</kbd>
            )}
          </div>
          {showSuggestions && (
            <div
              className="search-suggestions"
              id="search-suggestions"
              role="listbox"
              aria-label="Arama önerileri"
            >
              {suggestions.map((item, index) => (
                <Button
                  key={item.value}
                  variant="unstyled"
                  size="unset"
                  type="button"
                  role="option"
                  id={`search-suggestion-${index}`}
                  aria-selected={index === activeSuggestion}
                  tabIndex={-1}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applySuggestion(index)}
                >
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                  </span>
                  <CornerDownLeft size={15} aria-hidden="true" />
                </Button>
              ))}
            </div>
          )}
        </div>
        <div className="search-toolbar">
          <p id="search-query-help">Mesaj metninde ve dosya adlarında ara.</p>
          <Button
            variant="unstyled"
            size="unset"
            type="button"
            className="search-filter-toggle"
            aria-expanded={showFilters}
            aria-controls="search-advanced-filters"
            onClick={() => setShowFilters((value) => !value)}
          >
            <SlidersHorizontal size={15} aria-hidden="true" /> Filtreler{" "}
            {filterCount > 0 && <span>{filterCount}</span>}
          </Button>
        </div>
        {filterCount > 0 && (
          <div
            className="search-active-filters"
            aria-label="Etkin arama filtreleri"
          >
            {parsed.tokens.map((token) => (
              <Button
                variant="unstyled"
                size="unset"
                type="button"
                key={`${token.start}:${token.end}`}
                aria-label={`${token.label} filtresini kaldır`}
                onClick={() => removeToken(token.start, token.end)}
              >
                {token.label}
                <X size={12} aria-hidden="true" />
              </Button>
            ))}
            {manualKeys.map((key) => (
              <Button
                variant="unstyled"
                size="unset"
                type="button"
                key={key}
                aria-label={`${manualLabels[key]} filtresini kaldır`}
                onClick={() =>
                  changeFilters({
                    ...manualFilters,
                    [key]: EMPTY_SEARCH_FILTERS[key],
                  })
                }
              >
                {manualLabels[key]}
                <X size={12} aria-hidden="true" />
              </Button>
            ))}
            <Button
              variant="unstyled"
              size="unset"
              type="button"
              className="search-filter-clear"
              onClick={() => {
                changeFilters(EMPTY_SEARCH_FILTERS);
                updateQuery(parsed.text, true);
              }}
            >
              Filtreleri temizle
            </Button>
          </div>
        )}
        <div
          id="search-advanced-filters"
          className="search-filters"
          hidden={!showFilters}
        >
          {parsed.tokens.length > 0 && (
            <p className="search-typed-note">
              Yazıyla eklenen filtreleri arama kutusundan veya üzerlerindeki ×
              düğmesinden değiştirebilirsin.
            </p>
          )}
          <label>
            Kanal
            <NativeSelect
              unstyled
              aria-label="Kanal"
              value={filters.channelId}
              disabled={typedKeys.has("channelId")}
              onChange={(event) =>
                changeFilters({
                  ...manualFilters,
                  channelId: event.target.value,
                })
              }
            >
              <option value="">Tüm kanallar</option>
              {data.channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.kind === "dm"
                    ? "Özel mesaj · "
                    : channel.visibility === "private"
                      ? "🔒 "
                      : ""}
                  {
                    conversationIdentity(channel, data.user.id, data.members)
                      .name
                  }
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
              disabled={typedKeys.has("userId")}
              onChange={(event) =>
                changeFilters({ ...manualFilters, userId: event.target.value })
              }
            >
              <option value="">Herkes</option>
              {data.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
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
              disabled={typedKeys.has("from")}
              onChange={(event) =>
                changeFilters({ ...manualFilters, from: event.target.value })
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
              disabled={typedKeys.has("until")}
              onChange={(event) =>
                changeFilters({ ...manualFilters, until: event.target.value })
              }
            />
          </label>
          <label>
            Dosya türü
            <NativeSelect
              unstyled
              aria-label="Dosya türü"
              value={filters.fileType}
              disabled={typedKeys.has("fileType")}
              onChange={(event) =>
                changeFilters({
                  ...manualFilters,
                  fileType: event.target.value,
                })
              }
            >
              <option value="">Tüm türler</option>
              {fileTypes.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="search-files">
            <input
              type="checkbox"
              checked={Boolean(filters.hasFiles || filters.fileType)}
              disabled={typedKeys.has("hasFiles") || Boolean(filters.fileType)}
              onChange={(event) =>
                changeFilters({
                  ...manualFilters,
                  hasFiles: event.target.checked,
                })
              }
            />
            Yalnızca dosya içerenler
          </label>
        </div>
        <div className="search-results" ref={resultsRef} aria-busy={loading}>
          {(queryError || error) && (
            <div className="search-load-error" role="alert">
              <p>{queryError || error}</p>
              {!queryError && (
                <Button
                  variant="outline"
                  size="unset"
                  type="button"
                  className="secondary-button"
                  disabled={loading}
                  onClick={() => {
                    if (restart) reset();
                    setRetry((value) => value + 1);
                  }}
                >
                  Tekrar dene
                </Button>
              )}
            </div>
          )}
          {loading && !queryError && <Spinner label="Mesajlar aranıyor" />}
          {!canSearch && !queryError ? (
            <div className="search-empty search-start">
              <span className="search-empty-icon">
                <Search size={25} aria-hidden="true" />
              </span>
              <h3>Hatırladığın bir kelimeyle başla</h3>
              <p>En az 2 karakter yaz. İstersen aramana bir filtre ekle.</p>
              <div className="search-examples" aria-label="Arama örnekleri">
                {[
                  ["kanal:", "Bir kanalda", "kanal:genel"],
                  ["kimden:", "Bir kişiden", "kimden:ben"],
                  ["tarih:", "Bir tarihte", "tarih:bugün"],
                  ["dosya:", "Dosyalarda", "dosya:pdf"],
                ].map(([value, label, example]) => (
                  <Button
                    variant="unstyled"
                    size="unset"
                    type="button"
                    key={value}
                    onClick={() =>
                      updateQuery(`${query.trim()} ${value}`.trimStart(), true)
                    }
                  >
                    <span>{label}</span>
                    <code>{example}</code>
                  </Button>
                ))}
              </div>
              <small>
                Erişebildiğin kanallardaki ve özel mesajlarındaki içerikler
                aranır.
              </small>
            </div>
          ) : result &&
            !result.messages.length &&
            !loading &&
            !error &&
            !queryError ? (
            <div className="search-empty">
              <MessageCircle size={29} aria-hidden="true" />
              <h3>Bu arama için bir sonuç bulamadık.</h3>
              <p>Başka bir kelime dene veya filtreleri azalt.</p>
            </div>
          ) : (
            result &&
            !queryError && (
              <>
                <div className="search-count" aria-live="polite">
                  <span>
                    {result.page * 50 + 1}–
                    {result.page * 50 + result.messages.length}. sonuçlar
                  </span>
                  <span>En yeniden eskiye</span>
                </div>
                {result.messages.map((message) => {
                  const author = data.members.find(
                    (member) => member.id === message.userId,
                  );
                  return (
                    <Button
                      variant="unstyled"
                      size="unset"
                      type="button"
                      key={message.id}
                      data-message-id={message.id}
                      className="search-result"
                      disabled={Boolean(opening) || loading}
                      onClick={() => void open(message)}
                    >
                      <Avatar user={author} size="small" />
                      <span className="search-result-body">
                        <span className="search-result-channel">
                          <ConversationLabel
                            channel={data.channels.find(
                              (channel) => channel.id === message.channelId,
                            )}
                            selfId={data.user.id}
                            members={data.members}
                          />
                          <time dateTime={message.createdAt}>
                            {dateLabel(message.createdAt)}
                          </time>
                        </span>
                        <strong>{author?.name || "Eski üye"}</strong>
                        {message.content && (
                          <p>
                            <Highlight
                              text={mentionPreview(
                                message.content,
                                data.members,
                              )}
                              query={parsed.text}
                            />
                          </p>
                        )}
                        {!!message.attachments.length && (
                          <span className="search-result-files">
                            {message.attachments.map((file) => (
                              <span key={file.id}>
                                <FileText size={14} aria-hidden="true" />
                                <span>
                                  <Highlight
                                    text={file.name}
                                    query={parsed.text}
                                  />
                                </span>
                              </span>
                            ))}
                          </span>
                        )}
                        {opening === message.id && (
                          <span role="status">Mesaj açılıyor…</span>
                        )}
                      </span>
                    </Button>
                  );
                })}
              </>
            )
          )}
        </div>
        {result &&
          !queryError &&
          (result.page > 0 || result.nextCursor || page > 0) && (
            <div className="modal-actions">
              <Button
                variant="outline"
                size="unset"
                type="button"
                className="secondary-button"
                disabled={!page || loading || Boolean(opening)}
                onClick={() => setPage((value) => value - 1)}
              >
                Önceki sayfa
              </Button>
              <Button
                variant="outline"
                size="unset"
                type="button"
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
        <div className="search-keyboard-hint">
          <span>
            <ArrowDown size={12} aria-hidden="true" /> Sonuçlara geç
          </span>
          <span>
            <kbd>Esc</kbd> Kapat
          </span>
        </div>
      </div>
    </Modal>
  );
}
