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
    name: "Migrated saved team",
    userName: "Owner",
    email: "saved-migration@test.invalid",
    passwordHash: "unchanged-hash",
  });
  const channel = repo.channels(created.userId, created.workspaceId)[0];
  const message = randomUUID();
  repo.run(
    "INSERT INTO messages(id,channel_id,user_id,content,created_at) VALUES(?,?,?,?,?)",
    message,
    channel.id,
    created.userId,
    "Existing history",
    "2026-01-01T00:00:00.000Z",
  );
  repo.run(
    "INSERT INTO sessions(token_hash,user_id,expires_at,workspace_id) VALUES('migration-session',?,?,?)",
    created.userId,
    Date.now() + 600_000,
    created.workspaceId,
  );
  repo.db.exec(
    "DROP TRIGGER saved_messages_workspace; DROP TABLE saved_messages; PRAGMA user_version=7;",
  );
  const history = repo.all("SELECT * FROM messages"),
    sessions = repo.all("SELECT * FROM sessions"),
    members = repo.all("SELECT * FROM workspace_members");
  repo.close();
  return { ...created, message, channel, history, sessions, members };
}

test("v7 to v8 preserves accounts, sessions and history, then persists personal saves across reopening", () => {
  const directory = mkdtempSync(join(tmpdir(), "mola-v8-migration-")),
    path = join(directory, "mola.sqlite");
  let repo: Repository | undefined;
  try {
    const previous = legacy(path);
    repo = new Repository(openDatabase(path));
    assert.equal(repo.get("PRAGMA user_version")!.user_version, 8);
    assert.deepEqual(repo.all("SELECT * FROM messages"), previous.history);
    assert.deepEqual(repo.all("SELECT * FROM sessions"), previous.sessions);
    assert.deepEqual(
      repo.all("SELECT * FROM workspace_members"),
      previous.members,
    );
    assert.equal(
      repo.get("SELECT password_hash FROM users WHERE id=?", previous.userId)!
        .password_hash,
      "unchanged-hash",
    );
    assert.equal(repo.get("SELECT COUNT(*) AS n FROM saved_messages")!.n, 0);
    repo.run(
      "INSERT INTO saved_messages(user_id,workspace_id,message_id,saved_at) VALUES(?,?,?,?)",
      previous.userId,
      previous.workspaceId,
      previous.message,
      "2026-01-02T00:00:00.000Z",
    );
    const saved = repo.all("SELECT * FROM saved_messages");
    assert.deepEqual(repo.all("PRAGMA foreign_key_check"), []);
    repo.close();
    repo = new Repository(openDatabase(path));
    assert.deepEqual(repo.all("SELECT * FROM saved_messages"), saved);
    assert.deepEqual(repo.all("SELECT * FROM messages"), previous.history);
    assert.throws(
      () =>
        repo!.run(
          "INSERT INTO saved_messages(user_id,workspace_id,message_id,saved_at) VALUES(?,?,?,?)",
          previous.userId,
          previous.workspaceId,
          previous.message,
          "now",
        ),
      /UNIQUE/,
    );
    repo.run("DELETE FROM messages WHERE id=?", previous.message);
    assert.equal(repo.get("SELECT COUNT(*) AS n FROM saved_messages")!.n, 0);
    assert.deepEqual(repo.all("PRAGMA foreign_key_check"), []);
  } finally {
    repo?.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a failed v8 reference check rolls back the saved schema without changing the v7 database", () => {
  const directory = mkdtempSync(join(tmpdir(), "mola-v8-rollback-")),
    path = join(directory, "mola.sqlite");
  try {
    const previous = legacy(path);
    const corrupt = new DatabaseSync(path);
    corrupt.exec("PRAGMA foreign_keys=OFF");
    corrupt
      .prepare("INSERT INTO channel_members(channel_id,user_id) VALUES(?,?)")
      .run(previous.channel.id, randomUUID());
    corrupt.close();
    assert.throws(
      () => openDatabase(path),
      /Saved messages migration found invalid references/,
    );
    const unchanged = new DatabaseSync(path);
    try {
      assert.equal(
        unchanged.prepare("PRAGMA user_version").get()!.user_version,
        7,
      );
      assert.equal(
        unchanged
          .prepare("SELECT name FROM sqlite_master WHERE name='saved_messages'")
          .get(),
        undefined,
      );
      assert.equal(
        unchanged
          .prepare(
            "SELECT name FROM sqlite_master WHERE name='saved_messages_workspace'",
          )
          .get(),
        undefined,
      );
      assert.deepEqual(
        unchanged.prepare("SELECT * FROM messages").all(),
        previous.history,
      );
      assert.deepEqual(
        unchanged.prepare("SELECT * FROM sessions").all(),
        previous.sessions,
      );
    } finally {
      unchanged.close();
    }
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
  }
});
