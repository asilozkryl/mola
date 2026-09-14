import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import type {
  WorkspaceMembership,
  WorkspaceOrderState,
} from "../../shared/types";
import { api, ApiError } from "./api";

type Context = {
  userId: string;
  alive: boolean;
  saving: boolean;
  loads: number;
  remote: WorkspaceOrderState | null;
  deferred: WorkspaceOrderState | null;
  controllers: Set<AbortController>;
};
type View = {
  userId: string;
  ids: string[];
  loading: boolean;
  saving: boolean;
  error: string;
};
const initial = (userId: string): View => ({
  userId,
  ids: [],
  loading: true,
  saving: false,
  error: "",
});

export function useWorkspaceOrder(
  userId: string | undefined,
  workspaces: WorkspaceMembership[],
  socket: Socket | null,
) {
  const identity = useRef(userId);
  identity.current = userId;
  const context = useRef<Context | null>(null);
  const members = useRef(workspaces);
  members.current = workspaces;
  const [view, setView] = useState<View>(() => initial(userId || ""));
  const active = (state: Context) =>
    state.alive &&
    context.current === state &&
    identity.current === state.userId;
  const show = (state: Context, patch: Partial<View>) => {
    if (active(state))
      setView((old) => ({
        ...(old.userId === state.userId ? old : initial(state.userId)),
        ...patch,
      }));
  };
  const headers = (state: Context) => ({
    "X-User-Id": state.userId,
    "X-Workspace-Id": "",
  });
  const receive = (state: Context, next: WorkspaceOrderState) => {
    if (
      !active(state) ||
      next.userId !== state.userId ||
      (state.remote && next.revision < state.remote.revision)
    )
      return;
    if (state.saving) {
      if (!state.deferred || next.revision >= state.deferred.revision)
        state.deferred = next;
      return;
    }
    state.remote = next;
    show(state, { ids: next.workspaceIds, loading: false });
  };
  const load = useCallback(async (state: Context, preserveError = false) => {
    const sequence = ++state.loads;
    const controller = new AbortController();
    state.controllers.add(controller);
    try {
      const next = await api<WorkspaceOrderState>("/workspace-order", {
        headers: headers(state),
        signal: controller.signal,
      });
      if (active(state) && sequence === state.loads) {
        receive(state, next);
        if (!preserveError) show(state, { error: "" });
        return true;
      }
    } catch (error) {
      if (
        active(state) &&
        sequence === state.loads &&
        !controller.signal.aborted
      )
        show(state, {
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : "Çalışma alanı sırası yüklenemedi.",
        });
    } finally {
      state.controllers.delete(controller);
    }
    return false;
  }, []);
  useEffect(() => {
    if (!userId) {
      context.current = null;
      return;
    }
    const state: Context = {
      userId,
      alive: true,
      saving: false,
      loads: 0,
      remote: null,
      deferred: null,
      controllers: new Set(),
    };
    context.current = state;
    setView(initial(userId));
    void load(state);
    return () => {
      state.alive = false;
      state.controllers.forEach((controller) => controller.abort());
    };
  }, [userId, load]);
  const membershipKey = workspaces
    .map((item) => item.id)
    .sort()
    .join("\n");
  useEffect(() => {
    const state = context.current;
    if (state && active(state)) void load(state);
  }, [membershipKey, load]);
  useEffect(() => {
    if (!socket) return;
    const refresh = () => {
      const state = context.current;
      if (state && active(state)) void load(state);
    };
    const update = (next: WorkspaceOrderState) => {
      const state = context.current;
      if (state) receive(state, next);
    };
    socket.on("workspace-order:updated", update);
    socket.on("connect", refresh);
    if (socket.connected) refresh();
    return () => {
      socket.off("workspace-order:updated", update);
      socket.off("connect", refresh);
    };
  }, [socket, userId, load]);

  async function reorder(ids: string[]) {
    const state = context.current;
    if (!state || !active(state) || state.saving || !state.remote) return false;
    const available = new Set(members.current.map((item) => item.id));
    if (
      ids.length !== available.size ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !available.has(id))
    )
      return false;
    state.saving = true;
    state.loads++;
    const before = state.remote;
    show(state, { ids, saving: true, error: "" });
    const controller = new AbortController();
    state.controllers.add(controller);
    try {
      const next = await api<WorkspaceOrderState>("/workspace-order", {
        method: "PUT",
        headers: headers(state),
        signal: controller.signal,
        body: JSON.stringify({ revision: before.revision, workspaceIds: ids }),
      });
      if (!active(state)) return false;
      state.saving = false;
      receive(state, next);
      if (state.deferred) receive(state, state.deferred);
      state.deferred = null;
      show(state, { saving: false });
      return true;
    } catch (error) {
      if (!active(state) || controller.signal.aborted) return false;
      // Keep writes locked until recovery has a confirmed server revision.
      show(state, {
        ids: before.workspaceIds,
        saving: true,
        error:
          error instanceof ApiError &&
          error.code === "WORKSPACE_ORDER_REVISION_CONFLICT"
            ? "Sıralama başka bir cihazda değişti. Güncel sırayı kontrol edip tekrar deneyebilirsin."
            : error instanceof Error
              ? error.message
              : "Sıralama kaydedilemedi. Tekrar deneyebilirsin.",
      });
      const recovered = await load(state, true);
      if (!active(state)) return false;
      state.saving = false;
      if (state.deferred) receive(state, state.deferred);
      else if (!recovered) state.remote = null;
      state.deferred = null;
      show(state, { saving: false });
      return false;
    } finally {
      state.controllers.delete(controller);
    }
  }
  const current = view.userId === userId ? view : initial(userId || "");
  const positions = new Map(current.ids.map((id, index) => [id, index]));
  return {
    items: [...workspaces].sort(
      (a, b) =>
        (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity),
    ),
    loading: current.loading,
    saving: current.saving,
    error: current.error,
    canReorder:
      Boolean(
        context.current && active(context.current) && context.current.remote,
      ) &&
      !current.loading &&
      !current.saving,
    reorder,
    refresh: () => {
      const state = context.current;
      if (state && active(state)) void load(state);
    },
  };
}
