import type { NotificationPreferences } from "../../shared/collaboration-types";
import { api } from "./api";
import { pwaRegistration, supportsPush } from "./pwa";

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

export async function savePushSubscription(
  subscription: PushSubscription,
  preferences: PushPreferences,
  options: { signal?: AbortSignal; restore?: boolean } = {},
) {
  const value = subscription.toJSON();
  if (!value.endpoint || !value.keys?.p256dh || !value.keys?.auth)
    throw new Error("Tarayıcı bildirim bilgilerini hazırlayamadı. Yeniden deneyin.");
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
export async function restorePushSubscription(userId: string, signal: AbortSignal) {
  if (signal.aborted || !supportsPush() || Notification.permission !== "granted") return;
  const preferences = await loadPushPreferences(userId, signal);
  if (signal.aborted || preferences.userId !== userId || !preferences.pushEnabled) return;
  const service = await pwaRegistration();
  if (signal.aborted) return;
  const subscription = await service.pushManager.getSubscription();
  if (signal.aborted || !subscription || Notification.permission !== "granted") return;
  await savePushSubscription(subscription, preferences, { signal, restore: true });
}
