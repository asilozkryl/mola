import { restoreLegacyNotificationSchema } from "./notification-migration-fixture.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID, scryptSync } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import { createApp } from "../server/app.js";
import { openDatabase, Repository } from "../server/db.js";
import { createWorkspace } from "../server/seed.js";
import { totpCode } from "../server/account-security.js";

const origin = "http://lifecycle.test";
const password = "a-lifecycle-password-2026";
const storedPassword = `lifecycle-salt:${scryptSync(password, "lifecycle-salt", 64).toString("hex")}`;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
type Client = {
  cookie: string;
  sessionHash: string;
  userId: string;
  request: (
    path: string,
    method?: string,
    body?: unknown,
    expectedWorkspace?: string,
  ) => Promise<Response>;
};
async function fixture(
  run: (context: {
    runtime: ReturnType<typeof createApp>;
    directory: string;
    alpha: ReturnType<typeof createWorkspace>;
    beta: ReturnType<typeof createWorkspace>;
    a: Client;
    b: Client;
    client: (userId: string, workspaceId: string | null) => Client;
    socket: (client: Client) => Promise<Socket>;
  }) => Promise<void>,
) {
  const directory = mkdtempSync(join(tmpdir(), "mola-lifecycle-"));
  const runtime = createApp({
    dataDir: directory,
    appOrigin: origin,
    production: false,
    requireEmailVerification: false,
    mailTransport: async () => {},
  });
  const sockets: Socket[] = [];
  await new Promise<void>((done) =>
    runtime.server.listen(0, "127.0.0.1", done),
  );
  const base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
  const client = (userId: string, workspaceId: string | null): Client => {
    const token = randomBytes(32).toString("hex");
    const cookies = new Map([["mola_session", token]]);
    runtime.repo.run(
      "INSERT INTO sessions(token_hash,user_id,workspace_id,expires_at) VALUES (?,?,?,?)",
      hash(token),
      userId,
      workspaceId,
      Date.now() + 600_000,
    );
    const result: Client = {
      userId,
      cookie: `mola_session=${token}`,
      sessionHash: hash(token),
      async request(path, method = "GET", body, expectedWorkspace) {
        const response = await fetch(base + "/api" + path, {
          method,
          headers: {
            Origin: origin,
            Cookie: result.cookie,
            ...(expectedWorkspace
              ? { "X-Workspace-Id": expectedWorkspace }
              : {}),
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        for (const cookie of response.headers.getSetCookie()) {
          const pair = cookie.split(";")[0],
            index = pair.indexOf("="),
            name = pair.slice(0, index),
            value = pair.slice(index + 1);
          if (value) cookies.set(name, value);
          else cookies.delete(name);
        }
        result.cookie = [...cookies]
          .map(([name, value]) => `${name}=${value}`)
          .join("; ");
        result.sessionHash = hash(cookies.get("mola_session") || "");
        return response;
      },
    };
    return result;
  };
  const socket = async (actor: Client) => {
    const value = connect(base, {
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
      timeout: 2000,
      extraHeaders: { Origin: origin, Cookie: actor.cookie },
    });
    sockets.push(value);
    await new Promise<void>((done, reject) => {
      value.once("connect", done);
      value.once("connect_error", reject);
    });
    return value;
  };
  try {
    const alpha = createWorkspace(runtime.repo, {
      name: "Alpha",
      userName: "Alpha Owner",
      email: "alpha@lifecycle.test",
      passwordHash: storedPassword,
    });
    const beta = createWorkspace(runtime.repo, {
      name: "Beta",
      userName: "Beta Owner",
      email: "beta@lifecycle.test",
      passwordHash: storedPassword,
    });
    runtime.repo.run("UPDATE users SET email_verified=1");
    await run({
      runtime,
      directory,
      alpha,
      beta,
      a: client(alpha.userId, alpha.workspaceId),
      b: client(beta.userId, beta.workspaceId),
      client,
      socket,
    });
  } finally {
    sockets.forEach((value) => value.disconnect());
    await runtime.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
  }
}

test("workspace deletion preview and deletion require the actual owner, current name and password", async () =>
  fixture(async ({ runtime, alpha, beta, a, b, client }) => {
    const preview = await a.request(
      `/workspaces/${alpha.workspaceId}/deletion-preview`,
    );
    assert.equal(preview.status, 200);
    assert.deepEqual(await preview.json(), {
      workspaceName: "Alpha",
      counts: {
        members: 1,
        channels: 4,
        messages: 0,
        files: 0,
        storageBytes: 0,
      },
    });
    assert.equal(
      (await b.request(`/workspaces/${alpha.workspaceId}/deletion-preview`))
        .status,
      404,
    );
    runtime.repo.run(
      "INSERT INTO workspace_members(workspace_id,user_id,role,joined_at) VALUES (?,?,'admin',?)",
      alpha.workspaceId,
      beta.userId,
      new Date().toISOString(),
    );
    runtime.repo.run("UPDATE users SET site_admin=1 WHERE id=?", beta.userId);
    const admin = client(beta.userId, alpha.workspaceId);
    assert.equal(
      (await admin.request(`/workspaces/${alpha.workspaceId}/deletion-preview`))
        .status,
      403,
    );
    assert.equal(
      (
        await admin.request(`/workspaces/${alpha.workspaceId}`, "DELETE", {
          confirmName: "Alpha",
          password,
        })
      ).status,
      403,
      "site administration does not bypass ownership",
    );
    for (const role of ["member", "moderator", "guest"]) {
      runtime.repo.run(
        "UPDATE workspace_members SET role=? WHERE workspace_id=? AND user_id=?",
        role,
        alpha.workspaceId,
        beta.userId,
      );
      assert.equal(
        (
          await admin.request(`/workspaces/${alpha.workspaceId}`, "DELETE", {
            confirmName: "Alpha",
            password,
          })
        ).status,
        403,
      );
    }
    assert.equal(
      (
        await a.request(`/workspaces/${alpha.workspaceId}`, "DELETE", {
          confirmName: "Alpha",
          password: "incorrect-password",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await a.request(`/workspaces/${alpha.workspaceId}`, "DELETE", {
          confirmName: "Old name",
          password,
        })
      ).status,
      400,
    );
    assert.equal(
      (await a.request(`/workspaces/${alpha.workspaceId}/leave`, "POST", {}))
        .status,
      409,
    );
    assert.equal(runtime.repo.workspace(alpha.workspaceId).name, "Alpha");
    assert.equal(
      runtime.repo.get("SELECT count(*) AS n FROM audit_events")!.n,
      0,
    );
  }));

test("deleting a workspace preserves shared accounts, other sessions, files and calls while notifying every affected member", async () =>
  fixture(async ({ runtime, directory, alpha, beta, a, b, client, socket }) => {
    runtime.repo.run(
      "INSERT INTO workspace_members(workspace_id,user_id,role,joined_at) VALUES (?,?,'member',?)",
      beta.workspaceId,
      alpha.userId,
      new Date().toISOString(),
    );
    const onlyAlpha = randomUUID();
    runtime.repo.run(
      "INSERT INTO users(id,workspace_id,name,email,password_hash,color,role,created_at,email_verified) VALUES (?,?,?,?,?,?,?,?,1)",
      onlyAlpha,
      alpha.workspaceId,
      "Only Alpha",
      "only@lifecycle.test",
      storedPassword,
      "#123456",
      "member",
      new Date().toISOString(),
    );
    const otherA = client(alpha.userId, beta.workspaceId),
      lastMember = client(onlyAlpha, alpha.workspaceId);
    const [targetSocket, outsideSocket, remainingSocket, memberSocket] =
      await Promise.all([
        socket(a),
        socket(otherA),
        socket(b),
        socket(lastMember),
      ]);
    const alphaVoice = runtime.repo
      .channels(alpha.userId, alpha.workspaceId)
      .find((channel) => channel.kind === "voice")!.id;
    const betaVoice = runtime.repo
      .channels(alpha.userId, beta.workspaceId)
      .find((channel) => channel.kind === "voice")!.id;
    assert.equal(
      (
        await targetSocket
          .timeout(2000)
          .emitWithAck("call:join", { channelId: alphaVoice })
      ).ok,
      true,
    );
    assert.equal(
      (
        await outsideSocket
          .timeout(2000)
          .emitWithAck("call:join", { channelId: betaVoice })
      ).ok,
      true,
    );
    assert.equal(
      (
        await remainingSocket
          .timeout(2000)
          .emitWithAck("call:join", { channelId: betaVoice })
      ).ok,
      true,
    );
    const targetFile = `${randomUUID()}.bin`,
      otherFile = `${randomUUID()}.bin`,
      avatar = randomUUID();
    mkdirSync(join(directory, "uploads", "avatars"), { recursive: true });
    writeFileSync(join(directory, "uploads", targetFile), "delete");
    writeFileSync(join(directory, "uploads", otherFile), "keep");
    writeFileSync(
      join(directory, "uploads", "avatars", `${avatar}.webp`),
      "profile",
    );
    runtime.repo.run(
      "UPDATE users SET avatar_version=? WHERE id=?",
      avatar,
      alpha.userId,
    );
    for (const [workspace, file] of [
      [alpha.workspaceId, targetFile],
      [beta.workspaceId, otherFile],
    ])
      runtime.repo.run(
        "INSERT INTO attachments VALUES (?,?,?,?,?,?,?,?,?)",
        randomUUID(),
        workspace,
        alpha.userId,
        null,
        file,
        6,
        "text/plain",
        file,
        new Date().toISOString(),
      );
    const callClosed = new Promise<any>((done) =>
      targetSocket.once("call:closed", done),
    );
    const changed = new Promise<any>((done) =>
      memberSocket.once("workspace:changed", done),
    );
    const listChanged = new Promise<any>((done) =>
      outsideSocket.once("workspace:changed", done),
    );
    const response = await a.request(
      `/workspaces/${alpha.workspaceId}`,
      "DELETE",
      { confirmName: "Alpha", password },
    );
    assert.equal(response.status, 200);
    const state = await response.json();
    assert.equal(state.workspace.id, beta.workspaceId);
    assert.equal(state.user.role, "member");
    assert.equal((await callClosed).channelId, alphaVoice);
    assert.equal((await changed).reason, "deleted");
    assert.equal((await listChanged).removedWorkspaceId, alpha.workspaceId);
    assert.equal(outsideSocket.connected, true);
    assert.equal(remainingSocket.connected, true);
    assert.equal(
      (await (await b.request("/auth/me")).json()).voiceChannels[0].peers
        .length,
      2,
    );
    assert.equal(
      runtime.repo.session(otherA.sessionHash)!.workspace_id,
      beta.workspaceId,
    );
    assert.equal(
      runtime.repo.session(lastMember.sessionHash)!.workspace_id,
      null,
    );
    assert.equal(
      (await (await lastMember.request("/auth/me")).json()).accountOnly,
      true,
    );
    assert.ok(
      runtime.repo.get("SELECT id FROM users WHERE id=?", alpha.userId),
    );
    assert.ok(runtime.repo.get("SELECT id FROM users WHERE id=?", onlyAlpha));
    assert.equal(existsSync(join(directory, "uploads", targetFile)), false);
    assert.equal(existsSync(join(directory, "uploads", otherFile)), true);
    assert.equal(
      existsSync(join(directory, "uploads", "avatars", `${avatar}.webp`)),
      true,
    );
    const audit = runtime.repo.get(
      "SELECT * FROM audit_events WHERE action='workspace.deleted'",
    )!;
    assert.equal(audit.workspace_id, null);
    assert.equal(audit.target_id, alpha.workspaceId);
    assert.equal(JSON.parse(audit.details).name, "Alpha");
    assert.equal(audit.details.includes(password), false);
    assert.deepEqual(runtime.repo.all("PRAGMA foreign_key_check"), []);
  }));

test("last-workspace deletion keeps an account session through reload, login, account settings, creation and invite join", async () =>
  fixture(async ({ runtime, alpha, beta, a, b, socket }) => {
    const response = await a.request(
      `/workspaces/${alpha.workspaceId}`,
      "DELETE",
      { confirmName: "Alpha", password },
    );
    assert.equal(response.status, 200);
    const state = await response.json();
    assert.equal(state.accountOnly, true);
    assert.equal(state.workspace, null);
    assert.deepEqual(state.workspaces, []);
    assert.equal("role" in state.user, false);
    assert.deepEqual(state.channels, []);
    assert.equal(
      (
        await (
          await a.request("/auth/me", "GET", undefined, alpha.workspaceId)
        ).json()
      ).accountOnly,
      true,
    );
    assert.equal(
      (await a.request("/channels", "POST", { name: "Denied", kind: "text" }))
        .status,
      403,
    );
    assert.equal((await a.request("/account/security")).status, 200);
    const profile = await a.request("/profile", "PATCH", {
      name: "Account without a team",
    });
    assert.equal(profile.status, 200);
    assert.equal("role" in (await profile.json()), false);
    const accountSocket = await socket(a);
    const serverSocket = runtime.io.sockets.sockets.get(accountSocket.id!)!;
    assert.ok(serverSocket.rooms.has(`user:${alpha.userId}`));
    assert.equal(
      [...serverSocket.rooms].some(
        (room) => room.startsWith("workspace:") || room.startsWith("channel:"),
      ),
      false,
    );
    const newPassword = "a-new-account-password-2026";
    assert.equal(
      (
        await a.request("/auth/password", "PATCH", {
          currentPassword: password,
          newPassword,
        })
      ).status,
      204,
    );
    assert.equal((await a.request("/auth/logout", "POST")).status, 204);
    const login = await a.request("/auth/login", "POST", {
      email: "alpha@lifecycle.test",
      password: newPassword,
    });
    assert.equal(login.status, 200);
    assert.equal((await login.json()).accountOnly, true);
    assert.equal((await a.request("/account/sessions")).status, 200);
    const created = await a.request("/workspaces", "POST", {
      name: "Fresh workspace",
    });
    assert.equal(created.status, 200);
    const fresh = await created.json();
    assert.equal(fresh.user.id, alpha.userId);
    assert.equal(fresh.user.role, "owner");
    assert.equal(
      (
        await a.request(`/workspaces/${fresh.workspace.id}`, "DELETE", {
          confirmName: "Fresh workspace",
          password: newPassword,
        })
      ).status,
      200,
    );
    const invitation = await b.request("/invites", "POST");
    const inviteToken = new URL((await invitation.json()).url).searchParams.get(
      "invite",
    );
    const joined = await a.request("/workspaces/join", "POST", { inviteToken });
    assert.equal(joined.status, 200);
    assert.equal((await joined.json()).workspace.id, beta.workspaceId);
    assert.equal(runtime.repo.get("SELECT count(*) AS n FROM users")!.n, 2);
  }));

test("voluntary leaving preserves history, removes old private access and permits a fresh invite without undoing administrative removal", async () =>
  fixture(async ({ runtime, alpha, beta, a, b, client, socket }) => {
    const invitation = await b.request("/invites", "POST");
    const token = new URL((await invitation.json()).url).searchParams.get(
      "invite",
    );
    assert.equal(
      (await a.request("/workspaces/join", "POST", { inviteToken: token }))
        .status,
      200,
    );
    const privateResponse = await b.request("/channels", "POST", {
      name: "private-team",
      kind: "text",
      visibility: "private",
      memberIds: [alpha.userId],
    });
    const privateChannel = (await privateResponse.json()).id;
    const message = await (
      await a.request(`/channels/${privateChannel}/messages`, "POST", {
        content: "Preserved history",
      })
    ).json();
    const secondSession = client(alpha.userId, beta.workspaceId);
    const betaSocket = await socket(secondSession);
    const voice = runtime.repo
      .channels(alpha.userId, beta.workspaceId)
      .find((channel) => channel.kind === "voice")!.id;
    assert.equal(
      (
        await betaSocket
          .timeout(2000)
          .emitWithAck("call:join", { channelId: voice })
      ).ok,
      true,
    );
    const gone = new Promise<void>((done) =>
      betaSocket.once("disconnect", () => done()),
    );
    const left = await a.request(
      `/workspaces/${beta.workspaceId}/leave`,
      "POST",
      {},
    );
    assert.equal(left.status, 200);
    assert.equal((await left.json()).workspace.id, alpha.workspaceId);
    await gone;
    assert.equal(
      runtime.repo.session(secondSession.sessionHash)!.workspace_id,
      alpha.workspaceId,
    );
    assert.equal(
      runtime.repo.get("SELECT content FROM messages WHERE id=?", message.id)!
        .content,
      "Preserved history",
    );
    assert.ok(
      runtime.repo.member(alpha.userId, beta.workspaceId)!.membership_left_at,
    );
    assert.equal(
      runtime.repo.canAccessChannel(
        alpha.userId,
        privateChannel,
        beta.workspaceId,
      ),
      false,
    );
    const rejoined = await a.request("/workspaces/join", "POST", {
      inviteToken: token,
    });
    assert.equal(rejoined.status, 200);
    assert.equal(
      (await rejoined.json()).channels.some(
        (channel: { id: string }) => channel.id === privateChannel,
      ),
      false,
    );
    assert.equal(
      (await a.request(`/channels/${privateChannel}/messages`)).status,
      404,
    );
    assert.equal(
      runtime.repo.member(alpha.userId, beta.workspaceId)!.role,
      "member",
    );
    assert.equal(
      runtime.repo.member(alpha.userId, beta.workspaceId)!.membership_left_at,
      null,
    );
    assert.equal(
      (await b.request(`/admin/workspace/members/${alpha.userId}`, "DELETE"))
        .status,
      204,
    );
    const fallback = client(alpha.userId, alpha.workspaceId);
    assert.equal(
      (
        await fallback.request("/workspaces/join", "POST", {
          inviteToken: token,
        })
      ).status,
      403,
    );
  }));

test("leaving the final workspace opens account home and suspended membership cannot use an invite to regain access", async () =>
  fixture(async ({ runtime, alpha, beta, a, b }) => {
    const invitation = await b.request("/invites", "POST");
    const token = new URL((await invitation.json()).url).searchParams.get(
      "invite",
    );
    await a.request(`/workspaces/${alpha.workspaceId}`, "DELETE", {
      confirmName: "Alpha",
      password,
    });
    await a.request("/workspaces/join", "POST", { inviteToken: token });
    const left = await a.request(
      `/workspaces/${beta.workspaceId}/leave`,
      "POST",
      {},
    );
    assert.equal(left.status, 200);
    assert.equal((await left.json()).accountOnly, true);
    assert.equal(
      (
        await (
          await a.request("/auth/login", "POST", {
            email: "alpha@lifecycle.test",
            password,
          })
        ).json()
      ).accountOnly,
      true,
    );
    runtime.repo.run(
      "UPDATE workspace_members SET suspended_at=? WHERE workspace_id=? AND user_id=?",
      new Date().toISOString(),
      beta.workspaceId,
      alpha.userId,
    );
    assert.equal(
      (await a.request("/workspaces/join", "POST", { inviteToken: token }))
        .status,
      403,
    );
    assert.ok(
      runtime.repo.get(
        "SELECT id FROM workspaces WHERE id=?",
        beta.workspaceId,
      ),
    );
  }));

test("account-only login still requires the configured second factor and keeps account security after workspace deletion", async () =>
  fixture(async ({ alpha, a }) => {
    const setup = await a.request("/account/security/setup", "POST", {
      password,
    });
    assert.equal(setup.status, 200);
    const encoded = (await setup.json()).secret as string;
    let accumulator = 0,
      bits = 0;
    const bytes: number[] = [];
    for (const character of encoded) {
      accumulator =
        (accumulator << 5) |
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(character);
      bits += 5;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((accumulator >> bits) & 255);
      }
    }
    const enabled = await a.request("/account/security/enable", "POST", {
      code: totpCode(Buffer.from(bytes), Date.now()),
    });
    assert.equal(enabled.status, 200);
    const recovery = (await enabled.json()).recoveryCodes[0];
    assert.equal(
      (
        await a.request(`/workspaces/${alpha.workspaceId}`, "DELETE", {
          confirmName: "Alpha",
          password,
        })
      ).status,
      200,
    );
    assert.equal(
      (await (await a.request("/account/security")).json()).enabled,
      true,
    );
    await a.request("/auth/logout", "POST");
    const login = await a.request("/auth/login", "POST", {
      email: "alpha@lifecycle.test",
      password,
    });
    assert.equal(login.status, 200);
    assert.equal((await login.json()).twoFactorRequired, true);
    assert.equal((await a.request("/auth/me")).status, 401);
    const verified = await a.request("/auth/2fa/challenge", "POST", {
      code: recovery,
    });
    assert.equal(verified.status, 200);
    assert.equal((await verified.json()).accountOnly, true);
    assert.equal(
      (await (await a.request("/account/security")).json())
        .recoveryCodesRemaining,
      9,
    );
  }));

test("changed workspace, ownership, name or password invalidates a deletion checked before the write transaction", async () =>
  fixture(async ({ runtime, alpha, beta, a }) => {
    const original = runtime.repo.transaction.bind(runtime.repo);
    const scenarios = [
      {
        status: 403,
        mutate: () =>
          runtime.repo.run(
            "UPDATE workspace_members SET role='member' WHERE workspace_id=? AND user_id=?",
            alpha.workspaceId,
            alpha.userId,
          ),
        restore: () =>
          runtime.repo.run(
            "UPDATE workspace_members SET role='owner' WHERE workspace_id=? AND user_id=?",
            alpha.workspaceId,
            alpha.userId,
          ),
      },
      {
        status: 400,
        mutate: () =>
          runtime.repo.run(
            "UPDATE workspaces SET name='Renamed' WHERE id=?",
            alpha.workspaceId,
          ),
        restore: () =>
          runtime.repo.run(
            "UPDATE workspaces SET name='Alpha' WHERE id=?",
            alpha.workspaceId,
          ),
      },
      {
        status: 401,
        mutate: () =>
          runtime.repo.run(
            "UPDATE users SET password_hash=? WHERE id=?",
            "changed-password",
            alpha.userId,
          ),
        restore: () =>
          runtime.repo.run(
            "UPDATE users SET password_hash=? WHERE id=?",
            storedPassword,
            alpha.userId,
          ),
      },
      {
        status: 409,
        mutate: () => {
          runtime.repo.run(
            "INSERT INTO workspace_members(workspace_id,user_id,role,joined_at) VALUES (?,?,'member',?)",
            beta.workspaceId,
            alpha.userId,
            new Date().toISOString(),
          );
          runtime.repo.run(
            "UPDATE sessions SET workspace_id=? WHERE token_hash=?",
            beta.workspaceId,
            a.sessionHash,
          );
        },
        restore: () =>
          runtime.repo.run(
            "UPDATE sessions SET workspace_id=? WHERE token_hash=?",
            alpha.workspaceId,
            a.sessionHash,
          ),
      },
    ];
    for (const scenario of scenarios) {
      runtime.repo.transaction = (fn) => {
        scenario.mutate();
        return original(fn);
      };
      assert.equal(
        (
          await a.request(`/workspaces/${alpha.workspaceId}`, "DELETE", {
            confirmName: "Alpha",
            password,
          })
        ).status,
        scenario.status,
      );
      runtime.repo.transaction = original;
      scenario.restore();
      assert.equal(runtime.repo.workspace(alpha.workspaceId).name, "Alpha");
    }
    assert.equal(
      runtime.repo.get(
        "SELECT count(*) AS n FROM audit_events WHERE action='workspace.deleted'",
      )!.n,
      0,
    );
  }));

test("failed workspace deletion rolls back sessions and records without deleting physical files", async () =>
  fixture(async ({ runtime, directory, alpha, a }) => {
    const file = `${randomUUID()}.bin`;
    writeFileSync(join(directory, "uploads", file), "safe");
    runtime.repo.run(
      "INSERT INTO attachments VALUES (?,?,?,?,?,?,?,?,?)",
      randomUUID(),
      alpha.workspaceId,
      alpha.userId,
      null,
      "safe.txt",
      4,
      "text/plain",
      file,
      new Date().toISOString(),
    );
    runtime.repo.db.exec(
      "CREATE TRIGGER reject_workspace_delete BEFORE DELETE ON workspaces BEGIN SELECT RAISE(ABORT,'protected fixture'); END;",
    );
    const response = await a.request(
      `/workspaces/${alpha.workspaceId}`,
      "DELETE",
      { confirmName: "Alpha", password },
    );
    assert.equal(response.status, 500);
    assert.equal(
      runtime.repo.session(a.sessionHash)!.workspace_id,
      alpha.workspaceId,
    );
    assert.equal(
      runtime.repo.get("SELECT count(*) AS n FROM attachments")!.n,
      1,
    );
    assert.equal(
      runtime.repo.get("SELECT count(*) AS n FROM audit_events")!.n,
      0,
    );
    assert.equal(existsSync(join(directory, "uploads", file)), true);
  }));

test("v7 migration preserves device and push foreign keys, keeps explicit account sessions and never falls back to a deleted home workspace", () => {
  const directory = mkdtempSync(join(tmpdir(), "mola-lifecycle-migration-"));
  const path = join(directory, "mola.sqlite");
  let repo: Repository | undefined;
  try {
    repo = new Repository(openDatabase(path));
    const alpha = createWorkspace(repo, {
      name: "Original",
      userName: "Owner",
      email: "migration@lifecycle.test",
      passwordHash: storedPassword,
    });
    const beta = createWorkspace(repo, {
      name: "Second",
      userName: "",
      email: "",
      passwordHash: null,
      existingUserId: alpha.userId,
    });
    const token = hash("existing");
    repo.run(
      "INSERT INTO sessions(token_hash,user_id,workspace_id,expires_at) VALUES (?,?,?,?)",
      token,
      alpha.userId,
      alpha.workspaceId,
      Date.now() + 600_000,
    );
    repo.run(
      "INSERT INTO session_devices(token_hash,id,device,created_at,last_seen_at) VALUES (?,?,?,?,?)",
      token,
      randomUUID(),
      "Same device",
      100,
      200,
    );
    repo.run(
      "INSERT INTO push_subscriptions VALUES (?,?,?,?,?,?,?)",
      randomUUID(),
      alpha.userId,
      token,
      "https://push.example.invalid/fixture",
      "p256dh",
      "auth",
      "created",
    );
    // Reconstruct the actual v6 session relation and legacy NULL trigger.
    restoreLegacyNotificationSchema(repo.db);
    repo.db.exec(`PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;
      DROP TRIGGER initial_session_workspace;
      CREATE TABLE sessions_old(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL,workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE);
      INSERT INTO sessions_old SELECT token_hash,user_id,expires_at,workspace_id FROM sessions;
      DROP TABLE sessions; ALTER TABLE sessions_old RENAME TO sessions;
      CREATE INDEX idx_sessions_user ON sessions(user_id); CREATE INDEX idx_sessions_workspace ON sessions(workspace_id,user_id);
      CREATE TRIGGER initial_session_workspace AFTER INSERT ON sessions WHEN NEW.workspace_id IS NULL BEGIN UPDATE sessions SET workspace_id=(SELECT workspace_id FROM users WHERE id=NEW.user_id) WHERE token_hash=NEW.token_hash; END;
      ALTER TABLE workspace_members DROP COLUMN left_at; DROP TABLE sidebar_preferences; DROP TABLE message_requests; DROP TABLE draft_attachments; DROP TRIGGER deleted_thread_drafts; DROP TABLE saved_messages; PRAGMA user_version=6; COMMIT; PRAGMA foreign_keys=ON;`);
    repo.close();
    repo = new Repository(openDatabase(path));
    assert.equal(repo.get("PRAGMA user_version")!.user_version, 11);
    assert.equal(repo.session(token)!.workspace_id, alpha.workspaceId);
    assert.equal(
      repo.get("SELECT device FROM session_devices WHERE token_hash=?", token)!
        .device,
      "Same device",
    );
    assert.equal(
      repo.get("SELECT count(*) AS n FROM push_subscriptions")!.n,
      1,
    );
    repo.run("DELETE FROM workspaces WHERE id=?", alpha.workspaceId);
    assert.equal(repo.session(token)!.workspace_id, null);
    assert.ok(repo.get("SELECT id FROM users WHERE id=?", alpha.userId));
    const explicit = hash("explicit-account"),
      implicit = hash("legacy-omitted");
    repo.run(
      "INSERT INTO sessions(token_hash,user_id,workspace_id,expires_at) VALUES (?,?,NULL,?)",
      explicit,
      alpha.userId,
      Date.now() + 600_000,
    );
    repo.run(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)",
      implicit,
      alpha.userId,
      Date.now() + 600_000,
    );
    assert.equal(repo.session(explicit)!.workspace_id, null);
    assert.equal(repo.session(implicit)!.workspace_id, beta.workspaceId);
    assert.equal(repo.get("SELECT count(*) AS n FROM session_devices")!.n, 1);
    assert.equal(
      repo.get("SELECT count(*) AS n FROM push_subscriptions")!.n,
      1,
    );
    assert.deepEqual(repo.all("PRAGMA foreign_key_check"), []);
    repo.close();
    repo = new Repository(openDatabase(path));
    assert.equal(repo.session(explicit)!.workspace_id, null);
    assert.equal(repo.session(token)!.workspace_id, null);
  } finally {
    repo?.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
  }
});
