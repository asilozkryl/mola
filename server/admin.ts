import type { Express, Request } from 'express';
import type { Server } from 'socket.io';
import { randomUUID } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { Repository, type Row } from './db.js';
import { HttpError } from './errors.js';
import { closeCallRoom } from './calls.js';
import type { AuditEvent, SystemAdminData, WorkspaceAdminData } from '../shared/types.js';

const uuid = z.string().uuid();
const name = z.string().trim().min(2).max(60);
const channelName = z.string().trim().min(2).max(40).regex(/^[\p{L}\p{N}\s_-]+$/u, 'Kanal adında harf, sayı, boşluk ve tire kullanabilirsiniz.');
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, result.error.issues[0]?.message || 'Gönderilen bilgileri kontrol edin.');
  return result.data;
}

/** Callers pass only fixed administrative summaries, never request bodies or credentials. */
export function recordAudit(repo: Repository, actor: Row | null, workspaceId: string | null, action: string, targetType: string, targetId: string, details = '') {
  repo.run('INSERT INTO audit_events (id,workspace_id,actor_id,actor_name,action,target_type,target_id,details,created_at) VALUES (?,?,?,?,?,?,?,?,?)', randomUUID(), workspaceId, actor?.id ?? null, actor?.name ?? 'Sunucu yöneticisi (CLI)', action, targetType, targetId, details, new Date().toISOString());
}
const event = (row: Row): AuditEvent => ({ id: row.id, actorName: row.actor_name, action: row.action, targetType: row.target_type, targetId: row.target_id, details: row.details, createdAt: row.created_at });

export function installAdminRoutes(app: Express, options: { repo: Repository; io: Server; verifyPassword: (password: string, stored: string | null) => Promise<boolean> }) {
  const { repo, io } = options;
  const refresh = (workspaceId: string) => {
    io.to(`workspace:${workspaceId}`).emit('admin:refresh');
    // Global administration can be open from a different workspace.
    for (const socket of io.sockets.sockets.values()) if (socket.data.user?.siteAdmin && socket.data.workspaceId !== workspaceId) socket.emit('admin:refresh');
  };
  const currentActor = (req: Request) => {
    const actor = repo.get('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=? AND s.token_hash=? AND s.expires_at>?', req.auth!.id, req.sessionHash!, Date.now());
    if (!actor) throw new HttpError(401, 'Oturumunuz sona erdi. Yeniden giriş yapın.');
    if (actor.suspended_at) throw new HttpError(403, 'Hesabınız askıya alındı.', 'ACCOUNT_SUSPENDED');
    return actor;
  };
  const teamAdmin = (req: Request) => {
    const actor = currentActor(req);
    if (actor.suspended_at || (actor.role !== 'owner' && !actor.site_admin)) throw new HttpError(403, 'Ekip yönetimine yalnızca çalışma alanı sahibi erişebilir.');
    if (repo.workspace(actor.workspace_id).suspended) throw new HttpError(403, 'Bu çalışma alanı askıya alındı.', 'WORKSPACE_SUSPENDED');
    return actor;
  };
  const siteAdmin = (req: Request) => {
    const actor = currentActor(req);
    if (!actor.site_admin || actor.suspended_at || !actor.email_verified || repo.workspace(actor.workspace_id).isDemo) throw new HttpError(403, 'Bu işlem için uygulama yöneticisi yetkisi gerekli.');
    return actor;
  };
  const revokeUser = (id: string) => { repo.run('DELETE FROM sessions WHERE user_id=?', id); io.in(`user:${id}`).disconnectSockets(true); };
  const member = (id: unknown, workspaceId?: string) => {
    if (!uuid.safeParse(id).success) throw new HttpError(404, 'Üye bulunamadı.');
    const row = workspaceId ? repo.get('SELECT * FROM users WHERE id=? AND workspace_id=?', String(id), workspaceId) : repo.get('SELECT * FROM users WHERE id=?', String(id));
    if (!row) throw new HttpError(404, 'Üye bulunamadı.');
    return row;
  };
  const suspendMember = (req: Request, target: Row, suspended: boolean, system: boolean) => {
    repo.transaction(() => {
      // The CLI runs outside this event loop. Read authorization under the write lock.
      const actor = system ? siteAdmin(req) : teamAdmin(req);
      target = member(target.id, system ? undefined : actor.workspace_id);
      if (suspended && (actor.id === target.id || target.site_admin)) throw new HttpError(409, 'Kendi hesabınız veya uygulama yöneticisi askıya alınamaz.');
      if (suspended && target.role === 'owner') throw new HttpError(409, 'Önce çalışma alanının sahipliğini başka bir aktif üyeye devredin.');
      repo.run('UPDATE users SET suspended_at=? WHERE id=?', suspended ? new Date().toISOString() : null, target.id);
      recordAudit(repo, actor, target.workspace_id, `${system ? 'system' : 'workspace'}.member.${suspended ? 'suspended' : 'restored'}`, 'user', target.id);
      if (suspended) repo.run('DELETE FROM sessions WHERE user_id=?', target.id);
    });
    if (suspended) revokeUser(target.id);
    refresh(target.workspace_id);
  };
  app.use('/api/admin', rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Yönetim isteği sınırına ulaştınız. Bir dakika sonra tekrar deneyin.' } }));
  app.get('/api/admin/workspace', (req, res) => {
    const actor = teamAdmin(req); const wid = actor.workspace_id;
    const data: WorkspaceAdminData = {
      workspace: repo.workspace(wid),
      members: repo.all('SELECT * FROM users WHERE workspace_id=? ORDER BY created_at,id LIMIT 1000', wid).map(row => ({ ...repo.user(row), joinedAt: row.created_at })),
      channels: repo.all("SELECT * FROM channels WHERE workspace_id=? AND kind!='dm' ORDER BY created_at,id LIMIT 1000", wid).map(row => repo.channel(row)),
      invites: repo.all('SELECT i.*,u.name AS creator_name FROM invites i JOIN users u ON u.id=i.created_by WHERE i.workspace_id=? ORDER BY i.created_at DESC,i.id DESC LIMIT 100', wid).map(row => ({ id: row.id, createdAt: row.created_at, expiresAt: new Date(row.expires_at).toISOString(), uses: row.uses, maxUses: row.max_uses, revoked: Boolean(row.revoked_at), createdBy: row.creator_name })),
      audit: repo.all('SELECT * FROM audit_events WHERE workspace_id=? ORDER BY created_at DESC,id DESC LIMIT 100', wid).map(event),
      stats: { members: repo.get('SELECT count(*) AS n FROM users WHERE workspace_id=?', wid)!.n, channels: repo.get("SELECT count(*) AS n FROM channels WHERE workspace_id=? AND kind!='dm'", wid)!.n, messages: repo.get('SELECT count(*) AS n FROM messages m JOIN channels c ON c.id=m.channel_id WHERE c.workspace_id=?', wid)!.n, storageBytes: repo.get('SELECT coalesce(sum(size),0) AS n FROM attachments WHERE workspace_id=?', wid)!.n },
      limits: { members: 1000, channels: 1000, invites: 100, audit: 100 },
    };
    res.json(data);
  });
  app.patch('/api/admin/workspace', (req, res) => {
    const actor = teamAdmin(req); const input = parse(z.object({ name }).strict(), req.body);
    repo.transaction(() => { const fresh = teamAdmin(req); repo.run('UPDATE workspaces SET name=? WHERE id=?', input.name, fresh.workspace_id); recordAudit(repo, fresh, fresh.workspace_id, 'workspace.renamed', 'workspace', fresh.workspace_id); });
    refresh(actor.workspace_id); res.json({ ok: true });
  });
  app.patch('/api/admin/workspace/members/:id', (req, res) => {
    const actor = teamAdmin(req); const input = parse(z.object({ suspended: z.boolean() }).strict(), req.body);
    suspendMember(req, member(req.params.id, actor.workspace_id), input.suspended, false); res.json({ ok: true });
  });
  const transferLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Çok fazla sahiplik devri denemesi. 15 dakika sonra tekrar deneyin.' } });
  app.post('/api/admin/workspace/transfer', transferLimiter, async (req, res) => {
    const actor = teamAdmin(req);
    if (actor.role !== 'owner' || repo.workspace(actor.workspace_id).isDemo) throw new HttpError(403, 'Sahiplik devrini yalnızca gerçek çalışma alanının mevcut sahibi yapabilir.');
    const input = parse(z.object({ userId: uuid, currentPassword: z.string().min(1).max(128) }).strict(), req.body);
    member(input.userId, actor.workspace_id);
    if (!await options.verifyPassword(input.currentPassword, actor.password_hash)) throw new HttpError(401, 'Mevcut parolanız hatalı.');
    repo.transaction(() => {
      const fresh = teamAdmin(req);
      if (fresh.role !== 'owner') throw new HttpError(403, 'Sahiplik devri yetkiniz artık yok.');
      if (fresh.password_hash !== actor.password_hash || !repo.get('SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?', req.sessionHash!, actor.id, Date.now())) throw new HttpError(401, 'Oturumunuz değişti. Yeniden giriş yapın.');
      const target = member(input.userId, actor.workspace_id);
      if (target.id === actor.id || target.suspended_at || !target.email_verified || !target.password_hash || target.role === 'owner') throw new HttpError(409, 'Doğrulanmış, aktif ve kendi parolası olan başka bir üye seçin.');
      repo.run("UPDATE users SET role='member' WHERE workspace_id=? AND role='owner'", actor.workspace_id);
      repo.run("UPDATE users SET role='owner' WHERE id=?", target.id);
      recordAudit(repo, actor, actor.workspace_id, 'workspace.ownership.transferred', 'user', target.id);
    });
    // Refresh authorization carried in socket presence; HTTP reads roles per request.
    for (const socket of io.sockets.sockets.values()) if (socket.data.workspaceId === actor.workspace_id) socket.data.user = repo.user(repo.get('SELECT * FROM users WHERE id=?', socket.data.user.id)!);
    refresh(actor.workspace_id); res.json({ ok: true });
  });
  app.patch('/api/admin/workspace/channels/:id', (req, res) => {
    const actor = teamAdmin(req);
    const input = parse(z.object({ name: channelName.optional(), description: z.string().trim().max(300).optional(), archived: z.boolean().optional() }).strict().refine(value => Object.keys(value).length > 0), req.body);
    const channel = uuid.safeParse(req.params.id).success ? repo.get("SELECT * FROM channels WHERE id=? AND workspace_id=? AND kind!='dm'", String(req.params.id), actor.workspace_id) : undefined;
    if (!channel) throw new HttpError(404, 'Kanal bulunamadı.');
    if (input.name && repo.get("SELECT id FROM channels WHERE workspace_id=? AND name=? COLLATE NOCASE AND kind!='dm' AND id!=?", actor.workspace_id, input.name, channel.id)) throw new HttpError(409, 'Bu isimde bir kanal var.');
    repo.transaction(() => {
      const fresh = teamAdmin(req);
      repo.run('UPDATE channels SET name=?,description=?,archived_at=? WHERE id=?', input.name ?? channel.name, input.description ?? channel.description, input.archived === undefined ? channel.archived_at : input.archived ? new Date().toISOString() : null, channel.id);
      recordAudit(repo, fresh, fresh.workspace_id, input.archived === undefined ? 'channel.updated' : input.archived ? 'channel.archived' : 'channel.restored', 'channel', channel.id);
    });
    if (input.archived) closeCallRoom(io, channel.id, 'Bu kanal arşivlendi. Görüşme kapatıldı.');
    refresh(actor.workspace_id); res.json({ ok: true });
  });
  app.delete('/api/admin/workspace/invites/:id', (req, res) => {
    const actor = teamAdmin(req);
    const invitation = uuid.safeParse(req.params.id).success ? repo.get('SELECT id FROM invites WHERE id=? AND workspace_id=?', String(req.params.id), actor.workspace_id) : undefined;
    if (!invitation) throw new HttpError(404, 'Davet bulunamadı.');
    repo.transaction(() => { const fresh = teamAdmin(req); repo.run('UPDATE invites SET revoked_at=? WHERE id=?', new Date().toISOString(), invitation.id); recordAudit(repo, fresh, fresh.workspace_id, 'invite.revoked', 'invite', invitation.id); });
    refresh(actor.workspace_id); res.json({ ok: true });
  });
  app.get('/api/admin/system', (req, res) => {
    siteAdmin(req);
    const query = parse(z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(100), q: z.string().trim().max(100).default(''), status: z.enum(['all', 'active', 'suspended']).default('all') }), req.query);
    const pattern = `%${query.q.normalize('NFKC').toLocaleLowerCase('tr-TR').replace(/[\\%_]/g, value => `\\${value}`)}%`;
    const workspaceWhere = "w.is_demo=0 AND fold_text(w.name||' '||coalesce((SELECT group_concat(name,' ') FROM users WHERE workspace_id=w.id AND role='owner'),'')) LIKE ? ESCAPE '\\'" + (query.status === 'all' ? '' : ` AND w.suspended_at IS ${query.status === 'active' ? '' : 'NOT '}NULL`);
    const userWhere = "w.is_demo=0 AND (fold_text(u.name) LIKE ? ESCAPE '\\' OR fold_text(u.email) LIKE ? ESCAPE '\\' OR fold_text(w.name) LIKE ? ESCAPE '\\')" + (query.status === 'all' ? '' : ` AND u.suspended_at IS ${query.status === 'active' ? '' : 'NOT '}NULL`);
    const auditWhere = "fold_text(actor_name||' '||action||' '||target_id||' '||details) LIKE ? ESCAPE '\\'";
    const offset = (query.page - 1) * query.limit;
    const data: SystemAdminData = {
      workspaces: repo.all(`SELECT w.*,(SELECT group_concat(name,', ') FROM users WHERE workspace_id=w.id AND role='owner') AS owner_name,(SELECT count(*) FROM users WHERE workspace_id=w.id) AS member_count,(SELECT count(*) FROM messages m JOIN channels c ON c.id=m.channel_id WHERE c.workspace_id=w.id) AS message_count,(SELECT coalesce(sum(size),0) FROM attachments WHERE workspace_id=w.id) AS storage_bytes FROM workspaces w WHERE ${workspaceWhere} ORDER BY w.created_at DESC,w.id LIMIT ? OFFSET ?`, pattern, query.limit, offset).map(row => ({ id: row.id, name: row.name, isDemo: false, suspended: Boolean(row.suspended_at), ownerName: row.owner_name || '', memberCount: row.member_count, messageCount: row.message_count, storageBytes: row.storage_bytes })),
      users: repo.all(`SELECT u.*,w.name AS workspace_name FROM users u JOIN workspaces w ON w.id=u.workspace_id WHERE ${userWhere} ORDER BY u.created_at DESC,u.id LIMIT ? OFFSET ?`, pattern, pattern, pattern, query.limit, offset).map(row => ({ ...repo.user(row), joinedAt: row.created_at, workspaceId: row.workspace_id, workspaceName: row.workspace_name })),
      audit: repo.all(`SELECT * FROM audit_events WHERE ${auditWhere} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`, pattern, query.limit, offset).map(event),
      pagination: { page: query.page, limit: query.limit, workspaceTotal: repo.get(`SELECT count(*) AS n FROM workspaces w WHERE ${workspaceWhere}`, pattern)!.n, userTotal: repo.get(`SELECT count(*) AS n FROM users u JOIN workspaces w ON w.id=u.workspace_id WHERE ${userWhere}`, pattern, pattern, pattern)!.n, auditTotal: repo.get(`SELECT count(*) AS n FROM audit_events WHERE ${auditWhere}`, pattern)!.n },
    };
    res.json(data);
  });
  app.patch('/api/admin/system/workspaces/:id', (req, res) => {
    const actor = siteAdmin(req); const input = parse(z.object({ suspended: z.boolean() }).strict(), req.body);
    const target = uuid.safeParse(req.params.id).success ? repo.get('SELECT * FROM workspaces WHERE id=? AND is_demo=0', String(req.params.id)) : undefined;
    if (!target) throw new HttpError(404, 'Çalışma alanı bulunamadı.');
    repo.transaction(() => {
      const fresh = siteAdmin(req);
      repo.run('UPDATE workspaces SET suspended_at=? WHERE id=?', input.suspended ? new Date().toISOString() : null, target.id);
      if (input.suspended) repo.run('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE workspace_id=? AND site_admin=0)', target.id);
      recordAudit(repo, fresh, target.id, `system.workspace.${input.suspended ? 'suspended' : 'restored'}`, 'workspace', target.id);
    });
    refresh(target.id);
    if (input.suspended) io.in(`workspace:${target.id}`).disconnectSockets(true);
    res.json({ ok: true });
  });
  app.patch('/api/admin/system/users/:id', (req, res) => {
    const actor = siteAdmin(req); const input = parse(z.object({ suspended: z.boolean() }).strict(), req.body); const target = member(req.params.id);
    if (repo.workspace(target.workspace_id).isDemo) throw new HttpError(404, 'Üye bulunamadı.');
    suspendMember(req, target, input.suspended, true); res.json({ ok: true });
  });
}
