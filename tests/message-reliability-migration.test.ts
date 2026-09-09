import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { openDatabase, Repository } from "../server/db.js";
import { createWorkspace } from "../server/seed.js";

function legacy(path: string) {
  const repo = new Repository(openDatabase(path));
  const created = createWorkspace(repo, {
    name: "Existing workspace",
    userName: "Owner",
    email: "existing@migration.test",
    passwordHash: "preserved",
  });
  const channel = repo.channels(created.userId, created.workspaceId)[0].id,
    message = randomUUID();
  repo.run(
    "INSERT INTO messages(id,channel_id,user_id,content,created_at) VALUES(?,?,?,?,?)",
    message,
    channel,
    created.userId,
    "Existing history",
    "2026-01-01T00:00:00.000Z",
  );
  repo.run(
    "INSERT INTO message_drafts VALUES(?,?,?,?,?,?)",
    created.userId,
    channel,
    "",
    "Existing draft",
    12,
    "2026-01-02T00:00:00.000Z",
  );
  repo.run(
    "INSERT INTO sessions(token_hash,user_id,expires_at,workspace_id) VALUES('existing-session',?,?,?)",
    created.userId,
    Date.now() + 600000,
    created.workspaceId,
  );
  repo.run(
    "INSERT INTO saved_messages(user_id,workspace_id,message_id,saved_at) VALUES(?,?,?,?)",
    created.userId,
    created.workspaceId,
    message,
    "2026-01-03T00:00:00.000Z",
  );
  repo.db.exec(
    "DROP TABLE message_requests; DROP TABLE draft_attachments; DROP TRIGGER deleted_thread_drafts; PRAGMA user_version=8;",
  );
  const snapshot = Object.fromEntries(
    [
      "users",
      "workspace_members",
      "sessions",
      "messages",
      "message_drafts",
      "saved_messages",
    ].map((table) => [table, repo.all(`SELECT * FROM ${table}`)]),
  );
  repo.close();
  return { ...created, channel, message, snapshot };
}

test("v8 migration preserves text drafts and saved history, persists request tombstones and cascades thread draft references", () => {
  const directory = mkdtempSync(join(tmpdir(), "mola-v9-migration-")),
    path = join(directory, "mola.sqlite");
  let repo: Repository | undefined;
  try {
    const old = legacy(path);
    repo = new Repository(openDatabase(path));
    assert.equal(repo.get("PRAGMA user_version")!.user_version, 9);
    for (const [table, rows] of Object.entries(old.snapshot))
      assert.deepEqual(repo.all(`SELECT * FROM ${table}`), rows, table);
    assert.equal(repo.get("SELECT COUNT(*) n FROM message_requests")!.n, 0);
    assert.equal(repo.get("SELECT COUNT(*) n FROM draft_attachments")!.n, 0);
    const key = randomUUID(),
      missingFile = randomUUID();
    repo.run(
      "INSERT INTO message_requests VALUES(?,?,?,?,?,?)",
      old.userId,
      old.workspaceId,
      key,
      "payload-digest",
      old.message,
      "2026-01-04T00:00:00.000Z",
    );
    repo.run(
      "INSERT INTO message_drafts VALUES(?,?,?,?,?,?)",
      old.userId,
      old.channel,
      old.message,
      "Thread draft",
      1,
      "now",
    );
    // Reference rows intentionally survive missing files so clients can explain the loss.
    repo.run(
      "INSERT INTO draft_attachments VALUES(?,?,?,?,?)",
      old.userId,
      old.channel,
      "",
      missingFile,
      0,
    );
    repo.run(
      "INSERT INTO draft_attachments VALUES(?,?,?,?,?)",
      old.userId,
      old.channel,
      old.message,
      missingFile,
      0,
    );
    assert.deepEqual(repo.all("PRAGMA foreign_key_check"), []);
    repo.run("DELETE FROM messages WHERE id=?", old.message);
    assert.equal(
      repo.get(
        "SELECT message_id FROM message_requests WHERE client_message_id=?",
        key,
      )!.message_id,
      null,
    );
    assert.equal(
      repo.get(
        "SELECT COUNT(*) n FROM draft_attachments WHERE parent_key=?",
        old.message,
      )!.n,
      0,
    );
    assert.equal(
      repo.get(
        "SELECT COUNT(*) n FROM draft_attachments WHERE parent_key='' AND attachment_id=?",
        missingFile,
      )!.n,
      1,
    );
    repo.close();
    repo = new Repository(openDatabase(path));
    assert.equal(
      repo.get(
        "SELECT message_id FROM message_requests WHERE client_message_id=?",
        key,
      )!.message_id,
      null,
    );
    assert.equal(
      repo.get("SELECT content FROM message_drafts WHERE parent_key=''")!
        .content,
      "Existing draft",
    );
    repo.run("DELETE FROM workspaces WHERE id=?", old.workspaceId);
    assert.equal(repo.get("SELECT COUNT(*) n FROM message_requests")!.n, 0);
    assert.equal(repo.get("SELECT COUNT(*) n FROM draft_attachments")!.n, 0);
    assert.deepEqual(repo.all("PRAGMA foreign_key_check"), []);
  } finally {
    repo?.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a failed v9 reference check rolls back every new table and trigger while preserving the original v8 data", () => {
  const directory = mkdtempSync(join(tmpdir(), "mola-v9-rollback-")),
    path = join(directory, "mola.sqlite");
  try {
    const old = legacy(path);
    const corrupt = new DatabaseSync(path);
    corrupt.exec("PRAGMA foreign_keys=OFF");
    corrupt
      .prepare("INSERT INTO channel_members VALUES(?,?)")
      .run(old.channel, randomUUID());
    corrupt.close();
    assert.throws(
      () => openDatabase(path),
      /Message reliability migration found invalid references/,
    );
    const db = new DatabaseSync(path);
    try {
      assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 8);
      assert.deepEqual(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE name IN ('message_requests','draft_attachments','deleted_thread_drafts')",
          )
          .all(),
        [],
      );
      for (const [table, rows] of Object.entries(old.snapshot))
        assert.deepEqual(
          db.prepare(`SELECT * FROM ${table}`).all(),
          rows,
          table,
        );
    } finally {
      db.close();
    }
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
  }
});
