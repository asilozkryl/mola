import { useRef, useState, type ReactNode } from "react";
import { X, LoaderCircle } from "lucide-react";
import { MENTION_TOKEN_SOURCE, mentionPreview } from "../../shared/mentions";
import type { User } from "../../shared/types";
import { Button } from "./ui/button";
import {
  Avatar as AvatarPrimitive,
  AvatarFallback,
  AvatarImage,
} from "./ui/avatar";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "./ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import "./avatar.css";
import "./overlays.css";

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
  return (
    <AvatarPrimitive
      className={`avatar avatar-${size}`}
      style={{ background: user?.color || "#dce7d1" }}
      aria-label={user?.name || "Üye"}
    >
      {user?.avatarUrl && (
        <AvatarImage src={user.avatarUrl} alt="" decoding="async" />
      )}
      <AvatarFallback className="mola-avatar-fallback">
        {(user?.name || "?")
          .split(" ")
          .map((s) => s[0])
          .slice(0, 2)
          .join("")
          .toLocaleUpperCase("tr")}
      </AvatarFallback>
      {online && (
        <i className="presence-dot" role="img" aria-label="Çevrimiçi" />
      )}
    </AvatarPrimitive>
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
    <Tooltip>
      <TooltipTrigger
        disabled={disabled}
        render={
          <Button
            type="button"
            variant="unstyled"
            size="unset"
            aria-label={label}
            aria-pressed={pressed}
            className={`icon-button ${className}`}
            onClick={onClick}
            disabled={disabled}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent className="mola-tooltip">{label}</TooltipContent>
    </Tooltip>
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
  const popup = useRef<HTMLDivElement>(null);
  const [opener] = useState(() =>
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  return (
    <Dialog
      open
      onOpenChange={(open, details) => {
        if (!open) {
          // A rejected close (for example a dirty profile) leaves this
          // controlled dialog open while its confirmation is presented.
          if (details.reason === "escape-key") details.event.stopPropagation();
          onClose();
        }
      }}
    >
      <DialogContent
        ref={popup}
        aria-label={title}
        className={`modal mola-dialog ${wide ? "modal-wide" : ""}`}
        overlayClassName="mola-dialog-backdrop"
        showCloseButton={false}
        initialFocus={() =>
          popup.current?.querySelector<HTMLElement>("[data-autofocus]") || true
        }
        finalFocus={() => {
          if (
            !opener?.isConnected ||
            opener.closest("[inert], [hidden]") ||
            !opener.getClientRects().length ||
            getComputedStyle(opener).visibility === "hidden"
          )
            return false;
          // Closing one surface can immediately open another. Do not move
          // focus behind the new active modal in that case.
          const competingModal = [
            ...document.querySelectorAll<HTMLElement>(
              'dialog[open], [role="dialog"][aria-modal="true"]',
            ),
          ].some(
            (modal) =>
              modal !== popup.current &&
              !modal.contains(opener) &&
              modal.getClientRects().length > 0 &&
              !modal.closest('[aria-hidden="true"]'),
          );
          return competingModal ? false : opener;
        }}
        onKeyDown={(event) => {
          // Base UI owns dismissal and focus trapping. Keep application
          // shortcuts from also handling keys from the active modal.
          if (event.key === "Escape") event.stopPropagation();
        }}
        onBlurCapture={(event) => {
          const next = event.relatedTarget;
          if (
            next instanceof HTMLElement &&
            !next.hasAttribute("data-base-ui-focus-guard") &&
            next.closest('[aria-hidden="true"], [inert]') &&
            !event.currentTarget.hasAttribute("data-nested-dialog-open")
          ) {
            // Background shortcuts and delayed composer effects may request
            // focus programmatically. Keep the current control in the modal.
            (event.target as HTMLElement).focus({ preventScroll: true });
          }
        }}
      >
        <div className="modal-heading">
          <DialogTitle>{title}</DialogTitle>
          <DialogClose
            render={
              <Button
                variant="unstyled"
                size="unset"
                type="button"
                className="icon-button"
                aria-label="Kapat"
              />
            }
          >
            <X size={19} />
          </DialogClose>
        </div>
        {children}
      </DialogContent>
    </Dialog>
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
