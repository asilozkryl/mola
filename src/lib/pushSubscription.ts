import type { NotificationPreferences } from "../../shared/collaboration-types";
import { api } from "./api";
import { applicationKey, pwaRegistration, supportsPush } from "./pwa";
import { isDesktopRuntime } from "./desktopNotifications";

export interface PushPreferences extends NotificationPreferences {
  publicKey: string;
  userId: string;
  sessionBinding: string;
}

export const pushContextHeaders = (preferences: PushPreferences) => ({
  "X-User-Id": preferences.userId,
  "X-Push-Session": preferences.sessionBinding,
});

export const loadPushPreferences = (userId: string, signal?: AbortSignal) =>
  api<PushPreferences>("/notifications/preferences", {
    headers: { "X-User-Id": userId },
    signal,
  });

export function pushConfigured(preferences: PushPreferences | null) {
  try {
    const key = applicationKey(preferences?.publicKey || "");
    return key.length === 65 && key[0] === 4;
  } catch {
    return false;
  }
}

/** An endpoint created with a previous server key cannot receive current pushes. */
export function pushKeyMatches(
  subscription: PushSubscription,
  preferences: PushPreferences,
) {
  const existing = subscription.options?.applicationServerKey;
  if (!existing) return true;
  const expected = applicationKey(preferences.publicKey);
  const actual = new Uint8Array(existing);
  return (
    actual.length === expected.length &&
    actual.every((byte, index) => byte === expected[index])
  );
}

export async function savePushSubscription(
  subscription: PushSubscription,
  preferences: PushPreferences,
  options: { signal?: AbortSignal; restore?: boolean } = {},
) {
  if (!pushConfigured(preferences))
    throw new Error(
      "Bildirim hizmeti şu anda hazır değil. Daha sonra yeniden deneyebilirsin.",
    );
  if (!pushKeyMatches(subscription, preferences))
    throw new Error(
      "Bu tarayıcıdaki bildirim kaydı eski. Site ayarlarından Mola'nın bildirim iznini sıfırlayıp yeniden açabilirsin.",
    );
  const value = subscription.toJSON();
  if (!value.endpoint || !value.keys?.p256dh || !value.keys?.auth)
    throw new Error(
      "Tarayıcı bildirim bilgilerini hazırlayamadı. Yeniden deneyin.",
    );
  await api("/notifications/subscriptions", {
    method: "POST",
    headers: pushContextHeaders(preferences),
    signal: options.signal,
    body: JSON.stringify({
      endpoint: value.endpoint,
      keys: value.keys,
      ...(options.restore ? { restore: true } : {}),
    }),
  });
}

/** Restore an existing consent only; permission and subscribe remain button actions. */
export async function restorePushSubscription(
  userId: string,
  signal: AbortSignal,
) {
  if (
    signal.aborted ||
    isDesktopRuntime() ||
    !supportsPush() ||
    Notification.permission !== "granted"
  )
    return;
  const preferences = await loadPushPreferences(userId, signal);
  if (
    signal.aborted ||
    preferences.userId !== userId ||
    !preferences.pushEnabled ||
    !pushConfigured(preferences)
  )
    return;
  const service = await pwaRegistration();
  if (signal.aborted) return;
  const subscription = await service.pushManager.getSubscription();
  if (
    signal.aborted ||
    !subscription ||
    Notification.permission !== "granted" ||
    !pushKeyMatches(subscription, preferences)
  )
    return;
  await savePushSubscription(subscription, preferences, {
    signal,
    restore: true,
  });
}
