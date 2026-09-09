import type { DatabaseSync } from "node:sqlite";
import type { Express, Request } from "express";
import type { Server } from "socket.io";
import { createECDH, createHmac, ECDH, randomUUID } from "node:crypto";
import webpush from "web-push";
import { z } from "zod";
import type { Repository, Row } from "./db.js";
import { HttpError } from "./errors.js";
import {
  AttachmentUnavailableError,
  attachmentAvailability,
  draftAttachmentIds,
  sameAttachmentIds,
} from "./message-reliability.js";
import type {
  DraftState,
  NotificationState,
} from "../shared/collaboration-types.js";

export function migrateCollaborationData(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE message_order(sequence INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE);
    INSERT INTO message_order(message_id) SELECT id FROM messages ORDER BY rowid;
    CREATE TRIGGER message_order_insert AFTER INSERT ON messages BEGIN INSERT INTO message_order(message_id) VALUES(NEW.id); END;
    CREATE TABLE channel_reads(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE, last_rowid INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY(user_id,channel_id));
    CREATE TABLE notifications(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE, message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE, kind TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT, UNIQUE(user_id,message_id));
    CREATE INDEX idx_notifications_user ON notifications(user_id,workspace_id,created_at DESC);
    CREATE TABLE message_drafts(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE, parent_key TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY(user_id,channel_id,parent_key));
    CREATE TABLE notification_preferences(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, push_enabled INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE push_subscriptions(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE push_outbox(id TEXT PRIMARY KEY, notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE, subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE, attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL, UNIQUE(notification_id,subscription_id));
    CREATE INDEX idx_push_outbox_pending ON push_outbox(next_attempt);
  `);
  // Existing history starts read; messages arriving after the upgrade remain unread.
  db.exec(
    `INSERT INTO channel_reads(user_id,channel_id,last_rowid,updated_at) SELECT wm.user_id,c.id,COALESCE((SELECT MAX(o.sequence) FROM messages m JOIN message_order o ON o.message_id=m.id WHERE m.channel_id=c.id),0),datetime('now') FROM workspace_members wm JOIN channels c ON c.workspace_id=wm.workspace_id WHERE wm.removed_at IS NULL AND ((c.kind!='dm' AND c.visibility='public' AND wm.role!='guest') OR EXISTS(SELECT 1 FROM channel_members cm WHERE cm.channel_id=c.id AND cm.user_id=wm.user_id));`,
  );
}

const uuid = z.string().uuid();
const parse = <T>(schema: z.ZodType<T>, input: unknown): T => {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new HttpError(
      400,
      result.error.issues[0]?.message || "Bilgileri kontrol edin.",
    );
  return result.data;
};
export function validPushEndpoint(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      (!url.port || url.port === "443") &&
      ([
        "fcm.googleapis.com",
        "updates.push.services.mozilla.com",
        "web.push.apple.com",
      ].includes(url.hostname) ||
        url.hostname.endsWith(".notify.windows.com"))
    );
  } catch {
    return false;
  }
}
export function installCollaborationData(
  app: Express,
  {
    repo,
    io,
    key,
    origin,
    uploadDir = "",
    sendPush = webpush.sendNotification,
    requiresVerification = () => false,
  }: {
    repo: Repository;
    io: Server;
    key: Buffer;
    origin: string;
    uploadDir?: string;
    sendPush?: typeof webpush.sendNotification;
    requiresVerification?: (user: Row) => boolean;
  },
) {
  const curve = createECDH("prime256v1");
  for (let attempt = 0; ; attempt++) {
    try {
      curve.setPrivateKey(
        createHmac("sha256", key)
          .update(`mola/web-push/v1:${attempt}`)
          .digest(),
      );
      break;
    } catch (error) {
      if (attempt >= 255) throw error;
    }
  }
  const vapidDetails = {
    subject: origin,
    publicKey: curve.getPublicKey().toString("base64url"),
    privateKey: curve.getPrivateKey().toString("base64url"),
  };
  // An optimistic request context, never an authentication credential or cookie.
  const pushSessionBinding = (sessionHash: string) =>
    createHmac("sha256", key)
      .update(`mola/push-session/v1:${sessionHash}`)
      .digest("base64url");
  const requirePushContext = (req: Request, required = false) => {
    const expectedUser = req.get("X-User-Id");
    const expectedSession = req.get("X-Push-Session");
    // Preserve older explicit clients; automatic restoration always requires context.
    if (!required && !expectedUser && !expectedSession) return;
    if (
      expectedUser !== req.auth!.id ||
      expectedSession !== pushSessionBinding(req.sessionHash!)
    )
      throw new HttpError(
        409,
        "Bu tarayıcıdaki oturum değişti. Bildirim ayarlarını yeniden açın.",
        "PUSH_SESSION_CHANGED",
      );
  };
  const requireChannel = (req: Request, channelId: string, write = false) => {
    const actor = repo.session(req.sessionHash!);
    if (!actor || actor.id !== req.auth!.id)
      throw new HttpError(401, "Oturumun sona erdi.");
    if (actor.workspace_id !== req.auth!.workspace_id)
      throw new HttpError(409, "Çalışma alanın değişti.", "WORKSPACE_CHANGED");
    if (
      !(write
        ? repo.canWriteChannel(actor.id, channelId, actor.workspace_id)
        : repo.canAccessChannel(actor.id, channelId, actor.workspace_id))
    )
      throw new HttpError(404, "Kanal bulunamadı.");
    return actor;
  };
  const state = (userId: string, workspaceId: string): NotificationState => {
    const channels = repo.channels(userId, workspaceId);
    const allowed = JSON.stringify(channels.map((c) => c.id));
    const counts = repo.all(
      `SELECT m.channel_id,COUNT(*) AS unread FROM messages m JOIN message_order o ON o.message_id=m.id JOIN channels c ON c.id=m.channel_id LEFT JOIN channel_reads r ON r.channel_id=c.id AND r.user_id=? WHERE c.workspace_id=? AND m.user_id!=? AND o.sequence>COALESCE(r.last_rowid,0) AND c.id IN (SELECT value FROM json_each(?)) GROUP BY m.channel_id`,
      userId,
      workspaceId,
      userId,
      allowed,
    );
    const rows = repo.all(
      `SELECT n.*,u.name AS actor_name,c.name AS channel_name,m.content FROM notifications n JOIN messages m ON m.id=n.message_id JOIN users u ON u.id=m.user_id JOIN channels c ON c.id=n.channel_id WHERE n.user_id=? AND n.workspace_id=? AND n.channel_id IN (SELECT value FROM json_each(?)) ORDER BY n.created_at DESC,n.id DESC LIMIT 100`,
      userId,
      workspaceId,
      allowed,
    );
    return {
      workspaceId,
      unreadByChannel: Object.fromEntries(
        counts.map((r) => [r.channel_id, r.unread]),
      ),
      unreadNotifications: Number(
        repo.get(
          "SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND workspace_id=? AND read_at IS NULL AND channel_id IN (SELECT value FROM json_each(?))",
          userId,
          workspaceId,
          allowed,
        )!.n,
      ),
      notifications: rows.slice(0, 100).map((n) => ({
        id: n.id,
        workspaceId: n.workspace_id,
        channelId: n.channel_id,
        messageId: n.message_id,
        kind: n.kind,
        actorName: n.actor_name,
        channelName: n.channel_name,
        preview: n.content.slice(0, 240),
        createdAt: n.created_at,
        read: Boolean(n.read_at),
      })),
    };
  };
  const stateTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const emitState = (userId: string, workspaceId: string) => {
    const room = `workspace-user:${workspaceId}:${userId}`;
    if (!io.sockets.adapter.rooms.get(room)?.size || stateTimers.has(room))
      return;
    const timer = setTimeout(() => {
      stateTimers.delete(room);
      if (io.sockets.adapter.rooms.get(room)?.size)
        io.to(room).emit("notifications:state", state(userId, workspaceId));
    }, 25);
    timer.unref();
    stateTimers.set(room, timer);
  };
  const markRead = (userId: string, channelId: string, rowid: number) =>
    repo.run(
      `INSERT INTO channel_reads(user_id,channel_id,last_rowid,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id,channel_id) DO UPDATE SET last_rowid=MAX(last_rowid,excluded.last_rowid),updated_at=excluded.updated_at`,
      userId,
      channelId,
      rowid,
      new Date().toISOString(),
    );
  app.get("/api/notifications", (req, res) =>
    res.json(state(req.auth!.id, req.auth!.workspace_id)),
  );
  app.post("/api/channels/:id/read", (req, res) => {
    const channelId = parse(uuid, req.params.id);
    requireChannel(req, channelId);
    const { messageId } = parse(
      z.object({ messageId: uuid.optional() }).strict(),
      req.body,
    );
    const last = messageId
      ? repo.get(
          "SELECT o.sequence AS rowid FROM messages m JOIN message_order o ON o.message_id=m.id WHERE m.id=? AND m.channel_id=?",
          messageId,
          channelId,
        )
      : repo.get(
          "SELECT MAX(o.sequence) AS rowid FROM messages m JOIN message_order o ON o.message_id=m.id WHERE m.channel_id=?",
          channelId,
        );
    if (messageId && !last) throw new HttpError(404, "Mesaj bulunamadı.");
    repo.transaction(() => {
      markRead(req.auth!.id, channelId, last?.rowid || 0);
      repo.run(
        "UPDATE notifications SET read_at=? WHERE user_id=? AND channel_id=? AND message_id IN(SELECT m.id FROM messages m JOIN message_order o ON o.message_id=m.id WHERE m.channel_id=? AND o.sequence<=?)",
        new Date().toISOString(),
        req.auth!.id,
        channelId,
        channelId,
        last?.rowid || 0,
      );
    });
    emitState(req.auth!.id, req.auth!.workspace_id);
    res.json({ ok: true });
  });
  app.post("/api/notifications/read", (req, res) => {
    const input = parse(
      z
        .object({
          id: uuid.optional(),
          notificationsOnly: z.literal(true).optional(),
        })
        .strict()
        .refine((value) => !(value.id && value.notificationsOnly)),
      req.body,
    );
    repo.transaction(() => {
      if (input.id) {
        const n = repo.get(
          "SELECT * FROM notifications WHERE id=? AND user_id=? AND workspace_id=?",
          input.id,
          req.auth!.id,
          req.auth!.workspace_id,
        );
        if (!n) throw new HttpError(404, "Bildirim bulunamadı.");
        requireChannel(req, n.channel_id);
        repo.run(
          "UPDATE notifications SET read_at=? WHERE id=?",
          new Date().toISOString(),
          n.id,
        );
      } else
        for (const c of repo.channels(req.auth!.id, req.auth!.workspace_id)) {
          if (
            !repo.canAccessChannel(req.auth!.id, c.id, req.auth!.workspace_id)
          )
            continue;
          if (!input.notificationsOnly)
            markRead(
              req.auth!.id,
              c.id,
              repo.get(
                "SELECT MAX(o.sequence) AS rowid FROM messages m JOIN message_order o ON o.message_id=m.id WHERE m.channel_id=?",
                c.id,
              )?.rowid || 0,
            );
          repo.run(
            "UPDATE notifications SET read_at=? WHERE user_id=? AND workspace_id=? AND channel_id=?",
            new Date().toISOString(),
            req.auth!.id,
            req.auth!.workspace_id,
            c.id,
          );
        }
    });
    emitState(req.auth!.id, req.auth!.workspace_id);
    res.json({ ok: true });
  });
  const draft = (
    userId: string,
    channelId: string,
    parent: string,
  ): DraftState => {
    const r = repo.get(
      "SELECT * FROM message_drafts WHERE user_id=? AND channel_id=? AND parent_key=?",
      userId,
      channelId,
      parent,
    );
    return {
      content: r?.content || "",
      attachmentIds: draftAttachmentIds(repo, userId, channelId, parent),
      ...attachmentAvailability(
        repo,
        uploadDir,
        userId,
        repo.get("SELECT workspace_id FROM channels WHERE id=?", channelId)
          ?.workspace_id || "",
        draftAttachmentIds(repo, userId, channelId, parent),
      ),
      revision: r?.revision || 0,
      updatedAt: r?.updated_at || null,
    };
  };
  const draftContext = (req: Request) => {
    const channelId = parse(uuid, req.params.id);
    requireChannel(req, channelId, true);
    const parent = parse(
      z.string().uuid().or(z.literal("")).default(""),
      req.query.parentId,
    );
    if (
      parent &&
      !repo.get(
        "SELECT id FROM messages WHERE id=? AND channel_id=? AND parent_id IS NULL",
        parent,
        channelId,
      )
    )
      throw new HttpError(404, "Yanıt dizisi bulunamadı.");
    return { channelId, parent };
  };
  app.get("/api/channels/:id/draft", (req, res) => {
    const { channelId, parent } = draftContext(req);
    res.json(draft(req.auth!.id, channelId, parent));
  });
  app.put("/api/channels/:id/draft", (req, res) => {
    const input = parse(
      z
        .object({
          content: z.string().max(10000),
          attachmentIds: z.array(uuid).max(4).optional(),
          revision: z
            .number()
            .int()
            .min(0)
            .max(Number.MAX_SAFE_INTEGER - 1),
        })
        .strict(),
      req.body,
    );
    const result = repo.transaction(() => {
      const { channelId, parent } = draftContext(req);
      const current = draft(req.auth!.id, channelId, parent);
      if (input.revision !== current.revision) return { conflict: current };
      const attachmentIds =
        input.attachmentIds === undefined
          ? current.attachmentIds
          : [...new Set(input.attachmentIds)];
      const addedIds = attachmentIds.filter(
        (id) => !current.attachmentIds.includes(id),
      );
      const unavailable = attachmentAvailability(
        repo,
        uploadDir,
        req.auth!.id,
        req.auth!.workspace_id,
        addedIds,
      ).unavailableAttachmentIds;
      if (unavailable.length) throw new AttachmentUnavailableError(unavailable);
      repo.run(
        `INSERT INTO message_drafts VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,channel_id,parent_key) DO UPDATE SET content=excluded.content,revision=excluded.revision,updated_at=excluded.updated_at`,
        req.auth!.id,
        channelId,
        parent,
        input.content,
        current.revision + 1,
        new Date().toISOString(),
      );
      repo.run(
        "DELETE FROM draft_attachments WHERE user_id=? AND channel_id=? AND parent_key=?",
        req.auth!.id,
        channelId,
        parent,
      );
      attachmentIds.forEach((id, position) =>
        repo.run(
          "INSERT INTO draft_attachments VALUES(?,?,?,?,?)",
          req.auth!.id,
          channelId,
          parent,
          id,
          position,
        ),
      );
      return {
        saved: draft(req.auth!.id, channelId, parent),
        channelId,
        parent,
      };
    });
    if (result.conflict)
      return res.status(409).json({
        error: "Taslak başka bir cihazda değişti.",
        code: "DRAFT_CONFLICT",
        draft: result.conflict,
      });
    const { saved, channelId, parent } = result;
    io.to(`workspace-user:${req.auth!.workspace_id}:${req.auth!.id}`).emit(
      "draft:changed",
      {
        workspaceId: req.auth!.workspace_id,
        channelId,
        parentId: parent,
        ...saved,
      },
    );
    res.json(saved);
  });
  app.get("/api/notifications/preferences", (req, res) =>
    res.json({
      pushEnabled: Boolean(
        repo.get(
          "SELECT push_enabled FROM notification_preferences WHERE user_id=?",
          req.auth!.id,
        )?.push_enabled,
      ),
      publicKey: vapidDetails.publicKey,
      userId: req.auth!.id,
      sessionBinding: pushSessionBinding(req.sessionHash!),
    }),
  );
  app.patch("/api/notifications/preferences", (req, res) => {
    requirePushContext(req);
    const { pushEnabled } = parse(
      z.object({ pushEnabled: z.boolean() }).strict(),
      req.body,
    );
    repo.run(
      "INSERT INTO notification_preferences VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET push_enabled=excluded.push_enabled",
      req.auth!.id,
      pushEnabled ? 1 : 0,
    );
    res.json({ pushEnabled });
  });
  app.post("/api/notifications/subscriptions", (req, res) => {
    const input = parse(
      z.object({
        endpoint: z
          .string()
          .max(2048)
          .refine(
            validPushEndpoint,
            "Bu tarayıcının bildirim sunucusu desteklenmiyor.",
          ),
        keys: z.object({
          p256dh: z.string().regex(/^[\w-]{87}$/),
          auth: z.string().regex(/^[\w-]{22}$/),
        }),
        restore: z.boolean().optional(),
      }),
      req.body,
    );
    requirePushContext(req, input.restore === true);
    if (
      input.restore &&
      !repo.get(
        "SELECT 1 FROM notification_preferences WHERE user_id=? AND push_enabled=1",
        req.auth!.id,
      )
    )
      throw new HttpError(409, "Bildirim tercihiniz kapalı.", "PUSH_DISABLED");
    if (
      Buffer.from(input.keys.p256dh, "base64url").length !== 65 ||
      Buffer.from(input.keys.p256dh, "base64url")[0] !== 4 ||
      Buffer.from(input.keys.auth, "base64url").length !== 16
    )
      throw new HttpError(400, "Bildirim anahtarları geçersiz.");
    try {
      ECDH.convertKey(
        Buffer.from(input.keys.p256dh, "base64url"),
        "prime256v1",
      );
    } catch {
      throw new HttpError(400, "Bildirim anahtarları geçersiz.");
    }
    if (
      repo.get(
        "SELECT count(*) AS n FROM push_subscriptions WHERE user_id=?",
        req.auth!.id,
      )!.n >= 20 &&
      !repo.get(
        "SELECT id FROM push_subscriptions WHERE endpoint=? AND user_id=?",
        input.endpoint,
        req.auth!.id,
      )
    )
      throw new HttpError(409, "En fazla 20 cihaz için bildirim açabilirsin.");
    repo.transaction(() => {
      // A browser may move between accounts or log in again. Never keep the old
      // account's queued deliveries attached to the newly registered endpoint.
      repo.run(
        "DELETE FROM push_subscriptions WHERE endpoint=? AND (user_id!=? OR session_hash!=? OR p256dh!=? OR auth!=?)",
        input.endpoint,
        req.auth!.id,
        req.sessionHash!,
        input.keys.p256dh,
        input.keys.auth,
      );
      repo.run(
        `INSERT INTO push_subscriptions VALUES(?,?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,session_hash=excluded.session_hash,p256dh=excluded.p256dh,auth=excluded.auth`,
        randomUUID(),
        req.auth!.id,
        req.sessionHash!,
        input.endpoint,
        input.keys.p256dh,
        input.keys.auth,
        new Date().toISOString(),
      );
    });
    res.status(201).json({ ok: true });
  });
  app.delete("/api/notifications/subscriptions", (req, res) => {
    requirePushContext(req);
    const input = parse(
      z.object({ endpoint: z.string().max(2048) }).strict(),
      req.body,
    );
    repo.run(
      "DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=? AND session_hash=?",
      input.endpoint,
      req.auth!.id,
      req.sessionHash!,
    );
    res.status(204).end();
  });
  let closing = false;
  let pendingPush: Promise<void> | undefined;
  const deliverPush = async () => {
    const jobs = repo.all(
      `SELECT id FROM push_outbox WHERE next_attempt<=? ORDER BY next_attempt,id LIMIT 20`,
      Date.now(),
    );
    for (const queued of jobs) {
      if (closing) break;
      // Re-read after each awaited delivery. A logout, role change or endpoint
      // reassignment while another request was in flight invalidates old work.
      const job = repo.get(
        `SELECT p.*,n.user_id,n.workspace_id,n.channel_id,n.message_id,n.read_at,s.user_id AS subscriber_id,s.session_hash,s.endpoint,s.p256dh,s.auth FROM push_outbox p JOIN notifications n ON n.id=p.notification_id JOIN push_subscriptions s ON s.id=p.subscription_id WHERE p.id=?`,
        queued.id,
      );
      if (!job) continue;
      const session = repo.session(job.session_hash);
      if (
        !session ||
        session.id !== job.user_id ||
        job.subscriber_id !== job.user_id ||
        requiresVerification(session) ||
        job.read_at ||
        !repo.canAccessChannel(job.user_id, job.channel_id, job.workspace_id) ||
        !repo.get(
          "SELECT 1 FROM notification_preferences WHERE user_id=? AND push_enabled=1",
          job.user_id,
        )
      ) {
        repo.run("DELETE FROM push_outbox WHERE id=?", job.id);
        continue;
      }
      try {
        await sendPush(
          {
            endpoint: job.endpoint,
            keys: { p256dh: job.p256dh, auth: job.auth },
          },
          JSON.stringify({
            title: "Mola",
            body: "Yeni bir bildirimin var.",
            url: `/?workspace=${job.workspace_id}&message=${job.message_id}`,
            tag: job.notification_id,
          }),
          { vapidDetails, TTL: 300, timeout: 5000 },
        );
        repo.run("DELETE FROM push_outbox WHERE id=?", job.id);
      } catch (error) {
        const status = (error as { statusCode?: number } | null)?.statusCode;
        if (status === 404 || status === 410)
          repo.run(
            "DELETE FROM push_subscriptions WHERE id=?",
            job.subscription_id,
          );
        else if (job.attempts >= 4)
          repo.run("DELETE FROM push_outbox WHERE id=?", job.id);
        else
          repo.run(
            "UPDATE push_outbox SET attempts=attempts+1,next_attempt=? WHERE id=?",
            Date.now() + Math.min(300000, 10000 * 2 ** job.attempts),
            job.id,
          );
      }
    }
  };
  const processPush = (): Promise<void> => {
    if (closing) return Promise.resolve();
    if (!pendingPush)
      pendingPush = deliverPush()
        .catch(() => {
          console.warn(JSON.stringify({ event: "push_queue_failure" }));
        })
        .finally(() => {
          pendingPush = undefined;
        });
    return pendingPush;
  };
  const timer = setInterval(() => void processPush(), 5000);
  timer.unref();
  // The caller owns the transaction; effects are returned for after commit.
  const prepareMessageCreated = (messageId: string) => {
    const message = repo.get(
      "SELECT m.*,c.workspace_id,c.kind FROM messages m JOIN channels c ON c.id=m.channel_id WHERE m.id=?",
      messageId,
    );
    if (!message) return;
    const actor = repo.member(message.user_id, message.workspace_id);
    if (!actor) return;
    const normalized = message.content
      .normalize("NFKC")
      .toLocaleLowerCase("tr-TR");
    const allMention =
      /(^|\s)@kanal(?=$|[\s.,!?;:])/u.test(normalized) &&
      actor.role !== "guest";
    const members = repo
      .members(message.workspace_id)
      .filter(
        (u) =>
          u.id !== message.user_id &&
          repo.canAccessChannel(u.id, message.channel_id, message.workspace_id),
      );
    const names = new Map<string, number>();
    for (const u of members) {
      const name = u.name
        .normalize("NFKC")
        .replaceAll(" ", "")
        .toLocaleLowerCase("tr-TR");
      names.set(name, (names.get(name) || 0) + 1);
    }
    for (const member of members) {
      const name = member.name
        .normalize("NFKC")
        .replaceAll(" ", "")
        .toLocaleLowerCase("tr-TR");
      const explicit = normalized.includes(`@[${member.id}]`);
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const mentioned =
        explicit ||
        (names.get(name) === 1 &&
          new RegExp(`(^|\\s)@${escaped}(?=$|[\\s.,!?;:])`, "u").test(
            normalized,
          ));
      const isReply =
        message.parent_id &&
        repo.get(
          "SELECT id FROM messages WHERE (id=? OR parent_id=?) AND user_id=? LIMIT 1",
          message.parent_id,
          message.parent_id,
          member.id,
        );
      const kind = mentioned
        ? "mention"
        : allMention
          ? "channel"
          : message.kind === "dm"
            ? "dm"
            : isReply
              ? "reply"
              : null;
      if (!kind) continue;
      const id = randomUUID();
      const inserted = repo.run(
        "INSERT OR IGNORE INTO notifications(id,user_id,workspace_id,channel_id,message_id,kind,created_at) VALUES(?,?,?,?,?,?,?)",
        id,
        member.id,
        message.workspace_id,
        message.channel_id,
        message.id,
        kind,
        message.created_at,
      );
      if (
        Number(inserted.changes) === 1 &&
        repo.get(
          "SELECT 1 FROM notification_preferences WHERE user_id=? AND push_enabled=1",
          member.id,
        )
      )
        for (const sub of repo.all(
          "SELECT id FROM push_subscriptions WHERE user_id=?",
          member.id,
        ))
          repo.run(
            "INSERT OR IGNORE INTO push_outbox(id,notification_id,subscription_id,next_attempt) SELECT ?,id,?,? FROM notifications WHERE user_id=? AND message_id=?",
            randomUUID(),
            sub.id,
            Date.now(),
            member.id,
            message.id,
          );
    }
    return () => {
      for (const member of members) emitState(member.id, message.workspace_id);
      emitState(message.user_id, message.workspace_id);
      void processPush();
    };
  };
  const onMessageCreated = (messageId: string) =>
    repo.transaction(() => prepareMessageCreated(messageId))?.();
  const prepareDraftClear = (
    userId: string,
    channelId: string,
    parent = "",
    sentContent?: string,
    sentAttachmentIds: string[] = [],
    sentRevision?: number,
  ) => {
    const current = draft(userId, channelId, parent);
    if (
      (sentContent !== undefined &&
        current.content.trim() !== sentContent.trim()) ||
      !sameAttachmentIds(current.attachmentIds, sentAttachmentIds) ||
      (sentRevision !== undefined && current.revision !== sentRevision)
    )
      return;
    if (!current.content && current.attachmentIds.length === 0) return;
    const workspaceId = repo.get(
      "SELECT workspace_id FROM channels WHERE id=?",
      channelId,
    )?.workspace_id;
    if (!workspaceId) return;
    repo.run(
      "UPDATE message_drafts SET content='',revision=revision+1,updated_at=? WHERE user_id=? AND channel_id=? AND parent_key=?",
      new Date().toISOString(),
      userId,
      channelId,
      parent,
    );
    repo.run(
      "DELETE FROM draft_attachments WHERE user_id=? AND channel_id=? AND parent_key=?",
      userId,
      channelId,
      parent,
    );
    const saved = draft(userId, channelId, parent);
    return () =>
      io
        .to(`workspace-user:${workspaceId}:${userId}`)
        .emit("draft:changed", {
          workspaceId,
          channelId,
          parentId: parent,
          ...saved,
        });
  };
  return {
    state,
    onMessageCreated,
    prepareMessageCreated,
    prepareDraftClear,
    emitState,
    flushPush: processPush,
    refreshChannel: (channelId: string) => {
      repo.run(
        "DELETE FROM message_drafts WHERE channel_id=? AND parent_key!='' AND NOT EXISTS(SELECT 1 FROM messages WHERE messages.id=message_drafts.parent_key AND messages.channel_id=message_drafts.channel_id)",
        channelId,
      );
      const workspaceId = repo.get(
        "SELECT workspace_id FROM channels WHERE id=?",
        channelId,
      )?.workspace_id;
      if (workspaceId)
        for (const member of repo.members(workspaceId))
          emitState(member.id, workspaceId);
    },
    cleanup: () => {
      repo.run(
        "DELETE FROM message_drafts WHERE parent_key!='' AND NOT EXISTS(SELECT 1 FROM messages WHERE messages.id=message_drafts.parent_key AND messages.channel_id=message_drafts.channel_id)",
      );
      repo.run(
        "DELETE FROM push_subscriptions WHERE NOT EXISTS(SELECT 1 FROM sessions WHERE sessions.token_hash=push_subscriptions.session_hash AND sessions.user_id=push_subscriptions.user_id AND sessions.expires_at>?)",
        Date.now(),
      );
    },
    clearDraft: (
      userId: string,
      channelId: string,
      parent = "",
      sentContent?: string,
    ) =>
      repo.transaction(() =>
        prepareDraftClear(userId, channelId, parent, sentContent),
      )?.(),
    close: async () => {
      closing = true;
      clearInterval(timer);
      for (const timer of stateTimers.values()) clearTimeout(timer);
      stateTimers.clear();
      await pendingPush;
    },
  };
}
