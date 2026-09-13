import {
  Fragment,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "./ui/dropdown-menu";
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

type ContextMenuProps = {
  position: ContextMenuPosition | null;
  items: ContextMenuItem[];
  onClose: () => void;
  label?: string;
  returnFocus?: HTMLElement | null;
};

export function ContextMenu(props: ContextMenuProps) {
  if (!props.position) return null;
  return (
    <OpenContextMenu
      key={`${props.position.x}:${props.position.y}`}
      {...props}
      position={props.position}
    />
  );
}

function OpenContextMenu({
  position,
  items,
  onClose,
  label = "İşlemler",
  returnFocus,
}: ContextMenuProps & { position: ContextMenuPosition }) {
  const [menu, setMenu] = useState<HTMLDivElement | null>(null);
  const [origin] = useState(
    () =>
      returnFocus ||
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null),
  );
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const restoreFocus = useRef(true);
  const anchor = useMemo(
    () => ({
      getBoundingClientRect: () => new DOMRect(position.x, position.y, 0, 0),
    }),
    [position.x, position.y],
  );

  function focusOrigin() {
    if (origin?.isConnected) origin.focus({ preventScroll: true });
  }

  useLayoutEffect(() => {
    if (!menu) return;
    const anchorBounds = returnFocus?.getBoundingClientRect();
    // Imperative Shift+F10 and row actions focus the same first item as a trigger.
    const frame = requestAnimationFrame(() => {
      menu
        .querySelector<HTMLElement>('[role="menuitem"]:not([data-disabled])')
        ?.focus({ preventScroll: true });
    });
    function dismissOnScroll(event: Event) {
      if (event.target instanceof Node && menu?.contains(event.target)) return;
      const currentBounds = returnFocus?.getBoundingClientRect();
      // Scrolling a different pane must not dismiss a sidebar or message menu.
      if (
        anchorBounds &&
        currentBounds &&
        returnFocus?.isConnected &&
        Math.abs(anchorBounds.left - currentBounds.left) < 1 &&
        Math.abs(anchorBounds.top - currentBounds.top) < 1
      )
        return;
      restoreFocus.current = false;
      closeRef.current();
    }
    document.addEventListener("scroll", dismissOnScroll, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("scroll", dismissOnScroll, true);
    };
  }, [menu, returnFocus]);

  return (
    <DropdownMenu
      open
      modal={false}
      loopFocus
      onOpenChange={(open, details) => {
        if (open) return;
        restoreFocus.current = !["outside-press", "focus-out"].includes(
          details.reason,
        );
        if (details.reason === "escape-key") details.event.stopPropagation();
        closeRef.current();
      }}
    >
      <DropdownMenuContent
        ref={setMenu}
        className="context-menu"
        aria-label={label}
        align="start"
        side="bottom"
        sideOffset={0}
        portalContainer={
          origin?.closest<HTMLElement>(
            'dialog[open], [role="dialog"][aria-modal="true"]',
          ) || undefined
        }
        positionerProps={{
          anchor,
          positionMethod: "fixed",
          sticky: true,
          collisionPadding: 8,
          collisionAvoidance: { side: "shift", align: "shift" },
          className: "context-menu-positioner",
        }}
        finalFocus={() =>
          restoreFocus.current && origin?.isConnected ? origin : false
        }
        onKeyDown={(event) => {
          if (event.key === "Escape") event.stopPropagation();
          if (event.key === "Tab") {
            event.stopPropagation();
            focusOrigin();
            closeRef.current();
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {items.map((item) => (
          <Fragment key={item.label}>
            {item.separatorBefore && (
              <DropdownMenuSeparator className="context-menu-separator" />
            )}
            <DropdownMenuItem
              render={<button type="button" />}
              nativeButton
              label={item.label}
              variant={item.danger ? "destructive" : "default"}
              className={item.danger ? "context-menu-danger" : undefined}
              disabled={item.disabled}
              closeOnClick={false}
              onClick={(event) => {
                event.stopPropagation();
                // Selection closes this imperative menu. Prevent the library's
                // later click handler from refocusing the disappearing item
                // after we restore the opener or mount an action's dialog.
                event.preventBaseUIHandler();
                // Let an action's editor or dialog take over without menu cleanup
                // stealing focus back to the opening row.
                restoreFocus.current = false;
                focusOrigin();
                closeRef.current();
                item.onSelect();
              }}
            >
              {item.icon && <span aria-hidden="true">{item.icon}</span>}
              {item.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
