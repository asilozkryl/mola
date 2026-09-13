import { useSyncExternalStore } from "react";

export type AppearanceTheme = "light" | "dark" | "system";
export type AppearanceDensity = "compact" | "comfortable";

type Appearance = {
  theme: AppearanceTheme;
  density: AppearanceDensity;
};

export const APPEARANCE_STORAGE_KEY = "mola.appearance.v1";
const defaults: Appearance = { theme: "system", density: "compact" };
let appearance: Appearance = defaults;
let initialized = false;
let systemTheme: MediaQueryList | undefined;
let paletteFrame: number | undefined;
const listeners = new Set<() => void>();

function readAppearance(): Appearance {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(APPEARANCE_STORAGE_KEY) || "null",
    );
    if (!value || typeof value !== "object") return defaults;
    const stored = value as Partial<Appearance>;
    return {
      theme: ["light", "dark", "system"].includes(stored.theme || "")
        ? (stored.theme as AppearanceTheme)
        : defaults.theme,
      density: stored.density === "comfortable" ? "comfortable" : "compact",
    };
  } catch {
    // A blocked or full storage area must not prevent the application opening.
    return defaults;
  }
}

function applyAppearance() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const dark =
    appearance.theme === "dark" ||
    (appearance.theme === "system" && systemTheme?.matches);
  const paletteChanged = root.classList.contains("dark") !== Boolean(dark);
  if (paletteChanged) {
    if (paletteFrame !== undefined) cancelAnimationFrame(paletteFrame);
    root.dataset.appearanceChanging = "true";
    // Cancel any in-flight hover color transitions before replacing the palette.
    // Otherwise inherited text and independently animated surfaces can briefly
    // use opposite themes, including within already-open dialogs.
    root.getBoundingClientRect();
  }
  root.classList.toggle("dark", Boolean(dark));
  root.dataset.theme = appearance.theme;
  root.dataset.density = appearance.density;
  root.style.colorScheme = dark ? "dark" : "light";
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#111b18" : "#153d36");
  if (paletteChanged) {
    // Commit every descendant's new colors together before restoring ordinary
    // interactions. A rapid second choice cancels the previous frame cleanup.
    root.getBoundingClientRect();
    paletteFrame = requestAnimationFrame(() => {
      paletteFrame = requestAnimationFrame(() => {
        delete root.dataset.appearanceChanging;
        paletteFrame = undefined;
      });
    });
  }
}

function publish(next: Appearance) {
  if (appearance.theme === next.theme && appearance.density === next.density)
    return;
  appearance = next;
  applyAppearance();
  listeners.forEach((listener) => listener());
}

/** Call before mounting React so the first rendered frame has the saved appearance. */
export function initializeAppearance() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  appearance = readAppearance();
  if (typeof window.matchMedia === "function") {
    systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
    systemTheme.addEventListener("change", applyAppearance);
  }
  window.addEventListener("storage", (event) => {
    if (event.key === APPEARANCE_STORAGE_KEY || event.key === null)
      publish(readAppearance());
  });
  applyAppearance();
}

function updateAppearance(next: Appearance) {
  initializeAppearance();
  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Continue to honor the choice in this tab when persistence is unavailable.
  }
  publish(next);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const setTheme = (theme: AppearanceTheme) =>
  updateAppearance({ ...appearance, theme });
const setDensity = (density: AppearanceDensity) =>
  updateAppearance({ ...appearance, density });

export function useAppearance() {
  const value = useSyncExternalStore(
    subscribe,
    () => appearance,
    () => defaults,
  );
  return { ...value, setTheme, setDensity };
}
