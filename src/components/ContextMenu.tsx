import {
  Fragment,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import "./context-menu.css";

export type ContextMenuPosition = { x: number; y: number };

export type ContextMenuItem = {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
};

export function ContextMenu({
  position,
  items,
  onClose,
  label = "İşlemler",
  returnFocus,
}: {
  position: ContextMenuPosition | null;
  items: ContextMenuItem[];
  onClose: () => void;
  label?: string;
  returnFocus?: HTMLElement | null;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  function focusOrigin() {
    if (previousFocusRef.current?.isConnected)
      previousFocusRef.current.focus({ preventScroll: true });
  }

  function close(restoreFocus = true) {
    if (restoreFocus) focusOrigin();
    closeRef.current();
  }

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!position || !menu) return;
    previousFocusRef.current =
      returnFocus ||
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    const anchorBounds = returnFocus?.getBoundingClientRect();

    function place() {
      if (!menu || !position) return;
      const margin = 8;
      const viewport = window.visualViewport;
      const left = (viewport?.offsetLeft || 0) + margin;
      const top = (viewport?.offsetTop || 0) + margin;
      const width = viewport?.width || window.innerWidth;
      const height = viewport?.height || window.innerHeight;
      menu.style.maxWidth = `${Math.max(0, width - margin * 2)}px`;
      menu.style.maxHeight = `${Math.max(0, height - margin * 2)}px`;
      const bounds = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(left, Math.min(position.x, left + width - margin * 2 - bounds.width))}px`;
      menu.style.top = `${Math.max(top, Math.min(position.y, top + height - margin * 2 - bounds.height))}px`;
    }

    function dismissOutside(event: PointerEvent | FocusEvent) {
      if (event.target instanceof Node && !menu?.contains(event.target))
        closeRef.current();
    }

    function dismissOnScroll(event: Event) {
      if (event.target instanceof Node && menu?.contains(event.target)) return;
      // A conversation can finish scrolling while a sidebar menu opens.
      // Only moving the menu's own anchor makes its position stale.
      const currentBounds = returnFocus?.getBoundingClientRect();
      if (
        anchorBounds &&
        currentBounds &&
        returnFocus?.isConnected &&
        Math.abs(anchorBounds.left - currentBounds.left) < 1 &&
        Math.abs(anchorBounds.top - currentBounds.top) < 1
      )
        return;
      closeRef.current();
    }

    place();
    menu
      .querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus({ preventScroll: true });
    if (!menu.contains(document.activeElement))
      menu.focus({ preventScroll: true });
    const observer = new ResizeObserver(place);
    observer.observe(menu);
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("scroll", dismissOnScroll, true);
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("scroll", dismissOnScroll, true);
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
      // Preserve a newly focused control or modal when the action opens one.
      if (menu.contains(document.activeElement)) focusOrigin();
    };
  }, [position?.x, position?.y, returnFocus]);

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "Tab") {
      event.stopPropagation();
      close();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ),
    );
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
            buttons.length;
    buttons[next]?.focus();
  }

  if (!position) return null;

  return createPortal(
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      aria-label={label}
      tabIndex={-1}
      style={{ left: position.x, top: position.y }}
      onKeyDown={navigate}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {items.map((item) => (
        <Fragment key={item.label}>
          {item.separatorBefore && (
            <div className="context-menu-separator" role="separator" />
          )}
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={item.danger ? "context-menu-danger" : undefined}
            disabled={item.disabled}
            onClick={(event) => {
              event.stopPropagation();
              close();
              item.onSelect();
            }}
          >
            {item.icon && <span aria-hidden="true">{item.icon}</span>}
            {item.label}
          </button>
        </Fragment>
      ))}
    </div>,
    returnFocus?.closest('dialog[open], [role="dialog"][aria-modal="true"]') ||
      document.body,
  );
}
