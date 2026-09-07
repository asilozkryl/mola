import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.js";
import { totpCode } from "../server/account-security.js";
// @ts-expect-error Operational scripts run directly under Node.
import { runBackup, verifyBackup } from "../scripts/backup-runner.mjs";

function decode32(value: string): Buffer {
  let bits = 0,
    accumulator = 0;
  const bytes: number[] = [];
  for (const c of value) {
    accumulator =
      (accumulator << 5) | "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(c);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >> bits) & 255);
    }
  }
  return Buffer.from(bytes);
}

test("full backup checksums and restores the fallback security key with usable MFA and GitHub secrets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mola-security-backup-"));
  const source = join(directory, "data");
  const target = join(directory, "backups");
  const restored = join(directory, "restored");
  const origin = "http://backup-security.test";
  const runtime = createApp({
    dataDir: source,
    appOrigin: origin,
    production: false,
    requireEmailVerification: false,
    mailTransport: async () => {},
  });
  let restoredRuntime: ReturnType<typeof createApp> | undefined;
  await new Promise<void>((done) =>
    runtime.server.listen(0, "127.0.0.1", done),
  );
  const base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
  const cookies = new Map<string, string>();
  const request = async (
    base: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const response = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
        Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0];
      const index = pair.indexOf("=");
      const value = pair.slice(index + 1);
      if (value) cookies.set(pair.slice(0, index), value);
      else cookies.delete(pair.slice(0, index));
    }
    return response;
  };
  try {
    const credentials = {
      name: "Backup Owner",
      email: "backup@security.test",
      password: "backup-password-123",
      workspaceName: "Backup team",
    };
    const registered = await request(base, "/api/auth/register", credentials);
    assert.equal(registered.status, 200);
    const state = await registered.json();
    const setup = await (
      await request(base, "/api/account/security/setup", {
        password: credentials.password,
      })
    ).json();
    const enabled = await request(base, "/api/account/security/enable", {
      code: totpCode(decode32(setup.secret), Date.now()),
    });
    assert.equal(enabled.status, 200);
    const integration = await (
      await request(base, "/api/integrations", {
        name: "Backup GitHub",
        kind: "github",
        channelId: state.channels.find(
          (channel: any) => channel.name === "genel",
        ).id,
        repository: "owner/backup",
      })
    ).json();
    assert.match(integration.secret, /^[a-f0-9]{64}$/);
    const master = await readFile(join(source, ".account-security-key"));
    assert.equal(master.length, 32);
    const opsToken = (
      await readFile(join(source, ".ops-token"), "utf8")
    ).trim();
    const completed = await runBackup({
      source,
      target,
      app: base,
      token: opsToken,
      keep: 1,
    });
    const backup = join(target, completed.name);
    const verified = await verifyBackup(backup, { requireChecksums: true });
    assert.equal(
      verified.checksums[".account-security-key"],
      createHash("sha256").update(master).digest("hex"),
    );
    assert.deepEqual(
      await readFile(join(backup, ".account-security-key")),
      master,
    );
    const restore = spawnSync(
      process.execPath,
      ["scripts/restore-backup.mjs", backup, restored],
      { encoding: "utf8" },
    );
    assert.equal(restore.status, 0, restore.stderr);
    assert.deepEqual(
      await readFile(join(restored, ".account-security-key")),
      master,
    );
    restoredRuntime = createApp({
      dataDir: restored,
      appOrigin: origin,
      production: false,
      requireEmailVerification: false,
      mailTransport: async () => {},
    });
    await new Promise<void>((done) =>
      restoredRuntime!.server.listen(0, "127.0.0.1", done),
    );
    const restoredBase = `http://127.0.0.1:${(restoredRuntime.server.address() as AddressInfo).port}`;
    cookies.clear();
    const challenge = await request(restoredBase, "/api/auth/login", {
      email: credentials.email,
      password: credentials.password,
    });
    assert.equal((await challenge.json()).twoFactorRequired, true);
    const login = await request(restoredBase, "/api/auth/2fa/challenge", {
      code: totpCode(decode32(setup.secret), Date.now() + 30000),
    });
    assert.equal(login.status, 200);
    assert.equal((await login.json()).user.id, state.user.id);
    const payload = JSON.stringify({
      repository: { full_name: "owner/backup" },
      sender: { login: "test" },
      ref: "refs/heads/main",
      commits: [{ message: "Restored webhook works" }],
    });
    const delivery = await fetch(
      restoredBase + `/api/hooks/${integration.id}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-github-event": "push",
          "x-github-delivery": randomUUID(),
          "x-hub-signature-256":
            "sha256=" +
            createHmac("sha256", integration.secret)
              .update(payload)
              .digest("hex"),
        },
        body: payload,
      },
    );
    assert.equal(delivery.status, 201);
    await writeFile(join(backup, ".account-security-key"), Buffer.alloc(32, 7));
    await assert.rejects(
      verifyBackup(backup, { requireChecksums: true }),
      /checksum mismatch: .account-security-key/,
    );
  } finally {
    await restoredRuntime?.close();
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});
