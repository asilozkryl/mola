import {
  useId,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  callDockPosition,
  type DockPoint,
  type DockRect,
} from "./floating-call-dock";

export function useFloatingCallDock(callId: string | null, visible: boolean) {
  const boundaryRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const instructionsId = useId();
  const activeCall = useRef(callId);
  const preferred = useRef<DockPoint | null>(null);
  const current = useRef<DockPoint>({ x: 0, y: 0 });
  const drag = useRef<{
    pointerId: number;
    origin: DockPoint;
    pointer: DockPoint;
  } | null>(null);
  const update = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    if (activeCall.current !== callId) {
      activeCall.current = callId;
      preferred.current = null;
    }
    if (!visible) return;
    const boundary = boundaryRef.current;
    const dock = dockRef.current;
    if (!boundary || !dock) return;
    const viewport = window.visualViewport;
    const observed = new Set<Element>();
    let frame = 0;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    const resize = new ResizeObserver(schedule);
    const place = () => {
      frame = 0;
      // A visual viewport can shrink independently when the mobile keyboard opens.
      boundary.style.left = `${viewport?.offsetLeft || 0}px`;
      boundary.style.top = `${viewport?.offsetTop || 0}px`;
      boundary.style.width = `${viewport?.width || window.innerWidth}px`;
      boundary.style.height = `${viewport?.height || window.innerHeight}px`;
      const padding = getComputedStyle(boundary);
      const left = parseFloat(padding.paddingLeft) || 0;
      const top = parseFloat(padding.paddingTop) || 0;
      const bounds: DockRect = {
        x: left,
        y: top,
        width: Math.max(
          0,
          boundary.clientWidth - left - (parseFloat(padding.paddingRight) || 0),
        ),
        height: Math.max(
          0,
          boundary.clientHeight -
            top -
            (parseFloat(padding.paddingBottom) || 0),
        ),
      };
      dock.style.maxWidth = `${bounds.width}px`;
      dock.style.maxHeight = `${bounds.height}px`;
      const boundaryRect = boundary.getBoundingClientRect();
      const composers: DockRect[] = [];
      const nextObserved = new Set<Element>([boundary, dock]);
      for (const element of document.querySelectorAll<HTMLElement>(
        ".composer-wrap",
      )) {
        nextObserved.add(element);
        const rect = element.getBoundingClientRect();
        if (
          rect.width &&
          rect.height &&
          getComputedStyle(element).visibility !== "hidden"
        ) {
          composers.push({
            x: rect.left - boundaryRect.left,
            y: rect.top - boundaryRect.top,
            width: rect.width,
            height: rect.height,
          });
        }
      }
      for (const element of nextObserved) {
        if (!observed.has(element)) resize.observe(element);
      }
      for (const element of observed) {
        if (!nextObserved.has(element)) resize.unobserve(element);
      }
      observed.clear();
      nextObserved.forEach((element) => observed.add(element));
      const rect = dock.getBoundingClientRect();
      current.current = callDockPosition(
        preferred.current,
        rect,
        bounds,
        composers,
      );
      dock.style.left = `${current.current.x}px`;
      dock.style.top = `${current.current.y}px`;
      dock.dataset.positioned = "true";
    };
    update.current = place;
    // New conversations can replace their composer without resizing the old one.
    const changes = new MutationObserver((records) => {
      if (records.some((record) => !boundary.contains(record.target)))
        schedule();
    });
    changes.observe(document.querySelector(".app-shell") || document.body, {
      childList: true,
      subtree: true,
    });
    place();
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      changes.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      update.current = () => {};
      drag.current = null;
    };
  }, [callId, visible]);

  const finishDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (dockRef.current) delete dockRef.current.dataset.dragging;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return {
    boundaryRef,
    dockRef,
    instructionsId,
    handleProps: {
      onPointerDown(event: PointerEvent<HTMLButtonElement>) {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        drag.current = {
          pointerId: event.pointerId,
          origin: current.current,
          pointer: { x: event.clientX, y: event.clientY },
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        if (dockRef.current) dockRef.current.dataset.dragging = "true";
      },
      onPointerMove(event: PointerEvent<HTMLButtonElement>) {
        const gesture = drag.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        preferred.current = {
          x: gesture.origin.x + event.clientX - gesture.pointer.x,
          y: gesture.origin.y + event.clientY - gesture.pointer.y,
        };
        update.current();
      },
      onPointerUp: finishDrag,
      onPointerCancel: finishDrag,
      onLostPointerCapture: finishDrag,
      onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
        if (
          !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(
            event.key,
          )
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Home") preferred.current = null;
        else {
          const step = event.shiftKey ? 40 : 10;
          preferred.current = {
            x:
              current.current.x +
              (event.key === "ArrowLeft"
                ? -step
                : event.key === "ArrowRight"
                  ? step
                  : 0),
            y:
              current.current.y +
              (event.key === "ArrowUp"
                ? -step
                : event.key === "ArrowDown"
                  ? step
                  : 0),
          };
        }
        update.current();
      },
    },
  };
}
