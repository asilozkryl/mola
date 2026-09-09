import { restoreLegacyNotificationSchema } from "./notification-migration-fixture.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { io as connect, type Socket } from "socket.io-client";
import express from "express";
import { createApp } from "../server/app.js";
import { openDatabase, Repository } from "../server/db.js";
import { createWorkspace } from "../server/seed.js";
import { installProfileRoutes } from "../server/profiles.js";
import { HttpError } from "../server/errors.js";
import type { User, WorkspaceRole } from "../shared/types.js";

type Session = {
  id: string;
  workspaceId: string;
  cookie: string;
  hash: string;
};
const origin = "http://profiles.test";
const png = () =>
  sharp({
    create: { width: 900, height: 700, channels: 3, background: "#326f58" },
  })
    .png()
    .withExif({ IFD0: { Artist: "Private image metadata" } })
    .toBuffer();
async function fixture(
  run: (context: {
    runtime: ReturnType<typeof createApp>;
    directory: string;
    owner: Session;
    member: Session;
    guest: Session;
    foreign: Session;
    request: (
      actor: Session | null,
      path: string,
      method?: string,
      body?: unknown,
      headers?: Record<string, string>,
    ) => Promise<Response>;
    upload: (
      actor: Session | null,
      bytes: Uint8Array,
      name?: string,
      mime?: string,
    ) => Promise<Response>;
    socket: (actor: Session) => Promise<Socket>;
  }) => Promise<void>,
  verificationRequired = false,
) {
  const directory = await mkdtemp(join(tmpdir(), "mola-profiles-"));
  const runtime = createApp({
    dataDir: directory,
    production: false,
    appOrigin: origin,
    requireEmailVerification: verificationRequired,
    mailTransport: async () => {},
    mailEncryptionKey: "6".repeat(64),
  });
  const sockets: Socket[] = [];
  await new Promise<void>((done) =>
    runtime.server.listen(0, "127.0.0.1", done),
  );
  const base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
  const seed = createWorkspace(runtime.repo, {
    name: "Profile team",
    userName: "Owner",
    email: "owner@profiles.test",
    passwordHash: null,
  });
  const other = createWorkspace(runtime.repo, {
    name: "Other team",
    userName: "Other owner",
    email: "foreign@profiles.test",
    passwordHash: null,
  });
  const account = (
    role: WorkspaceRole,
    workspaceId = seed.workspaceId,
    existingId?: string,
  ): Session => {
    const id = existingId ?? randomUUID();
    if (!existingId) {
      runtime.repo.run(
        "INSERT INTO users(id,workspace_id,name,email,color,role,created_at) VALUES (?,?,?,?,?,?,?)",
        id,
        workspaceId,
        role,
        `${id}@profiles.test`,
        "#abcdef",
        "member",
        new Date().toISOString(),
      );
      runtime.repo.run(
        "UPDATE workspace_members SET role=? WHERE user_id=? AND workspace_id=?",
        role,
        id,
        workspaceId,
      );
    }
    runtime.repo.run("UPDATE users SET email_verified=1 WHERE id=?", id);
    const token = randomBytes(32).toString("hex");
    const hash = createHash("sha256").update(token).digest("hex");
    runtime.repo.run(
      "INSERT INTO sessions(token_hash,user_id,workspace_id,expires_at) VALUES (?,?,?,?)",
      hash,
      id,
      workspaceId,
      Date.now() + 600_000,
    );
    return { id, workspaceId, hash, cookie: `mola_session=${token}` };
  };
  const request = (
    actor: Session | null,
    path: string,
    method = "GET",
    body?: unknown,
    headers?: Record<string, string>,
  ) =>
    fetch(base + (path.startsWith("/api/") ? path : "/api" + path), {
      method,
      headers: {
        Origin: origin,
        ...(actor ? { Cookie: actor.cookie } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const upload = (
    actor: Session | null,
    bytes: Uint8Array,
    name = "photo.png",
    mime = "image/png",
  ) => {
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(bytes)], { type: mime }), name);
    return fetch(base + "/api/profile/avatar", {
      method: "POST",
      headers: { Origin: origin, ...(actor ? { Cookie: actor.cookie } : {}) },
      body: form,
    });
  };
  const socket = async (actor: Session) => {
    const client = connect(base, {
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
      timeout: 2500,
      extraHeaders: { Origin: origin, Cookie: actor.cookie },
    });
    sockets.push(client);
    await new Promise<void>((done, reject) => {
      client.once("connect", done);
      client.once("connect_error", reject);
    });
    return client;
  };
  try {
    await run({
      runtime,
      directory,
      owner: account("owner", seed.workspaceId, seed.userId),
      member: account("member"),
      guest: account("guest"),
      foreign: account("owner", other.workspaceId, other.userId),
      request,
      upload,
      socket,
    });
  } finally {
    sockets.forEach((client) => client.disconnect());
    await runtime.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory, { recursive: true, force: true });
  }
}

test("v5 profile migration preserves identities, memberships and history and survives repeated opens", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mola-profiles-migration-"));
  const path = join(directory, "mola.sqlite");
  let repo: Repository | undefined;
  try {
    repo = new Repository(openDatabase(path));
    const seed = createWorkspace(repo, {
      name: "Existing team",
      userName: "Existing owner",
      email: "old@profiles.test",
      passwordHash: "same-password",
    });
    const channel = repo.channels(seed.userId, seed.workspaceId)[0];
    const messageId = randomUUID();
    repo.run(
      "INSERT INTO messages(id,channel_id,user_id,content,created_at) VALUES (?,?,?,?,?)",
      messageId,
      channel.id,
      seed.userId,
      "Existing history",
      new Date().toISOString(),
    );
    restoreLegacyNotificationSchema(repo.db);
    repo.db.exec(
      "DROP TABLE message_requests; DROP TABLE draft_attachments; DROP TRIGGER deleted_thread_drafts; DROP TABLE saved_messages; ALTER TABLE users DROP COLUMN job_title; ALTER TABLE users DROP COLUMN bio; ALTER TABLE users DROP COLUMN location; ALTER TABLE users DROP COLUMN avatar_version; PRAGMA user_version=5;",
    );
    repo.close();
    repo = new Repository(openDatabase(path));
    assert.equal(repo.get("PRAGMA user_version")!.user_version, 10);
    assert.equal(repo.member(seed.userId, seed.workspaceId)!.role, "owner");
    assert.equal(
      repo.get("SELECT password_hash FROM users WHERE id=?", seed.userId)!
        .password_hash,
      "same-password",
    );
    assert.equal(
      repo.get("SELECT content FROM messages WHERE id=?", messageId)!.content,
      "Existing history",
    );
    const user = repo.user(repo.member(seed.userId, seed.workspaceId)!);
    assert.equal(user.jobTitle, "");
    assert.equal(user.bio, "");
    assert.equal(user.location, "");
    assert.equal(user.avatarUrl, undefined);
    repo.run(
      "UPDATE users SET job_title=?,bio=?,location=?,avatar_version=? WHERE id=?",
      "Designer",
      "About me",
      "İstanbul",
      "f8dbd28f-e3b2-4a08-ac1d-6d3ac035e0f8",
      seed.userId,
    );
    repo.close();
    repo = new Repository(openDatabase(path));
    assert.equal(
      repo.user(repo.member(seed.userId, seed.workspaceId)!).bio,
      "About me",
    );
    assert.deepEqual(repo.all("PRAGMA foreign_key_check"), []);
  } finally {
    repo?.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory, { recursive: true, force: true });
  }
});

test("profiles preserve old name/status clients, validate fields, and show only active workspace peers", async () =>
  fixture(async ({ runtime, owner, member, guest, foreign, request }) => {
    assert.equal(
      (await request(null, `/members/${owner.id}/profile`)).status,
      401,
    );
    assert.equal(
      (await request(foreign, `/members/${owner.id}/profile`)).status,
      404,
    );
    assert.equal(
      (await request(owner, "/members/not-an-id/profile")).status,
      404,
    );
    const response = await request(owner, "/profile", "PATCH", {
      name: " Updated Name ",
      status: " At work ",
      jobTitle: " Product designer ",
      bio: " Hello\nteam ",
      location: " İstanbul ",
    });
    assert.equal(response.status, 200);
    const updated = await response.json();
    assert.equal(updated.name, "Updated Name");
    assert.equal(updated.jobTitle, "Product designer");
    assert.equal(updated.bio, "Hello\nteam");
    assert.equal(updated.location, "İstanbul");
    const legacy = await (
      await request(owner, "/profile", "PATCH", { status: "Available" })
    ).json();
    assert.equal(legacy.name, updated.name);
    assert.equal(legacy.jobTitle, updated.jobTitle);
    assert.equal(legacy.bio, updated.bio);
    const profile = await (
      await request(member, `/members/${owner.id}/profile`)
    ).json();
    assert.equal(profile.user.name, updated.name);
    assert.equal(
      profile.joinedAt,
      runtime.repo.member(owner.id, owner.workspaceId)!.joined_at,
    );
    assert.equal(profile.canMessage, true);
    assert.equal(
      (await (await request(owner, `/members/${owner.id}/profile`)).json())
        .canMessage,
      false,
    );
    assert.equal(
      (await (await request(guest, `/members/${owner.id}/profile`)).json())
        .canMessage,
      false,
    );
    const dm = randomUUID();
    runtime.repo.run(
      "INSERT INTO channels(id,workspace_id,name,kind,visibility,created_at) VALUES (?,?,?,'dm','private',?)",
      dm,
      owner.workspaceId,
      "Assigned conversation",
      new Date().toISOString(),
    );
    for (const userId of [owner.id, guest.id])
      runtime.repo.run("INSERT INTO channel_members VALUES (?,?)", dm, userId);
    assert.equal(
      (await (await request(guest, `/members/${owner.id}/profile`)).json())
        .canMessage,
      true,
    );
    const channel = runtime.repo
      .channels(owner.id, owner.workspaceId)
      .find((item) => item.kind === "text")!;
    const integrationResponse = await request(owner, "/integrations", "POST", {
      channelId: channel.id,
      name: "Profile bot",
      kind: "webhook",
    });
    assert.equal(integrationResponse.status, 201);
    const integration = await integrationResponse.json();
    const botId = runtime.repo.get(
      "SELECT bot_user_id FROM integrations WHERE id=?",
      integration.id,
    )!.bot_user_id;
    runtime.repo.run("INSERT INTO channel_members VALUES (?,?)", dm, botId);
    const botProfile = await (
      await request(owner, `/members/${botId}/profile`)
    ).json();
    assert.equal(botProfile.user.isBot, true);
    assert.equal(
      botProfile.canMessage,
      false,
      "automated accounts do not offer a personal conversation action",
    );
    for (const input of [
      {},
      { role: "owner" },
      { name: "x" },
      { status: "x".repeat(101) },
      { jobTitle: "x".repeat(81) },
      { bio: "x".repeat(501) },
      { location: "x".repeat(81) },
      { avatarUrl: "https://untrusted.test/file.png" },
    ])
      assert.equal(
        (await request(owner, "/profile", "PATCH", input)).status,
        400,
      );
    assert.equal(
      (await request(owner, "/profile", "PATCH", { bio: "" })).status,
      200,
    );
    assert.equal(
      runtime.repo.get("SELECT bio FROM users WHERE id=?", owner.id)!.bio,
      "",
    );
    const now = new Date().toISOString();
    for (const column of ["suspended_at", "removed_at"]) {
      runtime.repo.run(
        `UPDATE workspace_members SET ${column}=? WHERE user_id=? AND workspace_id=?`,
        now,
        owner.id,
        owner.workspaceId,
      );
      assert.equal(
        (await request(member, `/members/${owner.id}/profile`)).status,
        404,
      );
      const historical = (
        await (await request(member, "/auth/me")).json()
      ).members.find((item: User) => item.id === owner.id);
      assert.equal(historical.name, "Updated Name");
      assert.equal(historical.jobTitle, undefined);
      assert.equal(historical.bio, undefined);
      assert.equal(historical.avatarUrl, undefined);
      runtime.repo.run(
        `UPDATE workspace_members SET ${column}=NULL WHERE user_id=? AND workspace_id=?`,
        owner.id,
        owner.workspaceId,
      );
    }
  }));

test("avatar uploads decode and normalize real images, strip metadata, and protect versioned image URLs", async () =>
  fixture(async ({ runtime, owner, member, foreign, request, upload }) => {
    const response = await upload(owner, await png());
    assert.equal(response.status, 200);
    const user = await response.json();
    assert.match(
      user.avatarUrl,
      new RegExp(
        `^/api/workspaces/${owner.workspaceId}/members/${owner.id}/avatar/`,
      ),
    );
    const image = await request(member, user.avatarUrl);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/webp");
    assert.equal(image.headers.get("cache-control"), "private, no-store");
    const metadata = await sharp(
      Buffer.from(await image.arrayBuffer()),
    ).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, 512);
    assert.equal(metadata.height, 512);
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.icc, undefined);
    assert.equal((await request(null, user.avatarUrl)).status, 401);
    assert.equal((await request(foreign, user.avatarUrl)).status, 404);
    assert.equal(
      (
        await request(
          owner,
          user.avatarUrl.replace(owner.workspaceId, foreign.workspaceId),
        )
      ).status,
      404,
    );
    assert.equal(
      (await request(owner, user.avatarUrl.replace(/[^/]+$/, randomUUID())))
        .status,
      404,
    );
    runtime.repo.run(
      "UPDATE workspace_members SET removed_at=? WHERE user_id=? AND workspace_id=?",
      new Date().toISOString(),
      owner.id,
      owner.workspaceId,
    );
    assert.equal((await request(member, user.avatarUrl)).status, 404);
  }));

test("avatar replacement and removal clean old files and never mutate another user", async () =>
  fixture(async ({ directory, owner, member, request, upload }) => {
    const first = await (await upload(owner, await png())).json();
    const second = await (
      await upload(
        owner,
        await sharp({
          create: { width: 700, height: 900, channels: 3, background: "#fff" },
        })
          .jpeg()
          .withMetadata({ orientation: 6 })
          .toBuffer(),
        "portrait.jpg",
        "image/jpeg",
      )
    ).json();
    assert.notEqual(first.avatarUrl, second.avatarUrl);
    assert.equal((await request(owner, first.avatarUrl)).status, 404);
    assert.deepEqual(await readdir(join(directory, "uploads", "avatars")), [
      `${second.avatarUrl.split("/").at(-1)}.webp`,
    ]);
    const thirdResponse = await upload(
      member,
      await sharp({
        create: { width: 128, height: 128, channels: 3, background: "#111" },
      })
        .webp()
        .toBuffer(),
      "member.webp",
      "image/webp",
    );
    assert.equal(thirdResponse.status, 200);
    const third = await thirdResponse.json();
    const deleted = await request(owner, "/profile/avatar", "DELETE", {
      userId: member.id,
    });
    assert.equal(deleted.status, 200);
    assert.equal((await deleted.json()).avatarUrl, undefined);
    assert.equal((await request(member, second.avatarUrl)).status, 404);
    assert.equal((await request(owner, third.avatarUrl)).status, 200);
    assert.equal(
      (await request(owner, "/profile/avatar", "DELETE")).status,
      200,
      "removal is idempotent",
    );
    assert.deepEqual(await readdir(join(directory, "uploads", "avatars")), [
      `${third.avatarUrl.split("/").at(-1)}.webp`,
    ]);
  }));

test("invalid, forged, empty and oversized avatar inputs keep the existing photo intact", async () =>
  fixture(async ({ owner, request, upload }) => {
    const saved = await (await upload(owner, await png())).json();
    assert.equal((await upload(null, await png())).status, 401);
    for (const bytes of [
      Buffer.alloc(0),
      Buffer.from("<svg><script>alert(1)</script></svg>"),
      Buffer.from("GIF89a"),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0]),
      Buffer.from([255, 216, 255, 0, 0]),
    ]) {
      const response = await upload(owner, bytes);
      assert.equal(response.status, 400);
      assert.equal(typeof (await response.json()).error, "string");
    }
    const oversized = await upload(owner, Buffer.alloc(5 * 1024 * 1024 + 1));
    assert.equal(oversized.status, 413);
    assert.match((await oversized.json()).error, /5 MB/);
    assert.equal(
      (await request(owner, "/profile/avatar", "POST", {})).status,
      400,
    );
    assert.equal(
      (await (await request(owner, "/auth/me")).json()).user.avatarUrl,
      saved.avatarUrl,
    );
    assert.equal((await request(owner, saved.avatarUrl)).status, 200);
  }));

test("avatar decoder rejects excessive image dimensions before replacing a saved photo", async () =>
  fixture(async ({ owner, request, upload }) => {
    const saved = await (await upload(owner, await png())).json();
    const oversizedDimensions = await sharp({
      create: { width: 5001, height: 5000, channels: 3, background: "#fff" },
    })
      .png()
      .toBuffer();
    assert.ok(oversizedDimensions.length < 5 * 1024 * 1024);
    const response = await upload(owner, oversizedDimensions);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /25 megapiksel/);
    assert.equal(
      (await (await request(owner, "/auth/me")).json()).user.avatarUrl,
      saved.avatarUrl,
    );
  }));

test("failed avatar persistence rolls back the pointer and discards its newly written file", async () =>
  fixture(async ({ runtime, directory, owner, request, upload }) => {
    const saved = await (await upload(owner, await png())).json();
    const original = runtime.repo.run.bind(runtime.repo);
    runtime.repo.run = (sql, ...args) => {
      if (sql.startsWith("UPDATE users SET avatar_version=?"))
        throw new HttpError(503, "Storage temporarily unavailable.");
      return original(sql, ...args);
    };
    const response = await upload(owner, await png());
    assert.equal(response.status, 503);
    runtime.repo.run = original;
    assert.equal((await request(owner, saved.avatarUrl)).status, 200);
    assert.deepEqual(await readdir(join(directory, "uploads", "avatars")), [
      `${saved.avatarUrl.split("/").at(-1)}.webp`,
    ]);
  }));

test("avatar orphan maintenance removes only old generated files without live references", async () =>
  fixture(async ({ runtime, directory, owner, upload }) => {
    const saved = await (await upload(owner, await png())).json();
    const avatarDir = join(directory, "uploads", "avatars");
    const old = new Date(Date.now() - 120_000);
    const orphan = `${randomUUID()}.webp`;
    const pending = `${randomUUID()}.webp`;
    const unrelated = "keep-original.jpg";
    for (const name of [orphan, pending, unrelated])
      await writeFile(join(avatarDir, name), "retained until classified");
    for (const name of [
      orphan,
      unrelated,
      `${saved.avatarUrl.split("/").at(-1)}.webp`,
    ])
      await utimes(join(avatarDir, name), old, old);
    const maintenance = installProfileRoutes(express(), {
      repo: runtime.repo,
      io: runtime.io,
      uploadDir: join(directory, "uploads"),
      requiresVerification: () => false,
    });
    maintenance.cleanup();
    assert.deepEqual(
      (await readdir(avatarDir)).sort(),
      [pending, unrelated, `${saved.avatarUrl.split("/").at(-1)}.webp`].sort(),
    );
    runtime.repo.run("DELETE FROM users WHERE id=?", owner.id);
    maintenance.cleanup();
    assert.deepEqual(
      (await readdir(avatarDir)).sort(),
      [pending, unrelated].sort(),
    );
  }));

test("profile and avatar writes recheck account, session and membership under the write lock", async () =>
  fixture(
    async ({ runtime, directory, owner, member, foreign, request, upload }) => {
      const saved = await (await upload(owner, await png())).json();
      const transaction = runtime.repo.transaction.bind(runtime.repo);
      let hook: (() => void) | undefined;
      runtime.repo.transaction = <T>(fn: () => T): T => {
        const before = hook;
        hook = undefined;
        before?.();
        return transaction(fn);
      };
      const now = new Date().toISOString();
      runtime.repo.run(
        "INSERT INTO workspace_members(workspace_id,user_id,role,joined_at) VALUES (?,?,'member',?)",
        foreign.workspaceId,
        owner.id,
        now,
      );
      const races = [
        {
          status: 401,
          mutate: () =>
            runtime.repo.run(
              "DELETE FROM sessions WHERE token_hash=?",
              owner.hash,
            ),
          reset: () =>
            runtime.repo.run(
              "INSERT INTO sessions(token_hash,user_id,workspace_id,expires_at) VALUES (?,?,?,?)",
              owner.hash,
              owner.id,
              owner.workspaceId,
              Date.now() + 600_000,
            ),
        },
        {
          status: 409,
          mutate: () =>
            runtime.repo.run(
              "UPDATE sessions SET user_id=? WHERE token_hash=?",
              member.id,
              owner.hash,
            ),
          reset: () =>
            runtime.repo.run(
              "UPDATE sessions SET user_id=? WHERE token_hash=?",
              owner.id,
              owner.hash,
            ),
        },
        {
          status: 409,
          mutate: () =>
            runtime.repo.run(
              "UPDATE sessions SET workspace_id=? WHERE token_hash=?",
              foreign.workspaceId,
              owner.hash,
            ),
          reset: () =>
            runtime.repo.run(
              "UPDATE sessions SET workspace_id=? WHERE token_hash=?",
              owner.workspaceId,
              owner.hash,
            ),
        },
        {
          status: 403,
          mutate: () =>
            runtime.repo.run(
              "UPDATE users SET suspended_at=? WHERE id=?",
              now,
              owner.id,
            ),
          reset: () =>
            runtime.repo.run(
              "UPDATE users SET suspended_at=NULL WHERE id=?",
              owner.id,
            ),
        },
        {
          status: 403,
          mutate: () =>
            runtime.repo.run(
              "UPDATE workspace_members SET removed_at=? WHERE user_id=? AND workspace_id=?",
              now,
              owner.id,
              owner.workspaceId,
            ),
          reset: () =>
            runtime.repo.run(
              "UPDATE workspace_members SET removed_at=NULL WHERE user_id=? AND workspace_id=?",
              owner.id,
              owner.workspaceId,
            ),
        },
        {
          status: 403,
          mutate: () =>
            runtime.repo.run(
              "UPDATE workspace_members SET suspended_at=? WHERE user_id=? AND workspace_id=?",
              now,
              owner.id,
              owner.workspaceId,
            ),
          reset: () =>
            runtime.repo.run(
              "UPDATE workspace_members SET suspended_at=NULL WHERE user_id=? AND workspace_id=?",
              owner.id,
              owner.workspaceId,
            ),
        },
        {
          status: 403,
          mutate: () =>
            runtime.repo.run(
              "UPDATE workspaces SET suspended_at=? WHERE id=?",
              now,
              owner.workspaceId,
            ),
          reset: () =>
            runtime.repo.run(
              "UPDATE workspaces SET suspended_at=NULL WHERE id=?",
              owner.workspaceId,
            ),
        },
        {
          status: 403,
          mutate: () =>
            runtime.repo.run(
              "UPDATE users SET email_verified=0 WHERE id=?",
              owner.id,
            ),
          reset: () =>
            runtime.repo.run(
              "UPDATE users SET email_verified=1 WHERE id=?",
              owner.id,
            ),
        },
      ];
      const bytes = await png();
      for (const race of races) {
        for (const write of [
          () =>
            request(owner, "/profile", "PATCH", { name: "Should not change" }),
          () => upload(owner, bytes),
          () => request(owner, "/profile/avatar", "DELETE"),
        ]) {
          hook = race.mutate;
          assert.equal((await write()).status, race.status);
          race.reset();
          assert.equal(
            runtime.repo.get("SELECT name FROM users WHERE id=?", owner.id)!
              .name,
            "Owner",
          );
          assert.equal(
            runtime.repo.user(runtime.repo.member(owner.id, owner.workspaceId)!)
              .avatarUrl,
            saved.avatarUrl,
          );
          assert.equal(
            runtime.repo.user(
              runtime.repo.member(member.id, owner.workspaceId)!,
            ).avatarUrl,
            undefined,
          );
          assert.deepEqual(
            await readdir(join(directory, "uploads", "avatars")),
            [`${saved.avatarUrl.split("/").at(-1)}.webp`],
          );
        }
      }
      assert.equal(
        (
          await request(
            owner,
            "/profile",
            "PATCH",
            { name: "Wrong context" },
            { "X-User-Id": member.id },
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await request(
            owner,
            "/profile",
            "PATCH",
            { name: "Wrong context" },
            { "X-Workspace-Id": foreign.workspaceId },
          )
        ).status,
        409,
      );
    },
    true,
  ));

test("partial profile writes retain fields changed while the request was in flight", async () =>
  fixture(async ({ runtime, owner, request }) => {
    const transaction = runtime.repo.transaction.bind(runtime.repo);
    let once = true;
    runtime.repo.transaction = <T>(fn: () => T): T => {
      if (once) {
        once = false;
        runtime.repo.run(
          "UPDATE users SET job_title=?,bio=? WHERE id=?",
          "Concurrent title",
          "Concurrent biography",
          owner.id,
        );
      }
      return transaction(fn);
    };
    const response = await request(owner, "/profile", "PATCH", {
      status: "Current status",
    });
    assert.equal(response.status, 200);
    const user = await response.json();
    assert.equal(user.jobTitle, "Concurrent title");
    assert.equal(user.bio, "Concurrent biography");
    assert.equal(user.status, "Current status");
  }));

test("global profile updates reach shared teams with each team role and never reach unrelated workspaces", async () =>
  fixture(
    async ({ runtime, owner, member, foreign, request, upload, socket }) => {
      const now = new Date().toISOString();
      runtime.repo.run(
        "INSERT INTO workspace_members(workspace_id,user_id,role,joined_at) VALUES (?,?,'moderator',?)",
        foreign.workspaceId,
        owner.id,
        now,
      );
      const unrelated = createWorkspace(runtime.repo, {
        name: "Unrelated team",
        userName: "Unrelated owner",
        email: "unrelated@profiles.test",
        passwordHash: null,
      });
      const token = randomBytes(32).toString("hex");
      const hash = createHash("sha256").update(token).digest("hex");
      runtime.repo.run(
        "UPDATE users SET email_verified=1 WHERE id=?",
        unrelated.userId,
      );
      runtime.repo.run(
        "INSERT INTO sessions(token_hash,user_id,workspace_id,expires_at) VALUES (?,?,?,?)",
        hash,
        unrelated.userId,
        unrelated.workspaceId,
        Date.now() + 600_000,
      );
      const [local, shared, outside] = await Promise.all([
        socket(member),
        socket(foreign),
        socket({
          id: unrelated.userId,
          workspaceId: unrelated.workspaceId,
          cookie: `mola_session=${token}`,
          hash,
        }),
      ]);
      const localUpdates: User[] = [];
      const sharedUpdates: User[] = [];
      const outsideUpdates: User[] = [];
      local.on("member:updated", (user) => localUpdates.push(user));
      shared.on("member:updated", (user) => sharedUpdates.push(user));
      outside.on("member:updated", (user) => outsideUpdates.push(user));
      const event = (client: Socket) =>
        new Promise<User>((done, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Missing profile update")),
            2500,
          );
          client.once("member:updated", (value) => {
            clearTimeout(timeout);
            done(value);
          });
        });
      let localEvent = event(local);
      let sharedEvent = event(shared);
      assert.equal(
        (
          await request(owner, "/profile", "PATCH", {
            jobTitle: "Shared designer",
          })
        ).status,
        200,
      );
      assert.equal((await localEvent).role, "owner");
      const peer = await sharedEvent;
      assert.equal(peer.role, "moderator");
      assert.equal(peer.jobTitle, "Shared designer");
      localEvent = event(local);
      sharedEvent = event(shared);
      assert.equal((await upload(owner, await png())).status, 200);
      const [localPhoto, sharedPhoto] = await Promise.all([
        localEvent,
        sharedEvent,
      ]);
      assert.ok(localPhoto.avatarUrl!.includes(owner.workspaceId));
      assert.ok(sharedPhoto.avatarUrl!.includes(foreign.workspaceId));
      assert.equal(
        (await request(foreign, sharedPhoto.avatarUrl!)).status,
        200,
      );
      assert.equal((await request(foreign, localPhoto.avatarUrl!)).status, 404);
      runtime.repo.run(
        "UPDATE workspace_members SET removed_at=? WHERE user_id=? AND workspace_id=?",
        now,
        owner.id,
        foreign.workspaceId,
      );
      localEvent = event(local);
      assert.equal(
        (
          await request(owner, "/profile", "PATCH", {
            bio: "Only active teams receive this",
          })
        ).status,
        200,
      );
      await localEvent;
      await new Promise((done) => setTimeout(done, 50));
      assert.equal(localUpdates.length, 3);
      assert.equal(sharedUpdates.length, 2);
      assert.equal(outsideUpdates.length, 0);
    },
  ));
