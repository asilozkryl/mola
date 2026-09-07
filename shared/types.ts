export type WorkspaceRole = "owner" | "admin" | "moderator" | "member" | "guest";
export interface User {
  id: string;
  name: string;
  email: string;
  color: string;
  role: WorkspaceRole;
  status?: string;
  emailVerified: boolean;
  siteAdmin?: boolean;
  suspended?: boolean;
  isBot?: boolean;
}
export interface Workspace {
  id: string;
  name: string;
  isDemo: boolean;
  suspended?: boolean;
}
export interface WorkspaceMembership extends Workspace {
  role: WorkspaceRole;
  membershipSuspended: boolean;
}
export interface Channel {
  id: string;
  name: string;
  description: string;
  kind: "text" | "voice" | "dm";
  visibility?: "public" | "private";
  memberIds?: string[];
  archived?: boolean;
}
export interface ChannelAccess {
  channel: Channel;
  members: User[];
  canManage: boolean;
  canModerate: boolean;
}
export interface Reaction {
  emoji: string;
  userIds: string[];
}
export interface Attachment {
  id: string;
  name: string;
  size: number;
  mime: string;
  url: string;
}
export interface Message {
  id: string;
  channelId: string;
  userId: string;
  content: string;
  createdAt: string;
  editedAt?: string;
  parentId?: string;
  replyCount: number;
  reactions: Reaction[];
  attachments: Attachment[];
  pinned: boolean;
}
export interface Bootstrap {
  user: User;
  workspace: Workspace;
  workspaces: WorkspaceMembership[];
  channels: Channel[];
  members: User[];
  onlineIds: string[];
  voiceChannels: VoiceChannelRoster[];
  emailVerificationRequired: boolean;
  emailDeliveryAvailable?: boolean;
}
export interface PublicConfig {
  demoEnabled: boolean;
  localMailboxUrl?: string;
  emailDeliveryAvailable?: boolean;
  registrationAvailable?: boolean;
  relayConfigured?: boolean;
}
export interface CallPeer {
  socketId: string;
  user: User;
  mic: boolean;
  camera: boolean;
  sharing: boolean;
}
export interface VoiceChannelRoster {
  channelId: string;
  peers: CallPeer[];
}
export interface VoiceRoster {
  workspaceId: string;
  channels: VoiceChannelRoster[];
}

export type AdminMember = User & {
  joinedAt: string;
  workspaceId?: string;
  workspaceName?: string;
};
export interface AdminInvite {
  id: string;
  createdAt: string;
  expiresAt: string;
  uses: number;
  maxUses: number;
  revoked: boolean;
  createdBy: string;
}
export interface AuditEvent {
  id: string;
  action: string;
  actorName: string;
  targetType: string;
  targetId: string;
  createdAt: string;
  details: string;
}
export interface WorkspaceAdminData {
  workspace: Workspace;
  members: AdminMember[];
  channels: Channel[];
  invites: AdminInvite[];
  audit: AuditEvent[];
  stats: {
    members: number;
    channels: number;
    messages: number;
    storageBytes: number;
  };
  limits: { members: number; channels: number; invites: number; audit: number };
}
export interface SystemAdminData {
  workspaces: (Workspace & {
    ownerName: string;
    memberCount: number;
    messageCount: number;
    storageBytes: number;
  })[];
  users: AdminMember[];
  audit: AuditEvent[];
  pagination: {
    page: number;
    limit: number;
    workspaceTotal: number;
    userTotal: number;
    auditTotal: number;
  };
}
