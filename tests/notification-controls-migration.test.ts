import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { openDatabase, Repository } from "../server/db.js";
import { createWorkspace } from "../server/seed.js";
import { restoreLegacyNotificationSchema } from "./notification-migration-fixture.js";
function legacy(path: string) {
  const repo = new Repository(openDatabase(path)),
    created = createWorkspace(repo, {
      name: "Existing notification workspace",
      userName: "Owner",
      email: "migration@notification.test",
      passwordHash: "unchanged",
    });
  const channel = repo.channels(created.userId, created.workspaceId)[0].id,
    message = randomUUID(),
    notification = randomUUID(),
    subscription = randomUUID(),
    job = randomUUID(),
    now = Date.now();
  repo.run(
    "INSERT INTO messages VALUES(?,?,?,?,?,NULL,NULL,0)",
    message,
    channel,
    created.userId,
    "Preserved history",
    new Date(now).toISOString(),
  );
  repo.run(
    "INSERT INTO sessions(token_hash,user_id,workspace_id,expires_at) VALUES('existing-session',?,?,?)",
    created.userId,
    created.workspaceId,
    now + 600000,
  );
  repo.run("INSERT INTO notification_preferences VALUES(?,1)", created.userId);
  repo.run(
    "INSERT INTO notifications VALUES(?,?,?,?,?,'mention',?,NULL)",
    notification,
    created.userId,
    created.workspaceId,
    channel,
    message,
    new Date(now).toISOString(),
  );
  repo.run(
    "INSERT INTO push_subscriptions VALUES(?,?, 'existing-session',?,?,?,?)",
    subscription,
    created.userId,
    "https://fcm.googleapis.com/fake-retained",
    "fake-key",
    "fake-auth",
    new Date(now).toISOString(),
  );
  repo.run(
    "INSERT INTO push_outbox(id,notification_id,subscription_id,attempts,next_attempt) VALUES(?,?,?,2,?)",
    job,
    notification,
    subscription,
    now + 600000,
  );
  restoreLegacyNotificationSchema(repo.db);
  repo.db.exec("PRAGMA user_version=9;");
  const snapshots = Object.fromEntries(
    [
      "users",
      "workspace_members",
      "sessions",
      "messages",
      "notifications",
      "notification_preferences",
      "push_subscriptions",
      "push_outbox",
    ].map((table) => [table, repo.all(`SELECT * FROM ${table}`)]),
  );
  repo.close();
  return {
    ...created,
    channel,
    message,
    notification,
    subscription,
    job,
    now,
    snapshots,
  };
}
test("v10 preserves queued work, attempts, subscriptions and raw activity while adding nullable job sources and scoped settings", () => {
  const dir = mkdtempSync(join(tmpdir(), "mola-notifications-v10-")),
    path = join(dir, "mola.sqlite");
  let repo: Repository | undefined;
  try {
    const old = legacy(path);
    repo = new Repository(openDatabase(path));
    assert.equal(repo.get("PRAGMA user_version")!.user_version, 10);
    for (const [table, rows] of Object.entries(old.snapshots))
      assert.deepEqual(
        repo.all(
          `SELECT ${table === "push_outbox" ? "id,notification_id,subscription_id,attempts,next_attempt" : "*"} FROM ${table}`,
        ),
        rows,
        table,
      );
    assert.equal(
      repo.get("SELECT COUNT(*) n FROM notification_policies")!.n,
      0,
    );
    assert.equal(repo.get("SELECT COUNT(*) n FROM push_diagnostics")!.n, 0);
    const diag = randomUUID();
    repo.run(
      "INSERT INTO push_diagnostics(id,user_id,workspace_id,session_hash,subscription_id,created_at,updated_at) VALUES(?,?,?,'existing-session',?,?,?)",
      diag,
      old.userId,
      old.workspaceId,
      old.subscription,
      old.now,
      old.now,
    );
    repo.run(
      "INSERT INTO push_outbox(id,subscription_id,next_attempt,diagnostic_id) VALUES(?,?,?,?)",
      randomUUID(),
      old.subscription,
      old.now,
      diag,
    );
    assert.throws(
      () =>
        repo!.run(
          "INSERT INTO push_outbox(id,subscription_id,next_attempt,diagnostic_id,message_id) VALUES(?,?,?,?,?)",
          randomUUID(),
          old.subscription,
          old.now,
          diag,
          old.message,
        ),
      /CHECK|UNIQUE/,
    );
    repo.close();
    repo = new Repository(openDatabase(path));
    assert.equal(
      repo.get("SELECT attempts FROM push_outbox WHERE id=?", old.job)!
        .attempts,
      2,
    );
    repo.run("DELETE FROM push_subscriptions WHERE id=?", old.subscription);
    assert.equal(repo.get("SELECT COUNT(*) n FROM push_outbox")!.n, 0);
    const stopped = repo.get(
      "SELECT * FROM push_diagnostics WHERE id=?",
      diag,
    )!;
    assert.equal(stopped.status, "failed");
    assert.equal(stopped.reason_code, "DEVICE_UNAVAILABLE");
    assert.equal(stopped.subscription_id, null);
    assert.equal(repo.get("SELECT COUNT(*) n FROM notifications")!.n, 1);
    assert.deepEqual(repo.all("PRAGMA foreign_key_check"), []);
    repo.run("DELETE FROM workspaces WHERE id=?", old.workspaceId);
    assert.equal(repo.get("SELECT COUNT(*) n FROM push_diagnostics")!.n, 0);
    assert.deepEqual(repo.all("PRAGMA foreign_key_check"), []);
  } finally {
    repo?.close();
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
    rmSync(dir, { recursive: true, force: true });
  }
});
test("failed v10 migration rolls back queue rebuilding, indexes and new tables without consuming or mutating old deliveries", () => {
  const dir = mkdtempSync(join(tmpdir(), "mola-notifications-v10-fail-")),
    path = join(dir, "mola.sqlite");
  try {
    const old = legacy(path),
      corrupt = new DatabaseSync(path);
    corrupt.exec("PRAGMA foreign_keys=OFF");
    corrupt
      .prepare("INSERT INTO channel_members VALUES(?,?)")
      .run(old.channel, randomUUID());
    corrupt.close();
    assert.throws(
      () => openDatabase(path),
      /Notification controls migration found invalid references/,
    );
    const db = new DatabaseSync(path);
    try {
      assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 9);
      for (const [table, rows] of Object.entries(old.snapshots))
        assert.deepEqual(
          db.prepare(`SELECT * FROM ${table}`).all(),
          rows,
          table,
        );
      assert.deepEqual(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE name IN ('notification_policies','channel_notification_preferences','push_diagnostics','push_delivery_metrics','push_outbox_previous','push_diagnostic_subscription_removed')",
          )
          .all(),
        [],
      );
      assert.ok(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE name='idx_push_outbox_pending'",
          )
          .get(),
      );
    } finally {
      db.close();
    }
  } finally {
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
    rmSync(dir, { recursive: true, force: true });
  }
});
