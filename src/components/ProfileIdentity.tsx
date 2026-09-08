import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight } from "lucide-react";
import type { User } from "../../shared/types";
import { Avatar } from "./ui";
import "./profile-identity.css";

export function profileRoleLabel(user: User) {
  if (user.isBot) return "Bot";
  return {
    owner: "Çalışma alanı sahibi",
    admin: "Yönetici",
    moderator: "Moderatör",
    member: "Üye",
    guest: "Misafir",
  }[user.role];
}

export function ProfilePresence({
  online,
  connected = true,
}: {
  online: boolean;
  connected?: boolean;
}) {
  return (
    <span className="profile-presence" data-online={connected && online}>
      <i aria-hidden="true" />
      {!connected ? "Bağlantı bekleniyor" : online ? "Çevrimiçi" : "Çevrimdışı"}
    </span>
  );
}

export function ProfileIdentity({
  user,
  online,
  connected = true,
  selfId,
  onOpen,
  children,
  className = "",
}: {
  user: User;
  online: boolean;
  connected?: boolean;
  selfId: string;
  onOpen: (id: string) => void;
  children?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const skipFocus = useRef(false);
  const cardId = useId();

  function clearTimers() {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
  }

  function reveal(immediate = false) {
    clearTimers();
    const show = () => {
      window.dispatchEvent(
        new CustomEvent("mola:profile-preview", { detail: cardId }),
      );
      setOpen(true);
    };
    if (immediate) show();
    else openTimer.current = setTimeout(show, 300);
  }

  function close() {
    clearTimers();
    setOpen(false);
  }

  function scheduleClose() {
    clearTimers();
    closeTimer.current = setTimeout(() => {
      if (
        triggerRef.current === document.activeElement ||
        cardRef.current?.contains(document.activeElement)
      )
        return;
      setOpen(false);
    }, 160);
  }

  function viewProfile() {
    close();
    onOpen(user.id);
  }

  useEffect(() => {
    function dismissOther(event: Event) {
      if ((event as CustomEvent<string>).detail !== cardId) close();
    }
    window.addEventListener("mola:profile-preview", dismissOther);
    return () => {
      clearTimers();
      window.removeEventListener("mola:profile-preview", dismissOther);
    };
  }, [cardId, user.id, selfId]);

  useEffect(() => {
    close();
  }, [user.id, selfId]);

  useLayoutEffect(() => {
    if (!open) return;
    const card = cardRef.current;
    const trigger = triggerRef.current;
    if (!card || !trigger) return;

    function place() {
      if (!card || !trigger) return;
      const viewport = window.visualViewport;
      const margin = 10;
      const left = (viewport?.offsetLeft || 0) + margin;
      const top = (viewport?.offsetTop || 0) + margin;
      const width = (viewport?.width || window.innerWidth) - margin * 2;
      const height = (viewport?.height || window.innerHeight) - margin * 2;
      card.style.maxWidth = `${Math.max(0, width)}px`;
      card.style.maxHeight = `${Math.max(0, height)}px`;
      const target = trigger.getBoundingClientRect();
      const bounds = card.getBoundingClientRect();
      const below = target.bottom + 8;
      const preferredTop =
        below + bounds.height > top + height
          ? target.top - bounds.height - 8
          : below;
      card.style.left = `${Math.max(left, Math.min(target.left, left + width - bounds.width))}px`;
      card.style.top = `${Math.max(top, Math.min(preferredTop, top + height - bounds.height))}px`;
      card.style.visibility = "visible";
    }

    function outside(event: PointerEvent | FocusEvent) {
      if (
        event.target instanceof Node &&
        !trigger?.contains(event.target) &&
        !card?.contains(event.target)
      )
        close();
    }

    function escape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (card?.contains(document.activeElement)) {
        skipFocus.current = true;
        trigger?.focus({ preventScroll: true });
      }
      close();
    }

    function scroll(event: Event) {
      if (event.target instanceof Node && card?.contains(event.target)) return;
      close();
    }

    place();
    const observer = new ResizeObserver(place);
    observer.observe(card);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape, true);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", close);
    window.visualViewport?.addEventListener("resize", close);
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape, true);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", close);
      window.visualViewport?.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`profile-identity ${className}`}
        aria-label={`${user.name} profilini görüntüle`}
        aria-expanded={open}
        aria-controls={open ? cardId : undefined}
        onPointerEnter={(event) => {
          if (event.pointerType !== "touch") reveal();
        }}
        onPointerLeave={scheduleClose}
        onFocus={() => {
          if (skipFocus.current) skipFocus.current = false;
          else reveal(true);
        }}
        onBlur={scheduleClose}
        onClick={(event) => {
          event.stopPropagation();
          viewProfile();
        }}
        onKeyDown={(event) => {
          if (event.key === "Tab" && !event.shiftKey && open) {
            const action =
              cardRef.current?.querySelector<HTMLButtonElement>("button");
            if (action) {
              event.preventDefault();
              event.stopPropagation();
              action.focus();
            }
          }
        }}
      >
        {children || <Avatar user={user} online={connected && online} />}
      </button>
      {open &&
        createPortal(
          <div
            ref={cardRef}
            id={cardId}
            className="profile-hover-card"
            role="dialog"
            aria-label={`${user.name} profil kartı`}
            onPointerEnter={clearTimers}
            onPointerLeave={scheduleClose}
            onFocus={clearTimers}
            onBlur={scheduleClose}
            onKeyDown={(event) => {
              if (event.key !== "Tab") return;
              if (event.shiftKey) {
                event.preventDefault();
                event.stopPropagation();
                triggerRef.current?.focus({ preventScroll: true });
                return;
              }
              const scope =
                triggerRef.current?.closest(
                  'dialog[open], [role="dialog"][aria-modal="true"]',
                ) || document.body;
              const focusable = Array.from(
                scope.querySelectorAll<HTMLElement>(
                  'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
                ),
              ).filter(
                (element) =>
                  !cardRef.current?.contains(element) &&
                  !element.closest('[inert], [hidden], [aria-hidden="true"]') &&
                  element.getClientRects().length > 0,
              );
              const index = focusable.indexOf(triggerRef.current!);
              const next = focusable[index + 1];
              if (index >= 0 && next) {
                event.preventDefault();
                event.stopPropagation();
                close();
                next.focus();
              }
            }}
          >
            <div className="profile-hover-heading">
              <Avatar user={user} online={connected && online} />
              <div>
                <strong>
                  {user.name}
                  {user.id === selfId && <small>Sen</small>}
                </strong>
                <span>{user.jobTitle || profileRoleLabel(user)}</span>
              </div>
            </div>
            <div className="profile-hover-presence">
              <ProfilePresence online={online} connected={connected} />
              {user.status && (
                <span className="profile-hover-status">{user.status}</span>
              )}
            </div>
            {user.bio && <p className="profile-hover-bio">{user.bio}</p>}
            <button
              type="button"
              className="profile-hover-open"
              onClick={viewProfile}
            >
              Profili görüntüle <ArrowUpRight size={15} aria-hidden="true" />
            </button>
          </div>,
          triggerRef.current?.closest(
            'dialog[open], [role="dialog"][aria-modal="true"]',
          ) || document.body,
        )}
    </>
  );
}
