import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  AlertCircle,
  AtSign,
  Bold,
  Code2,
  LoaderCircle,
  Paperclip,
  Send,
  Smile,
  X,
} from "lucide-react";
import type { Attachment, Message } from "../../shared/types";
import { api } from "../lib/api";
import { fileSize, IconButton } from "./ui";
import { useSyncedDraft } from "../lib/useSyncedDraft";
import "./collaboration.css";
import "./composer-ux.css";

const MAX_ATTACHMENTS = 4;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_MESSAGE_LENGTH = 10000;

export function Composer({
  userId,
  workspaceId,
  channelId,
  channelName,
  parentId,
  onSent,
  onTyping,
  onError,
  members,
}: {
  userId: string;
  workspaceId: string;
  channelId: string;
  channelName: string;
  parentId?: string;
  onSent: (message: Message) => void;
  onTyping?: (typing: boolean) => void;
  onError: (error: string) => void;
  members: string[];
}) {
  const draft = useSyncedDraft(userId, workspaceId, channelId, parentId);
  const content = draft.content;
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [picker, setPicker] = useState<"emoji" | "mention" | null>(null);
  const [feedback, setFeedback] = useState("");
  const [uploadLabel, setUploadLabel] = useState("");
  const [dragging, setDragging] = useState(false);
  const hintId = useId();
  const feedbackId = useId();
  const root = useRef<HTMLDivElement>(null);
  const pickerPanel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const operation = useRef<"send" | "upload" | null>(null);
  const dragDepth = useRef(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    const resize = () => {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    };
    resize();
    const observer = new ResizeObserver(() => {
      // The height changes below also trigger the observer; only width matters.
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      resize();
    });
    let width = el.clientWidth;
    observer.observe(el);
    return () => observer.disconnect();
  }, [content]);

  useEffect(() => {
    if (!picker) return;
    pickerPanel.current
      ?.querySelector<HTMLButtonElement>("[data-picker-option]")
      ?.focus();
    const dismiss = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) setPicker(null);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismiss);
    };
  }, [picker]);

  function reportError(message: string) {
    setFeedback(message);
    onError(message);
  }

  function update(value: string) {
    if (busy) return;
    if (value.length > MAX_MESSAGE_LENGTH) {
      reportError(
        "Mesaj en fazla 10.000 karakter olabilir. Göndermeden önce biraz kısalt.",
      );
      return;
    }
    draft.update(value);
    onTyping?.(Boolean(value));
  }
  function insert(value: string, wrap = false) {
    const el = input.current;
    if (!el) return;
    const start = el.selectionStart,
      end = el.selectionEnd;
    update(
      content.slice(0, start) +
        value +
        (wrap ? content.slice(start, end) + value : "") +
        content.slice(end),
    );
    setPicker(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(
        start + value.length,
        wrap ? end + value.length : start + value.length,
      );
    });
  }
  async function send() {
    if (
      operation.current ||
      draft.conflict ||
      (!content.trim() && !files.length)
    )
      return;
    operation.current = "send";
    setBusy(true);
    setFeedback("");
    setPicker(null);
    try {
      await draft.beginSend(content);
      const message = await api<Message>(`/channels/${channelId}/messages`, {
        method: "POST",
        headers: { "X-Workspace-Id": workspaceId, "X-User-Id": userId },
        body: JSON.stringify({
          content: content.trim(),
          ...(parentId ? { parentId } : {}),
          attachmentIds: files.map((f) => f.id),
        }),
      });
      await draft.sent();
      setFiles([]);
      onTyping?.(false);
      onSent(message);
      input.current?.focus();
    } catch (e) {
      draft.failed();
      if (alive.current) reportError((e as Error).message);
    } finally {
      operation.current = null;
      if (alive.current) {
        setBusy(false);
        requestAnimationFrame(() => input.current?.focus());
      }
    }
  }
  async function upload(selected: File[]) {
    if (fileInput.current) fileInput.current.value = "";
    if (!selected.length || operation.current) return;
    const available = MAX_ATTACHMENTS - files.length;
    const errors: string[] = [];
    const valid = selected.filter((file) => {
      if (file.size <= MAX_FILE_SIZE) return true;
      errors.push(`${file.name}: Dosya en fazla 10 MB olabilir.`);
      return false;
    });
    if (valid.length > available)
      errors.push(
        "Bir mesajda en fazla 4 dosya paylaşabilirsin. Kalan dosyaları başka bir mesajla gönder.",
      );
    const queue = valid.slice(0, available);
    if (!queue.length) {
      if (errors.length) reportError(errors.join(" "));
      return;
    }
    operation.current = "upload";
    setUploading(true);
    setFeedback("");
    setPicker(null);
    try {
      for (const [index, file] of queue.entries()) {
        if (!alive.current) break;
        setUploadLabel(
          `${file.name} yükleniyor${queue.length > 1 ? ` (${index + 1}/${queue.length})` : ""}…`,
        );
        const body = new FormData();
        body.append("file", file);
        try {
          const attachment = await api<Attachment>("/uploads", {
            method: "POST",
            headers: { "X-Workspace-Id": workspaceId, "X-User-Id": userId },
            body,
          });
          if (alive.current) setFiles((old) => [...old, attachment]);
        } catch (e) {
          errors.push(`${file.name}: ${(e as Error).message}`);
        }
      }
    } finally {
      operation.current = null;
      if (alive.current) {
        setUploading(false);
        setUploadLabel("");
        if (errors.length) reportError(errors.join(" "));
      }
    }
  }
  function keyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "b") {
      e.preventDefault();
      insert("**", true);
    }
  }
  return (
    <div
      ref={root}
      className={`composer-wrap composer-ux ${parentId ? "thread-composer" : ""}`}
      onKeyDown={(event) => {
        if (event.key === "Escape" && picker) {
          event.preventDefault();
          event.stopPropagation();
          setPicker(null);
          input.current?.focus();
        }
      }}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        dragDepth.current += 1;
        if (!operation.current) setDragging(true);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = operation.current ? "none" : "copy";
      }}
      onDragLeave={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        void upload(Array.from(event.dataTransfer.files));
      }}
    >
      <div className={`composer ${dragging ? "is-dragging" : ""}`}>
        {dragging && (
          <div className="composer-drop-zone" role="status">
            <Paperclip size={20} aria-hidden="true" />
            <strong>Dosyaları buraya bırak</strong>
            <span>En fazla 4 dosya, dosya başına 10 MB</span>
          </div>
        )}
        {draft.conflict && (
          <div className="draft-conflict" role="status">
            <p>
              Bu taslak başka bir cihazda değişti. Yazdıkların burada duruyor;
              devam etmek için hangi sürümü kullanacağını seç.
            </p>
            <details>
              <summary>Diğer cihazdaki taslağı göster</summary>
              <pre>{draft.conflict.content || "(Boş taslak)"}</pre>
            </details>
            <button type="button" onClick={() => draft.resolve(true)}>
              Diğer taslağı kullan
            </button>
            <button type="button" onClick={() => draft.resolve(false)}>
              Buradaki taslağı kullan
            </button>
          </div>
        )}
        {files.length > 0 && (
          <div className="composer-attachments">
            {files.map((f) => (
              <span key={f.id} title={f.name}>
                <Paperclip size={14} />
                <span>
                  {f.name}
                  <small>{fileSize(f.size)}</small>
                </span>
                <IconButton
                  label={`${f.name} dosyasını kaldır`}
                  disabled={busy || uploading}
                  onClick={() =>
                    setFiles((old) => old.filter((x) => x.id !== f.id))
                  }
                >
                  <X size={14} />
                </IconButton>
              </span>
            ))}
          </div>
        )}
        {(uploading || feedback) && (
          <div
            id={feedbackId}
            className={`composer-feedback ${feedback ? "is-error" : ""}`}
            role={feedback ? "alert" : "status"}
          >
            {feedback ? (
              <AlertCircle size={15} aria-hidden="true" />
            ) : (
              <LoaderCircle size={15} className="spin" aria-hidden="true" />
            )}
            <span>{feedback || uploadLabel}</span>
            {feedback && (
              <IconButton
                label="Dosya ve mesaj uyarısını kapat"
                onClick={() => setFeedback("")}
              >
                <X size={14} />
              </IconButton>
            )}
          </div>
        )}
        <textarea
          ref={input}
          aria-label={
            parentId ? "Yanıtını yaz" : `#${channelName} kanalına mesaj yaz`
          }
          aria-describedby={`${hintId}${uploading || feedback ? ` ${feedbackId}` : ""}`}
          placeholder={
            parentId
              ? "Sohbete bir yanıt ekle..."
              : `#${channelName} kanalına bir şeyler yaz...`
          }
          value={content}
          maxLength={MAX_MESSAGE_LENGTH}
          onChange={(e) => update(e.target.value)}
          onFocus={() => setPicker(null)}
          onKeyDown={keyDown}
          onPaste={(event) => {
            const pasted = Array.from(event.clipboardData.files);
            if (!pasted.length) return;
            event.preventDefault();
            void upload(pasted);
          }}
          rows={1}
          disabled={busy}
        />
        <div className="composer-tools">
          <div className="composer-tools-left">
            <IconButton
              label="Dosya ekle"
              onClick={() => fileInput.current?.click()}
              disabled={busy || uploading || files.length >= MAX_ATTACHMENTS}
            >
              {uploading ? (
                <LoaderCircle size={18} className="spin" />
              ) : (
                <Paperclip size={19} />
              )}
            </IconButton>
            <span className="tool-divider" />
            <IconButton
              label="Kalın yazı"
              disabled={busy}
              onClick={() => insert("**", true)}
            >
              <Bold size={17} />
            </IconButton>
            <IconButton
              label="Kod ekle"
              disabled={busy}
              onClick={() => insert("`", true)}
            >
              <Code2 size={19} />
            </IconButton>
            <IconButton
              label="Emoji ekle"
              disabled={busy}
              pressed={picker === "emoji"}
              onClick={() => setPicker(picker === "emoji" ? null : "emoji")}
            >
              <Smile size={19} />
            </IconButton>
            <IconButton
              label="Birinden bahset"
              disabled={busy}
              pressed={picker === "mention"}
              onClick={() => setPicker(picker === "mention" ? null : "mention")}
            >
              <AtSign size={19} />
            </IconButton>
          </div>
          <button
            type="button"
            className="send-button"
            title="Mesaj gönder"
            aria-label={parentId ? "Yanıt gönder" : "Mesaj gönder"}
            aria-busy={busy}
            onClick={() => void send()}
            disabled={
              busy ||
              uploading ||
              Boolean(draft.conflict) ||
              (!content.trim() && !files.length)
            }
          >
            {busy ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <Send size={17} />
            )}
            <span>Gönder</span>
          </button>
        </div>
        {picker && (
          <div
            ref={pickerPanel}
            className={`composer-picker ${picker === "emoji" ? "emoji-picker" : "mention-picker"}`}
            role="group"
            aria-label={picker === "emoji" ? "Emojiler" : "Kanal üyeleri"}
          >
            <div className="picker-heading">
              <span>
                {picker === "emoji" ? "Bir emoji seç" : "Birinden bahset"}
              </span>
              <IconButton
                label="Seçiciyi kapat"
                onClick={() => {
                  setPicker(null);
                  input.current?.focus();
                }}
              >
                <X size={14} />
              </IconButton>
            </div>
            {picker === "emoji" ? (
              <div>
                {[
                  "🙌",
                  "✨",
                  "💚",
                  "🔥",
                  "👏",
                  "🎉",
                  "👍",
                  "👀",
                  "☕",
                  "🚀",
                  "💡",
                  "😊",
                  "✅",
                  "🤔",
                  "❤️",
                  "🎨",
                ].map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    data-picker-option
                    onClick={() => insert(emoji)}
                    aria-label={`${emoji} ekle`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ) : members.length ? (
              members.map((name) => (
                <button
                  key={name}
                  type="button"
                  data-picker-option
                  onClick={() => insert(`@${name.replaceAll(" ", "")} `)}
                >
                  {name}
                </button>
              ))
            ) : (
              <p className="composer-picker-empty">
                Bahsedebileceğin bir üye yok.
              </p>
            )}
          </div>
        )}
        <input
          ref={fileInput}
          type="file"
          multiple
          disabled={busy || uploading || files.length >= MAX_ATTACHMENTS}
          tabIndex={-1}
          className="visually-hidden"
          aria-label="Paylaşılacak dosya"
          accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/csv"
          onChange={(e) => void upload(Array.from(e.target.files || []))}
        />
      </div>
      <div className="composer-hint" id={hintId}>
        <span>
          <kbd>Enter</kbd> ile gönder · <kbd>Shift + Enter</kbd> ile yeni satır
        </span>
        <span className="draft-status" aria-live="polite">
          {draft.status === "offline" ? (
            <>
              Taslak bu cihazda ·{" "}
              <button onClick={() => void draft.retry()}>Yeniden dene</button>
            </>
          ) : draft.status === "conflict" ? (
            "Taslak seçimi bekleniyor"
          ) : content.length > 9000 ? (
            `${content.length.toLocaleString("tr-TR")} / 10.000 karakter`
          ) : draft.status === "loading" && content ? (
            "Taslak yükleniyor…"
          ) : draft.status === "saving" ? (
            "Taslak eşitleniyor…"
          ) : content ? (
            "Taslak eşitlendi"
          ) : files.length ? (
            `${files.length}/4 dosya hazır`
          ) : (
            "Dosya ekle veya sürükle · En fazla 10 MB"
          )}
        </span>
      </div>
    </div>
  );
}
