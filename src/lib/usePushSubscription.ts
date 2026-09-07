import { useEffect } from "react";
import { restorePushSubscription } from "./pushSubscription";

export function usePushSubscription(
  userId: string | undefined,
  workspaceId: string | undefined,
  bootstrapRevision: number,
  active: boolean,
) {
  useEffect(() => {
    if (!userId || !active) return;
    let controller: AbortController | undefined;
    const restore = () => {
      controller?.abort();
      controller = new AbortController();
      void restorePushSubscription(userId, controller.signal).catch(() => {
        // Retry after reconnect/focus; explicit settings retain actionable errors.
      });
    };
    restore();
    window.addEventListener("online", restore);
    window.addEventListener("focus", restore);
    return () => {
      controller?.abort();
      window.removeEventListener("online", restore);
      window.removeEventListener("focus", restore);
    };
  }, [userId, workspaceId, bootstrapRevision, active]);
}
