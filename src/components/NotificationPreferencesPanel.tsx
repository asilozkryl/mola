import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Bell, Clock3, Moon, RefreshCw, Search } from "lucide-react";
import type { Channel, User } from "../../shared/types";
import type {
  ChannelNotificationSettings,
  WorkspaceNotificationSettings,
} from "../../shared/notification-types";
import { api, ApiError } from "../lib/api";
import { conversationIdentity } from "../lib/conversationIdentity";
import { ConversationLabel } from "./ConversationLabel";
import { Spinner } from "./ui";
import "./notification-preferences.css";

type Scope = {
  userId: string;
  workspaceId: string;
  revision?: number;
  onChanged?: () => void;
};
type QuietHours = WorkspaceNotificationSettings["quietHours"];
type Mode = WorkspaceNotificationSettings["defaultMode"];
type ChannelMode = ChannelNotificationSettings["mode"];
type Mute = "30m" | "1h" | "today" | null;
const modeLabels: Record<Mode, string> = {
  all: "Tüm mesajlar",
  mentions: "Bahsetmeler ve yanıtlar",
  off: "Kapalı",
};

/** Explicit scope and generation checks also protect callers that reuse this component. */
function usePreferencesResource<
  T extends { workspaceId: string; serverNow: string },
>({ userId, workspaceId, onChanged, revision = 0 }: Scope, path: string) {
  const scope = `${userId}:${workspaceId}:${path}`;
  const [snapshot, setSnapshot] = useState<{
    scope: string;
    value: T;
    receivedAt: number;
  } | null>(null);
  const [status, setStatus] = useState({
    scope,
    loading: true,
    saving: false,
    error: "",
  });
  const live = useRef({ scope, alive: true });
  live.current.scope = scope;
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const request = useRef<AbortController | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const version = useRef(0);
  const refreshPending = useRef(false);
  const lastRevision = useRef(revision);
  const headers = { "X-User-Id": userId, "X-Workspace-Id": workspaceId };

  const refresh = useCallback(async () => {
    if (!live.current.alive || live.current.scope !== scope) return;
    if (mutation.current) {
      refreshPending.current = true;
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const generation = ++version.current;
    const current = () =>
      !controller.signal.aborted &&
      live.current.alive &&
      live.current.scope === scope &&
      version.current === generation;
    setStatus({ scope, loading: true, saving: false, error: "" });
    try {
      const value = await api<T>(path, {
        headers: { "X-User-Id": userId, "X-Workspace-Id": workspaceId },
        signal: controller.signal,
      });
      if (!current()) return;
      if (value.workspaceId !== workspaceId)
        throw new Error(
          "Çalışma alanı değişti. Ayarları yeniden yükleyebilirsin.",
        );
      setSnapshot({ scope, value, receivedAt: Date.now() });
    } catch (reason) {
      if (!current()) return;
      if (reason instanceof ApiError && [401, 403, 404].includes(reason.status))
        setSnapshot(null);
      setStatus({
        scope,
        loading: false,
        saving: false,
        error:
          reason instanceof Error
            ? reason.message
            : "Bildirim tercihleri yüklenemedi.",
      });
      return;
    } finally {
      if (current()) request.current = null;
    }
    if (current())
      setStatus({ scope, loading: false, saving: false, error: "" });
  }, [scope, path, userId, workspaceId]);

  useEffect(() => {
    live.current.alive = true;
    void refresh();
    const onFocus = () => {
      if (document.visibilityState !== "hidden") void refresh();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      live.current.alive = false;
      ++version.current;
      request.current?.abort();
      mutation.current?.abort();
      request.current = null;
      mutation.current = null;
      refreshPending.current = false;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh, workspaceId]);
  useEffect(() => {
    if (lastRevision.current === revision) return;
    lastRevision.current = revision;
    void refresh();
  }, [revision, refresh]);

  async function update<R extends { workspaceId: string }>(
    endpoint: string,
    body: object,
    merge: (previous: T, response: R) => T,
  ): Promise<R | null> {
    if (mutation.current || !live.current.alive || live.current.scope !== scope)
      return null;
    request.current?.abort();
    request.current = null;
    const controller = new AbortController();
    mutation.current = controller;
    const generation = ++version.current;
    const current = () =>
      !controller.signal.aborted &&
      live.current.alive &&
      live.current.scope === scope &&
      version.current === generation;
    setStatus({ scope, loading: false, saving: true, error: "" });
    try {
      const response = await api<R>(endpoint, {
        method: "PATCH",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!current()) return null;
      if (response.workspaceId !== workspaceId)
        throw new Error(
          "Çalışma alanı değişti. Ayarları yeniden yükleyebilirsin.",
        );
      setSnapshot((previous) =>
        previous?.scope === scope
          ? {
              scope,
              value: merge(previous.value, response),
              receivedAt: Date.now(),
            }
          : previous,
      );
      setStatus({ scope, loading: false, saving: false, error: "" });
      changed.current?.();
      return response;
    } catch (reason) {
      if (!current()) return null;
      if (
        reason instanceof ApiError &&
        [401, 403, 404].includes(reason.status)
      ) {
        setSnapshot(null);
        changed.current?.();
      }
      setStatus({
        scope,
        loading: false,
        saving: false,
        error:
          reason instanceof Error
            ? reason.message
            : "Tercihin kaydedilemedi. Yeniden deneyebilirsin.",
      });
      return null;
    } finally {
      if (current()) {
        mutation.current = null;
        if (refreshPending.current) {
          refreshPending.current = false;
          void refresh();
        }
      }
    }
  }
  const current = snapshot?.scope === scope ? snapshot : null;
  const state =
    status.scope === scope
      ? status
      : { loading: true, saving: false, error: "" };
  return {
    value: current?.value ?? null,
    receivedAt: current?.receivedAt ?? Date.now(),
    ...state,
    refresh,
    update,
  };
}

function useServerClock(serverNow: string | undefined, receivedAt: number) {
  const [tick, setTick] = useState(Date.now);
  useEffect(() => {
    const interval = window.setInterval(() => setTick(Date.now()), 15_000);
    return () => window.clearInterval(interval);
  }, []);
  const offset = serverNow ? Date.parse(serverNow) - receivedAt : 0;
  return Math.max(tick, receivedAt) + offset;
}

function localZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
function muteLabel(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}
function MuteControls({
  mutedUntil,
  timeZone,
  now,
  busy,
  onMute,
  label = "Bildirimleri geçici sustur",
}: {
  mutedUntil: string | null;
  timeZone: string;
  now: number;
  busy: boolean;
  onMute: (value: Mute) => void;
  label?: string;
}) {
  const active = mutedUntil && Date.parse(mutedUntil) > now;
  return (
    <div className="notification-mute-controls">
      <div className="notification-preference-label">
        <Clock3 size={15} aria-hidden="true" />
        <span>{label}</span>
      </div>
      <div
        className="notification-mute-actions"
        role="group"
        aria-label={label}
      >
        <Button
          variant="unstyled"
          size="unset"
          type="button"
          disabled={busy}
          onClick={() => onMute("30m")}
        >
          30 dakika
        </Button>
        <Button
          variant="unstyled"
          size="unset"
          type="button"
          disabled={busy}
          onClick={() => onMute("1h")}
        >
          1 saat
        </Button>
        <Button
          variant="unstyled"
          size="unset"
          type="button"
          disabled={busy}
          onClick={() => onMute("today")}
        >
          Gün sonuna kadar
        </Button>
      </div>
      <p className="notification-preference-help">
        Gün sonu için saat dilimi: {timeZone}.
      </p>
      {active && (
        <div className="notification-muted-until" role="status">
          <span>
            {muteLabel(mutedUntil, timeZone)} tarihine kadar susturuldu.
          </span>
          <Button
            variant="unstyled"
            size="unset"
            type="button"
            disabled={busy}
            onClick={() => onMute(null)}
          >
            Susturmayı kaldır
          </Button>
        </div>
      )}
    </div>
  );
}

function QuietHoursForm({
  value,
  busy,
  onSave,
}: {
  value: QuietHours;
  busy: boolean;
  onSave: (value: QuietHours) => Promise<QuietHours | null>;
}) {
  const id = useId();
  const [form, setForm] = useState(value);
  const [base, setBase] = useState(JSON.stringify(value));
  const serialized = JSON.stringify(value);
  const dirty = JSON.stringify(form) !== base;
  useEffect(() => {
    if (!dirty) {
      setForm(value);
      setBase(serialized);
    }
  }, [serialized, dirty, value]);
  const zones = [
    ...new Set([
      localZone(),
      "UTC",
      ...(typeof Intl.supportedValuesOf === "function"
        ? Intl.supportedValuesOf("timeZone")
        : []),
    ]),
  ];
  let validZone = true;
  try {
    new Intl.DateTimeFormat("tr-TR", { timeZone: form.timeZone });
  } catch {
    validZone = false;
  }
  const error = !validZone
    ? "Geçerli bir saat dilimi seç."
    : form.enabled && form.start === form.end
      ? "Başlangıç ve bitiş saatleri farklı olmalı."
      : "";
  return (
    <details className="notification-quiet-details">
      <summary>
        <Moon size={15} aria-hidden="true" /> Sessiz saatler{" "}
        <span>{value.enabled ? `${value.start}–${value.end}` : "Kapalı"}</span>
      </summary>
      <form
        className="notification-quiet-form"
        aria-label="Sessiz saatler"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || error || !dirty) return;
          void onSave(form).then((saved) => {
            if (saved) {
              setForm(saved);
              setBase(JSON.stringify(saved));
            }
          });
        }}
      >
        <label className="notification-quiet-toggle">
          <span>Sessiz saatleri etkinleştir</span>
          <input
            type="checkbox"
            checked={form.enabled}
            disabled={busy}
            onChange={(event) =>
              setForm({ ...form, enabled: event.target.checked })
            }
          />
        </label>
        <p className="notification-preference-help">
          Seçtiğin saatlerde uygulama içi uyarılar ve tarayıcı bildirimleri
          durur.
        </p>
        <div className="notification-quiet-fields">
          <label>
            Başlangıç saati
            <Input
              unstyled
              type="time"
              required
              value={form.start}
              disabled={busy || !form.enabled}
              onChange={(event) =>
                setForm({ ...form, start: event.target.value })
              }
            />
          </label>
          <label>
            Bitiş saati
            <Input
              unstyled
              type="time"
              required
              value={form.end}
              disabled={busy || !form.enabled}
              onChange={(event) =>
                setForm({ ...form, end: event.target.value })
              }
            />
          </label>
          <label className="notification-time-zone">
            Saat dilimi
            <Input
              unstyled
              list={`${id}-zones`}
              value={form.timeZone}
              required
              disabled={busy}
              onChange={(event) =>
                setForm({ ...form, timeZone: event.target.value })
              }
              autoComplete="off"
              spellCheck={false}
            />
            <datalist id={`${id}-zones`}>
              {zones.map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
          </label>
        </div>
        {form.timeZone !== localZone() && (
          <Button
            variant="unstyled"
            size="unset"
            type="button"
            className="notification-use-local-zone"
            disabled={busy}
            onClick={() => setForm({ ...form, timeZone: localZone() })}
          >
            Cihazımın saat dilimini kullan ({localZone()})
          </Button>
        )}
        {form.enabled && form.start > form.end && (
          <p className="notification-preference-help">
            Bitiş saati ertesi güne aittir.
          </p>
        )}
        {error && (
          <p className="notification-preference-error" role="alert">
            {error}
          </p>
        )}
        {dirty && serialized !== base && (
          <p className="notification-preference-help">
            Bu ayarlar başka bir yerde değişti. Kaydedersen buradaki saatler
            kullanılır.
          </p>
        )}
        <div className="notification-quiet-actions">
          <Button
            variant="unstyled"
            size="unset"
            className="notification-preference-save"
            type="submit"
            disabled={busy || !dirty || Boolean(error)}
          >
            {busy ? "Kaydediliyor…" : "Sessiz saatleri kaydet"}
          </Button>
          {dirty && (
            <Button
              variant="unstyled"
              size="unset"
              type="button"
              disabled={busy}
              onClick={() => {
                setForm(value);
                setBase(serialized);
              }}
            >
              Değişiklikleri geri al
            </Button>
          )}
        </div>
      </form>
    </details>
  );
}

function ResourceError({
  message,
  retry,
  busy,
}: {
  message: string;
  retry: () => void;
  busy: boolean;
}) {
  return (
    <div className="notification-preference-error" role="alert">
      <span>{message}</span>
      <Button
        variant="unstyled"
        size="unset"
        type="button"
        disabled={busy}
        onClick={retry}
      >
        <RefreshCw size={13} aria-hidden="true" /> Tercihleri yeniden yükle
      </Button>
    </div>
  );
}

type PanelProps = Scope & {
  workspaceName: string;
  channels: readonly Channel[];
  members: readonly User[];
};
export function NotificationPreferencesPanel(props: PanelProps) {
  return (
    <WorkspacePreferences
      key={`${props.userId}:${props.workspaceId}`}
      {...props}
    />
  );
}
function WorkspacePreferences(props: PanelProps) {
  const resource = usePreferencesResource<WorkspaceNotificationSettings>(
    props,
    "/notifications/settings",
  );
  const { value, saving } = resource;
  const [search, setSearch] = useState("");
  const now = useServerClock(value?.serverNow, resource.receivedAt);
  const patch = (body: object) =>
    resource.update<WorkspaceNotificationSettings>(
      "/notifications/settings",
      body,
      (_previous, response) => response,
    );
  const updateChannel = (channelId: string, mode: ChannelMode) =>
    resource.update<ChannelNotificationSettings>(
      `/channels/${encodeURIComponent(channelId)}/notification-settings`,
      { mode },
      (previous, response) => ({
        ...previous,
        serverNow: response.serverNow,
        channels: [
          ...previous.channels.filter(
            (channel) => channel.channelId !== channelId,
          ),
          response,
        ],
      }),
    );
  const availableChannels = props.channels.filter(
    (channel) =>
      !channel.archived &&
      value?.channels.some((entry) => entry.channelId === channel.id),
  );
  const channels = availableChannels.filter((channel) =>
    conversationIdentity(channel, props.userId, props.members)
      .name.toLocaleLowerCase("tr")
      .includes(search.trim().toLocaleLowerCase("tr")),
  );
  return (
    <section
      className="notification-preferences"
      aria-label="Çalışma alanı bildirim tercihleri"
      aria-busy={resource.loading || saving}
    >
      <div className="notification-preferences-heading">
        <Bell size={18} aria-hidden="true" />
        <div>
          <h3>{props.workspaceName}</h3>
          <p>Yalnız senin bu çalışma alanındaki bildirim tercihlerin.</p>
        </div>
      </div>
      {resource.error && (
        <ResourceError
          message={resource.error}
          retry={() => void resource.refresh()}
          busy={resource.loading || saving}
        />
      )}
      {!value ? (
        !resource.error && <Spinner label="Bildirim tercihleri yükleniyor" />
      ) : (
        <>
          <label className="notification-mode-row">
            <span>Varsayılan bildirimler</span>
            <NativeSelect
              unstyled
              value={value.defaultMode}
              disabled={saving}
              onChange={(event) =>
                void patch({ defaultMode: event.target.value })
              }
            >
              {Object.entries(modeLabels).map(([mode, label]) => (
                <option key={mode} value={mode}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </label>
          <p className="notification-preference-help">
            Bahsetmeler seçeneği sana gelen yanıtları, kanal çağrılarını ve özel
            mesajları da kapsar. Aktivite ve okunmamış sayıları her zaman
            korunur.
          </p>
          <MuteControls
            mutedUntil={value.mutedUntil}
            timeZone={value.quietHours.timeZone}
            now={now}
            busy={saving}
            onMute={(mute) =>
              void patch({
                mute,
                ...(mute === "today"
                  ? { timeZone: value.quietHours.timeZone }
                  : {}),
              })
            }
          />
          <QuietHoursForm
            value={value.quietHours}
            busy={saving}
            onSave={async (quietHours) =>
              (await patch({ quietHours }))?.quietHours ?? null
            }
          />
          <details className="notification-channel-preferences">
            <summary>
              Kanal tercihleri <span>{availableChannels.length}</span>
            </summary>
            <div className="notification-channel-search">
              <Search size={14} aria-hidden="true" />
              <Input
                unstyled
                type="search"
                aria-label="Bildirim tercihlerinde kanal ara"
                placeholder="Kanal veya kişi ara"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div
              className="notification-channel-list"
              role="region"
              aria-label="Kanal bildirim tercihleri"
              tabIndex={0}
            >
              {channels.map((channel) => {
                const preference = value.channels.find(
                  (entry) => entry.channelId === channel.id,
                );
                const name = conversationIdentity(
                  channel,
                  props.userId,
                  props.members,
                ).name;
                const muted =
                  preference?.mutedUntil &&
                  Date.parse(preference.mutedUntil) > now;
                return (
                  <label className="notification-channel-row" key={channel.id}>
                    <span>
                      <span className="notification-channel-name">
                        <ConversationLabel
                          channel={channel}
                          selfId={props.userId}
                          members={props.members}
                        />
                      </span>
                      {muted && (
                        <small>
                          {muteLabel(
                            preference.mutedUntil!,
                            value.quietHours.timeZone,
                          )}{" "}
                          tarihine kadar susturuldu.
                        </small>
                      )}
                    </span>
                    <NativeSelect
                      unstyled
                      aria-label={`${name} bildirimleri`}
                      value={preference?.mode || "inherit"}
                      disabled={saving}
                      onChange={(event) =>
                        void updateChannel(
                          channel.id,
                          event.target.value as ChannelMode,
                        )
                      }
                    >
                      <option value="inherit">Varsayılanı kullan</option>
                      {Object.entries(modeLabels).map(([mode, label]) => (
                        <option key={mode} value={mode}>
                          {label}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                );
              })}
              {!channels.length && (
                <p className="notification-preference-help">
                  {search
                    ? "Aramana uyan kanal veya kişi yok."
                    : "Bildirim tercihi ayarlanacak kanal yok."}
                </p>
              )}
            </div>
          </details>
          <span className="notification-preferences-status" role="status">
            {saving ? "Bildirim tercihin kaydediliyor…" : ""}
          </span>
        </>
      )}
    </section>
  );
}

export function ChannelNotificationPreferences(
  props: Scope & { channelId: string; channelName: string },
) {
  return (
    <ChannelPreferences
      key={`${props.userId}:${props.workspaceId}:${props.channelId}`}
      {...props}
    />
  );
}
function ChannelPreferences(
  props: Scope & { channelId: string; channelName: string },
) {
  const path = `/channels/${encodeURIComponent(props.channelId)}/notification-settings`;
  const resource = usePreferencesResource<ChannelNotificationSettings>(
    props,
    path,
  );
  const { value, saving } = resource;
  const now = useServerClock(value?.serverNow, resource.receivedAt);
  const patch = (body: object) =>
    resource.update<ChannelNotificationSettings>(
      path,
      body,
      (_previous, response) => response,
    );
  return (
    <section
      className="notification-preferences notification-channel-settings"
      aria-label={`${props.channelName} bildirim tercihleri`}
      aria-busy={resource.loading || saving}
    >
      <h3 className="notification-channel-heading">{props.channelName}</h3>
      {resource.error && (
        <ResourceError
          message={resource.error}
          retry={() => void resource.refresh()}
          busy={resource.loading || saving}
        />
      )}
      {!value ? (
        !resource.error && (
          <Spinner label="Kanal bildirim tercihleri yükleniyor" />
        )
      ) : (
        <>
          <label className="notification-mode-row">
            <span>Bu kanaldaki bildirimler</span>
            <NativeSelect
              unstyled
              value={value.mode}
              disabled={saving}
              onChange={(event) => void patch({ mode: event.target.value })}
            >
              <option value="inherit">Varsayılanı kullan</option>
              {Object.entries(modeLabels).map(([mode, label]) => (
                <option key={mode} value={mode}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </label>
          <p className="notification-preference-help">
            {value.mode === "inherit"
              ? `Çalışma alanı tercihin: ${modeLabels[value.effectiveMode]}. `
              : ""}
            Aktivite ve okunmamış sayıları korunur.
          </p>
          {value.workspaceMutedUntil &&
            Date.parse(value.workspaceMutedUntil) > now && (
              <p className="notification-preference-help">
                Çalışma alanı{" "}
                {muteLabel(
                  value.workspaceMutedUntil,
                  value.quietHours.timeZone,
                )}{" "}
                tarihine kadar susturuldu.
              </p>
            )}
          {value.quietHours.enabled && (
            <p className="notification-preference-help">
              Çalışma alanının sessiz saatleri bu kanalda da geçerli:{" "}
              {value.quietHours.start}–{value.quietHours.end} (
              {value.quietHours.timeZone}).
            </p>
          )}
          <MuteControls
            mutedUntil={value.mutedUntil}
            timeZone={value.quietHours.timeZone}
            now={now}
            busy={saving}
            label="Kanal bildirimlerini geçici sustur"
            onMute={(mute) =>
              void patch({
                mute,
                ...(mute === "today"
                  ? { timeZone: value.quietHours.timeZone }
                  : {}),
              })
            }
          />
        </>
      )}
    </section>
  );
}
