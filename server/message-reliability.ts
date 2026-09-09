import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Express, Request } from "express";
import { z } from "zod";
import type { Attachment, Message } from "../shared/types.js";
import type { Repository, Row } from "./db.js";
import type { installCollaborationData } from "./collaboration-data.js";
import { HttpError } from "./errors.js";

export function migrateMessageReliability(db: DatabaseSync) {
  db.exec(`CREATE TABLE message_requests (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    client_message_id TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(user_id,workspace_id,client_message_id)
  );
  CREATE INDEX idx_message_requests_message ON message_requests(message_id);
  CREATE TABLE draft_attachments (
    user_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    parent_key TEXT NOT NULL DEFAULT '',
    attachment_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY(user_id,channel_id,parent_key,attachment_id),
    FOREIGN KEY(user_id,channel_id,parent_key) REFERENCES message_drafts(user_id,channel_id,parent_key) ON DELETE CASCADE
  );
  CREATE INDEX idx_draft_attachments_file ON draft_attachments(attachment_id);
  CREATE TRIGGER deleted_thread_drafts AFTER DELETE ON messages BEGIN
    DELETE FROM message_drafts WHERE channel_id=OLD.channel_id AND parent_key=OLD.id;
  END;`);
}

export class AttachmentUnavailableError extends HttpError {
  constructor(public unavailableAttachmentIds: string[]) {
    super(
      409,
      "Bazı dosyalar kullanılamıyor. Göndermeden önce yeniden yükle veya taslaktan kaldır.",
      "ATTACHMENT_UNAVAILABLE",
    );
  }
}

export function draftAttachmentIds(
  repo: Repository,
  userId: string,
  channelId: string,
  parent: string,
) {
  return repo
    .all(
      "SELECT attachment_id FROM draft_attachments WHERE user_id=? AND channel_id=? AND parent_key=? ORDER BY position,attachment_id",
      userId,
      channelId,
      parent,
    )
    .map((row) => String(row.attachment_id));
}

export function attachmentAvailability(
  repo: Repository,
  uploadDir: string,
  userId: string,
  workspaceId: string,
  ids: readonly string[],
) {
  const attachments: Attachment[] = [],
    unavailableAttachmentIds: string[] = [];
  for (const id of ids) {
    const file = repo.get(
      "SELECT * FROM attachments WHERE id=? AND user_id=? AND workspace_id=? AND message_id IS NULL",
      id,
      userId,
      workspaceId,
    );
    const retained =
      file &&
      repo.get(
        "SELECT 1 FROM draft_attachments d JOIN channels c ON c.id=d.channel_id WHERE d.attachment_id=? AND d.user_id=? AND c.workspace_id=? LIMIT 1",
        id,
        userId,
        workspaceId,
      );
    if (
      file &&
      (retained ||
        Date.parse(file.created_at) >= Date.now() - 24 * 60 * 60_000) &&
      /^[a-f0-9-]{36}\.bin$/.test(file.storage_name) &&
      existsSync(join(uploadDir, file.storage_name))
    )
      attachments.push(repo.attachment(file));
    else unavailableAttachmentIds.push(id);
  }
  return { attachments, unavailableAttachmentIds };
}

export function sameAttachmentIds(
  first: readonly string[],
  second: readonly string[],
) {
  return (
    first.length === second.length &&
    [...first].sort().every((id, index) => id === [...second].sort()[index])
  );
}

const uuid = z.string().uuid();
const sendSchema = z
  .object({
    content: z.string().trim().max(10000).default(""),
    parentId: uuid.optional(),
    attachmentIds: z.array(uuid).max(4).default([]),
    clientMessageId: uuid.optional(),
    draftRevision: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
  })
  .refine(
    (input) => input.content.length > 0 || input.attachmentIds.length > 0,
    { message: "Bir mesaj yazın veya dosya ekleyin." },
  );

export function installReliableMessages(
  app: Express,
  {
    repo,
    uploadDir,
    collaboration,
    requireActiveWorkspace,
    requireChannel,
    requireMessage,
    broadcastMessage,
  }: {
    repo: Repository;
    uploadDir: string;
    collaboration: ReturnType<typeof installCollaborationData>;
    requireActiveWorkspace: (req: Request) => void;
    requireChannel: (req: Request, id: string) => Row;
    requireMessage: (req: Request, id: string) => Row;
    broadcastMessage: (id: string, event?: string) => Message;
  },
) {
  app.post("/api/channels/:id/messages", (req, res) => {
    const parsed = sendSchema.safeParse(req.body),
      channelId = uuid.safeParse(req.params.id);
    if (!parsed.success)
      throw new HttpError(
        400,
        parsed.error.issues[0]?.message || "Mesajı kontrol edin.",
      );
    if (!channelId.success) throw new HttpError(404, "Kanal bulunamadı.");
    const input = parsed.data,
      attachmentIds = [...new Set(input.attachmentIds)];
    const payloadHash = createHash("sha256")
      .update(
        JSON.stringify({
          channelId: channelId.data,
          parentId: input.parentId || "",
          content: input.content,
          attachmentIds: [...attachmentIds].sort(),
        }),
      )
      .digest("hex");
    const result = repo.transaction(() => {
      requireActiveWorkspace(req);
      const userId = req.auth!.id,
        workspaceId = req.auth!.workspace_id;
      if (!repo.canAccessChannel(userId, channelId.data, workspaceId))
        throw new HttpError(404, "Kanal bulunamadı.");
      const previous =
        input.clientMessageId &&
        repo.get(
          "SELECT * FROM message_requests WHERE user_id=? AND workspace_id=? AND client_message_id=?",
          userId,
          workspaceId,
          input.clientMessageId,
        );
      if (previous) {
        if (previous.payload_hash !== payloadHash)
          throw new HttpError(
            409,
            "Bu gönderim kimliği farklı bir mesaj için kullanılmış. Önceki gönderimi kontrol et.",
            "MESSAGE_ID_CONFLICT",
          );
        const message =
          previous.message_id &&
          repo.get(
            "SELECT * FROM messages WHERE id=? AND channel_id=?",
            previous.message_id,
            channelId.data,
          );
        if (!message)
          throw new HttpError(
            410,
            "Bu mesaj daha önce gönderildi ve ardından silindi.",
            "MESSAGE_ALREADY_DELETED",
          );
        return {
          message: repo.message(message),
          replay: true,
          publish: undefined,
        };
      }
      const channel = requireChannel(req, channelId.data);
      if (input.parentId) {
        const parent = requireMessage(req, input.parentId);
        if (parent.channel_id !== channel.id || parent.parent_id)
          throw new HttpError(400, "Geçersiz mesaj dizisi.");
      }
      const unavailable = attachmentAvailability(
        repo,
        uploadDir,
        userId,
        workspaceId,
        attachmentIds,
      ).unavailableAttachmentIds;
      if (unavailable.length) throw new AttachmentUnavailableError(unavailable);
      const id = randomUUID(),
        createdAt = new Date().toISOString();
      repo.run(
        "INSERT INTO messages VALUES(?,?,?,?,?,?,?,?)",
        id,
        channel.id,
        userId,
        input.content,
        createdAt,
        null,
        input.parentId || null,
        0,
      );
      for (const attachmentId of attachmentIds)
        repo.run(
          "UPDATE attachments SET message_id=? WHERE id=?",
          id,
          attachmentId,
        );
      if (input.clientMessageId)
        repo.run(
          "INSERT INTO message_requests VALUES(?,?,?,?,?,?)",
          userId,
          workspaceId,
          input.clientMessageId,
          payloadHash,
          id,
          createdAt,
        );
      const publishNotifications = collaboration.prepareMessageCreated(id);
      const publishDraft = collaboration.prepareDraftClear(
        userId,
        channel.id,
        input.parentId || "",
        input.content,
        attachmentIds,
        input.draftRevision,
      );
      return {
        message: repo.message(
          repo.get("SELECT * FROM messages WHERE id=?", id)!,
        ),
        replay: false,
        publish: () => {
          broadcastMessage(id, "message:created");
          publishDraft?.();
          publishNotifications?.();
          if (input.parentId) broadcastMessage(input.parentId);
        },
      };
    });
    // No socket event or push attempt may escape a transaction that rolls back.
    result.publish?.();
    if (result.replay) res.setHeader("Idempotent-Replay", "true");
    res.status(result.replay ? 200 : 201).json(result.message);
  });
}
