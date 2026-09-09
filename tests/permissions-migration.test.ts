import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, Repository } from '../server/db.js';

function legacy(path: string) {
  const db = new DatabaseSync(path); const now = new Date().toISOString();
  db.exec(`CREATE TABLE workspaces(id TEXT PRIMARY KEY,name TEXT NOT NULL,is_demo INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,suspended_at TEXT);
    CREATE TABLE users(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,name TEXT NOT NULL,email TEXT NOT NULL COLLATE NOCASE UNIQUE,password_hash TEXT,color TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN('owner','member')),status TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,email_verified INTEGER NOT NULL DEFAULT 0,site_admin INTEGER NOT NULL DEFAULT 0,suspended_at TEXT);
    CREATE TABLE workspace_members(workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,role TEXT NOT NULL CHECK(role IN('owner','member')),joined_at TEXT NOT NULL,suspended_at TEXT,removed_at TEXT,PRIMARY KEY(workspace_id,user_id));
    CREATE INDEX idx_workspace_members_user ON workspace_members(user_id,removed_at);
    CREATE TRIGGER initial_user_membership AFTER INSERT ON users BEGIN INSERT INTO workspace_members(workspace_id,user_id,role,joined_at) VALUES(NEW.workspace_id,NEW.id,NEW.role,NEW.created_at); END;
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL,workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE);
    CREATE TRIGGER initial_session_workspace AFTER INSERT ON sessions WHEN NEW.workspace_id IS NULL BEGIN UPDATE sessions SET workspace_id=(SELECT workspace_id FROM users WHERE id=NEW.user_id) WHERE token_hash=NEW.token_hash; END;
    CREATE TABLE channels(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',kind TEXT NOT NULL CHECK(kind IN('text','voice','dm')),created_at TEXT NOT NULL,archived_at TEXT);
    CREATE TABLE channel_members(channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,PRIMARY KEY(channel_id,user_id));
    CREATE TABLE messages(id TEXT PRIMARY KEY,channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,content TEXT NOT NULL,created_at TEXT NOT NULL,edited_at TEXT,parent_id TEXT REFERENCES messages(id) ON DELETE CASCADE,pinned INTEGER NOT NULL DEFAULT 0);
    PRAGMA user_version=4;`);
  const workspace = randomUUID(); const second = randomUUID(); const owner = randomUUID(); const member = randomUUID(); const channel = randomUUID(); const dm = randomUUID(); const message = randomUUID();
  const insertWorkspace = db.prepare('INSERT INTO workspaces(id,name,created_at) VALUES (?,?,?)'); insertWorkspace.run(workspace, 'Original workspace', now); insertWorkspace.run(second, 'Second workspace', now);
  const insertUser = db.prepare('INSERT INTO users(id,workspace_id,name,email,password_hash,color,role,created_at,email_verified) VALUES (?,?,?,?,?,?,?,?,1)');
  insertUser.run(owner, workspace, 'Owner', 'owner@v4.test', 'preserved-secret-hash', '#abcdef', 'owner', now); insertUser.run(member, workspace, 'Member', 'member@v4.test', null, '#abcdef', 'member', now);
  db.prepare('INSERT INTO workspace_members VALUES (?,?,?,?,?,?)').run(second, owner, 'member', now, now, null);
  db.prepare('INSERT INTO workspace_members VALUES (?,?,?,?,?,?)').run(second, member, 'member', now, null, now);
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run('session-hash', owner, Date.now() + 600_000, workspace);
  db.prepare('INSERT INTO channels VALUES (?,?,?,?,?,?,?)').run(channel, workspace, 'General', 'Original description', 'text', now, null);
  db.prepare('INSERT INTO channels VALUES (?,?,?,?,?,?,?)').run(dm, workspace, 'Private conversation', '', 'dm', now, null);
  db.prepare('INSERT INTO channel_members VALUES (?,?)').run(dm, owner); db.prepare('INSERT INTO channel_members VALUES (?,?)').run(dm, member);
  db.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)').run(message, channel, owner, 'History survives permissions migration.', now, null, null, 1);
  return { db, workspace, second, owner, member, channel, dm, message, now };
}

test('v4 to v5 preserves memberships, sessions and history while adding role, privacy, security and collaboration schema', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mola-v5-migration-')); const path = join(directory, 'mola.sqlite'); let repo: Repository | undefined;
  try {
    const fixture = legacy(path); const previousMembers = fixture.db.prepare('SELECT workspace_id,user_id,role,joined_at,suspended_at,removed_at FROM workspace_members ORDER BY workspace_id,user_id').all(); const session = fixture.db.prepare('SELECT * FROM sessions').get(); fixture.db.close();
    repo = new Repository(openDatabase(path));
    assert.equal(repo.get('PRAGMA user_version')!.user_version, 8);
    assert.deepEqual(repo.all('SELECT workspace_id,user_id,role,joined_at,suspended_at,removed_at FROM workspace_members ORDER BY workspace_id,user_id'), previousMembers);
    assert.deepEqual(repo.get('SELECT * FROM sessions'), session);
    assert.equal(repo.get('SELECT content FROM messages WHERE id=?', fixture.message)!.content, 'History survives permissions migration.');
    assert.equal(repo.get('SELECT password_hash FROM users WHERE id=?', fixture.owner)!.password_hash, 'preserved-secret-hash');
    assert.equal(repo.channel(repo.get('SELECT * FROM channels WHERE id=?', fixture.channel)!).visibility, 'public');
    assert.equal(repo.channel(repo.get('SELECT * FROM channels WHERE id=?', fixture.dm)!).visibility, 'private');
    assert.deepEqual(new Set(repo.channel(repo.get('SELECT * FROM channels WHERE id=?', fixture.dm)!).memberIds), new Set([fixture.owner, fixture.member]));
    for (const table of ['account_security', 'session_devices', 'notifications', 'channel_reads', 'message_drafts', 'integrations']) assert.ok(repo.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", table));
    for (const role of ['admin', 'moderator', 'guest', 'member']) repo.run('UPDATE workspace_members SET role=? WHERE workspace_id=? AND user_id=?', role, fixture.workspace, fixture.member);
    assert.throws(() => repo!.run("UPDATE workspace_members SET role='superuser' WHERE user_id=?", fixture.member), /CHECK/);
    assert.deepEqual(repo.all('PRAGMA foreign_key_check'), []);
    repo.close(); repo = new Repository(openDatabase(path));
    assert.deepEqual(repo.all('SELECT workspace_id,user_id,role,joined_at,suspended_at,removed_at FROM workspace_members ORDER BY workspace_id,user_id'), previousMembers, 'opening again must preserve migrated rows');
  } finally { repo?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('failed v5 foreign-key validation rolls back permissions and feature migration atomically', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mola-v5-rollback-')); const path = join(directory, 'mola.sqlite');
  try {
    const fixture = legacy(path); fixture.db.exec('PRAGMA foreign_keys=OFF'); fixture.db.prepare('INSERT INTO channel_members VALUES (?,?)').run(fixture.channel, randomUUID()); fixture.db.close();
    assert.throws(() => openDatabase(path), /invalid references/);
    const untouched = new DatabaseSync(path);
    try {
      assert.equal(untouched.prepare('PRAGMA user_version').get()!.user_version, 4);
      assert.equal(untouched.prepare('PRAGMA table_info(channels)').all().some(row => row.name === 'visibility'), false);
      assert.equal(untouched.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='account_security'").get(), undefined);
      assert.equal(untouched.prepare('SELECT content FROM messages').get()!.content, 'History survives permissions migration.');
      assert.ok(untouched.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='initial_user_membership'").get());
    } finally { untouched.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
