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
  Check,
  Code2,
  LoaderCircle,
  Paperclip,
  RotateCcw,
  Send,
  Smile,
  X,
} from "lucide-react";
import type { Attachment, Message, User } from "../../shared/types";
import {
  decodeMentions,
  encodeMentions,
  mentionLabel,
  mentionPreview,
  replaceMentionRange,
  updateMentionText,
  type MentionText,
} from "../../shared/mentions";
import { api } from "../lib/api";
import { Avatar, fileSize, IconButton } from "./ui";
import { useSyncedDraft } from "../lib/useSyncedDraft";
import { useMessageSubmission } from "../lib/useMessageSubmission";
import { useMentionHistory } from "../lib/useMentionHistory";
import type { TextSelection } from "../../shared/mention-history";
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
  isDirectMessage = false,
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
  isDirectMessage?: boolean;
  parentId?: string;
  onSent: (message: Message) => void;
  onTyping?: (typing: boolean) => void;
  onError: (error: string) => void;
  members: User[];
}) {
  const draft = useSyncedDraft(userId, workspaceId, channelId, parentId);
  const submission = useMessageSubmission({
    userId,
    workspaceId,
    channelId,
    parentId,
  });
  const snapshot = submission.snapshot;
  const displayedContent = snapshot?.content ?? draft.content;
  const files = snapshot?.attachments ?? draft.attachments;
  const unavailable = snapshot ? [] : draft.unavailableAttachmentIds;
  const mentionDocument = decodeMentions(displayedContent, members);
  const content = mentionDocument.text;
  const direct = isDirectMessage && !parentId;
  const [preparing, setPreparing] = useState(false);
  const busy =
    preparing ||
    submission.status === "sending" ||
    submission.status === "succeeded";
  const locked = busy || Boolean(snapshot);
  const [sendAcknowledged, setSendAcknowledged] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [picker, setPicker] = useState<"emoji" | "mention" | null>(null);
  const [mentionQuery, setMentionQuery] = useState("");
  const [feedback, setFeedback] = useState("");
  const [uploadLabel, setUploadLabel] = useState("");
  const [dragging, setDragging] = useState(false);
  const hintId = useId();
  const feedbackId = useId();
  const deliveryId = useId();
  const root = useRef<HTMLDivElement>(null);
  const pickerPanel = useRef<HTMLDivElement>(null);
  const mentionSearch = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const operation = useRef<"send" | "upload" | null>(null);
  const uploadController = useRef<AbortController | null>(null);
  const finishing = useRef<string | null>(null);
  const dragDepth = useRef(0);
  const alive = useRef(true);
  const history = useMentionHistory(
    draft.content,
    (stored) => {
      setSendAcknowledged(false);
      draft.update(stored);
      onTyping?.(Boolean(stored));
    },
    `${userId}:${workspaceId}:${channelId}:${parentId || ""}`,
    locked,
  );
  const mentionMembers = members.filter(
    (member) => !member.suspended && !member.isBot,
  );
  const query = mentionQuery.trim().toLocaleLowerCase("tr-TR");
  const matchingMembers = mentionMembers.filter((member) =>
    `${member.name} ${member.jobTitle || ""} ${member.email}`
      .toLocaleLowerCase("tr-TR")
      .includes(query),
  );

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      uploadController.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (submission.status !== "succeeded" || !submission.message || !snapshot)
      return;
    const message = submission.message;
    if (finishing.current === message.id) return;
    finishing.current = message.id;
    void (async () => {
      await draft.sent(snapshot);
      if (!alive.current) return;
      onTyping?.(false);
      onSent(message);
      submission.acknowledge();
      setSendAcknowledged(true);
      restoreInputFocus();
    })();
  }, [submission.status, submission.message, snapshot]);

  useEffect(() => {
    if (!sendAcknowledged) return;
    const timeout = window.setTimeout(() => setSendAcknowledged(false), 1600);
    return () => window.clearTimeout(timeout);
  }, [sendAcknowledged]);

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
    if (picker === "mention") {
      setMentionQuery("");
      mentionSearch.current?.focus();
    } else {
      pickerPanel.current
        ?.querySelector<HTMLButtonElement>("[data-picker-option]")
        ?.focus();
    }
    const dismiss = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) setPicker(null);
    };
    window.document.addEventListener("pointerdown", dismiss);
    window.document.addEventListener("focusin", dismiss);
    return () => {
      window.document.removeEventListener("pointerdown", dismiss);
      window.document.removeEventListener("focusin", dismiss);
    };
  }, [picker]);

  function reportError(message: string) {
    setFeedback(message);
    onError(message);
  }

  function restoreInputFocus() {
    requestAnimationFrame(() => {
      const focused = window.document.activeElement;
      if (
        alive.current &&
        input.current &&
        !input.current.disabled &&
        (focused === window.document.body || root.current?.contains(focused))
      ) {
        input.current.focus();
      }
    });
  }

  function removeAttachment(id: string) {
    draft.removeAttachment(id);
    input.current?.focus();
  }

  function resolveDraft(useRemote: boolean) {
    uploadController.current?.abort();
    draft.resolve(useRemote);
    restoreInputFocus();
  }

  async function releaseSubmission() {
    if (busy || operation.current) return;
    const released = submission.restoreOnRelease ? submission.snapshot : null;
    draft.failed();
    setPreparing(true);
    setFeedback("");
    try {
      if (released) await draft.restoreSnapshot(released);
      else await draft.retry();
      // Keep the durable attempt until its draft has been restored in this scope.
      if (alive.current) submission.release();
    } finally {
      if (alive.current) {
        setPreparing(false);
        restoreInputFocus();
      }
    }
  }

  function update(next: MentionText, nextSelection?: TextSelection) {
    if (locked) return;
    setSendAcknowledged(false);
    const stored = encodeMentions(next);
    if (stored.length > MAX_MESSAGE_LENGTH) {
      reportError(
        "Mesaj en fazla 10.000 karakter olabilir. Göndermeden önce biraz kısalt.",
      );
      return;
    }
    history.record(
      stored,
      nextSelection || {
        start: input.current?.selectionStart || 0,
        end: input.current?.selectionEnd || 0,
      },
    );
    draft.update(stored);
    onTyping?.(Boolean(next.text));
  }
  function insert(value: string, wrap = false) {
    const el = input.current;
    if (!el) return;
    const start = el.selectionStart,
      end = el.selectionEnd;
    update(
      wrap
        ? replaceMentionRange(
            replaceMentionRange(mentionDocument, end, end, value),
            start,
            start,
            value,
          )
        : replaceMentionRange(mentionDocument, start, end, value),
      {
        start: start + value.length,
        end: wrap ? end + value.length : start + value.length,
      },
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
  function insertMention(member: User) {
    const el = input.current;
    if (!el) return;
    const start = el.selectionStart;
    const label = `${mentionLabel(member)} `;
    update(
      replaceMentionRange(
        mentionDocument,
        start,
        el.selectionEnd,
        label,
        member,
      ),
      { start: start + label.length, end: start + label.length },
    );
    setPicker(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + label.length, start + label.length);
    });
  }

  function navigateMentions(event: KeyboardEvent<HTMLDivElement>) {
    if (picker !== "mention" || event.nativeEvent.isComposing) return;
    const buttons = Array.from(
      pickerPanel.current?.querySelectorAll<HTMLButtonElement>(
        "[data-picker-option]",
      ) || [],
    );
    const index = buttons.indexOf(
      window.document.activeElement as HTMLButtonElement,
    );
    if (event.target === mentionSearch.current && event.key === "Enter") {
      event.preventDefault();
      buttons[0]?.click();
    } else if (
      ["ArrowDown", "ArrowUp"].includes(event.key) ||
      (index >= 0 && ["Home", "End"].includes(event.key))
    ) {
      event.preventDefault();
      if (!buttons.length) return;
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? buttons.length - 1
            : index < 0
              ? event.key === "ArrowUp"
                ? buttons.length - 1
                : 0
              : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) %
                buttons.length;
      buttons[next]?.focus();
    }
  }
  async function send() {
    if (
      operation.current ||
      busy ||
      (!snapshot &&
        (draft.conflict ||
          unavailable.length ||
          (!content.trim() && !files.length)))
    )
      return;
    operation.current = "send";
    setSendAcknowledged(false);
    setPreparing(true);
    setFeedback("");
    setPicker(null);
    let prepared = Boolean(snapshot);
    try {
      if (snapshot) await submission.retry();
      else {
        const ready = await draft.beginSend(draft.content);
        prepared = true;
        await submission.submit(ready);
      }
    } catch (e) {
      draft.failed();
      // Submission errors stay attached to their frozen message, including after navigation.
      if (alive.current && !prepared) reportError((e as Error).message);
    } finally {
      operation.current = null;
      if (alive.current) {
        setPreparing(false);
        restoreInputFocus();
      }
    }
  }
  async function upload(selected: File[]) {
    if (fileInput.current) fileInput.current.value = "";
    if (!selected.length || operation.current || locked) return;
    const available = MAX_ATTACHMENTS - draft.attachmentIds.length;
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
    setSendAcknowledged(false);
    setUploading(true);
    setFeedback("");
    setPicker(null);
    const controller = new AbortController();
    uploadController.current = controller;
    try {
      for (const [index, file] of queue.entries()) {
        if (!alive.current || controller.signal.aborted) break;
        setUploadLabel(
          `${file.name} yükleniyor${queue.length > 1 ? ` (${index + 1}/${queue.length})` : ""}…`,
        );
        const body = new FormData();
        body.append("file", file);
        try {
          const attachment = await api<Attachment>("/uploads", {
            method: "POST",
            headers: { "X-Workspace-Id": workspaceId, "X-User-Id": userId },
            signal: controller.signal,
            body,
          });
          if (alive.current && !controller.signal.aborted)
            draft.updateAttachments((old) => [...old, attachment]);
        } catch (e) {
          if (!controller.signal.aborted)
            errors.push(`${file.name}: ${(e as Error).message}`);
        }
      }
    } finally {
      operation.current = null;
      if (uploadController.current === controller)
        uploadController.current = null;
      if (alive.current) {
        setUploading(false);
        setUploadLabel("");
        if (errors.length) reportError(errors.join(" "));
      }
    }
  }
  function keyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (history.onKeyDown(e)) return;
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
      className={`composer-wrap composer-ux ${direct ? "composer-direct" : ""} ${parentId ? "thread-composer" : ""}`}
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
        if (!operation.current && !locked) setDragging(true);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect =
          operation.current || locked ? "none" : "copy";
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
      <div
        className={`composer ${content.trim() || files.length ? "has-content" : ""} ${dragging ? "is-dragging" : ""} ${busy ? "is-sending" : ""}`}
      >
        {dragging && (
          <div className="composer-drop-zone" role="status">
            <Paperclip size={20} aria-hidden="true" />
            <strong>Dosyaları buraya bırak</strong>
            <span>En fazla 4 dosya, dosya başına 10 MB</span>
          </div>
        )}
        {draft.conflict && !snapshot && (
          <div className="draft-conflict" role="status">
            <p>
              Bu taslak başka bir cihazda değişti. Yazdıkların burada duruyor;
              devam etmek için hangi sürümü kullanacağını seç.
            </p>
            <details>
              <summary>Diğer cihazdaki taslağı göster</summary>
              <pre>
                {mentionPreview(draft.conflict.content, members) ||
                  "(Boş taslak)"}
              </pre>
              {draft.conflict.attachmentIds.length > 0 && (
                <ul className="draft-conflict-files">
                  {draft.conflict.attachmentIds.map((id) => (
                    <li key={id}>
                      {draft.conflict!.attachments.find(
                        (file) => file.id === id,
                      )?.name || "Kullanılamayan dosya"}
                      {draft.conflict!.unavailableAttachmentIds.includes(id)
                        ? " — Dosya kullanılamıyor"
                        : ""}
                    </li>
                  ))}
                </ul>
              )}
            </details>
            <button type="button" onClick={() => resolveDraft(true)}>
              Diğer taslağı kullan
            </button>
            <button type="button" onClick={() => resolveDraft(false)}>
              Buradaki taslağı kullan
            </button>
          </div>
        )}
        {(files.length > 0 || unavailable.length > 0) && (
          <div className="composer-attachments">
            {files.map((f) => (
              <span
                key={f.id}
                title={f.name}
                className={unavailable.includes(f.id) ? "is-unavailable" : ""}
              >
                {unavailable.includes(f.id) ? (
                  <AlertCircle size={14} />
                ) : (
                  <Paperclip size={14} />
                )}
                <span>
                  {f.name}
                  <small>
                    {unavailable.includes(f.id)
                      ? "Dosya kullanılamıyor"
                      : fileSize(f.size)}
                  </small>
                </span>
                <IconButton
                  label={`${f.name} dosyasını kaldır`}
                  disabled={locked || uploading}
                  onClick={() => removeAttachment(f.id)}
                >
                  <X size={14} />
                </IconButton>
              </span>
            ))}
            {unavailable
              .filter((id) => !files.some((file) => file.id === id))
              .map((id) => (
                <span key={id} className="is-unavailable">
                  <AlertCircle size={14} />
                  <span>
                    Kullanılamayan dosya<small>Kaldırıp yeniden ekle</small>
                  </span>
                  <IconButton
                    label="Kullanılamayan dosyayı kaldır"
                    disabled={locked || uploading}
                    onClick={() => removeAttachment(id)}
                  >
                    <X size={14} />
                  </IconButton>
                </span>
              ))}
          </div>
        )}
        {submission.status === "failed" && (
          <div
            id={deliveryId}
            className="composer-feedback composer-delivery is-error"
            role="alert"
          >
            <AlertCircle size={16} aria-hidden="true" />
            <span>
              <strong>{submission.ambiguous ? "Gönderim onayı bekleniyor" : "Mesaj gönderilemedi"}</strong>
              {submission.error}
              {submission.ambiguous && (
                <small>
                  Sonucu doğrulayamadık. Yeniden denediğinde aynı mesaj iki kez
                  gönderilmez.
                </small>
              )}
            </span>
            {submission.canRelease && (
              <button
                type="button"
                className="delivery-release"
                onClick={() => void releaseSubmission()}
              >
                Taslağa dön
              </button>
            )}
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
            parentId
              ? "Yanıtını yaz"
              : direct
                ? `${channelName} kişisine mesaj yaz`
                : `#${channelName} kanalına mesaj yaz`
          }
          aria-describedby={`${hintId}${uploading || feedback ? ` ${feedbackId}` : ""}`}
          placeholder={
            parentId
              ? "Sohbete bir yanıt ekle..."
              : direct
                ? `${channelName} kişisine mesaj yaz…`
                : `#${channelName} kanalına bir şeyler yaz...`
          }
          value={content}
          onChange={(e) => {
            if (history.onChange(e)) return;
            update(
              updateMentionText(
                mentionDocument,
                e.target.value,
                e.target.selectionStart,
              ),
            );
          }}
          onBeforeInput={(event) => history.capture(event.currentTarget)}
          onSelect={(event) => history.capture(event.currentTarget)}
          onFocus={() => setPicker(null)}
          onKeyDown={keyDown}
          onPaste={(event) => {
            const pasted = Array.from(event.clipboardData.files);
            if (!pasted.length) return;
            event.preventDefault();
            void upload(pasted);
          }}
          rows={1}
          disabled={locked}
        />
        <div className="composer-tools">
          <div className="composer-tools-left">
            <IconButton
              label="Dosya ekle"
              onClick={() => fileInput.current?.click()}
              disabled={
                locked ||
                uploading ||
                draft.attachmentIds.length >= MAX_ATTACHMENTS
              }
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
              disabled={locked}
              onClick={() => insert("**", true)}
            >
              <Bold size={17} />
            </IconButton>
            <IconButton
              label="Kod ekle"
              disabled={locked}
              onClick={() => insert("`", true)}
            >
              <Code2 size={19} />
            </IconButton>
            <IconButton
              label="Emoji ekle"
              disabled={locked}
              pressed={picker === "emoji"}
              onClick={() => setPicker(picker === "emoji" ? null : "emoji")}
            >
              <Smile size={19} />
            </IconButton>
            <IconButton
              label="Birinden bahset"
              disabled={locked}
              pressed={picker === "mention"}
              onClick={() => setPicker(picker === "mention" ? null : "mention")}
            >
              <AtSign size={19} />
            </IconButton>
          </div>
          <button
            type="button"
            className={`send-button ${sendAcknowledged ? "is-sent" : ""}`}
            title={
              submission.status === "failed"
                ? "Gönderimi yeniden dene"
                : "Mesaj gönder"
            }
            aria-label={parentId ? "Yanıt gönder" : "Mesaj gönder"}
            aria-describedby={
              submission.status === "failed" ? deliveryId : undefined
            }
            aria-busy={busy}
            onClick={() => void send()}
            disabled={
              busy ||
              uploading ||
              (!snapshot &&
                (Boolean(draft.conflict) ||
                  unavailable.length > 0 ||
                  (!content.trim() && !files.length)))
            }
          >
            {busy ? (
              <LoaderCircle size={17} className="spin" aria-hidden="true" />
            ) : submission.status === "failed" ? (
              <RotateCcw size={17} aria-hidden="true" />
            ) : sendAcknowledged ? (
              <Check size={17} aria-hidden="true" />
            ) : (
              <Send size={17} aria-hidden="true" />
            )}
            <span className="send-button-label" aria-hidden="true">
              <span className={sendAcknowledged ? "is-hidden" : ""}>
                {submission.status === "failed" ? "Yeniden dene" : "Gönder"}
              </span>
              <span className={sendAcknowledged ? "" : "is-hidden"}>
                Gönderildi
              </span>
            </span>
          </button>
        </div>
        {picker && (
          <div
            ref={pickerPanel}
            className={`composer-picker ${picker === "emoji" ? "emoji-picker" : "mention-picker"}`}
            role="group"
            aria-label={picker === "emoji" ? "Emojiler" : "Kanal üyeleri"}
            onKeyDown={navigateMentions}
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
            ) : (
              <>
                <input
                  ref={mentionSearch}
                  type="search"
                  className="mention-search"
                  aria-label="Bahsedilecek kişiyi ara"
                  placeholder="Ad veya unvan ara…"
                  value={mentionQuery}
                  onChange={(event) => setMentionQuery(event.target.value)}
                />
                <div className="mention-options">
                  {matchingMembers.map((member) => (
                    <button
                      key={member.id}
                      type="button"
                      data-picker-option
                      aria-label={`${member.name}, ${member.jobTitle ? `${member.jobTitle}, ` : ""}${member.email}`}
                      onClick={() => insertMention(member)}
                    >
                      <Avatar user={member} size="small" />
                      <span>
                        <strong>{member.name}</strong>
                        <small>
                          {member.jobTitle ? `${member.jobTitle} · ` : ""}
                          {member.email}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
                {!matchingMembers.length && (
                  <p className="composer-picker-empty">
                    {query
                      ? "Bu aramayla eşleşen bir üye yok."
                      : "Bahsedebileceğin bir üye yok."}
                  </p>
                )}
              </>
            )}
          </div>
        )}
        <input
          ref={fileInput}
          type="file"
          multiple
          disabled={
            locked || uploading || draft.attachmentIds.length >= MAX_ATTACHMENTS
          }
          tabIndex={-1}
          className="visually-hidden"
          aria-label="Paylaşılacak dosya"
          accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/csv"
          onChange={(e) => void upload(Array.from(e.target.files || []))}
        />
      </div>
      <span className="visually-hidden" role="status" aria-atomic="true">
        {sendAcknowledged ? "Mesaj gönderildi." : ""}
      </span>
      <div className="composer-hint" id={hintId}>
        <span>
          <kbd>Enter</kbd> ile gönder · <kbd>Shift + Enter</kbd> ile yeni satır
        </span>
        <span className="draft-status" aria-live="polite">
          {snapshot ? (
            submission.status === "failed" ? (
              "Mesajın yeniden denemek için korunuyor"
            ) : (
              "Mesaj gönderiliyor…"
            )
          ) : unavailable.length ? (
            "Göndermeden önce kullanılamayan dosyayı kaldırıp yeniden ekle"
          ) : draft.status === "offline" ? (
            <>
              Taslak bu cihazda ·{" "}
              <button onClick={() => void draft.retry()}>Yeniden dene</button>
            </>
          ) : draft.status === "conflict" ? (
            "Taslak seçimi bekleniyor"
          ) : draft.content.length > 9000 ? (
            `${draft.content.length.toLocaleString("tr-TR")} / 10.000 karakter`
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
