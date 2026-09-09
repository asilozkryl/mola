import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.js";
import { createWorkspace } from "../server/seed.js";
import type {
  ChannelFilesPage,
  ChannelPinsPage,
  MessageHistoryPage,
  MessageSearchPage,
} from "../shared/collection-types.js";

const origin = "http://collections.test",
  at = "2026-05-01T10:00:00.000Z";
type Actor = { id: string; workspaceId: string; cookie: string; hash: string };
async function fixture(
  run: (context: {
    runtime: ReturnType<typeof createApp>;
    directory: string;
    owner: Actor;
    member: Actor;
    other: Actor;
    session: (id: string, workspaceId: string) => Actor;
    channel: (
      visibility?: "public" | "private",
      workspaceId?: string,
    ) => string;
    message: (
      channelId: string,
      options?: {
        userId?: string;
        at?: string;
        content?: string;
        parentId?: string;
        pinned?: boolean;
      },
    ) => string;
    file: (
      messageId: string,
      options?: { at?: string; name?: string; mime?: string; body?: string },
    ) => string;
    request: (actor: Actor, path: string) => Promise<Response>;
    get: <T>(actor: Actor, path: string) => Promise<T>;
  }) => Promise<void>,
) {
  const directory = mkdtempSync(join(tmpdir(), "mola-collections-"));
  const runtime = createApp({
    dataDir: directory,
    appOrigin: origin,
    production: false,
    requireEmailVerification: false,
    mailTransport: async () => {},
    mailEncryptionKey: "1".repeat(64),
  });
  await new Promise<void>((done) =>
    runtime.server.listen(0, "127.0.0.1", done),
  );
  const base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
  const first = createWorkspace(runtime.repo, {
    name: "Collections",
    userName: "Owner",
    email: "owner@collections.test",
    passwordHash: null,
  });
  const second = createWorkspace(runtime.repo, {
    name: "Foreign",
    userName: "Foreign Owner",
    email: "foreign@collections.test",
    passwordHash: null,
  });
  const memberId = randomUUID();
  runtime.repo.run(
    "INSERT INTO users(id,workspace_id,name,email,color,role,created_at,email_verified) VALUES(?,?,?,?,?,'member',?,1)",
    memberId,
    first.workspaceId,
    "İpek Deniz",
    "member@collections.test",
    "#aabbcc",
    at,
  );
  runtime.repo.run("UPDATE users SET email_verified=1");
  const session = (id: string, workspaceId: string): Actor => {
    const token = randomBytes(32).toString("hex"),
      hash = createHash("sha256").update(token).digest("hex");
    runtime.repo.run(
      "INSERT INTO sessions(token_hash,user_id,workspace_id,expires_at) VALUES(?,?,?,?)",
      hash,
      id,
      workspaceId,
      Date.now() + 600000,
    );
    return { id, workspaceId, cookie: `mola_session=${token}`, hash };
  };
  const owner = session(first.userId, first.workspaceId),
    member = session(memberId, first.workspaceId),
    other = session(second.userId, second.workspaceId);
  const channel = (
    visibility: "public" | "private" = "public",
    workspaceId: string = first.workspaceId,
  ) => {
    const id = randomUUID();
    runtime.repo.run(
      "INSERT INTO channels(id,workspace_id,name,description,kind,visibility,created_at) VALUES(?,?,?,'','text',?,?)",
      id,
      workspaceId,
      `collection-${id}`,
      visibility,
      at,
    );
    return id;
  };
  const message = (
    channelId: string,
    options: {
      userId?: string;
      at?: string;
      content?: string;
      parentId?: string;
      pinned?: boolean;
    } = {},
  ) => {
    const id = randomUUID();
    runtime.repo.run(
      "INSERT INTO messages VALUES(?,?,?,?,?,?,?,?)",
      id,
      channelId,
      options.userId || owner.id,
      options.content ?? "Message body",
      options.at || at,
      null,
      options.parentId || null,
      options.pinned ? 1 : 0,
    );
    return id;
  };
  const file = (
    messageId: string,
    options: { at?: string; name?: string; mime?: string; body?: string } = {},
  ) => {
    const row = runtime.repo.get(
      "SELECT m.user_id,c.workspace_id FROM messages m JOIN channels c ON c.id=m.channel_id WHERE m.id=?",
      messageId,
    )!;
    const id = randomUUID();
    runtime.repo.run(
      "INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?,?)",
      id,
      row.workspace_id,
      row.user_id,
      messageId,
      options.name || "attachment.txt",
      options.body?.length || 12,
      options.mime || "text/plain",
      `${id}.bin`,
      options.at || at,
    );
    if (options.body !== undefined)
      writeFileSync(join(directory, "uploads", `${id}.bin`), options.body);
    return id;
  };
  const request = (actor: Actor, path: string) =>
    fetch(base + "/api" + path, {
      headers: {
        Cookie: actor.cookie,
        Origin: origin,
        "X-User-Id": actor.id,
        "X-Workspace-Id": actor.workspaceId,
      },
    });
  const get = async <T>(actor: Actor, path: string): Promise<T> => {
    const response = await request(actor, path);
    assert.equal(
      response.status,
      200,
      `${path}: ${response.status === 200 ? "" : await response.text()}`,
    );
    return (await response.json()) as T;
  };
  try {
    await run({
      runtime,
      directory,
      owner,
      member,
      other,
      session,
      channel,
      message,
      file,
      request,
      get,
    });
  } finally {
    await runtime.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
  }
}
const cursorQuery = (cursor: string) => `cursor=${encodeURIComponent(cursor)}`;

test("file pages traverse more than 150 tied timestamps without duplicates when a boundary is deleted and a newer file arrives", () =>
  fixture(async ({ runtime, owner, member, channel, message, file, get }) => {
    const id = channel(),
      original = Array.from({ length: 163 }, () =>
        file(message(id, { userId: member.id })),
      );
    const path = `/channels/${id}/files`,
      first = await get<ChannelFilesPage>(owner, path);
    assert.equal(first.files.length, 50);
    assert.equal(first.total, 163);
    assert.ok(first.nextCursor);
    assert.equal(first.files[0].user.id, member.id);
    assert.equal(first.files[0].user.name, "İpek Deniz");
    assert.equal(first.files[0].channelId, id);
    assert.equal(first.files[0].parentId, null);
    assert.equal(first.files[0].createdAt, at);
    assert.deepEqual(
      Object.keys(first.files[0].user).filter((k) =>
        /hash|password|token/.test(k),
      ),
      [],
    );
    runtime.repo.run(
      "DELETE FROM messages WHERE id=?",
      first.files.at(-1)!.messageId,
    );
    const added = file(message(id), { at: "2026-06-01T00:00:00.000Z" });
    const seen = first.files.map((f) => f.id);
    let cursor: string | null = first.nextCursor;
    while (cursor) {
      const page: ChannelFilesPage = await get<ChannelFilesPage>(
        owner,
        `${path}?${cursorQuery(cursor)}`,
      );
      seen.push(...page.files.map((f) => f.id));
      cursor = page.nextCursor;
    }
    assert.equal(new Set(seen).size, 163);
    assert.deepEqual([...seen].sort(), [...original].sort());
    assert.equal(seen.includes(added), false);
    const refreshed = await get<ChannelFilesPage>(owner, path);
    assert.equal(refreshed.files[0].id, added);
    assert.equal(refreshed.total, 163);
  }));

test("pin pagination continues after the boundary is unpinned and supports archive reads and filtered totals", () =>
  fixture(async ({ runtime, owner, member, channel, message, file, get }) => {
    const id = channel(),
      original = Array.from({ length: 157 }, (_, i) =>
        message(id, { pinned: true, userId: i % 2 ? member.id : owner.id }),
      );
    const path = `/channels/${id}/pins`,
      first = await get<ChannelPinsPage>(owner, path);
    assert.equal(first.messages.length, 50);
    assert.equal(first.total, 157);
    const filenameMessage = original.find(
      (id) => id !== first.messages.at(-1)!.id,
    )!;
    file(filenameMessage, { name: "design-filename-only.pdf" });
    runtime.repo.run(
      "UPDATE messages SET pinned=0 WHERE id=?",
      first.messages.at(-1)!.id,
    );
    const added = message(id, { pinned: true, at: "2026-06-01T00:00:00.000Z" });
    runtime.repo.run("UPDATE channels SET archived_at=? WHERE id=?", at, id);
    const seen = first.messages.map((m) => m.id);
    let cursor: string | null = first.nextCursor;
    while (cursor) {
      const page: ChannelPinsPage = await get<ChannelPinsPage>(
        owner,
        `${path}?${cursorQuery(cursor)}`,
      );
      seen.push(...page.messages.map((m) => m.id));
      cursor = page.nextCursor;
    }
    assert.deepEqual([...seen].sort(), [...original].sort());
    assert.equal(new Set(seen).size, 157);
    assert.equal(seen.includes(added), false);
    const filtered = await get<ChannelPinsPage>(
      owner,
      `${path}?q=design-filename-only`,
    );
    assert.equal(filtered.total, 1);
    assert.equal(filtered.messages[0].id, filenameMessage);
    const author = await get<ChannelPinsPage>(
      owner,
      `${path}?userId=${member.id}`,
    );
    assert.equal(
      author.total,
      runtime.repo.get(
        "SELECT COUNT(*) n FROM messages WHERE channel_id=? AND pinned=1 AND user_id=?",
        id,
        member.id,
      )!.n,
    );
  }));

test("root history and thread replies use independent chronological keyset pages and retain legacy before requests", () =>
  fixture(async ({ runtime, owner, channel, message, get, request }) => {
    const id = channel(),
      original = Array.from({ length: 161 }, () => message(id));
    const parent = original[0],
      replies = Array.from({ length: 154 }, () =>
        message(id, { parentId: parent }),
      );
    for (const [parentId, expected] of [
      [undefined, original],
      [parent, replies],
    ] as const) {
      const path = `/channels/${id}/messages${parentId ? `?parentId=${parentId}` : ""}`,
        separator = parentId ? "&" : "?";
      const first = await get<MessageHistoryPage>(owner, path);
      assert.equal(first.messages.length, 50);
      assert.equal(first.hasMore, true);
      assert.ok(first.nextCursor);
      assert.deepEqual(
        first.messages.map((m) => m.id),
        [...first.messages.map((m) => m.id)].sort(),
      );
      const firstAnchor = first.messages[0].id,
        legacy = await get<MessageHistoryPage>(
          owner,
          `${path}${separator}before=${firstAnchor}`,
        );
      assert.equal(legacy.messages.length, 50);
      assert.equal(
        legacy.messages.some((m) => m.id === firstAnchor),
        false,
      );
      // Preserve the parent while deleting a keyset boundary that is only a reply/root row.
      if (firstAnchor !== parent)
        runtime.repo.run("DELETE FROM messages WHERE id=?", firstAnchor);
      const newer = message(id, { parentId, at: "2026-06-01T00:00:00.000Z" });
      const seen = first.messages.map((m) => m.id);
      let cursor: string | null = first.nextCursor;
      while (cursor) {
        const page: MessageHistoryPage = await get<MessageHistoryPage>(
          owner,
          `${path}${separator}${cursorQuery(cursor)}`,
        );
        seen.push(...page.messages.map((m) => m.id));
        assert.equal(page.hasMore, Boolean(page.nextCursor));
        cursor = page.nextCursor;
      }
      assert.deepEqual([...seen].sort(), [...expected].sort());
      assert.equal(new Set(seen).size, expected.length);
      assert.equal(seen.includes(newer), false);
      const cross = await request(
        owner,
        `/channels/${id}/messages?${cursorQuery(first.nextCursor)}${parentId ? "" : `&parentId=${parent}`}`,
      );
      assert.equal(cross.status, 400);
      assert.equal((await cross.json()).code, "INVALID_COLLECTION_CURSOR");
    }
  }));

test("filename-only search paginates beyond 150 results with sender and local-day instant filters, excluding the end boundary", () =>
  fixture(
    async ({
      runtime,
      owner,
      member,
      channel,
      message,
      file,
      get,
      request,
    }) => {
      const id = channel(),
        start = "2026-05-01T21:00:00.000Z",
        end = "2026-05-02T21:00:00.000Z";
      const original = Array.from({ length: 153 }, (_, i) => {
        const mid = message(id, {
          userId: member.id,
          content: "unrelated text",
          at: i ? "2026-05-02T12:00:00.000Z" : start,
        });
        file(mid, { name: "İÇERİK_% raporu.csv" });
        return mid;
      });
      for (const [userId, date] of [
        [owner.id, at],
        [member.id, end],
        [member.id, "2026-05-01T20:59:59.999Z"],
      ])
        file(message(id, { userId, at: date }), {
          name: "İÇERİK_% raporu.csv",
        });
      file(message(id, { userId: member.id, at: start }), {
        name: "İÇERİK_X raporu.csv",
      });
      const query = new URLSearchParams({
        q: "içerik_%",
        userId: member.id,
        channelId: id,
        startAt: "2026-05-02T00:00:00+03:00",
        endBefore: "2026-05-03T00:00:00+03:00",
        hasFiles: "true",
      });
      const first = await get<MessageSearchPage>(owner, `/search?${query}`);
      assert.equal(first.messages.length, 50);
      assert.ok(first.nextCursor);
      runtime.repo.run(
        "DELETE FROM messages WHERE id=?",
        first.messages.at(-1)!.id,
      );
      file(message(id, { userId: member.id, at: "2026-05-02T20:00:00.000Z" }), {
        name: "İÇERİK_% raporu.csv",
      });
      const seen = first.messages.map((m) => m.id);
      let cursor: string | null = first.nextCursor;
      while (cursor) {
        const page: MessageSearchPage = await get<MessageSearchPage>(
          owner,
          `/search?${query}&${cursorQuery(cursor)}`,
        );
        seen.push(...page.messages.map((m) => m.id));
        cursor = page.nextCursor;
      }
      assert.deepEqual([...seen].sort(), [...original].sort());
      assert.equal(new Set(seen).size, 153);
      const wrong = await request(
        owner,
        `/search?${query}&${cursorQuery(first.nextCursor)}&offset=50`,
      );
      assert.equal(wrong.status, 400);
      const legacy = await get<MessageSearchPage>(
        owner,
        `/search?q=içerik&channelId=${id}&from=2026-05-02&until=2026-05-02&offset=50`,
      );
      assert.equal(legacy.messages.length, 50);
    },
  ));

test("file metadata and source messages identify reply authors while file-name, sender and upload-time filters apply together", () =>
  fixture(async ({ owner, member, channel, message, file, get }) => {
    const id = channel(),
      parent = message(id),
      reply = message(id, {
        parentId: parent,
        userId: member.id,
        at: "2026-01-01T00:00:00.000Z",
      });
    const wanted = file(reply, {
      name: "Plan_% v2.pdf",
      at: "2026-05-02T02:00:00.000Z",
    });
    file(reply, { name: "Plan_X v2.pdf", at: "2026-05-02T02:00:00.000Z" });
    file(reply, { name: "Plan_% v2.pdf", at: "2026-05-03T00:00:00.000Z" });
    file(message(id), {
      name: "Plan_% v2.pdf",
      at: "2026-05-02T02:00:00.000Z",
    });
    const query = new URLSearchParams({
      q: "plan_%",
      userId: member.id,
      startAt: "2026-05-02T00:00:00.000Z",
      endBefore: "2026-05-03T00:00:00.000Z",
    });
    const page: ChannelFilesPage = await get<ChannelFilesPage>(
      owner,
      `/channels/${id}/files?${query}`,
    );
    assert.equal(page.total, 1);
    assert.equal(page.files[0].id, wanted);
    assert.equal(page.files[0].messageId, reply);
    assert.equal(page.files[0].parentId, parent);
    assert.equal(page.files[0].user.id, member.id);
    const source = await get<{ id: string; parentId: string }>(
      owner,
      `/messages/${page.files[0].messageId}`,
    );
    assert.equal(source.id, reply);
    assert.equal(source.parentId, parent);
  }));

test("signed cursors reject tampering and cross-user, workspace, endpoint, channel, query, sender and date reuse", () =>
  fixture(
    async ({
      owner,
      member,
      other,
      session,
      channel,
      message,
      file,
      get,
      request,
    }) => {
      const id = channel(),
        otherId = channel(),
        foreign = channel("public", other.workspaceId);
      for (let i = 0; i < 3; i++) {
        file(message(id, { pinned: true }));
        message(otherId, { pinned: true });
        message(foreign, { userId: other.id, pinned: true });
      }
      const first = await get<ChannelFilesPage>(
        owner,
        `/channels/${id}/files?limit=1`,
      );
      assert.ok(first.nextCursor);
      const paths = [
        `/channels/${id}/pins?`,
        `/channels/${otherId}/files?`,
        `/channels/${id}/messages?`,
        `/search?channelId=${id}&`,
        `/channels/${id}/files?q=changed&`,
        `/channels/${id}/files?userId=${member.id}&`,
        `/channels/${id}/files?startAt=2026-01-01T00:00:00Z&`,
      ];
      for (const path of paths) {
        const response = await request(
          owner,
          path + cursorQuery(first.nextCursor),
        );
        assert.equal(response.status, 400);
        assert.equal((await response.json()).code, "INVALID_COLLECTION_CURSOR");
      }
      const impersonated = await request(
        member,
        `/channels/${id}/files?${cursorQuery(first.nextCursor)}`,
      );
      assert.equal(impersonated.status, 400);
      const foreignCursor = await request(
        other,
        `/channels/${foreign}/files?${cursorQuery(first.nextCursor)}`,
      );
      assert.equal(foreignCursor.status, 400);
      for (const raw of [
        "bad",
        first.nextCursor.slice(0, -2) + "AA",
        Buffer.from(JSON.stringify({ version: 1 })).toString("base64url") +
          ".aaa",
      ]) {
        const response = await request(
          owner,
          `/channels/${id}/files?${cursorQuery(raw)}`,
        );
        assert.equal(response.status, 400);
        assert.equal((await response.json()).code, "INVALID_COLLECTION_CURSOR");
      }
      // Cursor keys are account/space scoped rather than bound to one session or page size.
      const secondDevice = session(owner.id, owner.workspaceId),
        continued = await get<ChannelFilesPage>(
          secondDevice,
          `/channels/${id}/files?limit=2&${cursorQuery(first.nextCursor)}`,
        );
      assert.equal(continued.files.length, 2);
    },
  ));

test("Unicode-expanding queries retain bounded, reusable signed cursors", () =>
  fixture(async ({ owner, channel, message, get }) => {
    const id = channel(),
      q = "ﬃ".repeat(150);
    for (let i = 0; i < 3; i++) message(id, { content: q });
    const query = new URLSearchParams({ q, limit: "1" });
    const first = await get<MessageSearchPage>(owner, `/search?${query}`);
    assert.ok(first.nextCursor);
    assert.ok(first.nextCursor.length < 2048);
    const second = await get<MessageSearchPage>(
      owner,
      `/search?${query}&${cursorQuery(first.nextCursor)}`,
    );
    assert.equal(second.messages.length, 1);
    assert.notEqual(second.messages[0].id, first.messages[0].id);
  }));

test("private and guest access is checked on every page and protected file fetch; a held search cursor never restores revoked access", () =>
  fixture(
    async ({
      runtime,
      owner,
      member,
      other,
      channel,
      message,
      file,
      get,
      request,
    }) => {
      const id = channel("private"),
        publicId = channel();
      runtime.repo.run(
        "INSERT INTO channel_members VALUES(?,?)",
        id,
        member.id,
      );
      const original = Array.from({ length: 3 }, () =>
        message(id, { content: "restricted-proof", pinned: true }),
      );
      const privateFiles = original.map((mid) =>
        file(mid, {
          name: "restricted-proof.pdf",
          mime: "application/pdf",
          body: "%PDF-1.4\nlocal fixture",
        }),
      );
      file(message(publicId, { content: "public-proof", pinned: true }), {
        body: "public fixture",
      });
      const pages = await Promise.all(
        ["files", "pins", "messages"].map((endpoint) =>
          get<any>(member, `/channels/${id}/${endpoint}?limit=1`),
        ),
      );
      const search = await get<MessageSearchPage>(
        member,
        "/search?q=restricted-proof&limit=1",
      );
      assert.ok(search.nextCursor);
      const allowedFile = await request(member, `/files/${privateFiles[0]}`);
      assert.equal(allowedFile.status, 200);
      assert.match(
        allowedFile.headers.get("cache-control")!,
        /private, no-store/,
      );
      assert.match(
        allowedFile.headers.get("content-security-policy")!,
        /default-src 'none'; sandbox/,
      );
      assert.match(
        allowedFile.headers.get("content-disposition")!,
        /^attachment/,
      );
      assert.match(await allowedFile.text(), /^%PDF-/);
      for (const actor of [owner, other])
        assert.equal(
          (await request(actor, `/files/${privateFiles[0]}`)).status,
          404,
        );
      runtime.repo.run(
        "DELETE FROM channel_members WHERE channel_id=? AND user_id=?",
        id,
        member.id,
      );
      for (const [index, endpoint] of ["files", "pins", "messages"].entries())
        assert.equal(
          (
            await request(
              member,
              `/channels/${id}/${endpoint}?limit=1&${cursorQuery(pages[index].nextCursor)}`,
            )
          ).status,
          404,
        );
      assert.equal(
        (await request(member, `/files/${privateFiles[0]}`)).status,
        404,
      );
      assert.deepEqual(
        (
          await get<MessageSearchPage>(
            member,
            `/search?q=restricted-proof&limit=1&${cursorQuery(search.nextCursor!)}`,
          )
        ).messages,
        [],
      );
      runtime.repo.run(
        "UPDATE workspace_members SET role='guest' WHERE workspace_id=? AND user_id=?",
        member.workspaceId,
        member.id,
      );
      for (const endpoint of ["files", "pins", "messages"])
        assert.equal(
          (await request(member, `/channels/${publicId}/${endpoint}`)).status,
          404,
        );
      assert.deepEqual(
        (await get<MessageSearchPage>(member, "/search?q=public-proof"))
          .messages,
        [],
      );
      runtime.repo.run(
        "INSERT INTO channel_members VALUES(?,?)",
        id,
        member.id,
      );
      assert.equal(
        (await get<ChannelFilesPage>(member, `/channels/${id}/files`)).files
          .length,
        3,
      );
      runtime.repo.run(
        "UPDATE workspace_members SET suspended_at=? WHERE workspace_id=? AND user_id=?",
        at,
        member.workspaceId,
        member.id,
      );
      assert.equal(
        (await request(member, `/channels/${id}/files`)).status,
        403,
      );
      assert.equal(
        (await request(member, `/files/${privateFiles[0]}`)).status,
        403,
      );
    },
  ));

test("empty pages, invalid date ranges and query limits have explicit contracts and preview CSP permits only same-origin workers", () =>
  fixture(async ({ owner, channel, message, request, get }) => {
    const id = channel();
    assert.deepEqual(
      await get<ChannelFilesPage>(owner, `/channels/${id}/files`),
      { files: [], nextCursor: null, total: 0 },
    );
    assert.deepEqual(
      await get<ChannelPinsPage>(owner, `/channels/${id}/pins`),
      { messages: [], nextCursor: null, total: 0 },
    );
    assert.deepEqual(
      await get<MessageHistoryPage>(owner, `/channels/${id}/messages`),
      { messages: [], nextCursor: null, hasMore: false },
    );
    for (const query of [
      "limit=0",
      "limit=101",
      "limit=1.5",
      "userId=bad",
      "startAt=bad",
      "startAt=2026-05-03T00:00:00Z&endBefore=2026-05-02T00:00:00Z",
      "q=" + "a".repeat(201),
    ])
      assert.equal(
        (await request(owner, `/channels/${id}/files?${query}`)).status,
        400,
      );
    assert.equal((await request(owner, "/search?q=a")).status, 400);
    assert.equal(
      (
        await request(
          owner,
          "/search?from=2026-05-01&startAt=2026-05-01T00:00:00Z",
        )
      ).status,
      400,
    );
    const root = message(id);
    assert.equal(
      (
        await request(
          owner,
          `/channels/${id}/messages?parentId=${root}&before=2026-06-01T00:00:00Z`,
        )
      ).status,
      200,
    );
    const response = await request(owner, `/channels/${id}/files`),
      csp = response.headers.get("content-security-policy")!;
    assert.match(csp, /(?:^|;)worker-src 'self'/);
    assert.match(csp, /(?:^|;)connect-src 'self' blob:/);
    assert.match(csp, /(?:^|;)font-src 'self' data:/);
    assert.doesNotMatch(csp, /unsafe-eval/);
    assert.match(csp, /(?:^|;)object-src 'none'/);
  }));
