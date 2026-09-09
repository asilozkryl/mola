import { useEffect, useRef, useState, type ReactNode } from "react";
import { X, LoaderCircle } from "lucide-react";
import { MENTION_TOKEN_SOURCE, mentionPreview } from "../../shared/mentions";
import type { User } from "../../shared/types";
import "./avatar.css";

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={`logo ${small ? "logo-small" : ""}`} aria-label="Mola">
      <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <path
          d="M7 30V17.5a6.5 6.5 0 0 1 13 0V30m0-12.5a6.5 6.5 0 0 1 13 0V30"
          stroke="currentColor"
          strokeWidth="5.5"
          strokeLinecap="round"
        />
      </svg>
      {!small && (
        <span>
          mola<span className="logo-period">.</span>
        </span>
      )}
    </span>
  );
}
export function Avatar({
  user,
  size = "normal",
  online = false,
}: {
  user?: Pick<User, "name" | "color"> & { avatarUrl?: string };
  size?: "tiny" | "small" | "normal" | "large";
  online?: boolean;
}) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const photo =
    user?.avatarUrl && user.avatarUrl !== failedUrl
      ? user.avatarUrl
      : undefined;
  return (
    <span
      className={`avatar avatar-${size}`}
      style={{ background: user?.color || "#dce7d1" }}
      aria-label={user?.name || "Üye"}
    >
      {photo ? (
        <img
          src={photo}
          alt=""
          decoding="async"
          onError={() => setFailedUrl(photo)}
        />
      ) : (
        <span>
          {(user?.name || "?")
            .split(" ")
            .map((s) => s[0])
            .slice(0, 2)
            .join("")
            .toLocaleUpperCase("tr")}
        </span>
      )}
      {online && (
        <i className="presence-dot" role="img" aria-label="Çevrimiçi" />
      )}
    </span>
  );
}
export function IconButton({
  label,
  children,
  onClick,
  className = "",
  disabled = false,
  pressed,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      className={`icon-button ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const opener = document.activeElement;
    ref.current?.showModal();
    const dialog = ref.current;
    // React's autoFocus runs before a closed native dialog can receive focus.
    dialog?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => {
      dialog?.close();
      requestAnimationFrame(() => {
        if (
          opener instanceof HTMLElement &&
          opener.isConnected &&
          !opener.closest("[inert], [hidden]") &&
          opener.getClientRects().length > 0 &&
          getComputedStyle(opener).visibility !== "hidden" &&
          ![
            ...document.querySelectorAll<HTMLElement>(
              'dialog[open], [role="dialog"][aria-modal="true"]',
            ),
          ].some(
            (modal) =>
              modal !== dialog &&
              !modal.contains(opener) &&
              modal.getClientRects().length > 0,
          )
        )
          opener.focus({ preventScroll: true });
      });
    };
  }, []);
  return (
    <dialog
      aria-label={title}
      ref={ref}
      className={`modal ${wide ? "modal-wide" : ""}`}
      onKeyDown={(event) => {
        if (
          event.defaultPrevented ||
          (event.target instanceof Element &&
            event.target.closest("dialog[open]") !== event.currentTarget)
        )
          return;
        if (event.key === "Escape") {
          // The native cancel event closes this dialog; parent shortcuts
          // must not also close the drawer or conversation underneath it.
          event.stopPropagation();
          return;
        }
        if (event.key !== "Tab") return;
        const dialog = event.currentTarget;
        const items = [
          ...dialog.querySelectorAll<HTMLElement>(
            'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]',
          ),
        ].filter(
          (element) =>
            (element.tabIndex >= 0 ||
              (element.isContentEditable &&
                !element.hasAttribute("tabindex"))) &&
            !element.matches(":disabled") &&
            !element.closest("[inert]") &&
            element.getClientRects().length > 0 &&
            getComputedStyle(element).visibility !== "hidden",
        );
        const first = items[0],
          last = items.at(-1);
        // Native dialogs can send boundary Tab presses to browser chrome.
        // Keep keyboard navigation in the active application dialog.
        if (
          !first ||
          (event.shiftKey
            ? document.activeElement === first
            : document.activeElement === last)
        ) {
          event.preventDefault();
          (event.shiftKey ? last || dialog : first || dialog).focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <IconButton label="Kapat" onClick={onClose}>
          <X size={19} />
        </IconButton>
      </div>
      {children}
    </dialog>
  );
}
export function Spinner({ label = "Yükleniyor" }: { label?: string }) {
  return (
    <span className="loading-inline" role="status">
      <LoaderCircle size={18} className="spin" />
      {label}
    </span>
  );
}
export function RichText({
  content,
  members = [],
}: {
  content: string;
  members?: Pick<User, "id" | "name">[];
}) {
  return (
    <>
      {content
        .split(
          new RegExp(
            `(\\*\\*[^*]+\\*\\*|\x60[^\x60]+\x60|https?:\\/\\/[^\\s<>]+|${MENTION_TOKEN_SOURCE}|@[\\p{L}\\w]+)`,
            "giu",
          ),
        )
        .map((part, i) => {
          if (part.startsWith("**") && part.endsWith("**"))
            return (
              <strong key={i}>
                {mentionPreview(part.slice(2, -2), members)}
              </strong>
            );
          if (part.startsWith("`") && part.endsWith("`"))
            return (
              <code key={i}>{mentionPreview(part.slice(1, -1), members)}</code>
            );
          if (/^https?:\/\//.test(part))
            return (
              <a key={i} href={part} target="_blank" rel="noopener noreferrer">
                {mentionPreview(part, members)}
              </a>
            );
          if (part.startsWith("@"))
            return (
              <span key={i} className="mention">
                {mentionPreview(part, members)}
              </span>
            );
          return part;
        })}
    </>
  );
}
export function timeLabel(date: string) {
  return new Date(date).toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
export function dateLabel(date: string) {
  const d = new Date(date);
  if (d.toDateString() === new Date().toDateString()) return "Bugün";
  return d.toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
    year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}
export function fileSize(size: number) {
  return size < 1024 * 1024
    ? `${Math.max(1, Math.round(size / 1024))} KB`
    : `${(size / 1024 / 1024).toFixed(1)} MB`;
}
