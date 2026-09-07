import express, { type Express, type Request } from "express";
import { rateLimit } from "express-rate-limit";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Server } from "socket.io";
import { z } from "zod";
import type { Repository, Row } from "./db.js";
import { HttpError } from "./errors.js";
import { canManageWorkspace } from "./permissions.js";
import { recordAudit } from "./admin.js";

export function migrateIntegrations(db: DatabaseSync) {
  db.exec(`
  CREATE TABLE integrations(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,created_by TEXT NOT NULL REFERENCES users(id),bot_user_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('github','webhook')),repository TEXT NOT NULL DEFAULT '',token_hash TEXT NOT NULL,secret TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,last_delivery_at TEXT,last_status TEXT);
  CREATE INDEX idx_integrations_workspace ON integrations(workspace_id);
  CREATE TABLE integration_deliveries(integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,delivery_id TEXT NOT NULL,message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,received_at TEXT NOT NULL,PRIMARY KEY(integration_id,delivery_id));
  CREATE TABLE bot_accounts(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,integration_id TEXT NOT NULL UNIQUE REFERENCES integrations(id) ON DELETE CASCADE);
`);
}
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const parse = <T>(schema: z.ZodType<T>, input: unknown): T => {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new HttpError(
      400,
      result.error.issues[0]?.message || "Bilgileri kontrol edin.",
    );
  return result.data;
};
function string(value: unknown, max = 200) {
  return typeof value === "string" ? value.slice(0, max) : "";
}
export function githubMessage(
  event: string,
  input: unknown,
  repository: string,
): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new HttpError(400, "Olay gövdesi bir JSON nesnesi olmalı.");
  const payload = input as Record<string, any>;
  if (
    string(payload.repository?.full_name).toLowerCase() !==
    repository.toLowerCase()
  )
    throw new HttpError(403, "Depo eşleşmiyor.");
  const actor = string(payload.sender?.login) || "GitHub";
  const repoLink = `https://github.com/${repository}`;
  const text = (value: unknown) => string(value, 500).replace(/[\r\n]+/g, " ");
  if (event === "push")
    return `${actor}, ${repository} deposuna ${Array.isArray(payload.commits) ? payload.commits.length : 0} commit gönderdi.\nDal: ${text(payload.ref).replace("refs/heads/", "")}\n${(Array.isArray(
      payload.commits,
    )
      ? payload.commits
      : []
    )
      .slice(0, 5)
      .map((c: any) => `• ${text(c?.message)}`)
      .join("\n")}\n${repoLink}`;
  if (event === "pull_request" || event === "issues") {
    const item =
      event === "pull_request" ? payload.pull_request : payload.issue;
    const number = Number(item?.number || payload.number);
    if (!Number.isSafeInteger(number) || number < 1)
      throw new HttpError(400, "Olay numarası geçersiz.");
    return `${actor} · ${event === "pull_request" ? "Pull request" : "Issue"} #${number} · ${text(payload.action)}\n${text(item?.title)}\n${repoLink}/${event === "pull_request" ? "pull" : "issues"}/${number}`;
  }
  if (event === "workflow_run") {
    const run = payload.workflow_run;
    return `${repository} · ${text(run?.name) || "GitHub Actions"}\nDurum: ${text(run?.conclusion || run?.status)}\n${repoLink}/actions`;
  }
  if (event === "release")
    return `${repository} · Yeni sürüm: ${text(payload.release?.tag_name)}\n${text(payload.release?.name)}\n${repoLink}/releases`;
  return null;
}
export function verifyGitHubSignature(
  secret: string,
  body: Buffer,
  signature: string,
): boolean {
  if (!/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
export function createIntegrations({
  repo,
  io,
  key,
  origin,
  onMessageCreated,
}: {
  repo: Repository;
  io: Server;
  key: Buffer;
  origin: string;
  onMessageCreated: (id: string) => void;
}) {
  const encryption = Buffer.from(
    hkdfSync("sha256", key, Buffer.alloc(0), "mola/integrations/v1", 32),
  );
  const seal = (secret: string, id: string) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", encryption, iv);
    cipher.setAAD(Buffer.from(id));
    const encrypted = Buffer.concat([
      cipher.update(secret, "utf8"),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), encrypted]
      .map((b) => b.toString("base64url"))
      .join(".");
  };
  const unseal = (value: string, id: string) => {
    const [iv, tag, encrypted] = value
      .split(".")
      .map((x) => Buffer.from(x, "base64url"));
    const cipher = createDecipheriv("aes-256-gcm", encryption, iv);
    cipher.setAAD(Buffer.from(id));
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(encrypted), cipher.final()]).toString(
      "utf8",
    );
  };
  for (const row of repo.all(
    "SELECT id,secret FROM integrations WHERE enabled=1",
  ))
    try {
      unseal(row.secret, row.id);
    } catch {
      throw new Error(
        "Integration encryption key is missing or incorrect. Restore the matching security key.",
      );
    }
  const actor = (req: Request) => {
    const fresh = repo.session(req.sessionHash!);
    if (!fresh || fresh.id !== req.auth!.id)
      throw new HttpError(401, "Oturumun sona erdi.");
    if (fresh.workspace_id !== req.auth!.workspace_id)
      throw new HttpError(409, "Çalışma alanın değişti.", "WORKSPACE_CHANGED");
    if (
      !canManageWorkspace(fresh) ||
      fresh.suspended_at ||
      fresh.membership_suspended_at ||
      fresh.membership_removed_at ||
      repo.workspace(fresh.workspace_id).suspended
    )
      throw new HttpError(
        403,
        "Entegrasyonları alan sahibi veya yöneticisi yönetebilir.",
      );
    return fresh;
  };
  const safe = (row: Row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    repository: row.repository,
    channelId: row.channel_id,
    channelName:
      repo.get("SELECT name FROM channels WHERE id=?", row.channel_id)?.name ||
      "Kanal",
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    lastDeliveryAt: row.last_delivery_at,
    lastStatus: row.last_status,
    url: `${origin}/api/hooks/${row.id}`,
  });
  const canDeliver = (row: Row) => {
    const owner = repo.member(row.created_by, row.workspace_id);
    return (
      row.enabled &&
      owner &&
      canManageWorkspace(owner) &&
      !owner.suspended_at &&
      !owner.membership_suspended_at &&
      !owner.membership_removed_at &&
      repo.canWriteChannel(owner.id, row.channel_id, row.workspace_id) &&
      repo.canWriteChannel(row.bot_user_id, row.channel_id, row.workspace_id)
    );
  };
  function installPublicRoutes(app: Express) {
    const limiter = rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Bildirim sınırına ulaşıldı." },
    });
    app.post(
      "/api/hooks/:id",
      limiter,
      express.raw({ type: "application/json", limit: "1mb", inflate: false }),
      (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        const integration = z.string().uuid().safeParse(req.params.id).success
          ? repo.get(
              "SELECT * FROM integrations WHERE id=?",
              String(req.params.id),
            )
          : undefined;
        if (!integration || !canDeliver(integration))
          throw new HttpError(404, "Entegrasyon bulunamadı veya kapalı.");
        if (!Buffer.isBuffer(req.body))
          throw new HttpError(415, "Content-Type application/json olmalı.");
        let deliveryId: string, content: string | null;
        if (integration.kind === "github") {
          const signature = req.get("x-hub-signature-256") || "";
          if (
            !verifyGitHubSignature(
              unseal(integration.secret, integration.id),
              req.body,
              signature,
            )
          )
            throw new HttpError(401, "İmza doğrulanamadı.");
          deliveryId = parse(
            z
              .string()
              .min(8)
              .max(100)
              .regex(/^[\w-]+$/),
            req.get("x-github-delivery"),
          );
          let body;
          try {
            body = JSON.parse(req.body.toString("utf8"));
          } catch {
            throw new HttpError(400, "JSON geçersiz.");
          }
          if (!body || typeof body !== "object" || Array.isArray(body))
            throw new HttpError(400, "Olay gövdesi bir JSON nesnesi olmalı.");
          if (req.get("x-github-event") === "ping") {
            if (
              string(body.repository?.full_name).toLowerCase() !==
              integration.repository.toLowerCase()
            )
              throw new HttpError(403, "Depo eşleşmiyor.");
            repo.run(
              "UPDATE integrations SET last_delivery_at=?,last_status=? WHERE id=?",
              new Date().toISOString(),
              "ok",
              integration.id,
            );
            return res.json({ ok: true });
          }
          content = githubMessage(
            req.get("x-github-event") || "",
            body,
            integration.repository,
          );
        } else {
          const token =
            /^Bearer ([a-f0-9]{64})$/i.exec(
              req.get("authorization") || "",
            )?.[1] || "";
          if (
            !/^[a-f0-9]{64}$/.test(token) ||
            !timingSafeEqual(
              Buffer.from(hash(token)),
              Buffer.from(integration.token_hash),
            )
          )
            throw new HttpError(401, "Entegrasyon anahtarı geçersiz.");
          let body;
          try {
            body = JSON.parse(req.body.toString("utf8"));
          } catch {
            throw new HttpError(400, "JSON geçersiz.");
          }
          const input = parse(
            z
              .object({
                content: z.string().trim().min(1).max(10000),
                eventId: z
                  .string()
                  .min(1)
                  .max(100)
                  .regex(/^[\w.-]+$/)
                  .optional(),
              })
              .strict(),
            body,
          );
          content = input.content;
          deliveryId = input.eventId || randomUUID();
        }
        if (!content) return res.status(202).json({ ignored: true });
        const existing = repo.get(
          "SELECT message_id FROM integration_deliveries WHERE integration_id=? AND delivery_id=?",
          integration.id,
          deliveryId,
        );
        if (existing) {
          if (existing.message_id) onMessageCreated(existing.message_id);
          return res.json({
            ok: true,
            duplicate: true,
            messageId: existing.message_id,
          });
        }
        const messageId = repo.transaction(() => {
          if (
            !canDeliver(
              repo.get(
                "SELECT * FROM integrations WHERE id=?",
                integration.id,
              )!,
            )
          )
            throw new HttpError(404, "Entegrasyon kapalı.");
          const id = randomUUID(),
            now = new Date().toISOString();
          repo.run(
            "INSERT INTO messages(id,channel_id,user_id,content,created_at,edited_at,parent_id,pinned) VALUES(?,?,?,?,?,NULL,NULL,0)",
            id,
            integration.channel_id,
            integration.bot_user_id,
            content!,
            now,
          );
          repo.run(
            "INSERT INTO integration_deliveries VALUES(?,?,?,?)",
            integration.id,
            deliveryId,
            id,
            now,
          );
          repo.run(
            "UPDATE integrations SET last_delivery_at=?,last_status=? WHERE id=?",
            now,
            "ok",
            integration.id,
          );
          return id;
        });
        io.to(`channel:${integration.channel_id}`).emit(
          "message:created",
          repo.message(
            repo.get("SELECT * FROM messages WHERE id=?", messageId)!,
          ),
        );
        onMessageCreated(messageId);
        res.status(201).json({ ok: true, messageId });
      },
    );
  }
  function installRoutes(app: Express) {
    app.get("/api/integrations", (req, res) => {
      const user = actor(req);
      res.json({
        integrations: repo
          .all(
            "SELECT * FROM integrations WHERE workspace_id=? ORDER BY created_at DESC",
            user.workspace_id,
          )
          .filter((row) =>
            repo.canAccessChannel(user.id, row.channel_id, user.workspace_id),
          )
          .map(safe),
      });
    });
    app.post("/api/integrations", (req, res) => {
      const user = actor(req);
      if (repo.workspace(user.workspace_id).isDemo)
        throw new HttpError(400, "Entegrasyon için gerçek hesabını kullan.");
      const input = parse(
        z
          .object({
            name: z.string().trim().min(2).max(50),
            kind: z.enum(["github", "webhook"]),
            channelId: z.string().uuid(),
            repository: z
              .string()
              .regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/)
              .refine(
                (value) => ![".", ".."].includes(value.split("/")[1]),
                "Depo adı geçersiz.",
              )
              .max(200)
              .optional(),
          })
          .strict(),
        req.body,
      );
      if (input.kind === "github" && !input.repository)
        throw new HttpError(400, "GitHub deposunu sahip/depo şeklinde yaz.");
      const channel = repo.get(
        "SELECT * FROM channels WHERE id=? AND workspace_id=? AND kind='text' AND archived_at IS NULL",
        input.channelId,
        user.workspace_id,
      );
      if (
        !channel ||
        !repo.canWriteChannel(user.id, channel.id, user.workspace_id)
      )
        throw new HttpError(404, "Yazabildiğin bir metin kanalı seç.");
      if (
        repo.get(
          "SELECT count(*) AS n FROM integrations WHERE workspace_id=?",
          user.workspace_id,
        )!.n >= 25
      )
        throw new HttpError(409, "Entegrasyon sınırına ulaşıldı.");
      const id = randomUUID(),
        botId = randomUUID(),
        secret = randomBytes(32).toString("hex"),
        now = new Date().toISOString();
      repo.transaction(() => {
        repo.run(
          "INSERT INTO users(id,workspace_id,name,email,password_hash,color,role,status,created_at,email_verified) VALUES(?,?,?,?,NULL,?,'member',?,?,1)",
          botId,
          user.workspace_id,
          input.name,
          `${id}@bots.mola.invalid`,
          "#a1c2b5",
          "Ekip botu",
          now,
        );
        repo.run(
          "UPDATE workspace_members SET role='guest' WHERE user_id=? AND workspace_id=?",
          botId,
          user.workspace_id,
        );
        repo.run(
          "INSERT OR IGNORE INTO channel_members VALUES(?,?)",
          channel.id,
          botId,
        );
        repo.run(
          "INSERT INTO integrations(id,workspace_id,channel_id,created_by,bot_user_id,name,kind,repository,token_hash,secret,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
          id,
          user.workspace_id,
          channel.id,
          user.id,
          botId,
          input.name,
          input.kind,
          input.repository || "",
          hash(secret),
          seal(secret, id),
          now,
        );
        repo.run("INSERT INTO bot_accounts VALUES(?,?)", botId, id);
        recordAudit(
          repo,
          user,
          user.workspace_id,
          "integration.created",
          "integration",
          id,
          JSON.stringify({
            name: input.name,
            kind: input.kind,
            channelId: channel.id,
          }),
        );
      });
      io.to(`workspace:${user.workspace_id}`).emit(
        "member:updated",
        repo.user(repo.member(botId, user.workspace_id)!),
      );
      res.status(201).json({
        ...safe(repo.get("SELECT * FROM integrations WHERE id=?", id)!),
        secret,
      });
    });
    app.patch("/api/integrations/:id", (req, res) => {
      const user = actor(req);
      const id = parse(z.string().uuid(), req.params.id);
      const row = repo.get(
        "SELECT * FROM integrations WHERE id=? AND workspace_id=?",
        id,
        user.workspace_id,
      );
      if (
        !row ||
        !repo.canAccessChannel(user.id, row.channel_id, user.workspace_id)
      )
        throw new HttpError(404, "Entegrasyon bulunamadı.");
      const input = parse(
        z
          .object({
            enabled: z.boolean().optional(),
            rotateSecret: z.literal(true).optional(),
          })
          .strict(),
        req.body,
      );
      const secret = input.rotateSecret
        ? randomBytes(32).toString("hex")
        : undefined;
      repo.transaction(() => {
        if (input.enabled !== undefined)
          repo.run(
            "UPDATE integrations SET enabled=? WHERE id=?",
            input.enabled ? 1 : 0,
            id,
          );
        if (secret)
          repo.run(
            "UPDATE integrations SET token_hash=?,secret=? WHERE id=?",
            hash(secret),
            seal(secret, id),
            id,
          );
        recordAudit(
          repo,
          user,
          user.workspace_id,
          secret ? "integration.key.rotated" : "integration.updated",
          "integration",
          id,
        );
      });
      res.json({
        ...safe(repo.get("SELECT * FROM integrations WHERE id=?", id)!),
        ...(secret ? { secret } : {}),
      });
    });
  }
  return { installPublicRoutes, installRoutes };
}
