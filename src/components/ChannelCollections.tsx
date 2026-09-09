import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Download,
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  LoaderCircle,
  MessageSquare,
  Pin,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import type { Attachment, Message, User } from "../../shared/types";
import type { ChannelFile } from "../../shared/collection-types";
import {
  useChannelCollection,
  type CollectionKind,
} from "../lib/useChannelCollection";
import { CollectionError } from "./CollectionError";
import { fileSize, IconButton, Spinner } from "./ui";
import "./channel-collections.css";

function FileKindIcon({ file }: { file: Attachment }) {
  const Icon = file.mime.startsWith("image/")
    ? FileImage
    : file.mime.startsWith("video/")
      ? FileVideo
      : file.mime.startsWith("audio/")
        ? FileAudio
        : /zip|gzip|compressed|tar/.test(file.mime)
          ? FileArchive
          : /text|pdf|document/.test(file.mime)
            ? FileText
            : File;
  return <Icon size={21} aria-hidden="true" />;
}
const shortDate = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const fullDate = new Intl.DateTimeFormat("tr-TR", {
  dateStyle: "long",
  timeStyle: "short",
});

export function ChannelCollections({
  userId,
  workspaceId,
  channelId,
  kind,
  members,
  version = 0,
  renderMessage,
  onOpenFile,
  onOpenMessage,
  onShareFile,
  onBackToChat,
  onError,
}: {
  userId: string;
  workspaceId: string;
  channelId: string;
  kind: CollectionKind;
  members: readonly User[];
  version?: number;
  renderMessage: (message: Message) => ReactNode;
  onOpenFile: (file: ChannelFile) => void;
  onOpenMessage: (messageId: string, isCurrent: () => boolean) => Promise<void>;
  onShareFile?: () => void;
  onBackToChat?: () => void;
  onError?: (error: string) => void;
}) {
  const state = useChannelCollection({
    userId,
    workspaceId,
    channelId,
    kind,
    version,
  });
  const root = useRef<HTMLElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const selection = useRef(0);
  const live = useRef({ alive: true, context: state.context });
  if (live.current.context !== state.context) selection.current++;
  live.current.context = state.context;
  const openingRef = useRef<{ sequence: number; id: string } | null>(null);
  const [opening, setOpening] = useState<{
    context: string;
    id: string;
    sequence: number;
  } | null>(null);
  const [openError, setOpenError] = useState({ context: "", message: "" });
  const isFiles = kind === "files";
  const count = isFiles ? state.files.length : state.messages.length;
  const byMember = new Map(members.map((member) => [member.id, member]));
  const activeOpening =
    opening?.context === state.context && opening.sequence === selection.current
      ? opening.id
      : null;
  useEffect(() => {
    live.current.alive = true;
    return () => {
      live.current.alive = false;
      selection.current++;
    };
  }, []);

  async function open(messageId: string) {
    const context = state.context;
    if (openingRef.current?.sequence === selection.current) return;
    const sequence = ++selection.current;
    const isCurrent = () =>
      live.current.alive &&
      live.current.context === context &&
      selection.current === sequence;
    openingRef.current = { sequence, id: messageId };
    setOpening({ context, id: messageId, sequence });
    setOpenError({ context, message: "" });
    try {
      await onOpenMessage(messageId, isCurrent);
    } catch (error) {
      if (isCurrent()) {
        const message =
          error instanceof Error
            ? error.message
            : "Mesaj açılamadı. Yeniden deneyebilirsin.";
        setOpenError({ context, message });
        onError?.(message);
      }
    } finally {
      if (
        openingRef.current?.sequence === sequence &&
        openingRef.current.id === messageId
      )
        openingRef.current = null;
      if (isCurrent()) setOpening(null);
    }
  }
  async function retry() {
    const context = state.context;
    const focused = document.activeElement;
    const fromError = root.current
      ?.querySelector(".collection-error")
      ?.contains(focused);
    const success = await state.retry();
    if (success && fromError)
      requestAnimationFrame(() => {
        if (
          live.current.alive &&
          live.current.context === context &&
          (document.activeElement === focused ||
            document.activeElement === document.body)
        )
          root.current
            ?.closest<HTMLElement>(".message-scroll")
            ?.focus({ preventScroll: true });
      });
  }
  async function more() {
    const context = state.context;
    const focused = document.activeElement;
    const fromButton = focused === moreButton.current;
    const previousCount = count;
    const success = await state.loadMore();
    if (success && fromButton)
      requestAnimationFrame(() => {
        if (
          !live.current.alive ||
          live.current.context !== context ||
          (document.activeElement !== focused &&
            document.activeElement !== document.body)
        )
          return;
        const target =
          moreButton.current ||
          root.current?.querySelectorAll<HTMLElement>("[data-collection-item]")[
            previousCount
          ];
        target?.focus({ preventScroll: true });
      });
  }
  return (
    <section
      className="channel-collections"
      ref={root}
      aria-label={isFiles ? "Paylaşılan dosyalar" : "Sabitlenen mesajlar"}
    >
      <div className="channel-collection-toolbar">
        <div className="channel-collection-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            aria-label={
              isFiles ? "Dosyalarda ara" : "Sabitlenen mesajlarda ara"
            }
            placeholder={
              isFiles
                ? "Dosya adı veya mesajda ara…"
                : "Mesaj veya dosya adında ara…"
            }
            value={state.query}
            maxLength={200}
            onChange={(event) => state.setQuery(event.target.value)}
          />
          {state.query && (
            <IconButton
              label="Aramayı temizle"
              onClick={() => state.setQuery("")}
            >
              <X size={15} />
            </IconButton>
          )}
        </div>
        <label className="channel-collection-sender">
          <span>Gönderen</span>
          <select
            aria-label="Gönderen"
            value={state.senderId}
            onChange={(event) => state.setSenderId(event.target.value)}
          >
            <option value="">Herkes</option>
            {members.map((member) => (
              <option value={member.id} key={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>
        <label className="channel-collection-start">
          <span>Başlangıç</span>
          <input
            type="date"
            aria-label="Başlangıç tarihi"
            value={state.startDate}
            max={state.endDate || undefined}
            onChange={(event) => state.setStartDate(event.target.value)}
          />
        </label>
        <label className="channel-collection-end">
          <span>Bitiş</span>
          <input
            type="date"
            aria-label="Bitiş tarihi"
            value={state.endDate}
            min={state.startDate || undefined}
            onChange={(event) => state.setEndDate(event.target.value)}
          />
        </label>
        <IconButton
          className="channel-collection-refresh"
          label={isFiles ? "Dosyaları yenile" : "Sabitlenenleri yenile"}
          disabled={
            state.loading || state.loadingMore || Boolean(state.filterError)
          }
          onClick={() => void state.refresh()}
        >
          <RefreshCw size={16} />
        </IconButton>
      </div>
      <div className="channel-collection-summary">
        <p role="status" aria-live="polite">
          {state.filterError
            ? "Tarih aralığını kontrol et"
            : state.loading
              ? "Liste güncelleniyor…"
              : state.error
                ? "Liste güncellenemedi"
                : `${state.total} ${state.filtered ? "sonuç" : isFiles ? "dosya" : "sabitlenen mesaj"}`}
        </p>
        {state.filtered && (
          <button type="button" onClick={state.clearFilters}>
            Filtreleri temizle
          </button>
        )}
      </div>
      {state.filterError && (
        <p className="channel-collection-inline-error" role="alert">
          {state.filterError}
        </p>
      )}
      {openError.context === state.context && openError.message && (
        <p className="channel-collection-inline-error" role="alert">
          {openError.message}
        </p>
      )}
      {state.error && (
        <CollectionError
          kind={kind}
          message={state.error}
          onRetry={() => void retry()}
        />
      )}
      {state.loading && !count && (
        <div className="channel-collection-loading">
          <Spinner label="Sohbet yükleniyor" />
        </div>
      )}
      {!state.loading && !state.error && !state.filterError && !count && (
        <div className="channel-collection-empty">
          {state.filtered ? (
            <Search size={25} aria-hidden="true" />
          ) : isFiles ? (
            <FileText size={25} aria-hidden="true" />
          ) : (
            <Pin size={25} aria-hidden="true" />
          )}
          <h2>
            {state.filtered
              ? "Bu filtrelerle sonuç bulunamadı"
              : isFiles
                ? "İlk dosyaya yer açtık."
                : "Henüz sabitlenen mesaj yok."}
          </h2>
          <p>
            {state.filtered
              ? "Başka bir kelime dene veya filtreleri temizle."
              : isFiles
                ? "Mesaj kutusundaki ataş simgesinden dosya paylaşabilirsin."
                : "Mesaj menüsünden “Kanala sabitle” seçeneğiyle önemli notları buraya ekle."}
          </p>
          {state.filtered ? null : isFiles && onShareFile ? (
            <button
              type="button"
              className="secondary-button"
              onClick={onShareFile}
            >
              <Plus size={15} /> Dosya paylaş
            </button>
          ) : !isFiles && onBackToChat ? (
            <button
              type="button"
              className="secondary-button"
              onClick={onBackToChat}
            >
              <MessageSquare size={15} /> Sohbete dön
            </button>
          ) : null}
        </div>
      )}
      {isFiles && state.files.length > 0 && (
        <div
          className="channel-file-list"
          aria-busy={state.loading || state.loadingMore}
        >
          {state.files.map((file) => {
            const date = new Date(file.createdAt);
            const author = byMember.get(file.user.id) || file.user;
            return (
              <div
                className="channel-file-row"
                key={file.id}
                data-collection-item={file.id}
                tabIndex={-1}
              >
                <button
                  type="button"
                  className="channel-file-preview"
                  aria-label={`${file.name} dosyasını önizle`}
                  title={file.name}
                  onClick={() => onOpenFile(file)}
                >
                  <span className="channel-file-kind">
                    <FileKindIcon file={file} />
                  </span>
                  <span className="channel-file-detail">
                    <strong>{file.name}</strong>
                    <span className="channel-file-meta">
                      <span>{fileSize(file.size)}</span>
                      <span>{author.name}</span>
                      <time
                        dateTime={file.createdAt}
                        title={fullDate.format(date)}
                      >
                        {shortDate.format(date)}
                      </time>
                    </span>
                  </span>
                </button>
                <a
                  className="channel-file-download"
                  href={file.url}
                  download={file.name}
                  aria-label={`${file.name} dosyasını indir`}
                  title="Dosyayı indir"
                >
                  <Download size={17} aria-hidden="true" />
                  <span className="sr-only">{file.name}</span>
                </a>
                <button
                  type="button"
                  className="channel-file-source"
                  aria-label={`${file.name} dosyasının mesajına git`}
                  title="Mesaja git"
                  disabled={activeOpening !== null}
                  aria-busy={activeOpening === file.messageId}
                  onClick={() => void open(file.messageId)}
                >
                  {activeOpening === file.messageId ? (
                    <LoaderCircle size={17} className="spin" />
                  ) : (
                    <ArrowUpRight size={17} aria-hidden="true" />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
      {!isFiles && state.messages.length > 0 && (
        <div
          className="channel-pin-list"
          aria-busy={state.loading || state.loadingMore}
        >
          {state.messages.map((message) => (
            <div
              className="channel-pin-item"
              key={message.id}
              data-collection-item={message.id}
              tabIndex={-1}
            >
              {renderMessage(message)}
              <button
                className="channel-pin-source"
                type="button"
                disabled={activeOpening !== null}
                aria-busy={activeOpening === message.id}
                onClick={() => void open(message.id)}
              >
                {activeOpening === message.id ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <ArrowUpRight size={14} aria-hidden="true" />
                )}{" "}
                Mesaja git
              </button>
            </div>
          ))}
        </div>
      )}
      {state.hasMore && (
        <div className="channel-collection-more">
          <button
            ref={moreButton}
            type="button"
            className="secondary-button"
            disabled={state.loading || state.loadingMore}
            onClick={() => void more()}
          >
            {state.loadingMore && <LoaderCircle size={15} className="spin" />}
            {state.loadingMore ? "Yükleniyor…" : "Daha fazla göster"}
          </button>
        </div>
      )}
    </section>
  );
}
