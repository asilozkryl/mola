import type { DatabaseSync } from "node:sqlite";
import type { Express, Request, RequestHandler } from "express";
import type { Server } from "socket.io";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import multer from "multer";
import rateLimit from "express-rate-limit";
import sharp from "sharp";
import { z } from "zod";
import type { Repository, Row } from "./db.js";
import type { Workspace, WorkspaceOrderState } from "../shared/types.js";
import { HttpError } from "./errors.js";
import { recordAudit } from "./admin.js";

const uuid = z.string().uuid();
const avatarName =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.webp$/;

export function migrateWorkspacePresentation(db: DatabaseSync) {
  if (
    !(db.prepare("PRAGMA table_info(workspaces)").all() as Row[]).some(
      (column) => column.name === "avatar_version",
    )
  )
    db.exec("ALTER TABLE workspaces ADD COLUMN avatar_version TEXT");
  db.exec(`CREATE TABLE IF NOT EXISTS workspace_order_preferences (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL DEFAULT 0,
    workspace_ids_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
}

/** Historical or stale preferences can never add or hide a membership. */
export function normalizeWorkspaceOrder(
  available: string[],
  stored: unknown,
): string[] {
  const allowed = new Set(available);
  const result = new Set<string>();
  if (Array.isArray(stored))
    for (const id of stored)
      if (typeof id === "string" && allowed.has(id)) result.add(id);
  for (const id of available) result.add(id);
  return [...result];
}

export function readWorkspaceOrder(value: unknown): unknown {
  try {
    return JSON.parse(typeof value === "string" ? value : "[]");
  } catch {
    return [];
  }
}

const orderInput = z
  .object({
    revision: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER - 1),
    workspaceIds: z
      .array(uuid)
      .max(1000)
      .refine((ids) => new Set(ids).size === ids.length),
  })
  .strict();

export function installWorkspacePresentation(
  app: Express,
  {
    repo,
    io,
    uploadDir,
    requiresVerification,
  }: {
    repo: Repository;
    io: Server;
    uploadDir: string;
    requiresVerification: (user: Row) => boolean;
  },
) {
  const avatarDir = resolve(uploadDir, "workspace-avatars");
  const account = (req: Request) => {
    const actor = repo.session(req.sessionHash!);
    if (!actor)
      throw new HttpError(401, "Oturumunuz sona erdi. Yeniden giriş yapın.");
    if (actor.id !== req.auth!.id)
      throw new HttpError(
        409,
        "Hesabınız değişti. Güncel hesap yükleniyor.",
        "WORKSPACE_CHANGED",
      );
    if (actor.suspended_at)
      throw new HttpError(403, "Hesabınız askıya alındı.", "ACCOUNT_SUSPENDED");
    if (requiresVerification(actor))
      throw new HttpError(
        403,
        "Devam etmek için e-posta adresinizi doğrulayın.",
        "EMAIL_NOT_VERIFIED",
      );
    return actor;
  };
  const stateFor = (userId: string): WorkspaceOrderState => ({
    userId,
    revision:
      repo.get(
        "SELECT revision FROM workspace_order_preferences WHERE user_id=?",
        userId,
      )?.revision ?? 0,
    workspaceIds: repo.workspaces(userId).map((workspace) => workspace.id),
  });
  app.get("/api/workspace-order", (req, res) =>
    res.json(stateFor(account(req).id)),
  );
  app.put("/api/workspace-order", (req, res) => {
    const parsed = orderInput.safeParse(req.body);
    if (!parsed.success)
      throw new HttpError(400, "Çalışma alanı sırasını kontrol edin.");
    const state = repo.transaction(() => {
      const actor = account(req);
      const current = stateFor(actor.id);
      if (parsed.data.revision !== current.revision)
        throw new HttpError(
          409,
          "Çalışma alanı sıranız başka bir cihazda değişti. Güncel sırayı yükleyip yeniden deneyin.",
          "WORKSPACE_ORDER_REVISION_CONFLICT",
        );
      const available = repo
        .all(
          "SELECT wm.workspace_id FROM workspace_members wm JOIN workspaces w ON w.id=wm.workspace_id WHERE wm.user_id=? AND wm.removed_at IS NULL ORDER BY wm.joined_at,w.id",
          actor.id,
        )
        .map((row) => row.workspace_id as string);
      const allowed = new Set(available);
      if (parsed.data.workspaceIds.some((id) => !allowed.has(id)))
        throw new HttpError(
          400,
          "Yalnızca üyesi olduğunuz çalışma alanlarını sıralayabilirsiniz.",
        );
      const workspaceIds = normalizeWorkspaceOrder(
        available,
        parsed.data.workspaceIds,
      );
      repo.run(
        "INSERT INTO workspace_order_preferences(user_id,revision,workspace_ids_json,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET revision=excluded.revision,workspace_ids_json=excluded.workspace_ids_json,updated_at=excluded.updated_at",
        actor.id,
        current.revision + 1,
        JSON.stringify(workspaceIds),
        new Date().toISOString(),
      );
      return {
        userId: actor.id as string,
        revision: current.revision + 1,
        workspaceIds,
      };
    });
    io.to(`user:${state.userId}`).emit("workspace-order:updated", state);
    res.json(state);
  });

  const writer = (req: Request) => {
    const actor = account(req);
    if (actor.workspace_id !== req.auth!.workspace_id)
      throw new HttpError(
        409,
        "Çalışma alanınız değişti. Güncel alan yükleniyor.",
        "WORKSPACE_CHANGED",
      );
    if (
      !uuid.safeParse(req.params.id).success ||
      !actor.workspace_id ||
      req.params.id !== actor.workspace_id
    )
      throw new HttpError(404, "Çalışma alanı bulunamadı.");
    const workspace = repo.get(
      "SELECT * FROM workspaces WHERE id=?",
      actor.workspace_id,
    );
    if (!workspace) throw new HttpError(404, "Çalışma alanı bulunamadı.");
    if (
      actor.membership_suspended_at ||
      actor.membership_removed_at ||
      workspace.suspended_at
    )
      throw new HttpError(
        403,
        "Bu çalışma alanındaki üyeliğiniz etkin değil.",
        "MEMBERSHIP_SUSPENDED",
      );
    if (!["owner", "admin"].includes(actor.role))
      throw new HttpError(
        403,
        "Çalışma alanı fotoğrafını yalnızca alan sahibi veya yöneticisi değiştirebilir.",
      );
    return { actor, workspace };
  };
  const publish = (workspace: Workspace) => {
    const members = repo.all(
      "SELECT wm.user_id FROM workspace_members wm JOIN users u ON u.id=wm.user_id WHERE wm.workspace_id=? AND wm.removed_at IS NULL AND wm.suspended_at IS NULL AND u.suspended_at IS NULL",
      workspace.id,
    );
    if (members.length)
      io.to(members.map((member) => `user:${member.user_id}`)).emit(
        "workspace:updated",
        workspace,
      );
  };
  const removeAvatar = (version: unknown) => {
    if (
      !uuid.safeParse(version).success ||
      repo.get(
        "SELECT id FROM workspaces WHERE avatar_version=?",
        String(version),
      )
    )
      return;
    try {
      unlinkSync(join(avatarDir, `${version}.webp`));
    } catch {
      /* Orphan maintenance retries a temporary file lock or process crash. */
    }
  };
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0, parts: 2 },
  }).single("file");
  const multipart: RequestHandler = (req, res, next) =>
    upload(req, res, (error) => {
      if (error instanceof multer.MulterError)
        return next(
          new HttpError(
            error.code === "LIMIT_FILE_SIZE" ? 413 : 400,
            error.code === "LIMIT_FILE_SIZE"
              ? "Çalışma alanı fotoğrafı en fazla 5 MB olabilir."
              : "Tek bir çalışma alanı fotoğrafı seçin.",
          ),
        );
      next(error);
    });
  const authorize: RequestHandler = (req, _res, next) => {
    try {
      writer(req);
      next();
    } catch (error) {
      next(error);
    }
  };
  const uploadLimit = rateLimit({
    windowMs: 60_000,
    limit: 12,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error:
        "Fotoğraf yükleme sınırına ulaştınız. Bir dakika sonra tekrar deneyin.",
    },
  });
  app.post(
    "/api/workspaces/:id/avatar",
    uploadLimit,
    authorize,
    multipart,
    async (req, res) => {
      const buffer = req.file?.buffer;
      if (!buffer?.length)
        throw new HttpError(
          400,
          "Yüklemek için bir çalışma alanı fotoğrafı seçin.",
        );
      const png = buffer
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const jpeg = buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
      const webp =
        buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
        buffer.subarray(8, 12).toString("ascii") === "WEBP";
      if (!png && !jpeg && !webp)
        throw new HttpError(
          400,
          "PNG, JPG veya WebP biçiminde bir fotoğraf seçin.",
        );
      let image: Buffer;
      try {
        image = await sharp(buffer, {
          limitInputPixels: 25_000_000,
          failOn: "warning",
        })
          .rotate()
          .resize(512, 512, {
            fit: "cover",
            position: "centre",
            withoutEnlargement: true,
          })
          .webp({ quality: 84 })
          .toBuffer();
      } catch {
        throw new HttpError(
          400,
          "Bu fotoğraf okunamadı. Geçerli ve en fazla 25 megapiksel bir PNG, JPG veya WebP fotoğrafı seçin.",
        );
      }
      const version = randomUUID();
      let previous: unknown;
      let written = false;
      let updated: Workspace;
      try {
        updated = repo.transaction(() => {
          // Decode and multipart reading are asynchronous; validate the live session
          // and role again under the write lock before committing either resource.
          const { actor, workspace } = writer(req);
          previous = workspace.avatar_version;
          mkdirSync(avatarDir, { recursive: true });
          writeFileSync(join(avatarDir, `${version}.webp`), image, {
            flag: "wx",
            mode: 0o600,
          });
          written = true;
          repo.run(
            "UPDATE workspaces SET avatar_version=? WHERE id=?",
            version,
            workspace.id,
          );
          recordAudit(
            repo,
            actor,
            workspace.id,
            "workspace.avatar.updated",
            "workspace",
            workspace.id,
          );
          return repo.workspace(workspace.id);
        });
      } catch (error) {
        if (written) removeAvatar(version);
        throw error;
      }
      removeAvatar(previous);
      publish(updated);
      res.json(updated);
    },
  );
  app.delete("/api/workspaces/:id/avatar", (req, res) => {
    const result = repo.transaction(() => {
      const { actor, workspace } = writer(req);
      repo.run(
        "UPDATE workspaces SET avatar_version=NULL WHERE id=?",
        workspace.id,
      );
      recordAudit(
        repo,
        actor,
        workspace.id,
        "workspace.avatar.removed",
        "workspace",
        workspace.id,
      );
      return {
        previous: workspace.avatar_version,
        workspace: repo.workspace(workspace.id),
      };
    });
    removeAvatar(result.previous);
    publish(result.workspace);
    res.json(result.workspace);
  });
  app.get("/api/workspaces/:id/avatar/:version", (req, res, next) => {
    const actor = account(req);
    const id = uuid.safeParse(req.params.id),
      version = uuid.safeParse(req.params.version);
    if (!id.success || !version.success)
      throw new HttpError(404, "Çalışma alanı fotoğrafı bulunamadı.");
    // Rail images belong to every active membership, not just the selected one.
    const workspace = repo.get(
      "SELECT w.avatar_version FROM workspaces w JOIN workspace_members wm ON wm.workspace_id=w.id WHERE w.id=? AND wm.user_id=? AND w.suspended_at IS NULL AND wm.suspended_at IS NULL AND wm.removed_at IS NULL",
      id.data,
      actor.id,
    );
    if (!workspace || workspace.avatar_version !== version.data)
      throw new HttpError(404, "Çalışma alanı fotoğrafı bulunamadı.");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.sendFile(join(avatarDir, `${version.data}.webp`), (error) => {
      if (error)
        next(new HttpError(404, "Çalışma alanı fotoğrafı bulunamadı."));
    });
  });
  return {
    removeAvatar,
    cleanup() {
      if (!existsSync(avatarDir)) return;
      for (const name of readdirSync(avatarDir)) {
        if (!avatarName.test(name)) continue;
        try {
          if (Date.now() - statSync(join(avatarDir, name)).mtimeMs > 60_000)
            removeAvatar(name.slice(0, -5));
        } catch {
          /* Retry on the next maintenance pass. */
        }
      }
    },
  };
}
