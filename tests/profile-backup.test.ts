import { restoreLegacyNotificationSchema } from "./notification-migration-fixture.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  rmdir,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import { createApp } from "../server/app.js";
// @ts-expect-error Operational scripts run directly under Node.
import { runBackup, verifyBackup } from "../scripts/backup-runner.mjs";

const origin = "http://profile-backup.test";
async function fixture(
  run: (context: {
    runtime: ReturnType<typeof createApp>;
    directory: string;
    source: string;
    base: string;
    cookie: string;
    token: string;
    channelId: string;
    upload: (color: string) => Promise<{ avatarUrl: string }>;
  }) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "mola-profile-backup-"));
  const source = join(directory, "data");
  const runtime = createApp({
    dataDir: source,
    appOrigin: origin,
    production: false,
    requireEmailVerification: false,
    mailTransport: async () => {},
    mailEncryptionKey: "6".repeat(64),
  });
  await new Promise<void>((done) =>
    runtime.server.listen(0, "127.0.0.1", done),
  );
  const base = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
  try {
    const response = await fetch(base + "/api/auth/demo", {
      method: "POST",
      headers: { Origin: origin },
    });
    assert.equal(response.status, 200);
    const state = await response.json();
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    const token = (await readFile(join(source, ".ops-token"), "utf8")).trim();
    const upload = async (color: string) => {
      const bytes = await sharp({
        create: { width: 700, height: 600, channels: 3, background: color },
      })
        .png()
        .toBuffer();
      const body = new FormData();
      body.set(
        "file",
        new Blob([new Uint8Array(bytes)], { type: "image/png" }),
        "photo.png",
      );
      const response = await fetch(base + "/api/profile/avatar", {
        method: "POST",
        headers: { Origin: origin, Cookie: cookie },
        body,
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    await run({
      runtime,
      directory,
      source,
      base,
      cookie,
      token,
      channelId: state.channels[0].id,
      upload,
    });
  } finally {
    await runtime.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory, { recursive: true, force: true });
  }
}

test("full backup includes current avatars, survives live replacement, and restores usable profile photos", async () =>
  fixture(
    async ({ directory, source, base, cookie, token, channelId, upload }) => {
      const first = await upload("#326f58");
      const firstBytes = Buffer.from(
        await (
          await fetch(base + first.avatarUrl, { headers: { Cookie: cookie } })
        ).arrayBuffer(),
      );
      const snapshotResponse = await fetch(base + "/internal/snapshots", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(snapshotResponse.status, 201);
      const snapshot = await snapshotResponse.json();
      assert.equal(snapshot.files, 1);
      const snapshotPath = join(source, "snapshots", snapshot.id);
      const oldPath = `uploads/avatars/${first.avatarUrl.split("/").at(-1)}.webp`;
      const second = await upload("#ce762c");
      assert.equal(
        (await fetch(base + first.avatarUrl, { headers: { Cookie: cookie } }))
          .status,
        404,
      );
      assert.deepEqual(
        await readFile(join(snapshotPath, oldPath)),
        firstBytes,
        "the immutable snapshot retains the replaced photo",
      );
      assert.equal((await verifyBackup(snapshotPath)).files, 1);
      const form = new FormData();
      form.set(
        "file",
        new Blob(["Keep this attachment"], { type: "text/plain" }),
        "keep.txt",
      );
      const attached = await fetch(base + "/api/uploads", {
        method: "POST",
        headers: { Origin: origin, Cookie: cookie },
        body: form,
      });
      assert.equal(attached.status, 201);
      const attachment = await attached.json();
      const posted = await fetch(base + `/api/channels/${channelId}/messages`, {
        method: "POST",
        headers: {
          Origin: origin,
          Cookie: cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: "Backup both file kinds",
          attachmentIds: [attachment.id],
        }),
      });
      assert.equal(posted.status, 201);
      const profile = await fetch(base + "/api/profile", {
        method: "PATCH",
        headers: {
          Origin: origin,
          Cookie: cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bio: "This biography survives restoration",
          jobTitle: "Designer",
        }),
      });
      assert.equal(profile.status, 200);
      const currentBytes = Buffer.from(
        await (
          await fetch(base + second.avatarUrl, { headers: { Cookie: cookie } })
        ).arrayBuffer(),
      );
      const backup = await runBackup({
        source,
        target: join(directory, "backups"),
        app: base,
        token,
        keep: 2,
      });
      const backupPath = join(directory, "backups", backup.name);
      const verified = await verifyBackup(backupPath, {
        requireChecksums: true,
      });
      assert.equal(verified.files, 2);
      const avatarPath = `uploads/avatars/${second.avatarUrl.split("/").at(-1)}.webp`;
      assert.equal(
        verified.checksums[avatarPath],
        createHash("sha256").update(currentBytes).digest("hex"),
      );
      assert.equal(
        verified.checksums[oldPath],
        undefined,
        "only the current account pointer is backed up",
      );
      const restoredPath = join(directory, "restored");
      const restore = spawnSync(
        process.execPath,
        ["scripts/restore-backup.mjs", backupPath, restoredPath],
        { encoding: "utf8" },
      );
      assert.equal(restore.status, 0, restore.stderr);
      const restored = createApp({
        dataDir: restoredPath,
        appOrigin: origin,
        production: false,
        requireEmailVerification: false,
        mailTransport: async () => {},
        mailEncryptionKey: "6".repeat(64),
      });
      try {
        await new Promise<void>((done) =>
          restored.server.listen(0, "127.0.0.1", done),
        );
        const restoredBase = `http://127.0.0.1:${(restored.server.address() as AddressInfo).port}`;
        const image = await fetch(restoredBase + second.avatarUrl, {
          headers: { Cookie: cookie },
        });
        assert.equal(image.status, 200);
        assert.deepEqual(Buffer.from(await image.arrayBuffer()), currentBytes);
        const me = await (
          await fetch(restoredBase + "/api/auth/me", {
            headers: { Cookie: cookie },
          })
        ).json();
        assert.equal(me.user.bio, "This biography survives restoration");
        assert.equal(me.user.jobTitle, "Designer");
        assert.equal(me.user.avatarUrl, second.avatarUrl);
        assert.equal(
          await (
            await fetch(restoredBase + attachment.url, {
              headers: { Cookie: cookie },
            })
          ).text(),
          "Keep this attachment",
        );
      } finally {
        await restored.close();
      }
      const corrupt = Buffer.from(currentBytes);
      corrupt[corrupt.length - 1] ^= 1;
      await writeFile(join(backupPath, avatarPath), corrupt);
      await assert.rejects(
        verifyBackup(backupPath, { requireChecksums: true }),
        /checksum mismatch: uploads\/avatars\//i,
      );
      const blockedRestore = spawnSync(
        process.execPath,
        [
          "scripts/restore-backup.mjs",
          backupPath,
          join(directory, "corrupt-restore"),
        ],
        { encoding: "utf8" },
      );
      assert.notEqual(blockedRestore.status, 0);
      assert.deepEqual(
        Buffer.from(
          await (
            await fetch(base + second.avatarUrl, {
              headers: { Cookie: cookie },
            })
          ).arrayBuffer(),
        ),
        currentBytes,
        "corrupting a backup does not alter the live photo",
      );
    },
  ));

test("backup verification rejects missing, unrelated and nested avatar files", async () =>
  fixture(async ({ directory, source, base, token, upload }) => {
    const user = await upload("#335577");
    const backup = await runBackup({
      source,
      target: join(directory, "backups"),
      app: base,
      token,
      keep: 2,
    });
    const path = join(directory, "backups", backup.name);
    const avatars = join(path, "uploads", "avatars");
    const extra = join(avatars, `${randomUUID()}.webp`);
    await writeFile(extra, "unknown");
    await assert.rejects(
      verifyBackup(path, { requireChecksums: true }),
      /Unexpected backup upload files/,
    );
    await rm(extra);
    await mkdir(join(avatars, "nested"));
    await assert.rejects(verifyBackup(path), /Invalid backup avatar entry/);
    await rmdir(join(avatars, "nested"));
    await writeFile(join(avatars, "portrait.png"), "unrecognized");
    await assert.rejects(verifyBackup(path), /Invalid backup avatar entry/);
    await rm(join(avatars, "portrait.png"));
    await rm(join(avatars, `${user.avatarUrl.split("/").at(-1)}.webp`));
    await assert.rejects(
      verifyBackup(path, { requireChecksums: true }),
      /ENOENT/,
    );
  }));

test("pre-v6 backups without avatar schema remain verifiable and restorable", async () =>
  fixture(async ({ directory, source, base, token }) => {
    const backup = await runBackup({
      source,
      target: join(directory, "backups"),
      app: base,
      token,
      keep: 2,
    });
    const path = join(directory, "backups", backup.name);
    const db = new DatabaseSync(join(path, "mola.sqlite"));
    restoreLegacyNotificationSchema(db);
    db.exec(
      "DROP TABLE message_requests; DROP TABLE draft_attachments; DROP TRIGGER deleted_thread_drafts; DROP TABLE saved_messages; ALTER TABLE users DROP COLUMN job_title; ALTER TABLE users DROP COLUMN bio; ALTER TABLE users DROP COLUMN location; ALTER TABLE users DROP COLUMN avatar_version; PRAGMA user_version=5;",
    );
    db.close();
    await rm(join(path, "checksums.json"));
    const verified = await verifyBackup(path);
    assert.equal(verified.files, 0);
    await writeFile(
      join(path, "checksums.json"),
      JSON.stringify(verified.checksums),
    );
    assert.equal(
      (await verifyBackup(path, { requireChecksums: true })).files,
      0,
    );
    const destination = join(directory, "old-restored");
    const restored = spawnSync(
      process.execPath,
      ["scripts/restore-backup.mjs", path, destination],
      { encoding: "utf8" },
    );
    assert.equal(restored.status, 0, restored.stderr);
    assert.deepEqual(await readdir(join(destination, "uploads")), []);
    const oldDb = new DatabaseSync(join(destination, "mola.sqlite"), {
      readOnly: true,
    });
    try {
      assert.equal(oldDb.prepare("PRAGMA user_version").get()!.user_version, 5);
    } finally {
      oldDb.close();
    }
  }));
