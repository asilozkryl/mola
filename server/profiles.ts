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
import { Repository, type Row } from "./db.js";
import { HttpError } from "./errors.js";
import { updateCallUser } from "./calls.js";
import type { MemberProfile } from "../shared/types.js";

const uuid = z.string().uuid();
const avatarName =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.webp$/;
const profileInput = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Adınız en az 2 karakter olmalı.")
      .max(60, "Adınız en fazla 60 karakter olabilir.")
      .optional(),
    status: z
      .string()
      .trim()
      .max(100, "Durum en fazla 100 karakter olabilir.")
      .optional(),
    jobTitle: z
      .string()
      .trim()
      .max(80, "Unvan en fazla 80 karakter olabilir.")
      .optional(),
    bio: z
      .string()
      .trim()
      .max(500, "Hakkımda en fazla 500 karakter olabilir.")
      .optional(),
    location: z
      .string()
      .trim()
      .max(80, "Konum en fazla 80 karakter olabilir.")
      .optional(),
  })
  .strict()
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    "Kaydetmek için profil bilgilerinizi düzenleyin.",
  );

/** Installed after the authenticated, verified and active-workspace API gate. */
export function installProfileRoutes(
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
  const avatarDir = resolve(uploadDir, "avatars");
  const active = (row: Row | undefined) =>
    Boolean(
      row &&
      !row.suspended_at &&
      !row.membership_suspended_at &&
      !row.membership_removed_at,
    );
  const actor = (req: Request) => {
    const current = repo.session(req.sessionHash!);
    if (!current)
      throw new HttpError(401, "Oturumunuz sona erdi. Yeniden giriş yapın.");
    if (
      current.id !== req.auth!.id ||
      current.workspace_id !== req.auth!.workspace_id
    )
      throw new HttpError(
        409,
        "Hesabınız veya çalışma alanınız değişti. Güncel alan yükleniyor.",
        "WORKSPACE_CHANGED",
      );
    if (!active(current))
      throw new HttpError(
        403,
        "Hesabınızın bu çalışma alanına erişimi etkin değil.",
        current.suspended_at ? "ACCOUNT_SUSPENDED" : "MEMBERSHIP_SUSPENDED",
      );
    if (repo.workspace(current.workspace_id).suspended)
      throw new HttpError(
        403,
        "Bu çalışma alanı askıya alındı.",
        "WORKSPACE_SUSPENDED",
      );
    if (requiresVerification(current))
      throw new HttpError(
        403,
        "Profili güncellemek için e-posta adresinizi doğrulayın.",
        "EMAIL_NOT_VERIFIED",
      );
    return current;
  };
  const profileMember = (id: unknown, workspaceId: string) => {
    const member = uuid.safeParse(id).success
      ? repo.member(String(id), workspaceId)
      : undefined;
    if (!member || !active(member))
      throw new HttpError(
        404,
        "Bu profil bulunamadı veya artık bu çalışma alanında değil.",
      );
    return member;
  };
  const publish = (userId: string) => {
    // Profiles are account-wide; roles and image URLs remain scoped to each team.
    for (const workspace of repo.workspaces(userId)) {
      if (workspace.suspended || workspace.membershipSuspended) continue;
      const row = repo.member(userId, workspace.id);
      if (!row || !active(row)) continue;
      const user = repo.user(row);
      io.to(`workspace:${workspace.id}`).emit("member:updated", user);
      updateCallUser(io, workspace.id, user);
    }
  };
  const removeFile = (version: unknown) => {
    const name = `${version}.webp`;
    if (!avatarName.test(name)) return;
    try {
      unlinkSync(join(avatarDir, name));
    } catch {
      /* Maintenance retries orphaned files after a crash or a temporary file lock. */
    }
  };

  app.get("/api/members/:id/profile", (req, res) => {
    const current = actor(req);
    const member = profileMember(req.params.id, current.workspace_id);
    const existingDm =
      current.id !== member.id &&
      repo.get(
        "SELECT c.id FROM channels c WHERE c.workspace_id=? AND c.kind='dm' AND EXISTS (SELECT 1 FROM channel_members WHERE channel_id=c.id AND user_id=?) AND EXISTS (SELECT 1 FROM channel_members WHERE channel_id=c.id AND user_id=?)",
        current.workspace_id,
        current.id,
        member.id,
      );
    const user = repo.user(member);
    const profile: MemberProfile = {
      user,
      joinedAt: member.joined_at,
      canMessage:
        !user.isBot &&
        current.id !== member.id &&
        Boolean(
          (current.role !== "guest" && member.role !== "guest") || existingDm,
        ),
    };
    res.setHeader("Cache-Control", "private, no-store");
    res.json(profile);
  });

  app.patch("/api/profile", (req, res) => {
    const parsed = profileInput.safeParse(req.body);
    if (!parsed.success)
      throw new HttpError(
        400,
        parsed.error.issues[0]?.message || "Profil bilgilerinizi kontrol edin.",
      );
    const input = parsed.data;
    const user = repo.transaction(() => {
      const current = actor(req);
      repo.run(
        "UPDATE users SET name=?,status=?,job_title=?,bio=?,location=? WHERE id=?",
        input.name ?? current.name,
        input.status ?? current.status,
        input.jobTitle ?? current.job_title,
        input.bio ?? current.bio,
        input.location ?? current.location,
        current.id,
      );
      return repo.user(repo.member(current.id, current.workspace_id)!);
    });
    publish(user.id);
    res.json(user);
  });

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
              ? "Profil fotoğrafı en fazla 5 MB olabilir."
              : "Tek bir profil fotoğrafı seçin.",
          ),
        );
      next(error);
    });
  const limit = rateLimit({
    windowMs: 60_000,
    limit: 12,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error:
        "Fotoğraf yükleme sınırına ulaştınız. Bir dakika sonra tekrar deneyin.",
    },
  });
  app.post("/api/profile/avatar", limit, multipart, async (req, res) => {
    actor(req);
    const buffer = req.file?.buffer;
    if (!buffer?.length)
      throw new HttpError(400, "Yüklemek için bir profil fotoğrafı seçin.");
    // Reject non-raster formats before invoking a decoder; MIME and file names are untrusted.
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
      // Decoding validates pixel data, respects camera orientation, removes metadata
      // and flattens animated input to one small static image.
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
    let previous: string | null = null;
    let written = false;
    let user;
    try {
      user = repo.transaction(() => {
        // Upload and decoding are asynchronous: recheck session identity and access
        // under the write lock before creating a file or changing this account.
        const current = actor(req);
        previous = current.avatar_version;
        mkdirSync(avatarDir, { recursive: true });
        writeFileSync(join(avatarDir, `${version}.webp`), image, {
          flag: "wx",
          mode: 0o600,
        });
        written = true;
        repo.run(
          "UPDATE users SET avatar_version=? WHERE id=?",
          version,
          current.id,
        );
        return repo.user(repo.member(current.id, current.workspace_id)!);
      });
    } catch (error) {
      if (written) removeFile(version);
      throw error;
    }
    removeFile(previous);
    publish(user.id);
    res.json(user);
  });

  app.delete("/api/profile/avatar", (req, res) => {
    const result = repo.transaction(() => {
      const current = actor(req);
      repo.run("UPDATE users SET avatar_version=NULL WHERE id=?", current.id);
      return {
        user: repo.user(repo.member(current.id, current.workspace_id)!),
        previous: current.avatar_version,
      };
    });
    removeFile(result.previous);
    publish(result.user.id);
    res.json(result.user);
  });

  app.get(
    "/api/workspaces/:workspaceId/members/:id/avatar/:version",
    (req, res, next) => {
      const current = actor(req);
      if (
        req.params.workspaceId !== current.workspace_id ||
        !uuid.safeParse(req.params.version).success
      )
        throw new HttpError(404, "Profil fotoğrafı bulunamadı.");
      const member = profileMember(req.params.id, current.workspace_id);
      if (
        !member.avatar_version ||
        member.avatar_version !== req.params.version
      )
        throw new HttpError(404, "Profil fotoğrafı bulunamadı.");
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Type", "image/webp");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.sendFile(
        join(avatarDir, `${member.avatar_version}.webp`),
        (error) => {
          if (error) next(new HttpError(404, "Profil fotoğrafı bulunamadı."));
        },
      );
    },
  );

  return {
    cleanup() {
      if (!existsSync(avatarDir)) return;
      for (const file of readdirSync(avatarDir)) {
        if (
          !avatarName.test(file) ||
          repo.get(
            "SELECT id FROM users WHERE avatar_version=?",
            file.slice(0, -5),
          )
        )
          continue;
        try {
          if (Date.now() - statSync(join(avatarDir, file)).mtimeMs > 60_000)
            unlinkSync(join(avatarDir, file));
        } catch {
          /* A locked file can be retried on the next maintenance pass. */
        }
      }
    },
  };
}
