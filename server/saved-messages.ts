import { createHmac, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Express, Request } from "express";
import type { Server } from "socket.io";
import { z } from "zod";
import type { Repository, Row } from "./db.js";
import { HttpError } from "./errors.js";
import type {
  SavedMessageIds,
  SavedMessagesPage,
} from "../shared/saved-types.js";

export function migrateSavedMessages(db: DatabaseSync) {
  db.exec(`CREATE TABLE saved_messages (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    saved_at TEXT NOT NULL,
    UNIQUE(user_id,workspace_id,message_id)
  );
  CREATE INDEX idx_saved_messages_scope ON saved_messages(user_id,workspace_id,sequence DESC);
  CREATE INDEX idx_saved_messages_message ON saved_messages(message_id);
  CREATE TRIGGER saved_messages_workspace BEFORE INSERT ON saved_messages
    WHEN NOT EXISTS(SELECT 1 FROM messages m JOIN channels c ON c.id=m.channel_id WHERE m.id=NEW.message_id AND c.workspace_id=NEW.workspace_id)
    BEGIN SELECT RAISE(ABORT,'Saved message workspace mismatch'); END;`);
}

const idSchema = z.string().uuid();
const querySchema = z
  .object({
    q: z.string().trim().max(200).default(""),
    cursor: z.string().min(1).max(2048).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
const importSchema = z
  .object({
    messageIds: z.array(z.string().max(100)).max(500),
  })
  .strict();
const cursorSchema = z
  .object({
    version: z.literal(1),
    userId: idSchema,
    workspaceId: idSchema,
    q: z.string().max(200),
    before: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
type Cursor = z.infer<typeof cursorSchema>;
type CursorContext = Pick<Cursor, "userId" | "workspaceId" | "q">;
const searchPattern = (query: string) =>
  `%${query
    .normalize("NFKC")
    .toLocaleLowerCase("tr-TR")
    .replace(/[\\%_]/g, "\\$&")}%`;

export function installSavedMessages(
  app: Express,
  { repo, io, key }: { repo: Repository; io: Server; key: Buffer },
) {
  const actorFor = (req: Request): Row => {
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
      .update(`mola/saved-messages/v1:${payload}`)
      .digest();
  const encode = (context: CursorContext, before: number) => {
    const payload = Buffer.from(
      JSON.stringify({ version: 1, ...context, before }),
    ).toString("base64url");
    return `${payload}.${signature(payload).toString("base64url")}`;
  };
  const decode = (raw: string | undefined, context: CursorContext) => {
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
      if (
        parsed.userId !== context.userId ||
        parsed.workspaceId !== context.workspaceId ||
        parsed.q !== context.q
      )
        throw new Error();
      return parsed;
    } catch {
      throw new HttpError(
        400,
        "Sayfa bilgisi geçersiz. Kaydedilenleri yenileyip tekrar deneyin.",
        "INVALID_SAVED_CURSOR",
      );
    }
  };
  // Every read applies the same live public/private/guest membership rule as
  // canAccessChannel. Keeping an old bookmark never grants channel access.
  const selection = (actor: Row, q = "") => {
    const conditions = [
      "s.user_id=?",
      "s.workspace_id=?",
      "c.workspace_id=?",
      "((c.kind!='dm' AND c.visibility='public' AND ?!='guest') OR EXISTS(SELECT 1 FROM channel_members cm WHERE cm.channel_id=c.id AND cm.user_id=?))",
    ];
    const values: (string | number)[] = [
      actor.id,
      actor.workspace_id,
      actor.workspace_id,
      actor.role,
      actor.id,
    ];
    if (q) {
      conditions.push(
        `(fold_text(m.content||' '||u.name||' '||CASE WHEN c.kind='dm' THEN COALESCE((SELECT group_concat(peer.name,' ') FROM channel_members pcm JOIN users peer ON peer.id=pcm.user_id WHERE pcm.channel_id=c.id AND peer.id!=?), '') ELSE c.name END) LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM attachments a WHERE a.message_id=m.id AND fold_text(a.name) LIKE ? ESCAPE '\\'))`,
      );
      values.push(actor.id, searchPattern(q), searchPattern(q));
    }
    return { where: conditions.join(" AND "), values };
  };
  const from =
    "FROM saved_messages s JOIN messages m ON m.id=s.message_id JOIN channels c ON c.id=m.channel_id JOIN users u ON u.id=m.user_id";
  const changed = (actor: Row) =>
    io
      .to(`user:${actor.id}`)
      .emit("saved:changed", { workspaceId: actor.workspace_id });
  const accessibleMessage = (actor: Row, id: string) => {
    const message = repo.get("SELECT * FROM messages WHERE id=?", id);
    return message &&
      repo.canAccessChannel(actor.id, message.channel_id, actor.workspace_id)
      ? message
      : undefined;
  };
  const save = (actor: Row, id: string) =>
    repo.run(
      "INSERT INTO saved_messages(user_id,workspace_id,message_id,saved_at) VALUES(?,?,?,?) ON CONFLICT(user_id,workspace_id,message_id) DO NOTHING",
      actor.id,
      actor.workspace_id,
      id,
      new Date().toISOString(),
    ).changes;

  app.get("/api/saved", (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success)
      throw new HttpError(400, "Kaydedilen mesaj filtrelerini kontrol edin.");
    const actor = actorFor(req),
      query = parsed.data;
    const context: CursorContext = {
      userId: actor.id,
      workspaceId: actor.workspace_id,
      q: query.q,
    };
    const cursor = decode(query.cursor, context);
    const { where, values } = selection(actor, query.q);
    const total = Number(
      repo.get(`SELECT COUNT(*) AS total ${from} WHERE ${where}`, ...values)!
        .total,
    );
    const rows = repo.all(
      `SELECT m.*,s.sequence AS saved_sequence ${from} WHERE ${where}${cursor ? " AND s.sequence<?" : ""} ORDER BY s.sequence DESC LIMIT ?`,
      ...values,
      ...(cursor ? [cursor.before] : []),
      query.limit + 1,
    );
    const page = rows.slice(0, query.limit);
    const result: SavedMessagesPage = {
      items: page.map((row) => repo.message(row)),
      nextCursor:
        rows.length > query.limit
          ? encode(context, Number(page.at(-1)!.saved_sequence))
          : null,
      total,
    };
    res.json(result);
  });
  app.get("/api/saved/ids", (req, res) => {
    const actor = actorFor(req),
      { where, values } = selection(actor);
    const result: SavedMessageIds = {
      ids: repo
        .all(
          `SELECT m.id ${from} WHERE ${where} ORDER BY s.sequence DESC`,
          ...values,
        )
        .map((row) => row.id),
    };
    res.json(result);
  });
  app.post("/api/saved/import", (req, res) => {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success)
      throw new HttpError(
        400,
        "Tek seferde en fazla 500 mesaj kimliği aktarabilirsiniz.",
      );
    const actor = actorFor(req);
    // Legacy arrays are newest-first. Ignore malformed/stale IDs and preserve
    // the relative order of newly imported items without moving existing saves.
    const imported = repo.transaction(() => {
      let count = 0;
      const ids = [...new Set(parsed.data.messageIds)].filter(
        (id) => idSchema.safeParse(id).success,
      );
      for (const id of ids.reverse())
        if (accessibleMessage(actor, id)) count += Number(save(actor, id));
      return count;
    });
    if (imported) changed(actor);
    res.json({ imported });
  });
  app.put("/api/saved/:messageId", (req, res) => {
    const id = idSchema.safeParse(req.params.messageId);
    if (!id.success) throw new HttpError(400, "Mesaj kimliği geçersiz.");
    const actor = actorFor(req),
      message = accessibleMessage(actor, id.data);
    if (!message) throw new HttpError(404, "Mesaj bulunamadı.");
    if (save(actor, id.data)) changed(actor);
    res.json({ message: repo.message(message) });
  });
  app.delete("/api/saved/:messageId", (req, res) => {
    const id = idSchema.safeParse(req.params.messageId);
    if (!id.success) throw new HttpError(400, "Mesaj kimliği geçersiz.");
    const actor = actorFor(req);
    // Removing a stale bookmark is allowed without exposing whether its message
    // still exists or belongs to another user/workspace.
    if (
      repo.run(
        "DELETE FROM saved_messages WHERE user_id=? AND workspace_id=? AND message_id=?",
        actor.id,
        actor.workspace_id,
        id.data,
      ).changes
    )
      changed(actor);
    res.json({ ok: true });
  });
}
