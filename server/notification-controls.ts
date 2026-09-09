import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { Express, Request } from "express";
import type { Server } from "socket.io";
import { z } from "zod";
import type { Repository, Row } from "./db.js";
import { HttpError } from "./errors.js";
import type {
  ChannelNotificationPreference,
  ChannelNotificationSettings,
  NotificationMode,
  PushDiagnostic,
  QuietHours,
  WorkspaceNotificationSettings,
} from "../shared/notification-types.js";

export function migrateNotificationControls(db: DatabaseSync) {
  db.exec(`CREATE TABLE notification_policies(
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    default_mode TEXT NOT NULL DEFAULT 'mentions' CHECK(default_mode IN ('all','mentions','off')),
    muted_until INTEGER,
    quiet_enabled INTEGER NOT NULL DEFAULT 0 CHECK(quiet_enabled IN (0,1)),
    time_zone TEXT NOT NULL DEFAULT 'UTC',
    quiet_start INTEGER NOT NULL DEFAULT 1320,
    quiet_end INTEGER NOT NULL DEFAULT 480,
    PRIMARY KEY(user_id,workspace_id));
  CREATE TABLE channel_notification_preferences(
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    mode TEXT NOT NULL DEFAULT 'inherit' CHECK(mode IN ('inherit','all','mentions','off')),
    muted_until INTEGER,
    PRIMARY KEY(user_id,channel_id));
  CREATE TABLE push_diagnostics(
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
    subscription_id TEXT REFERENCES push_subscriptions(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','providerAccepted','failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    reason_code TEXT,
    last_failure_code TEXT,
    last_failure_at INTEGER);
  CREATE INDEX idx_push_diagnostic_scope ON push_diagnostics(user_id,session_hash,created_at DESC);
  CREATE TRIGGER push_diagnostic_subscription_removed BEFORE DELETE ON push_subscriptions BEGIN
    UPDATE push_diagnostics SET status='failed',reason_code='DEVICE_UNAVAILABLE',updated_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE subscription_id=OLD.id AND status='queued';
  END;
  DROP INDEX idx_push_outbox_pending;
  ALTER TABLE push_outbox RENAME TO push_outbox_previous;
  CREATE TABLE push_outbox(
    id TEXT PRIMARY KEY,
    notification_id TEXT REFERENCES notifications(id) ON DELETE CASCADE,
    subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt INTEGER NOT NULL,
    message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
    diagnostic_id TEXT REFERENCES push_diagnostics(id) ON DELETE CASCADE,
    CHECK((notification_id IS NOT NULL)+(message_id IS NOT NULL)+(diagnostic_id IS NOT NULL)=1),
    UNIQUE(notification_id,subscription_id),UNIQUE(message_id,subscription_id),UNIQUE(diagnostic_id));
  INSERT INTO push_outbox(id,notification_id,subscription_id,attempts,next_attempt) SELECT id,notification_id,subscription_id,attempts,next_attempt FROM push_outbox_previous;
  DROP TABLE push_outbox_previous;
  CREATE INDEX idx_push_outbox_pending ON push_outbox(next_attempt);
  CREATE TABLE push_delivery_metrics(category TEXT PRIMARY KEY,total INTEGER NOT NULL DEFAULT 0,last_at INTEGER NOT NULL);`);
}

const uuid = z.string().uuid(),
  mode = z.enum(["all", "mentions", "off"]);
export function validTimeZone(value: string) {
  if (
    !/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/.test(value) ||
    value.length > 100
  )
    return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}
const timeZone = z
  .string()
  .refine(validTimeZone, "Geçerli bir IANA saat dilimi seçin.");
const hhmm = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const minutes = (value: string) =>
  Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
const clock = (value: number) =>
  `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
const quietSchema = z
  .object({ enabled: z.boolean(), timeZone, start: hhmm, end: hhmm })
  .strict()
  .refine(
    (value) => !value.enabled || value.start !== value.end,
    "Sessiz saat başlangıcı ve bitişi farklı olmalı.",
  );
const patchFields = {
  mute: z.enum(["30m", "1h", "today"]).nullable().optional(),
  timeZone: timeZone.optional(),
};
const workspacePatch = z
  .object({
    ...patchFields,
    defaultMode: mode.optional(),
    quietHours: quietSchema.optional(),
  })
  .strict();
const channelPatch = z
  .object({
    ...patchFields,
    mode: z.enum(["inherit", "all", "mentions", "off"]).optional(),
  })
  .strict();
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new HttpError(
      400,
      result.error.issues[0]?.message || "Bildirim ayarlarını kontrol edin.",
    );
  return result.data;
};
const formatters = new Map<string, Intl.DateTimeFormat>();
const localParts = (now: number, zone: string) => {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    if (formatters.size > 100) formatters.clear();
    formatters.set(zone, formatter);
  }
  return Object.fromEntries(
    formatter.formatToParts(now).map((part) => [part.type, part.value]),
  );
};
export function quietHoursActive(quiet: QuietHours, now: number) {
  if (!quiet.enabled) return false;
  const parts = localParts(now, quiet.timeZone),
    current = Number(parts.hour) * 60 + Number(parts.minute),
    start = minutes(quiet.start),
    end = minutes(quiet.end);
  return start < end
    ? current >= start && current < end
    : current >= start || current < end;
}
export function endOfLocalDay(now: number, zone: string) {
  if (!validTimeZone(zone))
    throw new HttpError(400, "Geçerli bir IANA saat dilimi seçin.");
  const date = (value: number) => {
    const p = localParts(value, zone);
    return `${p.year}-${p.month}-${p.day}`;
  };
  const today = date(now);
  let low = now,
    high = now + 36 * 60 * 60_000;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (date(middle) === today) low = middle;
    else high = middle;
  }
  return high;
}
function muteUntil(
  input: { mute?: "30m" | "1h" | "today" | null; timeZone?: string },
  now: number,
) {
  if (input.mute === undefined) return undefined;
  if (input.mute === null) return null;
  if (input.mute === "today") {
    if (!input.timeZone)
      throw new HttpError(400, "Gün sonu için saat dilimi gerekli.");
    return endOfLocalDay(now, input.timeZone);
  }
  return now + (input.mute === "30m" ? 30 : 60) * 60_000;
}
function policy(repo: Repository, userId: string, workspaceId: string) {
  return (
    repo.get(
      "SELECT * FROM notification_policies WHERE user_id=? AND workspace_id=?",
      userId,
      workspaceId,
    ) || {
      default_mode: "mentions",
      muted_until: null,
      quiet_enabled: 0,
      time_zone: "UTC",
      quiet_start: 1320,
      quiet_end: 480,
    }
  );
}
function quietFor(row: Row): QuietHours {
  return {
    enabled: Boolean(row.quiet_enabled),
    timeZone: row.time_zone,
    start: clock(row.quiet_start),
    end: clock(row.quiet_end),
  };
}
const until = (value: number | null, now: number) =>
  value && value > now ? new Date(value).toISOString() : null;
export function notificationAllowed(
  repo: Repository,
  userId: string,
  workspaceId: string,
  channelId: string,
  personal: boolean,
  now = Date.now(),
) {
  const workspace = policy(repo, userId, workspaceId),
    channel = repo.get(
      "SELECT * FROM channel_notification_preferences WHERE user_id=? AND channel_id=?",
      userId,
      channelId,
    );
  const selected =
    channel && channel.mode !== "inherit"
      ? channel.mode
      : workspace.default_mode;
  return (
    selected !== "off" &&
    (selected === "all" || personal) &&
    !(workspace.muted_until > now) &&
    !(channel?.muted_until > now) &&
    !quietHoursActive(quietFor(workspace), now)
  );
}
export const pushOutcomeCategories = [
  "provider_accepted",
  "retry_scheduled",
  "provider_rejected",
  "subscription_expired",
  "retry_exhausted",
  "suppressed",
  "diagnostic_expired",
  "provider_5xx",
  "provider_timeout",
  "network_error",
  "provider_throttled",
] as const;
export type PushOutcomeCategory = (typeof pushOutcomeCategories)[number];
export function recordPushOutcome(
  repo: Repository,
  category: PushOutcomeCategory,
  now = Date.now(),
  count = 1,
) {
  repo.run(
    "INSERT INTO push_delivery_metrics(category,total,last_at) VALUES(?,?,?) ON CONFLICT(category) DO UPDATE SET total=total+excluded.total,last_at=excluded.last_at",
    category,
    count,
    now,
  );
}
export function notificationQueueMetrics(repo: Repository, now = Date.now()) {
  const queue = repo.get(
    "SELECT COUNT(*) AS count,MIN(COALESCE(d.created_at,CAST(strftime('%s',n.created_at) AS INTEGER)*1000,CAST(strftime('%s',m.created_at) AS INTEGER)*1000)) AS oldest FROM push_outbox p LEFT JOIN notifications n ON n.id=p.notification_id LEFT JOIN messages m ON m.id=p.message_id LEFT JOIN push_diagnostics d ON d.id=p.diagnostic_id",
  )!;
  const outcomes = Object.fromEntries(
    pushOutcomeCategories.map((category) => [
      category,
      Number(
        repo.get(
          "SELECT total FROM push_delivery_metrics WHERE category=?",
          category,
        )?.total || 0,
      ),
    ]),
  );
  const failure = repo.get(
    "SELECT category,last_at FROM push_delivery_metrics WHERE category IN ('provider_5xx','provider_timeout','network_error','provider_throttled','provider_rejected','subscription_expired') ORDER BY last_at DESC,category LIMIT 1",
  );
  return {
    queued: Number(queue.count),
    oldestQueueAgeSeconds: queue.oldest
      ? Math.max(0, Math.floor((now - queue.oldest) / 1000))
      : 0,
    outcomes,
    lastFailureAt: failure ? Math.floor(failure.last_at / 1000) : null,
    lastFailureCategory: failure?.category || null,
  };
}

export function installNotificationControls(
  app: Express,
  {
    repo,
    io,
    requirePushContext,
    requiresVerification,
    processPush,
    now = Date.now,
  }: {
    repo: Repository;
    io: Server;
    requirePushContext: (req: Request, required?: boolean) => void;
    requiresVerification: (user: Row) => boolean;
    processPush: () => Promise<void>;
    now?: () => number;
  },
) {
  const actorFor = (req: Request) => {
    const actor = repo.session(req.sessionHash!);
    if (!actor || actor.id !== req.auth!.id)
      throw new HttpError(401, "Oturumun sona erdi.");
    if (actor.workspace_id !== req.auth!.workspace_id)
      throw new HttpError(409, "Çalışma alanın değişti.", "WORKSPACE_CHANGED");
    const membership =
      actor.workspace_id && repo.member(actor.id, actor.workspace_id);
    if (
      !membership ||
      actor.suspended_at ||
      actor.membership_suspended_at ||
      actor.membership_removed_at ||
      repo.workspace(actor.workspace_id).suspended ||
      requiresVerification(actor)
    )
      throw new HttpError(403, "Bu çalışma alanına erişimin yok.");
    return actor;
  };
  const channelPreference = (
    actor: Row,
    channelId: string,
    defaultMode: NotificationMode,
    time: number,
  ): ChannelNotificationPreference => {
    const row = repo.get(
      "SELECT * FROM channel_notification_preferences WHERE user_id=? AND channel_id=?",
      actor.id,
      channelId,
    );
    return {
      channelId,
      mode: row?.mode || "inherit",
      effectiveMode: row && row.mode !== "inherit" ? row.mode : defaultMode,
      mutedUntil: until(row?.muted_until, time),
    };
  };
  const settings = (actor: Row): WorkspaceNotificationSettings => {
    const row = policy(repo, actor.id, actor.workspace_id),
      time = now();
    return {
      workspaceId: actor.workspace_id,
      defaultMode: row.default_mode,
      mutedUntil: until(row.muted_until, time),
      quietHours: quietFor(row),
      channels: repo
        .channels(actor.id, actor.workspace_id)
        .map((c) => channelPreference(actor, c.id, row.default_mode, time)),
      serverNow: new Date(time).toISOString(),
    };
  };
  const channelSettings = (
    actor: Row,
    channelId: string,
  ): ChannelNotificationSettings => {
    if (!repo.canAccessChannel(actor.id, channelId, actor.workspace_id))
      throw new HttpError(404, "Kanal bulunamadı.");
    const row = policy(repo, actor.id, actor.workspace_id),
      time = now();
    return {
      ...channelPreference(actor, channelId, row.default_mode, time),
      workspaceId: actor.workspace_id,
      workspaceMutedUntil: until(row.muted_until, time),
      quietHours: quietFor(row),
      serverNow: new Date(time).toISOString(),
    };
  };
  const changed = (actor: Row) =>
    io
      .to(`workspace-user:${actor.workspace_id}:${actor.id}`)
      .emit("notification-settings:changed", {
        workspaceId: actor.workspace_id,
      });
  app.get("/api/notifications/settings", (req, res) =>
    res.json(settings(actorFor(req))),
  );
  app.patch("/api/notifications/settings", (req, res) => {
    const input = parse(workspacePatch, req.body);
    if (
      input.defaultMode === undefined &&
      input.quietHours === undefined &&
      input.mute === undefined
    )
      throw new HttpError(400, "Değiştirilecek bir tercih seçin.");
    const actor = repo.transaction(() => {
      const actor = actorFor(req),
        mute = muteUntil(input, now());
      repo.run(
        "INSERT OR IGNORE INTO notification_policies(user_id,workspace_id) VALUES(?,?)",
        actor.id,
        actor.workspace_id,
      );
      if (input.defaultMode !== undefined)
        repo.run(
          "UPDATE notification_policies SET default_mode=? WHERE user_id=? AND workspace_id=?",
          input.defaultMode,
          actor.id,
          actor.workspace_id,
        );
      if (mute !== undefined)
        repo.run(
          "UPDATE notification_policies SET muted_until=? WHERE user_id=? AND workspace_id=?",
          mute,
          actor.id,
          actor.workspace_id,
        );
      if (input.quietHours) {
        const q = input.quietHours;
        repo.run(
          "UPDATE notification_policies SET quiet_enabled=?,time_zone=?,quiet_start=?,quiet_end=? WHERE user_id=? AND workspace_id=?",
          q.enabled ? 1 : 0,
          q.timeZone,
          minutes(q.start),
          minutes(q.end),
          actor.id,
          actor.workspace_id,
        );
      }
      return actor;
    });
    changed(actor);
    res.json(settings(actor));
  });
  app.get("/api/channels/:id/notification-settings", (req, res) =>
    res.json(channelSettings(actorFor(req), parse(uuid, req.params.id))),
  );
  app.patch("/api/channels/:id/notification-settings", (req, res) => {
    const input = parse(channelPatch, req.body),
      channelId = parse(uuid, req.params.id);
    if (input.mode === undefined && input.mute === undefined)
      throw new HttpError(400, "Değiştirilecek bir tercih seçin.");
    const actor = repo.transaction(() => {
      const actor = actorFor(req);
      channelSettings(actor, channelId);
      const mute = muteUntil(input, now());
      repo.run(
        "INSERT OR IGNORE INTO channel_notification_preferences(user_id,channel_id) VALUES(?,?)",
        actor.id,
        channelId,
      );
      if (input.mode !== undefined)
        repo.run(
          "UPDATE channel_notification_preferences SET mode=? WHERE user_id=? AND channel_id=?",
          input.mode,
          actor.id,
          channelId,
        );
      if (mute !== undefined)
        repo.run(
          "UPDATE channel_notification_preferences SET muted_until=? WHERE user_id=? AND channel_id=?",
          mute,
          actor.id,
          channelId,
        );
      return actor;
    });
    changed(actor);
    res.json(channelSettings(actor, channelId));
  });
  const diagnostic = (row: Row): PushDiagnostic => {
    const job = repo.get(
      "SELECT next_attempt FROM push_outbox WHERE diagnostic_id=?",
      row.id,
    );
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      status: row.status,
      attempts: row.attempts,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      nextAttemptAt:
        row.status === "queued" && job
          ? new Date(job.next_attempt).toISOString()
          : null,
      reasonCode: row.reason_code || null,
      lastFailureCode: row.last_failure_code || null,
      lastFailureAt: row.last_failure_at
        ? new Date(row.last_failure_at).toISOString()
        : null,
    };
  };
  app.post("/api/notifications/push-tests", (req, res) => {
    const input = parse(
      z.object({ endpoint: z.string().min(1).max(2048) }).strict(),
      req.body,
    );
    requirePushContext(req, true);
    const result = repo.transaction(() => {
      const actor = actorFor(req),
        time = now();
      if (
        !repo.get(
          "SELECT 1 FROM notification_preferences WHERE user_id=? AND push_enabled=1",
          actor.id,
        )
      )
        throw new HttpError(
          409,
          "Önce bu hesap için bildirimleri aç.",
          "PUSH_DISABLED",
        );
      const sub = repo.get(
        "SELECT id FROM push_subscriptions WHERE endpoint=? AND user_id=? AND session_hash=?",
        input.endpoint,
        actor.id,
        req.sessionHash!,
      );
      if (!sub)
        throw new HttpError(
          409,
          "Bu cihazın bildirim aboneliğini yeniden bağla.",
          "PUSH_DEVICE_UNAVAILABLE",
        );
      const active = repo.get(
        "SELECT * FROM push_diagnostics WHERE subscription_id=? AND user_id=? AND workspace_id=? AND session_hash=? AND status='queued' AND created_at>? ORDER BY created_at DESC LIMIT 1",
        sub.id,
        actor.id,
        actor.workspace_id,
        req.sessionHash!,
        time - 300000,
      );
      if (active) return active;
      if (
        repo.get(
          "SELECT 1 FROM push_diagnostics WHERE user_id=? AND session_hash=? AND created_at>? LIMIT 1",
          actor.id,
          req.sessionHash!,
          time - 60000,
        )
      )
        throw new HttpError(
          429,
          "Yeni test için bir dakika bekle.",
          "PUSH_TEST_RATE_LIMITED",
        );
      const id = randomUUID();
      repo.run(
        "INSERT INTO push_diagnostics(id,user_id,workspace_id,session_hash,subscription_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
        id,
        actor.id,
        actor.workspace_id,
        req.sessionHash!,
        sub.id,
        time,
        time,
      );
      repo.run(
        "INSERT INTO push_outbox(id,subscription_id,next_attempt,diagnostic_id) VALUES(?,?,?,?)",
        randomUUID(),
        sub.id,
        time,
        id,
      );
      return repo.get("SELECT * FROM push_diagnostics WHERE id=?", id)!;
    });
    const response = diagnostic(result);
    res.status(202).json(response);
    void processPush();
  });
  app.get("/api/notifications/push-tests/:id", (req, res) => {
    const actor = actorFor(req),
      id = parse(uuid, req.params.id);
    const row = repo.get(
      "SELECT * FROM push_diagnostics WHERE id=? AND user_id=? AND workspace_id=? AND session_hash=?",
      id,
      actor.id,
      actor.workspace_id,
      req.sessionHash!,
    );
    if (!row) throw new HttpError(404, "Bildirim testi bulunamadı.");
    res.json(diagnostic(row));
  });
  return {
    cleanup: () => {
      const time = now();
      const expired = repo.run(
        "UPDATE push_diagnostics SET status='failed',reason_code='TEST_EXPIRED',updated_at=? WHERE status='queued' AND created_at<?",
        time,
        time - 300000,
      );
      if (Number(expired.changes))
        recordPushOutcome(
          repo,
          "diagnostic_expired",
          time,
          Number(expired.changes),
        );
      repo.run(
        "DELETE FROM push_outbox WHERE diagnostic_id IN(SELECT id FROM push_diagnostics WHERE status!='queued')",
      );
      repo.run(
        "DELETE FROM push_diagnostics WHERE status!='queued' AND updated_at<?",
        time - 7 * 86400000,
      );
    },
  };
}
