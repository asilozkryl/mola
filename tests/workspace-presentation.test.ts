import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID, scryptSync } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import express from "express";
import { io as connect, type Socket } from "socket.io-client";
import { createApp } from "../server/app.js";
import { createWorkspace } from "../server/seed.js";
import { openDatabase, Repository } from "../server/db.js";
import { installWorkspacePresentation } from "../server/workspace-presentation.js";
import { HttpError } from "../server/errors.js";
// @ts-expect-error Operational scripts run directly under Node.
import { verifyBackup } from "../scripts/backup-runner.mjs";

const origin = "http://workspace-presentation.test";
const password = "workspace-presentation-password";
const passwordHash = `presentation-salt:${scryptSync(password, "presentation-salt", 64).toString("hex")}`;
const png = () =>
  sharp({
    create: { width: 900, height: 700, channels: 3, background: "#6542ab" },
  })
    .png()
    .withExif({ IFD0: { Artist: "Private metadata" } })
    .toBuffer();
type Client = {
  userId: string;
  sessionHash: string;
  cookie: string;
  request: (
    path: string,
    method?: string,
    body?: unknown,
    headers?: Record<string, string>,
  ) => Promise<Response>;
  upload: (
    workspaceId: string,
    bytes: Uint8Array,
    name?: string,
    mime?: string,
  ) => Promise<Response>;
};

async function fixture(
  run: (context: {
    runtime: ReturnType<typeof createApp>;
    directory: string;
    alpha: ReturnType<typeof createWorkspace>;
    beta: ReturnType<typeof createWorkspace>;
    foreign: ReturnType<typeof createWorkspace>;
    owner: Client;
    member: Client;
    outsider: Client;
    client: (userId: string, workspaceId: string | null) => Client;
    socket: (actor: Client) => Promise<Socket>;
  }) => Promise<void>,
) {
  const directory = mkdtempSync(join(tmpdir(), "mola-workspace-presentation-"));
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
    const sessionHash = createHash("sha256").update(token).digest("hex");
    runtime.repo.run(
      "INSERT INTO sessions(token_hash,user_id,workspace_id,expires_at) VALUES (?,?,?,?)",
      sessionHash,
      userId,
      workspaceId,
      Date.now() + 600_000,
    );
    const headers = {
      Origin: origin,
      Cookie: `mola_session=${token}`,
      "X-User-Id": userId,
    };
    return {
      userId,
      sessionHash,
      cookie: headers.Cookie,
      request: (path, method = "GET", body, extra = {}) =>
        fetch(base + path, {
          method,
          headers: {
            ...headers,
            ...extra,
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      upload: (workspaceId, bytes, name = "photo.png", mime = "image/png") => {
        const body = new FormData();
        body.set(
          "file",
          new Blob([new Uint8Array(bytes)], { type: mime }),
          name,
        );
        return fetch(`${base}/api/workspaces/${workspaceId}/avatar`, {
          method: "POST",
          headers,
          body,
        });
      },
    };
  };
  const socket = async (actor: Client) => {
    const value = connect(base, {
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
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
      userName: "Owner",
      email: "owner@presentation.test",
      passwordHash,
    });
    const beta = createWorkspace(runtime.repo, {
      name: "Beta",
      userName: "Member",
      email: "member@presentation.test",
      passwordHash,
    });
    const foreign = createWorkspace(runtime.repo, {
      name: "Foreign",
      userName: "Outsider",
      email: "outsider@presentation.test",
      passwordHash,
    });
    runtime.repo.run("UPDATE users SET email_verified=1");
    runtime.repo.run(
      "INSERT INTO workspace_members(workspace_id,user_id,role,joined_at) VALUES (?,?,'member',?)",
      beta.workspaceId,
      alpha.userId,
      "2099-01-01T00:00:00.000Z",
    );
    runtime.repo.run(
      "INSERT INTO workspace_members(workspace_id,user_id,role,joined_at) VALUES (?,?,'member',?)",
      alpha.workspaceId,
      beta.userId,
      "1999-01-01T00:00:00.000Z",
    );
    await run({
      runtime,
      directory,
      alpha,
      beta,
      foreign,
      owner: client(alpha.userId, alpha.workspaceId),
      member: client(beta.userId, beta.workspaceId),
      outsider: client(foreign.userId, foreign.workspaceId),
      client,
      socket,
    });
  } finally {
    for (const value of sockets) value.disconnect();
    await runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("workspace order is account-scoped, revision checked and shared by new sessions and bootstrap", async () =>
  fixture(async ({ runtime, alpha, beta, owner, member, client, socket }) => {
    const initial = await owner.request("/api/workspace-order");
    assert.equal(initial.status, 200);
    assert.deepEqual(await initial.json(), {
      userId: owner.userId,
      revision: 0,
      workspaceIds: [alpha.workspaceId, beta.workspaceId],
    });
    const otherDevice = client(owner.userId, null);
    const ownSocket = await socket(otherDevice);
    const otherSocket = await socket(member);
    const unrelated: unknown[] = [];
    otherSocket.on("workspace-order:updated", (value) => unrelated.push(value));
    const received = new Promise((resolve) =>
      ownSocket.once("workspace-order:updated", resolve),
    );
    const saved = await owner.request("/api/workspace-order", "PUT", {
      revision: 0,
      workspaceIds: [beta.workspaceId, alpha.workspaceId],
    });
    assert.equal(saved.status, 200);
    const state = await saved.json();
    assert.deepEqual(state, {
      userId: owner.userId,
      revision: 1,
      workspaceIds: [beta.workspaceId, alpha.workspaceId],
    });
    assert.deepEqual(await received, state);
    assert.deepEqual(
      await (await otherDevice.request("/api/workspace-order")).json(),
      state,
    );
    const bootstrap = await (await otherDevice.request("/api/auth/me")).json();
    assert.equal(bootstrap.accountOnly, true);
    assert.deepEqual(
      bootstrap.workspaces.map((w: { id: string }) => w.id),
      state.workspaceIds,
    );
    assert.deepEqual(
      runtime.repo.workspaces(member.userId).map((w) => w.id),
      [alpha.workspaceId, beta.workspaceId],
    );
    const stale = await otherDevice.request("/api/workspace-order", "PUT", {
      revision: 0,
      workspaceIds: [],
    });
    assert.equal(stale.status, 409);
    assert.equal(
      (await stale.json()).code,
      "WORKSPACE_ORDER_REVISION_CONFLICT",
    );
    assert.deepEqual(unrelated, []);
    const freshDevice = client(owner.userId, beta.workspaceId);
    assert.deepEqual(
      (
        await (await freshDevice.request("/api/workspaces")).json()
      ).workspaces.map((w: { id: string }) => w.id),
      state.workspaceIds,
    );
  }));

test("workspace order rejects foreign, removed and duplicate IDs and appends newly joined memberships", async () =>
  fixture(async ({ runtime, alpha, beta, foreign, owner }) => {
    for (const workspaceIds of [
      [foreign.workspaceId],
      [alpha.workspaceId, alpha.workspaceId],
      [randomUUID()],
    ]) {
      assert.equal(
        (
          await owner.request("/api/workspace-order", "PUT", {
            revision: 0,
            workspaceIds,
          })
        ).status,
        400,
      );
    }
    assert.equal(
      (await owner.request("/api/workspace-order", "PUT", { workspaceIds: [] }))
        .status,
      400,
    );
    assert.equal(
      (
        await owner.request("/api/workspace-order", "PUT", {
          revision: 0,
          workspaceIds: [beta.workspaceId],
        })
      ).status,
      200,
    );
    runtime.repo.run(
      "INSERT INTO workspace_members(workspace_id,user_id,role,joined_at) VALUES (?,?,'guest',?)",
      foreign.workspaceId,
      owner.userId,
      "2099-02-01T00:00:00.000Z",
    );
    assert.deepEqual(
      (await (await owner.request("/api/workspace-order")).json()).workspaceIds,
      [beta.workspaceId, alpha.workspaceId, foreign.workspaceId],
    );
    runtime.repo.run(
      "UPDATE workspace_members SET removed_at=? WHERE user_id=? AND workspace_id=?",
      new Date().toISOString(),
      owner.userId,
      beta.workspaceId,
    );
    assert.deepEqual(
      (await (await owner.request("/api/workspace-order")).json()).workspaceIds,
      [alpha.workspaceId, foreign.workspaceId],
    );
    assert.equal(
      (
        await owner.request("/api/workspace-order", "PUT", {
          revision: 1,
          workspaceIds: [beta.workspaceId],
        })
      ).status,
      400,
    );
    assert.equal(
      runtime.repo.canAccessChannel(
        owner.userId,
        runtime.repo.channels(foreign.userId, foreign.workspaceId)[0].id,
        foreign.workspaceId,
      ),
      false,
    );
  }));

test("workspace photos are normalized, private, visible across selected workspaces and version-revoked", async () =>
  fixture(
    async ({
      runtime,
      directory,
      alpha,
      beta,
      owner,
      member,
      outsider,
      socket,
    }) => {
      const memberSocket = await socket(member);
      const foreignSocket = await socket(outsider);
      const foreignEvents: unknown[] = [];
      foreignSocket.on("workspace:updated", (value) =>
        foreignEvents.push(value),
      );
      const received = new Promise((resolve) =>
        memberSocket.once("workspace:updated", resolve),
      );
      const uploaded = await owner.upload(alpha.workspaceId, await png());
      assert.equal(uploaded.status, 200);
      const first = await uploaded.json();
      assert.equal(first.id, alpha.workspaceId);
      assert.match(
        first.avatarUrl,
        new RegExp(`^/api/workspaces/${alpha.workspaceId}/avatar/`),
      );
      assert.deepEqual(await received, first);
      const image = await member.request(first.avatarUrl);
      assert.equal(image.status, 200);
      assert.equal(image.headers.get("content-type"), "image/webp");
      assert.equal(image.headers.get("cache-control"), "private, no-store");
      assert.equal(image.headers.get("x-content-type-options"), "nosniff");
      const metadata = await sharp(
        Buffer.from(await image.arrayBuffer()),
      ).metadata();
      assert.equal(metadata.width, 512);
      assert.equal(metadata.height, 512);
      assert.equal(metadata.exif, undefined);
      assert.equal((await outsider.request(first.avatarUrl)).status, 404);
      assert.equal(
        (await member.upload(alpha.workspaceId, await png())).status,
        404,
        "another selected workspace is never writable",
      );
      const listed = (
        await (await member.request("/api/workspaces")).json()
      ).workspaces.find((w: { id: string }) => w.id === alpha.workspaceId);
      assert.equal(listed.avatarUrl, first.avatarUrl);
      assert.equal(
        runtime.repo.workspace(beta.workspaceId).avatarUrl,
        undefined,
      );
      const firstPath = join(
        directory,
        "uploads",
        "workspace-avatars",
        first.avatarUrl.split("/").at(-1) + ".webp",
      );
      assert.equal(existsSync(firstPath), true);
      const second = await (
        await owner.upload(alpha.workspaceId, await png())
      ).json();
      assert.notEqual(second.avatarUrl, first.avatarUrl);
      assert.equal(existsSync(firstPath), false);
      assert.equal(
        (
          await member.request(first.avatarUrl, "GET", undefined, {
            "If-None-Match": image.headers.get("etag")!,
          })
        ).status,
        404,
      );
      runtime.repo.run(
        "UPDATE workspace_members SET suspended_at=? WHERE user_id=? AND workspace_id=?",
        new Date().toISOString(),
        member.userId,
        alpha.workspaceId,
      );
      assert.equal((await member.request(second.avatarUrl)).status, 404);
      const removed = await owner.request(
        `/api/workspaces/${alpha.workspaceId}/avatar`,
        "DELETE",
      );
      assert.equal(removed.status, 200);
      assert.equal((await removed.json()).avatarUrl, undefined);
      assert.equal(
        existsSync(
          join(
            directory,
            "uploads",
            "workspace-avatars",
            second.avatarUrl.split("/").at(-1) + ".webp",
          ),
        ),
        false,
      );
      assert.deepEqual(foreignEvents, []);
    },
  ));

test("only current active owners/admins can edit workspace photos and invalid uploads leave no photo", async () =>
  fixture(async ({ runtime, alpha, owner, member, client }) => {
    const currentMember = client(member.userId, alpha.workspaceId);
    for (const role of ["member", "moderator", "guest"]) {
      runtime.repo.run(
        "UPDATE workspace_members SET role=? WHERE user_id=? AND workspace_id=?",
        role,
        member.userId,
        alpha.workspaceId,
      );
      assert.equal(
        (await currentMember.upload(alpha.workspaceId, await png())).status,
        403,
      );
      assert.equal(
        (
          await currentMember.request(
            `/api/workspaces/${alpha.workspaceId}/avatar`,
            "DELETE",
          )
        ).status,
        403,
      );
    }
    for (const bytes of [
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      Buffer.from("not an image"),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    ]) {
      assert.equal((await owner.upload(alpha.workspaceId, bytes)).status, 400);
    }
    assert.equal(
      (
        await owner.upload(
          alpha.workspaceId,
          new Uint8Array(5 * 1024 * 1024 + 1),
        )
      ).status,
      413,
    );
    assert.equal(
      runtime.repo.workspace(alpha.workspaceId).avatarUrl,
      undefined,
    );
    runtime.repo.run(
      "UPDATE workspace_members SET role='admin' WHERE user_id=? AND workspace_id=?",
      member.userId,
      alpha.workspaceId,
    );
    assert.equal(
      (await currentMember.upload(alpha.workspaceId, await png())).status,
      200,
    );
    runtime.repo.run(
      "UPDATE workspaces SET suspended_at=? WHERE id=?",
      new Date().toISOString(),
      alpha.workspaceId,
    );
    assert.equal(
      (
        await currentMember.request(
          `/api/workspaces/${alpha.workspaceId}/avatar`,
          "DELETE",
        )
      ).status,
      403,
    );
  }));

test("workspace deletion removes its stored photo and prunes personal rail order", async () =>
  fixture(async ({ runtime, directory, alpha, beta, owner }) => {
    const photo = await (
      await owner.upload(alpha.workspaceId, await png())
    ).json();
    assert.equal(
      (
        await owner.request("/api/workspace-order", "PUT", {
          revision: 0,
          workspaceIds: [alpha.workspaceId, beta.workspaceId],
        })
      ).status,
      200,
    );
    const deleted = await owner.request(
      `/api/workspaces/${alpha.workspaceId}`,
      "DELETE",
      { confirmName: "Alpha", password },
    );
    assert.equal(deleted.status, 200);
    assert.equal(
      existsSync(
        join(
          directory,
          "uploads",
          "workspace-avatars",
          photo.avatarUrl.split("/").at(-1) + ".webp",
        ),
      ),
      false,
    );
    assert.deepEqual(
      runtime.repo.workspaces(owner.userId).map((w) => w.id),
      [beta.workspaceId],
    );
    assert.equal((await owner.request(photo.avatarUrl)).status, 404);
  }));

test("workspace presentation migrates v10 data and persists account order across database restarts", () => {
  const directory = mkdtempSync(
    join(tmpdir(), "mola-workspace-presentation-migration-"),
  );
  const path = join(directory, "mola.sqlite");
  let repo = new Repository(openDatabase(path));
  try {
    const alpha = createWorkspace(repo, {
      name: "Preserved",
      userName: "Owner",
      email: "migration@presentation.test",
      passwordHash,
    });
    repo.db.exec(
      "DROP TABLE workspace_order_preferences; ALTER TABLE workspaces DROP COLUMN avatar_version; PRAGMA user_version=10;",
    );
    const before = {
      users: repo.all("SELECT * FROM users"),
      members: repo.all("SELECT * FROM workspace_members"),
      channels: repo.all("SELECT * FROM channels"),
    };
    repo.close();
    repo = new Repository(openDatabase(path));
    assert.equal(repo.get("PRAGMA user_version")!.user_version, 11);
    assert.deepEqual(repo.all("SELECT * FROM users"), before.users);
    assert.deepEqual(
      repo.all("SELECT * FROM workspace_members"),
      before.members,
    );
    assert.deepEqual(repo.all("SELECT * FROM channels"), before.channels);
    assert.equal(repo.workspace(alpha.workspaceId).avatarUrl, undefined);
    const beta = createWorkspace(repo, {
      name: "Second",
      userName: "Owner",
      email: "migration@presentation.test",
      passwordHash,
      existingUserId: alpha.userId,
    });
    const version = randomUUID();
    repo.run(
      "UPDATE workspaces SET avatar_version=? WHERE id=?",
      version,
      alpha.workspaceId,
    );
    repo.run(
      "INSERT INTO workspace_order_preferences VALUES(?,1,?,?)",
      alpha.userId,
      JSON.stringify([beta.workspaceId, alpha.workspaceId]),
      new Date().toISOString(),
    );
    repo.close();
    repo = new Repository(openDatabase(path));
    assert.deepEqual(
      repo.workspaces(alpha.userId).map((w) => w.id),
      [beta.workspaceId, alpha.workspaceId],
    );
    assert.equal(
      repo.workspace(alpha.workspaceId).avatarUrl,
      `/api/workspaces/${alpha.workspaceId}/avatar/${version}`,
    );
    repo.run(
      "UPDATE workspace_order_preferences SET workspace_ids_json='invalid json' WHERE user_id=?",
      alpha.userId,
    );
    assert.equal(
      repo.workspaces(alpha.userId).length,
      2,
      "malformed historic data cannot hide memberships",
    );
    repo.run("DELETE FROM users WHERE id=?", alpha.userId);
    assert.equal(
      repo.get(
        "SELECT 1 FROM workspace_order_preferences WHERE user_id=?",
        alpha.userId,
      ),
      undefined,
    );
    assert.deepEqual(repo.all("PRAGMA foreign_key_check"), []);
  } finally {
    repo.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("workspace photos enter verified immutable backups and unexpected files remain rejected", async () =>
  fixture(async ({ directory, alpha, owner }) => {
    const first = await (
      await owner.upload(alpha.workspaceId, await png())
    ).json();
    const relativePath = `uploads/workspace-avatars/${first.avatarUrl.split("/").at(-1)}.webp`;
    const original = readFileSync(join(directory, relativePath));
    const token = readFileSync(join(directory, ".ops-token"), "utf8").trim();
    const response = await owner.request(
      "/internal/snapshots",
      "POST",
      undefined,
      { Authorization: `Bearer ${token}` },
    );
    assert.equal(response.status, 201);
    const snapshot = await response.json();
    assert.equal(snapshot.files, 1);
    const snapshotPath = join(directory, "snapshots", snapshot.id);
    assert.equal(
      (await owner.upload(alpha.workspaceId, await png())).status,
      200,
    );
    assert.equal(existsSync(join(directory, relativePath)), false);
    assert.deepEqual(readFileSync(join(snapshotPath, relativePath)), original);
    const verified = await verifyBackup(snapshotPath);
    assert.equal(verified.files, 1);
    assert.equal(typeof verified.checksums[relativePath], "string");
    const restored = new Repository(
      openDatabase(join(snapshotPath, "mola.sqlite")),
    );
    try {
      assert.equal(
        restored.workspace(alpha.workspaceId).avatarUrl,
        first.avatarUrl,
      );
    } finally {
      restored.close();
    }
    writeFileSync(
      join(snapshotPath, "uploads", "workspace-avatars", "unexpected.webp"),
      "extra",
    );
    await assert.rejects(
      () => verifyBackup(snapshotPath),
      /Invalid backup avatar entry/,
    );
  }));

test("photo writes recheck the account, selected workspace, membership and role after asynchronous decoding", async () =>
  fixture(async ({ runtime, directory, alpha, beta, owner, member }) => {
    const saved = await (
      await owner.upload(alpha.workspaceId, await png())
    ).json();
    const transaction = runtime.repo.transaction.bind(runtime.repo);
    let hook: (() => void) | undefined;
    runtime.repo.transaction = <T>(fn: () => T): T => {
      const before = hook;
      hook = undefined;
      before?.();
      return transaction(fn);
    };
    const races = [
      {
        status: 409,
        mutate: () =>
          runtime.repo.run(
            "UPDATE sessions SET workspace_id=? WHERE token_hash=?",
            beta.workspaceId,
            owner.sessionHash,
          ),
        reset: () =>
          runtime.repo.run(
            "UPDATE sessions SET workspace_id=? WHERE token_hash=?",
            alpha.workspaceId,
            owner.sessionHash,
          ),
      },
      {
        status: 409,
        mutate: () =>
          runtime.repo.run(
            "UPDATE sessions SET user_id=? WHERE token_hash=?",
            member.userId,
            owner.sessionHash,
          ),
        reset: () =>
          runtime.repo.run(
            "UPDATE sessions SET user_id=? WHERE token_hash=?",
            owner.userId,
            owner.sessionHash,
          ),
      },
      {
        status: 401,
        mutate: () =>
          runtime.repo.run(
            "UPDATE sessions SET expires_at=0 WHERE token_hash=?",
            owner.sessionHash,
          ),
        reset: () =>
          runtime.repo.run(
            "UPDATE sessions SET expires_at=? WHERE token_hash=?",
            Date.now() + 600_000,
            owner.sessionHash,
          ),
      },
      {
        status: 403,
        mutate: () =>
          runtime.repo.run(
            "UPDATE workspace_members SET role='member' WHERE workspace_id=? AND user_id=?",
            alpha.workspaceId,
            owner.userId,
          ),
        reset: () =>
          runtime.repo.run(
            "UPDATE workspace_members SET role='owner' WHERE workspace_id=? AND user_id=?",
            alpha.workspaceId,
            owner.userId,
          ),
      },
      {
        status: 403,
        mutate: () =>
          runtime.repo.run(
            "UPDATE workspace_members SET removed_at='removed' WHERE workspace_id=? AND user_id=?",
            alpha.workspaceId,
            owner.userId,
          ),
        reset: () =>
          runtime.repo.run(
            "UPDATE workspace_members SET removed_at=NULL WHERE workspace_id=? AND user_id=?",
            alpha.workspaceId,
            owner.userId,
          ),
      },
      {
        status: 403,
        mutate: () =>
          runtime.repo.run(
            "UPDATE workspaces SET suspended_at='suspended' WHERE id=?",
            alpha.workspaceId,
          ),
        reset: () =>
          runtime.repo.run(
            "UPDATE workspaces SET suspended_at=NULL WHERE id=?",
            alpha.workspaceId,
          ),
      },
    ];
    for (const race of races) {
      hook = race.mutate;
      assert.equal(
        (await owner.upload(alpha.workspaceId, await png())).status,
        race.status,
      );
      race.reset();
      assert.equal(
        runtime.repo.workspace(alpha.workspaceId).avatarUrl,
        saved.avatarUrl,
      );
    }
    assert.deepEqual(
      readdirSync(join(directory, "uploads", "workspace-avatars")),
      [saved.avatarUrl.split("/").at(-1) + ".webp"],
    );
  }));

test("failed photo persistence retains the old image and maintenance removes only expired unreferenced photos", async () =>
  fixture(async ({ runtime, directory, alpha, owner }) => {
    const saved = await (
      await owner.upload(alpha.workspaceId, await png())
    ).json();
    const previousRun = runtime.repo.run.bind(runtime.repo);
    runtime.repo.run = (sql, ...args) => {
      if (sql.startsWith("UPDATE workspaces SET avatar_version=?"))
        throw new HttpError(503, "Storage temporarily unavailable.");
      return previousRun(sql, ...args);
    };
    assert.equal(
      (await owner.upload(alpha.workspaceId, await png())).status,
      503,
    );
    runtime.repo.run = previousRun;
    const avatarDir = join(directory, "uploads", "workspace-avatars");
    const savedName = saved.avatarUrl.split("/").at(-1) + ".webp";
    assert.deepEqual(readdirSync(avatarDir), [savedName]);
    assert.equal(
      runtime.repo.workspace(alpha.workspaceId).avatarUrl,
      saved.avatarUrl,
    );
    const expired = randomUUID() + ".webp",
      pending = randomUUID() + ".webp";
    const unrelated = "original.jpg",
      old = new Date(Date.now() - 120_000);
    for (const name of [expired, pending, unrelated])
      writeFileSync(join(avatarDir, name), "fixture");
    for (const name of [expired, savedName, unrelated])
      utimesSync(join(avatarDir, name), old, old);
    const presentation = installWorkspacePresentation(express(), {
      repo: runtime.repo,
      io: runtime.io,
      uploadDir: join(directory, "uploads"),
      requiresVerification: () => false,
    });
    presentation.cleanup();
    assert.deepEqual(
      readdirSync(avatarDir).sort(),
      [pending, unrelated, savedName].sort(),
    );
    runtime.repo.run("DELETE FROM workspaces WHERE id=?", alpha.workspaceId);
    presentation.cleanup();
    assert.deepEqual(
      readdirSync(avatarDir).sort(),
      [pending, unrelated].sort(),
    );
  }));
