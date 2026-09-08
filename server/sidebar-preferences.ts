import type { DatabaseSync } from "node:sqlite";
import type { Express, Request } from "express";
import type { Server } from "socket.io";
import { z } from "zod";
import type { Repository, Row } from "./db.js";
import { HttpError } from "./errors.js";
import {
  normalizeSidebarPreferences,
  type SidebarPreferencesState,
  type SidebarConversationsState,
} from "../shared/sidebar.js";

export function migrateSidebarPreferences(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS sidebar_preferences (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL DEFAULT 0,
    state_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(user_id,workspace_id)
  );`);
}

const ids = z.array(z.string().uuid()).max(1000);
const preferencesSchema = z
  .object({
    textOrder: ids,
    voiceOrder: ids,
    favoriteIds: ids,
    collapsedSections: z
      .array(z.enum(["favorites", "channels", "voice", "dms"]))
      .max(4),
    width: z.number().int().min(240).max(340).optional(),
    channelGroups: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            name: z.string().trim().min(1).max(48),
            channelIds: ids,
            collapsed: z.boolean(),
          })
          .strict(),
      )
      .max(20)
      .optional(),
  })
  .strict()
  .superRefine((preferences, context) => {
    const groupIds = new Set<string>(),
      channelIds = new Set<string>();
    for (const group of preferences.channelGroups || []) {
      if (groupIds.has(group.id))
        context.addIssue({
          code: "custom",
          message: "Bölüm kimlikleri benzersiz olmalı.",
        });
      groupIds.add(group.id);
      for (const id of group.channelIds) {
        if (channelIds.has(id))
          context.addIssue({
            code: "custom",
            message: "Bir kanal yalnızca bir kişisel bölümde bulunabilir.",
          });
        channelIds.add(id);
      }
    }
  });
const updateSchema = z
  .object({
    revision: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER - 1),
    preferences: preferencesSchema,
  })
  .strict();

export function installSidebarRoutes(
  app: Express,
  { repo, io }: { repo: Repository; io: Server },
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
  const stateFor = (actor: Row): SidebarPreferencesState => {
    const row = repo.get(
      "SELECT revision,state_json FROM sidebar_preferences WHERE user_id=? AND workspace_id=?",
      actor.id,
      actor.workspace_id,
    );
    let stored = {};
    try {
      const parsed = preferencesSchema.safeParse(
        JSON.parse(row?.state_json || "{}"),
      );
      if (parsed.success) stored = parsed.data;
    } catch {
      /* A malformed historical preference cannot hide accessible channels. */
    }
    return {
      userId: actor.id,
      workspaceId: actor.workspace_id,
      revision: row?.revision || 0,
      preferences: normalizeSidebarPreferences(
        stored,
        repo.channels(actor.id, actor.workspace_id),
      ),
    };
  };

  app.get("/api/sidebar-preferences", (req, res) =>
    res.json(stateFor(actorFor(req))),
  );
  app.patch("/api/sidebar-preferences", (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success)
      throw new HttpError(400, "Kenar çubuğu düzenini kontrol edin.");
    const next = repo.transaction(() => {
      const actor = actorFor(req);
      const current = stateFor(actor);
      if (current.revision !== parsed.data.revision)
        throw new HttpError(
          409,
          "Kenar çubuğu başka bir sekmede değişti. Güncel düzen yüklendi; yeniden deneyebilirsin.",
          "SIDEBAR_REVISION_CONFLICT",
        );
      const channels = repo
        .channels(actor.id, actor.workspace_id)
        .filter((channel) => !channel.archived && channel.kind !== "dm");
      const available = new Map(
        channels.map((channel) => [channel.id, channel]),
      );
      const submitted = {
        ...parsed.data.preferences,
        ...(parsed.data.preferences.channelGroups === undefined &&
        current.preferences.channelGroups !== undefined
          ? { channelGroups: current.preferences.channelGroups }
          : {}),
      };
      for (const [key, kind] of [
        ["textOrder", "text"],
        ["voiceOrder", "voice"],
        ["favoriteIds", undefined],
      ] as const) {
        for (const id of submitted[key]) {
          const channel = available.get(id);
          if (!channel || (kind && channel.kind !== kind))
            throw new HttpError(
              404,
              "Kanal bulunamadı. Kanal listesini yenileyip tekrar deneyin.",
            );
        }
      }
      for (const group of submitted.channelGroups || []) {
        for (const id of group.channelIds) {
          if (available.get(id)?.kind !== "text")
            throw new HttpError(
              404,
              "Kanal bulunamadı. Kanal listesini yenileyip tekrar deneyin.",
            );
        }
      }
      const preferences = normalizeSidebarPreferences(submitted, channels);
      const revision = current.revision + 1;
      repo.run(
        `INSERT INTO sidebar_preferences(user_id,workspace_id,revision,state_json,updated_at) VALUES(?,?,?,?,?)
        ON CONFLICT(user_id,workspace_id) DO UPDATE SET revision=excluded.revision,state_json=excluded.state_json,updated_at=excluded.updated_at`,
        actor.id,
        actor.workspace_id,
        revision,
        JSON.stringify(preferences),
        new Date().toISOString(),
      );
      return {
        userId: actor.id as string,
        workspaceId: actor.workspace_id as string,
        revision,
        preferences,
      };
    });
    io.to(`workspace-user:${next.workspaceId}:${next.userId}`).emit(
      "sidebar:updated",
      next,
    );
    res.json(next);
  });

  app.get("/api/sidebar-conversations", (req, res) => {
    const actor = actorFor(req);
    const allowed = repo
      .channels(actor.id, actor.workspace_id)
      .filter((channel) => channel.kind === "dm" && !channel.archived)
      .map((channel) => channel.id);
    const conversations = allowed.length
      ? repo
          .all(
            `
      SELECT c.id AS channel_id,cm.user_id,
        MAX(COALESCE((SELECT MAX(created_at) FROM messages WHERE channel_id=c.id),''),
            COALESCE((SELECT MAX(updated_at) FROM message_drafts WHERE channel_id=c.id AND user_id=? AND length(trim(content))>0),'')) AS last_activity_at,
        COALESCE((SELECT content FROM messages WHERE channel_id=c.id ORDER BY created_at DESC,id DESC LIMIT 1),'') AS preview,
        EXISTS(SELECT 1 FROM message_drafts WHERE channel_id=c.id AND user_id=? AND length(trim(content))>0) AS has_draft
      FROM channels c JOIN channel_members cm ON cm.channel_id=c.id AND cm.user_id!=?
      JOIN workspace_members wm ON wm.workspace_id=c.workspace_id AND wm.user_id=cm.user_id
      JOIN users u ON u.id=cm.user_id
      WHERE c.workspace_id=? AND c.id IN (SELECT value FROM json_each(?))
        AND wm.removed_at IS NULL AND wm.suspended_at IS NULL AND u.suspended_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM bot_accounts WHERE user_id=u.id)
        AND (EXISTS(SELECT 1 FROM messages WHERE channel_id=c.id)
          OR EXISTS(SELECT 1 FROM message_drafts WHERE channel_id=c.id AND user_id=? AND length(trim(content))>0))
      ORDER BY last_activity_at DESC,c.id,cm.user_id LIMIT 50`,
            actor.id,
            actor.id,
            actor.id,
            actor.workspace_id,
            JSON.stringify(allowed),
            actor.id,
          )
          .map((row) => ({
            channelId: row.channel_id as string,
            userId: row.user_id as string,
            lastActivityAt: row.last_activity_at as string,
            preview: (row.preview as string).slice(0, 140),
            hasDraft: Boolean(row.has_draft),
          }))
      : [];
    const state: SidebarConversationsState = {
      userId: actor.id,
      workspaceId: actor.workspace_id,
      conversations,
    };
    res.json(state);
  });
}
