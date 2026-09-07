import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.js";
import { createWorkspace } from "../server/seed.js";
import {
  githubMessage,
  verifyGitHubSignature,
} from "../server/integrations.js";

const origin = "http://integrations.test";
async function fixture(
  run: (context: {
    runtime: ReturnType<typeof createApp>;
    owner: string;
    member: string;
    outsider: string;
    ownerId: string;
    workspaceId: string;
    channelId: string;
    request: (
      cookie: string,
      path: string,
      method?: string,
      body?: unknown,
    ) => Promise<Response>;
    hook: (
      id: string,
      body: string,
      headers?: Record<string, string>,
    ) => Promise<Response>;
  }) => Promise<void>,
) {
  const directory = mkdtempSync(join(tmpdir(), "mola-integrations-"));
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
    name: "Integrations",
    userName: "Owner",
    email: "owner@integrations.test",
    passwordHash: null,
  });
  const outside = createWorkspace(runtime.repo, {
    name: "Outside",
    userName: "Outsider",
    email: "outside@integrations.test",
    passwordHash: null,
  });
  const memberId = randomUUID();
  runtime.repo.run(
    "INSERT INTO users(id,workspace_id,name,email,color,role,created_at) VALUES(?,?,?,?,?,?,?)",
    memberId,
    created.workspaceId,
    "Member",
    "member@integrations.test",
    "#abcdef",
    "member",
    new Date().toISOString(),
  );
  const session = (id: string, workspaceId: string) => {
    const token = randomBytes(32).toString("hex");
    runtime.repo.run(
      "INSERT INTO sessions(token_hash,user_id,workspace_id,expires_at) VALUES(?,?,?,?)",
      createHash("sha256").update(token).digest("hex"),
      id,
      workspaceId,
      Date.now() + 600000,
    );
    return `mola_session=${token}`;
  };
  const request = (
    cookie: string,
    path: string,
    method = "GET",
    body?: unknown,
  ) =>
    fetch(base + "/api" + path, {
      method,
      headers: {
        Origin: origin,
        Cookie: cookie,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const hook = (
    id: string,
    body: string,
    headers: Record<string, string> = {},
  ) =>
    fetch(base + "/api/hooks/" + id, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body,
    });
  try {
    await run({
      runtime,
      ownerId: created.userId,
      workspaceId: created.workspaceId,
      channelId: runtime.repo.get(
        "SELECT id FROM channels WHERE workspace_id=? AND name='genel'",
        created.workspaceId,
      )!.id,
      owner: session(created.userId, created.workspaceId),
      member: session(memberId, created.workspaceId),
      outsider: session(outside.userId, outside.workspaceId),
      request,
      hook,
    });
  } finally {
    await runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("GitHub signatures use the official SHA-256 vector and payload formatting rejects malformed objects", () => {
  const signature =
    "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";
  assert.equal(
    verifyGitHubSignature(
      "It's a Secret to Everybody",
      Buffer.from("Hello, World!"),
      signature,
    ),
    true,
  );
  assert.equal(
    verifyGitHubSignature(
      "It's a Secret to Everybody",
      Buffer.from("Changed"),
      signature,
    ),
    false,
  );
  for (const header of ["", "sha1=123", "sha256=" + "a".repeat(63)])
    assert.equal(
      verifyGitHubSignature("secret", Buffer.from("x"), header),
      false,
    );
  for (const payload of [null, [], 1, "hello"])
    assert.throws(() => githubMessage("push", payload, "owner/repo"), {
      status: 400,
    });
  assert.throws(
    () =>
      githubMessage("push", { repository: { full_name: 123 } }, "owner/repo"),
    { status: 403 },
  );
  assert.match(
    githubMessage(
      "push",
      {
        repository: { full_name: "owner/repo" },
        commits: [null, { message: "Valid\ncommit" }],
      },
      "owner/repo",
    )!,
    /Valid commit/,
  );
});

test("webhooks are scoped, secrets encrypted, deliveries idempotent, and rotation/disable revoke old access", async () =>
  fixture(
    async ({
      runtime,
      owner,
      member,
      outsider,
      ownerId,
      workspaceId,
      channelId,
      request,
      hook,
    }) => {
      const input = { name: "Build bot", kind: "webhook", channelId };
      assert.equal(
        (await request(member, "/integrations", "POST", input)).status,
        403,
      );
      assert.equal(
        (await request(outsider, "/integrations", "POST", input)).status,
        404,
      );
      const response = await request(owner, "/integrations", "POST", input);
      assert.equal(response.status, 201);
      const integration = await response.json();
      assert.match(integration.secret, /^[a-f0-9]{64}$/);
      const stored = runtime.repo.get(
        "SELECT * FROM integrations WHERE id=?",
        integration.id,
      )!;
      assert.notEqual(stored.secret, integration.secret);
      assert.notEqual(stored.token_hash, integration.secret);
      assert.equal(
        runtime.repo.member(stored.bot_user_id, workspaceId)!.role,
        "guest",
      );
      const list = await (await request(owner, "/integrations")).json();
      assert.equal(JSON.stringify(list).includes(integration.secret), false);
      assert.equal(
        (await (await request(outsider, "/integrations")).json()).integrations
          .length,
        0,
      );
      const body = JSON.stringify({
        content: "Build finished",
        eventId: "build-123",
      });
      assert.equal((await hook(integration.id, body)).status, 401);
      assert.equal(
        (
          await hook(integration.id, body, {
            Authorization: integration.secret,
          })
        ).status,
        401,
      );
      const accepted = await hook(integration.id, body, {
        Authorization: `Bearer ${integration.secret}`,
      });
      assert.equal(accepted.status, 201);
      const messageId = (await accepted.json()).messageId;
      const duplicate = await hook(integration.id, body, {
        Authorization: `Bearer ${integration.secret}`,
      });
      assert.equal(duplicate.status, 200);
      assert.equal((await duplicate.json()).duplicate, true);
      assert.equal(
        runtime.repo.get(
          "SELECT count(*) AS n FROM messages WHERE user_id=?",
          stored.bot_user_id,
        )!.n,
        1,
      );
      assert.equal(
        (
          await hook(integration.id, "null", {
            Authorization: `Bearer ${integration.secret}`,
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request(outsider, `/integrations/${integration.id}`, "PATCH", {
            enabled: false,
          })
        ).status,
        404,
      );
      const rotated = await (
        await request(owner, `/integrations/${integration.id}`, "PATCH", {
          rotateSecret: true,
        })
      ).json();
      assert.notEqual(rotated.secret, integration.secret);
      assert.equal(
        (
          await hook(
            integration.id,
            JSON.stringify({ content: "Next", eventId: "next" }),
            { Authorization: `Bearer ${integration.secret}` },
          )
        ).status,
        401,
      );
      assert.equal(
        (
          await hook(
            integration.id,
            JSON.stringify({ content: "Next", eventId: "next" }),
            { Authorization: `Bearer ${rotated.secret}` },
          )
        ).status,
        201,
      );
      await request(owner, `/integrations/${integration.id}`, "PATCH", {
        enabled: false,
      });
      assert.equal(
        (
          await hook(integration.id, body, {
            Authorization: `Bearer ${rotated.secret}`,
          })
        ).status,
        404,
      );
      await request(owner, `/integrations/${integration.id}`, "PATCH", {
        enabled: true,
      });
      runtime.repo.run(
        "UPDATE users SET suspended_at=? WHERE id=?",
        new Date().toISOString(),
        ownerId,
      );
      assert.equal(
        (
          await hook(integration.id, body, {
            Authorization: `Bearer ${rotated.secret}`,
          })
        ).status,
        404,
      );
      assert.ok(
        runtime.repo.get("SELECT id FROM messages WHERE id=?", messageId),
      );
    },
  ));

test("GitHub hooks validate raw UTF-8 bytes, repository, delivery identity and malformed signed payloads", async () =>
  fixture(async ({ runtime, owner, channelId, request, hook }) => {
    const integration = await (
      await request(owner, "/integrations", "POST", {
        name: "GitHub",
        kind: "github",
        channelId,
        repository: "owner/repo",
      })
    ).json();
    const signed = (body: string, event = "push", id = randomUUID()) =>
      hook(integration.id, body, {
        "x-hub-signature-256":
          "sha256=" +
          createHmac("sha256", integration.secret).update(body).digest("hex"),
        "x-github-event": event,
        "x-github-delivery": id,
      });
    const body = JSON.stringify({
      repository: { full_name: "owner/repo" },
      sender: { login: "asil" },
      ref: "refs/heads/main",
      commits: [{ message: "Türkçe: görüşme düzeltildi" }],
    });
    const delivery = randomUUID();
    const accepted = await signed(body, "push", delivery);
    assert.equal(accepted.status, 201);
    const messageId = (await accepted.json()).messageId;
    assert.match(
      runtime.repo.get("SELECT content FROM messages WHERE id=?", messageId)!
        .content,
      /Türkçe: görüşme düzeltildi/,
    );
    assert.equal(
      (await (await signed(body, "push", delivery)).json()).duplicate,
      true,
    );
    assert.equal(
      (
        await hook(integration.id, body + " ", {
          "x-hub-signature-256":
            "sha256=" +
            createHmac("sha256", integration.secret).update(body).digest("hex"),
          "x-github-event": "push",
          "x-github-delivery": randomUUID(),
        })
      ).status,
      401,
    );
    for (const malformed of ["null", "[]", "1", '"text"', "{"])
      assert.equal((await signed(malformed)).status, 400, malformed);
    assert.equal(
      (
        await signed(
          JSON.stringify({ repository: { full_name: "other/repo" } }),
        )
      ).status,
      403,
    );
    assert.equal(
      (await signed(JSON.stringify({ repository: { full_name: 123 } }))).status,
      403,
    );
    assert.equal(
      (
        await signed(
          JSON.stringify({ repository: { full_name: "owner/repo" } }),
          "ping",
        )
      ).status,
      200,
    );
    assert.equal((await signed(body, "unknown-event")).status, 202);
    assert.equal(
      (
        await request(owner, "/integrations", "POST", {
          name: "Bad repo",
          kind: "github",
          channelId,
          repository: "../repo",
        })
      ).status,
      400,
    );
  }));

test("private-channel integrations stop delivering when creator or bot membership is removed", async () =>
  fixture(
    async ({
      runtime,
      owner,
      ownerId,
      workspaceId,
      channelId,
      request,
      hook,
    }) => {
      const integration = await (
        await request(owner, "/integrations", "POST", {
          name: "Private bot",
          kind: "webhook",
          channelId,
        })
      ).json();
      const row = runtime.repo.get(
        "SELECT * FROM integrations WHERE id=?",
        integration.id,
      )!;
      await request(owner, `/channels/${channelId}/access`, "PATCH", {
        visibility: "private",
        memberIds: [ownerId, row.bot_user_id],
      });
      const send = (eventId: string) =>
        hook(
          integration.id,
          JSON.stringify({ content: "Secret delivery", eventId }),
          { Authorization: `Bearer ${integration.secret}` },
        );
      assert.equal((await send("first")).status, 201);
      runtime.repo.run(
        "DELETE FROM channel_members WHERE channel_id=? AND user_id=?",
        channelId,
        row.bot_user_id,
      );
      assert.equal((await send("second")).status, 404);
      runtime.repo.run(
        "INSERT INTO channel_members VALUES(?,?)",
        channelId,
        row.bot_user_id,
      );
      runtime.repo.run(
        "UPDATE workspace_members SET role='member' WHERE workspace_id=? AND user_id=?",
        workspaceId,
        ownerId,
      );
      assert.equal((await send("third")).status, 404);
    },
  ));
