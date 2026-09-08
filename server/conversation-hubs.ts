import { createHmac, timingSafeEqual } from "node:crypto";
import type { Express, Request } from "express";
import { z } from "zod";
import type { Repository, Row } from "./db.js";
import { HttpError } from "./errors.js";
import type {
  ActivityItem,
  ActivityPage,
  DirectConversationsPage,
} from "../shared/hub-types.js";

const baseQuery = {
  q: z.string().trim().max(200).default(""),
  unread: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  cursor: z.string().min(1).max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
};
const directQuery = z.object(baseQuery).strict();
const activityQuery = z
  .object({
    ...baseQuery,
    kind: z.enum(["all", "mention", "reply", "dm", "channel"]).default("all"),
  })
  .strict();
const cursorSchema = z
  .object({
    version: z.literal(1),
    hub: z.enum(["direct", "activity"]),
    userId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    q: z.string().max(200),
    unread: z.boolean(),
    kind: z.enum(["all", "mention", "reply", "dm", "channel"]),
    at: z.string().min(1).max(40),
    id: z.string().uuid(),
  })
  .strict();
type Cursor = z.infer<typeof cursorSchema>;
type CursorContext = Omit<Cursor, "version" | "at" | "id">;
const searchPattern = (query: string) =>
  `%${query
    .normalize("NFKC")
    .toLocaleLowerCase("tr-TR")
    .replace(/[\\%_]/g, "\\$&")}%`;

export function installConversationHubs(
  app: Express,
  { repo, key }: { repo: Repository; key: Buffer },
) {
  const actorFor = (req: Request) => {
    const actor = repo.session(req.sessionHash!);
    if (!actor)
      throw new HttpError(401, "Oturumunuz sona erdi. Yeniden giriş yapın.");
    if (
      actor.id !== req.auth!.id ||
      actor.workspace_id !== req.auth!.workspace_id
    )
      throw new HttpError(
        409,
        "Çalışma alanınız değişti. Güncel alan yükleniyor.",
        "WORKSPACE_CHANGED",
      );
    if (!actor.workspace_id)
      throw new HttpError(
        403,
        "Önce bir çalışma alanı seçin.",
        "WORKSPACE_REQUIRED",
      );
    const member = repo.member(actor.id, actor.workspace_id);
    const workspace = repo.get(
      "SELECT suspended_at FROM workspaces WHERE id=?",
      actor.workspace_id,
    );
    if (
      !member ||
      !workspace ||
      member.suspended_at ||
      member.membership_suspended_at ||
      member.membership_removed_at ||
      workspace.suspended_at
    )
      throw new HttpError(403, "Bu çalışma alanına erişiminiz yok.");
    return actor;
  };
  const signature = (payload: string) =>
    createHmac("sha256", key)
      .update(`mola/conversation-hubs/v1:${payload}`)
      .digest();
  const encode = (context: CursorContext, row: Row) => {
    const payload = Buffer.from(
      JSON.stringify({
        version: 1,
        ...context,
        at: row.sort_at,
        id: row.sort_id,
      }),
    ).toString("base64url");
    return `${payload}.${signature(payload).toString("base64url")}`;
  };
  const decode = (
    raw: string | undefined,
    context: CursorContext,
  ): Cursor | null => {
    if (!raw) return null;
    try {
      if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
      const [payload, tag] = raw.split(".");
      const supplied = Buffer.from(tag, "base64url"),
        expected = signature(payload);
      if (
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)
      )
        throw new Error();
      const parsed = cursorSchema.parse(
        JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
      );
      for (const field of [
        "hub",
        "userId",
        "workspaceId",
        "q",
        "unread",
        "kind",
      ] as const)
        if (parsed[field] !== context[field]) throw new Error();
      return parsed;
    } catch {
      throw new HttpError(
        400,
        "Sayfa bilgisi geçersiz. Listeyi yenileyip tekrar deneyin.",
        "INVALID_HUB_CURSOR",
      );
    }
  };
  const contextFor = (
    actor: Row,
    hub: "direct" | "activity",
    query: { q: string; unread: boolean; kind?: Cursor["kind"] },
  ): CursorContext => ({
    hub,
    userId: actor.id,
    workspaceId: actor.workspace_id,
    q: query.q,
    unread: query.unread,
    kind: query.kind || "all",
  });

  app.get("/api/direct-conversations", (req, res) => {
    const parsed = directQuery.safeParse(req.query);
    if (!parsed.success)
      throw new HttpError(400, "Konuşma filtrelerini kontrol edin.");
    const query = parsed.data,
      actor = actorFor(req),
      context = contextFor(actor, "direct", query);
    const cursor = decode(query.cursor, context);
    const allowed = repo
      .channels(actor.id, actor.workspace_id)
      .filter((channel) => channel.kind === "dm" && !channel.archived)
      .map((channel) => channel.id);
    const conditions = ["1=1"];
    const values: (string | number)[] = [
      actor.id,
      actor.id,
      actor.id,
      actor.id,
      actor.id,
      actor.id,
      actor.id,
      actor.workspace_id,
      JSON.stringify(allowed),
      actor.id,
    ];
    if (query.q) {
      conditions.push("fold_text(peer_name||' '||preview) LIKE ? ESCAPE '\\'");
      values.push(searchPattern(query.q));
    }
    if (query.unread) conditions.push("unread_count>0");
    if (cursor) {
      conditions.push("(sort_at<? OR (sort_at=? AND sort_id<?))");
      values.push(cursor.at, cursor.at, cursor.id);
    }
    values.push(query.limit + 1);
    const rows = allowed.length
      ? repo.all(
          `WITH conversations AS (
      SELECT c.id AS sort_id,c.id AS channel_id,cm.user_id,u.name AS peer_name,
        MAX(c.created_at,
          COALESCE((SELECT MAX(created_at) FROM messages WHERE channel_id=c.id),''),
          COALESCE((SELECT MAX(updated_at) FROM message_drafts WHERE channel_id=c.id AND user_id=? AND length(trim(content))>0),'')) AS sort_at,
        COALESCE((SELECT content FROM messages WHERE channel_id=c.id ORDER BY created_at DESC,id DESC LIMIT 1),'') AS preview,
        EXISTS(SELECT 1 FROM message_drafts WHERE channel_id=c.id AND user_id=? AND length(trim(content))>0) AS has_draft,
        (SELECT COUNT(*) FROM messages m JOIN message_order o ON o.message_id=m.id LEFT JOIN channel_reads r ON r.channel_id=m.channel_id AND r.user_id=? WHERE m.channel_id=c.id AND m.user_id!=? AND o.sequence>COALESCE(r.last_rowid,0)) AS unread_count,
        COALESCE((SELECT user_id=? FROM messages WHERE channel_id=c.id ORDER BY created_at DESC,id DESC LIMIT 1),0) AS last_message_by_self
      FROM channels c JOIN channel_members cm ON cm.channel_id=c.id AND cm.user_id!=?
      JOIN workspace_members wm ON wm.workspace_id=c.workspace_id AND wm.user_id=cm.user_id
      JOIN users u ON u.id=cm.user_id
      WHERE cm.user_id=(SELECT MIN(other.user_id) FROM channel_members other WHERE other.channel_id=c.id AND other.user_id!=?)
        AND c.workspace_id=? AND c.id IN (SELECT value FROM json_each(?))
        AND wm.removed_at IS NULL AND wm.suspended_at IS NULL AND u.suspended_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM bot_accounts WHERE user_id=u.id)
        AND EXISTS(SELECT 1 FROM channel_members mine WHERE mine.channel_id=c.id AND mine.user_id=?)
    ) SELECT * FROM conversations WHERE ${conditions.join(" AND ")} ORDER BY sort_at DESC,sort_id DESC LIMIT ?`,
          ...values,
        )
      : [];
    const page = rows.slice(0, query.limit);
    const result: DirectConversationsPage = {
      userId: actor.id,
      workspaceId: actor.workspace_id,
      items: page.map((row) => ({
        channelId: row.channel_id,
        userId: row.user_id,
        lastActivityAt: row.sort_at,
        preview: row.preview,
        hasDraft: Boolean(row.has_draft),
        unreadCount: Number(row.unread_count),
        lastMessageBySelf: Boolean(row.last_message_by_self),
      })),
      nextCursor:
        rows.length > query.limit ? encode(context, page.at(-1)!) : null,
    };
    res.json(result);
  });

  app.get("/api/activity", (req, res) => {
    const parsed = activityQuery.safeParse(req.query);
    if (!parsed.success)
      throw new HttpError(400, "Aktivite filtrelerini kontrol edin.");
    const query = parsed.data,
      actor = actorFor(req),
      context = contextFor(actor, "activity", query);
    const cursor = decode(query.cursor, context);
    const allowed = repo
      .channels(actor.id, actor.workspace_id)
      .map((channel) => channel.id);
    const conditions = ["1=1"];
    const values: (string | number)[] = [
      actor.id,
      actor.id,
      actor.workspace_id,
      actor.workspace_id,
      JSON.stringify(allowed),
      actor.id,
    ];
    if (query.kind !== "all") {
      conditions.push("kind=?");
      values.push(query.kind);
    }
    if (query.unread) conditions.push("read_at IS NULL");
    if (query.q) {
      conditions.push(
        "fold_text(actor_name||' '||channel_name||' '||content) LIKE ? ESCAPE '\\'",
      );
      values.push(searchPattern(query.q));
    }
    if (cursor) {
      conditions.push("(sort_at<? OR (sort_at=? AND sort_id<?))");
      values.push(cursor.at, cursor.at, cursor.id);
    }
    values.push(query.limit + 1);
    const rows = allowed.length
      ? repo.all(
          `WITH activity AS (
      SELECT n.id AS sort_id,n.created_at AS sort_at,n.*,u.name AS actor_name,m.user_id AS actor_id,m.content,
        CASE WHEN c.kind='dm' THEN (
          SELECT peer.name FROM channel_members cm JOIN users peer ON peer.id=cm.user_id
            JOIN workspace_members wm ON wm.workspace_id=c.workspace_id AND wm.user_id=peer.id
          WHERE cm.channel_id=c.id AND cm.user_id!=? AND peer.suspended_at IS NULL
            AND wm.suspended_at IS NULL AND wm.removed_at IS NULL
            AND NOT EXISTS(SELECT 1 FROM bot_accounts WHERE user_id=peer.id)
          ORDER BY peer.id LIMIT 1
        ) ELSE c.name END AS channel_name
      FROM notifications n JOIN messages m ON m.id=n.message_id AND m.channel_id=n.channel_id
        JOIN users u ON u.id=m.user_id JOIN channels c ON c.id=n.channel_id
      WHERE n.user_id=? AND n.workspace_id=? AND c.workspace_id=?
        AND n.channel_id IN (SELECT value FROM json_each(?))
        AND (c.kind!='dm' OR EXISTS(SELECT 1 FROM channel_members mine WHERE mine.channel_id=c.id AND mine.user_id=?))
    ) SELECT * FROM activity WHERE channel_name IS NOT NULL AND ${conditions.join(" AND ")}
      ORDER BY sort_at DESC,sort_id DESC LIMIT ?`,
          ...values,
        )
      : [];
    const page = rows.slice(0, query.limit);
    const result: ActivityPage = {
      userId: actor.id,
      workspaceId: actor.workspace_id,
      items: page.map((row): ActivityItem => ({
        id: row.id,
        workspaceId: row.workspace_id,
        channelId: row.channel_id,
        messageId: row.message_id,
        kind: row.kind,
        actorName: row.actor_name,
        actorId: row.actor_id,
        channelName: row.channel_name,
        preview: row.content,
        createdAt: row.created_at,
        read: Boolean(row.read_at),
      })),
      nextCursor:
        rows.length > query.limit ? encode(context, page.at(-1)!) : null,
    };
    res.json(result);
  });
}
