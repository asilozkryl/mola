import type { Express, Request } from 'express';
import type { Server } from 'socket.io';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Repository, Row } from './db.js';
import type { User, WorkspaceRole } from '../shared/types.js';
import { HttpError } from './errors.js';
import { updateCallUser, refreshVoiceAccess } from './calls.js';

type Actor = Pick<User, 'role' | 'siteAdmin'> | { role: WorkspaceRole; site_admin?: number } | Row;
const isSiteAdmin = (actor: Actor) => ('siteAdmin' in actor && actor.siteAdmin) || ('site_admin' in actor && actor.site_admin);
export const canManageWorkspace = (actor: Actor): boolean => Boolean(isSiteAdmin(actor) || actor.role === 'owner' || actor.role === 'admin');
export const canCreateChannel = (actor: Actor): boolean => Boolean(isSiteAdmin(actor) || ['owner', 'admin', 'moderator', 'member'].includes(actor.role));
export const canInviteMembers = canManageWorkspace;
export const canModerateMessages = (actor: Actor): boolean => Boolean(canManageWorkspace(actor) || actor.role === 'moderator');

export function canManageChannel(repo: Repository, actor: Row, channel: Row): boolean {
  return channel.workspace_id === actor.workspace_id && channel.kind !== 'dm' &&
    (canManageWorkspace(actor as Actor) || (actor.role === 'moderator' && channel.visibility === 'public' && repo.canAccessChannel(actor.id, channel.id, actor.workspace_id)));
}

/** Reconcile access before any subsequent channel broadcast; revoked call peers leave too. */
export function reconcileWorkspaceAccess(repo: Repository, io: Server, workspaceId: string, userId?: string) {
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.workspaceId !== workspaceId || (userId && socket.data.user?.id !== userId)) continue;
    const member = repo.member(socket.data.user.id, workspaceId);
    if (!member || member.suspended_at || member.membership_suspended_at || member.membership_removed_at) {
      socket.emit('admin:refresh'); socket.disconnect(true); continue;
    }
    socket.data.user = repo.user(member);
    const allowed = repo.channels(member.id, workspaceId);
    const allowedIds = new Set(allowed.map(channel => channel.id));
    const revoked = [...socket.rooms].some(room => room.startsWith('channel:') && !allowedIds.has(room.slice('channel:'.length)));
    if (revoked) {
      // Disconnect is synchronous for room membership and invokes call cleanup.
      // The browser refreshes its bootstrap before reconnecting this session.
      socket.emit('admin:refresh'); socket.disconnect(true); continue;
    }
    for (const channel of allowed) if (!socket.rooms.has(`channel:${channel.id}`)) {
      void socket.join(`channel:${channel.id}`);
      socket.emit('channel:created', channel);
    }
    socket.emit('admin:refresh');
  }
  if (userId) {
    const member = repo.member(userId, workspaceId);
    if (member) updateCallUser(io, workspaceId, repo.user(member));
  }
  void refreshVoiceAccess(io, workspaceId);
}

export function installChannelPermissionRoutes(app: Express, { repo, io }: { repo: Repository; io: Server }) {
  const actorFor = (req: Request) => {
    const actor = repo.session(req.sessionHash!);
    if (!actor) throw new HttpError(401, 'Oturumunuz sona erdi. Yeniden giriş yapın.');
    if (actor.id !== req.auth!.id || actor.workspace_id !== req.auth!.workspace_id) throw new HttpError(409, 'Çalışma alanınız değişti. Güncel alan yükleniyor.', 'WORKSPACE_CHANGED');
    if (actor.suspended_at || actor.membership_suspended_at || actor.membership_removed_at || repo.workspace(actor.workspace_id).suspended) throw new HttpError(403, 'Bu çalışma alanına erişiminiz yok.');
    return actor;
  };
  const channelFor = (req: Request, actor: Row) => {
    const channel = z.string().uuid().safeParse(req.params.id).success ? repo.get("SELECT * FROM channels WHERE id=? AND workspace_id=? AND kind!='dm'", String(req.params.id), actor.workspace_id) : undefined;
    if (!channel || (!canManageWorkspace(actor as Actor) && !repo.canAccessChannel(actor.id, channel.id, actor.workspace_id))) throw new HttpError(404, 'Kanal bulunamadı.');
    return channel;
  };
  const audit = (actor: Row, action: string, targetType: string, targetId: string, details = '') => repo.run('INSERT INTO audit_events(id,workspace_id,actor_id,actor_name,action,target_type,target_id,details,created_at) VALUES (?,?,?,?,?,?,?,?,?)', randomUUID(), actor.workspace_id, actor.id, actor.name, action, targetType, targetId, details, new Date().toISOString());
  app.get('/api/channels/:id/access', (req, res) => {
    const actor = actorFor(req); const channel = channelFor(req, actor);
    res.json({ channel: repo.channel(channel), members: repo.members(actor.workspace_id).filter(row => !row.membership_removed_at && !row.membership_suspended_at && !row.suspended_at).map(row => repo.user(row)), canManage: canManageWorkspace(actor as Actor), canModerate: canManageChannel(repo, actor, channel) });
  });
  app.patch('/api/channels/:id/access', (req, res) => {
    const parsed = z.object({ visibility: z.enum(['public', 'private']), memberIds: z.array(z.string().uuid()).max(1000) }).strict().safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, 'Kanal görünürlüğünü ve üye listesini kontrol edin.');
    const changed = repo.transaction(() => {
      const actor = actorFor(req); const channel = channelFor(req, actor);
      if (!canManageWorkspace(actor as Actor)) throw new HttpError(403, 'Kanal erişimini yalnızca alan sahibi veya yönetici değiştirebilir.');
      const members = [...new Set(parsed.data.memberIds)];
      if (parsed.data.visibility === 'private' && !members.length) throw new HttpError(400, 'Özel kanal için en az bir üye seçin.');
      for (const id of members) {
        const member = repo.member(id, actor.workspace_id);
        if (!member || member.membership_removed_at || member.membership_suspended_at || member.suspended_at) throw new HttpError(400, 'Yalnızca bu çalışma alanındaki aktif üyeler seçilebilir.');
      }
      repo.run('UPDATE channels SET visibility=? WHERE id=?', parsed.data.visibility, channel.id);
      repo.run('DELETE FROM channel_members WHERE channel_id=?', channel.id);
      for (const id of members) repo.run('INSERT INTO channel_members(channel_id,user_id) VALUES (?,?)', channel.id, id);
      audit(actor, 'channel.access.updated', 'channel', channel.id, `${parsed.data.visibility}; ${members.length} üye`);
      return { workspaceId: actor.workspace_id as string, channel: repo.channel({ ...channel, visibility: parsed.data.visibility }) };
    });
    reconcileWorkspaceAccess(repo, io, changed.workspaceId);
    res.json(changed.channel);
  });
  app.patch('/api/admin/workspace/members/:id/role', (req, res) => {
    const parsed = z.object({ role: z.enum(['admin', 'moderator', 'member', 'guest']) }).strict().safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, 'Geçerli bir çalışma alanı rolü seçin.');
    const changed = repo.transaction(() => {
      const actor = actorFor(req);
      if (!canManageWorkspace(actor as Actor)) throw new HttpError(403, 'Üye rollerini yalnızca alan sahibi veya yönetici değiştirebilir.');
      const target = z.string().uuid().safeParse(req.params.id).success ? repo.member(String(req.params.id), actor.workspace_id) : undefined;
      if (!target || target.membership_removed_at) throw new HttpError(404, 'Üye bulunamadı.');
      if (repo.get('SELECT 1 FROM bot_accounts WHERE user_id=?', target.id)) throw new HttpError(409, 'Botlar yalnızca kendi kanallarına erişen misafir olarak çalışır. Entegrasyonlar bölümünden yönetebilirsin.');
      if (target.role === 'owner' || target.id === actor.id || target.site_admin) throw new HttpError(409, 'Alan sahibinin, kendi hesabınızın veya uygulama yöneticisinin rolü buradan değiştirilemez.');
      if (actor.role !== 'owner' && !actor.site_admin && (target.role === 'admin' || parsed.data.role === 'admin')) throw new HttpError(403, 'Yönetici rolünü yalnızca alan sahibi değiştirebilir.');
      repo.run('UPDATE workspace_members SET role=? WHERE workspace_id=? AND user_id=?', parsed.data.role, actor.workspace_id, target.id);
      audit(actor, 'workspace.member.role.updated', 'user', target.id, `${target.role} → ${parsed.data.role}`);
      return { workspaceId: actor.workspace_id as string, userId: target.id as string };
    });
    reconcileWorkspaceAccess(repo, io, changed.workspaceId, changed.userId);
    io.to(`workspace:${changed.workspaceId}`).emit('admin:refresh');
    res.json({ ok: true });
  });
}
