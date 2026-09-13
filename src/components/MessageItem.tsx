import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  Bookmark,
  Check,
  Download,
  FileText,
  Eye,
  MessageSquare,
  MoreHorizontal,
  LoaderCircle,
  Link,
  Pencil,
  Pin,
  SmilePlus,
  Trash2,
  X,
} from "lucide-react";
import type { Attachment, Message, User } from "../../shared/types";
import {
  decodeMentions,
  encodeMentions,
  mentionPreview,
  updateMentionText,
} from "../../shared/mentions";
import {
  ContextMenu,
  type ContextMenuItem,
  type ContextMenuPosition,
} from "./ContextMenu";
import { Avatar, fileSize, IconButton, Modal, RichText, timeLabel } from "./ui";
import { ProfileIdentity } from "./ProfileIdentity";
import { useMentionHistory } from "../lib/useMentionHistory";
import "./message-ux.css";
import "./direct-message-item.css";

export function MessageItem({
  message,
  author,
  selfId,
  members,
  saved,
  saveBusy = false,
  onReply,
  onReact,
  onSave,
  onPin,
  onDelete,
  onEdit,
  compact = false,
  grouped = false,
  readOnly = false,
  canModerate = false,
  fresh = false,
  onCopyLink,
  onOpenProfile,
  onOpenFile,
  online = false,
  connected = true,
}: {
  message: Message;
  author?: User;
  selfId: string;
  members: User[];
  saved: boolean;
  saveBusy?: boolean;
  onReply: () => void;
  onReact: (emoji: string) => void;
  onSave: () => void;
  onPin: () => void;
  onDelete: () => void;
  onEdit: (content: string) => Promise<void>;
  compact?: boolean;
  grouped?: boolean;
  readOnly?: boolean;
  canModerate?: boolean;
  fresh?: boolean;
  onCopyLink: () => void;
  onOpenProfile?: (id: string) => void;
  onOpenFile?: (file: Attachment) => void;
  online?: boolean;
  connected?: boolean;
}) {
  const [menu, setMenu] = useState(false);
  const [contextPosition, setContextPosition] =
    useState<ContextMenuPosition | null>(null);
  const [reacting, setReacting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const editDocument = decodeMentions(draft, members);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const editHistory = useMentionHistory(
    draft,
    (content) => {
      setDraft(content);
      setEditError("");
    },
    `${message.id}:${editing}`,
    saving,
  );
  const articleRef = useRef<HTMLElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const savingRef = useRef(false);
  const popupId = useId();
  const editHintId = useId();
  const authorIsSelf = message.userId === selfId;
  const isGrouped = grouped && !compact && !message.pinned;
  const createdAtLabel = new Date(message.createdAt).toLocaleString("tr-TR");
  const reactionSnapshot = (message.reactions || []).map((reaction) => ({
    emoji: reaction.emoji,
    count: reaction.userIds.length,
    pressed: reaction.userIds.includes(selfId),
  }));
  const reactionVersion = JSON.stringify(reactionSnapshot);
  const previousReactions = useRef({
    messageId: message.id,
    reactions: reactionSnapshot,
  });

  useEffect(() => {
    const previous = previousReactions.current;
    previousReactions.current = {
      messageId: message.id,
      reactions: reactionSnapshot,
    };
    if (
      previous.messageId !== message.id ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const changed = new Set(
      reactionSnapshot
        .filter((reaction) => {
          const before = previous.reactions.find(
            (item) => item.emoji === reaction.emoji,
          );
          return (
            !before ||
            before.count !== reaction.count ||
            before.pressed !== reaction.pressed
          );
        })
        .map((reaction) => reaction.emoji),
    );
    const animations = Array.from(
      articleRef.current?.querySelectorAll<HTMLButtonElement>(
        "[data-reaction-emoji]",
      ) || [],
    )
      .filter((button) => changed.has(button.dataset.reactionEmoji || ""))
      .map((button) =>
        button.animate(
          [
            {
              backgroundColor: getComputedStyle(button)
                .getPropertyValue("--accent")
                .trim(),
            },
            { backgroundColor: getComputedStyle(button).backgroundColor },
          ],
          { duration: 260, easing: "ease-out" },
        ),
      );
    return () => animations.forEach((animation) => animation.cancel());
  }, [message.id, reactionVersion]);

  function closePopovers(restoreFocus = false) {
    setMenu(false);
    setReacting(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  function popoverButtons(container: HTMLElement | null) {
    return Array.from(
      container?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ||
        [],
    ).filter((button) => button.getClientRects().length > 0);
  }

  useLayoutEffect(() => {
    if (!menu && !reacting) return;
    function placePopover() {
      const popover = popoverRef.current;
      if (!popover) return;
      let top = 8;
      let bottom = window.innerHeight - 8;
      for (
        let parent = articleRef.current?.parentElement;
        parent;
        parent = parent.parentElement
      ) {
        if (
          !/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)
        )
          continue;
        const bounds = parent.getBoundingClientRect();
        top = Math.max(top, bounds.top + 8);
        bottom = Math.min(bottom, bounds.bottom - 8);
      }
      popover.style.transform = "";
      popover.style.maxHeight = `${Math.max(0, bottom - top)}px`;
      const bounds = popover.getBoundingClientRect();
      const offset = Math.max(
        top - bounds.top,
        Math.min(0, bottom - bounds.bottom),
      );
      popover.style.transform = `translateY(${offset}px)`;
    }
    placePopover();
    window.addEventListener("resize", placePopover);
    return () => window.removeEventListener("resize", placePopover);
  }, [menu, reacting]);

  useEffect(() => {
    if (!menu && !reacting) return;
    popoverButtons(popoverRef.current)[0]?.focus();
    function dismissOutside(event: PointerEvent | FocusEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (popoverRef.current?.contains(target)) return;
      if (
        articleRef.current?.contains(target) &&
        target.closest("[data-message-popup-trigger]")
      )
        return;
      setMenu(false);
      setReacting(false);
    }
    function dismissOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setMenu(false);
      setReacting(false);
      triggerRef.current?.focus();
    }
    function dismissOnScrollIntent(event: Event) {
      if (
        event.target instanceof Node &&
        popoverRef.current?.contains(event.target)
      )
        return;
      setMenu(false);
      setReacting(false);
    }
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape, true);
    document.addEventListener("wheel", dismissOnScrollIntent, true);
    document.addEventListener("touchmove", dismissOnScrollIntent, true);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape, true);
      document.removeEventListener("wheel", dismissOnScrollIntent, true);
      document.removeEventListener("touchmove", dismissOnScrollIntent, true);
    };
  }, [menu, reacting]);

  function navigatePopover(event: KeyboardEvent<HTMLDivElement>) {
    if (
      ![
        "ArrowRight",
        "ArrowLeft",
        "ArrowDown",
        "ArrowUp",
        "Home",
        "End",
      ].includes(event.key)
    )
      return;
    const buttons = popoverButtons(event.currentTarget);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (!buttons.length) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (index +
              (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1) +
              buttons.length) %
            buttons.length;
    buttons[next]?.focus();
  }

  async function saveEdit() {
    if (savingRef.current || !draft.trim() || draft.trim() === message.content)
      return;
    savingRef.current = true;
    setSaving(true);
    setEditError("");
    try {
      await onEdit(draft.trim());
      setEditing(false);
      articleRef.current?.focus();
    } catch {
      setEditError(
        "Değişiklikler kaydedilemedi. Yazdıkların burada; yeniden dene.",
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function cancelEdit() {
    if (savingRef.current) return;
    setEditing(false);
    setEditError("");
    articleRef.current?.focus();
  }

  function startEdit() {
    setEditing(true);
    setDraft(message.content);
    setEditError("");
    closePopovers();
  }

  function openContextMenu(position: ContextMenuPosition) {
    closePopovers();
    triggerRef.current = articleRef.current;
    setContextPosition(position);
  }

  const contextItems: ContextMenuItem[] = [
    {
      label: "Mesaj bağlantısını kopyala",
      icon: <Link size={15} />,
      onSelect: onCopyLink,
    },
    ...(!compact
      ? [
          {
            label: "Mesajı yanıtla",
            icon: <MessageSquare size={15} />,
            onSelect: onReply,
          },
        ]
      : []),
    {
      label: "Tepki ekle",
      icon: <SmilePlus size={15} />,
      disabled: readOnly,
      onSelect: () => setReacting(true),
    },
    {
      label: saved ? "Kaydedilenlerden kaldır" : "Mesajı kaydet",
      icon: saveBusy ? (
        <LoaderCircle size={15} className="spin" />
      ) : (
        <Bookmark size={15} fill={saved ? "currentColor" : "none"} />
      ),
      disabled: saveBusy,
      onSelect: onSave,
    },
    {
      label: message.pinned ? "Sabitlemeyi kaldır" : "Kanala sabitle",
      icon: <Pin size={15} />,
      disabled: readOnly,
      onSelect: onPin,
    },
    ...(authorIsSelf
      ? [
          {
            label: "Mesajı düzenle",
            icon: <Pencil size={15} />,
            disabled: readOnly,
            onSelect: startEdit,
          },
        ]
      : []),
    ...(authorIsSelf || canModerate
      ? [
          {
            label: "Mesajı sil",
            icon: <Trash2 size={15} />,
            disabled: readOnly,
            danger: true,
            separatorBefore: true,
            onSelect: () => setDeleting(true),
          },
        ]
      : []),
  ];

  return (
    <article
      ref={articleRef}
      className={`message ${compact ? "message-compact" : ""} ${message.pinned ? "message-pinned" : ""}`}
      data-message-id={message.id}
      data-fresh={fresh || undefined}
      data-self={authorIsSelf}
      data-grouped={isGrouped}
      tabIndex={0}
      aria-label={`${author?.name || "Üye"}: ${mentionPreview(message.content, members).slice(0, 80)}${isGrouped ? `, ${createdAtLabel}` : ""}`}
      aria-haspopup="menu"
      onContextMenu={(event) => {
        const target = event.target;
        if (
          target instanceof Element &&
          target.closest(
            "a, input, textarea, select, [contenteditable], dialog",
          )
        )
          return;
        const selection = window.getSelection();
        if (
          selection &&
          !selection.isCollapsed &&
          (event.currentTarget.contains(selection.anchorNode) ||
            event.currentTarget.contains(selection.focusNode))
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        openContextMenu({ x: event.clientX, y: event.clientY });
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (
          event.key !== "ContextMenu" &&
          !(event.shiftKey && event.key === "F10")
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        const bounds = event.currentTarget.getBoundingClientRect();
        openContextMenu({ x: bounds.left + 48, y: bounds.top + 32 });
      }}
    >
      <ContextMenu
        position={contextPosition}
        items={contextItems}
        label="Mesaj işlemleri"
        returnFocus={articleRef.current}
        onClose={() => setContextPosition(null)}
      />
      {message.pinned && (
        <div className="message-pin-label">
          <Pin size={11} /> Bu kanala sabitlendi
        </div>
      )}
      {author && !author.suspended && onOpenProfile ? (
        <ProfileIdentity
          user={author}
          online={online}
          connected={connected}
          selfId={selfId}
          onOpen={onOpenProfile}
          className="message-author-avatar"
        >
          <Avatar user={author} />
        </ProfileIdentity>
      ) : (
        <Avatar user={author} />
      )}
      <div className="message-body">
        <div className="message-meta">
          {author && !author.suspended && onOpenProfile ? (
            <ProfileIdentity
              user={author}
              online={online}
              connected={connected}
              selfId={selfId}
              onOpen={onOpenProfile}
              className="message-author-name"
            >
              <strong>{author.name}</strong>
            </ProfileIdentity>
          ) : (
            <strong>{author?.name || "Eski üye"}</strong>
          )}
          {authorIsSelf && <span className="self-label">sen</span>}
          {author?.isBot && <span className="bot-label">bot</span>}
          <time dateTime={message.createdAt} title={createdAtLabel}>
            {timeLabel(message.createdAt)}
          </time>
          {message.editedAt && <small>düzenlendi</small>}
        </div>
        {editing && !readOnly ? (
          <div className="message-edit" aria-busy={saving}>
            <Textarea
              unstyled
              aria-label="Mesajı düzenle"
              aria-describedby={editHintId}
              value={editDocument.text}
              disabled={saving}
              onChange={(e) => {
                if (editHistory.onChange(e)) return;
                const next = encodeMentions(
                  updateMentionText(
                    editDocument,
                    e.target.value,
                    e.target.selectionStart,
                  ),
                );
                if (next.length > 10000) {
                  setEditError(
                    "Mesaj en fazla 10.000 karakter olabilir. Göndermeden önce biraz kısalt.",
                  );
                  return;
                }
                editHistory.record(next, {
                  start: e.target.selectionStart,
                  end: e.target.selectionEnd,
                });
                setDraft(next);
                setEditError("");
              }}
              onBeforeInput={(event) =>
                editHistory.capture(event.currentTarget)
              }
              onSelect={(event) => editHistory.capture(event.currentTarget)}
              onKeyDown={(event) => {
                if (editHistory.onKeyDown(event)) return;
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  cancelEdit();
                } else if (
                  event.key === "Enter" &&
                  (event.ctrlKey || event.metaKey)
                ) {
                  event.preventDefault();
                  void saveEdit();
                }
              }}
              autoFocus
            />
            <p id={editHintId} className="message-edit-hint">
              Ctrl / ⌘ + Enter ile kaydet · Esc ile vazgeç
            </p>
            {editError && (
              <p className="message-edit-error" role="alert">
                {editError}
              </p>
            )}
            <div>
              <Button
                variant="outline"
                size="unset"
                type="submit"
                className="secondary-button"
                disabled={saving}
                onClick={cancelEdit}
              >
                Vazgeç
              </Button>
              <Button
                variant="default"
                size="unset"
                type="submit"
                className="primary-button"
                disabled={
                  saving || !draft.trim() || draft.trim() === message.content
                }
                onClick={() => void saveEdit()}
              >
                <Check size={14} /> {saving ? "Kaydediliyor…" : "Kaydet"}
              </Button>
            </div>
          </div>
        ) : (
          <p className="message-text">
            <RichText content={message.content} members={members} />
          </p>
        )}
        {!!message.attachments?.length && (
          <div className="message-files">
            {message.attachments.map((file) => (
              <div className="message-file-with-preview" key={file.id}>
                <a
                  className="file-attachment"
                  href={file.url}
                  download={file.name}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${file.name} dosyasını indir, ${fileSize(file.size)}`}
                  title={file.name}
                >
                  <span className="file-icon" aria-hidden="true">
                    <FileText size={21} />
                    {/^image\/(png|jpeg|gif|webp)$/.test(file.mime) &&
                      /^\/api\/files\/[^/?#]+$/.test(file.url) && (
                        <img
                          src={file.url}
                          alt=""
                          width={40}
                          height={40}
                          loading="lazy"
                          decoding="async"
                          onError={(event) => {
                            event.currentTarget.hidden = true;
                          }}
                        />
                      )}
                  </span>
                  <span>
                    <strong>{file.name}</strong>
                    <small>
                      {fileSize(file.size)} ·{" "}
                      {file.mime.split("/")[1]?.toUpperCase()} · İndir
                    </small>
                  </span>
                  <Download size={16} />
                </a>
                {onOpenFile && (
                  <Button
                    variant="unstyled"
                    size="unset"
                    type="submit"
                    className="message-file-preview"
                    aria-label={`${file.name} dosyasını önizle`}
                    title="Önizle"
                    onClick={() => onOpenFile(file)}
                  >
                    <Eye size={16} />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
        {!!message.reactions?.length && (
          <div className="message-reactions">
            {message.reactions
              .filter((r) => r.userIds.length)
              .map((r) => (
                <Button
                  variant="unstyled"
                  size="unset"
                  type="submit"
                  key={r.emoji}
                  data-reaction-emoji={r.emoji}
                  disabled={readOnly}
                  className={r.userIds.includes(selfId) ? "reacted" : ""}
                  onClick={() => onReact(r.emoji)}
                  aria-pressed={r.userIds.includes(selfId)}
                  aria-label={`${r.emoji} tepkisi, ${r.userIds.length} kişi`}
                >
                  {r.emoji}
                  <span>{r.userIds.length}</span>
                </Button>
              ))}
            <Button
              variant="unstyled"
              size="unset"
              type="submit"
              className="add-reaction"
              aria-label="Tepki ekle"
              disabled={readOnly}
              data-message-popup-trigger
              aria-expanded={reacting}
              aria-controls={reacting ? popupId : undefined}
              onClick={(event) => {
                triggerRef.current = event.currentTarget;
                setMenu(false);
                setReacting(!reacting);
              }}
            >
              <SmilePlus size={15} />
            </Button>
          </div>
        )}
        {!compact && message.replyCount > 0 && (
          <Button
            variant="unstyled"
            size="unset"
            type="submit"
            className="thread-preview"
            onClick={onReply}
          >
            <MessageSquare size={14} />
            <strong>{message.replyCount} yanıt</strong>
            <span>Sohbeti aç</span>
          </Button>
        )}
      </div>
      <div className="message-actions">
        <IconButton label="Mesaj bağlantısını kopyala" onClick={onCopyLink}>
          <Link size={16} />
        </IconButton>
        <Button
          variant="unstyled"
          size="unset"
          type="button"
          className="icon-button"
          aria-label="Tepki ekle"
          title="Tepki ekle"
          data-message-popup-trigger
          aria-expanded={reacting}
          aria-controls={reacting ? popupId : undefined}
          disabled={readOnly}
          onClick={(event) => {
            triggerRef.current = event.currentTarget;
            setMenu(false);
            setReacting(!reacting);
          }}
        >
          <SmilePlus size={16} />
        </Button>
        {!compact && (
          <IconButton label="Mesajı yanıtla" onClick={onReply}>
            <MessageSquare size={16} />
          </IconButton>
        )}
        <IconButton
          label={saved ? "Kaydedilenlerden kaldır" : "Mesajı kaydet"}
          onClick={onSave}
          pressed={saved}
          disabled={saveBusy}
        >
          {saveBusy ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <Bookmark size={16} fill={saved ? "currentColor" : "none"} />
          )}
        </IconButton>
        <Button
          variant="unstyled"
          size="unset"
          type="button"
          className="icon-button"
          title="Diğer mesaj işlemleri"
          aria-label="Diğer mesaj işlemleri"
          data-message-popup-trigger
          aria-expanded={menu}
          aria-controls={menu ? popupId : undefined}
          onClick={(event) => {
            triggerRef.current = event.currentTarget;
            setReacting(false);
            setMenu(!menu);
          }}
        >
          <MoreHorizontal size={17} />
        </Button>
      </div>
      {reacting && !readOnly && (
        <div
          className="reaction-popover"
          id={popupId}
          ref={popoverRef}
          role="group"
          aria-label="Bir tepki seç"
          onKeyDown={navigatePopover}
        >
          {["🙌", "💚", "🔥", "👏", "👍", "👀", "✨", "🎉"].map((emoji) => (
            <Button
              variant="unstyled"
              size="unset"
              type="submit"
              key={emoji}
              aria-label={`${emoji} tepkisi ekle`}
              onClick={() => {
                onReact(emoji);
                closePopovers(true);
              }}
            >
              {emoji}
            </Button>
          ))}
          <IconButton
            label="Tepkileri kapat"
            onClick={() => closePopovers(true)}
          >
            <X size={14} />
          </IconButton>
        </div>
      )}
      {menu && (
        <>
          <div
            className="message-menu"
            id={popupId}
            ref={popoverRef}
            role="group"
            aria-label="Mesaj işlemleri"
            onKeyDown={navigatePopover}
          >
            <Button
              variant="unstyled"
              size="unset"
              type="submit"
              className="message-touch-action"
              onClick={() => {
                onCopyLink();
                closePopovers(true);
              }}
            >
              <Link size={15} />
              Mesaj bağlantısını kopyala
            </Button>
            <Button
              variant="unstyled"
              size="unset"
              type="submit"
              className="message-touch-action"
              disabled={readOnly}
              onClick={() => {
                setMenu(false);
                setReacting(true);
              }}
            >
              <SmilePlus size={15} />
              Tepki ekle
            </Button>
            {!compact && (
              <Button
                variant="unstyled"
                size="unset"
                type="submit"
                className="message-touch-action"
                onClick={() => {
                  closePopovers(true);
                  onReply();
                }}
              >
                <MessageSquare size={15} />
                Mesajı yanıtla
              </Button>
            )}
            <Button
              variant="unstyled"
              size="unset"
              type="submit"
              className="message-touch-action"
              aria-pressed={saved}
              aria-busy={saveBusy}
              disabled={saveBusy}
              onClick={() => {
                onSave();
                closePopovers(true);
              }}
            >
              {saveBusy ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Bookmark size={15} fill={saved ? "currentColor" : "none"} />
              )}
              {saved ? "Kaydedilenlerden kaldır" : "Mesajı kaydet"}
            </Button>
            <Button
              variant="unstyled"
              size="unset"
              type="submit"
              disabled={readOnly}
              onClick={() => {
                onPin();
                closePopovers(true);
              }}
            >
              <Pin size={15} />
              {message.pinned ? "Sabitlemeyi kaldır" : "Kanala sabitle"}
            </Button>
            {authorIsSelf && (
              <>
                <Button
                  variant="unstyled"
                  size="unset"
                  type="submit"
                  disabled={readOnly}
                  onClick={startEdit}
                >
                  <Pencil size={15} />
                  Mesajı düzenle
                </Button>
              </>
            )}
            {(authorIsSelf || canModerate) && (
              <Button
                variant="unstyled"
                size="unset"
                type="submit"
                className="danger-text"
                disabled={readOnly}
                onClick={() => {
                  setDeleting(true);
                  setMenu(false);
                }}
              >
                <Trash2 size={15} />
                Mesajı sil
              </Button>
            )}
          </div>
        </>
      )}
      {deleting && !readOnly && (
        <Modal title="Mesaj silinsin mi?" onClose={() => setDeleting(false)}>
          <p className="modal-description">
            Bu mesaj ve yanıtları kalıcı olarak silinecek.
          </p>
          <blockquote className="delete-preview">
            {mentionPreview(message.content, members)}
          </blockquote>
          <div className="modal-actions">
            <Button
              variant="outline"
              size="unset"
              type="submit"
              className="secondary-button"
              onClick={() => setDeleting(false)}
            >
              Vazgeç
            </Button>
            <Button
              variant="unstyled"
              size="unset"
              type="submit"
              className="danger-button"
              onClick={() => {
                onDelete();
                setDeleting(false);
              }}
            >
              Mesajı sil
            </Button>
          </div>
        </Modal>
      )}
    </article>
  );
}
