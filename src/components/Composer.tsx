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
import { api, post } from "../lib/api";
import { fileSize, IconButton } from "./ui";

export function Composer({
  channelId,
  channelName,
  parentId,
  onSent,
  onTyping,
  onError,
  members,
}: {
  channelId: string;
  channelName: string;
  parentId?: string;
  onSent: (message: Message) => void;
  onTyping?: (typing: boolean) => void;
  onError: (error: string) => void;
  members: string[];
}) {
  const key = `mola:draft:${channelId}:${parentId || ""}`;
  const [content, setContent] = useState(
    () => sessionStorage.getItem(key) || "",
  );
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [picker, setPicker] = useState<"emoji" | "mention" | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  function update(value: string) {
    setContent(value);
    sessionStorage.setItem(key, value);
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
    if (busy || uploading || (!content.trim() && !files.length)) return;
    setBusy(true);
    try {
      const message = await post<Message>(`/channels/${channelId}/messages`, {
        content: content.trim(),
        ...(parentId ? { parentId } : {}),
        attachmentIds: files.map((f) => f.id),
      });
      setContent("");
      sessionStorage.removeItem(key);
      setFiles([]);
      onTyping?.(false);
      onSent(message);
      input.current?.focus();
    } catch (e) {
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
            disabled={busy || uploading || (!content.trim() && !files.length)}
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
        <span>
          {content.length > 9000
            ? `${content.length}/10000`
            : "Küçük bir mesaj, güzel bir başlangıç."}
        </span>
      </div>
    </div>
  );
}
