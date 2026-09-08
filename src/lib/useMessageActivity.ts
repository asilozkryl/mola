import { useCallback, useEffect, useRef, useState } from "react";

/** Transient cues for received events, never for fetched conversation history. */
export function useMessageActivity(scope: string) {
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    setFreshIds(new Set());
    setPendingIds(new Set());
    const activeTimers = timers.current;
    return () => {
      activeTimers.forEach(clearTimeout);
      activeTimers.clear();
    };
  }, [scope]);

  const received = useCallback((id: string, pending = false) => {
    if (!timers.current.has(id)) {
      setFreshIds((old) => new Set(old).add(id));
      timers.current.set(
        id,
        setTimeout(() => {
          timers.current.delete(id);
          setFreshIds((old) => {
            const next = new Set(old);
            next.delete(id);
            return next;
          });
        }, 1800),
      );
    }
    if (pending) setPendingIds((old) => new Set(old).add(id));
  }, []);

  const clearPending = useCallback(() => {
    setPendingIds((old) => (old.size ? new Set() : old));
  }, []);

  const forget = useCallback((id: string) => {
    setPendingIds((old) => {
      if (!old.has(id)) return old;
      const next = new Set(old);
      next.delete(id);
      return next;
    });
  }, []);

  return {
    freshIds,
    pendingCount: pendingIds.size,
    received,
    clearPending,
    forget,
  };
}

export function messageScrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
}
