import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, Repository } from '../server/db.js';
import { createWorkspace } from '../server/seed.js';

test('v3 workspace migration keeps identity, content, session expiry and ownership on repeated opens', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mola-membership-migration-'));
  const filename = join(directory, 'mola.sqlite');
  let repo: Repository | undefined;
  try {
    repo = new Repository(openDatabase(filename));
    const seed = createWorkspace(repo, { name: 'Existing production workspace', userName: 'Existing owner', email: 'owner@v3.test', passwordHash: 'preserved-hash' });
    repo.run('UPDATE users SET email_verified=1,site_admin=1 WHERE id=?', seed.userId);
    const sessionHash = createHash('sha256').update('existing-session').digest('hex');
    const expiresAt = Date.now() + 60_000;
    repo.run('INSERT INTO sessions(token_hash,user_id,expires_at,workspace_id) VALUES (?,?,?,?)', sessionHash, seed.userId, expiresAt, seed.workspaceId);
    const channelId = repo.get("SELECT id FROM channels WHERE workspace_id=? AND kind='text' LIMIT 1", seed.workspaceId)!.id;
    const messageId = randomUUID(); const attachmentId = randomUUID();
    repo.run('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)', messageId, channelId, seed.userId, 'Existing message', new Date().toISOString(), null, null, 1);
    repo.run('INSERT INTO attachments VALUES (?,?,?,?,?,?,?,?,?)', attachmentId, seed.workspaceId, seed.userId, messageId, 'original.txt', 16, 'text/plain', 'original-storage.bin', new Date().toISOString());
    repo.run('INSERT INTO reactions VALUES (?,?,?)', messageId, seed.userId, '✨');
    // Restore the v3 ownership FK as well as removing the new membership/session
    // fields, so the upgrade exercises the actual destructive legacy relation.
    repo.db.exec(`PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;
      DROP TRIGGER initial_user_membership; DROP TRIGGER initial_session_workspace; DROP TABLE workspace_members; DROP INDEX idx_sessions_workspace; ALTER TABLE sessions DROP COLUMN workspace_id;
      CREATE TABLE users_v3 (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, name TEXT NOT NULL, email TEXT NOT NULL COLLATE NOCASE UNIQUE, password_hash TEXT, color TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','member')), status TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, email_verified INTEGER NOT NULL DEFAULT 0, site_admin INTEGER NOT NULL DEFAULT 0, suspended_at TEXT);
      INSERT INTO users_v3 SELECT * FROM users; DROP TABLE users; ALTER TABLE users_v3 RENAME TO users;
      CREATE INDEX idx_preserved_user_verification ON users(email_verified);
      CREATE TABLE identity_updates(user_id TEXT);
      CREATE TRIGGER preserved_identity_updates AFTER UPDATE OF name ON users BEGIN INSERT INTO identity_updates VALUES(NEW.id); END;
      PRAGMA user_version=3; COMMIT; PRAGMA foreign_keys=ON;`);
    assert.equal(repo.all('PRAGMA foreign_key_list(users)')[0].on_delete, 'CASCADE');
    repo.close(); repo = new Repository(openDatabase(filename));
    assert.equal(repo.get('PRAGMA user_version')!.user_version, 4);
    assert.equal(repo.session(sessionHash)!.workspace_id, seed.workspaceId);
    assert.equal(repo.session(sessionHash)!.expires_at, expiresAt);
    assert.equal(repo.session(sessionHash)!.role, 'owner');
    assert.equal(repo.session(sessionHash)!.site_admin, 1);
    assert.equal(repo.session(sessionHash)!.password_hash, 'preserved-hash');
    assert.ok(repo.get("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_preserved_user_verification'"));
    repo.run('UPDATE users SET name=? WHERE id=?', 'Same identity, updated name', seed.userId);
    assert.equal(repo.get('SELECT user_id FROM identity_updates')!.user_id, seed.userId, 'existing user triggers still work after rebuilding the table');
    assert.deepEqual(repo.all('PRAGMA foreign_key_check'), []);
    assert.equal(repo.get('SELECT content FROM messages WHERE id=?', messageId)!.content, 'Existing message');
    assert.equal(repo.get('SELECT storage_name FROM attachments WHERE id=?', attachmentId)!.storage_name, 'original-storage.bin');
    assert.equal(repo.get('SELECT emoji FROM reactions WHERE message_id=?', messageId)!.emoji, '✨');
    assert.equal(repo.get('SELECT count(*) AS n FROM users')!.n, 1);
    const joinedAt = repo.member(seed.userId, seed.workspaceId)!.joined_at;
    repo.close(); repo = new Repository(openDatabase(filename));
    assert.equal(repo.member(seed.userId, seed.workspaceId)!.joined_at, joinedAt);
    assert.equal(repo.get('SELECT count(*) AS n FROM workspace_members')!.n, 1);
    assert.equal(repo.session(sessionHash)!.workspace_id, seed.workspaceId);
    const another = createWorkspace(repo, { name: 'Another team', userName: '', email: '', passwordHash: null, existingUserId: seed.userId });
    const otherChannel = repo.get("SELECT id FROM channels WHERE workspace_id=? AND kind='text' LIMIT 1", another.workspaceId)!.id;
    const otherMessage = randomUUID();
    repo.run('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)', otherMessage, otherChannel, seed.userId, 'Independent history', new Date().toISOString(), null, null, 0);
    repo.run('UPDATE sessions SET workspace_id=? WHERE token_hash=?', another.workspaceId, sessionHash);
    repo.run('DELETE FROM workspaces WHERE id=?', seed.workspaceId);
    assert.equal(repo.get('SELECT password_hash FROM users WHERE id=?', seed.userId)!.password_hash, 'preserved-hash');
    assert.equal(repo.get('SELECT content FROM messages WHERE id=?', otherMessage)!.content, 'Independent history');
    assert.equal(repo.session(sessionHash)!.workspace_id, another.workspaceId);
    assert.deepEqual(repo.all('PRAGMA foreign_key_check'), []);
  } finally { repo?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('v2 administrative migration preserves verified accounts, sessions, invitation bearers and encrypted mail', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mola-migration-'));
  const filename = join(directory, 'mola.sqlite');
  let repo: Repository | undefined;
  try {
    const legacy = new DatabaseSync(filename);
    legacy.exec(`
      CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, is_demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
      CREATE TABLE users (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), name TEXT NOT NULL, email TEXT NOT NULL COLLATE NOCASE UNIQUE, password_hash TEXT, color TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, email_verified INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
      CREATE TABLE invites (token_hash TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), created_by TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL, uses INTEGER NOT NULL DEFAULT 0, max_uses INTEGER NOT NULL DEFAULT 20);
      CREATE TABLE auth_tokens (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL, email TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER, created_at INTEGER NOT NULL);
      CREATE TABLE mail_outbox (id TEXT PRIMARY KEY, token_id TEXT REFERENCES auth_tokens(id), payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL, created_at INTEGER NOT NULL, delivered_at INTEGER);
      PRAGMA user_version=2;
    `);
    const workspaceId = randomUUID(); const userId = randomUUID(); const tokenId = randomUUID(); const mailId = randomUUID();
    const now = new Date().toISOString(); const expires = Date.now() + 86_400_000;
    const sessionHash = createHash('sha256').update('opaque session').digest('hex');
    const inviteHash = createHash('sha256').update('opaque invitation').digest('hex');
    const authHash = createHash('sha256').update('opaque verification').digest('hex');
    legacy.prepare('INSERT INTO workspaces VALUES (?,?,?,?)').run(workspaceId, 'Existing team', 0, now);
    legacy.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,?)').run(userId, workspaceId, 'Existing owner', 'owner@migration.test', 'preserved-password-hash', '#ffffff', 'owner', '', now, 1);
    legacy.prepare('INSERT INTO sessions VALUES (?,?,?)').run(sessionHash, userId, expires);
    legacy.prepare('INSERT INTO invites VALUES (?,?,?,?,?,?)').run(inviteHash, workspaceId, userId, expires, 3, 20);
    legacy.prepare('INSERT INTO auth_tokens VALUES (?,?,?,?,?,?,?,?)').run(tokenId, authHash, userId, 'verify', 'owner@migration.test', expires, null, Date.now());
    legacy.prepare('INSERT INTO mail_outbox (id,token_id,payload,next_attempt_at,created_at) VALUES (?,?,?,?,?)').run(mailId, tokenId, 'encrypted-envelope', Date.now(), Date.now());
    legacy.close();
    // The fixture above deliberately resembles v2 on disk; migration must add only administrative fields.
    repo = new Repository(openDatabase(filename));
    assert.equal(repo.get('PRAGMA user_version')!.user_version, 4);
    const user = repo.get('SELECT * FROM users WHERE id=?', userId)!;
    assert.equal(user.password_hash, 'preserved-password-hash'); assert.equal(user.email_verified, 1);
    assert.equal(user.site_admin, 0, 'migration must never promote the first existing account');
    assert.equal(user.suspended_at, null); assert.equal(repo.workspace(workspaceId).suspended, false);
    assert.equal(repo.get('SELECT token_hash FROM sessions WHERE user_id=?', userId)!.token_hash, sessionHash);
    const invitation = repo.get('SELECT * FROM invites WHERE token_hash=?', inviteHash)!;
    assert.match(invitation.id, /^[a-f0-9-]{36}$/); assert.notEqual(invitation.id, inviteHash);
    assert.equal(invitation.uses, 3); assert.equal(invitation.max_uses, 20); assert.equal(invitation.revoked_at, null);
    assert.equal(Date.parse(invitation.created_at), expires - 3 * 86_400_000);
    assert.equal(repo.get('SELECT token_hash FROM auth_tokens WHERE id=?', tokenId)!.token_hash, authHash);
    assert.equal(repo.get('SELECT payload FROM mail_outbox WHERE id=?', mailId)!.payload, 'encrypted-envelope');
    const invitationId = invitation.id;
    repo.close(); repo = new Repository(openDatabase(filename));
    assert.equal(repo.get('SELECT id FROM invites WHERE token_hash=?', inviteHash)!.id, invitationId, 'reopening must not replace opaque administration IDs');
    assert.equal(repo.get('SELECT payload FROM mail_outbox WHERE id=?', mailId)!.payload, 'encrypted-envelope');
  } finally { repo?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('a future database version is rejected before any schema or data changes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mola-future-schema-'));
  const filename = join(directory, 'mola.sqlite');
  try {
    const future = new DatabaseSync(filename); future.exec("CREATE TABLE future_record (value TEXT); INSERT INTO future_record VALUES ('untouched'); PRAGMA user_version=5;"); future.close();
    assert.throws(() => openDatabase(filename), /newer Mola release/);
    const unchanged = new DatabaseSync(filename);
    try {
      assert.equal(unchanged.prepare('PRAGMA user_version').get()!.user_version, 5);
      assert.equal(unchanged.prepare('SELECT value FROM future_record').get()!.value, 'untouched');
      assert.equal(unchanged.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get()!.n, 1);
    } finally { unchanged.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
