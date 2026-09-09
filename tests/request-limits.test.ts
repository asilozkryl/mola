import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.js";
import { createWorkspace } from "../server/seed.js";
import {
  API_NETWORK_LIMIT,
  API_REQUEST_LIMIT,
  apiRequestLimit,
} from "../server/request-limits.js";

const origin = "https://office.example.invalid";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
type Client = { id: string; cookie: string; tokenHash: string };
async function fixture(
  run: (context: {
    runtime: ReturnType<typeof createApp>;
    users: Client[];
    workspaceId: string;
    channelId: string;
    session: (
      userId: string,
      expiresAt?: number,
      workspaceId?: string | null,
    ) => Client;
    request: (
      path: string,
      client?: Client,
      options?: RequestInit,
    ) => Promise<Response>;
  }) => Promise<void>,
  { users = 2, proxy = 0 }: { users?: number; proxy?: number } = {},
) {
  const keys = [
    "NODE_ENV",
    "TRUST_PROXY",
    "REQUIRE_TURN",
    "MOLA_TEST_API_LIMIT",
    "MOLA_TEST_AUTH_LIMIT",
  ] as const;
  const previous = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  );
  process.env.NODE_ENV = "test";
  process.env.TRUST_PROXY = String(proxy);
  process.env.REQUIRE_TURN = "false";
  delete process.env.MOLA_TEST_API_LIMIT;
  delete process.env.MOLA_TEST_AUTH_LIMIT;
  const directory = mkdtempSync(join(tmpdir(), "mola-request-limits-"));
  let runtime: ReturnType<typeof createApp> | undefined;
  try {
    // Production mode deliberately ignores any inherited test quota overrides.
    runtime = createApp({
      databasePath: ":memory:",
      dataDir: directory,
      production: true,
      appOrigin: origin,
      mailEncryptionKey: "a".repeat(64),
      mailTransport: async () => {},
    });
    const active = runtime;
    const workspace = createWorkspace(active.repo, {
      name: "Office quota fixture",
      userName: "Office user 0",
      email: "office-0@example.invalid",
      passwordHash: null,
    });
    const channelId = active.repo.get(
      "SELECT id FROM channels WHERE workspace_id=? AND kind='text' ORDER BY rowid LIMIT 1",
      workspace.workspaceId,
    )!.id as string;
    const session = (
      userId: string,
      expiresAt = Date.now() + 3_600_000,
      workspaceId: string | null = workspace.workspaceId,
    ): Client => {
      const token = randomBytes(32).toString("hex");
      active.repo.run(
        "INSERT INTO sessions(token_hash,user_id,workspace_id,expires_at) VALUES(?,?,?,?)",
        hash(token),
        userId,
        workspaceId,
        expiresAt,
      );
      return {
        id: userId,
        cookie: `mola_session=${token}`,
        tokenHash: hash(token),
      };
    };
    const clients = active.repo.transaction(() =>
      Array.from({ length: users }, (_, index) => {
        const id = index ? randomUUID() : workspace.userId;
        if (index)
          active.repo.run(
            "INSERT INTO users(id,workspace_id,name,email,password_hash,color,role,status,created_at,email_verified) VALUES(?,?,?,?,NULL,'#abc','member','',?,1)",
            id,
            workspace.workspaceId,
            `Office user ${index}`,
            `office-${index}@example.invalid`,
            new Date().toISOString(),
          );
        else
          active.repo.run("UPDATE users SET email_verified=1 WHERE id=?", id);
        return session(id);
      }),
    );
    await new Promise<void>((done) =>
      active.server.listen(0, "127.0.0.1", done),
    );
    const base = `http://127.0.0.1:${(active.server.address() as AddressInfo).port}`;
    const request = async (
      path: string,
      client?: Client,
      options: RequestInit = {},
    ) => {
      const headers = new Headers(options.headers);
      headers.set("Origin", origin);
      if (client) headers.set("Cookie", client.cookie);
      return fetch(base + "/api" + path, { ...options, headers });
    };
    await run({
      runtime: active,
      users: clients,
      workspaceId: workspace.workspaceId,
      channelId,
      session,
      request,
    });
  } finally {
    await runtime?.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test("thirty authenticated office users each complete the measured 55 requests/minute cohort on one real source IP", async () =>
  fixture(
    async ({ users, channelId, request }) => {
      const started = Date.now();
      await Promise.all(
        users.map(async (user) => {
          for (let index = 0; index < 55; index++) {
            const response = await request(
              `/channels/${channelId}/messages`,
              user,
            );
            assert.equal(
              response.status,
              200,
              `user ${user.id}, request ${index + 1}`,
            );
            assert.match(
              response.headers.get("ratelimit-policy") || "",
              /api-user/,
            );
            assert.ok(Array.isArray((await response.json()).messages));
          }
        }),
      );
      assert.ok(
        Date.now() - started < 60_000,
        "all 1,650 requests must exercise one fixed quota window",
      );
    },
    { users: 30 },
  ));

test("one abusive account cannot rotate sessions, workspaces or forged user headers to consume another account quota", async () =>
  fixture(async ({ runtime, users, request, session }) => {
    const [abusive, innocent] = users;
    const alternate = createWorkspace(runtime.repo, {
      name: "Other workspace",
      userName: "unused",
      email: "unused@example.invalid",
      passwordHash: null,
      existingUserId: abusive.id,
    });
    const secondDevice = session(abusive.id, undefined, alternate.workspaceId);
    const accountOnly = session(abusive.id, undefined, null);
    for (let index = 0; index < API_REQUEST_LIMIT; index++) {
      const response = await request(
        "/auth/me",
        [abusive, secondDevice, accountOnly][index % 3],
        { headers: { "X-User-Id": innocent.id } },
      );
      assert.equal(response.status, 409);
      await response.arrayBuffer();
    }
    for (const client of [abusive, secondDevice, accountOnly]) {
      const blocked = await request("/auth/me", client);
      assert.equal(blocked.status, 429);
      assert.equal((await blocked.json()).code, "API_RATE_LIMITED");
      assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    }
    const fresh = await request("/auth/me", innocent);
    assert.equal(fresh.status, 200);
    assert.equal((await fresh.json()).user.id, innocent.id);
  }));

test("anonymous requests share their IP quota despite forged IDs, invalid cookies and expired real sessions", async () =>
  fixture(async ({ users, session, request }) => {
    const expired = session(users[0].id, Date.now() - 1);
    for (let index = 0; index < API_REQUEST_LIMIT; index++) {
      const headers: Record<string, string> = {
        "X-User-Id": randomUUID(),
        "X-Workspace-Id": randomUUID(),
      };
      if (index % 3 === 1)
        headers.Cookie = `mola_session=${randomBytes(32).toString("hex")}`;
      if (index % 3 === 2) headers.Cookie = expired.cookie;
      const response = await request("/auth/me", undefined, { headers });
      assert.equal(response.status, 401);
      await response.arrayBuffer();
    }
    const blocked = await request("/health");
    assert.equal(blocked.status, 429);
    assert.equal((await blocked.json()).code, "API_RATE_LIMITED");
    assert.match(
      blocked.headers.get("ratelimit-policy") || "",
      /api-anonymous/,
    );
    assert.equal(
      (await request("/auth/me", users[0])).status,
      200,
      "anonymous abuse must not exhaust an authenticated colleague",
    );
  }));

test("the independent network guard rejects request 6001 before session lookup or JSON parsing", async () =>
  fixture(
    async ({ runtime, users, request }) => {
      const started = Date.now();
      await Promise.all(
        users.map(async (user) => {
          for (
            let index = 0;
            index < API_NETWORK_LIMIT / users.length;
            index++
          ) {
            const response = await request("/health", user, {
              headers: { "X-Forwarded-For": "198.18.0.1" },
            });
            assert.equal(response.status, 200);
            await response.arrayBuffer();
          }
        }),
      );
      assert.ok(
        Date.now() - started < 60_000,
        "network saturation must occur in one quota window",
      );
      let lookups = 0;
      const findSession = runtime.repo.session.bind(runtime.repo);
      runtime.repo.session = (token) => {
        lookups++;
        return findSession(token);
      };
      const blocked = await request("/auth/me", users[0], {
        method: "POST",
        headers: {
          "X-Forwarded-For": "198.18.0.1",
          "Content-Type": "application/json",
        },
        body: "{bad json",
      });
      assert.equal(blocked.status, 429);
      assert.equal((await blocked.json()).code, "API_NETWORK_RATE_LIMITED");
      assert.equal(lookups, 0);
      assert.ok(Number(blocked.headers.get("retry-after")) > 0);
      const otherNetwork = await request("/health", users[0], {
        headers: { "X-Forwarded-For": "198.18.0.2" },
      });
      assert.equal(otherNetwork.status, 200);
    },
    { users: 30, proxy: 1 },
  ));

test("untrusted forwarded addresses cannot reset an anonymous quota", async () =>
  fixture(async ({ request }) => {
    for (let index = 0; index < API_REQUEST_LIMIT; index++) {
      const response = await request("/health", undefined, {
        headers: {
          "X-Forwarded-For": `198.18.${Math.floor(index / 250)}.${(index % 250) + 1}`,
        },
      });
      assert.equal(response.status, 200);
      await response.arrayBuffer();
    }
    assert.equal(
      (
        await request("/health", undefined, {
          headers: { "X-Forwarded-For": "203.0.113.90" },
        })
      ).status,
      429,
    );
  }));

test("one trusted proxy uses its nearest forwarded client and groups rotating IPv6 addresses by subnet", async () =>
  fixture(
    async ({ request }) => {
      for (let index = 0; index < API_REQUEST_LIMIT; index++) {
        const response = await request("/health", undefined, {
          headers: {
            "X-Forwarded-For": `203.0.113.${(index % 250) + 1}, 2001:db8:abcd:1200::${index + 1}`,
          },
        });
        assert.equal(response.status, 200);
        await response.arrayBuffer();
      }
      assert.equal(
        (
          await request("/health", undefined, {
            headers: {
              "X-Forwarded-For": "198.51.100.1, 2001:db8:abcd:12ff::ffff",
            },
          })
        ).status,
        429,
      );
      assert.equal(
        (
          await request("/health", undefined, {
            headers: {
              "X-Forwarded-For": "198.51.100.1, 2001:db8:abcd:1300::1",
            },
          })
        ).status,
        200,
      );
    },
    { proxy: 1 },
  ));

test("the twenty-attempt authentication IP limit remains independent of valid sessions and spoofed identities", async () =>
  fixture(async ({ users, request }) => {
    for (let index = 0; index < 20; index++) {
      const response = await request(
        "/auth/login",
        index % 2 ? users[0] : undefined,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-User-Id": randomUUID(),
          },
          body: "{}",
        },
      );
      assert.equal(response.status, 400);
      await response.arrayBuffer();
    }
    const blocked = await request("/auth/login", users[1], {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(blocked.status, 429);
    assert.match((await blocked.json()).error, /Çok fazla giriş denemesi/);
    assert.equal((await request("/auth/me", users[1])).status, 200);
  }));

test("API test overrides are bounded, cannot affect production and never alter the overall IP ceiling", () => {
  for (const value of [
    undefined,
    "",
    "invalid",
    "299",
    "5001",
    "300.5",
    "Infinity",
    "-1",
  ]) {
    assert.equal(
      apiRequestLimit(false, { NODE_ENV: "test", MOLA_TEST_API_LIMIT: value }),
      300,
    );
  }
  for (const value of ["300", " 2000 ", "5000"]) {
    assert.equal(
      apiRequestLimit(false, { NODE_ENV: "test", MOLA_TEST_API_LIMIT: value }),
      Number(value),
    );
    assert.equal(
      apiRequestLimit(true, { NODE_ENV: "test", MOLA_TEST_API_LIMIT: value }),
      300,
    );
    assert.equal(
      apiRequestLimit(false, {
        NODE_ENV: "development",
        MOLA_TEST_API_LIMIT: value,
      }),
      300,
    );
  }
  assert.equal(API_NETWORK_LIMIT, 6000);
});
