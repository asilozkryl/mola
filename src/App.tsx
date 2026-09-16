import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type CSSProperties,
} from "react";
import { io, type Socket } from "socket.io-client";
import {
  ArrowDown,
  ArrowUp,
  Star,
  StarOff,
  ArrowLeft,
  ArrowRight,
  Archive,
  ArchiveRestore,
  AudioLines,
  Bell,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Copy,
  FileText,
  Hash,
  Headphones,
  Info,
  LayoutGrid,
  LoaderCircle,
  LogOut,
  Menu,
  MessageCircle,
  MessageSquare,
  MonitorUp,
  MoreHorizontal,
  Plus,
  Pencil,
  Search,
  Settings2,
  ShieldCheck,
  Users,
  Trash2,
  Video,
  Volume2,
  VolumeX,
  X,
  Pin,
  Lock,
  Plug,
  WifiOff,
} from "lucide-react";
import type {
  Bootstrap,
  AccountBootstrap,
  SessionBootstrap,
  Channel,
  Message,
  PublicConfig,
  User,
  Workspace,
} from "../shared/types";
import { api, bootstrap, post, ApiError, setApiWorkspace } from "./lib/api";
import {
  appRouteAddress,
  readAppRoute,
  type AppRoute,
  type ConversationTab,
} from "./lib/navigation";
import {
  conversationIdentity,
  getConversationMembers,
} from "./lib/conversationIdentity";
import { ChannelCollections } from "./components/ChannelCollections";
import { SearchDialog } from "./components/SearchDialog";
import {
  AttachmentPreview,
  type AttachmentPreviewTarget,
} from "./components/AttachmentPreview";
import type { MessageHistoryPage } from "../shared/collection-types";
import { SavedMessages } from "./components/SavedMessages";
import { useSavedMessages } from "./lib/useSavedMessages";
import { WorkspaceNavigation } from "./components/WorkspaceNavigation";
import { useSidebarPreferences } from "./lib/useSidebarPreferences";
import { useWorkspaceOrder } from "./lib/useWorkspaceOrder";
import { WorkspaceRailList } from "./components/WorkspaceRailList";
import { WorkspaceAvatar } from "./components/WorkspaceAvatar";
import type { SidebarOrder, SidebarChannelGroup } from "../shared/sidebar";
import { ChannelGroupMove } from "./components/ChannelGroupMove";
import {
  AccountOnlyHome,
  WorkspaceLifecycleDialog,
} from "./components/WorkspaceLifecycle";
import { Auth } from "./components/Auth";
import {
  AccountRecovery,
  VerificationGate,
} from "./components/AccountRecovery";
import { clearAuthLink, readAuthLink, type AuthLink } from "./lib/auth-links";
import {
  Avatar,
  dateLabel,
  IconButton,
  Logo,
  Modal,
  RichText,
  Spinner,
} from "./components/ui";
import { Composer } from "./components/Composer";
import { MessageItem } from "./components/MessageItem";
import {
  ContextMenu,
  type ContextMenuPosition,
} from "./components/ContextMenu";
import ChannelActionsDialog, {
  type ChannelActionMode,
} from "./components/ChannelActionsDialog";
import "./components/channel-navigation.css";
import { useCall } from "./lib/useCall";
import { useMobileNavigation } from "./lib/useMobileNavigation";
import {
  useMessageActivity,
  messageScrollBehavior,
} from "./lib/useMessageActivity";
import { usePushSubscription } from "./lib/usePushSubscription";
import { CallPanel } from "./components/CallPanel";
import { CallSetup } from "./components/CallSetup";
import { IncomingCallTransfer } from "./components/CallTransfer";
import { DesktopDownloads } from "./components/DesktopDownloads";
import ChannelAccessDialog from "./components/ChannelAccessDialog";
import { ActivityCenter } from "./components/ActivityCenter";
import { DirectMessagesCenter } from "./components/DirectMessagesCenter";
import {
  DirectConversationIdentity,
  DirectConversationIntro,
} from "./components/DirectConversation";
import IntegrationsDialog from "./components/IntegrationsDialog";
import { NotificationSettings } from "./components/NotificationSettings";
import { ChannelNotificationPreferences } from "./components/NotificationPreferencesPanel";
import type { NotificationState } from "../shared/collaboration-types";
import { SettingsDialog } from "./components/SettingsDialog";
import { ProfileIdentity } from "./components/ProfileIdentity";
import ProfilePage from "./components/ProfilePage";
import "./components/profile-navigation.css";
import { shouldGroupMessage } from "./lib/messageGrouping";
import AdminPanel from "./components/AdminPanel";
import {
  WorkspaceSwitcher,
  type WorkspaceAction,
  type WorkspaceMode,
} from "./components/WorkspaceSwitcher";
import { VoiceRoomPreview } from "./components/VoiceParticipants";

type Dialog =
  | "workspaces"
  | "channel"
  | "invite"
  | "settings"
  | "search"
  | "help"
  | "members"
  | "info"
  | "notifications"
  | "integrations"
  | "archives"
  | "move-channel"
  | null;
type View = "channel" | "saved" | "inbox" | "profile" | "messages";
let initialBootstrap: Promise<SessionBootstrap | null> | undefined;
const uniqueMessages = (list: Message[]) =>
  [...new Map(list.map((m) => [m.id, m])).values()].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );

export default function App() {
  if (
    window.location.pathname === "/download" ||
    window.location.pathname === "/download/"
  )
    return <DesktopDownloads />;
  return <WorkspaceApp />;
}

function WorkspaceApp() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [accountData, setAccountData] = useState<AccountBootstrap | null>(null);
  const accountRef = useRef(accountData);
  accountRef.current = accountData;
  const [workspaceLifecycle, setWorkspaceLifecycle] = useState<
    "delete" | "leave" | null
  >(null);
  const [adminSection, setAdminSection] = useState<"settings" | undefined>();
  const [bootstrapRevision, setBootstrapRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState("");
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [emailDeliveryAvailable, setEmailDeliveryAvailable] = useState(true);
  const [registrationAvailable, setRegistrationAvailable] = useState(true);
  const [mailbox, setMailbox] = useState<string>();
  const [authLink, setAuthLink] = useState(readAuthLink);
  const verificationPending = Boolean(
    (data || accountData)?.emailVerificationRequired &&
    !(data || accountData)?.user.emailVerified,
  );
  usePushSubscription(
    data?.user.id,
    data?.workspace.id,
    bootstrapRevision,
    Boolean(
      data &&
      !verificationPending &&
      !authLink &&
      !data.user.suspended &&
      !data.workspace.suspended,
    ),
  );
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [channelId, setChannelId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyRetry, setHistoryRetry] = useState(0);
  const historyRequest = useRef(0);
  const historyPending = useRef(false);
  const [repliesHasMore, setRepliesHasMore] = useState(false);
  const [replyCursor, setReplyCursor] = useState<string | null>(null);
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState("");
  const [replyRetry, setReplyRetry] = useState(0);
  const replyRequest = useRef(0);
  const replyPending = useRef(false);
  const [preview, setPreview] = useState<AttachmentPreviewTarget | null>(null);
  const previewRef = useRef(preview);
  previewRef.current = preview;
  const [collectionVersion, setCollectionVersion] = useState(0);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [channelToMove, setChannelToMove] = useState<string | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("list");
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceOrderEditing, setWorkspaceOrderEditing] = useState(false);
  const [workspaceTarget, setWorkspaceTarget] = useState<string>();
  const [workspaceInvite, setWorkspaceInvite] = useState("");
  const [voicePreviewId, setVoicePreviewId] = useState<string | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [view, setView] = useState<View>("channel");
  const [profileId, setProfileId] = useState<string | null>(null);
  const profileReturn = useRef<{
    view: Exclude<View, "profile">;
    scrollTop: number;
    route: AppRoute;
  } | null>(null);
  const routeSequence = useRef(0);
  const appliedAddress = useRef("");
  const routeScroll = useRef<{
    sequence: number;
    channelId: string;
    top: number;
  } | null>(null);
  const [tab, setTab] = useState<"chat" | "files" | "pins">("chat");
  const [mobileNav, setMobileNav] = useState(false);
  const { isMobile, sidebarRef, triggerRef } = useMobileNavigation(
    mobileNav,
    setMobileNav,
  );
  const [directPending, setDirectPending] = useState(false);
  const [memberScope, setMemberScope] = useState<
    "workspace" | "channel" | "dm"
  >("workspace");
  const [memberQuery, setMemberQuery] = useState("");
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const { freshIds, pendingCount, received, clearPending, forget } =
    useMessageActivity(`${data?.user.id}:${data?.workspace.id}:${channelId}`);
  const [thread, setThread] = useState<Message | null>(null);
  const [linkedReply, setLinkedReply] = useState<Message | null>(null);
  const [replies, setReplies] = useState<Message[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [toast, setToast] = useState("");
  const [toastError, setToastError] = useState(false);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [notificationState, setNotificationState] =
    useState<NotificationState | null>(null);
  const [notificationError, setNotificationError] = useState("");
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [showCall, setShowCall] = useState(false);
  const [callSetupChannel, setCallSetupChannel] = useState<Channel | null>(
    null,
  );
  const [callSwitchTarget, setCallSwitchTarget] = useState<Channel | null>(
    null,
  );
  const [createChannelKind, setCreateChannelKind] = useState<"text" | "voice">(
    "text",
  );
  const [channelAccess, setChannelAccess] = useState<Channel | null>(null);
  const [notificationSettingsRevision, setNotificationSettingsRevision] =
    useState(0);
  const [channelNotifications, setChannelNotifications] = useState<{
    channelId: string;
    workspaceId: string;
    userId: string;
  } | null>(null);
  const [channelMenu, setChannelMenu] = useState<{
    channelId: string;
    position: ContextMenuPosition;
    anchor: HTMLElement;
    workspaceId: string;
    userId: string;
    section?: SidebarOrder;
  } | null>(null);
  const [channelAction, setChannelAction] = useState<{
    channel: Channel;
    mode: ChannelActionMode;
    workspaceId: string;
    userId: string;
  } | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState<{
    scope: string;
    width: number;
  } | null>(null);
  const [sidebarUndo, setSidebarUndo] = useState<{
    scope: string;
    section: SidebarOrder;
    ids: string[];
    groups?: SidebarChannelGroup[];
    notice?: string;
  } | null>(null);
  const [quiet, setQuiet] = useState(
    localStorage.getItem("mola:quiet") === "true",
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef(channelId);
  const threadRef = useRef(thread);
  const typingSent = useRef(0);
  const highlightRef = useRef<string | null>(null);
  const quietRef = useRef(quiet);
  const viewRef = useRef(view);
  const tabRef = useRef(tab);
  quietRef.current = quiet;
  viewRef.current = view;
  tabRef.current = tab;
  channelRef.current = channelId;
  threadRef.current = thread;
  const dataRef = useRef(data);
  dataRef.current = data;
  const accessVersion = useRef(0);
  const liveMemberRevision = useRef(0);
  const liveMemberUpdates = useRef(
    new Map<string, { revision: number; user: User }>(),
  );
  const workspaceChanging = useRef(false);
  const call = useCall({
    socket,
    user: data?.user || null,
    workspaceId: data?.workspace.id || null,
    initialVoiceChannels: data?.voiceChannels,
  });
  const callRef = useRef(call);
  callRef.current = call;
  const socketRef = useRef(socket);
  socketRef.current = socket;
  const notify = useCallback((message: string, error = false) => {
    setToast(message);
    setToastError(error);
  }, []);
  const fail = useCallback(
    (message: string) => notify(message, true),
    [notify],
  );
  useEffect(() => {
    if (!call.transferNotice) return;
    notify(call.transferNotice.message, call.transferNotice.error);
    call.clearTransferNotice();
  }, [call.transferNotice, call.clearTransferNotice, notify]);
  const savedState = useSavedMessages({
    userId: data?.user.id || "",
    workspaceId: data?.workspace.id || "",
    active: view === "saved",
    channels: data?.channels || [],
    socket,
    onError: fail,
    enabled: Boolean(
      data &&
      !verificationPending &&
      !authLink &&
      !data.user.suspended &&
      !data.workspace.suspended,
    ),
  });
  const acceptData = useCallback(
    (next: SessionBootstrap, preserveRoute = false) => {
      if (next.accountOnly) {
        liveMemberUpdates.current.clear();
        accessVersion.current += 1;
        callRef.current.leave();
        socketRef.current?.removeAllListeners();
        socketRef.current?.disconnect();
        socketRef.current = null;
        setSocket(null);
        setConnected(false);
        setApiWorkspace(undefined);
        initialBootstrap = Promise.resolve(next);
        dataRef.current = null;
        accountRef.current = next;
        setData(null);
        setAccountData(next);
        setMessages([]);
        setReplies([]);
        setThread(null);
        threadRef.current = null;
        setLinkedReply(null);
        setTyping({});
        setUnread({});
        setNotificationState(null);
        setShowCall(false);
        setCallSetupChannel(null);
        setCallSwitchTarget(null);
        setChannelAccess(null);
        setChannelNotifications(null);
        setChannelMenu(null);
        setChannelAction(null);
        setVoicePreviewId(null);
        setDialog(null);
        setAdminOpen(false);
        setWorkspaceLifecycle(null);
        setMobileNav(false);
        setChannelId("");
        channelRef.current = "";
        setView("channel");
        setProfileId(null);
        profileReturn.current = null;
        clearNavigationAddress();
        setLoading(false);
        return;
      }
      accountRef.current = null;
      setAccountData(null);
      const contextChanged =
        dataRef.current?.workspace.id !== next.workspace.id ||
        dataRef.current?.user.id !== next.user.id;
      const hadContext = Boolean(dataRef.current);
      if (contextChanged) liveMemberUpdates.current.clear();
      const changed =
        dataRef.current?.workspace.id !== next.workspace.id ||
        dataRef.current?.user.id !== next.user.id ||
        Boolean(dataRef.current?.user.suspended) !==
          Boolean(next.user.suspended) ||
        Boolean(dataRef.current?.workspace.suspended) !==
          Boolean(next.workspace.suspended);
      setApiWorkspace(next.workspace.id);
      initialBootstrap = Promise.resolve(next);
      if (changed) {
        appliedAddress.current = "";
        accessVersion.current += 1;
        callRef.current.leave();
        socketRef.current?.removeAllListeners();
        socketRef.current?.disconnect();
        socketRef.current = null;
        setSocket(null);
        setConnected(false);
        setMessages([]);
        setReplies([]);
        setThread(null);
        setLinkedReply(null);
        threadRef.current = null;
        setTyping({});
        setUnread({});
        setNotificationState(null);
        setNotificationError("");
        setHasMore(false);
        setRepliesHasMore(false);
        setShowCall(false);
        setCallSetupChannel(null);
        setCallSwitchTarget(null);
        setChannelAccess(null);
        setChannelNotifications(null);
        setChannelMenu(null);
        setChannelAction(null);
        setVoicePreviewId(null);
        setWorkspaceLifecycle(null);
        setView("channel");
        setProfileId(null);
        profileReturn.current = null;
        setTab("chat");
        setDialog(null);
        setMobileNav(false);
        if (contextChanged)
          setAdminOpen(
            Boolean(next.workspace.suspended && next.user.siteAdmin),
          );
        else if (next.workspace.suspended && next.user.siteAdmin)
          setAdminOpen(true);
        else if (next.user.suspended && !next.user.siteAdmin)
          setAdminOpen(false);
        highlightRef.current = null;
      } else if (
        !["owner", "admin"].includes(next.user.role) &&
        !next.user.siteAdmin
      )
        setAdminOpen(false);
      const selected =
        !changed && next.channels.some((c) => c.id === channelRef.current)
          ? channelRef.current
          : next.channels.find((c) => c.name === "tasarım" && !c.archived)
              ?.id ||
            next.channels.find((c) => c.kind === "text" && !c.archived)?.id ||
            "";
      if (!changed) {
        const accessible = new Set(next.channels.map((c) => c.id));
        const allowed = new Set(
          next.channels.filter((c) => !c.archived).map((c) => c.id),
        );
        setCallSetupChannel((old) => (old && allowed.has(old.id) ? old : null));
        setCallSwitchTarget((old) =>
          old && allowed.has(old.id)
            ? next.channels.find((candidate) => candidate.id === old.id) || null
            : null,
        );
        setChannelAccess((old) => (old && accessible.has(old.id) ? old : null));
        if (threadRef.current && !accessible.has(threadRef.current.channelId)) {
          threadRef.current = null;
          setThread(null);
          setReplies([]);
          setLinkedReply(null);
          setRepliesHasMore(false);
          setThreadLoading(false);
          if (viewRef.current === "channel")
            writeAddress(
              {
                workspaceId: next.workspace.id,
                view: "channel",
                channelId: selected,
                tab: tabRef.current,
              },
              "replace",
            );
          else if (viewRef.current !== "profile")
            writeAddress(
              { workspaceId: next.workspace.id, view: viewRef.current },
              "replace",
            );
        }
        if (channelRef.current !== selected) {
          setMessages([]);
          setHasMore(false);
          if (viewRef.current === "channel") {
            setReplies([]);
            setThread(null);
            setLinkedReply(null);
            threadRef.current = null;
            writeAddress(
              {
                workspaceId: next.workspace.id,
                view: "channel",
                channelId: selected,
                tab: "chat",
              },
              "replace",
            );
            setTab("chat");
            fail(
              "Bu kanala artık erişemiyorsun veya kanal silinmiş. Erişebildiğin bir kanala döndün.",
            );
          }
        }
      }
      channelRef.current = selected;
      dataRef.current = next;
      setData(next);
      setBootstrapRevision((revision) => revision + 1);
      setChannelId(selected);
      if (contextChanged && hadContext && !preserveRoute)
        writeAddress(
          {
            workspaceId: next.workspace.id,
            view: "channel",
            channelId: selected,
            tab: "chat",
          },
          "replace",
        );
      const invite = new URLSearchParams(location.search).get("invite");
      if (invite && !next.workspace.isDemo) {
        setWorkspaceInvite(invite);
        setWorkspaceMode("join");
        setWorkspaceTarget(undefined);
        setDialog("workspaces");
        history.replaceState(null, "", location.pathname + location.hash);
        writeAddress(defaultRoute(next), "replace");
      }
      setLoading(false);
    },
    [],
  );
  const refreshAccess = useCallback(
    async function refresh(): Promise<void> {
      const version = ++accessVersion.current;
      const memberRevision = liveMemberRevision.current;
      try {
        const next = await api<SessionBootstrap>("/auth/me");
        if (version !== accessVersion.current || workspaceChanging.current)
          return;
        // Apply access changes immediately, even if the follow-up request fails.
        // Only newer display fields may override this snapshot; roles, membership,
        // suspension and account verification always come from the access response.
        if (
          memberRevision !== liveMemberRevision.current &&
          !next.accountOnly &&
          dataRef.current?.workspace.id === next.workspace.id &&
          dataRef.current.user.id === next.user.id
        ) {
          const currentProfile = (user: User): User => {
            const update = liveMemberUpdates.current.get(user.id);
            if (!update || update.revision <= memberRevision) return user;
            const { name, color, status, avatarUrl, jobTitle, bio, location } =
              update.user;
            return {
              ...user,
              name,
              color,
              status,
              avatarUrl,
              jobTitle,
              bio,
              location,
            };
          };
          acceptData({
            ...next,
            user: currentProfile(next.user),
            members: next.members.map(currentProfile),
          });
          return refresh();
        }
        acceptData(next);
      } catch (error) {
        if (version !== accessVersion.current || workspaceChanging.current)
          return;
        if (
          error instanceof ApiError &&
          (error.status === 401 || error.status === 403)
        ) {
          sessionStorage.setItem("mola:logged-out", "true");
          initialBootstrap = undefined;
          setAdminOpen(false);
          setAccountData(null);
          accountRef.current = null;
          setData(null);
          setMessages([]);
          setDialog(null);
        }
      }
    },
    [acceptData],
  );
  useEffect(() => {
    const update = () => {
      void refreshAccess();
    };
    window.addEventListener("mola:workspace-changed", update);
    return () => window.removeEventListener("mola:workspace-changed", update);
  }, [refreshAccess]);
  useEffect(() => {
    if (!accountData || verificationPending || authLink) return;
    const client = io({
      transports: ["websocket", "polling"],
      withCredentials: true,
    });
    const update = () => void refreshAccess();
    client.on("connect", update);
    client.on("workspace:changed", update);
    client.on("workspace:updated", update);
    client.on("workspace-order:updated", update);
    client.on("admin:refresh", update);
    client.on("connect_error", update);
    client.on("disconnect", (reason) => {
      if (reason === "io server disconnect") update();
    });
    return () => {
      client.removeAllListeners();
      client.disconnect();
    };
  }, [accountData?.user.id, verificationPending, authLink, refreshAccess]);
  useEffect(() => {
    if (data) return;
    setApiWorkspace(undefined);
    dataRef.current = null;
    accessVersion.current += 1;
    callRef.current.leave();
  }, [data]);

  useEffect(() => {
    let cancelled = false;
    initialBootstrap ||= bootstrap();
    initialBootstrap
      .then((result) => {
        if (cancelled) return;
        if (result) acceptData(result);
        else setLoading(false);
      })
      .catch((error) => {
        if (!cancelled) {
          setFatal(error.message);
          setLoading(false);
        }
      });
    api<PublicConfig>("/config")
      .then((c) => {
        if (cancelled) return;
        setDemoEnabled(c.demoEnabled);
        setMailbox(c.localMailboxUrl);
        setEmailDeliveryAvailable(c.emailDeliveryAvailable !== false);
        setRegistrationAvailable(c.registrationAvailable !== false);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [acceptData]);
  useEffect(() => {
    const update = () => setAuthLink(readAuthLink());
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);
    return () => {
      window.removeEventListener("hashchange", update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (
      (dialog && dialog !== "move-channel") ||
      adminOpen ||
      voicePreviewId ||
      callSetupChannel ||
      callSwitchTarget ||
      channelAction ||
      workspaceLifecycle ||
      channelAccess
    )
      setMobileNav(false);
  }, [
    dialog,
    adminOpen,
    voicePreviewId,
    callSetupChannel,
    callSwitchTarget,
    channelAction,
    workspaceLifecycle,
    channelAccess,
  ]);
  useEffect(() => {
    if (
      !(
        dialog ||
        channelAction ||
        workspaceLifecycle ||
        channelAccess ||
        voicePreviewId ||
        callSetupChannel ||
        callSwitchTarget ||
        adminOpen
      ) ||
      !isMobile
    )
      return;
    return () => {
      requestAnimationFrame(() => {
        if (
          document.querySelector(
            'dialog[open], [role="dialog"][aria-modal="true"]',
          )
        )
          return;
        const active = document.activeElement;
        if (
          active === document.body ||
          (active && sidebarRef.current?.contains(active))
        ) {
          triggerRef.current?.focus({ preventScroll: true });
        }
      });
    };
  }, [
    dialog,
    channelAction,
    channelAccess,
    voicePreviewId,
    callSetupChannel,
    callSwitchTarget,
    adminOpen,
    isMobile,
    sidebarRef,
    triggerRef,
  ]);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const update = () => {
      const away =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight >
        180;
      setAwayFromLatest(away);
      if (!away && view === "channel" && tab === "chat") clearPending();
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [loading, channelId, view, tab, messages, messagesLoading, clearPending]);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (adminOpen || workspaceLifecycle || accountData) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setDialog("search");
      }
      if (e.key === "Escape") {
        setMobileNav(false);
      }
    }
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [adminOpen, workspaceLifecycle, accountData]);
  useEffect(() => {
    if (
      !data?.user.id ||
      verificationPending ||
      authLink ||
      data.workspace.suspended ||
      data.user.suspended
    )
      return;
    const client = io({
      transports: ["websocket", "polling"],
      withCredentials: true,
    });
    let disposed = false;
    const workspaceId = data.workspace.id;
    setSocket(client);
    client.on("connect", () => {
      if (disposed || dataRef.current?.workspace.id !== workspaceId) return;
      setConnected(true);
      void refreshAccess();
      const requestedChannel = channelRef.current;
      const requestedHistory = historyRequest.current;
      if (requestedChannel)
        api<MessageHistoryPage>(`/channels/${requestedChannel}/messages`)
          .then((result) => {
            if (
              disposed ||
              requestedChannel !== channelRef.current ||
              requestedHistory !== historyRequest.current
            )
              return;
            historyRequest.current++;
            historyPending.current = false;
            setHistoryBusy(false);
            setHistoryError("");
            setMessages(result.messages);
            setHasMore(result.hasMore);
            setHistoryCursor(result.nextCursor);
          })
          .catch(() => {});
    });
    client.on("disconnect", (reason) => {
      if (disposed) return;
      setConnected(false);
      setTyping({});
      if (reason === "io server disconnect") {
        void refreshAccess().then(() => {
          if (
            !disposed &&
            !workspaceChanging.current &&
            dataRef.current?.workspace.id === workspaceId &&
            !dataRef.current.user.suspended &&
            !dataRef.current.workspace.suspended
          )
            client.connect();
        });
      }
    });
    client.on("connect_error", () => {
      if (disposed) return;
      setConnected(false);
      void refreshAccess();
    });
    client.on("workspace:changed", () => {
      if (!disposed) void refreshAccess();
    });
    client.on("presence", ({ onlineIds }: { onlineIds: string[] }) =>
      setData((current) => (current ? { ...current, onlineIds } : current)),
    );
    client.on("admin:refresh", () => {
      void refreshAccess();
      window.dispatchEvent(new Event("mola:admin-refresh"));
    });
    client.on("message:created", (message: Message) => {
      if (message.attachments.length) setCollectionVersion((v) => v + 1);
      if (
        message.parentId &&
        threadRef.current?.id === message.parentId &&
        threadRef.current.channelId === message.channelId
      ) {
        received(message.id);
        setReplies((old) => uniqueMessages([...old, message]));
      }
      if (message.channelId === channelRef.current) {
        if (message.parentId) {
          setMessages((old) =>
            old.map((m) =>
              m.id === message.parentId
                ? { ...m, replyCount: m.replyCount + 1 }
                : m,
            ),
          );
        } else {
          const conversationVisible =
            viewRef.current === "channel" && tabRef.current === "chat";
          const nearBottom = scrollRef.current
            ? scrollRef.current.scrollHeight -
                scrollRef.current.scrollTop -
                scrollRef.current.clientHeight <
              160
            : true;
          received(
            message.id,
            message.userId !== data.user.id &&
              (!nearBottom || !conversationVisible),
          );
          setMessages((old) => uniqueMessages([...old, message]));
          if (nearBottom && conversationVisible)
            scrollToLatestSoon(
              message.channelId,
              data.user.id,
              workspaceId,
              60,
            );
        }
      }
    });
    client.on(
      "notifications:attention",
      (attention: {
        workspaceId: string;
        channelId: string;
        messageId: string;
      }) => {
        const current = dataRef.current;
        if (
          disposed ||
          !current ||
          current.user.id !== data.user.id ||
          current.workspace.id !== workspaceId ||
          attention.workspaceId !== workspaceId ||
          quietRef.current
        )
          return;
        if (
          !current.channels.some(
            (candidate) => candidate.id === attention.channelId,
          )
        )
          return;
        if (
          attention.channelId === channelRef.current &&
          viewRef.current === "channel" &&
          tabRef.current === "chat"
        )
          return;
        notify("Diğer bir sohbette yeni bir mesaj var.");
      },
    );
    client.on(
      "notification-settings:changed",
      ({ workspaceId: changedWorkspaceId }: { workspaceId: string }) => {
        if (
          !disposed &&
          dataRef.current?.user.id === data.user.id &&
          dataRef.current?.workspace.id === workspaceId &&
          changedWorkspaceId === workspaceId
        )
          setNotificationSettingsRevision((value) => value + 1);
      },
    );
    client.on("message:updated", (message: Message) => {
      setMessages((old) => old.map((m) => (m.id === message.id ? message : m)));
      setReplies((old) => old.map((m) => (m.id === message.id ? message : m)));
      setThread((old) => (old?.id === message.id ? message : old));
      setLinkedReply((old) => (old?.id === message.id ? message : old));
      setCollectionVersion((v) => v + 1);
    });
    client.on("message:deleted", ({ id }: { id: string }) => {
      forget(id);
      setPreview((old) =>
        old?.messageId === id || old?.parentId === id ? null : old,
      );
      setMessages((old) => old.filter((m) => m.id !== id));
      setReplies((old) => old.filter((m) => m.id !== id));
      setThread((old) => (old?.id === id ? null : old));
      if (threadRef.current?.id === id) {
        threadRef.current = null;
        if (viewRef.current !== "profile")
          writeAddress(contentRoute(), "replace");
      }
      setLinkedReply((old) => (old?.id === id ? null : old));
      setCollectionVersion((v) => v + 1);
    });
    client.on("member:updated", (user: User) => {
      if (disposed || dataRef.current?.workspace.id !== workspaceId) return;
      liveMemberRevision.current += 1;
      liveMemberUpdates.current.set(user.id, {
        revision: liveMemberRevision.current,
        user,
      });
      setData((old) =>
        old
          ? {
              ...old,
              user: user.id === old.user.id ? user : old.user,
              members: [
                ...old.members.filter((member) => member.id !== user.id),
                user,
              ],
            }
          : old,
      );
    });
    client.on("channel:created", (channel: Channel) =>
      setData((old) =>
        old
          ? {
              ...old,
              channels: [
                ...old.channels.filter((c) => c.id !== channel.id),
                channel,
              ],
            }
          : old,
      ),
    );
    client.on(
      "typing",
      ({
        channelId: id,
        userId,
        typing: active,
      }: {
        channelId: string;
        userId: string;
        typing: boolean;
      }) => {
        if (id === channelRef.current && userId !== data.user.id)
          setTyping((old) => ({ ...old, [userId]: active ? Date.now() : 0 }));
      },
    );
    const timer = setInterval(
      () =>
        setTyping((old) =>
          Object.fromEntries(
            Object.entries(old).filter(([, time]) => time > Date.now() - 5000),
          ),
        ),
      2000,
    );
    return () => {
      disposed = true;
      client.removeAllListeners();
      client.disconnect();
      clearInterval(timer);
      setSocket(null);
    };
  }, [
    data?.user.id,
    data?.user.suspended,
    data?.workspace.id,
    data?.workspace.suspended,
    verificationPending,
    authLink,
    refreshAccess,
    received,
    forget,
  ]);
  useEffect(() => {
    if (!channelId || !data) return;
    let cancelled = false;
    const controller = new AbortController();
    const workspaceId = data.workspace.id;
    const userId = data.user.id;
    historyRequest.current++;
    historyPending.current = false;
    setHistoryBusy(false);
    setHistoryCursor(null);
    setHistoryError("");
    setMessagesLoading(true);
    setMessages([]);
    setTyping({});
    setHasMore(false);
    api<MessageHistoryPage>(`/channels/${channelId}/messages`, {
      signal: controller.signal,
      headers: { "X-Workspace-Id": workspaceId, "X-User-Id": userId },
    })
      .then((result) => {
        if (
          !cancelled &&
          dataRef.current?.workspace.id === workspaceId &&
          dataRef.current?.user.id === userId &&
          channelRef.current === channelId &&
          dataRef.current?.channels.some((c) => c.id === channelId)
        ) {
          setMessages(result.messages);
          setHasMore(result.hasMore);
          setHistoryCursor(result.nextCursor);
          void document.fonts.ready.then(() =>
            requestAnimationFrame(() => {
              if (cancelled) return;
              const restoration = routeScroll.current;
              if (
                restoration?.sequence === routeSequence.current &&
                restoration.channelId === channelId
              ) {
                if (scrollRef.current)
                  scrollRef.current.scrollTop = restoration.top;
                routeScroll.current = null;
              } else if (highlightRef.current) {
                document
                  .querySelector(
                    `[data-message-id="${CSS.escape(highlightRef.current)}"]`,
                  )
                  ?.scrollIntoView({ block: "center" });
                highlightRef.current = null;
              } else
                scrollRef.current?.scrollTo({
                  top:
                    data.workspace.isDemo &&
                    !result.hasMore &&
                    !sessionStorage.getItem(`mola:visited:${channelId}`)
                      ? 0
                      : scrollRef.current.scrollHeight,
                });
              sessionStorage.setItem(`mola:visited:${channelId}`, "true");
            }),
          );
        }
      })
      .catch((error) => {
        if (!cancelled) setHistoryError(error.message);
      })
      .finally(() => {
        if (!cancelled) setMessagesLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [channelId, data?.workspace.id, data?.user.id, historyRetry]);
  useEffect(() => {
    replyRequest.current++;
    replyPending.current = false;
    setReplyBusy(false);
    setReplyCursor(null);
    setRepliesHasMore(false);
    setReplyError("");
    if (!thread || !data) return;
    const controller = new AbortController();
    const workspaceId = data.workspace.id;
    const userId = data.user.id;
    const current = () =>
      !controller.signal.aborted &&
      threadRef.current?.id === thread.id &&
      dataRef.current?.user.id === userId &&
      dataRef.current?.workspace.id === workspaceId &&
      dataRef.current.channels.some((c) => c.id === thread.channelId);
    setThreadLoading(true);
    setReplies([]);
    api<MessageHistoryPage>(
      `/channels/${thread.channelId}/messages?parentId=${encodeURIComponent(thread.id)}`,
      {
        signal: controller.signal,
        headers: { "X-Workspace-Id": workspaceId, "X-User-Id": userId },
      },
    )
      .then((result) => {
        if (current()) {
          setReplies(result.messages);
          setRepliesHasMore(result.hasMore);
          setReplyCursor(result.nextCursor);
        }
      })
      .catch((error: Error) => {
        if (current()) setReplyError(error.message);
      })
      .finally(() => {
        if (current()) setThreadLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [thread?.id, data?.user.id, data?.workspace.id, replyRetry]);

  useEffect(() => {
    if (
      preview &&
      (!data ||
        data.user.id !== preview.userId ||
        data.workspace.id !== preview.workspaceId ||
        data.user.suspended ||
        data.workspace.suspended ||
        !data.channels.some((c) => c.id === preview.channelId))
    )
      setPreview(null);
  }, [data, preview]);

  useEffect(() => {
    if (
      !data ||
      verificationPending ||
      data.user.suspended ||
      data.workspace.suspended
    )
      return;
    const workspaceId = data.workspace.id;
    let cancelled = false,
      sequence = 0;
    const receive = (next: NotificationState) => {
      if (
        !cancelled &&
        next.workspaceId === workspaceId &&
        dataRef.current?.workspace.id === workspaceId
      ) {
        sequence++;
        setNotificationState(next);
        setUnread(next.unreadByChannel);
        setNotificationError("");
      }
    };
    async function load() {
      const version = ++sequence;
      setNotificationsLoading(true);
      try {
        const next = await api<NotificationState>("/notifications", {
          headers: { "X-Workspace-Id": workspaceId },
        });
        if (version === sequence) receive(next);
      } catch (e) {
        if (!cancelled && version === sequence)
          setNotificationError((e as Error).message);
      } finally {
        if (!cancelled) setNotificationsLoading(false);
      }
    }
    const draftChanged = (detail: unknown) =>
      window.dispatchEvent(new CustomEvent("mola:draft-changed", { detail }));
    void load();
    socket?.on("notifications:state", receive);
    socket?.on("draft:changed", draftChanged);
    socket?.on("connect", load);
    window.addEventListener("focus", load);
    window.addEventListener("mola:admin-refresh", load);
    return () => {
      cancelled = true;
      socket?.off("notifications:state", receive);
      socket?.off("draft:changed", draftChanged);
      socket?.off("connect", load);
      window.removeEventListener("focus", load);
      window.removeEventListener("mola:admin-refresh", load);
    };
  }, [
    data?.user.id,
    data?.workspace.id,
    data?.user.suspended,
    data?.workspace.suspended,
    verificationPending,
    socket,
  ]);
  useEffect(() => {
    if (
      !data ||
      view !== "channel" ||
      tab !== "chat" ||
      messagesLoading ||
      !channelId ||
      !messages.length
    )
      return;
    const workspaceId = data.workspace.id,
      messageId = messages.at(-1)!.id;
    const mark = () => {
      if (
        document.visibilityState === "visible" &&
        dataRef.current?.workspace.id === workspaceId
      )
        void api(`/channels/${channelId}/read`, {
          method: "POST",
          headers: { "X-Workspace-Id": workspaceId },
          body: JSON.stringify({ messageId }),
        }).catch(() => {});
    };
    const timer = setTimeout(mark, 400);
    window.addEventListener("focus", mark);
    document.addEventListener("visibilitychange", mark);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", mark);
      document.removeEventListener("visibilitychange", mark);
    };
  }, [
    data?.workspace.id,
    channelId,
    view,
    tab,
    messagesLoading,
    messages.at(-1)?.id,
  ]);
  useEffect(() => {
    if (
      !data ||
      !thread ||
      threadLoading ||
      !replies.length ||
      view !== "channel"
    )
      return;
    const workspaceId = data.workspace.id,
      threadChannel = thread.channelId,
      messageId = replies.at(-1)!.id;
    const mark = () => {
      if (
        document.visibilityState === "visible" &&
        dataRef.current?.workspace.id === workspaceId
      )
        void api(`/channels/${threadChannel}/read`, {
          method: "POST",
          headers: { "X-Workspace-Id": workspaceId },
          body: JSON.stringify({ messageId }),
        }).catch(() => {});
    };
    const timer = setTimeout(mark, 400);
    document.addEventListener("visibilitychange", mark);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", mark);
    };
  }, [data?.workspace.id, thread?.id, threadLoading, replies.at(-1)?.id, view]);
  useEffect(() => {
    if (
      !data ||
      verificationPending ||
      authLink ||
      data.user.suspended ||
      data.workspace.suspended
    )
      return;
    let disposed = false;
    const followAddress = async () => {
      const data = dataRef.current;
      if (!data) return;
      const address = location.pathname + location.search + location.hash;
      if (appliedAddress.current === address) return;
      const sequence = ++routeSequence.current;
      const requested = readAppRoute(location.search, data.workspace.id);
      const current = () => !disposed && sequence === routeSequence.current;
      const fallback = (message: string) => {
        if (!current()) return;
        const route = defaultRoute(dataRef.current!);
        applyConversationRoute(route);
        writeAddress(route, "replace");
        fail(message);
      };
      if (
        !data.workspaces.some(
          (workspace) =>
            workspace.id === requested.workspaceId &&
            !workspace.membershipSuspended &&
            !workspace.suspended,
        )
      ) {
        fallback(
          "Bu çalışma alanına artık erişemiyorsun. Erişebildiğin alana döndün.",
        );
        return;
      }
      if (requested.workspaceId !== data.workspace.id) {
        if (callRef.current.joined || callRef.current.joining) {
          openWorkspaces("list", requested.workspaceId);
          return;
        }
        try {
          await changeWorkspace(
            { kind: "switch", id: requested.workspaceId },
            true,
          );
        } catch (error) {
          fallback((error as Error).message);
        }
        return;
      }
      appliedAddress.current = address;
      if (requested.view === "profile") {
        showProfile(requested.profileId);
        return;
      }
      const returnScroll = history.state?.molaScrollTop;
      if (requested.view !== "channel") {
        setProfileId(null);
        viewRef.current = requested.view;
        setView(requested.view);
        setThread(null);
        threadRef.current = null;
        setLinkedReply(null);
        setDialog(null);
        setMobileNav(false);
        restoreRouteScroll(returnScroll);
        if (requested.threadId) {
          try {
            const message = await api<Message>(
              `/messages/${encodeURIComponent(requested.threadId)}`,
              { headers: { "X-Workspace-Id": data.workspace.id } },
            );
            if (!current()) return;
            const root = message.parentId
              ? await api<Message>(
                  `/messages/${encodeURIComponent(message.parentId)}`,
                  { headers: { "X-Workspace-Id": data.workspace.id } },
                )
              : message;
            if (!current()) return;
            if (
              !dataRef.current?.channels.some(
                (channel) => channel.id === root.channelId,
              )
            )
              throw new Error("Bu mesaja artık erişemiyorsun.");
            setThread(root);
            threadRef.current = root;
          } catch (error) {
            if (current()) {
              writeAddress(
                { workspaceId: requested.workspaceId, view: requested.view },
                "replace",
              );
              fail((error as Error).message);
            }
          }
        }
        return;
      }
      if (
        requested.channelId &&
        !data.channels.some(
          (channel) =>
            channel.id === requested.channelId && channel.kind !== "voice",
        )
      ) {
        fallback(
          "Bu kanala artık erişemiyorsun veya kanal silinmiş. Erişebildiğin bir kanala döndün.",
        );
        return;
      }
      const route = {
        ...requested,
        channelId: requested.channelId || defaultRoute(data).channelId,
      };
      applyConversationRoute(route);
      if (!requested.channelId && !requested.messageId && !requested.threadId)
        writeAddress(route, "replace");
      restoreRouteScroll(returnScroll);
      try {
        if (requested.messageId || requested.threadId) {
          const message = await api<Message>(
            `/messages/${encodeURIComponent(requested.messageId || requested.threadId!)}`,
            {
              headers: { "X-Workspace-Id": data.workspace.id },
            },
          );
          if (!current()) return;
          if (
            !dataRef.current?.channels.some(
              (channel) => channel.id === message.channelId,
            ) ||
            (requested.channelId && requested.channelId !== message.channelId)
          ) {
            fallback("Bu mesaja artık erişemiyorsun.");
            return;
          }
          if (requested.messageId) await navigateMessage(message, false);
          else {
            const root = message.parentId
              ? await api<Message>(
                  `/messages/${encodeURIComponent(message.parentId)}`,
                  {
                    headers: { "X-Workspace-Id": data.workspace.id },
                  },
                )
              : message;
            if (!current()) return;
            if (!requested.channelId)
              applyConversationRoute({ ...route, channelId: root.channelId });
            setThread(root);
            threadRef.current = root;
          }
        }
      } catch (error) {
        fallback((error as Error).message);
      }
    };
    void followAddress();
    window.addEventListener("popstate", followAddress);
    return () => {
      disposed = true;
      window.removeEventListener("popstate", followAddress);
    };
  }, [
    data?.workspace.id,
    data?.user.id,
    data?.user.suspended,
    data?.workspace.suspended,
    verificationPending,
    authLink,
  ]);

  const workspaceOrder = useWorkspaceOrder(
    !verificationPending && !authLink
      ? data?.user.id || accountData?.user.id
      : undefined,
    data?.workspaces || accountData?.workspaces || [],
    socket,
  );
  function workspaceUpdated(workspace: Workspace) {
    setData((current) =>
      current
        ? {
            ...current,
            workspace:
              current.workspace.id === workspace.id
                ? workspace
                : current.workspace,
            workspaces: current.workspaces.map((item) =>
              item.id === workspace.id
                ? { ...item, ...workspace, avatarUrl: workspace.avatarUrl }
                : item,
            ),
          }
        : current,
    );
    setAccountData((current) =>
      current
        ? {
            ...current,
            workspaces: current.workspaces.map((item) =>
              item.id === workspace.id
                ? { ...item, ...workspace, avatarUrl: workspace.avatarUrl }
                : item,
            ),
          }
        : current,
    );
  }
  useEffect(() => {
    if (!socket) return;
    const userId = data?.user.id;
    const update = (workspace: Workspace) => {
      if (dataRef.current?.user.id === userId) workspaceUpdated(workspace);
    };
    socket.on("workspace:updated", update);
    return () => {
      socket.off("workspace:updated", update);
    };
  }, [socket, data?.user.id]);
  async function reorderWorkspaces(ids: string[]) {
    const actorId = dataRef.current?.user.id;
    const saved = await workspaceOrder.reorder(ids);
    if (actorId === dataRef.current?.user.id) {
      if (saved) notify("Çalışma alanı sıralaman kaydedildi.");
      else
        fail("Sıralama kaydedilemedi. Güncel sırayı kontrol edip tekrar dene.");
    }
    return saved;
  }
  const sidebar = useSidebarPreferences({
    userId: data?.user.id,
    workspaceId: data?.workspace.id,
    channels: data?.channels || [],
    socket,
    enabled:
      !!data &&
      !verificationPending &&
      !authLink &&
      !data.user.suspended &&
      !data.workspace.suspended,
  });
  const sidebarScope = data ? data.user.id + ":" + data.workspace.id : "";
  const sidebarDisplayWidth =
    sidebarWidth?.scope === sidebarScope
      ? sidebarWidth.width
      : sidebar.preferences.width || 272;
  async function reorderSidebar(section: SidebarOrder, ids: string[]) {
    const scope = sidebarScope;
    const before = (
      section === "text"
        ? sidebar.orderedTextChannels
        : section === "voice"
          ? sidebar.orderedVoiceChannels
          : sidebar.favoriteChannels
    ).map((c) => c.id);
    if (before.join("|") === ids.join("|")) return;
    if (await sidebar.setOrder(section, ids)) {
      if (
        dataRef.current &&
        dataRef.current.user.id + ":" + dataRef.current.workspace.id === scope
      ) {
        setSidebarUndo({ scope, section, ids: before });
        notify("Kanal sıralaman kaydedildi.");
      }
    }
  }
  const channel = data?.channels.find((c) => c.id === channelId);
  async function updateChannelGroups(
    groups: SidebarChannelGroup[],
    textOrder?: string[],
    notice = "Kanal bölümleri kaydedildi.",
  ) {
    const scope = sidebarScope;
    const previous = sidebar.preferences.channelGroups || [];
    const previousOrder = sidebar.preferences.textOrder;
    if (!(await sidebar.setChannelGroups(groups, textOrder))) return false;
    if (
      !dataRef.current ||
      dataRef.current.user.id + ":" + dataRef.current.workspace.id !== scope
    )
      return false;
    setSidebarUndo({
      scope,
      section: "text",
      ids: previousOrder,
      groups: previous,
      notice,
    });
    notify(notice);
    return true;
  }
  const threadChannel = data?.channels.find((c) => c.id === thread?.channelId);
  const userMap = useMemo(
    () => new Map(data?.members.map((u) => [u.id, u]) || []),
    [data?.members],
  );
  const identity = conversationIdentity(
    channel,
    data?.user.id || "",
    data?.members || [],
  );
  const directPeer = identity.peer;
  const isDirectConversation = view === "channel" && channel?.kind === "dm";
  const channelName = channel ? identity.name : "genel";
  const conversationMembers = getConversationMembers(
    channel,
    data?.members || [],
  );
  const onlineMembers = connected
    ? conversationMembers.filter(
        (member) => !member.suspended && data?.onlineIds.includes(member.id),
      )
    : [];
  const listedMembers = (
    memberScope === "channel" ? conversationMembers : data?.members || []
  ).filter(
    (user) =>
      !user.suspended &&
      (memberScope !== "dm" || (user.id !== data?.user.id && !user.isBot)) &&
      user.name
        .toLocaleLowerCase("tr-TR")
        .includes(memberQuery.trim().toLocaleLowerCase("tr-TR")),
  );
  function openMembers(scope: "workspace" | "channel" | "dm" = "workspace") {
    setMemberScope(scope);
    setMemberQuery("");
    setDialog("members");
  }
  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);
  const canManage = Boolean(
    data &&
    (["owner", "admin"].includes(data.user.role) || data.user.siteAdmin),
  );
  const canCreate = Boolean(data && data.user.role !== "guest");
  const canEditChannel = (target: Channel) =>
    Boolean(
      data &&
      target.kind !== "dm" &&
      !data.user.suspended &&
      !data.workspace.suspended &&
      (canManage ||
        (data.user.role === "moderator" && target.visibility !== "private")),
    );
  const menuChannel =
    channelMenu?.workspaceId === data?.workspace.id &&
    channelMenu?.userId === data?.user.id
      ? data?.channels.find(
          (candidate) => candidate.id === channelMenu?.channelId,
        )
      : undefined;
  const actionChannel =
    channelAction?.workspaceId === data?.workspace.id &&
    channelAction?.userId === data?.user.id
      ? data?.channels.find(
          (candidate) => candidate.id === channelAction?.channel.id,
        )
      : undefined;
  const notificationChannel =
    channelNotifications?.workspaceId === data?.workspace.id &&
    channelNotifications?.userId === data?.user.id
      ? data?.channels.find(
          (candidate) => candidate.id === channelNotifications?.channelId,
        )
      : undefined;
  function openChannelMenu(
    target: Channel,
    anchor: HTMLElement,
    position?: ContextMenuPosition,
    section?: SidebarOrder,
  ) {
    if (!data) return;
    const bounds = anchor.getBoundingClientRect();
    setChannelMenu({
      channelId: target.id,
      section,
      workspaceId: data.workspace.id,
      userId: data.user.id,
      anchor,
      position: position || { x: bounds.left, y: bounds.bottom + 4 },
    });
  }
  function channelContext(
    event: ReactMouseEvent<HTMLElement>,
    target: Channel,
  ) {
    event.preventDefault();
    event.stopPropagation();
    openChannelMenu(
      target,
      event.currentTarget.querySelector<HTMLElement>(".channel-nav, button") ||
        event.currentTarget,
      { x: event.clientX, y: event.clientY },
    );
  }
  function channelMenuKey(
    event: ReactKeyboardEvent<HTMLElement>,
    target: Channel,
  ) {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))
      return;
    event.preventDefault();
    event.stopPropagation();
    openChannelMenu(target, event.currentTarget);
  }
  function editChannel(target: Channel, mode: ChannelActionMode) {
    if (!data || !canEditChannel(target)) return;
    setChannelMenu(null);
    setDialog(null);
    setChannelAction({
      channel: target,
      mode,
      workspaceId: data.workspace.id,
      userId: data.user.id,
    });
  }
  async function markChannelRead(target: Channel) {
    if (!data) return;
    const workspaceId = data.workspace.id,
      userId = data.user.id;
    try {
      await api(`/channels/${target.id}/read`, {
        method: "POST",
        body: "{}",
        headers: { "X-Workspace-Id": workspaceId, "X-User-Id": userId },
      });
      if (
        dataRef.current?.workspace.id !== workspaceId ||
        dataRef.current?.user.id !== userId
      )
        return;
      setUnread((old) => ({ ...old, [target.id]: 0 }));
      notify("Kanal okundu olarak işaretlendi.");
    } catch (error) {
      fail((error as Error).message);
    }
  }
  const menuOrderSection =
    channelMenu?.section || (menuChannel?.kind === "voice" ? "voice" : "text");
  const menuGroup =
    menuOrderSection === "text"
      ? sidebar.preferences.channelGroups?.find((group) =>
          group.channelIds.includes(menuChannel?.id || ""),
        )
      : undefined;
  const groupedChannelIds = new Set(
    sidebar.preferences.channelGroups?.flatMap((group) => group.channelIds) ||
      [],
  );
  const menuOrder = menuGroup
    ? menuGroup.channelIds
    : (menuOrderSection === "favorites"
        ? sidebar.favoriteChannels
        : menuOrderSection === "voice"
          ? sidebar.orderedVoiceChannels
          : sidebar.orderedTextChannels.filter(
              (c) => !groupedChannelIds.has(c.id),
            )
      ).map((c) => c.id);
  const menuOrderIndex = menuOrder.indexOf(menuChannel?.id || "");
  const channelMenuItems = menuChannel
    ? [
        {
          label:
            menuChannel.kind === "voice" && !menuChannel.archived
              ? "Sesli odaya katıl"
              : "Sohbeti aç",
          icon: <MessageSquare size={16} />,
          onSelect: () => {
            setDialog(null);
            if (menuChannel.kind === "voice" && !menuChannel.archived)
              startCall(menuChannel);
            else selectChannel(menuChannel.id);
          },
        },
        {
          label: "Okundu olarak işaretle",
          icon: <Check size={16} />,
          disabled: menuChannel.archived,
          onSelect: () => void markChannelRead(menuChannel),
        },
        {
          label: "Bildirim tercihleri",
          icon: <Bell size={16} />,
          onSelect: () => {
            if (!data) return;
            setDialog(null);
            setChannelNotifications({
              channelId: menuChannel.id,
              workspaceId: data.workspace.id,
              userId: data.user.id,
            });
          },
        },
        ...(menuChannel.kind !== "dm" && !menuChannel.archived
          ? [
              {
                label: sidebar.preferences.favoriteIds.includes(menuChannel.id)
                  ? "Favorilerden çıkar"
                  : "Favorilere ekle",
                icon: sidebar.preferences.favoriteIds.includes(
                  menuChannel.id,
                ) ? (
                  <StarOff size={16} />
                ) : (
                  <Star size={16} />
                ),
                disabled: sidebar.loading || sidebar.saving,
                onSelect: () => {
                  setSidebarUndo(null);
                  void sidebar.toggleFavorite(menuChannel.id);
                },
              },
              ...([-1, 1] as const).map((direction) => ({
                label: direction === -1 ? "Yukarı taşı" : "Aşağı taşı",
                icon:
                  direction === -1 ? (
                    <ArrowUp size={16} />
                  ) : (
                    <ArrowDown size={16} />
                  ),
                disabled:
                  sidebar.loading ||
                  sidebar.saving ||
                  menuOrderIndex < 0 ||
                  menuOrderIndex + direction < 0 ||
                  menuOrderIndex + direction >= menuOrder.length,
                onSelect: () => {
                  const next = [...menuOrder];
                  const target = menuOrderIndex + direction;
                  [next[menuOrderIndex], next[target]] = [
                    next[target],
                    next[menuOrderIndex],
                  ];
                  if (menuGroup)
                    void updateChannelGroups(
                      (sidebar.preferences.channelGroups || []).map((group) =>
                        group.id === menuGroup.id
                          ? { ...group, channelIds: next }
                          : group,
                      ),
                    );
                  else void reorderSidebar(menuOrderSection, next);
                },
              })),
            ]
          : []),
        ...(menuChannel.kind === "text" && !menuChannel.archived
          ? [
              {
                label: "Bölüme taşı",
                icon: <ArrowRight size={16} />,
                disabled: sidebar.loading || sidebar.saving,
                onSelect: () => {
                  setChannelToMove(menuChannel.id);
                  setDialog("move-channel");
                },
              },
            ]
          : []),
        {
          label: "Kanal adını kopyala",
          icon: <Copy size={16} />,
          onSelect: () => {
            void navigator.clipboard
              .writeText(menuChannel.name)
              .then(() => notify("Kanal adı kopyalandı."))
              .catch(() =>
                fail("Kanal adı kopyalanamadı. Yeniden deneyebilirsin."),
              );
          },
        },
        ...(menuChannel.kind !== "dm"
          ? [
              {
                label: "Kanal erişimi ve üyeler",
                icon: <ShieldCheck size={16} />,
                onSelect: () => {
                  setDialog(null);
                  setChannelAccess(menuChannel);
                },
              },
            ]
          : []),
        ...(canEditChannel(menuChannel)
          ? [
              {
                label: "Kanalı düzenle",
                icon: <Pencil size={16} />,
                separatorBefore: true,
                onSelect: () => editChannel(menuChannel, "edit"),
              },
              {
                label: menuChannel.archived
                  ? "Arşivden çıkar"
                  : "Kanalı arşivle",
                icon: menuChannel.archived ? (
                  <ArchiveRestore size={16} />
                ) : (
                  <Archive size={16} />
                ),
                onSelect: () => editChannel(menuChannel, "archive"),
              },
              {
                label: "Kanalı sil",
                icon: <Trash2 size={16} />,
                danger: true,
                separatorBefore: true,
                onSelect: () => editChannel(menuChannel, "delete"),
              },
            ]
          : []),
      ]
    : [];
  const voiceChannels = new Map(
    call.voiceChannels.map((roster) => [roster.channelId, roster.peers]),
  );
  const voicePreview = data?.channels.find(
    (c) => c.id === voicePreviewId && !c.archived,
  );
  function openWorkspaces(mode: WorkspaceMode = "list", target?: string) {
    setWorkspaceMode(mode);
    setWorkspaceOrderEditing(false);
    setWorkspaceTarget(target);
    setWorkspaceInvite("");
    setDialog("workspaces");
    setMobileNav(false);
  }
  async function changeWorkspace(
    action: WorkspaceAction,
    preserveRoute = false,
  ) {
    if (workspaceChanging.current) return;
    const actorId = dataRef.current?.user.id || accountRef.current?.user.id;
    if (!actorId) return;
    workspaceChanging.current = true;
    accessVersion.current += 1;
    setWorkspaceBusy(true);
    try {
      const next =
        action.kind === "create"
          ? await post<Bootstrap>("/workspaces", { name: action.name })
          : action.kind === "join"
            ? await post<Bootstrap>("/workspaces/join", {
                inviteToken: action.inviteToken,
              })
            : await post<Bootstrap>(
                `/workspaces/${encodeURIComponent(action.id)}/switch`,
              );
      if ((dataRef.current?.user.id || accountRef.current?.user.id) !== actorId)
        return;
      if (!preserveRoute)
        history.replaceState(
          {
            ...history.state,
            molaScrollTop: scrollRef.current?.scrollTop || 0,
          },
          "",
        );
      acceptData(next, true);
      if (!preserveRoute) writeAddress(defaultRoute(next));
      setDialog(null);
      setWorkspaceInvite("");
      notify(
        action.kind === "create"
          ? `${next.workspace.name} hazır. Ekibini davet edebilirsin.`
          : `${next.workspace.name} alanındasın.`,
      );
    } finally {
      workspaceChanging.current = false;
      setWorkspaceBusy(false);
      if (
        socketRef.current &&
        !socketRef.current.connected &&
        dataRef.current &&
        !dataRef.current.user.suspended &&
        !dataRef.current.workspace.suspended
      )
        socketRef.current.connect();
      void refreshAccess();
    }
  }
  function defaultRoute(snapshot: Bootstrap): AppRoute & { view: "channel" } {
    return {
      workspaceId: snapshot.workspace.id,
      view: "channel",
      tab: "chat",
      channelId:
        snapshot.channels.find(
          (channel) =>
            channel.id === channelRef.current && channel.kind !== "voice",
        )?.id ||
        snapshot.channels.find(
          (channel) => channel.kind === "text" && !channel.archived,
        )?.id,
    };
  }
  function conversationRoute(): AppRoute & { view: "channel" } {
    return {
      workspaceId: dataRef.current?.workspace.id || "",
      view: "channel",
      channelId: channelRef.current,
      tab: tabRef.current,
      ...(threadRef.current ? { threadId: threadRef.current.id } : {}),
    };
  }
  function contentRoute(): Exclude<AppRoute, { view: "profile" }> {
    return viewRef.current === "channel" || viewRef.current === "profile"
      ? conversationRoute()
      : {
          workspaceId: dataRef.current?.workspace.id || "",
          view: viewRef.current,
          ...(threadRef.current ? { threadId: threadRef.current.id } : {}),
        };
  }
  function writeAddress(
    route: AppRoute,
    mode: "push" | "replace" = "push",
    profile = false,
  ) {
    routeSequence.current++;
    const address = appRouteAddress(route, location.href);
    if (
      mode === "push" &&
      address !== location.pathname + location.search + location.hash
    ) {
      history.replaceState(
        { ...history.state, molaScrollTop: scrollRef.current?.scrollTop || 0 },
        "",
      );
      history.pushState(
        { molaRoute: true, ...(profile ? { molaProfile: true } : {}) },
        "",
        address,
      );
    } else
      history.replaceState({ ...history.state, molaRoute: true }, "", address);
    appliedAddress.current = address;
  }
  function restoreRouteScroll(scrollTop: unknown) {
    if (typeof scrollTop !== "number") return;
    const sequence = routeSequence.current;
    routeScroll.current = {
      sequence,
      channelId: channelRef.current,
      top: scrollTop,
    };
    requestAnimationFrame(() => {
      if (sequence === routeSequence.current && scrollRef.current)
        scrollRef.current.scrollTop = scrollTop;
    });
  }
  function applyConversationRoute(route: AppRoute & { view: "channel" }) {
    const id = route.channelId || "";
    if (channelRef.current !== id) {
      setMessages([]);
    }
    setProfileId(null);
    channelRef.current = id;
    setChannelId(id);
    viewRef.current = "channel";
    setView("channel");
    tabRef.current = route.tab;
    setTab(route.tab);
    setThread(null);
    threadRef.current = null;
    setLinkedReply(null);
    setReplies([]);
    setMobileNav(false);
    setDialog(null);
    setUnread((old) => ({ ...old, [id]: 0 }));
  }
  function selectChannel(id: string) {
    const route: AppRoute & { view: "channel" } = {
      workspaceId: dataRef.current?.workspace.id || "",
      view: "channel",
      channelId: id,
      tab: "chat",
    };
    writeAddress(route);
    applyConversationRoute(route);
  }
  function selectTab(next: ConversationTab) {
    writeAddress({ ...conversationRoute(), tab: next });
    tabRef.current = next;
    setTab(next);
  }
  function openThread(message: Message) {
    if (viewRef.current === "saved") {
      writeAddress({
        workspaceId: dataRef.current?.workspace.id || "",
        view: "saved",
        threadId: message.id,
      });
      setLinkedReply(null);
      threadRef.current = message;
      setThread(message);
      return;
    }
    const route: AppRoute & { view: "channel" } = {
      workspaceId: dataRef.current?.workspace.id || "",
      view: "channel",
      channelId: message.channelId,
      tab: "chat",
      threadId: message.id,
    };
    writeAddress(route);
    if (
      viewRef.current !== "channel" ||
      channelRef.current !== message.channelId ||
      tabRef.current !== "chat"
    )
      applyConversationRoute(route);
    setLinkedReply(null);
    threadRef.current = message;
    setThread(message);
  }
  function closeThread() {
    writeAddress({ ...contentRoute(), threadId: undefined });
    threadRef.current = null;
    setThread(null);
    setLinkedReply(null);
  }
  function clearNavigationAddress(mode: "push" | "replace" = "replace") {
    if (dataRef.current) writeAddress(defaultRoute(dataRef.current), mode);
    else {
      history.replaceState(
        null,
        "",
        appRouteAddress(
          { workspaceId: "", view: "channel", tab: "chat" },
          location.href,
        ),
      );
      appliedAddress.current = "";
      routeSequence.current++;
    }
  }
  function showProfile(id: string) {
    if (viewRef.current !== "profile")
      profileReturn.current = {
        view: viewRef.current,
        scrollTop: scrollRef.current?.scrollTop || 0,
        route: contentRoute(),
      };
    setProfileId(id);
    setView("profile");
    setDialog(null);
    setThread(null);
    setMobileNav(false);
    setChannelMenu(null);
  }
  function openProfile(id: string) {
    if (!data) return;
    showProfile(id);
    writeAddress(
      { workspaceId: data.workspace.id, view: "profile", profileId: id },
      viewRef.current === "profile" ? "replace" : "push",
      true,
    );
  }
  function closeProfile() {
    if (history.state?.molaProfile) history.back();
    else {
      const previous = profileReturn.current;
      writeAddress(
        previous?.route || defaultRoute(dataRef.current!),
        "replace",
      );
      appliedAddress.current = "";
      window.dispatchEvent(new PopStateEvent("popstate"));
      restoreRouteScroll(previous?.scrollTop);
    }
  }
  function selectView(next: Exclude<View, "profile">) {
    writeAddress(
      next === "channel"
        ? conversationRoute()
        : { workspaceId: dataRef.current?.workspace.id || "", view: next },
    );
    setProfileId(null);
    viewRef.current = next;
    setView(next);
    setThread(null);
    threadRef.current = null;
    setLinkedReply(null);
    setChannelMenu(null);
  }
  function updateOwnProfile(user: User) {
    if (
      !data ||
      dataRef.current?.workspace.id !== data.workspace.id ||
      dataRef.current?.user.id !== user.id
    )
      return;
    setData((old) =>
      old
        ? {
            ...old,
            user,
            members: old.members.map((member) =>
              member.id === user.id ? user : member,
            ),
          }
        : old,
    );
  }
  function onSent(message: Message) {
    if (
      !data ||
      dataRef.current?.user.id !== data.user.id ||
      dataRef.current?.workspace.id !== data.workspace.id
    )
      return;
    if (message.parentId) {
      if (
        threadRef.current?.id === message.parentId &&
        threadRef.current.channelId === message.channelId
      ) {
        received(message.id);
        setReplies((old) => uniqueMessages([...old, message]));
      }
    } else if (message.channelId === channelRef.current) {
      received(message.id);
      setMessages((old) => uniqueMessages([...old, message]));
      scrollToLatestSoon(
        message.channelId,
        data.user.id,
        data.workspace.id,
        50,
      );
    }
  }
  function scrollToLatestSoon(
    targetId: string,
    userId: string,
    workspaceId: string,
    delay: number,
  ) {
    setTimeout(() => {
      if (
        dataRef.current?.user.id !== userId ||
        dataRef.current?.workspace.id !== workspaceId ||
        channelRef.current !== targetId ||
        viewRef.current !== "channel" ||
        tabRef.current !== "chat"
      )
        return;
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: messageScrollBehavior(),
      });
    }, delay);
  }
  async function mutate(path: string, options: RequestInit) {
    try {
      const updated = await api<Message>(path, options);
      setMessages((old) => old.map((m) => (m.id === updated.id ? updated : m)));
      setReplies((old) => old.map((m) => (m.id === updated.id ? updated : m)));
      return updated;
    } catch (e) {
      fail((e as Error).message);
      throw e;
    }
  }
  async function deleteMessage(message: Message) {
    try {
      await api(`/messages/${message.id}`, { method: "DELETE" });
      forget(message.id);
      setPreview((old) =>
        old?.messageId === message.id || old?.parentId === message.id
          ? null
          : old,
      );
      setMessages((old) => old.filter((m) => m.id !== message.id));
      setReplies((old) => old.filter((m) => m.id !== message.id));
      notify("Mesaj silindi.");
    } catch (e) {
      fail((e as Error).message);
    }
  }
  function renderMessage(message: Message, compact = false, grouped = false) {
    return (
      <MessageItem
        key={message.id}
        message={message}
        members={data?.members || []}
        fresh={freshIds.has(message.id)}
        author={userMap.get(message.userId)}
        selfId={data!.user.id}
        onOpenProfile={openProfile}
        onOpenFile={(file) =>
          setPreview({
            file,
            channelId: message.channelId,
            messageId: message.id,
            parentId: message.parentId,
            workspaceId: data!.workspace.id,
            userId: data!.user.id,
          })
        }
        online={Boolean(data?.onlineIds.includes(message.userId))}
        connected={connected}
        canModerate={Boolean(
          data &&
          (["owner", "admin", "moderator"].includes(data.user.role) ||
            data.user.siteAdmin),
        )}
        onCopyLink={() => {
          const url = new URL(location.origin);
          url.searchParams.set("workspace", data!.workspace.id);
          url.searchParams.set("message", message.id);
          void navigator.clipboard
            .writeText(url.href)
            .then(() => notify("Mesaj bağlantısı kopyalandı."))
            .catch(() =>
              fail("Bağlantı kopyalanamadı. Tarayıcı izinlerini kontrol et."),
            );
        }}
        saved={savedState.ids.has(message.id)}
        saveBusy={
          !savedState.saveReady || savedState.pendingIds.has(message.id)
        }
        onSave={() => void savedState.toggle(message)}
        onReply={() => openThread(message)}
        onReact={(emoji) => {
          void mutate(`/messages/${message.id}/reactions`, {
            method: "POST",
            body: JSON.stringify({ emoji }),
          }).catch(() => {});
        }}
        onPin={() => {
          void mutate(`/messages/${message.id}`, {
            method: "PATCH",
            body: JSON.stringify({ pinned: !message.pinned }),
          }).catch(() => {});
        }}
        onDelete={() => void deleteMessage(message)}
        onEdit={async (content) => {
          await mutate(`/messages/${message.id}`, {
            method: "PATCH",
            body: JSON.stringify({ content }),
          });
        }}
        compact={compact}
        grouped={grouped}
        readOnly={Boolean(
          data?.channels.find((c) => c.id === message.channelId)?.archived,
        )}
      />
    );
  }
  async function openDm(user: User, fromProfileId?: string) {
    if (user.id === data?.user.id) {
      setDialog("settings");
      return;
    }
    try {
      const dm = await post<Channel>("/dms", { userId: user.id });
      if (
        dataRef.current?.workspace.id !== data?.workspace.id ||
        dataRef.current?.user.id !== data?.user.id
      )
        return;
      setData((old) =>
        old
          ? {
              ...old,
              channels: [...old.channels.filter((c) => c.id !== dm.id), dm],
            }
          : old,
      );
      if (
        fromProfileId &&
        (viewRef.current !== "profile" ||
          new URLSearchParams(location.search).get("profile") !== fromProfileId)
      )
        return;
      selectChannel(dm.id);
      setDialog(null);
    } catch (e) {
      fail((e as Error).message);
    }
  }
  async function logout() {
    call.leave();
    try {
      try {
        await post("/auth/logout");
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 401)) throw error;
      }
      sessionStorage.setItem("mola:logged-out", "true");
      initialBootstrap = undefined;
      setData(null);
      setAccountData(null);
      accountRef.current = null;
      setDialog(null);
      setMessages([]);
      setUnread({});
    } catch (e) {
      if (accountRef.current) throw e;
      fail((e as Error).message);
    }
  }
  async function loadMore() {
    if (!data || !historyCursor || historyPending.current) return;
    const workspaceId = data.workspace.id,
      userId = data.user.id,
      requestedChannel = channelId;
    const sequence = ++historyRequest.current;
    const current = () =>
      sequence === historyRequest.current &&
      dataRef.current?.user.id === userId &&
      dataRef.current?.workspace.id === workspaceId &&
      channelRef.current === requestedChannel &&
      dataRef.current.channels.some((c) => c.id === requestedChannel);
    const currentHeight = scrollRef.current?.scrollHeight || 0;
    const currentTop = scrollRef.current?.scrollTop || 0;
    historyPending.current = true;
    setHistoryBusy(true);
    setHistoryError("");
    try {
      const result = await api<MessageHistoryPage>(
        `/channels/${requestedChannel}/messages?cursor=${encodeURIComponent(historyCursor)}`,
        { headers: { "X-Workspace-Id": workspaceId, "X-User-Id": userId } },
      );
      if (!current()) return;
      setMessages((old) => uniqueMessages([...result.messages, ...old]));
      setHasMore(result.hasMore);
      setHistoryCursor(result.nextCursor);
      requestAnimationFrame(() => {
        if (current() && scrollRef.current)
          scrollRef.current.scrollTop =
            currentTop + scrollRef.current.scrollHeight - currentHeight;
      });
    } catch (error) {
      if (current()) {
        setHistoryError((error as Error).message);
        if (
          error instanceof ApiError &&
          error.code === "INVALID_COLLECTION_CURSOR"
        ) {
          setHistoryCursor(null);
          setHasMore(false);
        }
        if (
          error instanceof ApiError &&
          [401, 403, 404].includes(error.status)
        ) {
          setMessages([]);
          setHistoryCursor(null);
          setHasMore(false);
          void refreshAccess();
        }
      }
    } finally {
      if (sequence === historyRequest.current) {
        historyPending.current = false;
        setHistoryBusy(false);
      }
    }
  }
  async function navigateMessage(message: Message, updateAddress = true) {
    if (!dataRef.current?.channels.some((c) => c.id === message.channelId)) {
      fail("Bu mesaja artık erişemiyorsun.");
      return;
    }
    const route: AppRoute & { view: "channel" } = {
      workspaceId: dataRef.current.workspace.id,
      view: "channel",
      channelId: message.channelId,
      tab: "chat",
      messageId: message.id,
    };
    if (updateAddress) writeAddress(route);
    const sequence = routeSequence.current;
    const workspaceId = dataRef.current.workspace.id;
    const userId = dataRef.current.user.id;
    const current = () =>
      dataRef.current?.user.id === userId &&
      sequence === routeSequence.current &&
      dataRef.current?.workspace.id === workspaceId &&
      channelRef.current === message.channelId;
    applyConversationRoute(route);
    try {
      const result = await api<{ messages: Message[] }>(
        `/channels/${message.channelId}/messages`,
        { headers: { "X-Workspace-Id": workspaceId, "X-User-Id": userId } },
      );
      if (!current()) return;
      if (
        message.parentId ||
        !result.messages.some((m) => m.id === message.id)
      ) {
        const root = message.parentId
          ? await api<Message>(`/messages/${message.parentId}`, {
              headers: { "X-Workspace-Id": workspaceId, "X-User-Id": userId },
            })
          : await api<Message>(`/messages/${message.id}`, {
              headers: { "X-Workspace-Id": workspaceId, "X-User-Id": userId },
            });
        if (current()) {
          threadRef.current = root;
          setLinkedReply(message.parentId ? message : null);
          setThread(root);
        }
      } else {
        highlightRef.current = message.id;
        requestAnimationFrame(() => {
          const element = document.querySelector(
            `[data-message-id="${CSS.escape(message.id)}"]`,
          );
          element?.scrollIntoView({
            block: "center",
            behavior: messageScrollBehavior(),
          });
          if (element) highlightRef.current = null;
        });
      }
    } catch (error) {
      if (current()) fail((error as Error).message);
    }
  }
  async function loadMoreReplies() {
    if (!thread || !data || !replyCursor || replyPending.current) return;
    const workspaceId = data.workspace.id,
      userId = data.user.id,
      currentThread = thread.id;
    const sequence = ++replyRequest.current;
    const current = () =>
      sequence === replyRequest.current &&
      threadRef.current?.id === currentThread &&
      dataRef.current?.user.id === userId &&
      dataRef.current?.workspace.id === workspaceId &&
      dataRef.current.channels.some((c) => c.id === thread.channelId);
    replyPending.current = true;
    setReplyBusy(true);
    setReplyError("");
    try {
      const result = await api<MessageHistoryPage>(
        `/channels/${thread.channelId}/messages?parentId=${encodeURIComponent(currentThread)}&cursor=${encodeURIComponent(replyCursor)}`,
        { headers: { "X-Workspace-Id": workspaceId, "X-User-Id": userId } },
      );
      if (current()) {
        setReplies((old) => uniqueMessages([...result.messages, ...old]));
        setRepliesHasMore(result.hasMore);
        setReplyCursor(result.nextCursor);
      }
    } catch (error) {
      if (current()) {
        setReplyError((error as Error).message);
        if (
          error instanceof ApiError &&
          error.code === "INVALID_COLLECTION_CURSOR"
        ) {
          setReplyCursor(null);
          setRepliesHasMore(false);
        }
        if (
          error instanceof ApiError &&
          [401, 403, 404].includes(error.status)
        ) {
          setReplies([]);
          setReplyCursor(null);
          setRepliesHasMore(false);
          void refreshAccess();
        }
      }
    } finally {
      if (sequence === replyRequest.current) {
        replyPending.current = false;
        setReplyBusy(false);
      }
    }
  }
  function startCall(target = channel) {
    if (!target) return;
    if (target.archived) {
      fail(
        "Bu kanal arşivde. Görüşme başlatmak için önce arşivden çıkarılmalı.",
      );
      return;
    }
    if (
      (call.joined || call.joining) &&
      call.channelId &&
      call.channelId !== target.id
    ) {
      setCallSwitchTarget(target);
      return;
    }
    if (!call.joined && !call.joining) setCallSetupChannel(target);
    else setShowCall(true);
  }
  const typingNames = Object.keys(typing)
    .filter((id) => typing[id])
    .map((id) => userMap.get(id)?.name.split(" ")[0])
    .filter(Boolean);
  const unreadActivityCount =
    notificationState?.workspaceId === data?.workspace.id
      ? notificationState?.unreadNotifications || 0
      : 0;
  async function finishRecovery(action: AuthLink["action"]) {
    clearAuthLink();
    sessionStorage.setItem("mola:logged-out", "true");
    initialBootstrap = undefined;
    setLoading(true);
    setFatal("");
    setAuthLink(null);
    setAccountData(null);
    accountRef.current = null;
    setData(null);
    setMessages([]);
    setChannelId("");
    if (action === "verify-email") {
      try {
        acceptData(await api<SessionBootstrap>("/auth/me"));
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 401))
          setFatal((error as Error).message);
      }
    }
    setLoading(false);
  }
  if (authLink)
    return (
      <AccountRecovery
        key={authLink.action + authLink.token}
        link={authLink}
        emailDeliveryAvailable={emailDeliveryAvailable}
        onDone={(action) => void finishRecovery(action)}
      />
    );
  if (loading)
    return (
      <div className="boot-screen">
        <Logo />
        <Spinner label="Çalışma alanın hazırlanıyor" />
      </div>
    );
  if (fatal)
    return (
      <main className="fatal-state">
        <Logo />
        <h1>Çalışma alanına bağlanılamadı.</h1>
        <p>{fatal}</p>
        <Button
          variant="default"
          size="unset"
          type="submit"
          className="primary-button"
          onClick={() => location.reload()}
        >
          Tekrar dene
        </Button>
      </main>
    );
  if (verificationPending && accountData)
    return (
      <VerificationGate
        data={accountData}
        mailbox={mailbox}
        emailDeliveryAvailable={
          accountData.emailDeliveryAvailable ?? emailDeliveryAvailable
        }
        onVerified={acceptData}
        onLogout={logout}
      />
    );
  if (accountData)
    return (
      <AccountOnlyHome
        key={accountData.user.id}
        data={accountData}
        onAction={changeWorkspace}
        onLogout={logout}
        onRefresh={() => void refreshAccess()}
      />
    );
  if (!data)
    return (
      <Auth
        onLogin={acceptData}
        demoEnabled={demoEnabled}
        emailDeliveryAvailable={emailDeliveryAvailable}
        registrationAvailable={registrationAvailable}
      />
    );
  if (verificationPending)
    return (
      <VerificationGate
        data={data}
        mailbox={mailbox}
        emailDeliveryAvailable={
          data.emailDeliveryAvailable ?? emailDeliveryAvailable
        }
        onVerified={acceptData}
        onLogout={async () => {
          try {
            await post("/auth/logout");
          } catch (error) {
            if (!(error instanceof ApiError && error.status === 401))
              throw error;
          }
          sessionStorage.setItem("mola:logged-out", "true");
          initialBootstrap = undefined;
          setData(null);
          setChannelId("");
          setMessages([]);
          setUnread({});
        }}
      />
    );

  return (
    <div
      className="app-shell"
      style={{ "--sidebar-width": `${sidebarDisplayWidth}px` } as CSSProperties}
    >
      <a className="skip-link" href="#main-content">
        Sohbete geç
      </a>
      <aside className="workspace-rail" aria-label="Çalışma alanları">
        <Button
          variant="unstyled"
          size="unset"
          type="submit"
          className="rail-brand"
          aria-label="Mola hakkında"
          onClick={() => setDialog("help")}
        >
          <Logo small />
        </Button>
        <div className="rail-divider" />
        <WorkspaceRailList
          userId={data.user.id}
          workspaces={workspaceOrder.items}
          currentId={data.workspace.id}
          busy={workspaceBusy}
          canReorder={workspaceOrder.canReorder}
          error={workspaceOrder.error}
          onReorder={reorderWorkspaces}
          onManage={() => {
            openWorkspaces();
            setWorkspaceOrderEditing(true);
          }}
          onSelect={(id) => {
            if (id === data.workspace.id)
              selectChannel(
                data.channels.find((c) => c.kind === "text" && !c.archived)
                  ?.id || channelId,
              );
            else if (call.joined || call.joining) openWorkspaces("list", id);
            else
              void changeWorkspace({ kind: "switch", id }).catch((error) =>
                fail(error.message),
              );
          }}
        />
        <Button
          variant="unstyled"
          size="unset"
          type="submit"
          className="rail-add"
          title="Çalışma alanı ekle"
          aria-label="Çalışma alanı ekle"
          onClick={() => openWorkspaces()}
        >
          <Plus size={22} />
        </Button>
        <div className="rail-bottom">
          <IconButton
            label="Ekip arkadaşlarını davet et"
            disabled={!canManage}
            onClick={() => setDialog("invite")}
          >
            <Users size={21} />
          </IconButton>
          {canManage && (
            <IconButton
              label="Yönetim paneli"
              onClick={() => setAdminOpen(true)}
            >
              <ShieldCheck size={21} />
            </IconButton>
          )}
          <IconButton
            label="Kullanım rehberi"
            onClick={() => setDialog("help")}
          >
            <CircleHelp size={21} />
          </IconButton>
        </div>
      </aside>
      {mobileNav && (
        <Button
          variant="unstyled"
          size="unset"
          type="submit"
          className="nav-scrim"
          aria-label="Gezinmeyi kapat"
          tabIndex={-1}
          onClick={() => setMobileNav(false)}
        />
      )}
      <div
        id="workspace-navigation"
        ref={sidebarRef}
        className={`sidebar live-sidebar ${mobileNav ? "sidebar-open" : ""}`}
        aria-label="Çalışma alanı gezinmesi"
        role={isMobile && mobileNav ? "dialog" : "complementary"}
        aria-modal={isMobile && mobileNav ? true : undefined}
        tabIndex={isMobile ? -1 : undefined}
        inert={isMobile && !mobileNav}
      >
        <div className="mobile-nav-heading">
          <span>Çalışma alanın</span>
          <IconButton
            label="Gezinme menüsünü kapat"
            onClick={() => setMobileNav(false)}
          >
            <X size={19} />
          </IconButton>
        </div>
        <WorkspaceNavigation
          key={sidebarScope}
          data={data}
          preferences={sidebar}
          connected={connected}
          unread={unread}
          currentId={channelId}
          view={view}
          savedCount={savedState.ids.size}
          activityCount={unreadActivityCount}
          canManage={canManage}
          canCreate={canCreate}
          voiceChannels={voiceChannels}
          call={call}
          activeMenuId={menuChannel?.id}
          width={sidebarDisplayWidth}
          onPreviewWidth={(width) =>
            setSidebarWidth(
              width === null ? null : { scope: sidebarScope, width },
            )
          }
          onSelect={selectChannel}
          onStartCall={startCall}
          onCallOpen={() => setShowCall(true)}
          onMenu={openChannelMenu}
          onReorder={(section, ids) => void reorderSidebar(section, ids)}
          onGroupsChange={updateChannelGroups}
          onProfile={openProfile}
          onWorkspaces={openWorkspaces}
          onSettings={() => setDialog("settings")}
          onWorkspaceSettings={() => {
            setAdminSection("settings");
            setAdminOpen(true);
          }}
          onLeave={() => setWorkspaceLifecycle("leave")}
          onMembers={() => openMembers()}
          onNewMessage={() => openMembers("dm")}
          onInvite={() => setDialog("invite")}
          onNotifications={() => setDialog("notifications")}
          onHelp={() => setDialog("help")}
          onIntegrations={() => setDialog("integrations")}
          onSearch={() => setDialog("search")}
          onArchives={() => setDialog("archives")}
          onView={(next) => {
            selectView(next);
            setMobileNav(false);
          }}
          onCreate={(kind) => {
            setCreateChannelKind(kind);
            setDialog("channel");
          }}
          onVoicePreview={setVoicePreviewId}
        />
      </div>

      <div className="workspace-main" inert={isMobile && mobileNav}>
        <header className="topbar workspace-topbar">
          <div className="topbar-breadcrumb">
            <Button
              variant="unstyled"
              size="unset"
              ref={triggerRef}
              type="button"
              aria-label="Gezinmeyi aç"
              aria-expanded={isMobile && mobileNav}
              aria-controls="workspace-navigation"
              onClick={() => setMobileNav(true)}
              className="icon-button mobile-menu"
            >
              <Menu size={21} />
            </Button>
            <Button
              variant="unstyled"
              size="unset"
              type="button"
              className="topbar-workspace"
              aria-label={`Çalışma alanını değiştir: ${data.workspace.name}`}
              aria-haspopup="dialog"
              aria-expanded={dialog === "workspaces"}
              title={data.workspace.name}
              onClick={() => openWorkspaces()}
            >
              <WorkspaceAvatar
                workspace={data.workspace}
                size="small"
                className="topbar-workspace-mark"
              />
              <span className="topbar-workspace-name">
                {data.workspace.name}
              </span>
              <ChevronDown size={13} aria-hidden="true" />
            </Button>
            <span className="topbar-location">
              {view === "saved"
                ? "Kaydedilenler"
                : view === "inbox"
                  ? "Aktivite"
                  : view === "messages"
                    ? "Özel mesajlar"
                    : view === "profile"
                      ? "Profil"
                      : channel?.kind === "dm"
                        ? "Özel mesajlar"
                        : "Kanallar"}
            </span>
          </div>
          <Button
            variant="unstyled"
            size="unset"
            type="button"
            className="global-search"
            aria-label="Tüm mesajlarda ara"
            aria-haspopup="dialog"
            aria-expanded={dialog === "search"}
            onClick={() => setDialog("search")}
          >
            <Search size={17} aria-hidden="true" />
            <span>{data.workspace.name} içinde ara</span>
            <kbd aria-hidden="true">
              {/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl"} K
            </kbd>
          </Button>
          <div className="topbar-actions">
            <IconButton
              label={
                unreadActivityCount
                  ? `Aktiviteyi aç, ${unreadActivityCount} okunmamış bildirim`
                  : "Aktiviteyi aç"
              }
              className="topbar-activity"
              pressed={view === "inbox"}
              onClick={() => selectView("inbox")}
            >
              <Bell size={18} aria-hidden="true" />
              {unreadActivityCount > 0 && (
                <span className="topbar-unread" aria-hidden="true">
                  {unreadActivityCount > 99 ? "99+" : unreadActivityCount}
                </span>
              )}
            </IconButton>
            <IconButton
              label={
                quiet
                  ? "Uygulama içi uyarıları aç"
                  : "Uygulama içi uyarıları sustur"
              }
              className="topbar-quiet"
              pressed={quiet}
              onClick={() => {
                localStorage.setItem("mola:quiet", String(!quiet));
                setQuiet(!quiet);
                notify(
                  quiet
                    ? "Uygulama içi uyarılar açıldı."
                    : "Uygulama içi uyarılar susturuldu. Tarayıcı bildirimleri kendi ayarını kullanır.",
                );
              }}
            >
              {quiet ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </IconButton>
            <IconButton
              label="Profil ayarları"
              className="profile-settings-trigger"
              onClick={() => setDialog("settings")}
            >
              <Settings2 size={18} />
            </IconButton>
            <span className="topbar-divider" aria-hidden="true" />
            <ProfileIdentity
              className="topbar-avatar"
              user={data.user}
              online={connected}
              connected={connected}
              selfId={data.user.id}
              onOpen={openProfile}
            >
              <Avatar user={data.user} size="small" online={connected} />
              <span className="topbar-profile-name">
                {data.user.name.trim().split(/\s+/)[0]}
              </span>
            </ProfileIdentity>
          </div>
        </header>
        {!connected && !data.user.suspended && !data.workspace.suspended && (
          <div className="connection-banner" role="status">
            <WifiOff size={15} /> Bağlantı kuruluyor. Mesaj taslakların
            korunuyor.
          </div>
        )}
        <main id="main-content" className="main-content" tabIndex={-1}>
          {data.user.suspended || data.workspace.suspended ? (
            <section className="workspace-unavailable">
              <ShieldCheck size={32} />
              <h1>Bu çalışma alanına erişilemiyor</h1>
              <p>
                {data.workspace.suspended
                  ? "Alan yöneticisi çalışma alanını askıya aldı."
                  : "Bu alandaki üyeliğin askıya alındı veya sona erdi."}{" "}
                Diğer ekiplerine geçebilir, yeni bir alan oluşturabilir veya
                davetle katılabilirsin.
              </p>
              <Button
                variant="default"
                size="unset"
                type="submit"
                className="primary-button"
                onClick={() => openWorkspaces()}
              >
                Çalışma alanlarımı aç <ArrowRight size={17} />
              </Button>
            </section>
          ) : view === "profile" && profileId ? (
            <ProfilePage
              key={`${data.workspace.id}:${data.user.id}:${profileId}`}
              userId={profileId}
              workspaceId={data.workspace.id}
              currentUserId={data.user.id}
              connected={connected}
              onlineIds={data.onlineIds}
              liveUser={data.members.find((member) => member.id === profileId)}
              onBack={closeProfile}
              onEdit={() => setDialog("settings")}
              onMessage={(user) => openDm(user, profileId)}
              profileUrl={`${location.origin}${location.pathname}?workspace=${encodeURIComponent(data.workspace.id)}&profile=${encodeURIComponent(profileId)}`}
            />
          ) : (
            <>
              <Tabs
                render={<section />}
                value={tab}
                onValueChange={(value) => {
                  if (value === "chat" || value === "files" || value === "pins")
                    selectTab(value);
                }}
                className={`conversation-panel gap-0${isDirectConversation ? " dm-conversation" : view === "channel" ? " channel-conversation" : ""}`}
                aria-label="Sohbet"
              >
                <div
                  className={`channel-heading${isDirectConversation ? " direct-conversation-heading" : ""}`}
                >
                  {isDirectConversation ? (
                    <DirectConversationIdentity
                      peer={directPeer}
                      name={channelName}
                      selfId={data.user.id}
                      online={Boolean(
                        directPeer && data.onlineIds.includes(directPeer.id),
                      )}
                      connected={connected}
                      onProfile={openProfile}
                    />
                  ) : (
                    <>
                      <div className="channel-title-icon">
                        {view === "saved" ? (
                          <Bookmark size={23} />
                        ) : view === "inbox" ? (
                          <Bell size={23} />
                        ) : view === "messages" ? (
                          <MessageCircle size={23} />
                        ) : channel?.kind === "dm" ? (
                          <MessageCircle size={24} />
                        ) : (
                          <Hash size={25} />
                        )}
                      </div>
                      <div className="channel-title">
                        <h1
                          aria-label={
                            view === "channel" ? channelName : undefined
                          }
                        >
                          {view === "saved" ? (
                            "Kaydedilenler"
                          ) : view === "inbox" ? (
                            "Aktivite"
                          ) : view === "messages" ? (
                            "Özel mesajlar"
                          ) : (
                            <Button
                              variant="unstyled"
                              size="unset"
                              type="button"
                              className="channel-name-button"
                              aria-label={`#${channelName} kanalının bilgileri`}
                              aria-haspopup="dialog"
                              disabled={!channel}
                              onClick={() => setDialog("info")}
                            >
                              <span>{channelName}</span>
                              <ChevronDown size={16} aria-hidden="true" />
                            </Button>
                          )}
                          {view === "channel" && channel?.archived && (
                            <span className="channel-archived-label">
                              <Archive size={12} /> Arşivde
                            </span>
                          )}
                        </h1>
                        <p>
                          {view === "saved"
                            ? "Tekrar dönmek istediğin mesajlar, elinin altında."
                            : view === "inbox"
                              ? "Bahsetmeler, yanıtlar ve sana ulaşan bildirimler."
                              : view === "messages"
                                ? "Ekibinle bire bir konuşmaların, tek bir yerde."
                                : channel?.description ||
                                  "Ekibinle aynı yerde, aynı sohbette."}
                        </p>
                      </div>
                    </>
                  )}
                  {view === "channel" && (
                    <div className="channel-heading-actions">
                      {!isDirectConversation && (
                        <div className="member-stack">
                          {(onlineMembers.length
                            ? onlineMembers
                            : conversationMembers
                          )
                            .slice(0, 3)
                            .map((u) => (
                              <ProfileIdentity
                                key={u.id}
                                user={u}
                                online={data.onlineIds.includes(u.id)}
                                connected={connected}
                                selfId={data.user.id}
                                onOpen={openProfile}
                              >
                                <Avatar user={u} size="tiny" />
                              </ProfileIdentity>
                            ))}
                          <Button
                            variant="unstyled"
                            size="unset"
                            type="submit"
                            className="member-stack-count"
                            aria-label="Kanal üyelerini gör"
                            onClick={() => openMembers("channel")}
                          >
                            {conversationMembers.length} üye
                          </Button>
                        </div>
                      )}
                      <Button
                        variant="unstyled"
                        size="unset"
                        type="submit"
                        className="huddle-button"
                        aria-label="Bir araya gel"
                        onClick={() => startCall()}
                        disabled={channel?.archived || !channel}
                      >
                        <Headphones size={17} />
                        <span>Bir araya gel</span>
                      </Button>
                      <Button
                        variant="unstyled"
                        size="unset"
                        type="button"
                        className="icon-button"
                        title={
                          isDirectConversation
                            ? "Sohbet bilgisi"
                            : "Kanal bilgisi"
                        }
                        aria-label={
                          isDirectConversation
                            ? "Sohbet bilgisi"
                            : "Kanal bilgisi"
                        }
                        aria-haspopup="dialog"
                        disabled={!channel}
                        onClick={() => setDialog("info")}
                      >
                        <Info size={20} />
                      </Button>
                      {channel && channel.kind !== "dm" && (
                        <Button
                          variant="unstyled"
                          size="unset"
                          type="button"
                          className="icon-button channel-actions-trigger"
                          aria-label="Kanal işlemleri"
                          title="Kanal işlemleri"
                          aria-haspopup="menu"
                          aria-expanded={menuChannel?.id === channel.id}
                          onClick={(event) =>
                            openChannelMenu(channel, event.currentTarget)
                          }
                          onContextMenu={(event) =>
                            channelContext(event, channel)
                          }
                          onKeyDown={(event) => channelMenuKey(event, channel)}
                        >
                          <MoreHorizontal size={19} />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                {view === "channel" && (
                  <div className="channel-tabs-row">
                    <TabsList
                      variant="line"
                      className="channel-tabs items-stretch justify-start rounded-none"
                      aria-label="Kanal içeriği"
                    >
                      <TabsTrigger
                        value="chat"
                        id="channel-tab-chat"
                        aria-controls="channel-content"
                        className={`h-full flex-none rounded-none border-0${tab === "chat" ? " active" : ""}`}
                      >
                        <MessageSquare size={16} />
                        Sohbet
                      </TabsTrigger>
                      <TabsTrigger
                        value="files"
                        id="channel-tab-files"
                        aria-controls="channel-content"
                        className={`h-full flex-none rounded-none border-0${tab === "files" ? " active" : ""}`}
                      >
                        <FileText size={16} />
                        Dosyalar
                      </TabsTrigger>
                      <TabsTrigger
                        value="pins"
                        id="channel-tab-pins"
                        aria-controls="channel-content"
                        className={`h-full flex-none rounded-none border-0${tab === "pins" ? " active" : ""}`}
                      >
                        <Pin size={15} />
                        Sabitlenenler
                      </TabsTrigger>
                    </TabsList>
                    {isDirectConversation ? (
                      <span className="direct-conversation-kind">
                        <Lock size={12} aria-hidden="true" /> Özel sohbet
                      </span>
                    ) : (
                      <div
                        className="channel-tab-end"
                        data-connected={connected}
                        role="status"
                        aria-atomic="true"
                      >
                        <span
                          className={`small-status-dot${connected ? "" : " disconnected"}`}
                          aria-hidden="true"
                        />
                        {connected
                          ? `${onlineMembers.length} çevrimiçi`
                          : "Bağlantı bekleniyor"}
                      </div>
                    )}
                  </div>
                )}
                <div
                  id="channel-content"
                  className={`message-scroll ${view === "messages" || view === "inbox" ? "hub-scroll" : ""}`}
                  ref={scrollRef}
                  role={view === "channel" ? "tabpanel" : undefined}
                  aria-labelledby={
                    view === "channel" ? `channel-tab-${tab}` : undefined
                  }
                  tabIndex={0}
                >
                  {view === "saved" ? (
                    <SavedMessages
                      state={savedState}
                      channels={data.channels}
                      members={data.members}
                      selfId={data.user.id}
                      renderMessage={renderMessage}
                      onOpen={async (id) => {
                        const workspaceId = data.workspace.id;
                        const sequence = routeSequence.current;
                        try {
                          const message = await api<Message>(
                            `/messages/${encodeURIComponent(id)}`,
                            { headers: { "X-Workspace-Id": workspaceId } },
                          );
                          if (
                            dataRef.current?.workspace.id === workspaceId &&
                            routeSequence.current === sequence
                          )
                            await navigateMessage(message);
                        } catch (error) {
                          if (
                            dataRef.current?.workspace.id === workspaceId &&
                            routeSequence.current === sequence
                          ) {
                            if (
                              error instanceof ApiError &&
                              (error.status === 403 || error.status === 404)
                            ) {
                              savedState.invalidateUnavailable(id);
                              void refreshAccess();
                            }
                            throw error;
                          }
                        }
                      }}
                    />
                  ) : view === "messages" ? (
                    <DirectMessagesCenter
                      key={sidebarScope}
                      data={data}
                      unread={unread}
                      state={notificationState}
                      refreshToken={JSON.stringify(sidebar.conversations)}
                      socket={socket}
                      connected={connected}
                      onSelect={selectChannel}
                      onNewMessage={() => openMembers("dm")}
                      onProfile={openProfile}
                    />
                  ) : view === "inbox" ? (
                    <ActivityCenter
                      key={sidebarScope}
                      socket={socket}
                      workspaceId={data.workspace.id}
                      userId={data.user.id}
                      state={notificationState}
                      channels={data.channels}
                      members={data.members}
                      connected={connected}
                      onSettings={() => setDialog("notifications")}
                      onState={(next) => {
                        if (
                          dataRef.current?.user.id === data.user.id &&
                          next.workspaceId === dataRef.current?.workspace.id
                        ) {
                          setNotificationState(next);
                          setUnread(next.unreadByChannel);
                        }
                      }}
                      onOpen={async (id) => {
                        const message = await api<Message>(
                          `/messages/${encodeURIComponent(id)}`,
                          {
                            headers: {
                              "X-Workspace-Id": data.workspace.id,
                              "X-User-Id": data.user.id,
                            },
                          },
                        );
                        if (
                          dataRef.current?.user.id === data.user.id &&
                          dataRef.current?.workspace.id === data.workspace.id &&
                          viewRef.current === "inbox"
                        )
                          await navigateMessage(message);
                      }}
                    />
                  ) : tab !== "chat" ? (
                    <ChannelCollections
                      key={`${data.user.id}:${data.workspace.id}:${channelId}:${tab}`}
                      userId={data.user.id}
                      workspaceId={data.workspace.id}
                      channelId={channelId}
                      kind={tab}
                      members={data.members}
                      version={collectionVersion}
                      renderMessage={renderMessage}
                      onOpenFile={(file) =>
                        setPreview({
                          file,
                          channelId: file.channelId,
                          messageId: file.messageId,
                          parentId: file.parentId,
                          workspaceId: data.workspace.id,
                          userId: data.user.id,
                        })
                      }
                      onOpenMessage={async (id, isCurrent) => {
                        const sequence = routeSequence.current;
                        const scope = `${data.user.id}:${data.workspace.id}:${channelId}:${tab}`;
                        const message = await api<Message>(
                          `/messages/${encodeURIComponent(id)}`,
                          {
                            headers: {
                              "X-Workspace-Id": data.workspace.id,
                              "X-User-Id": data.user.id,
                            },
                          },
                        ).catch((error) => {
                          if (
                            isCurrent() &&
                            sequence === routeSequence.current &&
                            error instanceof ApiError &&
                            [401, 403, 404].includes(error.status)
                          ) {
                            setCollectionVersion((v) => v + 1);
                            void refreshAccess();
                          }
                          throw error;
                        });
                        if (
                          isCurrent() &&
                          sequence === routeSequence.current &&
                          scope ===
                            `${dataRef.current?.user.id}:${dataRef.current?.workspace.id}:${channelRef.current}:${tabRef.current}` &&
                          viewRef.current === "channel"
                        )
                          await navigateMessage(message);
                      }}
                      onBackToChat={() => selectTab("chat")}
                      onShareFile={
                        !channel?.archived
                          ? () =>
                              document
                                .querySelector<HTMLInputElement>(
                                  '.conversation-panel input[type="file"]',
                                )
                                ?.click()
                          : undefined
                      }
                    />
                  ) : messagesLoading ? (
                    <div className="messages-loading">
                      <Spinner label="Sohbet yükleniyor" />
                      {[1, 2, 3, 4].map((i) => (
                        <div className="message-skeleton" key={i}>
                          <span />
                          <div>
                            <i />
                            <i />
                            <i />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div
                      className={
                        isDirectConversation
                          ? "dm-timeline"
                          : "channel-timeline"
                      }
                    >
                      {hasMore ? (
                        <Button
                          variant="unstyled"
                          size="unset"
                          type="submit"
                          className="load-more"
                          disabled={historyBusy}
                          onClick={() => void loadMore()}
                        >
                          Önceki mesajları yükle
                        </Button>
                      ) : isDirectConversation ? (
                        <DirectConversationIntro
                          peer={directPeer}
                          name={channelName}
                          selfId={data.user.id}
                          online={Boolean(
                            directPeer &&
                            data.onlineIds.includes(directPeer.id),
                          )}
                          connected={connected}
                          onProfile={openProfile}
                          hasMessages={messages.length > 0}
                          onCompose={() =>
                            document
                              .querySelector<HTMLTextAreaElement>(
                                ".dm-conversation .composer textarea",
                              )
                              ?.focus()
                          }
                        />
                      ) : (
                        <div
                          className={`channel-welcome${messages.length ? " channel-welcome-history" : ""}`}
                        >
                          <span className="welcome-hash" aria-hidden="true">
                            {channel?.kind === "dm" ? (
                              <MessageCircle size={22} />
                            ) : (
                              <Hash size={24} />
                            )}
                          </span>
                          <div>
                            <h2>
                              {channel?.kind === "dm"
                                ? `${channelName} ile sohbetin`
                                : `#${channelName} kanalının başlangıcı`}
                            </h2>
                            <p>
                              {channel?.kind === "dm"
                                ? "Bu konuşmayı yalnızca ikiniz görebilirsiniz."
                                : "Bir fikir paylaş, soru sor veya ekibine merhaba de."}
                            </p>
                          </div>
                        </div>
                      )}
                      {historyError && (
                        <div className="history-error" role="alert">
                          <span>{historyError}</span>
                          <Button
                            variant="outline"
                            size="unset"
                            type="submit"
                            className="secondary-button"
                            disabled={historyBusy}
                            onClick={() =>
                              historyCursor
                                ? void loadMore()
                                : setHistoryRetry((v) => v + 1)
                            }
                          >
                            Tekrar dene
                          </Button>
                        </div>
                      )}
                      {!messages.length &&
                        !historyError &&
                        !isDirectConversation && (
                          <div className="first-message-note">
                            Bu kanalın ilk merhabası senden gelsin. 🌱
                          </div>
                        )}
                      {messages.map((message, index) => (
                        <div key={message.id}>
                          {(index === 0 ||
                            dateLabel(messages[index - 1].createdAt) !==
                              dateLabel(message.createdAt)) && (
                            <div className="date-divider">
                              <span>{dateLabel(message.createdAt)}</span>
                            </div>
                          )}
                          {renderMessage(
                            message,
                            false,
                            shouldGroupMessage(messages[index - 1], message),
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {view === "channel" &&
                  tab === "chat" &&
                  (awayFromLatest || pendingCount > 0) &&
                  !messagesLoading && (
                    <div className="latest-message-bar">
                      <Button
                        variant="unstyled"
                        size="unset"
                        type="submit"
                        onClick={() =>
                          scrollRef.current?.scrollTo({
                            top: scrollRef.current.scrollHeight,
                            behavior: messageScrollBehavior(),
                          })
                        }
                      >
                        <ArrowDown size={15} />
                        {pendingCount > 0 && (
                          <span className="new-message-count">
                            {pendingCount} yeni mesaj
                          </span>
                        )}
                        Son mesajlara git
                      </Button>
                    </div>
                  )}
                {view === "channel" && (
                  <>
                    <div className="typing-indicator" aria-live="polite">
                      {connected && typingNames.length > 0 && (
                        <>
                          {isDirectConversation && directPeer && (
                            <Avatar user={directPeer} size="tiny" />
                          )}
                          <span className="typing-dots" aria-hidden="true">
                            <i />
                            <i />
                            <i />
                          </span>
                          {typingNames.join(", ")} yazıyor...
                        </>
                      )}
                    </div>
                    {channel?.archived || !channel ? (
                      <p className="archived-channel-note" role="status">
                        {channel?.archived
                          ? "Bu kanal arşivde. Mesaj geçmişini okuyabilirsin; yeni mesaj için alan sahibinden kanalı açmasını iste."
                          : "Mesajlaşmaya başlamak için bir kanal oluştur."}
                      </p>
                    ) : (
                      <Composer
                        key={`${data.user.id}:${data.workspace.id}:${channelId}`}
                        userId={data.user.id}
                        workspaceId={data.workspace.id}
                        channelId={channelId}
                        channelName={channelName}
                        isDirectMessage={channel?.kind === "dm"}
                        members={conversationMembers}
                        onSent={onSent}
                        onError={fail}
                        onTyping={(active) => {
                          if (
                            Date.now() - typingSent.current > 1800 ||
                            !active
                          ) {
                            socket?.emit("typing", {
                              channelId,
                              typing: active,
                            });
                            typingSent.current = Date.now();
                          }
                        }}
                      />
                    )}
                  </>
                )}
              </Tabs>
              {thread && threadChannel ? (
                <aside className="thread-panel">
                  <div className="details-heading">
                    <h2>Mesaj dizisi</h2>
                    <IconButton
                      label="Mesaj dizisini kapat"
                      onClick={closeThread}
                    >
                      <X size={19} />
                    </IconButton>
                  </div>
                  <div className="thread-messages">
                    {renderMessage(thread, true)}
                    {!threadLoading &&
                      linkedReply?.parentId === thread.id &&
                      !replies.some((r) => r.id === linkedReply.id) && (
                        <section
                          className="linked-reply"
                          aria-label="Bağlantıdaki yanıt"
                        >
                          <strong>Bağlantıdaki yanıt</strong>
                          {renderMessage(linkedReply, true)}
                          <small>Konuşmanın en son yanıtları aşağıda.</small>
                        </section>
                      )}
                    <div className="thread-divider">
                      {thread.replyCount} yanıt
                    </div>
                    {repliesHasMore && (
                      <Button
                        variant="unstyled"
                        size="unset"
                        type="submit"
                        className="load-more"
                        disabled={replyBusy}
                        onClick={() => void loadMoreReplies()}
                      >
                        Önceki yanıtları yükle
                      </Button>
                    )}
                    {replyError && (
                      <div className="history-error" role="alert">
                        <span>{replyError}</span>
                        <Button
                          variant="outline"
                          size="unset"
                          type="submit"
                          className="secondary-button"
                          disabled={replyBusy}
                          onClick={() =>
                            replyCursor
                              ? void loadMoreReplies()
                              : setReplyRetry((v) => v + 1)
                          }
                        >
                          Tekrar dene
                        </Button>
                      </div>
                    )}
                    {threadLoading ? (
                      <Spinner label="Yanıtlar yükleniyor" />
                    ) : (
                      replies.map((m) => renderMessage(m, true))
                    )}
                  </div>
                  {threadChannel.archived ? (
                    <p className="archived-channel-note">
                      Bu kanal arşivde. Yeni yanıt eklenemez.
                    </p>
                  ) : (
                    <Composer
                      key={`${data.user.id}:${data.workspace.id}:${thread.channelId}:${thread.id}`}
                      userId={data.user.id}
                      workspaceId={data.workspace.id}
                      channelId={thread.channelId}
                      channelName={channelName}
                      isDirectMessage={threadChannel.kind === "dm"}
                      parentId={thread.id}
                      members={getConversationMembers(
                        threadChannel,
                        data.members,
                      )}
                      onSent={onSent}
                      onError={fail}
                    />
                  )}
                </aside>
              ) : null}
            </>
          )}
        </main>
      </div>
      {workspaceLifecycle && (
        <WorkspaceLifecycleDialog
          key={data.workspace.id + workspaceLifecycle}
          data={data}
          mode={workspaceLifecycle}
          inCall={call.joined || call.joining}
          onClose={() => setWorkspaceLifecycle(null)}
          onComplete={(next) => {
            acceptData(next);
            setWorkspaceLifecycle(null);
            notify(
              workspaceLifecycle === "delete"
                ? "Çalışma alanı silindi."
                : "Çalışma alanından ayrıldın.",
            );
          }}
        />
      )}
      {dialog === "workspaces" && (
        <WorkspaceSwitcher
          workspaces={workspaceOrder.items}
          order={{
            canReorder: workspaceOrder.canReorder,
            saving: workspaceOrder.saving,
            error: workspaceOrder.error,
            onReorder: reorderWorkspaces,
            onRetry: workspaceOrder.refresh,
          }}
          initialOrderEditing={workspaceOrderEditing}
          onRefresh={() => void refreshAccess()}
          currentId={data.workspace.id}
          isDemo={data.workspace.isDemo}
          inCall={call.joined || call.joining}
          initialMode={workspaceMode}
          initialInvite={workspaceInvite}
          initialTarget={workspaceTarget}
          busy={workspaceBusy}
          onAction={(action) => {
            const params = new URLSearchParams(location.search);
            return changeWorkspace(
              action,
              Boolean(
                action.kind === "switch" &&
                action.id === params.get("workspace") &&
                action.id !== data.workspace.id,
              ),
            );
          }}
          onClose={() => {
            setDialog(null);
            if (
              new URLSearchParams(location.search).get("workspace") !==
              data.workspace.id
            )
              writeAddress(
                viewRef.current === "profile" && profileId
                  ? {
                      workspaceId: data.workspace.id,
                      view: "profile",
                      profileId,
                    }
                  : contentRoute(),
                "replace",
              );
          }}
        />
      )}
      {voicePreview && (
        <VoiceRoomPreview
          channel={voicePreview}
          peers={voiceChannels.get(voicePreview.id) || []}
          currentUserId={data.user.id}
          onOpenProfile={(id) => {
            setVoicePreviewId(null);
            openProfile(id);
          }}
          isCurrentCall={
            (call.joined || call.joining) && call.channelId === voicePreview.id
          }
          activeChannelName={
            call.joined || call.joining ? call.channelName : undefined
          }
          busy={call.joining}
          connected={connected}
          onClose={() => setVoicePreviewId(null)}
          onJoin={() => {
            setVoicePreviewId(null);
            startCall(voicePreview);
          }}
        />
      )}
      {preview &&
        preview.userId === data.user.id &&
        preview.workspaceId === data.workspace.id &&
        data.channels.some((c) => c.id === preview.channelId) && (
          <AttachmentPreview
            key={`${preview.userId}:${preview.workspaceId}:${preview.file.id}`}
            target={preview}
            onClose={() => setPreview(null)}
            onOpenMessage={async () => {
              const target = preview;
              const sequence = routeSequence.current;
              const message = await api<Message>(
                `/messages/${encodeURIComponent(target.messageId)}`,
                {
                  headers: {
                    "X-Workspace-Id": target.workspaceId,
                    "X-User-Id": target.userId,
                  },
                },
              ).catch((error) => {
                if (
                  previewRef.current === target &&
                  error instanceof ApiError &&
                  [401, 403, 404].includes(error.status)
                )
                  void refreshAccess();
                throw error;
              });
              if (
                previewRef.current !== target ||
                sequence !== routeSequence.current ||
                dataRef.current?.user.id !== target.userId ||
                dataRef.current?.workspace.id !== target.workspaceId ||
                !dataRef.current.channels.some((c) => c.id === target.channelId)
              )
                return;
              setPreview(null);
              await navigateMessage(message);
            }}
          />
        )}
      {dialog === "search" && (
        <SearchDialog
          data={data}
          onAccessChanged={() => void refreshAccess()}
          onClose={() => setDialog(null)}
          onSelect={async (message) => {
            if (
              dataRef.current?.user.id === data.user.id &&
              dataRef.current?.workspace.id === data.workspace.id
            )
              await navigateMessage(message);
          }}
        />
      )}
      {dialog === "integrations" && canManage && (
        <IntegrationsDialog
          key={data.workspace.id}
          channels={data.channels}
          isDemo={data.workspace.isDemo}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "notifications" && (
        <NotificationSettings
          key={`${data.user.id}:${data.workspace.id}`}
          userId={data.user.id}
          workspaceId={data.workspace.id}
          workspaceName={data.workspace.name}
          channels={data.channels}
          members={data.members}
          revision={notificationSettingsRevision}
          onClose={() => setDialog(null)}
        />
      )}
      {notificationChannel && (
        <Modal
          title="Kanal bildirimleri"
          onClose={() => setChannelNotifications(null)}
        >
          <ChannelNotificationPreferences
            key={`${data.user.id}:${data.workspace.id}:${notificationChannel.id}`}
            userId={data.user.id}
            workspaceId={data.workspace.id}
            channelId={notificationChannel.id}
            channelName={
              conversationIdentity(
                notificationChannel,
                data.user.id,
                data.members,
              ).name
            }
            revision={notificationSettingsRevision}
          />
        </Modal>
      )}
      {dialog === "channel" && (
        <CreateChannel
          initialKind={createChannelKind}
          onClose={() => setDialog(null)}
          onCreate={(created) => {
            if (
              dataRef.current?.workspace.id !== data.workspace.id ||
              dataRef.current?.user.id !== data.user.id
            )
              return;
            setData((old) =>
              old
                ? {
                    ...old,
                    channels: [
                      ...old.channels.filter((c) => c.id !== created.id),
                      created,
                    ],
                  }
                : old,
            );
            if (created.kind === "text") selectChannel(created.id);
            if (created.visibility === "private") setChannelAccess(created);
            setDialog(null);
            notify(
              created.kind === "voice"
                ? `${created.name} sesli odası oluşturuldu.`
                : `#${created.name} kanalı oluşturuldu.`,
            );
          }}
        />
      )}
      {dialog === "invite" && (
        <InviteDialog data={data} onClose={() => setDialog(null)} />
      )}
      {dialog === "settings" && (
        <SettingsDialog
          user={data.user}
          workspaceId={data.workspace.id}
          connected={connected}
          onPhotoChanged={updateOwnProfile}
          isDemo={data.workspace.isDemo}
          onClose={() => setDialog(null)}
          onSave={(user) => {
            if (
              dataRef.current?.workspace.id !== data.workspace.id ||
              dataRef.current?.user.id !== data.user.id
            )
              return;
            setData((old) =>
              old
                ? {
                    ...old,
                    user,
                    members: old.members.map((m) =>
                      m.id === user.id ? user : m,
                    ),
                  }
                : old,
            );
            notify("Profilin güncellendi.");
          }}
          onLogout={() => void logout()}
          onNotifications={() => setDialog("notifications")}
          onManage={
            canManage
              ? () => {
                  setDialog(null);
                  setAdminOpen(true);
                }
              : undefined
          }
          quiet={quiet}
          onQuiet={() => {
            setQuiet(!quiet);
            localStorage.setItem("mola:quiet", String(!quiet));
          }}
        />
      )}
      {dialog === "info" && channel && (
        <Modal
          title={channel.kind === "dm" ? "Sohbet hakkında" : "Kanal hakkında"}
          onClose={() => setDialog(null)}
        >
          <div className="channel-info-content">
            <div className="channel-info-summary">
              <span className="channel-detail-mark" aria-hidden="true">
                {channel.kind === "dm" ? (
                  <MessageCircle size={21} />
                ) : channel.visibility === "private" ? (
                  <Lock size={21} />
                ) : (
                  <Hash size={21} />
                )}
              </span>
              <div>
                <h3>{channelName}</h3>
                <div className="channel-detail-meta">
                  <span>
                    <Users size={14} />
                    {conversationMembers.length} üye
                  </span>
                  <span>
                    <ShieldCheck size={14} />
                    {channel.kind === "dm"
                      ? "Özel sohbet"
                      : channel.visibility === "private"
                        ? "Özel kanal"
                        : "Ekip kanalı"}
                  </span>
                  {channel.archived && (
                    <span>
                      <Archive size={14} />
                      Arşivlenmiş
                    </span>
                  )}
                </div>
              </div>
            </div>
            <p className="channel-about">
              {channel.description || "Ekibinle aynı yerde, aynı sohbette."}
            </p>
            {channel.kind !== "dm" && (
              <p className="channel-membership-scope">
                {channel.visibility === "private"
                  ? "Yalnızca bu kanala eklenen kişiler erişebilir. Çalışma alanına davet etmek bu kanala erişim vermez."
                  : "Bu kanal çalışma alanı üyelerine açık. Yalnızca seçtiğin kişiler erişsin istiyorsan kanal erişiminden özel kanal yap."}
              </p>
            )}
            <div className="channel-info-members">
              <div className="detail-section-title">
                <h4>
                  {channel.kind === "dm" ? "Sohbettekiler" : "Kanal üyeleri"}
                </h4>
                <Button
                  variant="unstyled"
                  size="unset"
                  type="submit"
                  aria-label="Kanal üyelerini gör"
                  onClick={() => openMembers("channel")}
                >
                  Tümünü gör
                </Button>
              </div>
              <div className="detail-members">
                {conversationMembers.slice(0, 5).map((user) => (
                  <ProfileIdentity
                    key={user.id}
                    user={user}
                    online={data.onlineIds.includes(user.id)}
                    connected={connected}
                    selfId={data.user.id}
                    onOpen={openProfile}
                  >
                    <Avatar
                      user={user}
                      size="small"
                      online={connected && data.onlineIds.includes(user.id)}
                    />
                    <span>
                      <strong>
                        {user.name}
                        {user.id === data.user.id && <small> (sen)</small>}
                      </strong>
                      <small>
                        {user.status ||
                          (!connected
                            ? "Durum güncellenemiyor"
                            : data.onlineIds.includes(user.id)
                              ? "Çevrimiçi"
                              : "Çevrimdışı")}
                      </small>
                    </span>
                    {user.role === "owner" && (
                      <span
                        className="owner-badge"
                        title="Çalışma alanı sahibi"
                      >
                        ✦
                      </span>
                    )}
                  </ProfileIdentity>
                ))}
              </div>
            </div>
            <div className="channel-info-actions">
              {channel.kind !== "dm" && (
                <Button
                  variant="outline"
                  size="unset"
                  type="submit"
                  className="secondary-button full-width"
                  onClick={() => {
                    setDialog(null);
                    setChannelAccess(channel);
                  }}
                >
                  <ShieldCheck size={16} />
                  Kanal erişimi ve üyeler
                </Button>
              )}
              {canManage && channel.kind !== "dm" && (
                <Button
                  variant="outline"
                  size="unset"
                  type="submit"
                  className="secondary-button full-width"
                  onClick={() => {
                    setDialog(null);
                    setChannelAccess(channel);
                  }}
                >
                  <Plus size={16} />
                  Kanala üye ekle
                </Button>
              )}
              <Button
                variant="default"
                size="unset"
                type="submit"
                className="primary-button full-width"
                disabled={channel.archived}
                onClick={() => {
                  setDialog(null);
                  startCall();
                }}
              >
                <Headphones size={17} />
                Bir araya gel
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {dialog === "archives" && (
        <Modal title="Arşivlenmiş kanallar" onClose={() => setDialog(null)}>
          <p className="modal-description">
            Arşivlenen kanalların geçmişini okuyabilir, yetkin varsa yeniden
            kullanıma açabilirsin.
          </p>
          <div className="archive-channel-list">
            {data.channels
              .filter((c) => c.kind !== "dm" && c.archived)
              .map((c) => (
                <div
                  className="archive-channel-row"
                  key={c.id}
                  onContextMenu={(event) => channelContext(event, c)}
                >
                  <Button
                    variant="unstyled"
                    size="unset"
                    type="submit"
                    onClick={() => {
                      selectChannel(c.id);
                      setDialog(null);
                    }}
                    onKeyDown={(event) => channelMenuKey(event, c)}
                  >
                    <strong>{c.name}</strong>
                    <small>
                      {c.description ||
                        (c.kind === "voice"
                          ? "Sesli oda"
                          : "Yazılı kanal")}{" "}
                      · Geçmişi aç
                    </small>
                  </Button>
                  {canEditChannel(c) && (
                    <IconButton
                      label={`${c.name} arşivden çıkar`}
                      onClick={() => editChannel(c, "archive")}
                    >
                      <ArchiveRestore size={18} />
                    </IconButton>
                  )}
                  <Button
                    variant="unstyled"
                    size="unset"
                    type="button"
                    className="icon-button"
                    aria-label={`${c.name} kanal işlemleri`}
                    title="Kanal işlemleri"
                    aria-haspopup="menu"
                    aria-expanded={menuChannel?.id === c.id}
                    onClick={(event) => openChannelMenu(c, event.currentTarget)}
                  >
                    <MoreHorizontal size={18} />
                  </Button>
                </div>
              ))}
            {!data.channels.some((c) => c.kind !== "dm" && c.archived) && (
              <p className="archive-empty">
                Henüz arşivlenmiş kanal yok. Bir kanalı silmeden listeden
                kaldırmak için kanal menüsündeki “Kanalı arşivle” seçeneğini
                kullanabilirsin.
              </p>
            )}
          </div>
        </Modal>
      )}
      {dialog === "move-channel" &&
        data.channels.some(
          (c) => c.id === channelToMove && c.kind === "text" && !c.archived,
        ) && (
          <ChannelGroupMove
            key={sidebarScope + channelToMove}
            name={data.channels.find((c) => c.id === channelToMove)!.name}
            channelId={channelToMove!}
            groups={sidebar.preferences.channelGroups || []}
            error={sidebar.error}
            onClose={() => setDialog(null)}
            onMove={async (target) => {
              const groups = (sidebar.preferences.channelGroups || []).map(
                (group) => ({
                  ...group,
                  channelIds: group.channelIds.filter(
                    (id) => id !== channelToMove,
                  ),
                }),
              );
              const destination = groups.find((group) => group.id === target);
              if (target && !destination) return false;
              if (destination) destination.channelIds.push(channelToMove!);
              return updateChannelGroups(
                groups,
                undefined,
                "Kanal yeni bölümüne taşındı.",
              );
            }}
          />
        )}
      {dialog === "members" && (
        <Modal
          title={
            memberScope === "dm" ? "Yeni direkt mesaj" : "Ekibindeki insanlar"
          }
          onClose={() => setDialog(null)}
        >
          <p className="modal-description">
            {memberScope === "channel"
              ? `${channelName} sohbetinin üyeleri`
              : data.workspace.name}{" "}
            ·{" "}
            {memberScope === "channel"
              ? conversationMembers.length
              : data.members.filter((user) => !user.suspended).length}{" "}
            üye
          </p>
          <div className="search-input-wrap member-search">
            <Search size={18} />
            <Input
              unstyled
              aria-label="Ekip arkadaşını ara"
              data-autofocus
              placeholder="İsme göre ara…"
              value={memberQuery}
              onChange={(event) => setMemberQuery(event.target.value)}
              autoFocus
            />
            {memberQuery && (
              <IconButton
                label="Kişi aramasını temizle"
                onClick={() => setMemberQuery("")}
              >
                <X size={16} />
              </IconButton>
            )}
          </div>
          <div className="members-modal-list">
            {listedMembers.map((user) =>
              memberScope === "dm" ? (
                <Button
                  variant="unstyled"
                  size="unset"
                  key={user.id}
                  type="button"
                  disabled={directPending}
                  aria-label={`${user.name} ile mesajlaş`}
                  onClick={() => {
                    setDirectPending(true);
                    void openDm(user).finally(() => setDirectPending(false));
                  }}
                >
                  <Avatar
                    user={user}
                    online={connected && data.onlineIds.includes(user.id)}
                  />
                  <span>
                    <strong>{user.name}</strong>
                    <small>
                      {user.status ||
                        (connected
                          ? data.onlineIds.includes(user.id)
                            ? "Çevrimiçi"
                            : "Çevrimdışı"
                          : "Durum güncellenemiyor")}
                    </small>
                  </span>
                  <ChevronRight size={17} />
                </Button>
              ) : (
                <ProfileIdentity
                  key={user.id}
                  user={user}
                  online={data.onlineIds.includes(user.id)}
                  connected={connected}
                  selfId={data.user.id}
                  onOpen={openProfile}
                >
                  <Avatar
                    user={user}
                    online={connected && data.onlineIds.includes(user.id)}
                  />
                  <span>
                    <strong>{user.name}</strong>
                    <small>
                      {user.status ||
                        (!connected
                          ? "Durum güncellenemiyor"
                          : data.onlineIds.includes(user.id)
                            ? "Çevrimiçi"
                            : "Çevrimdışı")}
                    </small>
                  </span>
                  <ChevronRight size={17} />
                </ProfileIdentity>
              ),
            )}
            {!listedMembers.length && (
              <p className="member-search-empty" role="status">
                Bu isimle bir kişi bulunamadı. Farklı bir isim deneyebilirsin.
              </p>
            )}
          </div>
          <Button
            variant="default"
            size="unset"
            type="submit"
            className="primary-button full-width"
            disabled={!canManage}
            onClick={() => {
              if (
                memberScope === "channel" &&
                channel?.kind !== "dm" &&
                channel
              ) {
                setDialog(null);
                setChannelAccess(channel);
              } else setDialog("invite");
            }}
          >
            <Plus size={17} />
            {memberScope === "channel" && channel?.kind !== "dm" && channel
              ? "Kanala üye ekle"
              : "Çalışma alanına davet et"}
          </Button>
        </Modal>
      )}
      {dialog === "help" && (
        <Modal title="Mola’ya hoş geldin." onClose={() => setDialog(null)}>
          <div className="help-brand">
            <Logo />
            <p>Birlikte, aynı yerde.</p>
          </div>
          <div className="help-items">
            <div>
              <MonitorUp size={22} />
              <span>
                <strong>Mola masaüstü uygulaması</strong>
                <p>Cihazına uygun Windows, macOS veya Linux sürümünü indir.</p>
                <a href="/download" target="_blank" rel="noopener noreferrer">
                  Masaüstü uygulamasını indir →
                </a>
              </span>
            </div>
            <div>
              <Hash size={22} />
              <span>
                <strong>Her konuya bir kanal</strong>
                <p>
                  Kanallarda konuş, mesajları yanıtlayarak konuları düzenli tut.
                </p>
              </span>
            </div>
            <div>
              <Headphones size={22} />
              <span>
                <strong>Bir tıkla bir araya gel</strong>
                <p>
                  Sesli odaya katıl veya kanalda görüşme başlat. Kameranı
                  açabilir, ekranını paylaşabilirsin. Odalarda en fazla 6 kişi
                  bulunabilir.
                </p>
              </span>
            </div>
            <div>
              <Bookmark size={22} />
              <span>
                <strong>İyi fikirleri kaybetme</strong>
                <p>
                  Mesajları kaydet, önemli notları kanala sabitle. Kaydedilenler
                  bu tarayıcıda saklanır.
                </p>
              </span>
            </div>
            <div>
              <Search size={22} />
              <span>
                <strong>Aradığını hemen bul</strong>
                <p>
                  <kbd>Ctrl / ⌘ + K</kbd> ile arama. <kbd>Enter</kbd> ile mesaj
                  gönder, <kbd>Shift + Enter</kbd> ile alt satıra geç.
                </p>
              </span>
            </div>
          </div>
          {data.workspace.isDemo && (
            <p className="demo-notice">
              Örnek alandasın. Ekip üyeleri ve eski mesajlar tanıtım amaçlıdır.
              Kendi ekibini kurmak için profil menüsünden çıkış yapıp hesap
              oluşturabilirsin.
            </p>
          )}
        </Modal>
      )}
      <IncomingCallTransfer
        call={call}
        onAccept={() => {
          setCallSetupChannel(null);
          setShowCall(true);
          void call.acceptTransfer();
        }}
      />
      {(showCall || call.joined || call.joining || call.error) && (
        <CallPanel
          call={call}
          minimized={!showCall && call.joined}
          onExpand={() => setShowCall(true)}
          onClose={() => setShowCall(false)}
          onOpenProfile={(id) => {
            setShowCall(false);
            openProfile(id);
          }}
        />
      )}
      {callSetupChannel && (
        <CallSetup
          call={call}
          channel={callSetupChannel}
          connected={connected}
          participantCount={
            connected && callSetupChannel.kind === "voice"
              ? (voiceChannels.get(callSetupChannel.id) || []).length
              : undefined
          }
          capacity={6}
          onClose={() => setCallSetupChannel(null)}
          onJoin={() => {
            const target = callSetupChannel;
            setCallSetupChannel(null);
            setShowCall(true);
            void call.join({ id: target.id, name: target.name });
          }}
        />
      )}
      {callSwitchTarget && (
        <Modal
          title="Başka bir görüşmeye geç"
          onClose={() => setCallSwitchTarget(null)}
        >
          <p className="modal-description">
            {call.joined || call.joining
              ? "Mevcut görüşmeden ayrılıp yeni odanın hazırlık ekranını açacaksın. Mikrofon, kamera ve ekran paylaşımın duracak."
              : "Seçtiğin odanın hazırlık ekranını açabilirsin."}
          </p>
          <div className="voice-switch-details">
            <div>
              <small>Mevcut görüşme</small>
              <strong>{call.channelName || "Görüşme sona erdi"}</strong>
            </div>
            <ArrowRight size={18} aria-hidden="true" />
            <div>
              <small>Geçeceğin oda</small>
              <strong>{callSwitchTarget.name}</strong>
            </div>
          </div>
          <div className="voice-switch-actions">
            <Button
              variant="outline"
              size="unset"
              type="submit"
              className="secondary-button"
              onClick={() => setCallSwitchTarget(null)}
            >
              Burada kal
            </Button>
            <Button
              variant="default"
              size="unset"
              type="submit"
              className="primary-button"
              disabled={!connected}
              onClick={() => {
                const target = dataRef.current?.channels.find(
                  (item) => item.id === callSwitchTarget.id && !item.archived,
                );
                if (!target) {
                  setCallSwitchTarget(null);
                  return;
                }
                call.leave();
                setShowCall(false);
                setCallSwitchTarget(null);
                setCallSetupChannel(target);
              }}
            >
              Ayrıl ve devam et <ArrowRight size={16} aria-hidden="true" />
            </Button>
          </div>
        </Modal>
      )}
      {channelAccess && (
        <ChannelAccessDialog
          channel={channelAccess}
          currentUserId={data.user.id}
          onClose={() => setChannelAccess(null)}
          onChanged={() => {
            void refreshAccess();
          }}
        />
      )}
      {channelAction && actionChannel && canEditChannel(actionChannel) && (
        <ChannelActionsDialog
          channel={actionChannel}
          mode={channelAction.mode}
          workspaceId={channelAction.workspaceId}
          userId={channelAction.userId}
          onClose={() => setChannelAction(null)}
          onChanged={(updated) => {
            if (
              dataRef.current?.workspace.id !== channelAction.workspaceId ||
              dataRef.current?.user.id !== channelAction.userId
            )
              return;
            setData((old) =>
              old
                ? {
                    ...old,
                    channels: old.channels.map((c) =>
                      c.id === updated.id ? updated : c,
                    ),
                  }
                : old,
            );
            setChannelAction(null);
            notify(
              channelAction.mode === "archive"
                ? updated.archived
                  ? "Kanal arşivlendi. Geçmişi Arşivlenmiş kanallar bölümünden açabilirsin."
                  : "Kanal arşivden çıkarıldı."
                : "Kanal adı ve açıklaması güncellendi.",
            );
            void refreshAccess();
          }}
          onDeleted={(id) => {
            if (
              dataRef.current?.workspace.id !== channelAction.workspaceId ||
              dataRef.current?.user.id !== channelAction.userId
            )
              return;
            setChannelAction(null);
            setChannelMenu(null);
            setUnread((old) => {
              const next = { ...old };
              delete next[id];
              return next;
            });
            const current = dataRef.current;
            acceptData({
              ...current,
              channels: current.channels.filter((c) => c.id !== id),
            });
            notify("Kanal ve içeriği kalıcı olarak silindi.");
            void refreshAccess();
          }}
        />
      )}
      <ContextMenu
        position={menuChannel && channelMenu ? channelMenu.position : null}
        items={channelMenuItems}
        label={
          menuChannel
            ? `${menuChannel.name} kanal işlemleri`
            : "Kanal işlemleri"
        }
        onClose={() => setChannelMenu(null)}
        returnFocus={channelMenu?.anchor}
      />
      {adminOpen &&
        (["owner", "admin"].includes(data.user.role) ||
          data.user.siteAdmin) && (
          <AdminPanel
            onWorkspaceUpdated={(workspace) => {
              if (
                dataRef.current?.user.id === data.user.id &&
                dataRef.current.workspace.id === data.workspace.id
              )
                workspaceUpdated(workspace);
            }}
            data={data}
            onClose={() => setAdminOpen(false)}
            onChanged={() => void refreshAccess()}
            initialSection={adminSection}
            onDeleteWorkspace={() => {
              setAdminOpen(false);
              setWorkspaceLifecycle("delete");
            }}
          />
        )}
      {toast && (
        <div
          className={`toast ${toastError ? "toast-error" : ""}`}
          role={toastError ? "alert" : "status"}
        >
          {toastError ? <Info size={18} /> : <Check size={18} />}
          <span>{toast}</span>
          {!toastError &&
            toast === (sidebarUndo?.notice || "Kanal sıralaman kaydedildi.") &&
            sidebarUndo?.scope === sidebarScope && (
              <Button
                variant="unstyled"
                size="unset"
                type="submit"
                className="sidebar-undo"
                disabled={sidebar.saving}
                onClick={() => {
                  const undo = sidebarUndo;
                  setSidebarUndo(null);
                  void (
                    undo.groups
                      ? sidebar.setChannelGroups(undo.groups, undo.ids)
                      : sidebar.setOrder(undo.section, undo.ids)
                  ).then((ok) => {
                    if (ok) notify("Önceki sıralamaya dönüldü.");
                  });
                }}
              >
                Geri al
              </Button>
            )}
          <IconButton label="Bildirimi kapat" onClick={() => setToast("")}>
            <X size={15} />
          </IconButton>
        </div>
      )}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  text,
  extra,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon">{icon}</span>
      <h2>{title}</h2>
      <p>{text}</p>
      {extra}
    </div>
  );
}

function CreateChannel({
  onClose,
  onCreate,
  initialKind = "text",
}: {
  onClose: () => void;
  onCreate: (channel: Channel) => void;
  initialKind?: "text" | "voice";
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<"text" | "voice">(initialKind);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onCreate(
        await post<Channel>("/channels", {
          ...Object.fromEntries(new FormData(e.currentTarget)),
          kind,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Yeni bir kanal oluştur" onClose={onClose}>
      <p className="modal-description">
        Bir projeye, bir konuya ya da güzel bir sohbete yer aç.
      </p>
      <form onSubmit={submit}>
        <div className="channel-type-picker">
          <Button
            variant="unstyled"
            size="unset"
            type="button"
            className={kind === "text" ? "active" : ""}
            aria-pressed={kind === "text"}
            onClick={() => setKind("text")}
          >
            <Hash size={22} />
            <strong>Yazılı kanal</strong>
            <small>Fikirleri ve dosyaları paylaş</small>
          </Button>
          <Button
            variant="unstyled"
            size="unset"
            type="button"
            className={kind === "voice" ? "active" : ""}
            aria-pressed={kind === "voice"}
            onClick={() => setKind("voice")}
          >
            <Volume2 size={22} />
            <strong>Sesli oda</strong>
            <small>Birlikte konuş, ekranını paylaş</small>
          </Button>
        </div>
        <label>
          Kanal adı
          <Input
            unstyled
            name="name"
            placeholder={
              kind === "text" ? "Örn. yeni-fikirler" : "Örn. Tasarım odası"
            }
            required
            minLength={2}
            maxLength={40}
            autoFocus
          />
        </label>
        <label>
          Kanal açıklaması
          <Textarea
            unstyled
            name="description"
            placeholder="Burada neler konuşacağız?"
            maxLength={240}
            rows={3}
          />
        </label>
        <label>
          Görünürlük
          <NativeSelect unstyled name="visibility" defaultValue="public">
            <option value="public">Ekip kanalı — çalışma alanı üyeleri</option>
            <option value="private">
              Özel kanal — yalnızca eklenen kişiler
            </option>
          </NativeSelect>
        </label>
        <p className="channel-private-label">
          Özel kanalı oluşturduktan sonra kanal erişiminden üyelerini
          ekleyebilirsin.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <Button
            variant="outline"
            size="unset"
            type="button"
            className="secondary-button"
            onClick={onClose}
          >
            Vazgeç
          </Button>
          <Button
            variant="default"
            size="unset"
            type="submit"
            className="primary-button"
            disabled={busy}
          >
            {busy ? (
              <Spinner label="Oluşturuluyor" />
            ) : (
              <>
                <Plus size={17} />
                Kanal oluştur
              </>
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function InviteDialog({
  data,
  onClose,
}: {
  data: Bootstrap;
  onClose: () => void;
}) {
  const [url, setUrl] = useState("");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  async function create() {
    setBusy(true);
    setError("");
    try {
      const result = await post<{ url: string; expiresAt: string }>("/invites");
      setUrl(result.url);
      setExpires(result.expiresAt);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Çalışma alanına davet et" onClose={onClose}>
      <div className="invite-modal-art">
        <Users size={37} />
        <span>✦</span>
      </div>
      <p className="modal-description">
        Davet bağlantısını paylaş, ekip arkadaşların{" "}
        <strong>{data.workspace.name}</strong> çalışma alanına katılsın.
      </p>
      <p className="workspace-invite-scope">
        Bu bağlantı yalnızca çalışma alanına üyelik verir. Yeni üyeler açık
        kanalları görebilir; özel kanallara her kanalın{" "}
        <strong>Kanala üye ekle</strong> alanından ayrıca eklenir.
      </p>
      {data.workspace.isDemo ? (
        <p className="demo-notice">
          Bu alan örnek içerikleri keşfetmen için oluşturuldu. Ekibini davet
          etmek için profil menüsünden çıkış yapıp kendi çalışma alanını
          oluştur.
        </p>
      ) : !["owner", "admin"].includes(data.user.role) &&
        !data.user.siteAdmin ? (
        <p className="demo-notice">
          Davet bağlantısı oluşturmak için çalışma alanı sahibinden yardım iste.
        </p>
      ) : url ? (
        <>
          <label>
            Davet bağlantısı
            <div className="invite-link">
              <Input
                unstyled
                value={url}
                readOnly
                aria-label="Davet bağlantısı"
                onFocus={(e) => e.target.select()}
              />
              <IconButton
                label="Davet bağlantısını kopyala"
                onClick={() => {
                  navigator.clipboard
                    .writeText(url)
                    .then(() => setCopied(true))
                    .catch(() =>
                      setError("Bağlantıyı seçip kopyalayabilirsin."),
                    );
                }}
              >
                {copied ? <Check size={18} /> : <Copy size={18} />}
              </IconButton>
            </div>
          </label>
          <p className="input-help">
            {copied
              ? "Bağlantı kopyalandı."
              : `Bağlantı ${new Date(expires).toLocaleDateString("tr-TR")} tarihine kadar geçerli.`}
          </p>
        </>
      ) : (
        <Button
          variant="default"
          size="unset"
          type="submit"
          className="primary-button full-width"
          onClick={() => void create()}
          disabled={busy}
        >
          {busy ? (
            <Spinner label="Bağlantı hazırlanıyor" />
          ) : (
            <>
              <Plus size={17} />
              Davet bağlantısı oluştur
            </>
          )}
        </Button>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
