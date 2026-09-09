import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { createECDH, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { openDatabase, Repository } from "../server/db.js";
import { createWorkspace } from "../server/seed.js";
import { installCollaborationData } from "../server/collaboration-data.js";
import {
  endOfLocalDay,
  quietHoursActive,
  validTimeZone,
} from "../server/notification-controls.js";
import type {
  PushDiagnostic,
  WorkspaceNotificationSettings,
} from "../shared/notification-types.js";
type Actor = { id: string; workspaceId: string; hash: string };
async function fixture(
  run: (c: {
    repo: Repository;
    worker: ReturnType<typeof installCollaborationData>;
    owner: Actor;
    member: Actor;
    other: Actor;
    channelId: string;
    events: any[];
    session: (id: string, workspaceId: string) => Actor;
    clock: (time: number) => void;
    time: () => number;
    transport: (callback: (sub: any, payload: string) => Promise<any>) => void;
    subscription: (actor: Actor) => { id: string; endpoint: string };
    post: (content: string, publish?: boolean) => string;
    request: (
      actor: Actor,
      path: string,
      method?: string,
      body?: unknown,
      headers?: Record<string, string>,
    ) => Promise<Response>;
    get: <T>(actor: Actor, path: string) => Promise<T>;
  }) => Promise<void>,
) {
  const repo = new Repository(openDatabase(":memory:"));
  const first = createWorkspace(repo, {
      name: "Notification policies",
      userName: "Owner",
      email: "owner@policy.test",
      passwordHash: null,
    }),
    second = createWorkspace(repo, {
      name: "Foreign",
      userName: "Foreign",
      email: "foreign@policy.test",
      passwordHash: null,
    });
  const memberId = randomUUID();
  repo.run(
    "INSERT INTO users(id,workspace_id,name,email,color,role,email_verified,created_at) VALUES(?,?,?,?,?,'member',1,?)",
    memberId,
    first.workspaceId,
    "Peer",
    "peer@policy.test",
    "#aabbcc",
    new Date().toISOString(),
  );
  repo.run("UPDATE users SET email_verified=1");
  const session = (id: string, workspaceId: string) => {
    const hash = randomBytes(32).toString("hex");
    repo.run(
      "INSERT INTO sessions(token_hash,user_id,workspace_id,expires_at) VALUES(?,?,?,?)",
      hash,
      id,
      workspaceId,
      Date.now() + 600000,
    );
    return { id, workspaceId, hash };
  };
  const owner = session(first.userId, first.workspaceId),
    member = session(memberId, first.workspaceId),
    other = session(second.userId, second.workspaceId),
    channelId = repo.channels(owner.id, owner.workspaceId)[0].id;
  const app = express(),
    server = createServer(app),
    io = new Server(server),
    events: any[] = [];
  const originalTo = io.to.bind(io);
  io.to = ((room: any) => {
    const op = originalTo(room),
      emit = op.emit.bind(op);
    op.emit = ((event: any, ...args: any[]) => {
      events.push({ room, event, data: args[0] });
      return emit(event, ...args);
    }) as typeof op.emit;
    return op;
  }) as typeof io.to;
  app.use(express.json());
  app.use((req, res, next) => {
    const hash = req.get("X-Test-Session"),
      actor = hash && repo.session(hash);
    if (!actor) return res.status(401).end();
    req.auth = actor;
    req.sessionHash = hash;
    next();
  });
  let now = Date.parse("2026-09-09T09:00:00.000Z"),
    send = async (_sub: any, _payload: string): Promise<any> => ({
      statusCode: 201,
      body: "",
      headers: {},
    });
  const worker = installCollaborationData(app, {
    repo,
    io,
    key: Buffer.alloc(32, 1),
    origin: "https://policy.test",
    requiresVerification: (user) => !user.email_verified,
    now: () => now,
    sendPush: (sub, payload) => send(sub, String(payload)),
  });
  app.use((error: any, _req: any, res: any, _next: any) =>
    res
      .status(error.status || 500)
      .json({ error: error.message, code: error.code }),
  );
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const request = (
    actor: Actor,
    path: string,
    method = "GET",
    body?: unknown,
    headers?: Record<string, string>,
  ) =>
    fetch(base + path, {
      method,
      headers: {
        "X-Test-Session": actor.hash,
        "X-User-Id": actor.id,
        "X-Push-Session": createHmac("sha256", Buffer.alloc(32, 1))
          .update(`mola/push-session/v1:${actor.hash}`)
          .digest("base64url"),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const get = async <T>(actor: Actor, path: string) => {
    const r = await request(actor, path);
    assert.equal(r.status, 200);
    return (await r.json()) as T;
  };
  const subscription = (actor: Actor) => {
    const id = randomUUID(),
      curve = createECDH("prime256v1");
    curve.generateKeys();
    const endpoint = `https://fcm.googleapis.com/fake/${id}`;
    repo.run(
      "INSERT OR REPLACE INTO notification_preferences VALUES(?,1)",
      actor.id,
    );
    repo.run(
      "INSERT INTO push_subscriptions VALUES(?,?,?,?,?,?,?)",
      id,
      actor.id,
      actor.hash,
      endpoint,
      curve.getPublicKey().toString("base64url"),
      randomBytes(16).toString("base64url"),
      new Date(now).toISOString(),
    );
    return { id, endpoint };
  };
  const post = (content: string, publish = true) => {
    let id = "";
    const emit = repo.transaction(() => {
      id = randomUUID();
      repo.run(
        "INSERT INTO messages VALUES(?,?,?,?,?,NULL,NULL,0)",
        id,
        channelId,
        owner.id,
        content,
        new Date(now).toISOString(),
      );
      return worker.prepareMessageCreated(id);
    });
    if (publish) emit?.();
    return id;
  };
  try {
    await run({
      repo,
      worker,
      owner,
      member,
      other,
      channelId,
      events,
      session,
      clock: (value) => (now = value),
      time: () => now,
      transport: (callback) => (send = callback),
      subscription,
      post,
      request,
      get,
    });
  } finally {
    await worker.close();
    await new Promise<void>((done) => io.close(() => done()));
    if (server.listening)
      await new Promise<void>((done) => server.close(() => done()));
    repo.close();
  }
}

test("daily IANA quiet hours handle overnight windows and DST; end-of-day uses the actual local date boundary", () => {
  const q = {
    enabled: true,
    timeZone: "Europe/Istanbul",
    start: "22:00",
    end: "08:00",
  };
  assert.equal(quietHoursActive(q, Date.parse("2026-09-09T19:00:00Z")), true);
  assert.equal(quietHoursActive(q, Date.parse("2026-09-10T05:00:00Z")), false);
  assert.equal(
    quietHoursActive(
      { ...q, timeZone: "America/New_York", start: "01:00", end: "03:00" },
      Date.parse("2026-11-01T05:30:00Z"),
    ),
    true,
  );
  assert.equal(
    quietHoursActive(
      { ...q, timeZone: "America/New_York", start: "01:00", end: "03:00" },
      Date.parse("2026-11-01T06:30:00Z"),
    ),
    true,
  );
  assert.equal(
    new Date(
      endOfLocalDay(Date.parse("2026-03-08T05:00:00Z"), "America/New_York"),
    ).toISOString(),
    "2026-03-09T04:00:00.000Z",
  );
  assert.equal(
    new Date(
      endOfLocalDay(Date.parse("2026-11-01T04:00:00Z"), "America/New_York"),
    ).toISOString(),
    "2026-11-02T05:00:00.000Z",
  );
  assert.equal(
    new Date(
      endOfLocalDay(Date.parse("2026-09-09T22:00:00Z"), "Europe/Istanbul"),
    ).toISOString(),
    "2026-09-10T21:00:00.000Z",
  );
  assert.equal(validTimeZone("Fake/Zone"), false);
  assert.equal(validTimeZone("+03:00"), false);
});

test("workspace and channel partial settings preserve other fields, enforce access and compute server-owned mute deadlines", () =>
  fixture(
    async ({
      member,
      owner,
      other,
      channelId,
      request,
      get,
      time,
      clock,
      repo,
      events,
    }) => {
      const initial = await get<WorkspaceNotificationSettings>(
        member,
        "/notifications/settings",
      );
      assert.equal(initial.defaultMode, "mentions");
      assert.equal(
        initial.channels.find((c) => c.channelId === channelId)?.mode,
        "inherit",
      );
      assert.equal(
        (
          await request(member, "/notifications/settings", "PATCH", {
            defaultMode: "all",
          })
        ).status,
        200,
      );
      const q = {
        enabled: true,
        timeZone: "Europe/Istanbul",
        start: "22:00",
        end: "08:00",
      };
      await request(member, "/notifications/settings", "PATCH", {
        quietHours: q,
      });
      const muted = await (
        await request(member, "/notifications/settings", "PATCH", {
          mute: "30m",
        })
      ).json();
      assert.equal(Date.parse(muted.mutedUntil), time() + 1800000);
      assert.equal(muted.defaultMode, "all");
      assert.deepEqual(muted.quietHours, q);
      clock(time() + 1800001);
      assert.equal(
        (
          await get<WorkspaceNotificationSettings>(
            member,
            "/notifications/settings",
          )
        ).mutedUntil,
        null,
      );
      const today = await (
        await request(
          member,
          `/channels/${channelId}/notification-settings`,
          "PATCH",
          { mode: "off", mute: "today", timeZone: "Europe/Istanbul" },
        )
      ).json();
      assert.equal(today.effectiveMode, "off");
      assert.equal(today.mutedUntil, "2026-09-09T21:00:00.000Z");
      assert.equal(
        (
          await get<WorkspaceNotificationSettings>(
            owner,
            "/notifications/settings",
          )
        ).defaultMode,
        "mentions",
      );
      assert.equal(
        (await request(other, `/channels/${channelId}/notification-settings`))
          .status,
        404,
      );
      for (const body of [
        { mute: "today" },
        { quietHours: { ...q, timeZone: "bad" } },
        { quietHours: { ...q, end: q.start } },
        { defaultMode: "unknown" },
      ])
        assert.equal(
          (await request(member, "/notifications/settings", "PATCH", body))
            .status,
          400,
        );
      repo.run(
        "UPDATE channels SET visibility='private' WHERE id=?",
        channelId,
      );
      assert.equal(
        (
          await request(
            member,
            `/channels/${channelId}/notification-settings`,
            "PATCH",
            { mode: "all" },
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await get<WorkspaceNotificationSettings>(
            member,
            "/notifications/settings",
          )
        ).channels.some((c) => c.channelId === channelId),
        false,
      );
      assert.ok(
        events
          .filter((e) => e.event === "notification-settings:changed")
          .every(
            (e) =>
              e.room === `workspace-user:${member.workspaceId}:${member.id}`,
          ),
      );
    },
  ));

test("policy changes only attention and push while personal history and raw unread counts stay intact", () =>
  fixture(
    async ({
      worker,
      repo,
      member,
      owner,
      channelId,
      post,
      request,
      events,
      subscription,
      transport,
    }) => {
      const payloads: string[] = [];
      transport(async (_sub, payload) => {
        payloads.push(payload);
        return { statusCode: 201, body: "", headers: {} };
      });
      subscription(member);
      post("Ordinary default message");
      await worker.flushPush();
      assert.equal(payloads.length, 0);
      assert.equal(
        events.filter((e) => e.event === "notifications:attention").length,
        0,
      );
      await request(member, "/notifications/settings", "PATCH", {
        defaultMode: "all",
      });
      const all = post("Every message attention");
      await worker.flushPush();
      assert.equal(payloads.length, 1);
      assert.ok(payloads[0].includes(all));
      assert.equal(repo.get("SELECT COUNT(*) n FROM notifications")!.n, 0);
      await request(
        member,
        `/channels/${channelId}/notification-settings`,
        "PATCH",
        { mode: "off" },
      );
      post(`Silent @[${member.id}]`);
      await worker.flushPush();
      assert.equal(payloads.length, 1);
      const state = worker.state(member.id, member.workspaceId);
      assert.equal(state.unreadByChannel[channelId], 3);
      assert.equal(state.unreadNotifications, 1);
      assert.equal(state.notifications[0].kind, "mention");
      assert.equal(state.notifications[0].read, false);
      assert.deepEqual(
        events
          .filter((e) => e.event === "notifications:attention")
          .map((e) => ({ room: e.room, id: e.data.messageId })),
        [
          {
            room: `workspace-user:${member.workspaceId}:${member.id}`,
            id: all,
          },
        ],
      );
      assert.equal(
        worker.state(owner.id, owner.workspaceId).unreadNotifications,
        0,
      );
    },
  ));

test("worker rechecks changed mute and quiet preferences before delivery and does not replay a suppressed backlog", () =>
  fixture(
    async ({
      worker,
      repo,
      member,
      post,
      request,
      subscription,
      transport,
      time,
      clock,
    }) => {
      subscription(member);
      let calls = 0;
      transport(async () => {
        calls++;
        return { statusCode: 201, body: "", headers: {} };
      });
      post(`Pending @[${member.id}]`, false);
      assert.equal(repo.get("SELECT COUNT(*) n FROM push_outbox")!.n, 1);
      await request(member, "/notifications/settings", "PATCH", { mute: "1h" });
      await worker.flushPush();
      assert.equal(calls, 0);
      assert.equal(repo.get("SELECT COUNT(*) n FROM push_outbox")!.n, 0);
      clock(time() + 3600001);
      await worker.flushPush();
      assert.equal(calls, 0);
      await request(member, "/notifications/settings", "PATCH", {
        quietHours: {
          enabled: true,
          timeZone: "UTC",
          start: "00:00",
          end: "23:59",
        },
      });
      post(`Quiet @[${member.id}]`);
      await worker.flushPush();
      assert.equal(calls, 0);
      assert.equal(
        worker.state(member.id, member.workspaceId).unreadNotifications,
        2,
      );
    },
  ));

test("diagnostic uses the same queue, only the current device, bypasses quiet and reports provider acceptance without changing activity", () =>
  fixture(
    async ({
      worker,
      repo,
      member,
      other,
      session,
      subscription,
      request,
      get,
      transport,
      events,
    }) => {
      const own = subscription(member),
        otherDevice = subscription(session(member.id, member.workspaceId));
      subscription(other);
      await request(member, "/notifications/settings", "PATCH", {
        defaultMode: "off",
        mute: "1h",
      });
      const delivered: any[] = [];
      let release!: () => void;
      transport(async (sub, payload) => {
        delivered.push({ sub, payload: JSON.parse(payload) });
        await new Promise<void>((done) => (release = done));
        return { statusCode: 201, body: "", headers: {} };
      });
      const initial = await request(
        member,
        "/notifications/push-tests",
        "POST",
        { endpoint: own.endpoint },
      );
      assert.equal(initial.status, 202);
      const test = (await initial.json()) as PushDiagnostic;
      assert.equal(test.status, "queued");
      assert.equal(
        repo.get(
          "SELECT COUNT(*) n FROM push_outbox WHERE diagnostic_id=?",
          test.id,
        )!.n,
        1,
      );
      const duplicate = await (
        await request(member, "/notifications/push-tests", "POST", {
          endpoint: own.endpoint,
        })
      ).json();
      assert.equal(duplicate.id, test.id);
      assert.equal(delivered.length, 1);
      assert.equal(delivered[0].sub.endpoint, own.endpoint);
      assert.equal(delivered[0].payload.test, true);
      assert.equal(delivered[0].payload.body, "Bu cihaz için test bildirimi.");
      assert.equal(
        (
          await request(member, "/notifications/push-tests", "POST", {
            endpoint: otherDevice.endpoint,
          })
        ).status,
        409,
      );
      assert.equal(
        (await request(other, `/notifications/push-tests/${test.id}`)).status,
        404,
      );
      release();
      await worker.flushPush();
      const done = await get<PushDiagnostic>(
        member,
        `/notifications/push-tests/${test.id}`,
      );
      assert.equal(done.status, "providerAccepted");
      assert.equal(done.attempts, 1);
      assert.equal(done.nextAttemptAt, null);
      assert.equal(repo.get("SELECT COUNT(*) n FROM notifications")!.n, 0);
      assert.equal(repo.get("SELECT COUNT(*) n FROM messages")!.n, 0);
      assert.equal(
        events.filter((e) => e.event === "notifications:attention").length,
        0,
      );
      assert.equal(
        (
          await request(member, "/notifications/push-tests", "POST", {
            endpoint: own.endpoint,
          })
        ).status,
        429,
      );
      const serialized = JSON.stringify(done);
      assert.equal(serialized.includes(own.endpoint), false);
      assert.equal(serialized.includes(member.hash), false);
    },
  ));

test("diagnostic categorizes timeouts, 5xx and throttling, retries with a bound, preserves last failure and exports aggregate metrics", () =>
  fixture(
    async ({
      worker,
      repo,
      member,
      subscription,
      transport,
      request,
      get,
      time,
      clock,
    }) => {
      const device = subscription(member);
      let count = 0;
      transport(async () => {
        count++;
        if (count === 1)
          throw {
            code: "ETIMEDOUT",
            message: "secret endpoint must not escape",
          };
        if (count === 2) throw { statusCode: 429 };
        throw { statusCode: 503 };
      });
      const test = (await (
        await request(member, "/notifications/push-tests", "POST", {
          endpoint: device.endpoint,
        })
      ).json()) as PushDiagnostic;
      await worker.flushPush();
      let status = await get<PushDiagnostic>(
        member,
        `/notifications/push-tests/${test.id}`,
      );
      assert.equal(status.status, "queued");
      assert.equal(status.reasonCode, "PROVIDER_TIMEOUT");
      assert.ok(status.nextAttemptAt);
      assert.equal(status.lastFailureAt, new Date(time()).toISOString());
      for (let i = 0; i < 4; i++) {
        clock(time() + 20000);
        repo.run(
          "UPDATE push_outbox SET next_attempt=0 WHERE diagnostic_id=?",
          test.id,
        );
        await worker.flushPush();
      }
      status = await get<PushDiagnostic>(
        member,
        `/notifications/push-tests/${test.id}`,
      );
      assert.equal(status.status, "failed");
      assert.equal(status.attempts, 5);
      assert.equal(status.reasonCode, "RETRY_EXHAUSTED");
      assert.equal(status.lastFailureCode, "PROVIDER_UNAVAILABLE");
      assert.equal(status.nextAttemptAt, null);
      const metrics = worker.getPushMetrics();
      assert.equal(metrics.queued, 0);
      assert.equal(metrics.outcomes.provider_timeout, 1);
      assert.equal(metrics.outcomes.provider_throttled, 1);
      assert.equal(metrics.outcomes.provider_5xx, 3);
      assert.equal(metrics.lastFailureCategory, "provider_5xx");
      assert.equal(metrics.lastFailureAt, Math.floor(time() / 1000));
      assert.equal(JSON.stringify(metrics).includes(device.endpoint), false);
    },
  ));

test("expired subscriptions and device rebinding produce terminal diagnostics while auth and opt-in prevent unauthorized tests", () =>
  fixture(
    async ({
      worker,
      repo,
      member,
      session,
      subscription,
      transport,
      request,
      get,
      time,
      clock,
    }) => {
      const device = subscription(member);
      transport(async () => {
        throw { statusCode: 410 };
      });
      const test = (await (
        await request(member, "/notifications/push-tests", "POST", {
          endpoint: device.endpoint,
        })
      ).json()) as PushDiagnostic;
      await worker.flushPush();
      assert.equal(
        (
          await get<PushDiagnostic>(
            member,
            `/notifications/push-tests/${test.id}`,
          )
        ).reasonCode,
        "SUBSCRIPTION_EXPIRED",
      );
      assert.equal(
        repo.get("SELECT id FROM push_subscriptions WHERE id=?", device.id),
        undefined,
      );
      const newDevice = subscription(member);
      clock(time() + 60001);
      const invalid = await request(
        member,
        "/notifications/push-tests",
        "POST",
        { endpoint: newDevice.endpoint },
        { "X-Push-Session": "stale" },
      );
      assert.equal(invalid.status, 409);
      repo.run(
        "UPDATE notification_preferences SET push_enabled=0 WHERE user_id=?",
        member.id,
      );
      assert.equal(
        (
          await request(member, "/notifications/push-tests", "POST", {
            endpoint: newDevice.endpoint,
          })
        ).status,
        409,
      );
      const otherSession = session(member.id, member.workspaceId);
      assert.equal(
        (await request(otherSession, `/notifications/push-tests/${test.id}`))
          .status,
        404,
      );
      repo.run(
        "UPDATE notification_preferences SET push_enabled=1 WHERE user_id=?",
        member.id,
      );
      transport(async () => {
        throw { statusCode: 503 };
      });
      const queued = (await (
        await request(member, "/notifications/push-tests", "POST", {
          endpoint: newDevice.endpoint,
        })
      ).json()) as PushDiagnostic;
      await worker.flushPush();
      repo.run("DELETE FROM push_subscriptions WHERE id=?", newDevice.id);
      const lost = await get<PushDiagnostic>(
        member,
        `/notifications/push-tests/${queued.id}`,
      );
      assert.equal(lost.status, "failed");
      assert.equal(lost.reasonCode, "DEVICE_UNAVAILABLE");
    },
  ));

test("in-flight provider failure after device rebinding cannot resurrect a diagnostic or count a nonexistent retry", () =>
  fixture(
    async ({
      repo,
      worker,
      member,
      session,
      subscription,
      transport,
      request,
      get,
    }) => {
      const device = subscription(member);
      let release!: () => void;
      transport(async () => {
        await new Promise<void>((done) => {
          release = done;
        });
        throw { statusCode: 503 };
      });
      const diagnostic = (await (
        await request(member, "/notifications/push-tests", "POST", {
          endpoint: device.endpoint,
        })
      ).json()) as PushDiagnostic;
      const replacement = session(member.id, member.workspaceId);
      const keys = repo.get(
        "SELECT p256dh,auth FROM push_subscriptions WHERE id=?",
        device.id,
      )!;
      try {
        assert.equal(
          (
            await request(replacement, "/notifications/subscriptions", "POST", {
              endpoint: device.endpoint,
              keys: { p256dh: keys.p256dh, auth: keys.auth },
            })
          ).status,
          201,
        );
      } finally {
        release();
      }
      await worker.flushPush();
      const status = await get<PushDiagnostic>(
        member,
        `/notifications/push-tests/${diagnostic.id}`,
      );
      assert.equal(status.status, "failed");
      assert.equal(status.reasonCode, "DEVICE_UNAVAILABLE");
      assert.equal(status.lastFailureCode, null);
      assert.equal(repo.get("SELECT COUNT(*) n FROM push_outbox")!.n, 0);
      const rebound = repo.get(
        "SELECT * FROM push_subscriptions WHERE endpoint=?",
        device.endpoint,
      )!;
      assert.notEqual(rebound.id, device.id);
      assert.equal(rebound.session_hash, replacement.hash);
      const metrics = worker.getPushMetrics();
      assert.equal(metrics.outcomes.provider_5xx, 1);
      assert.equal(metrics.outcomes.retry_scheduled, 0);
    },
  ));

test("expired queued diagnostics are counted once and terminal history expires after seven days", () =>
  fixture(
    async ({
      repo,
      worker,
      member,
      subscription,
      transport,
      request,
      get,
      time,
      clock,
    }) => {
      const device = subscription(member);
      let calls = 0;
      transport(async () => {
        calls++;
        throw { statusCode: 503 };
      });
      const diagnostic = (await (
        await request(member, "/notifications/push-tests", "POST", {
          endpoint: device.endpoint,
        })
      ).json()) as PushDiagnostic;
      await worker.flushPush();
      clock(time() + 300001);
      await worker.flushPush();
      const status = await get<PushDiagnostic>(
        member,
        `/notifications/push-tests/${diagnostic.id}`,
      );
      assert.equal(status.status, "failed");
      assert.equal(status.reasonCode, "TEST_EXPIRED");
      assert.equal(status.lastFailureCode, "PROVIDER_UNAVAILABLE");
      assert.equal(calls, 1);
      assert.equal(repo.get("SELECT COUNT(*) n FROM push_outbox")!.n, 0);
      assert.equal(worker.getPushMetrics().outcomes.diagnostic_expired, 1);
      await worker.flushPush();
      assert.equal(worker.getPushMetrics().outcomes.diagnostic_expired, 1);
      clock(time() + 7 * 86400000 + 1);
      await worker.flushPush();
      assert.equal(
        (await request(member, `/notifications/push-tests/${diagnostic.id}`))
          .status,
        404,
      );
      assert.equal(repo.get("SELECT COUNT(*) n FROM push_diagnostics")!.n, 0);
      assert.equal(worker.getPushMetrics().outcomes.diagnostic_expired, 1);
    },
  ));

test("notification preparation remains atomic for all-message jobs and emits attention only after commit", () =>
  fixture(
    async ({
      repo,
      worker,
      member,
      subscription,
      request,
      events,
      channelId,
      owner,
      time,
    }) => {
      subscription(member);
      await request(member, "/notifications/settings", "PATCH", {
        defaultMode: "all",
      });
      events.length = 0;
      repo.db.exec(
        "CREATE TRIGGER fail_queue BEFORE INSERT ON push_outbox BEGIN SELECT RAISE(ABORT,'rollback'); END;",
      );
      assert.throws(
        () =>
          repo.transaction(() => {
            const id = randomUUID();
            repo.run(
              "INSERT INTO messages VALUES(?,?,?,?,?,NULL,NULL,0)",
              id,
              channelId,
              owner.id,
              "atomic all",
              new Date(time()).toISOString(),
            );
            return worker.prepareMessageCreated(id);
          }),
        /rollback/,
      );
      assert.equal(repo.get("SELECT COUNT(*) n FROM messages")!.n, 0);
      assert.equal(repo.get("SELECT COUNT(*) n FROM push_outbox")!.n, 0);
      assert.equal(
        events.filter((e) => e.event === "notifications:attention").length,
        0,
      );
    },
  ));
