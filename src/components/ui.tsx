import { useEffect, useRef, type ReactNode } from "react";
import { X, LoaderCircle } from "lucide-react";
import type { User } from "../../shared/types";

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
  user?: Pick<User, "name" | "color">;
  size?: "tiny" | "small" | "normal" | "large";
  online?: boolean;
}) {
  return (
    <span
      className={`avatar avatar-${size}`}
      style={{ background: user?.color || "#dce7d1" }}
      aria-label={user?.name || "Üye"}
    >
      <span>
        {(user?.name || "?")
          .split(" ")
          .map((s) => s[0])
          .slice(0, 2)
          .join("")
          .toLocaleUpperCase("tr")}
      </span>
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
    ref.current?.showModal();
    const dialog = ref.current;
    // React's autoFocus runs before a closed native dialog can receive focus.
    dialog?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      aria-label={title}
      ref={ref}
      className={`modal ${wide ? "modal-wide" : ""}`}
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
export function RichText({ content }: { content: string }) {
  return (
    <>
      {content
        .split(/(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s<>]+|@[\p{L}\w]+)/gu)
        .map((part, i) => {
          if (part.startsWith("**") && part.endsWith("**"))
            return <strong key={i}>{part.slice(2, -2)}</strong>;
          if (part.startsWith("`") && part.endsWith("`"))
            return <code key={i}>{part.slice(1, -1)}</code>;
          if (/^https?:\/\//.test(part))
            return (
              <a key={i} href={part} target="_blank" rel="noopener noreferrer">
                {part}
              </a>
            );
          if (part.startsWith("@"))
            return (
              <span key={i} className="mention">
                {part}
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
