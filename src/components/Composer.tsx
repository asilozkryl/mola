import { useRef, useState, type KeyboardEvent } from "react";
import {
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
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  function update(value: string) {
    if (busy) return;
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
      busy ||
      uploading ||
      draft.conflict ||
      (!content.trim() && !files.length)
    )
      return;
    setBusy(true);
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
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(file?: File) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      onError("Dosya en fazla 10 MB olabilir.");
      return;
    }
    if (files.length >= 4) {
      onError("Bir mesajda en fazla 4 dosya paylaşabilirsin.");
      return;
    }
    setUploading(true);
    const body = new FormData();
    body.append("file", file);
    try {
      const attachment = await api<Attachment>("/uploads", {
        method: "POST",
        headers: { "X-Workspace-Id": workspaceId, "X-User-Id": userId },
        body,
      });
      setFiles((old) => [...old, attachment]);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
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
    <div className={`composer-wrap ${parentId ? "thread-composer" : ""}`}>
      <div className="composer">
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
              <span key={f.id}>
                <Paperclip size={14} />
                <span>
                  {f.name}
                  <small>{fileSize(f.size)}</small>
                </span>
                <IconButton
                  label={`${f.name} dosyasını kaldır`}
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
        <textarea
          ref={input}
          aria-label={
            parentId ? "Yanıtını yaz" : `#${channelName} kanalına mesaj yaz`
          }
          placeholder={
            parentId
              ? "Sohbete bir yanıt ekle..."
              : `#${channelName} kanalına bir şeyler yaz...`
          }
          value={content}
          maxLength={10000}
          onChange={(e) => update(e.target.value)}
          onKeyDown={keyDown}
          rows={2}
          disabled={busy}
        />
        <div className="composer-tools">
          <div className="composer-tools-left">
            <IconButton
              label="Dosya ekle"
              onClick={() => fileInput.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <LoaderCircle size={18} className="spin" />
              ) : (
                <Paperclip size={19} />
              )}
            </IconButton>
            <span className="tool-divider" />
            <IconButton label="Kalın yazı" onClick={() => insert("**", true)}>
              <Bold size={17} />
            </IconButton>
            <IconButton label="Kod ekle" onClick={() => insert("`", true)}>
              <Code2 size={19} />
            </IconButton>
            <IconButton
              label="Emoji ekle"
              onClick={() => setPicker(picker === "emoji" ? null : "emoji")}
            >
              <Smile size={19} />
            </IconButton>
            <IconButton
              label="Birinden bahset"
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
          </button>
        </div>
        {picker && (
          <div
            className={`composer-picker ${picker === "emoji" ? "emoji-picker" : "mention-picker"}`}
          >
            <div className="picker-heading">
              <span>
                {picker === "emoji" ? "Bir emoji seç" : "Birinden bahset"}
              </span>
              <IconButton
                label="Seçiciyi kapat"
                onClick={() => setPicker(null)}
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
                    onClick={() => insert(emoji)}
                    aria-label={`${emoji} ekle`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ) : (
              members.map((name) => (
                <button
                  key={name}
                  onClick={() => insert(`@${name.replaceAll(" ", "")} `)}
                >
                  {name}
                </button>
              ))
            )}
          </div>
        )}
        <input
          ref={fileInput}
          type="file"
          className="visually-hidden"
          aria-label="Paylaşılacak dosya"
          accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/csv"
          onChange={(e) => void upload(e.target.files?.[0])}
        />
      </div>
      <div className="composer-hint">
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
            `${content.length}/10000`
          ) : draft.status === "saving" ? (
            "Taslak eşitleniyor…"
          ) : content ? (
            "Taslak eşitlendi"
          ) : (
            "Küçük bir mesaj, güzel bir başlangıç."
          )}
        </span>
      </div>
    </div>
  );
}
