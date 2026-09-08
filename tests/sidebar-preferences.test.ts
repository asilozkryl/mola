import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import { createApp } from "../server/app.js";
import { createWorkspace } from "../server/seed.js";
import {
  normalizeSidebarPreferences,
  type SidebarPreferencesState,
  type SidebarPreferences,
} from "../shared/sidebar.js";

const origin = "http://sidebar-preferences.test";
type Actor = { id: string; workspaceId: string; hash: string; cookie: string };
async function fixture(
  run: (context: {
    runtime: ReturnType<typeof createApp>;
    owner: Actor;
    member: Actor;
    other: Actor;
    session: (id: string, workspaceId: string) => Actor;
    request: (
      actor: Actor,
      path?: string,
      method?: string,
      body?: unknown,
      workspaceId?: string,
    ) => Promise<Response>;
    socket: (actor: Actor) => Promise<Socket>;
    channel: (
      name: string,
      kind?: "text" | "voice" | "dm",
      members?: string[],
      visibility?: "public" | "private",
      workspaceId?: string,
    ) => string;
    state: (actor: Actor) => Promise<SidebarPreferencesState>;
  }) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "mola-sidebar-"));
  const runtime = createApp({
    dataDir: directory,
    appOrigin: origin,
    production: false,
    requireEmailVerification: false,
    mailTransport: async () => {},
    mailEncryptionKey: "1".repeat(64),
  });
  const sockets: Socket[] = [];
  await new Promise<void>((resolve) =>
    runtime.server.listen(0, "127.0.0.1", resolve),
  );
  const base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
  const first = createWorkspace(runtime.repo, {
    name: "Sidebar",
    userName: "Owner",
    email: "owner@sidebar.test",
    passwordHash: null,
  });
  const second = createWorkspace(runtime.repo, {
    name: "Other",
    userName: "Other",
    email: "other@sidebar.test",
    passwordHash: null,
  });
  const memberId = randomUUID();
  runtime.repo.run(
    "INSERT INTO users(id,workspace_id,name,email,color,role,created_at) VALUES(?,?,?,?,?,'member',?)",
    memberId,
    first.workspaceId,
    "Member",
    "member@sidebar.test",
    "#abcdef",
    new Date().toISOString(),
  );
  runtime.repo.run("UPDATE users SET email_verified=1");
  const session = (id: string, workspaceId: string): Actor => {
    const token = randomBytes(32).toString("hex");
    const hash = createHash("sha256").update(token).digest("hex");
    runtime.repo.run(
      "INSERT INTO sessions(token_hash,user_id,expires_at,workspace_id) VALUES(?,?,?,?)",
      hash,
      id,
      Date.now() + 600_000,
      workspaceId,
    );
    return { id, workspaceId, hash, cookie: `mola_session=${token}` };
  };
  const request = (
    actor: Actor,
    path = "/sidebar-preferences",
    method = "GET",
    body?: unknown,
    workspaceId = actor.workspaceId,
  ) =>
    fetch(`${base}/api${path}`, {
      method,
      headers: {
        Origin: origin,
        Cookie: actor.cookie,
        "X-User-Id": actor.id,
        "X-Workspace-Id": workspaceId,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const state = async (actor: Actor) => {
    const response = await request(actor);
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()) as SidebarPreferencesState;
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
    await new Promise<void>((resolve, reject) => {
      client.once("connect", resolve);
      client.once("connect_error", reject);
    });
    return client;
  };
  const channel = (
    name: string,
    kind: "text" | "voice" | "dm" = "text",
    members: string[] = [],
    visibility: "public" | "private" = kind === "dm" ? "private" : "public",
    workspaceId: string = first.workspaceId,
  ) => {
    const id = randomUUID();
    runtime.repo.run(
      "INSERT INTO channels(id,workspace_id,name,kind,visibility,created_at) VALUES(?,?,?,?,?,?)",
      id,
      workspaceId,
      name,
      kind,
      visibility,
      new Date().toISOString(),
    );
    for (const userId of members)
      runtime.repo.run("INSERT INTO channel_members VALUES(?,?)", id, userId);
    return id;
  };
  try {
    await run({
      runtime,
      owner: session(first.userId, first.workspaceId),
      member: session(memberId, first.workspaceId),
      other: session(second.userId, second.workspaceId),
      session,
      request,
      socket,
      channel,
      state,
    });
  } finally {
    sockets.forEach((client) => client.disconnect());
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
}
const save = (
  request: Parameters<Parameters<typeof fixture>[0]>[0]["request"],
  actor: Actor,
  current: SidebarPreferencesState,
  patch: Partial<SidebarPreferences>,
) =>
  request(actor, "/sidebar-preferences", "PATCH", {
    revision: current.revision,
    preferences: { ...current.preferences, ...patch },
  });

test("sidebar normalization preserves personal order, appends new channels and removes inaccessible or archived entries", () => {
  const channels = [
    { id: "new", name: "New", description: "", kind: "text" as const },
    { id: "known", name: "Known", description: "", kind: "text" as const },
    {
      id: "old",
      name: "Old",
      description: "",
      kind: "text" as const,
      archived: true,
    },
    { id: "voice", name: "Voice", description: "", kind: "voice" as const },
  ];
  assert.deepEqual(
    normalizeSidebarPreferences(
      {
        textOrder: ["gone", "known", "known", "old"],
        voiceOrder: ["known", "voice"],
        favoriteIds: ["gone", "voice", "voice"],
        collapsedSections: ["voice", "voice"],
        width: 500,
      },
      channels,
    ),
    {
      textOrder: ["known", "new"],
      voiceOrder: ["voice"],
      favoriteIds: ["voice"],
      collapsedSections: ["voice"],
      width: 340,
    },
  );
});

test("sidebar saves order, favorites, section state and width per user and workspace", async () =>
  fixture(
    async ({
      runtime,
      owner,
      member,
      other,
      session,
      channel,
      state,
      request,
    }) => {
      const last = channel("Last");
      const current = await state(owner);
      const order = [
        last,
        ...current.preferences.textOrder.filter((id) => id !== last),
      ];
      const response = await save(request, owner, current, {
        textOrder: [...order, last],
        favoriteIds: [last, last],
        collapsedSections: ["voice", "dms"],
        width: 310,
      });
      assert.equal(response.status, 200);
      const saved = await state(owner);
      assert.equal(saved.revision, 1);
      assert.deepEqual(saved.preferences.textOrder, order);
      assert.deepEqual(saved.preferences.favoriteIds, [last]);
      assert.deepEqual(saved.preferences.collapsedSections, ["voice", "dms"]);
      assert.equal(saved.preferences.width, 310);
      assert.deepEqual((await state(member)).preferences.favoriteIds, []);
      runtime.repo.run(
        "INSERT INTO workspace_members(workspace_id,user_id,role,joined_at) VALUES(?,?,'member',?)",
        other.workspaceId,
        owner.id,
        new Date().toISOString(),
      );
      const otherSession = session(owner.id, other.workspaceId);
      assert.deepEqual((await state(otherSession)).preferences.favoriteIds, []);
      assert.equal((await state(otherSession)).revision, 0);
    },
  ));

test("concurrent sidebar updates require the latest revision and never overwrite another tab", async () =>
  fixture(async ({ owner, state, request }) => {
    const current = await state(owner);
    const responses = await Promise.all([
      save(request, owner, current, { width: 280 }),
      save(request, owner, current, { width: 320 }),
    ]);
    assert.deepEqual(
      responses.map((response) => response.status).sort(),
      [200, 409],
    );
    const conflict = responses.find((response) => response.status === 409)!;
    assert.equal((await conflict.json()).code, "SIDEBAR_REVISION_CONFLICT");
    assert.equal((await state(owner)).revision, 1);
  }));

test("sidebar cannot store private, foreign, archived, wrong-kind or DM channels and rejects malformed settings", async () =>
  fixture(
    async ({ runtime, owner, member, other, channel, state, request }) => {
      const secret = channel("Secret", "text", [member.id], "private");
      const foreign = channel(
        "Other channel",
        "text",
        [],
        "public",
        other.workspaceId,
      );
      const archived = channel("Archived");
      runtime.repo.run(
        "UPDATE channels SET archived_at=? WHERE id=?",
        new Date().toISOString(),
        archived,
      );
      const voice = channel("Voice", "voice");
      const dm = channel("DM", "dm", [owner.id, member.id]);
      const current = await state(owner);
      for (const id of [secret, foreign, archived, dm, randomUUID()]) {
        assert.equal(
          (await save(request, owner, current, { favoriteIds: [id] })).status,
          404,
        );
        assert.equal((await state(owner)).revision, 0);
      }
      assert.equal(
        (await save(request, owner, current, { textOrder: [voice] })).status,
        404,
      );
      for (const width of [239, 341, 280.5])
        assert.equal(
          (await save(request, owner, current, { width })).status,
          400,
        );
      assert.equal(
        (
          await save(request, owner, current, {
            favoriteIds: Array(1001).fill(voice),
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request(owner, "/sidebar-preferences", "PATCH", {
            revision: 0,
            preferences: current.preferences,
            userId: member.id,
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request(
            owner,
            "/sidebar-preferences",
            "GET",
            undefined,
            other.workspaceId,
          )
        ).status,
        409,
      );
    },
  ));

test("server prunes revoked favorites and archived order while appending newly created channels", async () =>
  fixture(async ({ runtime, owner, channel, state, request }) => {
    const secret = channel("Mine", "text", [owner.id], "private");
    const archived = channel("Archive later");
    const current = await state(owner);
    assert.equal(
      (await save(request, owner, current, { favoriteIds: [secret, archived] }))
        .status,
      200,
    );
    runtime.repo.run(
      "DELETE FROM channel_members WHERE channel_id=? AND user_id=?",
      secret,
      owner.id,
    );
    runtime.repo.run(
      "UPDATE channels SET archived_at=? WHERE id=?",
      new Date().toISOString(),
      archived,
    );
    const added = channel("Created later");
    const next = await state(owner);
    assert.deepEqual(next.preferences.favoriteIds, []);
    assert.ok(!next.preferences.textOrder.includes(secret));
    assert.ok(!next.preferences.textOrder.includes(archived));
    assert.equal(next.preferences.textOrder.at(-1), added);
  }));

test("sidebar socket updates reach the same user in the same workspace only", async () =>
  fixture(
    async ({
      runtime,
      owner,
      member,
      other,
      session,
      socket,
      request,
      state,
    }) => {
      runtime.repo.run(
        "INSERT INTO workspace_members(workspace_id,user_id,role,joined_at) VALUES(?,?,'member',?)",
        other.workspaceId,
        owner.id,
        new Date().toISOString(),
      );
      const [same, teammate, elsewhere] = await Promise.all([
        socket(session(owner.id, owner.workspaceId)),
        socket(member),
        socket(session(owner.id, other.workspaceId)),
      ]);
      const leaks: unknown[] = [];
      teammate.on("sidebar:updated", (value) => leaks.push(value));
      elsewhere.on("sidebar:updated", (value) => leaks.push(value));
      const received = new Promise<SidebarPreferencesState>((resolve) =>
        same.once("sidebar:updated", resolve),
      );
      const current = await state(owner);
      assert.equal(
        (await save(request, owner, current, { width: 299 })).status,
        200,
      );
      assert.equal((await received).preferences.width, 299);
      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.deepEqual(leaks, []);
    },
  ));

test("recent conversations use real message or own-draft activity and exclude empty or inaccessible DMs", async () =>
  fixture(async ({ runtime, owner, member, other, channel, request }) => {
    const old = channel("Old", "dm", [owner.id, member.id]);
    const recent = channel("Recent", "dm", [owner.id, member.id]);
    const ownDraft = channel("Draft", "dm", [owner.id, member.id]);
    const empty = channel("Empty", "dm", [owner.id, member.id]);
    const theirDraft = channel("Their draft", "dm", [owner.id, member.id]);
    const unassigned = channel("Other peoples DM", "dm", [member.id, other.id]);
    const message = (id: string, content: string, date: string) =>
      runtime.repo.run(
        "INSERT INTO messages(id,channel_id,user_id,content,created_at) VALUES(?,?,?,?,?)",
        randomUUID(),
        id,
        member.id,
        content,
        date,
      );
    message(old, "Old message", "2026-01-01T00:00:00.000Z");
    message(recent, "Recent message", "2026-01-02T00:00:00.000Z");
    message(unassigned, "Do not expose", "2026-01-04T00:00:00.000Z");
    const draft = (id: string, userId: string) =>
      runtime.repo.run(
        "INSERT INTO message_drafts(user_id,channel_id,parent_key,content,revision,updated_at) VALUES(?,?,'','Private draft',1,?)",
        userId,
        id,
        "2026-01-03T00:00:00.000Z",
      );
    draft(ownDraft, owner.id);
    draft(theirDraft, member.id);
    const response = await request(owner, "/sidebar-conversations");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.userId, owner.id);
    assert.equal(body.workspaceId, owner.workspaceId);
    assert.deepEqual(
      body.conversations.map((item: { channelId: string }) => item.channelId),
      [ownDraft, recent, old],
    );
    assert.equal(body.conversations[0].hasDraft, true);
    assert.equal(
      body.conversations[0].preview,
      "",
      "private draft content is not sent in the summary",
    );
    assert.equal(body.conversations[1].preview, "Recent message");
    assert.ok(!JSON.stringify(body).includes(empty));
    runtime.repo.run(
      "DELETE FROM channel_members WHERE channel_id=? AND user_id=?",
      recent,
      owner.id,
    );
    assert.deepEqual(
      (
        await (await request(owner, "/sidebar-conversations")).json()
      ).conversations.map((item: { channelId: string }) => item.channelId),
      [ownDraft, old],
    );
  }));

test("inactive workspace memberships cannot read or mutate sidebar state", async () =>
  fixture(async ({ runtime, owner, state, request }) => {
    const current = await state(owner);
    runtime.repo.run(
      "UPDATE workspace_members SET suspended_at=? WHERE workspace_id=? AND user_id=?",
      new Date().toISOString(),
      owner.workspaceId,
      owner.id,
    );
    assert.equal((await request(owner)).status, 403);
    assert.equal((await request(owner, "/sidebar-conversations")).status, 403);
    assert.equal(
      (await save(request, owner, current, { width: 300 })).status,
      403,
    );
    assert.equal(
      runtime.repo.get("SELECT count(*) AS n FROM sidebar_preferences")!.n,
      0,
    );
  }));
