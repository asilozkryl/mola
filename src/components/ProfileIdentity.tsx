import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import type { User } from "../../shared/types";
import { Avatar } from "./ui";
import { Button } from "./ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./ui/hover-card";
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
  const triggerRef = useRef<HTMLElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const restoringFocus = useRef(false);
  const cardId = useId();
  const triggerId = useId();

  function viewProfile() {
    setOpen(false);
    onOpen(user.id);
  }

  useEffect(() => {
    function dismissOther(event: Event) {
      if ((event as CustomEvent<string>).detail !== cardId) setOpen(false);
    }
    window.addEventListener("mola:profile-preview", dismissOther);
    return () =>
      window.removeEventListener("mola:profile-preview", dismissOther);
  }, [cardId]);

  useEffect(() => {
    setOpen(false);
  }, [user.id, selfId]);

  useEffect(() => {
    if (!open) return;
    // Keep the established dismissal on navigation/viewport changes. Base UI
    // owns pointer intent, hover timing, outside clicks, and anchor positioning.
    function scroll(event: Event) {
      if (
        event.target instanceof Node &&
        cardRef.current?.contains(event.target)
      )
        return;
      setOpen(false);
    }
    const resize = () => setOpen(false);
    // Escape belongs to the visible preview, including when focus is still on
    // the underlying call dialog. Prevent the enclosing modal closing as well.
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      if (cardRef.current?.contains(document.activeElement)) {
        restoringFocus.current = true;
        triggerRef.current?.focus({ preventScroll: true });
        restoringFocus.current = false;
      }
    }
    document.addEventListener("scroll", scroll, true);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("scroll", scroll, true);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
    };
  }, [open]);

  // A preview opened inside a modal stays in its focus/aria scope. Floating UI
  // accounts for the transformed containing block rather than using page coords.
  const modal = triggerRef.current?.closest<HTMLElement>(
    'dialog[open], [role="dialog"][aria-modal="true"]',
  );

  return (
    <HoverCard
      open={open}
      triggerId={triggerId}
      onOpenChange={(next, details) => {
        if (next) {
          window.dispatchEvent(
            new CustomEvent("mola:profile-preview", { detail: cardId }),
          );
        } else if (
          details.reason === "escape-key" &&
          cardRef.current?.contains(document.activeElement)
        ) {
          triggerRef.current?.focus({ preventScroll: true });
        }
        setOpen(next);
      }}
    >
      <HoverCardTrigger
        id={triggerId}
        ref={(element: HTMLElement | null) => {
          triggerRef.current = element;
        }}
        delay={300}
        closeDelay={160}
        render={<Button variant="unstyled" size="unset" type="button" />}
        className={`profile-identity ${className}`}
        aria-label={`${user.name} profilini görüntüle`}
        aria-expanded={open}
        aria-controls={open ? cardId : undefined}
        onFocus={(event) => {
          event.preventBaseUIHandler();
          if (restoringFocus.current) return;
          // Base UI previews open only for :focus-visible. Profile identities
          // also support programmatic focus after returning from a profile,
          // regardless of the last input modality, as they did before migration.
          window.dispatchEvent(
            new CustomEvent("mola:profile-preview", { detail: cardId }),
          );
          setOpen(true);
        }}
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
      </HoverCardTrigger>
      <HoverCardContent
        ref={cardRef}
        id={cardId}
        portalContainer={modal}
        collisionBoundary={modal || undefined}
        align="start"
        sideOffset={8}
        className="profile-hover-card"
        role="dialog"
        aria-label={`${user.name} profil kartı`}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          if (event.shiftKey) {
            event.preventDefault();
            event.stopPropagation();
            triggerRef.current?.focus({ preventScroll: true });
            return;
          }
          const scope = modal || document.body;
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
            setOpen(false);
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
        <Button
          variant="unstyled"
          size="unset"
          type="button"
          className="profile-hover-open"
          onClick={viewProfile}
        >
          Profili görüntüle <ArrowUpRight size={15} aria-hidden="true" />
        </Button>
      </HoverCardContent>
    </HoverCard>
  );
}
