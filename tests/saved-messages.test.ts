import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import { createApp } from "../server/app.js";
import { createWorkspace } from "../server/seed.js";
import type {
  SavedMessageIds,
  SavedMessagesPage,
} from "../shared/saved-types.js";

const origin = "http://saved-messages.test";
const time = "2026-01-01T00:00:00.000Z";
type Actor = { id: string; workspaceId: string; hash: string; cookie: string };
async function fixture(
  run: (context: {
    runtime: ReturnType<typeof createApp>;
    owner: Actor;
    member: Actor;
    other: Actor;
    session: (id: string, workspaceId: string) => Actor;
    socket: (actor: Actor) => Promise<Socket>;
    channel: (
      name?: string,
      visibility?: "public" | "private",
      members?: string[],
      workspaceId?: string,
      kind?: "text" | "dm",
    ) => string;
    message: (
      channelId: string,
      author?: string,
      content?: string,
      parentId?: string,
    ) => string;
    request: (
      actor: Actor,
      path: string,
      method?: string,
      body?: unknown,
    ) => Promise<Response>;
    get: <T>(actor: Actor, path: string) => Promise<T>;
  }) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "mola-saved-"));
  const runtime = createApp({
    dataDir: directory,
    appOrigin: origin,
    production: false,
    requireEmailVerification: false,
    mailTransport: async () => {},
    mailEncryptionKey: "1".repeat(64),
  });
  const sockets: Socket[] = [];
  await new Promise<void>((done) =>
    runtime.server.listen(0, "127.0.0.1", done),
  );
  const base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
  const first = createWorkspace(runtime.repo, {
    name: "Saved Team",
    userName: "Saved Owner",
    email: "owner@saved.test",
    passwordHash: null,
  });
  const second = createWorkspace(runtime.repo, {
    name: "Other Team",
    userName: "Other Owner",
    email: "other@saved.test",
    passwordHash: null,
  });
  const memberId = randomUUID();
  runtime.repo.run(
    "INSERT INTO users(id,workspace_id,name,email,color,role,created_at,email_verified) VALUES(?,?,?,?,?,'member',?,1)",
    memberId,
    first.workspaceId,
    "İpek Deniz",
    "member@saved.test",
    "#abcdef",
    time,
  );
  runtime.repo.run("UPDATE users SET email_verified=1");
  const session = (id: string, workspaceId: string): Actor => {
    const token = randomBytes(32).toString("hex"),
      hash = createHash("sha256").update(token).digest("hex");
    runtime.repo.run(
      "INSERT INTO sessions(token_hash,user_id,expires_at,workspace_id) VALUES(?,?,?,?)",
      hash,
      id,
      Date.now() + 600_000,
      workspaceId,
    );
    return { id, workspaceId, hash, cookie: `mola_session=${token}` };
  };
  const owner = session(first.userId, first.workspaceId),
    member = session(memberId, first.workspaceId),
    other = session(second.userId, second.workspaceId);
  const channel = (
    name = "genel-saved",
    visibility: "public" | "private" = "public",
    members: string[] = [],
    workspaceId: string = first.workspaceId,
    kind: "text" | "dm" = "text",
  ) => {
    const id = randomUUID();
    runtime.repo.run(
      "INSERT INTO channels(id,workspace_id,name,kind,visibility,created_at) VALUES(?,?,?,?,?,?)",
      id,
      workspaceId,
      name,
      kind,
      visibility,
      time,
    );
    for (const userId of members)
      runtime.repo.run("INSERT INTO channel_members VALUES(?,?)", id, userId);
    return id;
  };
  const message = (
    channelId: string,
    author = owner.id,
    content = "Saved message",
    parentId?: string,
  ) => {
    const id = randomUUID();
    runtime.repo.run(
      "INSERT INTO messages(id,channel_id,user_id,content,created_at,parent_id) VALUES(?,?,?,?,?,?)",
      id,
      channelId,
      author,
      content,
      time,
      parentId || null,
    );
    return id;
  };
  const request = (
    actor: Actor,
    path: string,
    method = "GET",
    body?: unknown,
  ) =>
    fetch(`${base}/api${path}`, {
      method,
      headers: {
        Origin: origin,
        Cookie: actor.cookie,
        "X-User-Id": actor.id,
        "X-Workspace-Id": actor.workspaceId,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const get = async <T>(actor: Actor, path: string): Promise<T> => {
    const response = await request(actor, path);
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()) as T;
  };
  const socket = async (actor: Actor) => {
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
      owner,
      member,
      other,
      session,
      socket,
      channel,
      message,
      request,
      get,
    });
  } finally {
    for (const client of sockets) client.disconnect();
    await runtime.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory, { recursive: true, force: true });
  }
}

test("250 saved messages paginate without duplicates and idempotent import preserves the newest-first order", () =>
  fixture(async ({ owner, channel, message, request, get }) => {
    const room = channel(),
      expected = Array.from({ length: 250 }, (_, index) =>
        message(room, owner.id, `Entry ${index}`),
      );
    const imported = await request(owner, "/saved/import", "POST", {
      messageIds: expected,
    });
    assert.equal(imported.status, 200);
    assert.deepEqual(await imported.json(), { imported: 250 });
    assert.deepEqual(
      await (
        await request(owner, "/saved/import", "POST", { messageIds: expected })
      ).json(),
      { imported: 0 },
    );
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: SavedMessagesPage = await get(
        owner,
        `/saved${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      assert.equal(page.total, 250);
      assert.equal(page.items.length, 50);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);
    assert.deepEqual(seen, expected);
    assert.equal(new Set(seen).size, 250);
    assert.deepEqual(
      (await get<SavedMessageIds>(owner, "/saved/ids")).ids,
      expected,
    );
  }));

test("saving twice keeps order and returns the current message, while deletion is personal and idempotent", () =>
  fixture(
    async ({ runtime, owner, member, channel, message, request, get }) => {
      const room = channel(),
        parent = message(room),
        child = message(room, member.id, "Reply", parent);
      for (const id of [parent, child])
        assert.equal((await request(owner, `/saved/${id}`, "PUT")).status, 200);
      const before = runtime.repo.get(
        "SELECT sequence FROM saved_messages WHERE user_id=? AND message_id=?",
        owner.id,
        parent,
      )!.sequence;
      runtime.repo.run(
        "UPDATE messages SET content='Edited current content',edited_at=? WHERE id=?",
        time,
        parent,
      );
      runtime.repo.run(
        "INSERT INTO reactions VALUES(?,?,'💚')",
        parent,
        member.id,
      );
      runtime.repo.run(
        "INSERT INTO attachments(id,workspace_id,user_id,message_id,name,size,mime,storage_name,created_at) VALUES(?,?,?,?,?,5,'text/plain',?,?)",
        randomUUID(),
        owner.workspaceId,
        owner.id,
        parent,
        "decisions.txt",
        randomUUID(),
        time,
      );
      const result = await (
        await request(owner, `/saved/${parent}`, "PUT")
      ).json();
      assert.equal(result.message.content, "Edited current content");
      assert.equal(result.message.replyCount, 1);
      assert.equal(result.message.attachments[0].name, "decisions.txt");
      assert.deepEqual(result.message.reactions, [
        { emoji: "💚", userIds: [member.id] },
      ]);
      assert.equal(
        runtime.repo.get(
          "SELECT sequence FROM saved_messages WHERE user_id=? AND message_id=?",
          owner.id,
          parent,
        )!.sequence,
        before,
      );
      assert.deepEqual((await get<SavedMessageIds>(owner, "/saved/ids")).ids, [
        child,
        parent,
      ]);
      assert.equal(
        (await get<SavedMessagesPage>(owner, "/saved")).items[0].parentId,
        parent,
      );
      assert.deepEqual(
        (await get<SavedMessageIds>(member, "/saved/ids")).ids,
        [],
      );
      await request(member, `/saved/${parent}`, "DELETE");
      assert.equal((await get<SavedMessagesPage>(owner, "/saved")).total, 2);
      await request(member, `/saved/${parent}`, "PUT");
      for (let index = 0; index < 2; index++)
        assert.deepEqual(
          await (await request(owner, `/saved/${parent}`, "DELETE")).json(),
          { ok: true },
        );
      assert.equal((await get<SavedMessagesPage>(owner, "/saved")).total, 1);
      assert.equal((await get<SavedMessagesPage>(member, "/saved")).total, 1);
    },
  ));

test("search matches Turkish text, literal wildcards, authors, channel names, DM peers and attachments", () =>
  fixture(
    async ({ runtime, owner, member, channel, message, request, get }) => {
      const planning = channel("Planlama"),
        other = channel("Genel"),
        dm = channel(
          randomUUID(),
          "private",
          [owner.id, member.id],
          owner.workspaceId,
          "dm",
        );
      const text = message(planning, owner.id, "İZMİR %_ Kararı"),
        author = message(other, member.id, "Daily work"),
        direct = message(dm, owner.id, "Meeting");
      await request(owner, "/saved/import", "POST", {
        messageIds: [text, author, direct],
      });
      runtime.repo.run(
        "INSERT INTO attachments(id,workspace_id,user_id,message_id,name,size,mime,storage_name,created_at) VALUES(?,?,?,?,?,5,'text/plain',?,?)",
        randomUUID(),
        owner.workspaceId,
        owner.id,
        text,
        "bütçe-listesi.txt",
        randomUUID(),
        time,
      );
      for (const q of ["izmir", "%_", "PLANLAMA", "bütçe-listesi"])
        assert.deepEqual(
          (
            await get<SavedMessagesPage>(
              owner,
              `/saved?q=${encodeURIComponent(q)}`,
            )
          ).items.map((item) => item.id),
          [text],
        );
      assert.deepEqual(
        new Set(
          (await get<SavedMessagesPage>(owner, "/saved?q=%C4%B0PEK")).items.map(
            (item) => item.id,
          ),
        ),
        new Set([author, direct]),
      );
      assert.equal(
        (await get<SavedMessagesPage>(owner, "/saved?q=never-present")).total,
        0,
      );
    },
  ));

test("private channel revocation immediately hides saved rows and cursor pages and never grants an owner a bypass", () =>
  fixture(
    async ({ runtime, owner, member, channel, message, request, get }) => {
      const privateRoom = channel("Gizli", "private", [owner.id, member.id]);
      const ids = [
        message(privateRoom),
        message(privateRoom),
        message(privateRoom),
      ];
      await request(owner, "/saved/import", "POST", { messageIds: ids });
      const first = await get<SavedMessagesPage>(owner, "/saved?limit=1");
      runtime.repo.run(
        "DELETE FROM channel_members WHERE channel_id=? AND user_id=?",
        privateRoom,
        owner.id,
      );
      const page = await get<SavedMessagesPage>(
        owner,
        `/saved?cursor=${encodeURIComponent(first.nextCursor!)}`,
      );
      assert.deepEqual(page, { items: [], nextCursor: null, total: 0 });
      assert.deepEqual(
        (await get<SavedMessageIds>(owner, "/saved/ids")).ids,
        [],
      );
      assert.equal(
        (await request(owner, `/saved/${ids[0]}`, "PUT")).status,
        404,
      );
      assert.deepEqual(
        await (
          await request(owner, "/saved/import", "POST", { messageIds: ids })
        ).json(),
        { imported: 0 },
      );
      assert.deepEqual(
        await (await request(owner, `/saved/${ids[0]}`, "DELETE")).json(),
        { ok: true },
      );
      runtime.repo.run(
        "INSERT INTO channel_members VALUES(?,?)",
        privateRoom,
        owner.id,
      );
      assert.deepEqual(
        (await get<SavedMessageIds>(owner, "/saved/ids")).ids,
        ids.slice(1),
      );
    },
  ));

test("foreign workspaces, unrelated DMs and malformed legacy IDs are safely skipped without leaking existence", () =>
  fixture(
    async ({
      runtime,
      owner,
      member,
      other,
      session,
      channel,
      message,
      request,
      get,
    }) => {
      const local = message(channel()),
        hidden = message(channel("Private", "private", [member.id]), member.id);
      const unrelated = message(
        channel(
          "DM",
          "private",
          [member.id, other.id],
          owner.workspaceId,
          "dm",
        ),
        member.id,
      );
      const remote = message(
        channel("Remote", "public", [], other.workspaceId),
        other.id,
      );
      runtime.repo.run(
        "INSERT INTO workspace_members(workspace_id,user_id,role,joined_at) VALUES(?,?,'member',?)",
        other.workspaceId,
        owner.id,
        time,
      );
      const ownerElsewhere = session(owner.id, other.workspaceId);
      const result = await request(owner, "/saved/import", "POST", {
        messageIds: [
          local,
          local,
          hidden,
          unrelated,
          remote,
          randomUUID(),
          "bad-legacy-id",
          "",
        ],
      });
      assert.deepEqual(await result.json(), { imported: 1 });
      for (const id of [hidden, unrelated, remote, randomUUID()])
        assert.equal((await request(owner, `/saved/${id}`, "PUT")).status, 404);
      await request(ownerElsewhere, `/saved/${remote}`, "PUT");
      assert.deepEqual((await get<SavedMessageIds>(owner, "/saved/ids")).ids, [
        local,
      ]);
      assert.deepEqual(
        (await get<SavedMessageIds>(ownerElsewhere, "/saved/ids")).ids,
        [remote],
      );
      await request(owner, `/saved/${remote}`, "DELETE");
      assert.deepEqual(
        (await get<SavedMessageIds>(ownerElsewhere, "/saved/ids")).ids,
        [remote],
      );
      assert.equal(
        (await request({ ...owner, id: member.id }, "/saved")).status,
        409,
      );
      assert.equal(
        (await request({ ...owner, workspaceId: other.workspaceId }, "/saved"))
          .status,
        409,
      );
      assert.throws(
        () =>
          runtime.repo.run(
            "INSERT INTO saved_messages(user_id,workspace_id,message_id,saved_at) VALUES(?,?,?,?)",
            owner.id,
            owner.workspaceId,
            remote,
            time,
          ),
        /workspace mismatch/,
      );
    },
  ));

test("cursor signatures bind the user, workspace and search and reject invalid limits or payloads", () =>
  fixture(
    async ({
      runtime,
      owner,
      member,
      other,
      session,
      channel,
      message,
      request,
      get,
    }) => {
      const room = channel();
      await request(owner, "/saved/import", "POST", {
        messageIds: [message(room), message(room)],
      });
      const first = await get<SavedMessagesPage>(owner, "/saved?limit=1");
      const cursor = first.nextCursor!;
      const encoded = encodeURIComponent(cursor);
      runtime.repo.run(
        "INSERT INTO workspace_members(workspace_id,user_id,role,joined_at) VALUES(?,?,'member',?)",
        other.workspaceId,
        owner.id,
        time,
      );
      const elsewhere = session(owner.id, other.workspaceId);
      for (const [actor, path] of [
        [owner, "/saved?cursor=broken"],
        [owner, `/saved?q=changed&cursor=${encoded}`],
        [member, `/saved?cursor=${encoded}`],
        [elsewhere, `/saved?cursor=${encoded}`],
        [owner, `/saved?cursor=${encodeURIComponent(`x${cursor}`)}`],
      ] as const) {
        const response = await request(actor, path);
        assert.equal(response.status, 400);
        assert.equal((await response.json()).code, "INVALID_SAVED_CURSOR");
      }
      for (const query of [
        "limit=0",
        "limit=101",
        "limit=1.5",
        "q=" + "a".repeat(201),
        "cursor=",
        "unexpected=true",
        "q=one&q=two",
      ])
        assert.equal((await request(owner, `/saved?${query}`)).status, 400);
      for (const body of [
        { messageIds: Array(501).fill(randomUUID()) },
        { messageIds: [1] },
        { messageIds: ["a".repeat(101)] },
        { messageIds: [], userId: member.id },
      ])
        assert.equal(
          (await request(owner, "/saved/import", "POST", body)).status,
          400,
        );
      assert.equal(
        (await request(owner, "/saved/not-an-id", "DELETE")).status,
        400,
      );
      assert.deepEqual(
        await (
          await request(owner, "/saved/import", "POST", { messageIds: [] })
        ).json(),
        { imported: 0 },
      );
    },
  ));

test("new saves during pagination do not duplicate old rows and archived messages remain bookmarkable", () =>
  fixture(async ({ runtime, owner, channel, message, request, get }) => {
    const room = channel(),
      ids = [message(room), message(room), message(room)];
    await request(owner, "/saved/import", "POST", { messageIds: ids });
    const first = await get<SavedMessagesPage>(owner, "/saved?limit=1");
    runtime.repo.run(
      "UPDATE channels SET archived_at=? WHERE id=?",
      time,
      room,
    );
    const newest = message(room);
    assert.equal((await request(owner, `/saved/${newest}`, "PUT")).status, 200);
    const rest = await get<SavedMessagesPage>(
      owner,
      `/saved?cursor=${encodeURIComponent(first.nextCursor!)}`,
    );
    assert.equal(rest.total, 4);
    assert.deepEqual(
      rest.items.map((item) => item.id),
      ids.slice(1),
    );
    assert.deepEqual((await get<SavedMessageIds>(owner, "/saved/ids")).ids, [
      newest,
      ...ids,
    ]);
  }));

test("guest access and inactive account/workspace contexts cannot read or create personal saves", () =>
  fixture(
    async ({ runtime, owner, member, channel, message, request, get }) => {
      const room = channel(),
        id = message(room);
      await request(member, `/saved/${id}`, "PUT");
      runtime.repo.run(
        "UPDATE workspace_members SET role='guest' WHERE workspace_id=? AND user_id=?",
        member.workspaceId,
        member.id,
      );
      assert.equal((await get<SavedMessagesPage>(member, "/saved")).total, 0);
      assert.equal((await request(member, `/saved/${id}`, "PUT")).status, 404);
      runtime.repo.run(
        "INSERT INTO channel_members VALUES(?,?)",
        room,
        member.id,
      );
      assert.equal((await get<SavedMessagesPage>(member, "/saved")).total, 1);
      runtime.repo.run(
        "UPDATE workspace_members SET suspended_at=? WHERE user_id=?",
        time,
        member.id,
      );
      assert.equal((await request(member, "/saved")).status, 403);
      runtime.repo.run("UPDATE users SET site_admin=1 WHERE id=?", owner.id);
      runtime.repo.run(
        "UPDATE workspaces SET suspended_at=? WHERE id=?",
        time,
        owner.workspaceId,
      );
      assert.equal((await request(owner, "/saved")).status, 403);
      runtime.repo.run(
        "UPDATE workspaces SET suspended_at=NULL WHERE id=?",
        owner.workspaceId,
      );
      runtime.repo.run(
        "UPDATE sessions SET workspace_id=NULL WHERE token_hash=?",
        owner.hash,
      );
      const response = await request({ ...owner, workspaceId: "" }, "/saved");
      assert.equal(response.status, 403);
      assert.equal((await response.json()).code, "WORKSPACE_REQUIRED");
    },
  ));

test("message, thread, channel, account and workspace deletion cascade saves without affecting other records", () =>
  fixture(
    async ({ runtime, owner, member, other, channel, message, request }) => {
      const room = channel(),
        parent = message(room),
        reply = message(room, member.id, "Reply", parent);
      const surviving = message(channel());
      const remote = message(
        channel("Remote", "public", [], other.workspaceId),
        other.id,
      );
      await request(owner, "/saved/import", "POST", {
        messageIds: [parent, reply, surviving],
      });
      await request(member, `/saved/${surviving}`, "PUT");
      await request(other, `/saved/${remote}`, "PUT");
      runtime.repo.run("DELETE FROM messages WHERE id=?", parent);
      assert.equal(
        runtime.repo.get("SELECT COUNT(*) AS n FROM saved_messages")!.n,
        3,
      );
      const channelSave = message(room);
      await request(owner, `/saved/${channelSave}`, "PUT");
      assert.equal(
        runtime.repo.get("SELECT COUNT(*) AS n FROM saved_messages")!.n,
        4,
      );
      runtime.repo.run("DELETE FROM channels WHERE id=?", room);
      assert.equal(
        runtime.repo.get("SELECT COUNT(*) AS n FROM saved_messages")!.n,
        3,
      );
      runtime.repo.run("DELETE FROM users WHERE id=?", member.id);
      assert.equal(
        runtime.repo.get("SELECT COUNT(*) AS n FROM saved_messages")!.n,
        2,
      );
      runtime.repo.run("DELETE FROM workspaces WHERE id=?", owner.workspaceId);
      assert.deepEqual(
        runtime.repo
          .all("SELECT message_id FROM saved_messages")
          .map((row) => row.message_id),
        [remote],
      );
      assert.deepEqual(runtime.repo.all("PRAGMA foreign_key_check"), []);
    },
  ));

test("saved changes reach the user's devices, including another workspace, but never another user", () =>
  fixture(
    async ({
      runtime,
      owner,
      member,
      other,
      session,
      socket,
      channel,
      message,
      request,
    }) => {
      runtime.repo.run(
        "INSERT INTO workspace_members(workspace_id,user_id,role,joined_at) VALUES(?,?,'member',?)",
        other.workspaceId,
        owner.id,
        time,
      );
      const devices = await Promise.all([
        socket(owner),
        socket(session(owner.id, owner.workspaceId)),
        socket(session(owner.id, other.workspaceId)),
      ]);
      const peer = await socket(member);
      let leaked = 0;
      peer.on("saved:changed", () => {
        leaked++;
      });
      const updates = devices.map(
        (device) =>
          new Promise<{ workspaceId: string }>((done) =>
            device.once("saved:changed", done),
          ),
      );
      const id = message(channel());
      assert.equal((await request(owner, `/saved/${id}`, "PUT")).status, 200);
      assert.deepEqual(
        await Promise.all(updates),
        devices.map(() => ({ workspaceId: owner.workspaceId })),
      );
      let repeated = 0;
      devices[0].on("saved:changed", () => {
        repeated++;
      });
      await request(owner, `/saved/${id}`, "PUT");
      await request(owner, "/saved/import", "POST", { messageIds: [id] });
      const removed = new Promise<{ workspaceId: string }>((done) =>
        devices[0].once("saved:changed", done),
      );
      await request(owner, `/saved/${id}`, "DELETE");
      assert.deepEqual(await removed, { workspaceId: owner.workspaceId });
      assert.equal(
        repeated,
        1,
        "only the actual removal emits a second change",
      );
      assert.equal(leaked, 0);
    },
  ));
