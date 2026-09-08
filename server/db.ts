import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AccountUser, Attachment, Channel, Message, User, Workspace, WorkspaceRole } from '../shared/types.js';
import { migrateAccountSecurity } from './account-security.js';
import { migrateCollaborationData } from './collaboration-data.js';
import { migrateIntegrations } from './integrations.js';
import { migrateSidebarPreferences } from './sidebar-preferences.js';

export type Row = Record<string, any>;

export function openDatabase(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (version > 7) { db.close(); throw new Error('This database was created by a newer Mola release. Restore the matching application version.'); }
  db.function('fold_text', { deterministic: true }, value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('tr-TR'));
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, is_demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, name TEXT NOT NULL, email TEXT NOT NULL COLLATE NOCASE UNIQUE, password_hash TEXT, color TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','member')), status TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS channels (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL CHECK(kind IN ('text','voice','dm')), created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_channels_workspace ON channels(workspace_id);
    CREATE TABLE IF NOT EXISTS channel_members (channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(channel_id,user_id));
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, content TEXT NOT NULL, created_at TEXT NOT NULL, edited_at TEXT, parent_id TEXT REFERENCES messages(id) ON DELETE CASCADE, pinned INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id,parent_id,created_at,id);
    CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(parent_id);
    CREATE TABLE IF NOT EXISTS reactions (message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, emoji TEXT NOT NULL, PRIMARY KEY(message_id,user_id,emoji));
    CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, message_id TEXT REFERENCES messages(id) ON DELETE CASCADE, name TEXT NOT NULL, size INTEGER NOT NULL, mime TEXT NOT NULL, storage_name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);
    CREATE TABLE IF NOT EXISTS invites (token_hash TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, uses INTEGER NOT NULL DEFAULT 0, max_uses INTEGER NOT NULL DEFAULT 20);
  `);
  if (version < 2) db.exec(`BEGIN IMMEDIATE;
    ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0 CHECK(email_verified IN (0,1));
    UPDATE users SET email_verified=1 WHERE workspace_id IN (SELECT id FROM workspaces WHERE is_demo=1);
    CREATE TABLE auth_tokens (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK(kind IN ('verify','reset')), email TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER, created_at INTEGER NOT NULL);
    CREATE INDEX idx_auth_tokens_user ON auth_tokens(user_id,kind,created_at);
    CREATE TABLE mail_outbox (id TEXT PRIMARY KEY, token_id TEXT REFERENCES auth_tokens(id) ON DELETE CASCADE, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL, created_at INTEGER NOT NULL, delivered_at INTEGER);
    CREATE INDEX idx_mail_outbox_pending ON mail_outbox(status,next_attempt_at);
    PRAGMA user_version=2;
    COMMIT;`);
  if (version < 3) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
      ALTER TABLE users ADD COLUMN site_admin INTEGER NOT NULL DEFAULT 0 CHECK(site_admin IN (0,1));
      ALTER TABLE users ADD COLUMN suspended_at TEXT;
      ALTER TABLE workspaces ADD COLUMN suspended_at TEXT;
      ALTER TABLE channels ADD COLUMN archived_at TEXT;
      ALTER TABLE invites ADD COLUMN id TEXT;
      ALTER TABLE invites ADD COLUMN created_at TEXT;
      ALTER TABLE invites ADD COLUMN revoked_at TEXT;
      CREATE UNIQUE INDEX idx_invites_id ON invites(id);
      CREATE TABLE audit_events (id TEXT PRIMARY KEY, workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL, actor_id TEXT REFERENCES users(id) ON DELETE SET NULL, actor_name TEXT NOT NULL, action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
      CREATE INDEX idx_audit_workspace ON audit_events(workspace_id,created_at DESC);
      CREATE INDEX idx_audit_created ON audit_events(created_at DESC);`);
      const update = db.prepare('UPDATE invites SET id=?,created_at=? WHERE token_hash=?');
      for (const invite of db.prepare('SELECT token_hash,expires_at FROM invites').all() as Row[]) update.run(randomUUID(), new Date(invite.expires_at - 3 * 24 * 60 * 60_000).toISOString(), invite.token_hash);
      db.exec('PRAGMA user_version=3; COMMIT;');
    } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  }
  if (version < 4) {
    // SQLite requires FK enforcement to be disabled outside the transaction while
    // replacing a referenced table. Validate every relation before committing.
    db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
    try {
      const userSchemaObjects = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='users' AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY type,name").all() as { sql: string }[];
      // Keep the original home-workspace columns as migration metadata. Membership
      // and authorization now come exclusively from workspace_members and sessions.
      // In particular, deleting a former home workspace must not delete an account
      // or content that the same identity owns in other workspaces.
      db.exec(`CREATE TABLE users_v4 (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL COLLATE NOCASE UNIQUE, password_hash TEXT, color TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','member')), status TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, email_verified INTEGER NOT NULL DEFAULT 0 CHECK(email_verified IN (0,1)), site_admin INTEGER NOT NULL DEFAULT 0 CHECK(site_admin IN (0,1)), suspended_at TEXT);
        INSERT INTO users_v4(id,workspace_id,name,email,password_hash,color,role,status,created_at,email_verified,site_admin,suspended_at) SELECT id,workspace_id,name,email,password_hash,color,role,status,created_at,email_verified,site_admin,suspended_at FROM users;
        DROP TABLE users;
        ALTER TABLE users_v4 RENAME TO users;
        CREATE TABLE workspace_members (workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('owner','member')), joined_at TEXT NOT NULL, suspended_at TEXT, removed_at TEXT, PRIMARY KEY(workspace_id,user_id));
        CREATE INDEX idx_workspace_members_user ON workspace_members(user_id,removed_at);
        INSERT INTO workspace_members(workspace_id,user_id,role,joined_at) SELECT workspace_id,id,role,created_at FROM users;
        ALTER TABLE sessions ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE;
        UPDATE sessions SET workspace_id=(SELECT workspace_id FROM users WHERE users.id=sessions.user_id);
        CREATE INDEX idx_sessions_workspace ON sessions(workspace_id,user_id);
        CREATE TRIGGER initial_user_membership AFTER INSERT ON users BEGIN INSERT INTO workspace_members(workspace_id,user_id,role,joined_at) VALUES(NEW.workspace_id,NEW.id,NEW.role,NEW.created_at); END;
        CREATE TRIGGER initial_session_workspace AFTER INSERT ON sessions WHEN NEW.workspace_id IS NULL BEGIN UPDATE sessions SET workspace_id=(SELECT workspace_id FROM users WHERE id=NEW.user_id) WHERE token_hash=NEW.token_hash; END;
        PRAGMA user_version=4;`);
      for (const object of userSchemaObjects) db.exec(object.sql);
      if (db.prepare('PRAGMA foreign_key_check').all().length > 0) throw new Error('Workspace migration found invalid references. Restore a consistent database backup.');
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
    finally { if (db.isOpen) db.exec('PRAGMA foreign_keys=ON'); }
  }
  if (version < 5) {
    db.exec('BEGIN IMMEDIATE');
    try {
      // No table references workspace_members. Rebuild its CHECK constraint while
      // retaining every active, suspended and removed membership and join date.
      db.exec(`DROP TRIGGER initial_user_membership;
        CREATE TABLE workspace_members_v5 (workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('owner','admin','moderator','member','guest')), joined_at TEXT NOT NULL, suspended_at TEXT, removed_at TEXT, PRIMARY KEY(workspace_id,user_id));
        INSERT INTO workspace_members_v5 SELECT workspace_id,user_id,role,joined_at,suspended_at,removed_at FROM workspace_members;
        DROP TABLE workspace_members;
        ALTER TABLE workspace_members_v5 RENAME TO workspace_members;
        CREATE INDEX idx_workspace_members_user ON workspace_members(user_id,removed_at);
        CREATE TRIGGER initial_user_membership AFTER INSERT ON users BEGIN INSERT INTO workspace_members(workspace_id,user_id,role,joined_at) VALUES(NEW.workspace_id,NEW.id,NEW.role,NEW.created_at); END;
        ALTER TABLE channels ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','private'));
        UPDATE channels SET visibility='private' WHERE kind='dm';
        CREATE INDEX idx_channel_members_user ON channel_members(user_id,channel_id);`);
      migrateAccountSecurity(db);
      migrateCollaborationData(db);
      migrateIntegrations(db);
      if (db.prepare('PRAGMA foreign_key_check').all().length > 0) throw new Error('Permissions migration found invalid references. Restore a consistent database backup.');
      db.exec('PRAGMA user_version=5; COMMIT;');
    } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  }
  if (version < 6) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`ALTER TABLE users ADD COLUMN job_title TEXT NOT NULL DEFAULT '';
        ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT '';
        ALTER TABLE users ADD COLUMN location TEXT NOT NULL DEFAULT '';
        ALTER TABLE users ADD COLUMN avatar_version TEXT;
        PRAGMA user_version=6; COMMIT;`);
    } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  }
  if (version < 7) {
    // Rebuild the parent table without cascading into device/push registrations.
    db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
    try {
      db.exec(`DROP TRIGGER initial_session_workspace;
        CREATE TABLE sessions_v7 (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, workspace_id TEXT DEFAULT '' REFERENCES workspaces(id) ON DELETE SET NULL);
        INSERT INTO sessions_v7 SELECT token_hash,user_id,expires_at,workspace_id FROM sessions;
        DROP TABLE sessions;
        ALTER TABLE sessions_v7 RENAME TO sessions;
        CREATE INDEX idx_sessions_user ON sessions(user_id);
        CREATE INDEX idx_sessions_workspace ON sessions(workspace_id,user_id);
        CREATE TRIGGER initial_session_workspace AFTER INSERT ON sessions WHEN NEW.workspace_id='' BEGIN
          UPDATE sessions SET workspace_id=(SELECT wm.workspace_id FROM workspace_members wm JOIN workspaces w ON w.id=wm.workspace_id WHERE wm.user_id=NEW.user_id AND wm.removed_at IS NULL AND wm.suspended_at IS NULL AND w.suspended_at IS NULL ORDER BY wm.joined_at,wm.workspace_id LIMIT 1) WHERE token_hash=NEW.token_hash;
        END;
        PRAGMA user_version=7;`);
      if (!(db.prepare('PRAGMA table_info(workspace_members)').all() as Row[]).some(column => column.name === 'left_at')) db.exec('ALTER TABLE workspace_members ADD COLUMN left_at TEXT');
      migrateSidebarPreferences(db);
      // The empty-string default only preserves legacy inserts that omit the
      // column. An explicit NULL always means an account-only session; neither
      // path uses the obsolete users.workspace_id as authorization.
      if (db.prepare('PRAGMA foreign_key_check').all().length > 0) throw new Error('Workspace lifecycle migration found invalid references. Restore a consistent database backup.');
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
    finally { if (db.isOpen) db.exec('PRAGMA foreign_keys=ON'); }
  }
  return db;
}

export class Repository {
  private readonly statements = new Map<string, StatementSync>();
  private closed = false;
  private static readonly statementLimit = 128;
  constructor(public db: DatabaseSync) {}
  private statement(sql: string): StatementSync {
    if (this.closed) throw new Error('Database repository is closed.');
    const existing = this.statements.get(sql);
    if (existing) { this.statements.delete(sql); this.statements.set(sql, existing); return existing; }
    const prepared = this.db.prepare(sql);
    if (this.statements.size >= Repository.statementLimit) this.statements.delete(this.statements.keys().next().value!);
    this.statements.set(sql, prepared);
    return prepared;
  }
  get preparedStatementCount() { return this.statements.size; }
  get(sql: string, ...args: (string | number | null)[]): Row | undefined { return this.statement(sql).get(...args) as Row | undefined; }
  all(sql: string, ...args: (string | number | null)[]): Row[] { return this.statement(sql).all(...args) as Row[]; }
  run(sql: string, ...args: (string | number | null)[]) { return this.statement(sql).run(...args); }
  close() {
    if (this.closed) return;
    this.closed = true;
    // DatabaseSync.close finalizes native statements; release our JS references too.
    this.statements.clear();
    if (this.db.isOpen) this.db.close();
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  user(row: Row): User {
    const suspended = Boolean(row.suspended_at || row.membership_suspended_at || row.membership_removed_at);
    return {
      id: row.id, name: row.name, email: row.email, color: row.color, role: row.role, status: row.status || '',
      // Inactive historical authors keep their name and color, while their profile
      // details follow the same access rule as the dedicated member endpoint.
      ...(!suspended ? {
        jobTitle: row.job_title || '', bio: row.bio || '', location: row.location || '',
        ...(row.avatar_version && row.workspace_id ? { avatarUrl: `/api/workspaces/${row.workspace_id}/members/${row.id}/avatar/${row.avatar_version}` } : {}),
      } : {}),
      emailVerified: Boolean(row.email_verified), siteAdmin: Boolean(row.site_admin), suspended,
      ...(this.get('SELECT 1 FROM bot_accounts WHERE user_id=?', row.id) ? { isBot: true } : {}),
    };
  }
  accountUser(row: Row): AccountUser {
    const { role: _role, avatarUrl: _avatar, ...user } = this.user({ ...row, workspace_id: null, membership_suspended_at: null, membership_removed_at: null });
    return { ...user, ...(row.avatar_version ? { avatarUrl: `/api/account/avatar/${row.avatar_version}` } : {}) };
  }
  member(userId: string, workspaceId: string): Row | undefined { return this.get('SELECT u.*,wm.workspace_id,wm.role,wm.joined_at,wm.suspended_at AS membership_suspended_at,wm.removed_at AS membership_removed_at,wm.left_at AS membership_left_at FROM users u JOIN workspace_members wm ON wm.user_id=u.id WHERE u.id=? AND wm.workspace_id=?', userId, workspaceId); }
  members(workspaceId: string): Row[] { return this.all('SELECT u.*,wm.workspace_id,wm.role,wm.joined_at,wm.suspended_at AS membership_suspended_at,wm.removed_at AS membership_removed_at FROM users u JOIN workspace_members wm ON wm.user_id=u.id WHERE wm.workspace_id=? ORDER BY wm.joined_at,u.id', workspaceId); }
  session(hash: string): Row | undefined { return this.get('SELECT u.*,s.workspace_id,wm.role,wm.suspended_at AS membership_suspended_at,wm.removed_at AS membership_removed_at,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN workspace_members wm ON wm.user_id=u.id AND wm.workspace_id=s.workspace_id WHERE s.token_hash=? AND s.expires_at>? AND (s.workspace_id IS NULL OR wm.user_id IS NOT NULL)', hash, Date.now()); }
  fallbackWorkspace(userId: string, excludedId: string | null = null): string | null {
    return this.get('SELECT wm.workspace_id FROM workspace_members wm JOIN workspaces w ON w.id=wm.workspace_id WHERE wm.user_id=? AND (? IS NULL OR wm.workspace_id!=?) AND wm.removed_at IS NULL AND wm.suspended_at IS NULL AND w.suspended_at IS NULL ORDER BY wm.joined_at,wm.workspace_id LIMIT 1', userId, excludedId, excludedId)?.workspace_id ?? null;
  }
  workspaces(userId: string) { return this.all('SELECT w.*,wm.role,wm.suspended_at AS membership_suspended_at FROM workspaces w JOIN workspace_members wm ON wm.workspace_id=w.id WHERE wm.user_id=? AND wm.removed_at IS NULL ORDER BY wm.joined_at,w.id', userId).map(row => ({ ...this.workspace(row.id), role: row.role as WorkspaceRole, membershipSuspended: Boolean(row.membership_suspended_at) })); }
  workspace(id: string): Workspace { const row = this.get('SELECT * FROM workspaces WHERE id=?', id)!; return { id: row.id, name: row.name, isDemo: Boolean(row.is_demo), suspended: Boolean(row.suspended_at) }; }
  canAccessChannel(userId: string, channelId: string, workspaceId?: string): boolean {
    return Boolean(this.get(`SELECT c.id FROM channels c JOIN workspace_members wm ON wm.workspace_id=c.workspace_id JOIN users u ON u.id=wm.user_id JOIN workspaces w ON w.id=c.workspace_id WHERE c.id=? AND u.id=? AND (? IS NULL OR c.workspace_id=?) AND u.suspended_at IS NULL AND wm.suspended_at IS NULL AND wm.removed_at IS NULL AND w.suspended_at IS NULL AND ((c.kind!='dm' AND c.visibility='public' AND wm.role!='guest') OR EXISTS (SELECT 1 FROM channel_members cm WHERE cm.channel_id=c.id AND cm.user_id=u.id))`, channelId, userId, workspaceId ?? null, workspaceId ?? null));
  }
  canWriteChannel(userId: string, channelId: string, workspaceId?: string): boolean { return this.canAccessChannel(userId, channelId, workspaceId) && !this.get('SELECT archived_at FROM channels WHERE id=?', channelId)?.archived_at; }
  channel(row: Row): Channel {
    return { id: row.id, name: row.name, description: row.description, kind: row.kind, visibility: row.kind === 'dm' ? 'private' : row.visibility, archived: Boolean(row.archived_at), memberIds: this.all('SELECT user_id FROM channel_members WHERE channel_id=? ORDER BY user_id', row.id).map(x => x.user_id) };
  }
  channels(userId: string, workspaceId: string): Channel[] {
    return this.all(`SELECT c.* FROM channels c JOIN workspace_members wm ON wm.workspace_id=c.workspace_id JOIN users u ON u.id=wm.user_id JOIN workspaces w ON w.id=c.workspace_id WHERE c.workspace_id=? AND wm.user_id=? AND u.suspended_at IS NULL AND wm.suspended_at IS NULL AND wm.removed_at IS NULL AND w.suspended_at IS NULL AND ((c.kind!='dm' AND c.visibility='public' AND wm.role!='guest') OR EXISTS (SELECT 1 FROM channel_members cm WHERE cm.channel_id=c.id AND cm.user_id=wm.user_id)) ORDER BY c.created_at,c.rowid`, workspaceId, userId).map(row => this.channel(row));
  }
  attachment(row: Row): Attachment { return { id: row.id, name: row.name, size: row.size, mime: row.mime, url: `/api/files/${row.id}` }; }
  message(row: Row): Message {
    const reactions = new Map<string, string[]>();
    for (const reaction of this.all('SELECT emoji,user_id FROM reactions WHERE message_id=? ORDER BY rowid', row.id)) { const users = reactions.get(reaction.emoji) || []; users.push(reaction.user_id); reactions.set(reaction.emoji, users); }
    return { id: row.id, channelId: row.channel_id, userId: row.user_id, content: row.content, createdAt: row.created_at, ...(row.edited_at ? { editedAt: row.edited_at } : {}), ...(row.parent_id ? { parentId: row.parent_id } : {}), replyCount: this.get('SELECT count(*) AS count FROM messages WHERE parent_id=?', row.id)!.count, reactions: [...reactions].map(([emoji, userIds]) => ({ emoji, userIds })), attachments: this.all('SELECT * FROM attachments WHERE message_id=?', row.id).map(a => this.attachment(a)), pinned: Boolean(row.pinned) };
  }
}
