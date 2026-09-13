interface ViewportInput {
  mobile: boolean;
  layoutHeight: number;
  visualHeight?: number;
  visualOffsetTop?: number;
  scale?: number;
  focused?: boolean;
}

export function mobileViewportMetrics(input: ViewportInput): {
  height: number;
  top: number;
  keyboard: boolean;
} | null {
  if (
    !input.mobile ||
    (input.scale !== undefined && input.scale !== 1) ||
    !Number.isFinite(input.layoutHeight) ||
    input.layoutHeight <= 0
  )
    return null;
  const visualHeight = input.visualHeight;
  const height = Math.min(
    input.layoutHeight,
    visualHeight && Number.isFinite(visualHeight) && visualHeight > 0
      ? visualHeight
      : input.layoutHeight,
  );
  const offset = input.visualOffsetTop || 0;
  const top = Number.isFinite(offset)
    ? Math.max(0, Math.min(offset, input.layoutHeight - height))
    : 0;
  return {
    height,
    top,
    keyboard: Boolean(input.focused && input.layoutHeight - height > 100),
  };
}

export function initializeMobileViewport() {
  const root = document.documentElement;
  const media = window.matchMedia("(max-width: 800px), (pointer: coarse)");
  const viewport = window.visualViewport;
  let frame = 0;
  const clear = () => {
    delete root.dataset.mobileViewport;
    delete root.dataset.mobileKeyboard;
    delete root.dataset.mobileCompact;
    delete root.dataset.mobileShort;
    root.style.removeProperty("--mola-viewport-height");
    root.style.removeProperty("--mola-viewport-top");
  };
  const update = () => {
    frame = 0;
    if (!media.matches) {
      clear();
      return;
    }
    const active = document.activeElement;
    const focused = Boolean(
      active instanceof HTMLElement &&
      (active.matches(
        "textarea, input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]):not([type=color])",
      ) ||
        active.isContentEditable),
    );
    const metrics = mobileViewportMetrics({
      mobile: true,
      layoutHeight: Math.max(window.innerHeight, root.clientHeight),
      visualHeight: viewport?.height,
      visualOffsetTop: viewport?.offsetTop,
      scale: viewport?.scale,
      focused,
    });
    // Keep the unzoomed layout stable while the user pinches or pans it.
    if (!metrics) return;
    root.dataset.mobileViewport = "true";
    root.dataset.mobileKeyboard = String(metrics.keyboard);
    // Native keyboard guides resize both viewports together. Compact genuinely
    // short screens without guessing keyboard state or discarding safe insets.
    root.dataset.mobileCompact = String(
      metrics.height <= 320 || (metrics.keyboard && metrics.height <= 500),
    );
    root.dataset.mobileShort = String(metrics.height <= 200);
    root.style.setProperty("--mola-viewport-height", `${metrics.height}px`);
    root.style.setProperty("--mola-viewport-top", `${metrics.top}px`);
  };
  const schedule = () => {
    if (!frame) frame = window.requestAnimationFrame(update);
  };
  update();
  media.addEventListener("change", schedule);
  window.addEventListener("resize", schedule);
  window.addEventListener("orientationchange", schedule);
  window.addEventListener("pageshow", schedule);
  document.addEventListener("focusin", schedule);
  document.addEventListener("focusout", schedule);
  viewport?.addEventListener("resize", schedule);
  viewport?.addEventListener("scroll", schedule);
  return () => {
    window.cancelAnimationFrame(frame);
    media.removeEventListener("change", schedule);
    window.removeEventListener("resize", schedule);
    window.removeEventListener("orientationchange", schedule);
    window.removeEventListener("pageshow", schedule);
    document.removeEventListener("focusin", schedule);
    document.removeEventListener("focusout", schedule);
    viewport?.removeEventListener("resize", schedule);
    viewport?.removeEventListener("scroll", schedule);
    clear();
  };
}
