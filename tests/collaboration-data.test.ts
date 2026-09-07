import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { io as connect, type Socket } from "socket.io-client";
import { createECDH, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.js";
import { openDatabase, Repository } from "../server/db.js";
import { createWorkspace } from "../server/seed.js";
import {
  installCollaborationData,
  validPushEndpoint,
} from "../server/collaboration-data.js";

const origin = "http://collaboration.test";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
type UserSession = { id: string; tokenHash: string; cookie: string };
function session(
  repo: Repository,
  id: string,
  workspaceId: string,
): UserSession {
  const raw = randomBytes(32).toString("hex");
  const tokenHash = hash(raw);
  repo.run(
    "INSERT INTO sessions(token_hash,user_id,workspace_id,expires_at) VALUES(?,?,?,?)",
    tokenHash,
    id,
    workspaceId,
    Date.now() + 600000,
  );
  return { id, tokenHash, cookie: `mola_session=${raw}` };
}
function seedMembers(repo: Repository) {
  const seed = createWorkspace(repo, {
    name: "Collaboration",
    userName: "Owner",
    email: "owner@collaboration.test",
    passwordHash: null,
  });
  const member = (name: string) => {
    const id = randomUUID();
    repo.run(
      "INSERT INTO users(id,workspace_id,name,email,color,role,email_verified,created_at) VALUES(?,?,?,?,?,?,1,?)",
      id,
      seed.workspaceId,
      name,
      `${name}@collaboration.test`,
      "#abcdef",
      "member",
      new Date().toISOString(),
    );
    return session(repo, id, seed.workspaceId);
  };
  repo.run("UPDATE users SET email_verified=1 WHERE id=?", seed.userId);
  return {
    workspaceId: seed.workspaceId,
    owner: session(repo, seed.userId, seed.workspaceId),
    member: member("Member"),
    other: member("Other"),
    channelId: repo.get(
      "SELECT id FROM channels WHERE workspace_id=? AND name='genel'",
      seed.workspaceId,
    )!.id as string,
  };
}
async function fixture(
  run: (
    context: ReturnType<typeof seedMembers> & {
      runtime: ReturnType<typeof createApp>;
      request: (
        user: UserSession,
        path: string,
        method?: string,
        body?: unknown,
        headers?: Record<string, string>,
      ) => Promise<Response>;
      socket: (user: UserSession) => Promise<Socket>;
    },
  ) => Promise<void>,
) {
  const directory = mkdtempSync(join(tmpdir(), "mola-collaboration-"));
  const runtime = createApp({
    dataDir: directory,
    production: false,
    appOrigin: origin,
    requireEmailVerification: false,
    mailTransport: async () => {},
    mailEncryptionKey: "1".repeat(64),
  });
  await new Promise<void>((done) =>
    runtime.server.listen(0, "127.0.0.1", done),
  );
  const base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
  const sockets: Socket[] = [];
  const request = (
    user: UserSession,
    path: string,
    method = "GET",
    body?: unknown,
    headers?: Record<string, string>,
  ) =>
    fetch(base + "/api" + path, {
      method,
      headers: {
        Origin: origin,
        Cookie: user.cookie,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const socket = async (user: UserSession) => {
    const connection = connect(base, {
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: { Origin: origin, Cookie: user.cookie },
    });
    sockets.push(connection);
    await new Promise<void>((done, reject) => {
      connection.once("connect", done);
      connection.once("connect_error", reject);
    });
    return connection;
  };
  try {
    await run({ ...seedMembers(runtime.repo), runtime, request, socket });
  } finally {
    sockets.forEach((socket) => socket.disconnect());
    await runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("notifications persist per user and workspace, and read markers survive SQLite rowid reuse", async () =>
  fixture(
    async ({
      runtime,
      request,
      workspaceId,
      owner,
      member,
      other,
      channelId,
    }) => {
      const first = await (
        await request(owner, `/channels/${channelId}/messages`, "POST", {
          content: `Merhaba @[${member.id}]`,
        })
      ).json();
      let state = await (await request(member, "/notifications")).json();
      assert.equal(state.workspaceId, workspaceId);
      assert.equal(state.unreadNotifications, 1);
      assert.equal(state.unreadByChannel[channelId], 1);
      assert.equal(state.notifications[0].kind, "mention");
      assert.equal(
        (await (await request(other, "/notifications")).json())
          .unreadNotifications,
        0,
      );
      assert.equal(
        (await (await request(other, "/notifications")).json()).unreadByChannel[
          channelId
        ],
        1,
      );
      const anotherDevice = session(runtime.repo, member.id, workspaceId);
      assert.equal(
        (
          await request(anotherDevice, `/channels/${channelId}/read`, "POST", {
            messageId: first.id,
          })
        ).status,
        200,
      );
      state = await (await request(member, "/notifications")).json();
      assert.equal(state.unreadNotifications, 0);
      assert.equal(state.unreadByChannel[channelId], undefined);
      const oldOrder = runtime.repo.get(
        "SELECT sequence FROM message_order WHERE message_id=?",
        first.id,
      )!.sequence;
      await request(owner, `/messages/${first.id}`, "DELETE");
      const second = await (
        await request(owner, `/channels/${channelId}/messages`, "POST", {
          content: "Yeni mesaj",
        })
      ).json();
      assert.ok(
        runtime.repo.get(
          "SELECT sequence FROM message_order WHERE message_id=?",
          second.id,
        )!.sequence > oldOrder,
      );
      state = await (await request(member, "/notifications")).json();
      assert.equal(state.unreadByChannel[channelId], 1);
      await request(member, `/channels/${channelId}/read`, "POST", {
        messageId: second.id,
      });
      assert.equal(
        (await (await request(anotherDevice, "/notifications")).json())
          .unreadByChannel[channelId],
        undefined,
      );
    },
  ));

test("notification pagination cannot hide accessible history or undercount more than 500 unread notices", async () =>
  fixture(
    async ({ runtime, request, workspaceId, owner, member, channelId }) => {
      const privateId = randomUUID();
      runtime.repo.run(
        "INSERT INTO channels(id,workspace_id,name,kind,visibility,created_at) VALUES(?,?,?,'text','private',?)",
        privateId,
        workspaceId,
        "Secret",
        new Date().toISOString(),
      );
      runtime.repo.transaction(() => {
        for (let i = 0; i < 605; i++)
          for (const [channel, time] of [
            [channelId, "2026-01-01T00:00:00.000Z"],
            [privateId, "2026-02-01T00:00:00.000Z"],
          ]) {
            const id = randomUUID();
            runtime.repo.run(
              "INSERT INTO messages VALUES(?,?,?,?,?,NULL,NULL,0)",
              id,
              channel,
              owner.id,
              channel === privateId
                ? "NEVER-LEAK-PRIVATE"
                : "visible-notification",
              time,
            );
            runtime.repo.run(
              "INSERT INTO notifications VALUES(?,?,?,?,?,'mention',?,NULL)",
              randomUUID(),
              member.id,
              workspaceId,
              channel,
              id,
              time,
            );
          }
      });
      const state = await (await request(member, "/notifications")).json();
      assert.equal(state.unreadNotifications, 605);
      assert.equal(state.notifications.length, 100);
      assert.equal(state.unreadByChannel[channelId], 605);
      assert.equal(state.unreadByChannel[privateId], undefined);
      assert.equal(JSON.stringify(state).includes("NEVER-LEAK"), false);
      assert.equal(
        (await request(member, `/channels/${privateId}/read`, "POST", {}))
          .status,
        404,
      );
      const hidden = runtime.repo.get(
        "SELECT id FROM notifications WHERE channel_id=? LIMIT 1",
        privateId,
      )!.id;
      assert.equal(
        (await request(member, "/notifications/read", "POST", { id: hidden }))
          .status,
        404,
      );
      await request(member, "/notifications/read", "POST", {});
      assert.equal(
        (await (await request(member, "/notifications")).json())
          .unreadNotifications,
        0,
      );
    },
  ));

test("draft revisions reject concurrent overwrites, retain newer edits after send and broadcast clearing to own devices", async () =>
  fixture(
    async ({
      runtime,
      request,
      socket,
      workspaceId,
      owner,
      member,
      channelId,
    }) => {
      assert.deepEqual(
        await (await request(owner, `/channels/${channelId}/draft`)).json(),
        { content: "", revision: 0, updatedAt: null },
      );
      const original = await (
        await request(owner, `/channels/${channelId}/draft`, "PUT", {
          content: "First draft",
          revision: 0,
        })
      ).json();
      assert.equal(original.revision, 1);
      const conflict = await request(
        owner,
        `/channels/${channelId}/draft`,
        "PUT",
        { content: "Overwrite", revision: 0 },
      );
      assert.equal(conflict.status, 409);
      assert.equal((await conflict.json()).draft.content, "First draft");
      assert.equal(
        (await (await request(member, `/channels/${channelId}/draft`)).json())
          .content,
        "",
      );
      await request(owner, `/channels/${channelId}/draft`, "PUT", {
        content: "Newer device draft",
        revision: 1,
      });
      await request(owner, `/channels/${channelId}/messages`, "POST", {
        content: "First draft",
      });
      assert.equal(
        (await (await request(owner, `/channels/${channelId}/draft`)).json())
          .content,
        "Newer device draft",
      );
      const connection = await socket(owner);
      const changed = new Promise<any>((resolve) =>
        connection.once("draft:changed", resolve),
      );
      await request(owner, `/channels/${channelId}/messages`, "POST", {
        content: "Newer device draft",
      });
      const event = await changed;
      assert.equal(event.workspaceId, workspaceId);
      assert.equal(event.channelId, channelId);
      assert.equal(event.content, "");
      assert.equal(event.revision, 3);
      assert.equal(
        (
          await request(
            owner,
            `/channels/${channelId}/draft?parentId=${randomUUID()}`,
          )
        ).status,
        404,
      );
      runtime.repo.run(
        "UPDATE channels SET archived_at=? WHERE id=?",
        new Date().toISOString(),
        channelId,
      );
      assert.equal(
        (
          await request(owner, `/channels/${channelId}/draft`, "PUT", {
            content: "Archived",
            revision: 3,
          })
        ).status,
        404,
      );
    },
  ));

test("deleting a thread purges its saved reply draft and cannot expose it through a stale URL", async () =>
  fixture(async ({ runtime, request, owner, channelId }) => {
    const parent = await (
      await request(owner, `/channels/${channelId}/messages`, "POST", {
        content: "Thread parent",
      })
    ).json();
    assert.equal(
      (
        await request(
          owner,
          `/channels/${channelId}/draft?parentId=${parent.id}`,
          "PUT",
          { content: "Private unfinished reply", revision: 0 },
        )
      ).status,
      200,
    );
    assert.ok(
      runtime.repo.get(
        "SELECT 1 FROM message_drafts WHERE parent_key=?",
        parent.id,
      ),
    );
    assert.equal(
      (await request(owner, `/messages/${parent.id}`, "DELETE")).status,
      204,
    );
    assert.equal(
      runtime.repo.get(
        "SELECT 1 FROM message_drafts WHERE parent_key=?",
        parent.id,
      ),
      undefined,
    );
    assert.equal(
      (
        await request(
          owner,
          `/channels/${channelId}/draft?parentId=${parent.id}`,
        )
      ).status,
      404,
    );
  }));

test("push endpoints allow only known TLS providers and reject private or misleading origins", () => {
  for (const url of [
    "https://fcm.googleapis.com/send/id",
    "https://updates.push.services.mozilla.com/wpush/v2/id",
    "https://web.push.apple.com/id",
    "https://abc.notify.windows.com/id",
  ])
    assert.equal(validPushEndpoint(url), true, url);
  for (const url of [
    "http://fcm.googleapis.com/id",
    "https://127.0.0.1/id",
    "https://localhost/id",
    "https://fcm.googleapis.com.evil.test/id",
    "https://evil.test/?fcm.googleapis.com",
    "https://user:pass@fcm.googleapis.com/id",
    "https://fcm.googleapis.com:444/id",
    "https://fcm.googleapis.com/id#fragment",
  ])
    assert.equal(validPushEndpoint(url), false, url);
});

async function pushFixture(
  run: (
    context: ReturnType<typeof seedMembers> & {
      repo: Repository;
      worker: ReturnType<typeof installCollaborationData>;
      request: (
        user: UserSession,
        path: string,
        body: unknown,
      ) => Promise<Response>;
      send: (
        callback: (subscription: any, payload: any) => Promise<any>,
      ) => void;
      enqueue: (
        user: UserSession,
        order?: number,
      ) => { id: string; subscriptionId: string; notificationId: string };
    },
  ) => Promise<void>,
) {
  const repo = new Repository(openDatabase(":memory:"));
  const members = seedMembers(repo);
  const app = express();
  const server = createServer(app);
  const io = new Server(server);
  let send = async (_subscription: any, _payload: any) => ({
    statusCode: 201,
    body: "",
    headers: {},
  });
  app.use(express.json());
  app.use((req, res, next) => {
    const value = req.headers["x-test-session"];
    if (typeof value !== "string") return res.status(401).end();
    const account = repo.session(value);
    if (!account) return res.status(401).end();
    req.auth = account;
    req.sessionHash = value;
    next();
  });
  const worker = installCollaborationData(app, {
    repo,
    io,
    key: Buffer.alloc(32, 1),
    origin: "https://mola.test",
    sendPush: (subscription, payload) => send(subscription, payload),
    requiresVerification: (user) => !user.email_verified,
  });
  app.use((error: any, _req: any, res: any, _next: any) =>
    res.status(error.status || 500).json({ error: error.message }),
  );
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const enqueue = (user: UserSession, order = 0) => {
    const subscriptionId = randomUUID(),
      notificationId = randomUUID(),
      id = randomUUID(),
      message = randomUUID(),
      ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    repo.run(
      "INSERT OR REPLACE INTO notification_preferences VALUES(?,1)",
      user.id,
    );
    repo.run(
      "INSERT INTO push_subscriptions VALUES(?,?,?,?,?,?,?)",
      subscriptionId,
      user.id,
      user.tokenHash,
      `https://fcm.googleapis.com/${subscriptionId}`,
      ecdh.getPublicKey().toString("base64url"),
      randomBytes(16).toString("base64url"),
      new Date().toISOString(),
    );
    repo.run(
      "INSERT INTO messages VALUES(?,?,?,?,?,NULL,NULL,0)",
      message,
      members.channelId,
      members.owner.id,
      "Private message contents",
      new Date().toISOString(),
    );
    repo.run(
      "INSERT INTO notifications VALUES(?,?,?,?,?,'mention',?,NULL)",
      notificationId,
      user.id,
      members.workspaceId,
      members.channelId,
      message,
      new Date().toISOString(),
    );
    repo.run(
      "INSERT INTO push_outbox VALUES(?,?,?,0,?)",
      id,
      notificationId,
      subscriptionId,
      order,
    );
    return { id, subscriptionId, notificationId };
  };
  const request = (user: UserSession, path: string, body: unknown) =>
    fetch(base + "/api" + path, {
      method: "POST",
      headers: {
        "x-test-session": user.tokenHash,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  try {
    await run({
      ...members,
      repo,
      worker,
      request,
      send: (callback) => {
        send = callback;
      },
      enqueue,
    });
  } finally {
    await worker.close();
    await new Promise<void>((done) => io.close(() => done()));
    if (server.listening)
      await new Promise<void>((done) => server.close(() => done()));
    repo.close();
  }
}

test("push jobs recheck session expiry between awaited deliveries and never include message contents", async () =>
  pushFixture(async ({ repo, worker, member, workspaceId, send, enqueue }) => {
    const otherSession = session(repo, member.id, workspaceId);
    const first = enqueue(member, 0);
    const second = enqueue(otherSession, 1);
    let release!: () => void;
    let started!: () => void;
    const active = new Promise<void>((resolve) => {
      started = resolve;
    });
    const payloads: string[] = [];
    send(async (_subscription, payload) => {
      payloads.push(String(payload));
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { statusCode: 201, body: "", headers: {} };
    });
    const flushing = worker.flushPush();
    await active;
    repo.run(
      "UPDATE sessions SET expires_at=? WHERE token_hash=?",
      Date.now() - 1,
      otherSession.tokenHash,
    );
    release();
    await flushing;
    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].includes("Private message contents"), false);
    assert.equal(repo.get("SELECT count(*) AS n FROM push_outbox")!.n, 0);
    assert.ok(
      repo.get(
        "SELECT id FROM push_subscriptions WHERE id=?",
        second.subscriptionId,
      ),
    );
    assert.ok(first.id);
  }));

test("push worker drops revoked access and expired subscriptions, retries temporary failures with a bound", async () =>
  pushFixture(async ({ repo, worker, member, channelId, send, enqueue }) => {
    let count = 0;
    send(async () => {
      count++;
      throw { statusCode: 410 };
    });
    const gone = enqueue(member);
    await worker.flushPush();
    assert.equal(count, 1);
    assert.equal(
      repo.get(
        "SELECT id FROM push_subscriptions WHERE id=?",
        gone.subscriptionId,
      ),
      undefined,
    );
    send(async () => {
      count++;
      throw { statusCode: 503 };
    });
    const retry = enqueue(member);
    for (let i = 0; i < 5; i++) {
      repo.run("UPDATE push_outbox SET next_attempt=0 WHERE id=?", retry.id);
      await worker.flushPush();
    }
    assert.equal(
      repo.get("SELECT id FROM push_outbox WHERE id=?", retry.id),
      undefined,
    );
    assert.equal(count, 6);
    enqueue(member);
    repo.run("UPDATE channels SET visibility='private' WHERE id=?", channelId);
    await worker.flushPush();
    assert.equal(count, 6);
    assert.equal(repo.get("SELECT count(*) AS n FROM push_outbox")!.n, 0);
  }));

test("push worker drops read notifications and unverified accounts before contacting a provider", async () =>
  pushFixture(async ({ repo, worker, member, send, enqueue }) => {
    let sent = 0;
    send(async () => {
      sent++;
      return { statusCode: 201, body: "", headers: {} };
    });
    const read = enqueue(member);
    repo.run(
      "UPDATE notifications SET read_at=? WHERE id=?",
      new Date().toISOString(),
      read.notificationId,
    );
    await worker.flushPush();
    assert.equal(sent, 0);
    enqueue(member);
    repo.run("UPDATE users SET email_verified=0 WHERE id=?", member.id);
    await worker.flushPush();
    assert.equal(sent, 0);
    assert.equal(repo.get("SELECT count(*) AS n FROM push_outbox")!.n, 0);
  }));

test("reassigning a push endpoint cancels the previous account queue instead of leaking its notifications", async () =>
  pushFixture(async ({ repo, request, member, other, enqueue }) => {
    const job = enqueue(member);
    const subscription = repo.get(
      "SELECT * FROM push_subscriptions WHERE id=?",
      job.subscriptionId,
    )!;
    const response = await request(other, "/notifications/subscriptions", {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    });
    assert.equal(response.status, 201);
    assert.equal(repo.get("SELECT count(*) AS n FROM push_outbox")!.n, 0);
    const fresh = repo.get(
      "SELECT * FROM push_subscriptions WHERE endpoint=?",
      subscription.endpoint,
    )!;
    assert.equal(fresh.user_id, other.id);
    assert.notEqual(fresh.id, job.subscriptionId);
  }));

test("push restoration is bound to its user, cookie session and latest opt-in", async () =>
  fixture(async ({ runtime, request, member, other, workspaceId }) => {
    const curve = createECDH("prime256v1");
    curve.generateKeys();
    const input = {
      endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
      keys: {
        p256dh: curve.getPublicKey().toString("base64url"),
        auth: randomBytes(16).toString("base64url"),
      },
      restore: true,
    };
    const context = async (user: UserSession) => {
      const response = await request(user, "/notifications/preferences");
      assert.equal(response.status, 200);
      const preferences = await response.json();
      assert.equal(preferences.userId, user.id);
      return { "X-User-Id": preferences.userId, "X-Push-Session": preferences.sessionBinding };
    };
    await request(member, "/notifications/preferences", "PATCH", { pushEnabled: true });
    await request(other, "/notifications/preferences", "PATCH", { pushEnabled: true });
    const original = await context(member);
    assert.equal((await request(member, "/notifications/subscriptions", "POST", input, original)).status, 201);

    // A new cookie for the same person must not accept work from the old login.
    const nextSession = session(runtime.repo, member.id, workspaceId);
    const fresh = await context(nextSession);
    assert.notEqual(fresh["X-Push-Session"], original["X-Push-Session"]);
    const stale = await request(nextSession, "/notifications/subscriptions", "POST", input, original);
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).code, "PUSH_SESSION_CHANGED");
    assert.equal(runtime.repo.get("SELECT session_hash FROM push_subscriptions WHERE endpoint=?", input.endpoint)!.session_hash, member.tokenHash);
    assert.equal((await request(nextSession, "/notifications/subscriptions", "POST", input, fresh)).status, 201);

    // Even an otherwise valid old session may only delete its own registration.
    assert.equal((await request(member, "/notifications/subscriptions", "DELETE", { endpoint: input.endpoint }, original)).status, 204);
    assert.equal(runtime.repo.get("SELECT session_hash FROM push_subscriptions WHERE endpoint=?", input.endpoint)!.session_hash, nextSession.tokenHash);

    // A stale tab cannot reassign the browser endpoint or change the new account's preference.
    assert.equal((await request(other, "/notifications/subscriptions", "POST", input, fresh)).status, 409);
    assert.equal((await request(other, "/notifications/preferences", "PATCH", { pushEnabled: false }, fresh)).status, 409);
    assert.equal((await request(nextSession, "/notifications/preferences", "PATCH", { pushEnabled: false }, original)).status, 409);
    assert.equal((await request(nextSession, "/notifications/subscriptions", "DELETE", { endpoint: input.endpoint }, original)).status, 409);
    assert.equal((await (await request(other, "/notifications/preferences")).json()).pushEnabled, true);
    assert.equal(runtime.repo.get("SELECT session_hash FROM push_subscriptions WHERE endpoint=?", input.endpoint)!.session_hash, nextSession.tokenHash);

    // Turning push off after GET won the race: no delayed automatic registration survives.
    await request(nextSession, "/notifications/preferences", "PATCH", { pushEnabled: false }, fresh);
    await request(nextSession, "/notifications/subscriptions", "DELETE", { endpoint: input.endpoint }, fresh);
    const disabled = await request(nextSession, "/notifications/subscriptions", "POST", input, fresh);
    assert.equal(disabled.status, 409);
    assert.equal((await disabled.json()).code, "PUSH_DISABLED");
    assert.equal(runtime.repo.get("SELECT id FROM push_subscriptions WHERE endpoint=?", input.endpoint), undefined);
    assert.equal((await request(nextSession, "/notifications/subscriptions", "POST", input)).status, 409);
  }));
