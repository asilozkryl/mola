import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import { createApp } from "../server/app.js";
import { createWorkspace } from "../server/seed.js";
import type { Repository } from "../server/db.js";
import type { Attachment } from "../shared/types.js";
const origin = "http://reliability.test";
function session(repo: Repository, userId: string, workspaceId: string) {
  const token = randomBytes(32).toString("hex"),
    hash = createHash("sha256").update(token).digest("hex");
  repo.run(
    "INSERT INTO sessions(token_hash,user_id,workspace_id,expires_at) VALUES(?,?,?,?)",
    hash,
    userId,
    workspaceId,
    Date.now() + 600000,
  );
  return { userId, workspaceId, hash, cookie: `mola_session=${token}` };
}
type Session = ReturnType<typeof session>;
async function fixture(
  run: (context: {
    runtime: ReturnType<typeof createApp>;
    directory: string;
    owner: Session;
    peer: Session;
    channel: string;
    otherChannel: string;
    request: (
      user: Session,
      path: string,
      method?: string,
      body?: unknown,
    ) => Promise<Response>;
    upload: (user: Session) => Promise<Attachment>;
    socket: (user: Session) => Promise<Socket>;
  }) => Promise<void>,
) {
  const directory = mkdtempSync(join(tmpdir(), "mola-reliability-"));
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
  const created = createWorkspace(runtime.repo, {
    name: "Reliable",
    userName: "Owner",
    email: "owner@reliability.test",
    passwordHash: null,
  });
  runtime.repo.run(
    "UPDATE users SET email_verified=1 WHERE id=?",
    created.userId,
  );
  const peerId = randomUUID();
  runtime.repo.run(
    "INSERT INTO users(id,workspace_id,name,email,color,role,email_verified,created_at) VALUES(?,?,?,?,?,?,1,?)",
    peerId,
    created.workspaceId,
    "Peer",
    "peer@reliability.test",
    "#abcdef",
    "member",
    new Date().toISOString(),
  );
  const owner = session(runtime.repo, created.userId, created.workspaceId),
    peer = session(runtime.repo, peerId, created.workspaceId);
  const channels = runtime.repo
    .channels(owner.userId, owner.workspaceId)
    .filter((c) => c.kind === "text");
  const request = (
    user: Session,
    path: string,
    method = "GET",
    body?: unknown,
  ) =>
    fetch(base + "/api" + path, {
      method,
      headers: {
        Origin: origin,
        Cookie: user.cookie,
        "X-Workspace-Id": user.workspaceId,
        "X-User-Id": user.userId,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const upload = async (user: Session) => {
    const data = new FormData();
    data.set(
      "file",
      new Blob(["A persistent draft file"], { type: "text/plain" }),
      "draft.txt",
    );
    const response = await fetch(base + "/api/uploads", {
      method: "POST",
      headers: { Origin: origin, Cookie: user.cookie },
      body: data,
    });
    assert.equal(response.status, 201);
    return (await response.json()) as Attachment;
  };
  const sockets: Socket[] = [];
  const socket = async (user: Session) => {
    const value = connect(base, {
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: { Origin: origin, Cookie: user.cookie },
    });
    sockets.push(value);
    await new Promise<void>((done, fail) => {
      value.once("connect", done);
      value.once("connect_error", fail);
    });
    return value;
  };
  try {
    await run({
      runtime,
      directory,
      owner,
      peer,
      channel: channels[0].id,
      otherChannel: channels[1].id,
      request,
      upload,
      socket,
    });
  } finally {
    sockets.forEach((value) => value.disconnect());
    await runtime.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
  }
}

test("simultaneous retries commit exactly one message, attachment, notification and durable push entry, then replay the canonical message", () =>
  fixture(async ({ runtime, owner, peer, channel, request, upload }) => {
    const file = await upload(owner),
      path = `/channels/${channel}/messages`,
      content = `hello @[${peer.userId}]`,
      key = randomUUID();
    const draft = await (
      await request(owner, `/channels/${channel}/draft`, "PUT", {
        content,
        attachmentIds: [file.id],
        revision: 0,
      })
    ).json();
    runtime.repo.run(
      "INSERT INTO notification_preferences VALUES(?,1)",
      peer.userId,
    );
    runtime.repo.run(
      "INSERT INTO push_subscriptions VALUES(?,?,?,?,?,?,?)",
      randomUUID(),
      peer.userId,
      peer.hash,
      "https://fcm.googleapis.com/no-real-delivery",
      "not-used",
      "not-used",
      new Date().toISOString(),
    );
    // Durable queue inspection without any real push attempt.
    runtime.db.exec(
      "CREATE TRIGGER defer_test_push AFTER INSERT ON push_outbox BEGIN UPDATE push_outbox SET next_attempt=4102444800000 WHERE id=NEW.id; END;",
    );
    const payload = {
      content,
      attachmentIds: [file.id],
      clientMessageId: key,
      draftRevision: draft.revision,
    };
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => request(owner, path, "POST", payload)),
    );
    assert.deepEqual(
      responses.map((r) => r.status).sort(),
      [200, 200, 200, 200, 200, 200, 200, 201],
    );
    const messages = await Promise.all(responses.map((r) => r.json())),
      id = messages[0].id;
    assert.equal(new Set(messages.map((m) => m.id)).size, 1);
    for (const table of [
      "messages",
      "message_requests",
      "notifications",
      "push_outbox",
    ])
      assert.equal(
        runtime.repo.get(`SELECT COUNT(*) n FROM ${table}`)!.n,
        1,
        table,
      );
    assert.equal(
      runtime.repo.get(
        "SELECT message_id FROM attachments WHERE id=?",
        file.id,
      )!.message_id,
      id,
    );
    const cleared = await (
      await request(owner, `/channels/${channel}/draft`)
    ).json();
    assert.equal(cleared.content, "");
    assert.deepEqual(cleared.attachmentIds, []);
    assert.equal(cleared.revision, draft.revision + 1);
    await request(owner, `/messages/${id}`, "PATCH", {
      content: "Edited after commit",
    });
    const replay = await request(owner, path, "POST", {
      ...payload,
      content: ` ${content} `,
      attachmentIds: [file.id, file.id],
      draftRevision: 999,
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.headers.get("Idempotent-Replay"), "true");
    assert.equal((await replay.json()).content, "Edited after commit");
    assert.equal(
      (await (await request(owner, `/channels/${channel}/draft`)).json())
        .revision,
      cleared.revision,
    );
  }));

test("same-key payload conflicts, revoked access, archived replay and deleted-message tombstones cannot create or reveal another send", () =>
  fixture(async ({ runtime, owner, peer, channel, otherChannel, request }) => {
    const key = randomUUID(),
      payload = { content: "original", clientMessageId: key },
      path = `/channels/${channel}/messages`;
    const first = await (await request(peer, path, "POST", payload)).json();
    for (const [target, body] of [
      [path, { ...payload, content: "changed" }],
      [`/channels/${otherChannel}/messages`, payload],
      [path, { ...payload, parentId: first.id }],
      [path, { ...payload, attachmentIds: [randomUUID()] }],
    ] as const) {
      const result = await request(peer, target, "POST", body);
      assert.equal(result.status, 409);
      assert.equal((await result.json()).code, "MESSAGE_ID_CONFLICT");
    }
    runtime.repo.run(
      "UPDATE channels SET visibility='private' WHERE id=?",
      channel,
    );
    assert.equal((await request(peer, path, "POST", payload)).status, 404);
    runtime.repo.run(
      "INSERT INTO channel_members(channel_id,user_id) VALUES(?,?)",
      channel,
      peer.userId,
    );
    runtime.repo.run(
      "UPDATE channels SET archived_at=? WHERE id=?",
      new Date().toISOString(),
      channel,
    );
    assert.equal((await request(peer, path, "POST", payload)).status, 200);
    assert.equal(
      (
        await request(peer, path, "POST", {
          ...payload,
          clientMessageId: randomUUID(),
        })
      ).status,
      403,
    );
    runtime.repo.run(
      "UPDATE channels SET archived_at=NULL WHERE id=?",
      channel,
    );
    assert.equal(
      (await request(peer, `/messages/${first.id}`, "DELETE")).status,
      204,
    );
    const deleted = await request(peer, path, "POST", payload);
    assert.equal(deleted.status, 410);
    assert.equal((await deleted.json()).code, "MESSAGE_ALREADY_DELETED");
    assert.equal(
      runtime.repo.get(
        "SELECT message_id FROM message_requests WHERE client_message_id=?",
        key,
      )!.message_id,
      null,
    );
    // Another user's key is independent; no access to the original payload is implied.
    assert.equal(
      (
        await request(
          owner,
          `/channels/${otherChannel}/messages`,
          "POST",
          payload,
        )
      ).status,
      201,
    );
    const secondWorkspace = createWorkspace(runtime.repo, {
      name: "Second",
      userName: "Owner",
      email: "ignored",
      passwordHash: null,
      existingUserId: owner.userId,
    });
    const otherSession = session(
        runtime.repo,
        owner.userId,
        secondWorkspace.workspaceId,
      ),
      other = runtime.repo.channels(
        owner.userId,
        secondWorkspace.workspaceId,
      )[0];
    assert.equal(
      (
        await request(
          otherSession,
          `/channels/${other.id}/messages`,
          "POST",
          payload,
        )
      ).status,
      201,
    );
    assert.equal(
      (
        await request(
          otherSession,
          `/channels/${otherChannel}/messages`,
          "POST",
          payload,
        )
      ).status,
      404,
    );
  }));

test("failures in notifications, push queue or draft clearing roll back every message write and emit no creation or draft event", () =>
  fixture(
    async ({ runtime, owner, peer, channel, request, upload, socket }) => {
      const file = await upload(owner),
        content = `atomic @[${peer.userId}]`,
        path = `/channels/${channel}/messages`;
      const saved = await (
        await request(owner, `/channels/${channel}/draft`, "PUT", {
          content,
          attachmentIds: [file.id],
          revision: 0,
        })
      ).json();
      runtime.repo.run(
        "INSERT INTO notification_preferences VALUES(?,1)",
        peer.userId,
      );
      runtime.repo.run(
        "INSERT INTO push_subscriptions VALUES(?,?,?,?,?,?,?)",
        randomUUID(),
        peer.userId,
        peer.hash,
        "https://fcm.googleapis.com/not-sent",
        "unused",
        "unused",
        new Date().toISOString(),
      );
      const connection = await socket(owner),
        events: string[] = [];
      connection.on("message:created", () => events.push("message"));
      connection.on("draft:changed", () => events.push("draft"));
      const payload = {
        content,
        attachmentIds: [file.id],
        clientMessageId: randomUUID(),
        draftRevision: saved.revision,
      };
      for (const [table, operation] of [
        ["notifications", "INSERT"],
        ["push_outbox", "INSERT"],
        ["message_drafts", "UPDATE"],
      ]) {
        runtime.db.exec(
          `CREATE TRIGGER abort_message_test BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'test rollback'); END;`,
        );
        assert.equal((await request(owner, path, "POST", payload)).status, 500);
        runtime.db.exec("DROP TRIGGER abort_message_test");
        for (const table of [
          "messages",
          "message_requests",
          "notifications",
          "push_outbox",
        ])
          assert.equal(
            runtime.repo.get(`SELECT COUNT(*) n FROM ${table}`)!.n,
            0,
            table,
          );
        assert.equal(
          runtime.repo.get(
            "SELECT message_id FROM attachments WHERE id=?",
            file.id,
          )!.message_id,
          null,
        );
        assert.deepEqual(
          await (await request(owner, `/channels/${channel}/draft`)).json(),
          saved,
        );
      }
      await new Promise((done) => setTimeout(done, 80));
      assert.deepEqual(events, []);
      runtime.db.exec(
        "CREATE TRIGGER defer_test_push AFTER INSERT ON push_outbox BEGIN UPDATE push_outbox SET next_attempt=4102444800000 WHERE id=NEW.id; END;",
      );
      assert.equal((await request(owner, path, "POST", payload)).status, 201);
    },
  ));

test("draft CAS includes attachments, preserves legacy omitted IDs, scopes users and threads, and protects newer drafts when sending", () =>
  fixture(
    async ({
      runtime,
      owner,
      peer,
      channel,
      otherChannel,
      request,
      upload,
    }) => {
      const file = await upload(owner),
        otherFile = await upload(owner),
        path = `/channels/${channel}/draft`;
      const saved = await (
        await request(owner, path, "PUT", {
          content: "first",
          attachmentIds: [file.id],
          revision: 0,
        })
      ).json();
      assert.deepEqual(saved.attachmentIds, [file.id]);
      assert.equal(saved.attachments[0].name, "draft.txt");
      assert.deepEqual(saved.unavailableAttachmentIds, []);
      const conflict = await request(owner, path, "PUT", {
        content: "stale",
        attachmentIds: [otherFile.id],
        revision: 0,
      });
      assert.equal(conflict.status, 409);
      assert.deepEqual((await conflict.json()).draft, saved);
      const legacy = await (
        await request(owner, path, "PUT", {
          content: "first",
          revision: saved.revision,
        })
      ).json();
      assert.deepEqual(legacy.attachmentIds, [file.id]);
      assert.deepEqual(
        (await (await request(peer, path)).json()).attachmentIds,
        [],
      );
      assert.deepEqual(
        (await (await request(owner, `/channels/${otherChannel}/draft`)).json())
          .attachmentIds,
        [],
      );
      const denied = await request(peer, path, "PUT", {
        content: "foreign",
        attachmentIds: [file.id],
        revision: 0,
      });
      assert.equal(denied.status, 409);
      const error = await denied.json();
      assert.deepEqual(Object.keys(error).sort(), [
        "code",
        "error",
        "unavailableAttachmentIds",
      ]);
      assert.deepEqual(error.unavailableAttachmentIds, [file.id]);
      const newer = await (
        await request(owner, path, "PUT", {
          content: "first",
          attachmentIds: [otherFile.id],
          revision: legacy.revision,
        })
      ).json();
      const first = await request(
        owner,
        `/channels/${channel}/messages`,
        "POST",
        {
          content: "first",
          attachmentIds: [file.id],
          clientMessageId: randomUUID(),
          draftRevision: saved.revision,
        },
      );
      assert.equal(first.status, 201);
      assert.deepEqual(await (await request(owner, path)).json(), newer);
      const parent = await first.json();
      const thread = await (
        await request(owner, `${path}?parentId=${parent.id}`, "PUT", {
          content: "reply draft",
          attachmentIds: [otherFile.id],
          revision: 0,
        })
      ).json();
      assert.equal(thread.content, "reply draft");
      assert.equal(
        (
          await request(
            owner,
            `/channels/${otherChannel}/draft?parentId=${parent.id}`,
          )
        ).status,
        404,
      );
      await request(owner, `/messages/${parent.id}`, "DELETE");
      assert.equal(
        runtime.repo.get(
          "SELECT COUNT(*) n FROM draft_attachments WHERE parent_key=?",
          parent.id,
        )!.n,
        0,
      );
      assert.deepEqual(
        (await (await request(owner, path)).json()).attachmentIds,
        [otherFile.id],
      );
    },
  ));

test("missing or consumed files remain explicit in the draft and cannot silently send text; deliberate removal restores sending", () =>
  fixture(
    async ({
      runtime,
      directory,
      owner,
      channel,
      otherChannel,
      request,
      upload,
    }) => {
      const file = await upload(owner),
        path = `/channels/${channel}/draft`;
      const draft = await (
        await request(owner, path, "PUT", {
          content: "keep this",
          attachmentIds: [file.id],
          revision: 0,
        })
      ).json();
      const consumed = await (
        await request(owner, `/channels/${otherChannel}/messages`, "POST", {
          content: "file used elsewhere",
          attachmentIds: [file.id],
        })
      ).json();
      await request(owner, `/messages/${consumed.id}`, "DELETE");
      const unavailable = await (await request(owner, path)).json();
      assert.deepEqual(unavailable.attachmentIds, [file.id]);
      assert.deepEqual(unavailable.attachments, []);
      assert.deepEqual(unavailable.unavailableAttachmentIds, [file.id]);
      assert.equal(unavailable.revision, draft.revision);
      const edited = await (
        await request(owner, path, "PUT", {
          content: "still keep this",
          attachmentIds: [file.id],
          revision: draft.revision,
        })
      ).json();
      assert.deepEqual(edited.unavailableAttachmentIds, [file.id]);
      const failed = await request(
        owner,
        `/channels/${channel}/messages`,
        "POST",
        {
          content: edited.content,
          attachmentIds: [file.id],
          clientMessageId: randomUUID(),
          draftRevision: edited.revision,
        },
      );
      assert.equal(failed.status, 409);
      assert.equal((await failed.json()).code, "ATTACHMENT_UNAVAILABLE");
      assert.deepEqual(await (await request(owner, path)).json(), edited);
      const removed = await (
        await request(owner, path, "PUT", {
          content: edited.content,
          attachmentIds: [],
          revision: edited.revision,
        })
      ).json();
      assert.equal(
        (
          await request(owner, `/channels/${channel}/messages`, "POST", {
            content: removed.content,
            attachmentIds: [],
            draftRevision: removed.revision,
          })
        ).status,
        201,
      );
      const lost = await upload(owner),
        storage = runtime.repo.get(
          "SELECT storage_name FROM attachments WHERE id=?",
          lost.id,
        )!.storage_name;
      unlinkSync(join(directory, "uploads", storage));
      const physical = await request(
        owner,
        `/channels/${channel}/messages`,
        "POST",
        {
          content: "must not send",
          attachmentIds: [lost.id],
          clientMessageId: randomUUID(),
        },
      );
      assert.equal(physical.status, 409);
      assert.deepEqual((await physical.json()).unavailableAttachmentIds, [
        lost.id,
      ]);
    },
  ));

test("legacy clients remain compatible and validation failures reserve no request key", () =>
  fixture(async ({ runtime, owner, channel, request }) => {
    const path = `/channels/${channel}/messages`,
      key = randomUUID();
    for (const body of [
      { content: "", clientMessageId: key },
      { content: "valid", clientMessageId: "bad" },
      { content: "valid", draftRevision: -1 },
    ])
      assert.equal((await request(owner, path, "POST", body)).status, 400);
    assert.equal(
      runtime.repo.get("SELECT COUNT(*) n FROM message_requests")!.n,
      0,
    );
    for (let i = 0; i < 2; i++)
      assert.equal(
        (await request(owner, path, "POST", { content: "legacy" })).status,
        201,
      );
    assert.equal(
      (
        await request(owner, path, "POST", {
          content: "valid now",
          clientMessageId: key,
        })
      ).status,
      201,
    );
    assert.equal(runtime.repo.get("SELECT COUNT(*) n FROM messages")!.n, 3);
  }));

test("file-only DM drafts appear in the personal hub and retained old uploads survive startup maintenance until explicitly removed", () =>
  fixture(async ({ runtime, directory, owner, peer, request, upload }) => {
    const dm = await (
      await request(owner, "/dms", "POST", { userId: peer.userId })
    ).json();
    const file = await upload(owner),
      orphan = await upload(owner),
      draftPath = `/channels/${dm.id}/draft`;
    const saved = await (
      await request(owner, draftPath, "PUT", {
        content: "",
        attachmentIds: [file.id],
        revision: 0,
      })
    ).json();
    assert.equal(saved.attachments.length, 1);
    const hubs = await (await request(owner, "/direct-conversations")).json();
    assert.equal(
      hubs.items.find((item: any) => item.channelId === dm.id)?.hasDraft,
      true,
    );
    runtime.repo.run(
      "UPDATE attachments SET created_at='2000-01-01T00:00:00.000Z'",
    );
    assert.equal(
      (await (await request(owner, draftPath)).json()).attachments.length,
      1,
    );
    const expired = await request(owner, draftPath, "PUT", {
      content: "",
      attachmentIds: [file.id, orphan.id],
      revision: saved.revision,
    });
    assert.equal(expired.status, 409);
    assert.deepEqual((await expired.json()).unavailableAttachmentIds, [
      orphan.id,
    ]);
    const filePath = join(
      directory,
      "uploads",
      runtime.repo.get(
        "SELECT storage_name FROM attachments WHERE id=?",
        file.id,
      )!.storage_name,
    );
    // A separate runtime opening the same database executes the real startup cleanup.
    const maintenance = createApp({
      dataDir: directory,
      production: false,
      appOrigin: origin,
      requireEmailVerification: false,
      mailTransport: async () => {},
      mailEncryptionKey: "1".repeat(64),
    });
    await maintenance.close();
    assert.ok(
      runtime.repo.get("SELECT id FROM attachments WHERE id=?", file.id),
    );
    assert.ok(existsSync(filePath));
    assert.equal(
      runtime.repo.get("SELECT id FROM attachments WHERE id=?", orphan.id),
      undefined,
    );
    await request(owner, draftPath, "PUT", {
      content: "",
      attachmentIds: [],
      revision: saved.revision,
    });
    const cleanup = createApp({
      dataDir: directory,
      production: false,
      appOrigin: origin,
      requireEmailVerification: false,
      mailTransport: async () => {},
      mailEncryptionKey: "1".repeat(64),
    });
    await cleanup.close();
    assert.equal(
      runtime.repo.get("SELECT id FROM attachments WHERE id=?", file.id),
      undefined,
    );
    assert.equal(existsSync(filePath), false);
  }));
