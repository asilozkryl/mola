import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, Repository } from '../server/db.js';

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
    assert.equal(repo.get('PRAGMA user_version')!.user_version, 3);
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
    const future = new DatabaseSync(filename); future.exec("CREATE TABLE future_record (value TEXT); INSERT INTO future_record VALUES ('untouched'); PRAGMA user_version=4;"); future.close();
    assert.throws(() => openDatabase(filename), /newer Mola release/);
    const unchanged = new DatabaseSync(filename);
    try {
      assert.equal(unchanged.prepare('PRAGMA user_version').get()!.user_version, 4);
      assert.equal(unchanged.prepare('SELECT value FROM future_record').get()!.value, 'untouched');
      assert.equal(unchanged.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get()!.n, 1);
    } finally { unchanged.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
