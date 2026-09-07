import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { io as connect } from "socket.io-client";
import { createApp } from "../server/app.js";
import { base32Secret, totpCode } from "../server/account-security.js";
import { loadAccountSecurityKey } from "../server/security-key.js";

const ORIGIN = "http://localhost:5173";
const credentials = {
  name: "Security Owner",
  email: "security@example.invalid",
  password: "a-secure-password-123",
  workspaceName: "Security team",
};
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
function decode32(value: string): Buffer {
  let buffer = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const character of value) {
    buffer =
      (buffer << 5) | "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 255);
    }
  }
  return Buffer.from(bytes);
}

async function fixture(
  run: (context: {
    runtime: ReturnType<typeof createApp>;
    base: string;
    client: () => Client;
    directory: string;
  }) => Promise<void>,
) {
  const directory = mkdtempSync(join(tmpdir(), "mola-account-security-"));
  const runtime = createApp({
    databasePath: join(directory, "mola.sqlite"),
    dataDir: directory,
    uploadDir: join(directory, "uploads"),
    production: false,
    requireEmailVerification: false,
    mailTransport: async () => {},
  });
  await new Promise<void>((done) =>
    runtime.server.listen(0, "127.0.0.1", done),
  );
  const base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
  function client(): Client {
    const cookies = new Map<string, string>();
    return {
      cookies,
      async request(path, method = "GET", body) {
        const response = await fetch(`${base}/api${path}`, {
          method,
          headers: {
            Origin: ORIGIN,
            Cookie: [...cookies]
              .map(([key, value]) => `${key}=${value}`)
              .join("; "),
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0.0.0",
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        for (const cookie of response.headers.getSetCookie()) {
          const [pair] = cookie.split(";");
          const index = pair.indexOf("=");
          const name = pair.slice(0, index);
          const value = pair.slice(index + 1);
          if (value) cookies.set(name, value);
          else cookies.delete(name);
        }
        return response;
      },
    };
  }
  try {
    await run({ runtime, base, client, directory });
  } finally {
    await runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
interface Client {
  cookies: Map<string, string>;
  request: (path: string, method?: string, body?: unknown) => Promise<Response>;
}
async function enable(client: Client) {
  const response = await client.request("/account/security/setup", "POST", {
    password: credentials.password,
  });
  assert.equal(response.status, 200, await response.clone().text());
  const setup = await response.json();
  const code = totpCode(decode32(setup.secret), Date.now());
  const enabled = await client.request("/account/security/enable", "POST", {
    code,
  });
  assert.equal(enabled.status, 200, await enabled.clone().text());
  return {
    setup,
    code,
    codes: (await enabled.json()).recoveryCodes as string[],
  };
}

test("TOTP implements all SHA-1 RFC 6238 test vectors and base32 without padding", () => {
  const secret = Buffer.from("12345678901234567890");
  for (const [seconds, expected] of [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ] as const)
    assert.equal(totpCode(secret, seconds * 1000, 8), expected);
  assert.equal(base32Secret(Buffer.from("foobar")), "MZXW6YTBOI");
  assert.deepEqual(decode32(base32Secret(secret)), secret);
});

test("persistent security key survives restart and rejects malformed configured keys", () => {
  const directory = mkdtempSync(join(tmpdir(), "mola-key-"));
  try {
    const first = loadAccountSecurityKey(directory);
    assert.equal(first.length, 32);
    assert.deepEqual(loadAccountSecurityKey(directory), first);
    assert.deepEqual(
      readFileSync(join(directory, ".account-security-key")),
      first,
    );
    assert.equal(
      loadAccountSecurityKey(directory, "a".repeat(64)).toString("hex"),
      "a".repeat(64),
    );
    assert.throws(
      () => loadAccountSecurityKey(directory, "wrong"),
      /exactly 32/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("2FA setup requires password and possession, encrypts secrets, revokes other devices and gates login", async () =>
  fixture(async ({ runtime, client, directory }) => {
    const owner = client();
    const second = client();
    const registration = await owner.request(
      "/auth/register",
      "POST",
      credentials,
    );
    assert.equal(registration.status, 200);
    const userId = (await registration.json()).user.id;
    assert.equal(
      (await second.request("/auth/login", "POST", credentials)).status,
      200,
    );
    assert.equal(
      (
        await owner.request("/account/security/setup", "POST", {
          password: "incorrect",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await owner.request("/account/security/enable", "POST", {
          code: "000000",
        })
      ).status,
      400,
    );
    const { setup, code, codes } = await enable(owner);
    assert.equal(codes.length, 10);
    assert.equal(new Set(codes).size, 10);
    const row = runtime.repo.get(
      "SELECT * FROM account_security WHERE user_id=?",
      userId,
    )!;
    assert.ok(row.secret_cipher);
    assert.equal(row.secret_cipher.includes(setup.secret), false);
    assert.equal(row.pending_cipher, null);
    assert.ok(existsSync(join(directory, ".account-security-key")));
    assert.equal((await second.request("/auth/me")).status, 401);
    assert.equal((await owner.request("/account/security")).status, 200);
    assert.equal(
      runtime.repo.get(
        "SELECT count(*) AS n FROM security_recovery_codes WHERE user_id=?",
        userId,
      )!.n,
      10,
    );
    for (const saved of runtime.repo.all(
      "SELECT code_hash FROM security_recovery_codes WHERE user_id=?",
      userId,
    ))
      assert.ok(
        codes.every(
          (code) =>
            saved.code_hash !== code &&
            !saved.code_hash.includes(code.replace(/-/g, "")),
        ),
      );
    await owner.request("/auth/logout", "POST");
    const login = await owner.request("/auth/login", "POST", {
      email: credentials.email,
      password: credentials.password,
    });
    assert.equal(login.status, 200);
    assert.equal((await login.json()).twoFactorRequired, true);
    assert.ok(
      login.headers
        .getSetCookie()
        .some(
          (cookie) =>
            cookie.startsWith("mola_2fa=") &&
            /HttpOnly/.test(cookie) &&
            /SameSite=Strict/.test(cookie),
        ),
    );
    assert.equal(owner.cookies.has("mola_session"), false);
    assert.equal((await owner.request("/auth/me")).status, 401);
    assert.equal((await owner.request("/channels")).status, 401);
    assert.equal(
      (await owner.request("/auth/2fa/challenge", "POST", { code })).status,
      400,
      "Setup code cannot be replayed for login",
    );
    const verified = await owner.request("/auth/2fa/challenge", "POST", {
      code: codes[0],
    });
    assert.equal(verified.status, 200);
    assert.equal((await verified.json()).user.id, userId);
    assert.equal(owner.cookies.has("mola_2fa"), false);
    assert.equal(owner.cookies.has("mola_session"), true);
    assert.equal(
      (await owner.request("/auth/2fa/challenge", "POST", { code: codes[1] }))
        .status,
      401,
      "Consumed challenge cannot start another session",
    );
    assert.equal(
      (await (await owner.request("/account/security")).json())
        .recoveryCodesRemaining,
      9,
    );
  }));

test("recovery codes are single-use; regeneration and disabling require password plus a factor", async () =>
  fixture(async ({ client }) => {
    const owner = client();
    await owner.request("/auth/register", "POST", credentials);
    const { codes } = await enable(owner);
    assert.equal(
      (
        await owner.request("/account/security/disable", "POST", {
          password: "wrong",
          code: codes[0],
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await owner.request("/account/security/disable", "POST", {
          password: credentials.password,
          code: "invalid",
        })
      ).status,
      400,
    );
    const regenerated = await owner.request(
      "/account/security/recovery-codes",
      "POST",
      { password: credentials.password, code: codes[0] },
    );
    assert.equal(regenerated.status, 200);
    const next = (await regenerated.json()).recoveryCodes;
    assert.equal(
      (
        await owner.request("/account/security/disable", "POST", {
          password: credentials.password,
          code: codes[1],
        })
      ).status,
      400,
      "Old codes are invalid after regeneration",
    );
    assert.equal(
      (
        await owner.request("/account/security/disable", "POST", {
          password: credentials.password,
          code: next[0],
        })
      ).status,
      200,
    );
    assert.deepEqual(await (await owner.request("/account/security")).json(), {
      enabled: false,
      enabledAt: null,
      recoveryCodesRemaining: 0,
    });
    await owner.request("/auth/logout", "POST");
    const login = await owner.request("/auth/login", "POST", {
      email: credentials.email,
      password: credentials.password,
    });
    assert.equal(login.status, 200);
    assert.equal((await login.json()).user.email, credentials.email);
  }));

test("challenge expiry, account-wide attempt bounds and password changes cannot bypass the second factor", async () =>
  fixture(async ({ runtime, client }) => {
    const owner = client();
    await owner.request("/auth/register", "POST", credentials);
    const { codes } = await enable(owner);
    const challenger = client();
    await challenger.request("/auth/login", "POST", {
      email: credentials.email,
      password: credentials.password,
    });
    runtime.repo.run(
      "UPDATE security_login_challenges SET expires_at=?",
      Date.now() - 1,
    );
    assert.equal(
      (
        await challenger.request("/auth/2fa/challenge", "POST", {
          code: codes[0],
        })
      ).status,
      401,
    );
    await challenger.request("/auth/login", "POST", {
      email: credentials.email,
      password: credentials.password,
    });
    for (let attempt = 0; attempt < 5; attempt++)
      assert.equal(
        (
          await challenger.request("/auth/2fa/challenge", "POST", {
            code: "not-valid",
          })
        ).status,
        400,
      );
    assert.equal(
      (
        await challenger.request("/auth/2fa/challenge", "POST", {
          code: codes[0],
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await client().request("/auth/login", "POST", {
          email: credentials.email,
          password: credentials.password,
        })
      ).status,
      429,
      "New challenge cannot reset the account attempt limit",
    );
    runtime.repo.run(
      "UPDATE account_security SET factor_window=?",
      Date.now() - 16 * 60_000,
    );
    await challenger.request("/auth/login", "POST", {
      email: credentials.email,
      password: credentials.password,
    });
    const changed = await owner.request("/auth/password", "PATCH", {
      currentPassword: credentials.password,
      newPassword: "changed-password-456",
    });
    assert.equal(changed.status, 204);
    assert.equal(
      (
        await challenger.request("/auth/2fa/challenge", "POST", {
          code: codes[0],
        })
      ).status,
      401,
    );
    const fresh = await challenger.request("/auth/login", "POST", {
      email: credentials.email,
      password: "changed-password-456",
    });
    assert.equal((await fresh.json()).twoFactorRequired, true);
    assert.equal(
      (
        await challenger.request("/auth/2fa/challenge", "POST", {
          code: codes[0],
        })
      ).status,
      200,
    );
  }));

test("device inventory hides credentials, scopes revocation to the account and disconnects the target socket", async () =>
  fixture(async ({ runtime, base, client }) => {
    const owner = client();
    const second = client();
    const outsider = client();
    await owner.request("/auth/register", "POST", credentials);
    await second.request("/auth/login", "POST", {
      email: credentials.email,
      password: credentials.password,
    });
    await outsider.request("/auth/register", "POST", {
      ...credentials,
      email: "outsider@example.invalid",
      workspaceName: "Other team",
    });
    const inventory = await (await owner.request("/account/sessions")).json();
    assert.equal(inventory.sessions.length, 2);
    const current = inventory.sessions.find((session: any) => session.current);
    const other = inventory.sessions.find((session: any) => !session.current);
    assert.ok(current);
    assert.match(other.device, /Chrome.*Windows/);
    const serialized = JSON.stringify(inventory);
    for (const token of owner.cookies.values())
      assert.equal(serialized.includes(token), false);
    assert.equal(
      serialized.includes(sha(second.cookies.get("mola_session")!)),
      false,
    );
    assert.equal(
      (await outsider.request(`/account/sessions/${other.id}/revoke`, "POST"))
        .status,
      404,
    );
    assert.equal(
      (await owner.request(`/account/sessions/${current.id}/revoke`, "POST"))
        .status,
      400,
    );
    const socket = connect(base, {
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: {
        Origin: ORIGIN,
        Cookie: `mola_session=${second.cookies.get("mola_session")}`,
      },
    });
    try {
      await new Promise<void>((done, reject) => {
        socket.once("connect", done);
        socket.once("connect_error", reject);
      });
      const disconnected = new Promise<void>((done) =>
        socket.once("disconnect", () => done()),
      );
      assert.equal(
        (await owner.request(`/account/sessions/${other.id}/revoke`, "POST"))
          .status,
        204,
      );
      await disconnected;
      assert.equal((await second.request("/auth/me")).status, 401);
      assert.equal((await owner.request("/auth/me")).status, 200);
      assert.equal(
        runtime.repo.get("SELECT count(*) AS n FROM session_devices")!.n,
        2,
      );
    } finally {
      socket.disconnect();
    }
  }));

test("setup proof is session-bound, expires and cannot survive a password change", async () =>
  fixture(async ({ runtime, client }) => {
    const owner = client();
    const other = client();
    await owner.request("/auth/register", "POST", credentials);
    await other.request("/auth/login", "POST", {
      email: credentials.email,
      password: credentials.password,
    });
    const first = await (
      await owner.request("/account/security/setup", "POST", {
        password: credentials.password,
      })
    ).json();
    assert.equal(
      (
        await other.request("/account/security/enable", "POST", {
          code: totpCode(decode32(first.secret), Date.now()),
        })
      ).status,
      400,
    );
    runtime.repo.run(
      "UPDATE account_security SET pending_expires=?",
      Date.now() - 1,
    );
    assert.equal(
      (
        await owner.request("/account/security/enable", "POST", {
          code: totpCode(decode32(first.secret), Date.now()),
        })
      ).status,
      400,
    );
    const second = await (
      await owner.request("/account/security/setup", "POST", {
        password: credentials.password,
      })
    ).json();
    await owner.request("/auth/password", "PATCH", {
      currentPassword: credentials.password,
      newPassword: "changed-password-456",
    });
    assert.equal(
      (
        await owner.request("/account/security/enable", "POST", {
          code: totpCode(decode32(second.secret), Date.now()),
        })
      ).status,
      400,
    );
    assert.equal(
      (await (await owner.request("/account/security")).json()).enabled,
      false,
    );
  }));
