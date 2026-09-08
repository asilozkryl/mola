import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.js";
import { createWorkspace } from "../server/seed.js";
import type {
  ActivityKind,
  ActivityPage,
  DirectConversationsPage,
} from "../shared/hub-types.js";
import type { NotificationState } from "../shared/collaboration-types.js";

const origin = "http://conversation-hubs.test";
const time = "2026-01-01T00:00:00.000Z";
type Actor = { id: string; workspaceId: string; hash: string; cookie: string };
async function fixture(
  run: (context: {
    runtime: ReturnType<typeof createApp>;
    owner: Actor;
    member: Actor;
    outsider: Actor;
    user: (name: string, workspaceId?: string) => string;
    session: (id: string, workspaceId: string) => Actor;
    channel: (
      kind: "text" | "dm",
      members?: string[],
      workspaceId?: string,
      name?: string,
    ) => string;
    message: (
      channelId: string,
      userId: string,
      content?: string,
      createdAt?: string,
    ) => string;
    notification: (
      channelId: string,
      messageId: string,
      kind?: Exclude<ActivityKind, "all">,
      recipient?: Actor,
      createdAt?: string,
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
  const directory = await mkdtemp(join(tmpdir(), "mola-hubs-"));
  const runtime = createApp({
    dataDir: directory,
    appOrigin: origin,
    production: false,
    requireEmailVerification: false,
    mailTransport: async () => {},
    mailEncryptionKey: "1".repeat(64),
  });
  await new Promise<void>((resolve) =>
    runtime.server.listen(0, "127.0.0.1", resolve),
  );
  const base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
  const first = createWorkspace(runtime.repo, {
    name: "Hub Team",
    userName: "Hub Owner",
    email: "owner@hubs.test",
    passwordHash: null,
  });
  const other = createWorkspace(runtime.repo, {
    name: "Foreign Team",
    userName: "Foreign Owner",
    email: "foreign@hubs.test",
    passwordHash: null,
  });
  const user = (name: string, workspaceId: string = first.workspaceId) => {
    const id = randomUUID();
    runtime.repo.run(
      "INSERT INTO users(id,workspace_id,name,email,color,role,created_at,email_verified) VALUES(?,?,?,?,?,'member',?,1)",
      id,
      workspaceId,
      name,
      `${id}@hubs.test`,
      "#abcdef",
      time,
    );
    return id;
  };
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
  const owner = session(first.userId, first.workspaceId);
  const member = session(user("İpek Deniz"), first.workspaceId);
  const outsider = session(other.userId, other.workspaceId);
  const channel = (
    kind: "text" | "dm",
    members: string[] = [],
    workspaceId: string = first.workspaceId,
    name = "restricted-plans",
  ) => {
    const id = randomUUID();
    runtime.repo.run(
      "INSERT INTO channels(id,workspace_id,name,kind,visibility,created_at) VALUES(?,?,?,?,'private',?)",
      id,
      workspaceId,
      name,
      kind,
      time,
    );
    for (const idOfMember of members)
      runtime.repo.run(
        "INSERT INTO channel_members VALUES(?,?)",
        id,
        idOfMember,
      );
    return id;
  };
  const message = (
    channelId: string,
    userId: string,
    content = "Message",
    createdAt = time,
  ) => {
    const id = randomUUID();
    runtime.repo.run(
      "INSERT INTO messages(id,channel_id,user_id,content,created_at) VALUES(?,?,?,?,?)",
      id,
      channelId,
      userId,
      content,
      createdAt,
    );
    return id;
  };
  const notification = (
    channelId: string,
    messageId: string,
    kind: Exclude<ActivityKind, "all"> = "channel",
    recipient = owner,
    createdAt = time,
  ) => {
    const id = randomUUID();
    runtime.repo.run(
      "INSERT INTO notifications(id,user_id,workspace_id,channel_id,message_id,kind,created_at) VALUES(?,?,?,?,?,?,?)",
      id,
      recipient.id,
      recipient.workspaceId,
      channelId,
      messageId,
      kind,
      createdAt,
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
  try {
    await run({
      runtime,
      owner,
      member,
      outsider,
      user,
      session,
      channel,
      message,
      notification,
      request,
      get,
    });
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test("direct conversation pagination includes more than fifty opened empty and active DMs without ties skipping rows", async () =>
  fixture(async ({ owner, user, channel, message, get }) => {
    const expected: string[] = [];
    for (let index = 0; index < 83; index++) {
      const peer = user(`Peer ${index}`),
        id = channel("dm", [owner.id, peer]);
      expected.push(id);
      if (index % 2) message(id, peer, `Conversation ${index}`);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: DirectConversationsPage = await get(
        owner,
        `/direct-conversations?limit=17${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      assert.equal(page.userId, owner.id);
      assert.equal(page.workspaceId, owner.workspaceId);
      assert.ok(page.items.length <= 17);
      seen.push(...page.items.map((item) => item.channelId));
      cursor = page.nextCursor;
    } while (cursor);
    assert.deepEqual(seen, expected.sort().reverse());
    assert.equal(new Set(seen).size, 83);
  }));

test("activity pagination retains more than one hundred personal events and uses keyset cursors under front inserts and anchor deletion", async () =>
  fixture(
    async ({ runtime, owner, member, channel, message, notification, get }) => {
      const id = channel("text", [owner.id, member.id]);
      const expected: string[] = [];
      for (let index = 0; index < 127; index++)
        expected.push(
          notification(id, message(id, member.id, `Event ${index}`)),
        );
      const first = await get<ActivityPage>(owner, "/activity?limit=23");
      assert.equal(first.items.length, 23);
      assert.ok(first.nextCursor);
      const added = notification(
        id,
        message(id, member.id, "Arrived later", "2099-01-01T00:00:00.000Z"),
        "mention",
        owner,
        "2099-01-01T00:00:00.000Z",
      );
      runtime.repo.run(
        "DELETE FROM notifications WHERE id=?",
        first.items.at(-1)!.id,
      );
      const seen = first.items.map((item) => item.id);
      let cursor: string | null = first.nextCursor;
      while (cursor) {
        const page: ActivityPage = await get(
          owner,
          `/activity?limit=23&cursor=${encodeURIComponent(cursor)}`,
        );
        seen.push(...page.items.map((item) => item.id));
        cursor = page.nextCursor;
      }
      assert.deepEqual(seen, expected.sort().reverse());
      assert.equal(new Set(seen).size, 127);
      assert.ok(!seen.includes(added));
      assert.equal(
        (await get<ActivityPage>(owner, "/activity")).items[0].id,
        added,
      );
    },
  ));

test("hub cursors reject malformed, forged and cross-account, workspace, endpoint or filter reuse", async () =>
  fixture(
    async ({
      runtime,
      owner,
      member,
      outsider,
      session,
      channel,
      message,
      notification,
      request,
      get,
    }) => {
      const direct = channel("dm", [owner.id, member.id]);
      channel("dm", [owner.id, member.id]);
      notification(direct, message(direct, member.id), "dm");
      notification(direct, message(direct, member.id), "dm");
      const directPage = await get<DirectConversationsPage>(
        owner,
        "/direct-conversations?limit=1",
      );
      const activityPage = await get<ActivityPage>(owner, "/activity?limit=1");
      assert.ok(directPage.nextCursor);
      assert.ok(activityPage.nextCursor);
      const cursor = encodeURIComponent(directPage.nextCursor!);
      for (const path of [
        `/direct-conversations?cursor=garbage`,
        `/direct-conversations?cursor=${cursor}x`,
        `/direct-conversations?cursor=${cursor}&q=changed`,
        `/direct-conversations?cursor=${cursor}&unread=true`,
        `/activity?cursor=${cursor}`,
        `/activity?cursor=${encodeURIComponent(activityPage.nextCursor!)}&kind=mention`,
      ]) {
        const response = await request(owner, path);
        assert.equal(response.status, 400);
        assert.equal((await response.json()).code, "INVALID_HUB_CURSOR");
      }
      assert.equal(
        (await request(member, `/direct-conversations?cursor=${cursor}`))
          .status,
        400,
      );
      assert.equal(
        (await request(outsider, `/direct-conversations?cursor=${cursor}`))
          .status,
        400,
      );
      runtime.repo.run(
        "INSERT INTO workspace_members(workspace_id,user_id,role,joined_at) VALUES(?,?,'member',?)",
        outsider.workspaceId,
        owner.id,
        time,
      );
      assert.equal(
        (
          await request(
            session(owner.id, outsider.workspaceId),
            `/direct-conversations?cursor=${cursor}`,
          )
        ).status,
        400,
      );
      for (const path of [
        "/activity?limit=101",
        "/direct-conversations?limit=0",
        "/activity?limit=1.5",
        "/activity?kind=unknown",
        "/direct-conversations?unread=yes",
        `/activity?q=${"a".repeat(201)}`,
        "/activity?cursor=",
        "/direct-conversations?userId=other",
      ])
        assert.equal((await request(owner, path)).status, 400);
    },
  ));

test("DM search uses peer names, previews and literal wildcard characters while drafts remain personal", async () =>
  fixture(async ({ runtime, owner, member, user, channel, message, get }) => {
    const peer = user("İpek %_"),
      dm = channel("dm", [owner.id, peer]);
    const otherDm = channel("dm", [owner.id, member.id]);
    const empty = channel("dm", [owner.id, user("Empty conversation")]);
    message(dm, peer, "Özel sprint kararı", "2026-02-01T00:00:00.000Z");
    runtime.repo.run(
      "INSERT INTO message_drafts VALUES(?,?,'','My private draft',1,?)",
      owner.id,
      dm,
      "2026-03-01T00:00:00.000Z",
    );
    runtime.repo.run(
      "INSERT INTO message_drafts VALUES(?,?,'','Another user draft',1,?)",
      member.id,
      otherDm,
      "2099-03-01T00:00:00.000Z",
    );
    const all = await get<DirectConversationsPage>(
      owner,
      "/direct-conversations",
    );
    assert.equal(all.items.length, 3);
    assert.equal(all.items[0].channelId, dm);
    assert.equal(all.items[0].hasDraft, true);
    assert.equal(all.items[0].preview, "Özel sprint kararı");
    assert.equal(
      all.items.find((item) => item.channelId === otherDm)!.hasDraft,
      false,
    );
    assert.equal(
      all.items.find((item) => item.channelId === empty)!.lastActivityAt,
      time,
    );
    for (const q of ["İPEK %_", "%_", "SPRİNT"])
      assert.deepEqual(
        (
          await get<DirectConversationsPage>(
            owner,
            `/direct-conversations?q=${encodeURIComponent(q)}`,
          )
        ).items.map((item) => item.channelId),
        [dm],
      );
    assert.deepEqual(
      (
        await get<DirectConversationsPage>(
          owner,
          "/direct-conversations?q=Another%20user%20draft",
        )
      ).items,
      [],
    );
  }));

test("personal activity filters, DM labels and read controls stay compatible with the notification and channel APIs", async () =>
  fixture(
    async ({ owner, member, channel, message, notification, request, get }) => {
      const dm = channel(
        "dm",
        [owner.id, member.id],
        owner.workspaceId,
        randomUUID(),
      );
      const incoming = message(
        dm,
        member.id,
        "DM sprint message",
        "2026-02-01T00:00:00.000Z",
      );
      const notice = notification(dm, incoming, "dm");
      message(dm, owner.id, "My follow-up", "2026-02-02T00:00:00.000Z");
      const text = channel(
        "text",
        [owner.id, member.id],
        owner.workspaceId,
        "Release room",
      );
      notification(
        text,
        message(text, member.id, "Mention preview"),
        "mention",
      );
      notification(text, message(text, member.id, "Reply preview"), "reply");
      notification(
        text,
        message(text, member.id, "Channel preview"),
        "channel",
      );
      const direct = await get<DirectConversationsPage>(
        owner,
        "/direct-conversations?unread=true",
      );
      assert.equal(direct.items.length, 1);
      assert.equal(direct.items[0].unreadCount, 1);
      assert.equal(direct.items[0].lastMessageBySelf, true);
      const activity = await get<ActivityPage>(
        owner,
        `/activity?kind=dm&q=${encodeURIComponent(member.id === owner.id ? "" : "İpek Deniz")}`,
      );
      assert.equal(activity.items.length, 1);
      assert.equal(activity.items[0].id, notice);
      assert.equal(activity.items[0].channelName, "İpek Deniz");
      assert.equal(activity.items[0].actorId, member.id);
      for (const kind of ["mention", "reply", "channel"]) {
        const page = await get<ActivityPage>(
          owner,
          `/activity?kind=${kind}&q=Release`,
        );
        assert.equal(page.items.length, 1);
        assert.equal(page.items[0].kind, kind);
      }
      assert.equal(
        (await request(owner, "/notifications/read", "POST", { id: notice }))
          .status,
        200,
      );
      assert.equal(
        (await get<ActivityPage>(owner, "/activity?kind=dm&unread=true")).items
          .length,
        0,
      );
      assert.equal(
        (await get<ActivityPage>(owner, "/activity?kind=dm")).items[0].read,
        true,
      );
      assert.equal(
        (
          await get<DirectConversationsPage>(
            owner,
            "/direct-conversations?unread=true",
          )
        ).items.length,
        1,
        "reading one activity does not mark the entire DM read",
      );
      assert.equal(
        (await request(owner, `/channels/${dm}/read`, "POST", {})).status,
        200,
      );
      assert.equal(
        (
          await get<DirectConversationsPage>(
            owner,
            "/direct-conversations?unread=true",
          )
        ).items.length,
        0,
      );
      assert.equal(
        (await request(owner, "/notifications/read", "POST", {})).status,
        200,
      );
      assert.equal(
        (await get<ActivityPage>(owner, "/activity?unread=true")).items.length,
        0,
      );
    },
  ));

test("reading all activity preserves conversation unread counts and isolates inaccessible channels, recipients and workspaces", async () =>
  fixture(
    async ({
      runtime,
      owner,
      member,
      outsider,
      session,
      channel,
      message,
      notification,
      request,
      get,
    }) => {
      const dm = channel("dm", [owner.id, member.id]);
      const directNotice = notification(dm, message(dm, member.id), "dm");
      message(dm, member.id, "Another unread direct message");
      const text = channel("text", [owner.id, member.id]);
      const textMessage = message(text, member.id);
      notification(text, textMessage, "mention");
      const anotherRecipient = notification(
        text,
        textMessage,
        "mention",
        member,
      );
      const hidden = channel("text", [member.id]);
      const hiddenNotice = notification(
        hidden,
        message(hidden, member.id),
        "mention",
      );
      runtime.repo.run(
        "INSERT INTO workspace_members(workspace_id,user_id,role,joined_at) VALUES(?,?,'member',?)",
        outsider.workspaceId,
        owner.id,
        time,
      );
      const foreignOwner = session(owner.id, outsider.workspaceId);
      const foreign = channel(
        "text",
        [owner.id, outsider.id],
        outsider.workspaceId,
      );
      const foreignNotice = notification(
        foreign,
        message(foreign, outsider.id),
        "mention",
        foreignOwner,
      );
      const before = await get<NotificationState>(owner, "/notifications");
      assert.equal(before.unreadNotifications, 2);
      assert.equal(before.unreadByChannel[dm], 2);
      assert.equal(before.unreadByChannel[text], 1);
      const readsBefore = runtime.repo.all(
        "SELECT * FROM channel_reads WHERE user_id=? ORDER BY channel_id",
        owner.id,
      );
      for (const body of [
        { id: directNotice, notificationsOnly: true },
        { notificationsOnly: false },
      ])
        assert.equal(
          (await request(owner, "/notifications/read", "POST", body)).status,
          400,
        );
      assert.equal(
        (await get<NotificationState>(owner, "/notifications"))
          .unreadNotifications,
        2,
        "invalid combinations must not read any notification",
      );
      assert.equal(
        (
          await request(owner, "/notifications/read", "POST", {
            notificationsOnly: true,
          })
        ).status,
        200,
      );
      const after = await get<NotificationState>(owner, "/notifications");
      assert.equal(after.unreadNotifications, 0);
      assert.deepEqual(after.unreadByChannel, before.unreadByChannel);
      assert.deepEqual(
        runtime.repo.all(
          "SELECT * FROM channel_reads WHERE user_id=? ORDER BY channel_id",
          owner.id,
        ),
        readsBefore,
        "notification-only reads must not insert or advance channel read cursors",
      );
      assert.deepEqual(
        (await get<ActivityPage>(owner, "/activity?unread=true")).items,
        [],
      );
      const direct = await get<DirectConversationsPage>(
        owner,
        "/direct-conversations?unread=true",
      );
      assert.equal(direct.items.length, 1);
      assert.equal(direct.items[0].channelId, dm);
      assert.equal(direct.items[0].unreadCount, 2);
      for (const id of [hiddenNotice, foreignNotice, anotherRecipient])
        assert.equal(
          runtime.repo.get("SELECT read_at FROM notifications WHERE id=?", id)!
            .read_at,
          null,
        );
      assert.equal(
        (await get<ActivityPage>(foreignOwner, "/activity?unread=true"))
          .items[0].id,
        foreignNotice,
      );
      assert.equal(
        (await get<ActivityPage>(member, "/activity?unread=true")).items[0].id,
        anotherRecipient,
      );
      assert.equal(
        (await request(owner, "/notifications/read", "POST", {})).status,
        200,
      );
      assert.deepEqual(
        (await get<NotificationState>(owner, "/notifications")).unreadByChannel,
        {},
        "the existing empty-body API still marks accessible conversations read",
      );
      for (const id of [hiddenNotice, foreignNotice, anotherRecipient])
        assert.equal(
          runtime.repo.get("SELECT read_at FROM notifications WHERE id=?", id)!
            .read_at,
          null,
        );
    },
  ));

test("hubs isolate recipients, private channel permissions and foreign workspaces even after access changes", async () =>
  fixture(
    async ({
      runtime,
      owner,
      member,
      outsider,
      channel,
      message,
      notification,
      request,
      get,
    }) => {
      const privateChannel = channel("text", [member.id]);
      const privateMessage = message(
        privateChannel,
        member.id,
        "Forbidden private preview",
      );
      const privateNotice = notification(
        privateChannel,
        privateMessage,
        "mention",
      );
      const unrelatedDm = channel("dm", [member.id, outsider.id]);
      notification(
        unrelatedDm,
        message(unrelatedDm, member.id, "Another peoples conversation"),
        "dm",
      );
      const foreignChannel = channel(
        "text",
        [outsider.id],
        outsider.workspaceId,
      );
      notification(
        foreignChannel,
        message(foreignChannel, outsider.id, "Foreign message"),
        "channel",
        outsider,
      );
      assert.deepEqual((await get<ActivityPage>(owner, "/activity")).items, []);
      assert.deepEqual(
        (await get<DirectConversationsPage>(owner, "/direct-conversations"))
          .items,
        [],
      );
      assert.equal(
        (
          await request(owner, "/notifications/read", "POST", {
            id: privateNotice,
          })
        ).status,
        404,
      );
      runtime.repo.run(
        "INSERT INTO channel_members VALUES(?,?)",
        privateChannel,
        owner.id,
      );
      assert.equal(
        (await get<ActivityPage>(owner, "/activity")).items[0].id,
        privateNotice,
      );
      runtime.repo.run(
        "DELETE FROM channel_members WHERE channel_id=? AND user_id=?",
        privateChannel,
        owner.id,
      );
      assert.deepEqual((await get<ActivityPage>(owner, "/activity")).items, []);
      assert.equal(
        (await get<ActivityPage>(outsider, "/activity")).items.length,
        1,
      );
      assert.deepEqual(
        (await get<ActivityPage>(member, "/activity")).items,
        [],
        "another member cannot see an event addressed to the owner",
      );
    },
  ));

test("DM hubs omit inactive peers and require an active workspace context", async () =>
  fixture(
    async ({
      runtime,
      owner,
      member,
      channel,
      message,
      notification,
      request,
      get,
    }) => {
      const dm = channel("dm", [owner.id, member.id]);
      notification(dm, message(dm, member.id), "dm");
      assert.equal(
        (await get<DirectConversationsPage>(owner, "/direct-conversations"))
          .items.length,
        1,
      );
      runtime.repo.run(
        "UPDATE workspace_members SET removed_at=? WHERE workspace_id=? AND user_id=?",
        time,
        owner.workspaceId,
        member.id,
      );
      assert.deepEqual(
        (await get<DirectConversationsPage>(owner, "/direct-conversations"))
          .items,
        [],
      );
      assert.deepEqual((await get<ActivityPage>(owner, "/activity")).items, []);
      runtime.repo.run(
        "UPDATE workspace_members SET removed_at=NULL,suspended_at=? WHERE workspace_id=? AND user_id=?",
        time,
        owner.workspaceId,
        member.id,
      );
      assert.deepEqual(
        (await get<DirectConversationsPage>(owner, "/direct-conversations"))
          .items,
        [],
      );
      runtime.repo.run(
        "UPDATE sessions SET workspace_id=NULL WHERE token_hash=?",
        owner.hash,
      );
      for (const path of ["/activity", "/direct-conversations"]) {
        const response = await request({ ...owner, workspaceId: "" }, path);
        assert.equal(response.status, 403);
        assert.equal((await response.json()).code, "WORKSPACE_REQUIRED");
      }
    },
  ));
