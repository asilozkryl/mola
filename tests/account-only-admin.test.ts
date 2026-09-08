import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, randomBytes, randomUUID, scryptSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.js";
import { createWorkspace } from "../server/seed.js";
import { manageSiteAdmin } from "../server/admin-cli.js";

const origin = "http://account-admin.test";
const password = "account-admin-regression-2026";
const passwordHash = `admin-account-salt:${scryptSync(password, "admin-account-salt", 64).toString("hex")}`;

async function fixture(
  run: (context: {
    runtime: ReturnType<typeof createApp>;
    directory: string;
    operator: ReturnType<typeof createWorkspace>;
    target: ReturnType<typeof createWorkspace>;
    request: (
      path: string,
      method?: string,
      body?: unknown,
    ) => Promise<Response>;
  }) => Promise<void>,
) {
  const directory = mkdtempSync(join(tmpdir(), "mola-account-admin-"));
  const runtime = createApp({
    dataDir: directory,
    appOrigin: origin,
    production: false,
    requireEmailVerification: false,
    mailTransport: async () => {},
  });
  try {
    const operator = createWorkspace(runtime.repo, {
      name: "Operator team",
      userName: "Operator",
      email: "operator@account-admin.test",
      passwordHash,
    });
    const target = createWorkspace(runtime.repo, {
      name: "Managed team",
      userName: "Member",
      email: "member@account-admin.test",
      passwordHash,
    });
    runtime.repo.run("UPDATE users SET email_verified=1");
    runtime.repo.run(
      "UPDATE users SET site_admin=1 WHERE id=?",
      operator.userId,
    );
    const token = randomBytes(32).toString("hex");
    runtime.repo.run(
      "INSERT INTO sessions(token_hash,user_id,workspace_id,expires_at) VALUES (?,?,?,?)",
      createHash("sha256").update(token).digest("hex"),
      operator.userId,
      operator.workspaceId,
      Date.now() + 600_000,
    );
    await new Promise<void>((done) =>
      runtime.server.listen(0, "127.0.0.1", done),
    );
    const base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
    const request = (path: string, method = "GET", body?: unknown) =>
      fetch(`${base}/api${path}`, {
        method,
        headers: {
          Origin: origin,
          Cookie: `mola_session=${token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const deleted = await request(
      `/workspaces/${operator.workspaceId}`,
      "DELETE",
      { confirmName: "Operator team", password },
    );
    assert.equal(deleted.status, 200);
    assert.equal((await deleted.json()).accountOnly, true);
    await run({ runtime, directory, operator, target, request });
  } finally {
    await runtime.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
  }
}

test("operator CLI can grant and revoke account-only administrators while counting them for last-admin protection", async () =>
  fixture(async ({ runtime, directory, operator, target, request }) => {
    const database = join(directory, "mola.sqlite");
    assert.throws(
      () => manageSiteAdmin(database, "revoke", "operator@account-admin.test"),
      /Son uygulama yöneticisinin/,
    );
    assert.equal(
      manageSiteAdmin(database, "grant", "member@account-admin.test").granted,
      true,
    );
    assert.equal(
      manageSiteAdmin(database, "revoke", "operator@account-admin.test")
        .granted,
      false,
    );
    assert.equal(
      runtime.repo.get(
        "SELECT site_admin FROM users WHERE id=?",
        operator.userId,
      )!.site_admin,
      0,
    );
    assert.equal(
      (await request("/admin/system")).status,
      401,
      "CLI revokes the account-only browser session",
    );
    assert.equal(
      manageSiteAdmin(database, "grant", "operator@account-admin.test").granted,
      true,
    );
    assert.equal(
      runtime.repo.get(
        "SELECT count(*) AS n FROM workspace_members WHERE user_id=?",
        operator.userId,
      )!.n,
      0,
    );
    assert.equal(
      manageSiteAdmin(database, "revoke", "member@account-admin.test").granted,
      false,
      "the remaining account-only administrator counts as an eligible operator",
    );
    assert.equal(
      runtime.repo.get(
        "SELECT site_admin FROM users WHERE id=?",
        target.userId,
      )!.site_admin,
      0,
    );
    assert.throws(
      () => manageSiteAdmin(database, "revoke", "operator@account-admin.test"),
      /Son uygulama yöneticisinin/,
    );
    assert.equal(
      runtime.repo.get(
        "SELECT workspace_id FROM audit_events WHERE action='site_admin.revoked' AND target_id=?",
        operator.userId,
      )!.workspace_id,
      null,
    );
  }));

test("a site administrator retains global management after deleting the final workspace without gaining workspace access", async () =>
  fixture(async ({ runtime, target, request }) => {
    const overview = await request("/admin/system");
    assert.equal(overview.status, 200);
    assert.deepEqual(
      (await overview.json()).workspaces.map(
        (workspace: { id: string }) => workspace.id,
      ),
      [target.workspaceId],
    );
    const workspace = await request("/admin/workspace");
    assert.equal(workspace.status, 403);
    assert.equal((await workspace.json()).code, "WORKSPACE_REQUIRED");
    assert.equal(
      (await request("/admin/workspace", "PATCH", { name: "No implicit team" }))
        .status,
      403,
    );
    assert.equal(
      (await request("/channels", "POST", { name: "No channel", kind: "text" }))
        .status,
      403,
    );
    assert.equal(
      (
        await request(
          `/admin/system/workspaces/${target.workspaceId}`,
          "PATCH",
          { suspended: true },
        )
      ).status,
      200,
    );
    assert.equal(runtime.repo.workspace(target.workspaceId).suspended, true);
    assert.equal(
      (
        await request(
          `/admin/system/workspaces/${target.workspaceId}`,
          "PATCH",
          { suspended: false },
        )
      ).status,
      200,
    );
    assert.equal(runtime.repo.workspace(target.workspaceId).suspended, false);
    assert.equal((await (await request("/auth/me")).json()).accountOnly, true);
  }));

test("account-only global administration still requires current authority, verified email and an active account", async () =>
  fixture(async ({ runtime, operator, request }) => {
    runtime.repo.run(
      "UPDATE users SET site_admin=0 WHERE id=?",
      operator.userId,
    );
    assert.equal((await request("/admin/system")).status, 403);
    runtime.repo.run(
      "UPDATE users SET site_admin=1,email_verified=0 WHERE id=?",
      operator.userId,
    );
    assert.equal((await request("/admin/system")).status, 403);
    runtime.repo.run(
      "UPDATE users SET email_verified=1,suspended_at=? WHERE id=?",
      new Date().toISOString(),
      operator.userId,
    );
    const suspended = await request("/admin/system");
    assert.equal(suspended.status, 403);
    assert.equal((await suspended.json()).code, "ACCOUNT_SUSPENDED");
    runtime.repo.run(
      "UPDATE users SET suspended_at=NULL WHERE id=?",
      operator.userId,
    );
    assert.equal((await request("/admin/system")).status, 200);
  }));

test("global management lists and suspends real account-only users without restoring team membership", async () =>
  fixture(async ({ runtime, operator, target, request }) => {
    runtime.repo.run("DELETE FROM workspaces WHERE id=?", target.workspaceId);
    const sessionHash = createHash("sha256")
      .update("account-only-target")
      .digest("hex");
    runtime.repo.run(
      "INSERT INTO sessions(token_hash,user_id,workspace_id,expires_at) VALUES (?,?,NULL,?)",
      sessionHash,
      target.userId,
      Date.now() + 600_000,
    );
    const response = await request("/admin/system");
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.pagination.userTotal, 2);
    assert.deepEqual(
      new Set(data.users.map((user: { id: string }) => user.id)),
      new Set([operator.userId, target.userId]),
    );
    const account = data.users.find(
      (user: { id: string }) => user.id === target.userId,
    );
    assert.equal(account.workspaceId, undefined);
    assert.equal(account.workspaceName, "");
    assert.equal(account.avatarUrl, undefined);
    assert.equal(
      (
        await (
          await request("/admin/system?q=member%40account-admin.test")
        ).json()
      ).pagination.userTotal,
      1,
    );
    assert.equal(
      (
        await request(`/admin/system/users/${target.userId}`, "PATCH", {
          suspended: true,
        })
      ).status,
      200,
    );
    assert.ok(
      runtime.repo.get(
        "SELECT suspended_at FROM users WHERE id=?",
        target.userId,
      )!.suspended_at,
    );
    assert.equal(
      runtime.repo.get(
        "SELECT token_hash FROM sessions WHERE token_hash=?",
        sessionHash,
      ),
      undefined,
    );
    assert.equal(
      (await (await request("/admin/system?status=suspended")).json())
        .pagination.userTotal,
      1,
    );
    assert.equal(
      (
        await request(`/admin/system/users/${target.userId}`, "PATCH", {
          suspended: false,
        })
      ).status,
      200,
    );
    assert.equal(
      runtime.repo.get(
        "SELECT suspended_at FROM users WHERE id=?",
        target.userId,
      )!.suspended_at,
      null,
    );
    assert.equal(
      runtime.repo.get(
        "SELECT count(*) AS n FROM workspace_members WHERE user_id=?",
        target.userId,
      )!.n,
      0,
    );
    assert.equal(
      runtime.repo.get(
        "SELECT workspace_id FROM audit_events WHERE action='system.member.suspended' AND target_id=?",
        target.userId,
      )!.workspace_id,
      null,
    );
  }));

test("account-only listing keeps demo identities hidden and preserves the distinction between active bots and orphaned bots", async () =>
  fixture(async ({ runtime, target, request }) => {
    const demo = createWorkspace(runtime.repo, {
      name: "Demo",
      userName: "Demo operator",
      email: "demo@account-admin.test",
      passwordHash,
      demo: true,
    });
    const botId = randomUUID();
    const integrationId = randomUUID();
    const channelId = runtime.repo
      .channels(target.userId, target.workspaceId)
      .find((channel) => channel.kind === "text")!.id;
    runtime.repo.run(
      "INSERT INTO users(id,workspace_id,name,email,password_hash,color,role,status,created_at,email_verified) VALUES (?,?,?,?,NULL,?,'member','',?,1)",
      botId,
      target.workspaceId,
      "Managed integration",
      `bot-${botId}@account-admin.test`,
      "#237459",
      new Date().toISOString(),
    );
    runtime.repo.run(
      "INSERT INTO integrations(id,workspace_id,channel_id,created_by,bot_user_id,name,kind,token_hash,secret,created_at) VALUES (?,?,?,?,?,?,'webhook',?,?,?)",
      integrationId,
      target.workspaceId,
      channelId,
      target.userId,
      botId,
      "Managed integration",
      "fixture-token",
      "fixture-secret",
      new Date().toISOString(),
    );
    runtime.repo.run(
      "INSERT INTO bot_accounts(user_id,integration_id) VALUES (?,?)",
      botId,
      integrationId,
    );
    const before = await (await request("/admin/system")).json();
    assert.equal(
      before.users.some((user: { id: string }) => user.id === demo.userId),
      false,
    );
    assert.equal(
      before.users.find((user: { id: string }) => user.id === botId)?.isBot,
      true,
    );
    assert.equal(
      (
        await request(`/admin/system/users/${demo.userId}`, "PATCH", {
          suspended: true,
        })
      ).status,
      404,
    );
    runtime.repo.run("DELETE FROM workspaces WHERE id=?", target.workspaceId);
    assert.ok(runtime.repo.get("SELECT id FROM users WHERE id=?", botId));
    const after = await (await request("/admin/system")).json();
    assert.equal(
      after.users.some((user: { id: string }) => user.id === botId),
      false,
    );
    assert.equal(
      after.users.some((user: { id: string }) => user.id === target.userId),
      true,
    );
    assert.equal(
      (
        await request(`/admin/system/users/${botId}`, "PATCH", {
          suspended: true,
        })
      ).status,
      404,
    );
  }));
