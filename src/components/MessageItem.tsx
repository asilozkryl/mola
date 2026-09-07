import { useState } from "react";
import {
  Bookmark,
  Check,
  Download,
  FileText,
  MessageSquare,
  MoreHorizontal,
  Link,
  Pencil,
  Pin,
  SmilePlus,
  Trash2,
  X,
} from "lucide-react";
import type { Message, User } from "../../shared/types";
import { Avatar, fileSize, IconButton, Modal, RichText, timeLabel } from "./ui";

export function MessageItem({
  message,
  author,
  selfId,
  saved,
  onReply,
  onReact,
  onSave,
  onPin,
  onDelete,
  onEdit,
  compact = false,
  readOnly = false,
  canModerate = false,
  onCopyLink,
}: {
  message: Message;
  author?: User;
  selfId: string;
  saved: boolean;
  onReply: () => void;
  onReact: (emoji: string) => void;
  onSave: () => void;
  onPin: () => void;
  onDelete: () => void;
  onEdit: (content: string) => Promise<void>;
  compact?: boolean;
  readOnly?: boolean;
  canModerate?: boolean;
  onCopyLink: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [reacting, setReacting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [saving, setSaving] = useState(false);
  const authorIsSelf = message.userId === selfId;
  return (
    <article
      className={`message ${compact ? "message-compact" : ""} ${message.pinned ? "message-pinned" : ""}`}
      data-message-id={message.id}
      tabIndex={0}
      aria-label={`${author?.name || "Üye"}: ${message.content.slice(0, 80)}`}
    >
      {message.pinned && (
        <div className="message-pin-label">
          <Pin size={11} /> Bu kanala sabitlendi
        </div>
      )}
      <Avatar user={author} />
      <div className="message-body">
        <div className="message-meta">
          <strong>{author?.name || "Eski üye"}</strong>
          {authorIsSelf && <span className="self-label">sen</span>}
          {author?.isBot && <span className="bot-label">bot</span>}
          <time
            dateTime={message.createdAt}
            title={new Date(message.createdAt).toLocaleString("tr-TR")}
          >
            {timeLabel(message.createdAt)}
          </time>
          {message.editedAt && <small>düzenlendi</small>}
        </div>
        {editing && !readOnly ? (
          <div className="message-edit">
            <textarea
              aria-label="Mesajı düzenle"
              value={draft}
              maxLength={10000}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
            />
            <div>
              <button
                className="secondary-button"
                onClick={() => setEditing(false)}
              >
                Vazgeç
              </button>
              <button
                className="primary-button"
                disabled={saving || !draft.trim()}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await onEdit(draft.trim());
                    setEditing(false);
                  } catch {
                    // The workspace reports the error; keep the edit draft available.
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                <Check size={14} /> Kaydet
              </button>
            </div>
          </div>
        ) : (
          <p className="message-text">
            <RichText content={message.content} />
          </p>
        )}
        {!!message.attachments?.length && (
          <div className="message-files">
            {message.attachments.map((file) => (
              <a
                className="file-attachment"
                key={file.id}
                href={file.url}
                download={file.name}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="file-icon">
                  <FileText size={21} />
                </span>
                <span>
                  <strong>{file.name}</strong>
                  <small>
                    {fileSize(file.size)} ·{" "}
                    {file.mime.split("/")[1]?.toUpperCase()}
                  </small>
                </span>
                <Download size={16} />
              </a>
            ))}
          </div>
        )}
        {!!message.reactions?.length && (
          <div className="message-reactions">
            {message.reactions
              .filter((r) => r.userIds.length)
              .map((r) => (
                <button
                  key={r.emoji}
                  disabled={readOnly}
                  className={r.userIds.includes(selfId) ? "reacted" : ""}
                  onClick={() => onReact(r.emoji)}
                  aria-pressed={r.userIds.includes(selfId)}
                  aria-label={`${r.emoji} tepkisi, ${r.userIds.length} kişi`}
                >
                  {r.emoji}
                  <span>{r.userIds.length}</span>
                </button>
              ))}
            <button
              className="add-reaction"
              aria-label="Tepki ekle"
              disabled={readOnly}
              onClick={() => setReacting(!reacting)}
            >
              <SmilePlus size={15} />
            </button>
          </div>
        )}
        {!compact && message.replyCount > 0 && (
          <button className="thread-preview" onClick={onReply}>
            <MessageSquare size={14} />
            <strong>{message.replyCount} yanıt</strong>
            <span>Sohbeti aç</span>
          </button>
        )}
      </div>
      <div className="message-actions">
        <IconButton label="Mesaj bağlantısını kopyala" onClick={onCopyLink}>
          <Link size={16} />
        </IconButton>
        <IconButton
          label="Tepki ekle"
          disabled={readOnly}
          onClick={() => setReacting(!reacting)}
        >
          <SmilePlus size={16} />
        </IconButton>
        {!compact && (
          <IconButton label="Mesajı yanıtla" onClick={onReply}>
            <MessageSquare size={16} />
          </IconButton>
        )}
        <IconButton
          label={saved ? "Kaydedilenlerden kaldır" : "Mesajı kaydet"}
          onClick={onSave}
          pressed={saved}
        >
          <Bookmark size={16} fill={saved ? "currentColor" : "none"} />
        </IconButton>
        <IconButton
          label="Diğer mesaj işlemleri"
          disabled={readOnly}
          onClick={() => setMenu(!menu)}
        >
          <MoreHorizontal size={17} />
        </IconButton>
      </div>
      {reacting && !readOnly && (
        <div className="reaction-popover">
          {["🙌", "💚", "🔥", "👏", "👍", "👀", "✨", "🎉"].map((emoji) => (
            <button
              key={emoji}
              aria-label={`${emoji} tepkisi ekle`}
              onClick={() => {
                onReact(emoji);
                setReacting(false);
              }}
            >
              {emoji}
            </button>
          ))}
          <IconButton
            label="Tepkileri kapat"
            onClick={() => setReacting(false)}
          >
            <X size={14} />
          </IconButton>
        </div>
      )}
      {menu && !readOnly && (
        <>
          <button
            className="menu-dismiss"
            aria-label="Mesaj menüsünü kapat"
            onClick={() => setMenu(false)}
          />
          <div className="message-menu">
            <button
              onClick={() => {
                onPin();
                setMenu(false);
              }}
            >
              <Pin size={15} />
              {message.pinned ? "Sabitlemeyi kaldır" : "Kanala sabitle"}
            </button>
            {authorIsSelf && (
              <>
                <button
                  onClick={() => {
                    setEditing(true);
                    setDraft(message.content);
                    setMenu(false);
                  }}
                >
                  <Pencil size={15} />
                  Mesajı düzenle
                </button>
              </>
            )}
            {(authorIsSelf || canModerate) && (
              <button
                className="danger-text"
                onClick={() => {
                  setDeleting(true);
                  setMenu(false);
                }}
              >
                <Trash2 size={15} />
                Mesajı sil
              </button>
            )}
          </div>
        </>
      )}
      {deleting && !readOnly && (
        <Modal title="Mesaj silinsin mi?" onClose={() => setDeleting(false)}>
          <p className="modal-description">
            Bu mesaj ve yanıtları kalıcı olarak silinecek.
          </p>
          <blockquote className="delete-preview">{message.content}</blockquote>
          <div className="modal-actions">
            <button
              className="secondary-button"
              onClick={() => setDeleting(false)}
            >
              Vazgeç
            </button>
            <button
              className="danger-button"
              onClick={() => {
                onDelete();
                setDeleting(false);
              }}
            >
              Mesajı sil
            </button>
          </div>
        </Modal>
      )}
    </article>
  );
}
