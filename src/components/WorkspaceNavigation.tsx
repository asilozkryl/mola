import {
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  AudioLines,
  Bell,
  Bookmark,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  FolderPlus,
  GripVertical,
  Hash,
  ListFilter,
  Lock,
  LogOut,
  MoreHorizontal,
  MicOff,
  MessageCircle,
  Pencil,
  Plus,
  Plug,
  Search,
  Settings2,
  ShieldCheck,
  Star,
  Trash2,
  Users,
  Volume2,
  X,
} from "lucide-react";
import type { Bootstrap, CallPeer, Channel } from "../../shared/types";
import type { SidebarChannelGroup, SidebarSection } from "../../shared/sidebar";
import type { useSidebarPreferences } from "../lib/useSidebarPreferences";
import { Avatar, IconButton, Modal } from "./ui";
import {
  ContextMenu,
  type ContextMenuItem,
  type ContextMenuPosition,
} from "./ContextMenu";
import { ProfileIdentity } from "./ProfileIdentity";
import type { WorkspaceMode } from "./WorkspaceSwitcher";
import "./workspace-navigation.css";

type OrderSection = "text" | "voice" | "favorites";
type Preferences = ReturnType<typeof useSidebarPreferences>;
type Props = {
  data: Bootstrap;
  preferences: Preferences;
  connected: boolean;
  unread: Record<string, number>;
  currentId: string;
  view: string;
  savedCount: number;
  activityCount: number;
  canManage: boolean;
  canCreate: boolean;
  voiceChannels: Map<string, CallPeer[]>;
  call: {
    joined: boolean;
    joining: boolean;
    channelId: string | null;
    channelName: string;
  };
  activeMenuId?: string;
  width: number;
  onPreviewWidth: (width: number | null) => void;
  onSelect: (id: string) => void;
  onStartCall: (channel: Channel) => void;
  onCallOpen: () => void;
  onMenu: (
    channel: Channel,
    anchor: HTMLElement,
    position?: ContextMenuPosition,
    section?: OrderSection,
  ) => void;
  onReorder: (section: OrderSection, ids: string[]) => void;
  onGroupsChange: (
    groups: SidebarChannelGroup[],
    textOrder?: string[],
    notice?: string,
  ) => Promise<boolean>;
  onProfile: (id: string) => void;
  onWorkspaces: (mode?: WorkspaceMode) => void;
  onSettings: () => void;
  onWorkspaceSettings: () => void;
  onLeave: () => void;
  onMembers: () => void;
  onNewMessage: () => void;
  onInvite: () => void;
  onNotifications: () => void;
  onHelp: () => void;
  onIntegrations: () => void;
  onSearch: () => void;
  onArchives: () => void;
  onView: (view: "inbox" | "saved" | "messages") => void;
  onCreate: (kind: "text" | "voice") => void;
  onVoicePreview: (id: string) => void;
};

function Section({
  title,
  collapsed,
  count,
  onToggle,
  actions,
  children,
  className = "",
  groupId,
  onDragOver,
  onDrop,
}: {
  title: string;
  collapsed: boolean;
  count: number;
  onToggle: () => void;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  groupId?: string;
  onDragOver?: (event: DragEvent<HTMLElement>) => void;
  onDrop?: (event: DragEvent<HTMLElement>) => void;
}) {
  const id = useId();
  return (
    <section
      className={`nav-section ${className}`}
      data-sidebar-group={groupId}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="nav-section-title">
        <button
          className="nav-section-toggle"
          aria-expanded={!collapsed}
          aria-controls={id}
          aria-label={title}
          onClick={onToggle}
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          <span>{title}</span>
          {collapsed && count > 0 && (
            <span className="count-badge">{count}</span>
          )}
        </button>
        {actions}
      </div>
      <div id={id} hidden={collapsed}>
        {children}
      </div>
    </section>
  );
}

export function WorkspaceNavigation(p: Props) {
  const { data, preferences: prefs } = p;
  const [query, setQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showAllDms, setShowAllDms] = useState(false);
  const [menu, setMenu] = useState<{
    position: ContextMenuPosition;
    anchor: HTMLElement;
    items: ContextMenuItem[];
    label: string;
  } | null>(null);
  const [drop, setDrop] = useState<{
    id: string;
    after: boolean;
    section: OrderSection;
    groupId?: string;
  } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropGroup, setDropGroup] = useState<string | null>(null);
  const [groupDialog, setGroupDialog] = useState<{
    kind: "create" | "rename" | "remove";
    groupId?: string;
    scope: string;
  } | null>(null);
  const [groupName, setGroupName] = useState("");
  const [groupError, setGroupError] = useState("");
  const [groupSaving, setGroupSaving] = useState(false);
  const groupPending = useRef(false);
  const scope = `${data.user.id}:${data.workspace.id}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const mounted = useRef(true);
  const drag = useRef<{
    id: string;
    section: OrderSection;
    scope: string;
  } | null>(null);
  const pointerTarget = useRef<EventTarget | null>(null);
  const suppressClickUntil = useRef(0);
  const resize = useRef<{ x: number; width: number; value: number } | null>(
    null,
  );
  const filterRef = useRef<HTMLInputElement>(null);
  const busy = prefs.loading || prefs.saving || groupSaving;
  const groups = prefs.preferences.channelGroups || [];
  const groupedIds = new Set(groups.flatMap((group) => group.channelIds));
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setGroupDialog(null);
    setGroupError("");
    setMenu(null);
    drag.current = null;
    setDragging(null);
    setDrop(null);
    setDropGroup(null);
  }, [scope]);
  const onlineCount = data.members.filter(
    (u) => !u.suspended && data.onlineIds.includes(u.id),
  ).length;
  const matches = (name: string, id: string) =>
    name
      .toLocaleLowerCase("tr-TR")
      .includes(query.trim().toLocaleLowerCase("tr-TR")) &&
    (!unreadOnly || (p.unread[id] || 0) > 0);
  const textChannels = prefs.orderedTextChannels.filter((c) =>
    matches(c.name, c.id),
  );
  const defaultChannels = textChannels.filter((c) => !groupedIds.has(c.id));
  const voiceChannels = prefs.orderedVoiceChannels.filter((c) =>
    matches(c.name, c.id),
  );
  const favoriteChannels = prefs.favoriteChannels.filter((c) =>
    matches(c.name, c.id),
  );
  const conversations = prefs.conversations
    .map((c) => ({ ...c, user: data.members.find((u) => u.id === c.userId) }))
    .filter(
      (c) =>
        c.user &&
        !c.user.suspended &&
        data.channels.some((ch) => ch.id === c.channelId) &&
        matches(c.user.name, c.channelId),
    );
  const currentDm = data.channels.find(
    (c) => c.id === p.currentId && c.kind === "dm",
  );
  // A newly opened conversation and a local draft stay reachable before the first server message.
  if (currentDm && !conversations.some((c) => c.channelId === currentDm.id)) {
    const user = data.members.find(
      (u) => u.id !== data.user.id && currentDm.memberIds?.includes(u.id),
    );
    if (user && matches(user.name, currentDm.id))
      conversations.unshift({
        channelId: currentDm.id,
        userId: user.id,
        user,
        lastActivityAt: "",
        preview: "",
        hasDraft: false,
      });
  }
  const total = (channels: Channel[]) =>
    channels.reduce((n, c) => n + (p.unread[c.id] || 0), 0);
  const collapsed = (id: SidebarSection) =>
    prefs.preferences.collapsedSections.includes(id);
  function showMenu(
    anchor: HTMLElement,
    items: ContextMenuItem[],
    label: string,
  ) {
    const r = anchor.getBoundingClientRect();
    setMenu({ anchor, position: { x: r.left, y: r.bottom + 4 }, items, label });
  }
  function order(section: OrderSection) {
    return (
      section === "text"
        ? prefs.orderedTextChannels
        : section === "voice"
          ? prefs.orderedVoiceChannels
          : prefs.favoriteChannels
    ).map((c) => c.id);
  }
  function rowMenu(
    c: Channel,
    anchor: HTMLElement,
    section: OrderSection,
    position?: ContextMenuPosition,
  ) {
    setMenu(null);
    p.onMenu(c, anchor, position, section);
  }
  async function saveGroups(
    next: SidebarChannelGroup[],
    textOrder?: string[],
    notice?: string,
  ) {
    if (groupPending.current || prefs.loading || prefs.saving) return false;
    const requestScope = scope;
    groupPending.current = true;
    setGroupSaving(true);
    setGroupError("");
    try {
      const saved = await p.onGroupsChange(next, textOrder, notice);
      if (!saved && mounted.current && scopeRef.current === requestScope)
        setGroupError("Bölüm düzeni kaydedilemedi. Yeniden deneyebilirsin.");
      return saved;
    } catch (error) {
      if (mounted.current && scopeRef.current === requestScope)
        setGroupError(
          error instanceof Error
            ? error.message
            : "Bölüm düzeni kaydedilemedi.",
        );
      return false;
    } finally {
      groupPending.current = false;
      if (mounted.current) setGroupSaving(false);
    }
  }
  function openGroupDialog(
    kind: "create" | "rename" | "remove",
    group?: SidebarChannelGroup,
  ) {
    setGroupName(group?.name || "");
    setGroupError("");
    setGroupDialog({ kind, groupId: group?.id, scope });
  }
  async function submitGroup() {
    if (!groupDialog || groupDialog.scope !== scope || busy) return;
    const dialog = groupDialog;
    const name = groupName.trim();
    if (dialog.kind !== "remove" && !name) {
      setGroupError("Bir bölüm adı yaz.");
      return;
    }
    const current = groups.find((group) => group.id === dialog.groupId);
    if (dialog.kind !== "create" && !current) {
      setGroupError("Bu bölüm artık bulunmuyor.");
      return;
    }
    if (dialog.kind === "create" && groups.length >= 20) {
      setGroupError("En fazla 20 kişisel bölüm oluşturabilirsin.");
      return;
    }
    const next =
      dialog.kind === "create"
        ? [
            ...groups,
            { id: crypto.randomUUID(), name, channelIds: [], collapsed: false },
          ]
        : dialog.kind === "rename"
          ? groups.map((group) =>
              group.id === dialog.groupId ? { ...group, name } : group,
            )
          : groups.filter((group) => group.id !== dialog.groupId);
    const notice =
      dialog.kind === "create"
        ? `${name} bölümü oluşturuldu.`
        : dialog.kind === "rename"
          ? "Bölüm adı güncellendi."
          : "Bölüm kaldırıldı. Kanalların korundu.";
    if (await saveGroups(next, undefined, notice)) {
      if (mounted.current && scopeRef.current === dialog.scope)
        setGroupDialog((active) => (active === dialog ? null : active));
    }
  }
  function endDrag() {
    if (drag.current) suppressClickUntil.current = Date.now() + 300;
    drag.current = null;
    setDragging(null);
    setDrop(null);
    setDropGroup(null);
  }
  function canDrop(section: OrderSection) {
    return (
      !!drag.current &&
      drag.current.scope === scope &&
      drag.current.section === section &&
      !busy &&
      !query &&
      !unreadOnly
    );
  }
  function scrollForDrag(event: DragEvent<HTMLElement>) {
    const scroller = event.currentTarget.closest(".sidebar-content");
    if (!scroller) return;
    const bounds = scroller.getBoundingClientRect();
    if (event.clientY < bounds.top + 40) scroller.scrollTop -= 12;
    else if (event.clientY > bounds.bottom - 40) scroller.scrollTop += 12;
  }
  function moveTextChannel(
    id: string,
    groupId: string,
    anchorId?: string,
    after = false,
  ) {
    if (!prefs.orderedTextChannels.some((channel) => channel.id === id)) return;
    if (groupId !== "default" && !groups.some((group) => group.id === groupId))
      return;
    const nextGroups = groups.map((group) => ({
      ...group,
      channelIds: group.channelIds.filter((channelId) => channelId !== id),
    }));
    const targetGroup = nextGroups.find((group) => group.id === groupId);
    const nextOrder = order("text").filter((channelId) => channelId !== id);
    const targetIds =
      targetGroup?.channelIds ||
      nextOrder.filter(
        (channelId) =>
          !nextGroups.some((group) => group.channelIds.includes(channelId)),
      );
    const groupIndex = anchorId
      ? targetIds.indexOf(anchorId)
      : targetIds.length;
    const previousLast = targetIds.at(-1);
    if (targetGroup) {
      targetGroup.channelIds.splice(
        groupIndex < 0
          ? targetIds.length
          : groupIndex + (anchorId && after ? 1 : 0),
        0,
        id,
      );
      targetGroup.collapsed = false;
    }
    const globalAnchor = anchorId || previousLast;
    const globalIndex = globalAnchor ? nextOrder.indexOf(globalAnchor) : -1;
    nextOrder.splice(
      globalIndex < 0
        ? nextOrder.length
        : globalIndex + (!anchorId || after ? 1 : 0),
      0,
      id,
    );
    if (
      JSON.stringify(nextGroups) === JSON.stringify(groups) &&
      nextOrder.join("\n") === order("text").join("\n")
    )
      return;
    const sourceGroup = groups.find((group) => group.channelIds.includes(id));
    const notice =
      (sourceGroup?.id || "default") === groupId
        ? "Kanal sırası güncellendi."
        : `Kanal ${targetGroup?.name || "Kanallar"} bölümüne taşındı.`;
    void saveGroups(nextGroups, nextOrder, notice);
  }
  function dragOver(
    event: DragEvent<HTMLElement>,
    c: Channel,
    section: OrderSection,
    groupId?: string,
  ) {
    event.stopPropagation();
    if (!canDrop(section) || drag.current?.id === c.id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const r = event.currentTarget.getBoundingClientRect();
    setDrop({
      id: c.id,
      section,
      groupId,
      after: event.clientY > r.top + r.height / 2,
    });
    setDropGroup(null);
    scrollForDrag(event);
  }
  function dropped(
    event: DragEvent<HTMLElement>,
    c: Channel,
    section: OrderSection,
    groupId?: string,
  ) {
    event.stopPropagation();
    event.preventDefault();
    if (!canDrop(section) || !drag.current || drag.current.id === c.id) {
      endDrag();
      return;
    }
    const r = event.currentTarget.getBoundingClientRect();
    const after = event.clientY > r.top + r.height / 2;
    const id = drag.current.id,
      next = order(section).filter((x) => x !== id),
      index = next.indexOf(c.id);
    if (section === "text")
      moveTextChannel(id, groupId || "default", c.id, after);
    else if (index >= 0) {
      next.splice(index + (after ? 1 : 0), 0, id);
      p.onReorder(section, next);
    }
    endDrag();
  }
  function groupDragOver(event: DragEvent<HTMLElement>, groupId: string) {
    if (!canDrop("text")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDrop(null);
    setDropGroup(groupId);
    scrollForDrag(event);
  }
  function groupDropped(event: DragEvent<HTMLElement>, groupId: string) {
    event.preventDefault();
    if (canDrop("text") && drag.current)
      moveTextChannel(drag.current.id, groupId);
    endDrag();
  }
  function channelRow(c: Channel, section: OrderSection, groupId?: string) {
    const peers = p.connected ? p.voiceChannels.get(c.id) || [] : [];
    const voice = c.kind === "voice",
      inCall = (p.call.joined || p.call.joining) && p.call.channelId === c.id;
    const selected = voice
      ? inCall
      : p.currentId === c.id && p.view === "channel";
    return (
      <div
        key={c.id}
        data-channel-id={c.id}
        data-order-section={section}
        draggable={!busy && !query && !unreadOnly}
        className={`live-channel-row ${voice ? "live-voice-row" : "channel-nav-row"} ${selected ? "is-selected" : ""} ${dragging === `${section}:${c.id}` ? "is-dragging" : ""} ${drop?.id === c.id && drop.section === section && drop.groupId === groupId ? (drop.after ? "drop-after" : "drop-before") : ""}`}
        onPointerDownCapture={(e) => {
          pointerTarget.current = e.target;
          if (!drag.current) suppressClickUntil.current = 0;
        }}
        onClickCapture={(e) => {
          if (Date.now() < suppressClickUntil.current) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onDragStart={(e) => {
          const target =
            pointerTarget.current instanceof Element
              ? pointerTarget.current
              : e.target instanceof Element
                ? e.target
                : null;
          if (
            busy ||
            query ||
            unreadOnly ||
            target?.closest(
              ".channel-row-menu, .live-voice-details, .profile-identity",
            )
          ) {
            e.preventDefault();
            return;
          }
          drag.current = { id: c.id, section, scope };
          setDragging(`${section}:${c.id}`);
          setMenu(null);
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", c.id);
          e.dataTransfer.setDragImage(e.currentTarget, 30, 15);
        }}
        onDragEnd={endDrag}
        onContextMenu={(e) => {
          e.preventDefault();
          rowMenu(
            c,
            e.currentTarget.querySelector<HTMLElement>(".channel-nav") ||
              e.currentTarget,
            section,
            { x: e.clientX, y: e.clientY },
          );
        }}
        onDragOver={(e) => dragOver(e, c, section, groupId)}
        onDrop={(e) => dropped(e, c, section, groupId)}
      >
        <button
          className="channel-drag-handle"
          type="button"
          aria-label={`${c.name} kanalını sırala`}
          title="Sürükleyerek sırala veya menüyü aç"
          disabled={busy || Boolean(query) || unreadOnly}
          draggable={!busy && !query && !unreadOnly}
          onClick={(e) => rowMenu(c, e.currentTarget, section)}
        >
          <GripVertical size={13} />
        </button>
        <button
          className={`channel-nav ${voice ? "voice-nav" : ""} ${selected ? "selected" : ""} ${voice && p.call.joined && inCall ? "voice-active" : ""}`}
          aria-label={c.name}
          draggable={!busy && !query && !unreadOnly}
          aria-current={selected ? "page" : undefined}
          data-unread={(p.unread[c.id] || 0) > 0}
          title={c.description ? `${c.name} — ${c.description}` : c.name}
          onClick={() => (voice ? p.onStartCall(c) : p.onSelect(c.id))}
          onKeyDown={(e) => {
            if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
              e.preventDefault();
              e.stopPropagation();
              rowMenu(c, e.currentTarget, section);
            }
          }}
        >
          {voice ? (
            <Volume2 size={17} />
          ) : c.visibility === "private" ? (
            <Lock size={15} />
          ) : (
            <Hash size={17} />
          )}
          <span className="live-channel-name">{c.name}</span>
          {!voice && (p.unread[c.id] || 0) > 0 && (
            <span className="count-badge">{p.unread[c.id]}</span>
          )}
          {inCall && <span className="small-status-dot" />}
        </button>
        <button
          type="button"
          className="icon-button channel-row-menu"
          aria-label={`${c.name} kanal işlemleri`}
          aria-haspopup="menu"
          aria-expanded={p.activeMenuId === c.id}
          onClick={(e) => rowMenu(c, e.currentTarget, section)}
        >
          <MoreHorizontal size={16} />
        </button>
        {voice && (
          <div
            className={`live-voice-details ${peers.length ? "has-peers" : ""}`}
          >
            <div
              className="live-voice-avatars"
              role="list"
              aria-label={`${c.name} katılımcıları`}
            >
              {peers.slice(0, 3).map((peer) => (
                <div
                  key={peer.socketId}
                  className="live-voice-peer"
                  role="listitem"
                  aria-label={peer.user.name}
                >
                  <ProfileIdentity
                    user={peer.user}
                    online
                    connected={p.connected}
                    selfId={data.user.id}
                    onOpen={p.onProfile}
                  >
                    <Avatar user={peer.user} size="tiny" />
                  </ProfileIdentity>
                  {!peer.mic && (
                    <span
                      className="live-voice-muted"
                      role="img"
                      aria-label={`${peer.user.name}: mikrofon kapalı`}
                    >
                      <MicOff size={9} />
                    </span>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              className="live-voice-members"
              aria-label={`${c.name} katılımcılarını gör`}
              onClick={() => p.onVoicePreview(c.id)}
            >
              {peers.length ? (
                `${peers.length} kişi odada`
              ) : (
                <>
                  <Users size={15} />
                  <span className="visually-hidden">Katılımcılar</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    );
  }
  function sectionActions(kind: "text" | "voice") {
    return (
      <div className="live-section-actions">
        <button
          type="button"
          className="icon-button"
          aria-label={`${kind === "text" ? "Kanallar" : "Sesli odalar"} bölüm işlemleri`}
          aria-haspopup="menu"
          onClick={(e) =>
            showMenu(
              e.currentTarget,
              [
                ...(kind === "text"
                  ? [
                      {
                        label: "Bölüm oluştur",
                        icon: <FolderPlus size={16} />,
                        onSelect: () => openGroupDialog("create"),
                        disabled: busy || groups.length >= 20,
                      },
                    ]
                  : []),
                {
                  label: "Arşivlenmiş kanallar",
                  icon: <Archive size={16} />,
                  onSelect: p.onArchives,
                },
                {
                  label: editing
                    ? "Düzenlemeyi bitir"
                    : "Kenar çubuğunu düzenle",
                  icon: <GripVertical size={16} />,
                  onSelect: () => setEditing(!editing),
                },
              ],
              "Bölüm işlemleri",
            )
          }
        >
          <MoreHorizontal size={15} />
        </button>
        <IconButton
          label={kind === "text" ? "Kanal oluştur" : "Sesli oda oluştur"}
          disabled={!p.canCreate}
          onClick={() => p.onCreate(kind)}
        >
          <Plus size={16} />
        </IconButton>
      </div>
    );
  }
  function groupActions(group: SidebarChannelGroup, index: number) {
    const moveGroup = (offset: number) => {
      const next = [...groups];
      next.splice(index, 1);
      next.splice(index + offset, 0, group);
      void saveGroups(next, undefined, "Bölüm sırası güncellendi.");
    };
    return (
      <div className="live-section-actions">
        <button
          type="button"
          className="icon-button"
          aria-label={`${group.name} bölüm işlemleri`}
          aria-haspopup="menu"
          onClick={(e) =>
            showMenu(
              e.currentTarget,
              [
                {
                  label: "Bölüm adını düzenle",
                  icon: <Pencil size={15} />,
                  disabled: busy,
                  onSelect: () => openGroupDialog("rename", group),
                },
                {
                  label: "Bölümü yukarı taşı",
                  icon: <ArrowUp size={15} />,
                  disabled: busy || index === 0,
                  onSelect: () => moveGroup(-1),
                },
                {
                  label: "Bölümü aşağı taşı",
                  icon: <ArrowDown size={15} />,
                  disabled: busy || index === groups.length - 1,
                  onSelect: () => moveGroup(1),
                },
                {
                  label: "Bölümü kaldır",
                  icon: <Trash2 size={15} />,
                  disabled: busy,
                  separatorBefore: true,
                  onSelect: () => openGroupDialog("remove", group),
                },
              ],
              `${group.name} bölüm işlemleri`,
            )
          }
        >
          <MoreHorizontal size={15} />
        </button>
      </div>
    );
  }
  return (
    <>
      <button
        className="workspace-heading"
        aria-label="Çalışma alanı menüsü"
        aria-haspopup="menu"
        onClick={(e) =>
          showMenu(
            e.currentTarget,
            [
              {
                label: "Çalışma alanlarını değiştir",
                icon: <Users size={16} />,
                onSelect: () => p.onWorkspaces(),
              },
              {
                label: "Çalışma alanı oluştur",
                icon: <Plus size={16} />,
                onSelect: () => p.onWorkspaces("create"),
                disabled: data.workspace.isDemo,
              },
              {
                label: "Davet ile katıl",
                icon: <Plus size={16} />,
                onSelect: () => p.onWorkspaces("join"),
                disabled: data.workspace.isDemo,
              },
              {
                label: "Üyeler",
                icon: <Users size={16} />,
                onSelect: p.onMembers,
                separatorBefore: true,
              },
              ...(p.canManage
                ? [
                    {
                      label: "Çalışma alanına davet et",
                      icon: <Plus size={16} />,
                      onSelect: p.onInvite,
                    },
                    {
                      label: "Çalışma alanı ayarları",
                      icon: <Settings2 size={16} />,
                      onSelect: p.onWorkspaceSettings,
                    },
                    {
                      label: "Entegrasyonlar",
                      icon: <Plug size={16} />,
                      onSelect: p.onIntegrations,
                    },
                  ]
                : []),
              ...(data.user.role === "owner"
                ? [
                    {
                      label: "Sahipliği devret",
                      icon: <ShieldCheck size={16} />,
                      onSelect: p.onWorkspaceSettings,
                      disabled: data.workspace.isDemo,
                    },
                  ]
                : [
                    {
                      label: "Çalışma alanından ayrıl",
                      icon: <LogOut size={16} />,
                      onSelect: p.onLeave,
                      disabled: data.workspace.isDemo,
                      danger: true,
                      separatorBefore: true,
                    },
                  ]),
            ],
            "Çalışma alanı menüsü",
          )
        }
      >
        <span>
          <strong title={data.workspace.name}>{data.workspace.name}</strong>
          <small>
            <span
              className={`small-status-dot ${p.connected ? "" : "disconnected"}`}
            />
            {data.workspace.isDemo
              ? "Sana özel örnek alan"
              : `${data.members.filter((u) => !u.suspended).length} üye${p.connected ? ` · ${onlineCount} çevrimiçi` : " · Bağlanılıyor"}`}
          </small>
        </span>
        <ChevronDown size={16} />
      </button>
      <div
        className={`sidebar-content live-sidebar-content ${editing ? "sidebar-editing" : ""}`}
      >
        <button
          className="sidebar-search"
          aria-label="Çalışma alanında ara"
          onClick={p.onSearch}
        >
          <Search size={16} />
          <span>Mesajlarda ara</span>
          <kbd>
            {/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl"} K
          </kbd>
        </button>
        <nav className="primary-nav" aria-label="Kişisel alanın">
          <button
            className={p.view === "messages" ? "selected" : ""}
            aria-label="Özel mesajlar"
            aria-current={p.view === "messages" ? "page" : undefined}
            onClick={() => p.onView("messages")}
          >
            <MessageCircle size={18} />
            <span>Özel mesajlar</span>
            {data.channels
              .filter((c) => c.kind === "dm")
              .reduce((n, c) => n + (p.unread[c.id] || 0), 0) > 0 && (
              <span className="count-badge">
                {data.channels
                  .filter((c) => c.kind === "dm")
                  .reduce((n, c) => n + (p.unread[c.id] || 0), 0)}
              </span>
            )}
          </button>
          <button
            className={p.view === "inbox" ? "selected" : ""}
            aria-label="Aktivite"
            aria-current={p.view === "inbox" ? "page" : undefined}
            onClick={() => p.onView("inbox")}
          >
            <Bell size={18} />
            <span>Aktivite</span>
            {p.activityCount > 0 && (
              <span className="count-badge">{p.activityCount}</span>
            )}
          </button>
          <button
            className={p.view === "saved" ? "selected" : ""}
            aria-current={p.view === "saved" ? "page" : undefined}
            onClick={() => p.onView("saved")}
          >
            <Bookmark size={17} />
            <span>Kaydedilenler</span>
            {p.savedCount > 0 && <small>{p.savedCount}</small>}
          </button>
        </nav>
        <div className="sidebar-list-tools">
          <button
            className={unreadOnly ? "filter-active" : ""}
            aria-pressed={unreadOnly}
            onClick={() => setUnreadOnly(!unreadOnly)}
          >
            <ListFilter size={13} />
            {unreadOnly ? "Okunmamış" : "Tüm konuşmalar"}
          </button>
          <button
            className="icon-button"
            aria-label="Kanal veya kişi bul"
            aria-expanded={filterOpen}
            onClick={() => {
              setFilterOpen(!filterOpen);
              if (filterOpen) setQuery("");
              else requestAnimationFrame(() => filterRef.current?.focus());
            }}
          >
            <Search size={14} />
          </button>
          <button
            className="icon-button sidebar-edit-toggle"
            aria-label={
              editing ? "Düzenlemeyi bitir" : "Kenar çubuğunu düzenle"
            }
            aria-pressed={editing}
            onClick={() => setEditing(!editing)}
          >
            <GripVertical size={14} />
          </button>
        </div>
        {filterOpen && (
          <label className="sidebar-list-search">
            <input
              ref={filterRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Kanal veya kişi bul…"
              aria-label="Kanal veya kişi bul"
            />
            <button
              className="icon-button"
              aria-label="Kanal filtresini temizle"
              onClick={() => {
                setQuery("");
                filterRef.current?.focus();
              }}
            >
              <X size={14} />
            </button>
          </label>
        )}
        {editing && (
          <p className="sidebar-edit-note">
            Sürükleyerek veya kanal menüsündeki taşıma eylemleriyle sırala.
          </p>
        )}
        {prefs.error && (
          <div className="sidebar-feedback" role="alert">
            {prefs.error}
            <button onClick={() => void prefs.reload()}>Yeniden dene</button>
          </div>
        )}
        {groupError && !groupDialog && !prefs.error && (
          <p className="sidebar-feedback" role="alert">
            {groupError}
          </p>
        )}
        {favoriteChannels.length > 0 && (
          <Section
            title="Favoriler"
            collapsed={collapsed("favorites")}
            onToggle={() => void prefs.toggleSection("favorites")}
            count={total(favoriteChannels)}
            actions={<Star size={13} className="favorite-section-icon" />}
          >
            {favoriteChannels.map((c) => channelRow(c, "favorites"))}
          </Section>
        )}
        <Section
          title="Kanallar"
          groupId="default"
          className={`sidebar-channel-group ${dropGroup === "default" ? "is-drop-target" : ""}`}
          onDragOver={(e) => groupDragOver(e, "default")}
          onDrop={(e) => groupDropped(e, "default")}
          collapsed={collapsed("channels")}
          onToggle={() => void prefs.toggleSection("channels")}
          count={total(defaultChannels)}
          actions={sectionActions("text")}
        >
          {defaultChannels.map((c) => channelRow(c, "text", "default"))}
          {!defaultChannels.length && !query && !unreadOnly && (
            <p className="sidebar-group-dropzone">
              {groups.length
                ? "Kanalları buraya sürükle"
                : "Henüz metin kanalı yok."}
            </p>
          )}
        </Section>
        {groups.map((group, index) => {
          const channels = group.channelIds.flatMap((id) => {
            const channel = textChannels.find((item) => item.id === id);
            return channel ? [channel] : [];
          });
          if ((query || unreadOnly) && !channels.length) return null;
          return (
            <Section
              key={group.id}
              title={group.name}
              groupId={group.id}
              className={`sidebar-channel-group ${dropGroup === group.id ? "is-drop-target" : ""}`}
              collapsed={group.collapsed}
              count={total(channels)}
              onToggle={() => {
                if (!busy)
                  void saveGroups(
                    groups.map((item) =>
                      item.id === group.id
                        ? { ...item, collapsed: !item.collapsed }
                        : item,
                    ),
                    undefined,
                    group.collapsed
                      ? `${group.name} bölümü açıldı.`
                      : `${group.name} bölümü daraltıldı.`,
                  );
              }}
              actions={groupActions(group, index)}
              onDragOver={(e) => groupDragOver(e, group.id)}
              onDrop={(e) => groupDropped(e, group.id)}
            >
              {channels.map((channel) => channelRow(channel, "text", group.id))}
              {!channels.length && (
                <p className="sidebar-group-dropzone">
                  Kanalları buraya sürükle
                </p>
              )}
            </Section>
          );
        })}
        <Section
          title="Sesli odalar"
          className="voice-section"
          collapsed={collapsed("voice")}
          onToggle={() => void prefs.toggleSection("voice")}
          count={total(voiceChannels)}
          actions={sectionActions("voice")}
        >
          {voiceChannels.map((c) => channelRow(c, "voice"))}
          {!p.connected && (
            <p className="voice-nav-note">
              Katılımcı listesi için bağlanılıyor…
            </p>
          )}
        </Section>
        <Section
          title="Direkt mesajlar"
          className="dm-section"
          collapsed={collapsed("dms")}
          onToggle={() => void prefs.toggleSection("dms")}
          count={conversations.reduce(
            (n, c) => n + (p.unread[c.channelId] || 0),
            0,
          )}
          actions={
            <IconButton label="Yeni direkt mesaj" onClick={p.onNewMessage}>
              <Plus size={16} />
            </IconButton>
          }
        >
          {(showAllDms ? conversations : conversations.slice(0, 5)).map((c) => (
            <div className="dm-nav-row" key={c.channelId}>
              <button
                className={`channel-nav dm-nav ${p.currentId === c.channelId && p.view === "channel" ? "selected" : ""}`}
                aria-current={
                  p.currentId === c.channelId && p.view === "channel"
                    ? "page"
                    : undefined
                }
                title={c.hasDraft ? `${c.user!.name} · Taslak` : c.user!.name}
                onClick={() => p.onSelect(c.channelId)}
              >
                <span>{c.user!.name}</span>
                {c.hasDraft && <small className="dm-draft">Taslak</small>}
                {(p.unread[c.channelId] || 0) > 0 && (
                  <span className="count-badge">{p.unread[c.channelId]}</span>
                )}
              </button>
              <ProfileIdentity
                className="dm-profile-avatar"
                user={c.user!}
                online={data.onlineIds.includes(c.userId)}
                connected={p.connected}
                selfId={data.user.id}
                onOpen={p.onProfile}
              >
                <Avatar
                  user={c.user!}
                  size="tiny"
                  online={p.connected && data.onlineIds.includes(c.userId)}
                />
              </ProfileIdentity>
            </div>
          ))}
          {conversations.length > 5 && (
            <button
              className="add-channel"
              onClick={() => p.onView("messages")}
            >
              Tüm konuşmalar
            </button>
          )}
          {!conversations.length && !prefs.conversationsLoading && (
            <p className="sidebar-empty-note">
              {query || unreadOnly
                ? "Eşleşen konuşma yok."
                : "Son konuşmaların burada görünecek."}
            </p>
          )}
          {prefs.conversationsError && (
            <p className="sidebar-feedback" role="alert">
              {prefs.conversationsError}
              <button onClick={() => void prefs.reload()}>Yeniden dene</button>
            </p>
          )}
        </Section>
        {(query || unreadOnly) &&
          !textChannels.length &&
          !voiceChannels.length &&
          !favoriteChannels.length &&
          !conversations.length && (
            <button
              className="sidebar-clear-filter"
              onClick={() => {
                setQuery("");
                setUnreadOnly(false);
              }}
            >
              Eşleşme yok. Filtreleri temizle
            </button>
          )}
      </div>
      <div className="sidebar-bottom live-sidebar-bottom">
        {p.call.joined && (
          <button className="active-call-banner" onClick={p.onCallOpen}>
            <AudioLines size={20} />
            <span>
              <strong>Sesli görüşmedesin</strong>
              <small>{p.call.channelName}</small>
            </span>
            <ChevronRight size={16} />
          </button>
        )}
        <div className="sidebar-account">
          <button
            className="sidebar-account-profile"
            title="Profil ve ayarlar"
            onClick={p.onSettings}
          >
            <Avatar user={data.user} size="small" online={p.connected} />
            <span>
              <strong>{data.user.name}</strong>
              <small>
                <span
                  className={`small-status-dot ${p.connected ? "" : "disconnected"}`}
                />
                {p.connected
                  ? data.user.status || "Her şey güncel"
                  : "Yeniden bağlanılıyor"}
              </small>
            </span>
          </button>
          <IconButton
            label="Bildirimler ve uygulama"
            onClick={p.onNotifications}
          >
            <Bell size={18} />
          </IconButton>
          <IconButton label="Hesap ve uygulama ayarları" onClick={p.onSettings}>
            <Settings2 size={18} />
          </IconButton>
        </div>
        <div className="sidebar-mobile-tools">
          <button onClick={() => p.onWorkspaces()}>
            <Users size={14} />
            Çalışma alanları
          </button>
          <button onClick={p.onHelp}>
            <CircleHelp size={14} />
            Yardım
          </button>
        </div>
      </div>
      <div
        role="separator"
        className="sidebar-resizer"
        aria-label="Sol menü genişliği"
        aria-orientation="vertical"
        aria-valuemin={240}
        aria-valuemax={340}
        aria-valuenow={p.width}
        tabIndex={0}
        title="Sürükleyerek genişlet · Çift tıkla sıfırla"
        onPointerDown={(e) => {
          if (busy || e.button !== 0) return;
          resize.current = { x: e.clientX, width: p.width, value: p.width };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!resize.current) return;
          resize.current.value = Math.max(
            240,
            Math.min(340, resize.current.width + e.clientX - resize.current.x),
          );
          p.onPreviewWidth(resize.current.value);
        }}
        onPointerUp={(e) => {
          if (!resize.current) return;
          const value = resize.current.value,
            changed = value !== resize.current.width;
          resize.current = null;
          e.currentTarget.releasePointerCapture(e.pointerId);
          if (changed)
            void prefs.setWidth(value).finally(() => p.onPreviewWidth(null));
          else p.onPreviewWidth(null);
        }}
        onPointerCancel={() => {
          resize.current = null;
          p.onPreviewWidth(null);
        }}
        onLostPointerCapture={() => {
          if (resize.current) {
            resize.current = null;
            p.onPreviewWidth(null);
          }
        }}
        onDoubleClick={() => {
          if (!busy) void prefs.setWidth(272);
        }}
        onKeyDown={(e) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
            return;
          e.preventDefault();
          if (!busy)
            void prefs.setWidth(
              e.key === "Home"
                ? 240
                : e.key === "End"
                  ? 340
                  : Math.max(
                      240,
                      Math.min(
                        340,
                        p.width + (e.key === "ArrowRight" ? 10 : -10),
                      ),
                    ),
            );
        }}
      />
      <ContextMenu
        position={menu?.position || null}
        items={menu?.items || []}
        returnFocus={menu?.anchor}
        label={menu?.label}
        onClose={() => setMenu(null)}
      />
      {groupDialog?.scope === scope && (
        <Modal
          title={
            groupDialog.kind === "create"
              ? "Bölüm oluştur"
              : groupDialog.kind === "rename"
                ? "Bölüm adını düzenle"
                : "Bölümü kaldır"
          }
          onClose={() => {
            if (!groupSaving) setGroupDialog(null);
          }}
        >
          <form
            className="sidebar-group-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submitGroup();
            }}
          >
            {groupDialog.kind === "remove" ? (
              <p>
                <strong>
                  {
                    groups.find((group) => group.id === groupDialog.groupId)
                      ?.name
                  }
                </strong>{" "}
                bölümü yalnız senin kenar çubuğundan kaldırılacak. Kanallar ve
                mesajlar korunur; bu bölümdeki kanallar{" "}
                <strong>Kanallar</strong> bölümüne döner.
              </p>
            ) : (
              <>
                <p>
                  Kanallarını sana uygun başlıklar altında topla. Bu düzen
                  yalnız sana görünür.
                </p>
                <label>
                  Bölüm adı
                  <input
                    data-autofocus
                    value={groupName}
                    maxLength={48}
                    required
                    onChange={(e) => setGroupName(e.target.value)}
                    placeholder="Örn. Ürün ekibi"
                    disabled={groupSaving}
                  />
                </label>
                <span className="sidebar-group-name-count" aria-hidden="true">
                  {groupName.length}/48
                </span>
              </>
            )}
            {groupError && (
              <p className="sidebar-group-error" role="alert">
                {groupError}
              </p>
            )}
            <div className="sidebar-group-form-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={groupSaving}
                onClick={() => setGroupDialog(null)}
              >
                Vazgeç
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={
                  busy || (groupDialog.kind !== "remove" && !groupName.trim())
                }
              >
                {groupSaving
                  ? "Kaydediliyor…"
                  : groupDialog.kind === "create"
                    ? "Oluştur"
                    : groupDialog.kind === "rename"
                      ? "Kaydet"
                      : "Bölümü kaldır"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
