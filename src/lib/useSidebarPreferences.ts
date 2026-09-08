import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import type { Channel } from "../../shared/types";
import {
  normalizeSidebarPreferences,
  type SidebarConversation,
  type SidebarConversationsState,
  type SidebarOrder,
  type SidebarPreferences,
  type SidebarPreferencesState,
  type SidebarSection,
} from "../../shared/sidebar";
import { api, ApiError } from "./api";

type Options = {
  userId?: string;
  workspaceId?: string;
  channels: Channel[];
  socket?: Socket | null;
  enabled?: boolean;
};
type Context = {
  scope: string;
  userId: string;
  workspaceId: string;
  alive: boolean;
  saving: boolean;
  remote: SidebarPreferencesState | null;
  deferred: SidebarPreferencesState | null;
  loads: number;
  conversationLoads: number;
  controllers: Set<AbortController>;
};
type View = {
  scope: string;
  preferences: SidebarPreferences;
  loading: boolean;
  saving: boolean;
  error: string;
  conversations: SidebarConversation[];
  conversationsLoading: boolean;
  conversationsError: string;
};
const emptyView = (scope: string): View => ({
  scope,
  preferences: normalizeSidebarPreferences({}, []),
  loading: true,
  saving: false,
  error: "",
  conversations: [],
  conversationsLoading: true,
  conversationsError: "",
});

export function useSidebarPreferences({
  userId,
  workspaceId,
  channels,
  socket,
  enabled = true,
}: Options) {
  const scope =
    enabled && userId && workspaceId ? `${userId}:${workspaceId}` : "";
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const channelsRef = useRef(channels);
  channelsRef.current = channels;
  const context = useRef<Context | null>(null);
  const [view, setView] = useState<View>(() => emptyView(scope));

  const active = (state: Context) =>
    state.alive &&
    context.current === state &&
    currentScope.current === state.scope;
  const show = (state: Context, patch: Partial<View>) => {
    if (active(state))
      setView((old) => ({
        ...(old.scope === state.scope ? old : emptyView(state.scope)),
        ...patch,
      }));
  };
  const headers = (state: Context) => ({
    "X-User-Id": state.userId,
    "X-Workspace-Id": state.workspaceId,
  });
  const matches = (
    state: Context,
    next: { userId: string; workspaceId: string },
  ) => next.userId === state.userId && next.workspaceId === state.workspaceId;
  const receive = (state: Context, next: SidebarPreferencesState) => {
    if (
      !active(state) ||
      !matches(state, next) ||
      (state.remote && next.revision < state.remote.revision)
    )
      return;
    if (state.saving) {
      if (!state.deferred || next.revision >= state.deferred.revision)
        state.deferred = next;
      return;
    }
    state.remote = next;
    show(state, {
      preferences: normalizeSidebarPreferences(
        next.preferences,
        channelsRef.current,
      ),
      loading: false,
    });
  };

  const loadPreferences = useCallback(
    async (state: Context, preserveError = false) => {
      const sequence = ++state.loads;
      const controller = new AbortController();
      state.controllers.add(controller);
      try {
        const next = await api<SidebarPreferencesState>(
          "/sidebar-preferences",
          {
            headers: headers(state),
            signal: controller.signal,
          },
        );
        if (active(state) && sequence === state.loads && matches(state, next)) {
          receive(state, next);
          if (!preserveError) show(state, { error: "" });
        }
      } catch (error) {
        if (
          active(state) &&
          sequence === state.loads &&
          !controller.signal.aborted
        )
          show(state, { error: (error as Error).message, loading: false });
      } finally {
        state.controllers.delete(controller);
      }
    },
    [],
  );
  const loadConversations = useCallback(async (state: Context) => {
    const sequence = ++state.conversationLoads;
    const controller = new AbortController();
    state.controllers.add(controller);
    try {
      const next = await api<SidebarConversationsState>(
        "/sidebar-conversations",
        { headers: headers(state), signal: controller.signal },
      );
      if (
        active(state) &&
        sequence === state.conversationLoads &&
        matches(state, next)
      )
        show(state, {
          conversations: next.conversations,
          conversationsLoading: false,
          conversationsError: "",
        });
    } catch (error) {
      if (
        active(state) &&
        sequence === state.conversationLoads &&
        !controller.signal.aborted
      )
        show(state, {
          conversationsLoading: false,
          conversationsError: (error as Error).message,
        });
    } finally {
      state.controllers.delete(controller);
    }
  }, []);
  const reload = useCallback(async () => {
    const state = context.current;
    if (!state || !active(state)) return;
    await Promise.all([loadPreferences(state), loadConversations(state)]);
  }, [loadPreferences, loadConversations]);

  useEffect(() => {
    if (!scope || !userId || !workspaceId) {
      context.current = null;
      setView({
        ...emptyView(""),
        loading: false,
        conversationsLoading: false,
      });
      return;
    }
    const state: Context = {
      scope,
      userId,
      workspaceId,
      alive: true,
      saving: false,
      remote: null,
      deferred: null,
      loads: 0,
      conversationLoads: 0,
      controllers: new Set(),
    };
    context.current = state;
    setView(emptyView(scope));
    void loadPreferences(state);
    void loadConversations(state);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      void loadPreferences(state);
      void loadConversations(state);
    };
    const refreshConversations = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void loadConversations(state), 180);
    };
    const updated = (next: SidebarPreferencesState) => receive(state, next);
    socket?.on("sidebar:updated", updated);
    socket?.on("connect", refresh);
    socket?.on("message:created", refreshConversations);
    socket?.on("message:updated", refreshConversations);
    socket?.on("message:deleted", refreshConversations);
    socket?.on("draft:changed", refreshConversations);
    socket?.on("channel:created", refresh);
    socket?.on("admin:refresh", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("mola:admin-refresh", refresh);
    return () => {
      state.alive = false;
      clearTimeout(timer);
      for (const controller of state.controllers) controller.abort();
      socket?.off("sidebar:updated", updated);
      socket?.off("connect", refresh);
      socket?.off("message:created", refreshConversations);
      socket?.off("message:updated", refreshConversations);
      socket?.off("message:deleted", refreshConversations);
      socket?.off("draft:changed", refreshConversations);
      socket?.off("channel:created", refresh);
      socket?.off("admin:refresh", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("mola:admin-refresh", refresh);
    };
  }, [scope, userId, workspaceId, socket, loadPreferences, loadConversations]);

  const update = useCallback(
    async (
      change: (current: SidebarPreferences) => SidebarPreferences,
    ): Promise<boolean> => {
      const state = context.current;
      if (!state || !active(state) || !state.remote || state.saving)
        return false;
      const next = normalizeSidebarPreferences(
        change(
          normalizeSidebarPreferences(
            state.remote.preferences,
            channelsRef.current,
          ),
        ),
        channelsRef.current,
      );
      state.saving = true;
      state.deferred = null;
      show(state, { preferences: next, saving: true, error: "" });
      const controller = new AbortController();
      state.controllers.add(controller);
      try {
        const saved = await api<SidebarPreferencesState>(
          "/sidebar-preferences",
          {
            method: "PATCH",
            headers: headers(state),
            signal: controller.signal,
            body: JSON.stringify({
              revision: state.remote.revision,
              preferences: next,
            }),
          },
        );
        if (!active(state) || !matches(state, saved)) return false;
        state.saving = false;
        const deferred = state.deferred as SidebarPreferencesState | null;
        receive(
          state,
          deferred && deferred.revision > saved.revision ? deferred : saved,
        );
        show(state, { saving: false });
        return true;
      } catch (error) {
        if (!active(state) || controller.signal.aborted) return false;
        state.saving = false;
        if (state.deferred) receive(state, state.deferred);
        else if (state.remote) receive(state, state.remote);
        show(state, { saving: false, error: (error as Error).message });
        if (
          error instanceof ApiError &&
          (error.code === "SIDEBAR_REVISION_CONFLICT" || error.status === 404)
        )
          await loadPreferences(state, true);
        return false;
      } finally {
        state.controllers.delete(controller);
      }
    },
    [loadPreferences],
  );
  const setOrder = useCallback(
    (section: SidebarOrder, ids: string[]) =>
      update((preferences) => ({
        ...preferences,
        [section === "text"
          ? "textOrder"
          : section === "voice"
            ? "voiceOrder"
            : "favoriteIds"]: ids,
      })),
    [update],
  );
  const toggleFavorite = useCallback(
    (id: string) =>
      update((preferences) => ({
        ...preferences,
        favoriteIds: preferences.favoriteIds.includes(id)
          ? preferences.favoriteIds.filter((candidate) => candidate !== id)
          : [...preferences.favoriteIds, id],
      })),
    [update],
  );
  const toggleSection = useCallback(
    (section: SidebarSection) =>
      update((preferences) => ({
        ...preferences,
        collapsedSections: preferences.collapsedSections.includes(section)
          ? preferences.collapsedSections.filter(
              (candidate) => candidate !== section,
            )
          : [...preferences.collapsedSections, section],
      })),
    [update],
  );
  const setWidth = useCallback(
    (width: number) => update((preferences) => ({ ...preferences, width })),
    [update],
  );

  const current = view.scope === scope ? view : emptyView(scope);
  const preferences = normalizeSidebarPreferences(
    current.preferences,
    channels,
  );
  const byId = new Map(channels.map((channel) => [channel.id, channel]));
  const resolve = (ids: string[]) =>
    ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  return {
    preferences,
    orderedTextChannels: resolve(preferences.textOrder),
    orderedVoiceChannels: resolve(preferences.voiceOrder),
    favoriteChannels: resolve(preferences.favoriteIds),
    conversations: current.conversations.filter(
      (item) =>
        byId.get(item.channelId)?.kind === "dm" &&
        !byId.get(item.channelId)?.archived,
    ),
    loading: current.loading,
    saving: current.saving,
    error: current.error,
    conversationsLoading: current.conversationsLoading,
    conversationsError: current.conversationsError,
    setOrder,
    toggleFavorite,
    toggleSection,
    setWidth,
    reload,
  };
}
