import { useEffect, useRef, useState } from "react";

const mobileQuery = "(max-width: 800px)";
const focusableSelector =
  'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]';

export function useMobileNavigation(
  open: boolean,
  setOpen: (open: boolean) => void,
) {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(setOpen);
  closeRef.current = setOpen;
  const [isMobile, setIsMobile] = useState(
    () =>
      typeof window !== "undefined" && window.matchMedia(mobileQuery).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(mobileQuery);
    const update = () => {
      setIsMobile(media.matches);
      if (!media.matches) closeRef.current(false);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!open || !isMobile) return;
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    const previousFocus = document.activeElement;
    const focusableItems = () =>
      [...sidebar.querySelectorAll<HTMLElement>(focusableSelector)].filter(
        (element) =>
          element.tabIndex >= 0 &&
          !element.matches(":disabled") &&
          !element.closest("[inert]") &&
          element.getClientRects().length > 0 &&
          getComputedStyle(element).visibility !== "hidden",
      );
    const otherModalOpen = () =>
      [
        ...document.querySelectorAll<HTMLElement>(
          'dialog[open], [role="dialog"][aria-modal="true"]',
        ),
      ].some(
        (element) =>
          element !== sidebar &&
          !sidebar.contains(element) &&
          element.getClientRects().length > 0,
      );

    // Let the newly visible drawer receive its styles before moving focus.
    const initialFocusFrame = window.requestAnimationFrame(() => {
      if (!otherModalOpen())
        (focusableItems()[0] || sidebar).focus({ preventScroll: true });
    });

    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || otherModalOpen()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusableItems();
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!first) {
        event.preventDefault();
        sidebar.focus({ preventScroll: true });
      } else if (
        event.shiftKey &&
        (active === first || !items.includes(active as HTMLElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (active === last || !sidebar.contains(active))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      window.cancelAnimationFrame(initialFocusFrame);
      document.removeEventListener("keydown", handleKey);
      if (otherModalOpen()) return;
      const target = triggerRef.current || previousFocus;
      if (
        target instanceof HTMLElement &&
        target.isConnected &&
        !target.closest("[inert]") &&
        target.getClientRects().length > 0 &&
        getComputedStyle(target).visibility !== "hidden"
      )
        target.focus({ preventScroll: true });
    };
  }, [open, isMobile]);

  return { isMobile, sidebarRef, triggerRef };
}
