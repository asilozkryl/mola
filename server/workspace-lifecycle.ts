import type { Express, Request, Response } from "express";
import type { Server } from "socket.io";
import rateLimit from "express-rate-limit";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { SessionBootstrap } from "../shared/types.js";
import type { Repository, Row } from "./db.js";
import { HttpError } from "./errors.js";
import { recordAudit } from "./admin.js";
import { closeCallRoom, refreshVoiceAccess } from "./calls.js";

export function installWorkspaceLifecycle(
  app: Express,
  options: {
    repo: Repository;
    io: Server;
    uploadDir: string;
    verifyPassword: (
      password: string,
      stored: string | null,
    ) => Promise<boolean>;
    bootstrap: (user: Row) => SessionBootstrap;
    removeWorkspaceAvatar?: (version: unknown) => void;
  },
) {
  const { repo, io } = options;
  const respond = (req: Request, res: Response) => {
    const session = repo.session(req.sessionHash!);
    if (!session || session.id !== req.auth!.id || session.suspended_at)
      throw new HttpError(401, "Oturumunuz sona erdi. Yeniden giriş yapın.");
    res.json(options.bootstrap(session));
  };
  const current = (req: Request, owner: boolean) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw new HttpError(404, "Çalışma alanı bulunamadı.");
    const actor = repo.session(req.sessionHash!);
    if (!actor || actor.id !== req.auth!.id)
      throw new HttpError(401, "Oturumunuz sona erdi. Yeniden giriş yapın.");
    if (actor.workspace_id !== req.auth!.workspace_id)
      throw new HttpError(
        409,
        "Çalışma alanınız değişti. Güncel alan yükleniyor.",
        "WORKSPACE_CHANGED",
      );
    if (!actor.workspace_id || actor.workspace_id !== id.data)
      throw new HttpError(404, "Çalışma alanı bulunamadı.");
    const workspace = repo.get("SELECT * FROM workspaces WHERE id=?", id.data);
    if (!workspace) throw new HttpError(404, "Çalışma alanı bulunamadı.");
    if (
      actor.suspended_at ||
      actor.membership_suspended_at ||
      actor.membership_removed_at ||
      workspace.suspended_at
    )
      throw new HttpError(
        403,
        "Bu çalışma alanındaki üyeliğiniz etkin değil.",
        "MEMBERSHIP_SUSPENDED",
      );
    if (workspace.is_demo)
      throw new HttpError(403, "Örnek çalışma alanında bu işlem kullanılamaz.");
    if (owner && actor.role !== "owner")
      throw new HttpError(
        403,
        "Çalışma alanını yalnızca mevcut sahibi silebilir.",
      );
    return { actor, workspace };
  };
  const counts = (workspaceId: string) => ({
    members: Number(
      repo.get(
        "SELECT count(*) AS n FROM workspace_members WHERE workspace_id=? AND removed_at IS NULL",
        workspaceId,
      )!.n,
    ),
    channels: Number(
      repo.get(
        "SELECT count(*) AS n FROM channels WHERE workspace_id=? AND kind!='dm'",
        workspaceId,
      )!.n,
    ),
    messages: Number(
      repo.get(
        "SELECT count(*) AS n FROM messages m JOIN channels c ON c.id=m.channel_id WHERE c.workspace_id=?",
        workspaceId,
      )!.n,
    ),
    files: Number(
      repo.get(
        "SELECT count(*) AS n FROM attachments WHERE workspace_id=?",
        workspaceId,
      )!.n,
    ),
    storageBytes: Number(
      repo.get(
        "SELECT coalesce(sum(size),0) AS n FROM attachments WHERE workspace_id=?",
        workspaceId,
      )!.n,
    ),
  });
  // Called under the same write lock as the membership/workspace mutation.
  const relocateSessions = (workspaceId: string, userId?: string) => {
    const sessions = repo.all(
      `SELECT token_hash,user_id FROM sessions WHERE workspace_id=?${userId ? " AND user_id=?" : ""}`,
      workspaceId,
      ...(userId ? [userId] : []),
    );
    for (const session of sessions)
      repo.run(
        "UPDATE sessions SET workspace_id=? WHERE token_hash=?",
        repo.fallbackWorkspace(session.user_id, workspaceId),
        session.token_hash,
      );
    return sessions;
  };
  const notify = (
    workspaceId: string,
    userIds: string[],
    sessions: Row[],
    reason: "deleted" | "left",
  ) => {
    // Other active workspaces only refresh their switcher; their sockets/media stay.
    for (const id of new Set(userIds))
      io.to(`user:${id}`).emit("workspace:changed", {
        removedWorkspaceId: workspaceId,
        reason,
      });
    for (const session of sessions)
      io.in(`session:${session.token_hash}`).disconnectSockets(true);
  };
  const lifecycleLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error: "Çok fazla çalışma alanı işlemi. 15 dakika sonra yeniden deneyin.",
    },
  });
  app.get("/api/workspaces/:id/deletion-preview", (req, res) => {
    const { workspace } = current(req, true);
    res.json({ workspaceName: workspace.name, counts: counts(workspace.id) });
  });
  app.delete("/api/workspaces/:id", lifecycleLimiter, async (req, res) => {
    const parsed = z
      .object({
        confirmName: z.string().min(1).max(60),
        password: z.string().min(1).max(128),
      })
      .strict()
      .safeParse(req.body);
    if (!parsed.success)
      throw new HttpError(
        400,
        "Çalışma alanının adını ve mevcut parolanızı girin.",
      );
    const initial = current(req, true);
    if (
      !initial.actor.password_hash ||
      !(await options.verifyPassword(
        parsed.data.password,
        initial.actor.password_hash,
      ))
    )
      throw new HttpError(401, "Mevcut parolanız hatalı.");
    const deleted = repo.transaction(() => {
      const { actor, workspace } = current(req, true);
      if (actor.password_hash !== initial.actor.password_hash)
        throw new HttpError(
          401,
          "Parolanız değişti. Güncel parolanızla tekrar deneyin.",
        );
      if (workspace.name !== parsed.data.confirmName)
        throw new HttpError(
          400,
          "Onaylamak için çalışma alanının güncel adını eksiksiz yazın.",
        );
      const users = repo
        .all(
          "SELECT user_id FROM workspace_members WHERE workspace_id=?",
          workspace.id,
        )
        .map((row) => row.user_id as string);
      const channels = repo.all(
        "SELECT id FROM channels WHERE workspace_id=?",
        workspace.id,
      );
      const files = repo.all(
        "SELECT storage_name FROM attachments WHERE workspace_id=?",
        workspace.id,
      );
      const sessions = relocateSessions(workspace.id);
      recordAudit(
        repo,
        actor,
        workspace.id,
        "workspace.deleted",
        "workspace",
        workspace.id,
        JSON.stringify({ name: workspace.name, counts: counts(workspace.id) }),
      );
      repo.run("DELETE FROM workspaces WHERE id=?", workspace.id);
      return {
        id: workspace.id as string,
        users,
        channels,
        files,
        sessions,
        avatarVersion: workspace.avatar_version,
      };
    });
    options.removeWorkspaceAvatar?.(deleted.avatarVersion);
    for (const channel of deleted.channels) {
      closeCallRoom(
        io,
        channel.id,
        "Bu çalışma alanı silindi. Görüşme kapatıldı.",
      );
      io.in(`channel:${channel.id}`).socketsLeave(`channel:${channel.id}`);
    }
    notify(deleted.id, deleted.users, deleted.sessions, "deleted");
    for (const file of deleted.files) {
      if (
        !/^[a-f0-9-]{36}\.bin$/.test(file.storage_name) ||
        repo.get(
          "SELECT id FROM attachments WHERE storage_name=?",
          file.storage_name,
        )
      )
        continue;
      try {
        unlinkSync(join(options.uploadDir, file.storage_name));
      } catch {
        /* Existing hourly orphan maintenance retries after commit. */
      }
    }
    respond(req, res);
  });
  app.post("/api/workspaces/:id/leave", lifecycleLimiter, async (req, res) => {
    if (
      !z
        .object({})
        .strict()
        .safeParse(req.body ?? {}).success
    )
      throw new HttpError(400, "Gönderilen bilgileri kontrol edin.");
    const left = repo.transaction(() => {
      const { actor, workspace } = current(req, false);
      if (actor.role === "owner")
        throw new HttpError(
          409,
          "Ayrılmadan önce çalışma alanının sahipliğini başka bir üyeye devredin.",
          "OWNERSHIP_REQUIRED",
        );
      const now = new Date().toISOString();
      repo.run(
        "UPDATE workspace_members SET removed_at=?,left_at=? WHERE workspace_id=? AND user_id=?",
        now,
        now,
        workspace.id,
        actor.id,
      );
      // Returning through a workspace invite must never restore private channels.
      repo.run(
        "DELETE FROM channel_members WHERE user_id=? AND channel_id IN (SELECT id FROM channels WHERE workspace_id=?)",
        actor.id,
        workspace.id,
      );
      repo.run(
        "DELETE FROM notifications WHERE user_id=? AND workspace_id=?",
        actor.id,
        workspace.id,
      );
      repo.run(
        "DELETE FROM message_drafts WHERE user_id=? AND channel_id IN (SELECT id FROM channels WHERE workspace_id=?)",
        actor.id,
        workspace.id,
      );
      repo.run(
        "DELETE FROM channel_reads WHERE user_id=? AND channel_id IN (SELECT id FROM channels WHERE workspace_id=?)",
        actor.id,
        workspace.id,
      );
      const sessions = relocateSessions(workspace.id, actor.id);
      recordAudit(
        repo,
        actor,
        workspace.id,
        "workspace.member.left",
        "user",
        actor.id,
      );
      return {
        id: workspace.id as string,
        userId: actor.id as string,
        sessions,
      };
    });
    await refreshVoiceAccess(io, left.id);
    notify(left.id, [left.userId], left.sessions, "left");
    io.to(`workspace:${left.id}`).emit("admin:refresh");
    respond(req, res);
  });
}
