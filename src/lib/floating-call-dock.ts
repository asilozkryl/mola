export interface DockPoint {
  x: number;
  y: number;
}

export interface DockRect extends DockPoint {
  width: number;
  height: number;
}

export function callDockPosition(
  preferred: DockPoint | null,
  size: { width: number; height: number },
  viewport: DockRect,
  composers: DockRect[] = [],
): DockPoint {
  const right = Math.max(viewport.x, viewport.x + viewport.width - size.width);
  const bottom = Math.max(
    viewport.y,
    viewport.y + viewport.height - size.height,
  );
  const x = Math.max(viewport.x, Math.min(right, preferred?.x ?? right));
  let y = Math.max(viewport.y, Math.min(bottom, preferred?.y ?? bottom));
  for (const composer of composers) {
    if (
      composer.width > 0 &&
      composer.height > 0 &&
      composer.y + composer.height > viewport.y &&
      composer.y < viewport.y + viewport.height &&
      x < composer.x + composer.width &&
      x + size.width > composer.x
    ) {
      y = Math.min(y, composer.y - size.height - 12);
    }
  }
  return { x, y: Math.max(viewport.y, y) };
}
