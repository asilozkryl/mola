import {
  playMolaNotificationSound,
  stopMolaNotificationSound,
} from "./notificationSound";

export interface DesktopNotificationPreferences {
  enabled: boolean;
  sound: boolean;
}
export const isDesktopRuntime = () => /Electron\//i.test(navigator.userAgent);
export const desktopNotificationsSupported = () =>
  isDesktopRuntime() && "Notification" in window;
const key = (userId: string) => `mola:desktop-notifications:${userId}`;

export function readDesktopNotificationPreferences(
  userId: string,
): DesktopNotificationPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(key(userId)) || "{}");
    return { enabled: value?.enabled === true, sound: value?.sound !== false };
  } catch {
    return { enabled: false, sound: true };
  }
}

export function saveDesktopNotificationPreferences(
  userId: string,
  value: DesktopNotificationPreferences,
) {
  try {
    localStorage.setItem(
      key(userId),
      JSON.stringify({ enabled: value.enabled, sound: value.sound }),
    );
  } catch {
    throw new Error(
      "Bildirim tercihi bu cihaza kaydedilemedi. Depolama alanını kontrol edip yeniden dene.",
    );
  }
  if (!value.enabled) clearDesktopNotifications();
  else if (!value.sound) stopMolaNotificationSound();
  window.dispatchEvent(new Event("mola:desktop-notification-preferences"));
}

const pending = new Map<Notification, () => void>();
const recent = new Set<string>();
let lastNotificationAt = 0;
const idPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function clearDesktopNotifications() {
  for (const [notification, cancel] of pending) {
    cancel();
    notification.close();
  }
  pending.clear();
  stopMolaNotificationSound();
}

/** Attention comes from the server after channel/quiet-hours policy checks. */
export async function showDesktopNotification(
  userId: string,
  target: { workspaceId: string; messageId?: string },
  options: { test?: boolean; current?: () => boolean } = {},
): Promise<boolean> {
  const preferences = readDesktopNotificationPreferences(userId);
  const current = options.current ?? (() => true);
  if (
    !desktopNotificationsSupported() ||
    !preferences.enabled ||
    Notification.permission !== "granted" ||
    !current()
  )
    return false;
  if (
    !idPattern.test(target.workspaceId) ||
    (target.messageId && !idPattern.test(target.messageId))
  )
    return false;
  const eventKey = `${userId}:${target.workspaceId}:${target.messageId}`;
  if (!options.test) {
    if (!target.messageId || recent.has(eventKey)) return false;
    recent.add(eventKey);
    if (recent.size > 300) recent.delete(recent.values().next().value!);
    // Coalesce a burst into one alert; unread counts still update for every message.
    if (Date.now() - lastNotificationAt < 2000) return false;
    lastNotificationAt = Date.now();
  }
  const notification = new Notification("Mola", {
    body: options.test
      ? "Mola bildirimlerin hazır. Ekibinden gelen mesajlar burada görünecek."
      : "Yeni bir mesajın var.",
    icon: "/icons/mola-192.png",
    tag: options.test ? "mola-desktop-test" : `mola:${target.messageId}`,
    silent: true,
  });
  const url = new URL("/", location.origin);
  url.searchParams.set("workspace", target.workspaceId);
  if (target.messageId) url.searchParams.set("message", target.messageId);
  notification.onclick = () => {
    notification.close();
    if (!current() || !readDesktopNotificationPreferences(userId).enabled)
      return;
    window.open("mola-desktop://app/notification-focus", "_blank");
    window.focus();
    if (!options.test) {
      history.pushState(null, "", `${url.pathname}${url.search}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  };
  return new Promise<boolean>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (error?: Error, sent = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        pending.delete(notification);
        notification.onshow = null;
        notification.onclick = null;
        notification.onerror = null;
        notification.onclose = null;
        notification.close();
        reject(error);
      } else resolve(sent);
    };
    const cancel = () => {
      pending.delete(notification);
      notification.onshow = null;
      notification.onclick = null;
      notification.onerror = null;
      notification.onclose = null;
      finish();
    };
    pending.set(notification, cancel);
    notification.onclose = cancel;
    notification.onerror = () =>
      finish(
        new Error(
          "Masaüstü bildirimi gönderilemedi. Sistem bildirim ayarlarında Mola için izinleri kontrol et.",
        ),
      );
    notification.onshow = () => {
      if (settled) return;
      if (!current() || !readDesktopNotificationPreferences(userId).enabled) {
        cancel();
        notification.close();
        return;
      }
      if (readDesktopNotificationPreferences(userId).sound)
        void playMolaNotificationSound().catch(() => {});
      finish(undefined, true);
    };
    timer = setTimeout(
      () =>
        finish(
          new Error(
            "Sistem bildirimi doğrulanamadı. Sistem bildirim ayarlarında Mola için izinleri kontrol et.",
          ),
        ),
      8000,
    );
    if (pending.size > 20) {
      const [oldest, cancelOldest] = pending.entries().next().value!;
      cancelOldest();
      oldest.close();
    }
  });
}
