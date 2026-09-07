interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
let promptEvent: InstallPromptEvent | null = null;
let registration: Promise<ServiceWorkerRegistration | null> | null = null;
let initialized = false;
const installChanged = () =>
  window.dispatchEvent(new Event("mola:install-state"));
export const installedPwa = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
export const canInstallPwa = () => Boolean(promptEvent);
export const supportsPush = () =>
  window.isSecureContext &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;
export function initializePwa() {
  if (initialized) return;
  initialized = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    promptEvent = event as InstallPromptEvent;
    installChanged();
  });
  window.addEventListener("appinstalled", () => {
    promptEvent = null;
    installChanged();
  });
  if (!window.isSecureContext || !("serviceWorker" in navigator)) return;
  registration = navigator.serviceWorker
    .register("/sw.js", { scope: "/", updateViaCache: "none" })
    .catch(() => null);
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (
      event.data?.type !== "mola:notification-open" ||
      typeof event.data.url !== "string"
    )
      return;
    try {
      const url = new URL(event.data.url);
      if (url.origin !== location.origin || url.pathname !== "/") return;
      history.pushState(null, "", `${url.pathname}${url.search}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch {
      /* Ignore malformed worker messages. */
    }
  });
}
export async function pwaRegistration() {
  initializePwa();
  const result = await registration;
  if (!result)
    throw new Error(
      "Bildirim hizmeti başlatılamadı. Sayfayı yenileyip yeniden deneyin.",
    );
  if (result.active) return result;
  let timeout: number | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => {
        timeout = window.setTimeout(
          () =>
            reject(
              new Error(
                "Bildirim hizmeti hazırlanamadı. Sayfayı yenileyip yeniden deneyin.",
              ),
            ),
          15_000,
        );
      }),
    ]);
  } finally {
    window.clearTimeout(timeout);
  }
}
export async function installPwa() {
  if (!promptEvent) return false;
  const pending = promptEvent;
  promptEvent = null;
  installChanged();
  await pending.prompt();
  return (await pending.userChoice).outcome === "accepted";
}
export function applicationKey(value: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}
