import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Express, Request } from "express";
import { z } from "zod";
import type { Repository, Row } from "./db.js";
import { HttpError } from "./errors.js";
import type {
  ChannelFile,
  ChannelFilesPage,
  ChannelPinsPage,
  MessageHistoryPage,
  MessageSearchPage,
} from "../shared/collection-types.js";

const uuid = z.string().uuid();
const instant = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());
const filters = {
  q: z.string().trim().max(200).default(""),
  userId: uuid.optional(),
  startAt: instant.optional(),
  endBefore: instant.optional(),
  cursor: z.string().min(1).max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
};
const collectionQuery = z.object(filters).strict();
const historyQuery = z
  .object({
    ...filters,
    parentId: uuid.optional(),
    before: z.string().min(1).max(64).optional(),
  })
  .strict();
const searchQuery = z
  .object({
    ...filters,
    channelId: uuid.optional(),
    hasFiles: z.enum(["true", "false"]).default("false"),
    // Retain old clients' UTC calendar-day filters and offset requests.
    from: z.iso.date().optional(),
    until: z.iso.date().optional(),
    offset: z.coerce.number().int().min(0).max(10000).default(0),
  })
  .strict();
type Filters = z.infer<typeof collectionQuery>;
const cursorSchema = z
  .object({
    version: z.literal(1),
    kind: z.enum(["files", "pins", "history", "search"]),
    userId: uuid,
    workspaceId: uuid,
    channelId: uuid.or(z.literal("")),
    parentId: uuid.or(z.literal("")),
    q: z.string().regex(/^[a-f0-9]{64}$/),
    authorId: uuid.or(z.literal("")),
    startAt: z.string().max(40),
    endBefore: z.string().max(40),
    hasFiles: z.boolean(),
    at: z.string().min(1).max(40),
    id: uuid,
  })
  .strict();
type Cursor = z.infer<typeof cursorSchema>;
type Context = Omit<Cursor, "version" | "at" | "id">;
const fold = (value: string) =>
  value.normalize("NFKC").toLocaleLowerCase("tr-TR");
const pattern = (value: string) =>
  `%${fold(value).replace(/[\\%_]/g, "\\$&")}%`;
const parse = <T>(schema: z.ZodType<T>, input: unknown): T => {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new HttpError(400, "Liste filtrelerini kontrol edin.");
  return result.data;
};
function validateDates(query: Pick<Filters, "startAt" | "endBefore">) {
  if (query.startAt && query.endBefore && query.startAt >= query.endBefore)
    throw new HttpError(400, "Bitiş tarihi başlangıçtan sonra olmalı.");
}

export function installCollections(
  app: Express,
  {
    repo,
    key,
    requireActiveWorkspace,
    requireChannel,
    requireMessage,
  }: {
    repo: Repository;
    key: Buffer;
    requireActiveWorkspace: (req: Request) => void;
    requireChannel: (req: Request, id: string) => Row;
    requireMessage: (req: Request, id: string) => Row;
  },
) {
  const actorFor = (req: Request) => {
    requireActiveWorkspace(req);
    const actor = repo.session(req.sessionHash!)!;
    if (actor.id !== req.auth!.id)
      throw new HttpError(
        409,
        "Bu tarayıcıdaki hesap değişti.",
        "WORKSPACE_CHANGED",
      );
    return actor;
  };
  const signature = (payload: string) =>
    createHmac("sha256", key).update(`mola/collections/v1:${payload}`).digest();
  const encode = (context: Context, row: Row) => {
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
  const decode = (raw: string | undefined, context: Context) => {
    if (!raw) return null;
    try {
      if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
      const [payload, tag] = raw.split("."),
        supplied = Buffer.from(tag, "base64url"),
        expected = signature(payload);
      if (
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)
      )
        throw new Error();
      const cursor = cursorSchema.parse(
        JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
      );
      for (const field of Object.keys(context) as (keyof Context)[])
        if (cursor[field] !== context[field]) throw new Error();
      return cursor;
    } catch {
      throw new HttpError(
        400,
        "Sayfa bilgisi geçersiz. Listeyi yenileyip tekrar deneyin.",
        "INVALID_COLLECTION_CURSOR",
      );
    }
  };
  const contextFor = (
    actor: Row,
    kind: Context["kind"],
    query: Filters,
    channelId = "",
    parentId = "",
    hasFiles = false,
  ): Context => ({
    kind,
    userId: actor.id,
    workspaceId: actor.workspace_id,
    channelId,
    parentId,
    // Unicode normalization can expand a valid short query; keep cursors bounded.
    q: createHash("sha256").update(fold(query.q)).digest("hex"),
    authorId: query.userId || "",
    startAt: query.startAt || "",
    endBefore: query.endBefore || "",
    hasFiles,
  });
  const filtered = (
    query: Filters,
    dateColumn: "a.created_at" | "m.created_at",
    fileRows = false,
  ) => {
    const conditions: string[] = [],
      values: (string | number)[] = [];
    if (query.q) {
      conditions.push(
        fileRows
          ? "(fold_text(a.name) LIKE ? ESCAPE '\\' OR fold_text(m.content) LIKE ? ESCAPE '\\')"
          : "(fold_text(m.content) LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM attachments f WHERE f.message_id=m.id AND fold_text(f.name) LIKE ? ESCAPE '\\'))",
      );
      values.push(pattern(query.q), pattern(query.q));
    }
    if (query.userId) {
      conditions.push("m.user_id=?");
      values.push(query.userId);
    }
    if (query.startAt) {
      conditions.push(`${dateColumn}>=?`);
      values.push(query.startAt);
    }
    if (query.endBefore) {
      conditions.push(`${dateColumn}<?`);
      values.push(query.endBefore);
    }
    return { conditions, values };
  };
  const before = (
    cursor: Pick<Cursor, "at" | "id"> | null,
    dateColumn: string,
    idColumn: string,
    conditions: string[],
    values: (string | number)[],
  ) => {
    if (cursor) {
      conditions.push(
        `(${dateColumn}<? OR (${dateColumn}=? AND ${idColumn}<?))`,
      );
      values.push(cursor.at, cursor.at, cursor.id);
    }
  };

  app.get("/api/channels/:id/files", (req, res) => {
    const actor = actorFor(req),
      channel = requireChannel(req, String(req.params.id));
    const query = parse(collectionQuery, req.query);
    validateDates(query);
    const context = contextFor(actor, "files", query, channel.id),
      cursor = decode(query.cursor, context);
    const { conditions, values } = filtered(query, "a.created_at", true);
    conditions.unshift("m.channel_id=?", "a.workspace_id=?");
    values.unshift(channel.id, actor.workspace_id);
    const from = "FROM attachments a JOIN messages m ON m.id=a.message_id";
    const total = Number(
      repo.get(
        `SELECT COUNT(*) total ${from} WHERE ${conditions.join(" AND ")}`,
        ...values,
      )!.total,
    );
    before(cursor, "a.created_at", "a.id", conditions, values);
    const rows = repo.all(
      `SELECT a.*,m.channel_id,m.parent_id,m.user_id AS author_id,a.created_at AS sort_at,a.id AS sort_id ${from} WHERE ${conditions.join(" AND ")} ORDER BY a.created_at DESC,a.id DESC LIMIT ?`,
      ...values,
      query.limit + 1,
    );
    const page = rows.slice(0, query.limit),
      authors = new Map<string, ChannelFile["user"]>();
    const files: ChannelFile[] = page.map((row) => {
      let user = authors.get(row.author_id);
      if (!user) {
        // Historical authors retain workspace-scoped inactive membership metadata.
        user = repo.user(
          repo.member(row.author_id, actor.workspace_id) || {
            ...repo.get("SELECT * FROM users WHERE id=?", row.author_id)!,
            workspace_id: actor.workspace_id,
            role: "member",
            membership_removed_at: "historical",
          },
        );
        authors.set(row.author_id, user);
      }
      return {
        ...repo.attachment(row),
        messageId: row.message_id,
        channelId: row.channel_id,
        parentId: row.parent_id || null,
        createdAt: row.created_at,
        user,
      };
    });
    const result: ChannelFilesPage = {
      files,
      nextCursor:
        rows.length > query.limit ? encode(context, page.at(-1)!) : null,
      total,
    };
    res.json(result);
  });

  app.get("/api/channels/:id/pins", (req, res) => {
    const actor = actorFor(req),
      channel = requireChannel(req, String(req.params.id));
    const query = parse(collectionQuery, req.query);
    validateDates(query);
    const context = contextFor(actor, "pins", query, channel.id),
      cursor = decode(query.cursor, context);
    const { conditions, values } = filtered(query, "m.created_at");
    conditions.unshift("m.channel_id=?", "m.pinned=1");
    values.unshift(channel.id);
    const total = Number(
      repo.get(
        `SELECT COUNT(*) total FROM messages m WHERE ${conditions.join(" AND ")}`,
        ...values,
      )!.total,
    );
    before(cursor, "m.created_at", "m.id", conditions, values);
    const rows = repo.all(
      `SELECT m.*,m.created_at AS sort_at,m.id AS sort_id FROM messages m WHERE ${conditions.join(" AND ")} ORDER BY m.created_at DESC,m.id DESC LIMIT ?`,
      ...values,
      query.limit + 1,
    );
    const page = rows.slice(0, query.limit);
    const result: ChannelPinsPage = {
      messages: page.map((row) => repo.message(row)),
      nextCursor:
        rows.length > query.limit ? encode(context, page.at(-1)!) : null,
      total,
    };
    res.json(result);
  });

  app.get("/api/channels/:id/messages", (req, res) => {
    const actor = actorFor(req),
      channel = requireChannel(req, String(req.params.id));
    const query = parse(historyQuery, req.query);
    validateDates(query);
    if (query.cursor && query.before)
      throw new HttpError(400, "Tek bir sayfalama yöntemi kullanın.");
    if (query.parentId) {
      const parent = requireMessage(req, query.parentId);
      if (parent.channel_id !== channel.id || parent.parent_id)
        throw new HttpError(400, "Geçersiz mesaj dizisi.");
    }
    const context = contextFor(
        actor,
        "history",
        query,
        channel.id,
        query.parentId,
      ),
      cursor = decode(query.cursor, context);
    let anchor: Pick<Cursor, "at" | "id"> | null = cursor;
    if (query.before) {
      const existing = repo.get(
        "SELECT created_at,id FROM messages WHERE id=? AND channel_id=? AND parent_id IS ?",
        query.before,
        channel.id,
        query.parentId || null,
      );
      if (existing) anchor = { at: existing.created_at, id: existing.id };
      else if (!Number.isNaN(Date.parse(query.before)))
        anchor = { at: new Date(query.before).toISOString(), id: "" };
      else throw new HttpError(400, "Geçersiz sayfalama bilgisi.");
    }
    const { conditions, values } = filtered(query, "m.created_at");
    conditions.unshift("m.channel_id=?", "m.parent_id IS ?");
    // SQLite's nullable root-thread selector is deliberately independent of the cursor.
    const params = [channel.id, query.parentId || null, ...values];
    const beforeValues: (string | number)[] = [];
    before(anchor, "m.created_at", "m.id", conditions, beforeValues);
    const rows = repo.all(
      `SELECT m.*,m.created_at AS sort_at,m.id AS sort_id FROM messages m WHERE ${conditions.join(" AND ")} ORDER BY m.created_at DESC,m.id DESC LIMIT ?`,
      ...params,
      ...beforeValues,
      query.limit + 1,
    );
    const page = rows.slice(0, query.limit),
      nextCursor =
        rows.length > query.limit ? encode(context, page.at(-1)!) : null;
    const result: MessageHistoryPage = {
      messages: page.reverse().map((row) => repo.message(row)),
      hasMore: Boolean(nextCursor),
      nextCursor,
    };
    res.json(result);
  });

  app.get("/api/search", (req, res) => {
    const actor = actorFor(req),
      query = parse(searchQuery, req.query);
    if ((query.startAt && query.from) || (query.endBefore && query.until))
      throw new HttpError(400, "Aynı tarih sınırını iki kez belirtmeyin.");
    if (query.from) query.startAt = `${query.from}T00:00:00.000Z`;
    if (query.until)
      query.endBefore = new Date(
        Date.parse(`${query.until}T00:00:00Z`) + 86400000,
      ).toISOString();
    validateDates(query);
    if (
      query.q.length < 2 &&
      !query.channelId &&
      !query.userId &&
      !query.startAt &&
      !query.endBefore &&
      query.hasFiles !== "true"
    )
      throw new HttpError(
        400,
        "Aramak için en az 2 karakter yazın veya filtre seçin.",
      );
    if (query.cursor && query.offset)
      throw new HttpError(400, "Tek bir sayfalama yöntemi kullanın.");
    const context = contextFor(
        actor,
        "search",
        query,
        query.channelId,
        "",
        query.hasFiles === "true",
      ),
      cursor = decode(query.cursor, context);
    // Rebuild the allowlist for every page: possession of a cursor grants no access.
    const allowed = repo
      .channels(actor.id, actor.workspace_id)
      .filter((channel) => !query.channelId || channel.id === query.channelId)
      .map((channel) => channel.id);
    const { conditions, values } = filtered(query, "m.created_at");
    conditions.unshift("m.channel_id IN (SELECT value FROM json_each(?))");
    values.unshift(JSON.stringify(allowed));
    if (query.hasFiles === "true")
      conditions.push(
        "EXISTS(SELECT 1 FROM attachments a WHERE a.message_id=m.id)",
      );
    before(cursor, "m.created_at", "m.id", conditions, values);
    const rows = repo.all(
      `SELECT m.*,m.created_at AS sort_at,m.id AS sort_id FROM messages m WHERE ${conditions.join(" AND ")} ORDER BY m.created_at DESC,m.id DESC LIMIT ? OFFSET ?`,
      ...values,
      query.limit + 1,
      query.offset,
    );
    const page = rows.slice(0, query.limit),
      nextCursor =
        rows.length > query.limit ? encode(context, page.at(-1)!) : null;
    const result: MessageSearchPage = {
      messages: page.map((row) => repo.message(row)),
      hasMore: Boolean(nextCursor),
      nextCursor,
    };
    res.json(result);
  });
}
