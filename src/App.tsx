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
  BellOff,
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
  X,
  Pin,
  Lock,
  Plug,
  WifiOff,
} from "lucide-react";
import type {
  Attachment,
  Bootstrap,
  AccountBootstrap,
  SessionBootstrap,
  Channel,
  Message,
  PublicConfig,
  User,
} from "../shared/types";
import { api, bootstrap, post, ApiError, setApiWorkspace } from "./lib/api";
import { WorkspaceNavigation } from "./components/WorkspaceNavigation";
import { useSidebarPreferences } from "./lib/useSidebarPreferences";
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
  fileSize,
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
import ChannelAccessDialog from "./components/ChannelAccessDialog";
import { ActivityCenter } from "./components/ActivityCenter";
import { DirectMessagesCenter } from "./components/DirectMessagesCenter";
import IntegrationsDialog from "./components/IntegrationsDialog";
import { NotificationSettings } from "./components/NotificationSettings";
import type { NotificationState } from "../shared/collaboration-types";
import { SettingsDialog } from "./components/SettingsDialog";
import { ProfileIdentity } from "./components/ProfileIdentity";
import ProfilePage from "./components/ProfilePage";
import "./components/profile-navigation.css";
import AdminPanel from "./components/AdminPanel";
import {
  WorkspaceSwitcher,
  workspaceInitials,
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
  [...new Map(list.map((m) => [m.id, m])).values()].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );

export default function App() {
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
  const [pins, setPins] = useState<Message[]>([]);
  const [channelFiles, setChannelFiles] = useState<Attachment[]>([]);
  const [collectionLoading, setCollectionLoading] = useState(false);
  const [repliesHasMore, setRepliesHasMore] = useState(false);
  const [collectionVersion, setCollectionVersion] = useState(0);
  const [savedOwner, setSavedOwner] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [channelToMove, setChannelToMove] = useState<string | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("list");
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceTarget, setWorkspaceTarget] = useState<string>();
  const [workspaceInvite, setWorkspaceInvite] = useState("");
  const [voicePreviewId, setVoicePreviewId] = useState<string | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [view, setView] = useState<View>("channel");
  const [profileId, setProfileId] = useState<string | null>(null);
  const profileReturn = useRef<{
    view: Exclude<View, "profile">;
    scrollTop: number;
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
  const [saved, setSaved] = useState<Message[]>([]);
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
  const acceptData = useCallback(
    (next: SessionBootstrap, preserveProfileRoute = false) => {
      if (next.accountOnly) {
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
        setPins([]);
        setChannelFiles([]);
        setReplies([]);
        setThread(null);
        threadRef.current = null;
        setLinkedReply(null);
        setTyping({});
        setUnread({});
        setNotificationState(null);
        setSaved([]);
        setSavedOwner("");
        setShowCall(false);
        setCallSetupChannel(null);
        setCallSwitchTarget(null);
        setChannelAccess(null);
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
        clearProfileAddress();
        setLoading(false);
        return;
      }
      accountRef.current = null;
      setAccountData(null);
      const contextChanged =
        dataRef.current?.workspace.id !== next.workspace.id ||
        dataRef.current?.user.id !== next.user.id;
      const changed =
        dataRef.current?.workspace.id !== next.workspace.id ||
        dataRef.current?.user.id !== next.user.id ||
        Boolean(dataRef.current?.user.suspended) !==
          Boolean(next.user.suspended) ||
        Boolean(dataRef.current?.workspace.suspended) !==
          Boolean(next.workspace.suspended);
      if (contextChanged && dataRef.current && !preserveProfileRoute)
        clearProfileAddress();
      setApiWorkspace(next.workspace.id);
      initialBootstrap = Promise.resolve(next);
      if (changed) {
        accessVersion.current += 1;
        callRef.current.leave();
        socketRef.current?.removeAllListeners();
        socketRef.current?.disconnect();
        socketRef.current = null;
        setSocket(null);
        setConnected(false);
        setMessages([]);
        setPins([]);
        setChannelFiles([]);
        setReplies([]);
        setThread(null);
        setLinkedReply(null);
        threadRef.current = null;
        setTyping({});
        setUnread({});
        setNotificationState(null);
        setNotificationError("");
        setSaved([]);
        setSavedOwner("");
        setHasMore(false);
        setRepliesHasMore(false);
        setShowCall(false);
        setCallSetupChannel(null);
        setCallSwitchTarget(null);
        setChannelAccess(null);
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
        setSaved((old) => old.filter((m) => accessible.has(m.channelId)));
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
        }
        if (channelRef.current !== selected) {
          setMessages([]);
          setReplies([]);
          setThread(null);
          setLinkedReply(null);
          setPins([]);
          setChannelFiles([]);
          setHasMore(false);
          threadRef.current = null;
        }
      }
      channelRef.current = selected;
      dataRef.current = next;
      setData(next);
      setBootstrapRevision((revision) => revision + 1);
      setChannelId(selected);
      const invite = new URLSearchParams(location.search).get("invite");
      if (invite && !next.workspace.isDemo) {
        setWorkspaceInvite(invite);
        setWorkspaceMode("join");
        setWorkspaceTarget(undefined);
        setDialog("workspaces");
        history.replaceState(null, "", location.pathname + location.hash);
      }
      setLoading(false);
    },
    [],
  );
  const refreshAccess = useCallback(async () => {
    const version = ++accessVersion.current;
    try {
      const next = await api<SessionBootstrap>("/auth/me");
      if (version === accessVersion.current && !workspaceChanging.current)
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
  }, [acceptData]);
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
    if (!data) return;
    try {
      const stored: unknown = JSON.parse(
        localStorage.getItem(
          `mola:saved:${data.user.id}:${data.workspace.id}`,
        ) ||
          localStorage.getItem(`mola:saved:${data.user.id}`) ||
          "[]",
      );
      setSaved(
        Array.isArray(stored)
          ? stored
              .filter(
                (m): m is Message =>
                  m &&
                  typeof m.id === "string" &&
                  typeof m.channelId === "string" &&
                  data.channels.some((c) => c.id === m.channelId) &&
                  typeof m.userId === "string" &&
                  typeof m.createdAt === "string" &&
                  typeof m.content === "string" &&
                  Array.isArray(m.attachments) &&
                  Array.isArray(m.reactions),
              )
              .slice(-200)
          : [],
      );
    } catch {
      setSaved([]);
    }
    setSavedOwner(`${data.user.id}:${data.workspace.id}`);
  }, [data?.user.id, data?.workspace.id]);
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
      if (requestedChannel)
        api<{ messages: Message[]; hasMore: boolean }>(
          `/channels/${requestedChannel}/messages`,
        )
          .then((result) => {
            if (disposed || requestedChannel !== channelRef.current) return;
            setMessages(result.messages);
            setHasMore(result.hasMore);
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
      if (message.channelId === channelRef.current) {
        if (message.parentId) {
          setMessages((old) =>
            old.map((m) =>
              m.id === message.parentId
                ? { ...m, replyCount: m.replyCount + 1 }
                : m,
            ),
          );
          if (threadRef.current?.id === message.parentId) {
            received(message.id);
            setReplies((old) => uniqueMessages([...old, message]));
          }
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
      } else if (message.userId !== data.user.id) {
        if (!quietRef.current) notify("Diğer bir sohbette yeni bir mesaj var.");
      }
    });
    client.on("message:updated", (message: Message) => {
      setMessages((old) => old.map((m) => (m.id === message.id ? message : m)));
      setReplies((old) => old.map((m) => (m.id === message.id ? message : m)));
      setThread((old) => (old?.id === message.id ? message : old));
      setLinkedReply((old) => (old?.id === message.id ? message : old));
      setSaved((old) => old.map((m) => (m.id === message.id ? message : m)));
      setCollectionVersion((v) => v + 1);
    });
    client.on("message:deleted", ({ id }: { id: string }) => {
      forget(id);
      setMessages((old) => old.filter((m) => m.id !== id));
      setReplies((old) => old.filter((m) => m.id !== id));
      setSaved((old) => old.filter((m) => m.id !== id));
      setThread((old) => (old?.id === id ? null : old));
      setLinkedReply((old) => (old?.id === id ? null : old));
      setCollectionVersion((v) => v + 1);
    });
    client.on("member:updated", (user: User) =>
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
      ),
    );
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
    setMessagesLoading(true);
    setMessages([]);
    setTyping({});
    setHasMore(false);
    api<{ messages: Message[]; hasMore: boolean }>(
      `/channels/${channelId}/messages`,
    )
      .then((result) => {
        if (
          !cancelled &&
          channelRef.current === channelId &&
          dataRef.current?.channels.some((c) => c.id === channelId)
        ) {
          setMessages(result.messages);
          setHasMore(result.hasMore);
          void document.fonts.ready.then(() =>
            requestAnimationFrame(() => {
              if (cancelled) return;
              if (highlightRef.current) {
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
        if (!cancelled) fail(error.message);
      })
      .finally(() => {
        if (!cancelled) setMessagesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [channelId, data?.workspace.id, fail]);
  useEffect(() => {
    if (!thread) return;
    let cancelled = false;
    setThreadLoading(true);
    setReplies([]);
    api<{ messages: Message[]; hasMore: boolean }>(
      `/channels/${thread.channelId}/messages?parentId=${encodeURIComponent(thread.id)}`,
    )
      .then((result) => {
        if (
          !cancelled &&
          threadRef.current?.id === thread.id &&
          dataRef.current?.channels.some((c) => c.id === thread.channelId)
        ) {
          setReplies(result.messages);
          setRepliesHasMore(result.hasMore);
        }
      })
      .catch((error) => fail(error.message))
      .finally(() => {
        if (!cancelled) setThreadLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [thread?.id, fail]);
  useEffect(() => {
    if (data && savedOwner === `${data.user.id}:${data.workspace.id}`) {
      try {
        localStorage.setItem(
          `mola:saved:${data.user.id}:${data.workspace.id}`,
          JSON.stringify(saved),
        );
      } catch {
        fail(
          "Tarayıcı depolaması dolu. Kaydedilenlerden birkaç mesaj kaldırabilirsin.",
        );
      }
    }
  }, [saved, data?.user.id, data?.workspace.id, savedOwner, fail]);
  useEffect(() => {
    if (!channelId || tab === "chat" || view !== "channel") {
      setCollectionLoading(false);
      return;
    }
    let cancelled = false;
    setCollectionLoading(true);
    setPins([]);
    setChannelFiles([]);
    const path = `/channels/${channelId}/${tab}`;
    api<{ messages?: Message[]; files?: Attachment[] }>(path)
      .then((result) => {
        if (
          cancelled ||
          channelRef.current !== channelId ||
          !dataRef.current?.channels.some((c) => c.id === channelId)
        )
          return;
        if (tab === "pins") setPins(result.messages || []);
        else setChannelFiles(result.files || []);
      })
      .catch((error) => {
        if (!cancelled) fail(error.message);
      })
      .finally(() => {
        if (!cancelled) setCollectionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [channelId, tab, view, collectionVersion, fail]);

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
    if (!data || verificationPending) return;
    let cancelled = false;
    const open = async () => {
      const params = new URLSearchParams(location.search),
        id = params.get("message"),
        workspace = params.get("workspace");
      if (!id || !workspace || params.has("profile")) return;
      const clean = () => {
        params.delete("message");
        params.delete("workspace");
        history.replaceState(
          null,
          "",
          location.pathname + (params.size ? "?" + params : "") + location.hash,
        );
      };
      if (!data.workspaces.some((w) => w.id === workspace)) {
        clean();
        fail("Bu mesajın çalışma alanına erişimin yok.");
        return;
      }
      if (workspace !== data.workspace.id) {
        if (callRef.current.joined || callRef.current.joining) {
          openWorkspaces("list", workspace);
          return;
        }
        try {
          await changeWorkspace({ kind: "switch", id: workspace });
        } catch (e) {
          clean();
          fail((e as Error).message);
        }
        return;
      }
      try {
        const message = await api<Message>(
          `/messages/${encodeURIComponent(id)}`,
        );
        if (cancelled) return;
        clean();
        await navigateMessage(message);
      } catch (e) {
        if (!cancelled) {
          clean();
          fail((e as Error).message);
        }
      }
    };
    void open();
    window.addEventListener("popstate", open);
    window.addEventListener("focus", open);
    return () => {
      cancelled = true;
      window.removeEventListener("popstate", open);
      window.removeEventListener("focus", open);
    };
  }, [data?.workspace.id, data?.user.id, verificationPending]);

  useEffect(() => {
    if (!data || verificationPending) return;
    let cancelled = false;
    const followProfile = async () => {
      const params = new URLSearchParams(location.search);
      const id = params.get("profile");
      if (!id) {
        if (viewRef.current === "profile") restoreProfileReturn();
        return;
      }
      const workspaceId = params.get("workspace") || data.workspace.id;
      if (
        !data.workspaces.some(
          (workspace) =>
            workspace.id === workspaceId &&
            !workspace.membershipSuspended &&
            !workspace.suspended,
        )
      ) {
        clearProfileAddress();
        restoreProfileReturn();
        fail("Bu profilin çalışma alanına erişimin yok.");
        return;
      }
      if (workspaceId !== data.workspace.id) {
        if (callRef.current.joined || callRef.current.joining) {
          openWorkspaces("list", workspaceId);
          return;
        }
        try {
          await changeWorkspace({ kind: "switch", id: workspaceId }, true);
        } catch (error) {
          if (!cancelled) {
            clearProfileAddress();
            fail((error as Error).message);
          }
        }
        return;
      }
      if (!cancelled) showProfile(id);
    };
    void followProfile();
    window.addEventListener("popstate", followProfile);
    return () => {
      cancelled = true;
      window.removeEventListener("popstate", followProfile);
    };
  }, [data?.user.id, data?.workspace.id, verificationPending]);

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
  const channelName =
    channel?.kind === "dm"
      ? data?.members.find(
          (u) => channel.memberIds?.includes(u.id) && u.id !== data.user.id,
        )?.name || channel.name
      : channel?.name || "genel";
  const conversationMembers =
    channel?.kind === "dm" || channel?.visibility === "private"
      ? data?.members.filter(
          (m) => !m.suspended && channel.memberIds?.includes(m.id),
        ) || []
      : data?.members.filter(
          (m) =>
            !m.suspended &&
            (m.role !== "guest" || channel?.memberIds?.includes(m.id)),
        ) || [];
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
    setWorkspaceTarget(target);
    setWorkspaceInvite("");
    setDialog("workspaces");
    setMobileNav(false);
  }
  async function changeWorkspace(
    action: WorkspaceAction,
    preserveProfileRoute = false,
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
      if (!preserveProfileRoute) clearProfileAddress();
      acceptData(next, preserveProfileRoute);
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
  function selectChannel(id: string) {
    clearProfileAddress("push");
    setProfileId(null);
    channelRef.current = id;
    setChannelId(id);
    setView("channel");
    setTab("chat");
    setThread(null);
    setMobileNav(false);
    setUnread((old) => ({ ...old, [id]: 0 }));
  }
  function clearProfileAddress(mode: "push" | "replace" = "replace") {
    const url = new URL(location.href);
    if (!url.searchParams.has("profile")) return;
    url.searchParams.delete("profile");
    if (!url.searchParams.has("message")) url.searchParams.delete("workspace");
    if (mode === "push") history.pushState(null, "", url);
    else history.replaceState(null, "", url);
  }
  function showProfile(id: string) {
    if (viewRef.current !== "profile")
      profileReturn.current = {
        view: viewRef.current,
        scrollTop: scrollRef.current?.scrollTop || 0,
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
    const url = new URL(location.pathname, location.origin);
    url.searchParams.set("workspace", data.workspace.id);
    url.searchParams.set("profile", id);
    if (viewRef.current === "profile")
      history.replaceState(history.state, "", url);
    else history.pushState({ molaProfile: true }, "", url);
    showProfile(id);
  }
  function restoreProfileReturn() {
    const previous = profileReturn.current;
    setProfileId(null);
    setView(previous?.view || "channel");
    requestAnimationFrame(() => {
      if (scrollRef.current && previous)
        scrollRef.current.scrollTop = previous.scrollTop;
      document.getElementById("main-content")?.focus({ preventScroll: true });
    });
  }
  function closeProfile() {
    if (history.state?.molaProfile) history.back();
    else {
      clearProfileAddress();
      restoreProfileReturn();
    }
  }
  function selectView(next: Exclude<View, "profile">) {
    clearProfileAddress("push");
    setProfileId(null);
    setView(next);
    setThread(null);
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
      dataRef.current?.workspace.id !== data.workspace.id ||
      message.channelId !== channelRef.current
    )
      return;
    received(message.id);
    if (message.parentId) {
      if (threadRef.current?.id === message.parentId)
        setReplies((old) => uniqueMessages([...old, message]));
    } else {
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
  function saveMessage(message: Message) {
    setSaved((old) =>
      old.some((m) => m.id === message.id)
        ? old.filter((m) => m.id !== message.id)
        : [...old, message],
    );
  }
  async function deleteMessage(message: Message) {
    try {
      await api(`/messages/${message.id}`, { method: "DELETE" });
      forget(message.id);
      setMessages((old) => old.filter((m) => m.id !== message.id));
      setReplies((old) => old.filter((m) => m.id !== message.id));
      notify("Mesaj silindi.");
    } catch (e) {
      fail((e as Error).message);
    }
  }
  function renderMessage(message: Message, compact = false) {
    return (
      <MessageItem
        key={message.id}
        message={message}
        fresh={freshIds.has(message.id)}
        author={userMap.get(message.userId)}
        selfId={data!.user.id}
        onOpenProfile={openProfile}
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
        saved={saved.some((m) => m.id === message.id)}
        onSave={() => saveMessage(message)}
        onReply={() => {
          setLinkedReply(null);
          setThread(message);
        }}
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
      setSaved([]);
      setUnread({});
    } catch (e) {
      if (accountRef.current) throw e;
      fail((e as Error).message);
    }
  }
  async function loadMore() {
    if (!messages.length) return;
    const requestedChannel = channelId;
    const currentHeight = scrollRef.current?.scrollHeight || 0;
    try {
      const result = await api<{ messages: Message[]; hasMore: boolean }>(
        `/channels/${channelId}/messages?before=${encodeURIComponent(messages[0].id)}`,
      );
      if (requestedChannel !== channelRef.current) return;
      setMessages((old) => uniqueMessages([...result.messages, ...old]));
      setHasMore(result.hasMore);
      requestAnimationFrame(() => {
        if (scrollRef.current)
          scrollRef.current.scrollTop =
            scrollRef.current.scrollHeight - currentHeight;
      });
    } catch (e) {
      fail((e as Error).message);
    }
  }
  async function navigateMessage(message: Message) {
    if (!dataRef.current?.channels.some((c) => c.id === message.channelId)) {
      fail("Bu mesaja artık erişemiyorsun.");
      return;
    }
    selectChannel(message.channelId);
    setDialog(null);
    try {
      const result = await api<{ messages: Message[] }>(
        `/channels/${message.channelId}/messages`,
      );
      if (channelRef.current !== message.channelId) return;
      if (
        message.parentId ||
        !result.messages.some((m) => m.id === message.id)
      ) {
        const root = message.parentId
          ? await api<Message>(`/messages/${message.parentId}`)
          : await api<Message>(`/messages/${message.id}`);
        if (channelRef.current === message.channelId) {
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
      fail((error as Error).message);
    }
  }
  async function loadMoreReplies() {
    if (!thread || !replies.length) return;
    const currentThread = thread.id;
    try {
      const result = await api<{ messages: Message[]; hasMore: boolean }>(
        `/channels/${thread.channelId}/messages?parentId=${thread.id}&before=${replies[0].id}`,
      );
      if (threadRef.current?.id !== currentThread) return;
      setReplies((old) => uniqueMessages([...result.messages, ...old]));
      setRepliesHasMore(result.hasMore);
    } catch (error) {
      fail((error as Error).message);
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
        <button className="primary-button" onClick={() => location.reload()}>
          Tekrar dene
        </button>
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
          setSaved([]);
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
        <button
          className="rail-brand"
          aria-label="Mola hakkında"
          onClick={() => setDialog("help")}
        >
          <Logo small />
        </button>
        <div className="rail-divider" />
        <div className="rail-workspaces">
          {data.workspaces.map((workspace) => (
            <button
              key={workspace.id}
              className={`workspace-button ${workspace.id === data.workspace.id ? "active" : ""}`}
              title={workspace.name}
              aria-label={`${workspace.name} alanına geç`}
              aria-current={
                workspace.id === data.workspace.id ? "true" : undefined
              }
              disabled={
                workspaceBusy ||
                Boolean(workspace.membershipSuspended || workspace.suspended)
              }
              onClick={() => {
                if (workspace.id === data.workspace.id)
                  selectChannel(
                    data.channels.find((c) => c.kind === "text" && !c.archived)
                      ?.id || channelId,
                  );
                else if (call.joined || call.joining)
                  openWorkspaces("list", workspace.id);
                else
                  void changeWorkspace({
                    kind: "switch",
                    id: workspace.id,
                  }).catch((error) => fail(error.message));
              }}
            >
              <span>{workspaceInitials(workspace.name)}</span>
            </button>
          ))}
        </div>
        <button
          className="rail-add"
          title="Çalışma alanı ekle"
          aria-label="Çalışma alanı ekle"
          onClick={() => openWorkspaces()}
        >
          <Plus size={22} />
        </button>
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
        <button
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
          savedCount={saved.length}
          activityCount={
            notificationState?.workspaceId === data.workspace.id
              ? notificationState.unreadNotifications
              : 0
          }
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
        <header className="topbar">
          <div className="topbar-breadcrumb">
            <button
              ref={triggerRef}
              type="button"
              aria-label="Gezinmeyi aç"
              aria-expanded={isMobile && mobileNav}
              aria-controls="workspace-navigation"
              onClick={() => setMobileNav(true)}
              className="icon-button mobile-menu"
            >
              <Menu size={21} />
            </button>
            <span className="workspace-breadcrumb">Çalışma alanı</span>
            <ChevronRight size={14} />
            <span>
              {view === "saved"
                ? "Kaydedilenler"
                : view === "inbox"
                  ? "Aktivite"
                  : view === "messages"
                    ? "Özel mesajlar"
                    : view === "profile"
                      ? "Profil"
                      : channel?.kind === "dm"
                        ? "Direkt mesajlar"
                        : "Kanallar"}
            </span>
          </div>
          <button
            className="global-search"
            aria-label="Tüm mesajlarda ara"
            onClick={() => setDialog("search")}
          >
            <Search size={16} />
            <span>{data.workspace.name} içinde ara</span>
            <kbd>
              {/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl"} K
            </kbd>
          </button>
          <div className="topbar-actions">
            <IconButton
              label={quiet ? "Bildirimleri aç" : "Bildirimleri sessize al"}
              onClick={() => {
                localStorage.setItem("mola:quiet", String(!quiet));
                setQuiet(!quiet);
                notify(
                  quiet ? "Bildirimler açıldı." : "Bildirimler sessize alındı.",
                );
              }}
            >
              {quiet ? <BellOff size={18} /> : <Bell size={18} />}
            </IconButton>
            <span className="topbar-divider" />
            <ProfileIdentity
              className="topbar-avatar"
              user={data.user}
              online={connected}
              connected={connected}
              selfId={data.user.id}
              onOpen={openProfile}
            >
              <Avatar user={data.user} size="small" online={connected} />
            </ProfileIdentity>
            <IconButton
              label="Profil ayarları"
              className="profile-settings-trigger"
              onClick={() => setDialog("settings")}
            >
              <Settings2 size={18} />
            </IconButton>
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
              <button
                className="primary-button"
                onClick={() => openWorkspaces()}
              >
                Çalışma alanlarımı aç <ArrowRight size={17} />
              </button>
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
              <section className="conversation-panel" aria-label="Sohbet">
                <div className="channel-heading">
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
                    <h1>
                      {view === "saved"
                        ? "Kaydedilenler"
                        : view === "inbox"
                          ? "Aktivite"
                          : view === "messages"
                            ? "Özel mesajlar"
                            : channelName}
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
                  {view === "channel" && (
                    <div className="channel-heading-actions">
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
                        <button
                          className="member-stack-count"
                          aria-label="Kanal üyelerini gör"
                          onClick={() => openMembers("channel")}
                        >
                          {conversationMembers.length} üye
                        </button>
                      </div>
                      <button
                        className="huddle-button"
                        aria-label="Bir araya gel"
                        onClick={() => startCall()}
                        disabled={channel?.archived || !channel}
                      >
                        <Headphones size={17} />
                        <span>Bir araya gel</span>
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        title="Kanal bilgisi"
                        aria-label="Kanal bilgisi"
                        aria-haspopup="dialog"
                        disabled={!channel}
                        onClick={() => setDialog("info")}
                      >
                        <Info size={20} />
                      </button>
                      {channel && channel.kind !== "dm" && (
                        <button
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
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {view === "channel" && (
                  <div className="channel-tabs-row">
                    <div
                      className="channel-tabs"
                      role="tablist"
                      aria-label="Kanal içeriği"
                      onKeyDown={(event) => {
                        const tabs = ["chat", "files", "pins"] as const;
                        const index = tabs.indexOf(tab);
                        const next =
                          event.key === "ArrowRight"
                            ? (index + 1) % tabs.length
                            : event.key === "ArrowLeft"
                              ? (index + tabs.length - 1) % tabs.length
                              : event.key === "Home"
                                ? 0
                                : event.key === "End"
                                  ? tabs.length - 1
                                  : -1;
                        if (next < 0) return;
                        event.preventDefault();
                        setTab(tabs[next]);
                        event.currentTarget
                          .querySelectorAll<HTMLButtonElement>('[role="tab"]')
                          [next]?.focus();
                      }}
                    >
                      <button
                        role="tab"
                        id="channel-tab-chat"
                        aria-controls="channel-content"
                        tabIndex={tab === "chat" ? 0 : -1}
                        aria-selected={tab === "chat"}
                        className={tab === "chat" ? "active" : ""}
                        onClick={() => setTab("chat")}
                      >
                        <MessageSquare size={16} />
                        Sohbet
                      </button>
                      <button
                        role="tab"
                        id="channel-tab-files"
                        aria-controls="channel-content"
                        tabIndex={tab === "files" ? 0 : -1}
                        aria-selected={tab === "files"}
                        className={tab === "files" ? "active" : ""}
                        onClick={() => setTab("files")}
                      >
                        <FileText size={16} />
                        Dosyalar
                      </button>
                      <button
                        role="tab"
                        id="channel-tab-pins"
                        aria-controls="channel-content"
                        tabIndex={tab === "pins" ? 0 : -1}
                        aria-selected={tab === "pins"}
                        className={tab === "pins" ? "active" : ""}
                        onClick={() => setTab("pins")}
                      >
                        <Pin size={15} />
                        Sabitlenenler
                      </button>
                    </div>
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
                    <>
                      {saved.length ? (
                        <>
                          <div className="list-intro">
                            <Bookmark size={20} />
                            <h2>İyi ki kaydetmişim.</h2>
                            <p>{saved.length} mesaj seni burada bekliyor.</p>
                          </div>
                          {saved.map((message) => (
                            <div key={message.id}>
                              <button
                                className="saved-channel-label"
                                onClick={() => {
                                  selectChannel(message.channelId);
                                }}
                              >
                                <Hash size={13} />
                                {data.channels.find(
                                  (c) => c.id === message.channelId,
                                )?.name || "Kanal"}
                                <ArrowRight size={13} />
                              </button>
                              {renderMessage(message)}
                            </div>
                          ))}
                        </>
                      ) : (
                        <EmptyState
                          icon={<Bookmark size={29} />}
                          title="Aklında kalmasın, burada kalsın."
                          text="Bir mesajın üzerindeki yer imi simgesine tıkla. Kaydettiklerini burada bulacaksın."
                        />
                      )}
                    </>
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
                  ) : messagesLoading || collectionLoading ? (
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
                  ) : tab === "files" ? (
                    <>
                      <div className="list-intro">
                        <FileText size={21} />
                        <h2>Paylaşılan dosyalar</h2>
                        <p>Bu kanalda paylaşılan dosyalar.</p>
                      </div>
                      {channelFiles.length ? (
                        <div className="channel-file-list">
                          {channelFiles.map((file: Attachment) => (
                            <a
                              key={file.id}
                              href={file.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              download={file.name}
                            >
                              <span className="file-icon">
                                <FileText size={23} />
                              </span>
                              <span>
                                <strong>{file.name}</strong>
                                <small>{fileSize(file.size)}</small>
                              </span>
                              <ArrowDown size={18} />
                            </a>
                          ))}
                        </div>
                      ) : (
                        <EmptyState
                          icon={<FileText size={27} />}
                          title="İlk dosyaya yer açtık."
                          text="Mesaj kutusundaki ataş simgesinden dosya paylaşabilirsin."
                          extra={
                            !channel?.archived && channel ? (
                              <button
                                className="secondary-button"
                                onClick={() =>
                                  document
                                    .querySelector<HTMLInputElement>(
                                      '.conversation-panel input[type="file"]',
                                    )
                                    ?.click()
                                }
                              >
                                <Plus size={16} /> Dosya paylaş
                              </button>
                            ) : undefined
                          }
                        />
                      )}
                    </>
                  ) : tab === "pins" ? (
                    <>
                      <div className="list-intro">
                        <Pin size={20} />
                        <h2>Sabitlenen mesajlar</h2>
                        <p>Ekibin için önemli mesajlar.</p>
                      </div>
                      {pins.length ? (
                        pins.map((m) => renderMessage(m))
                      ) : (
                        <EmptyState
                          icon={<Pin size={27} />}
                          title="Henüz sabitlenen mesaj yok."
                          text="Mesaj menüsünden “Kanala sabitle” seçeneğiyle önemli notları buraya ekle."
                          extra={
                            <button
                              className="secondary-button"
                              onClick={() => setTab("chat")}
                            >
                              <MessageSquare size={16} /> Sohbete dön
                            </button>
                          }
                        />
                      )}
                    </>
                  ) : (
                    <>
                      {hasMore ? (
                        <button
                          className="load-more"
                          onClick={() => void loadMore()}
                        >
                          Önceki mesajları yükle
                        </button>
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
                      {!messages.length && (
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
                          {renderMessage(message)}
                        </div>
                      ))}
                    </>
                  )}
                </div>
                {view === "channel" &&
                  tab === "chat" &&
                  (awayFromLatest || pendingCount > 0) &&
                  !messagesLoading && (
                    <div className="latest-message-bar">
                      <button
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
                      </button>
                    </div>
                  )}
                {view === "channel" && (
                  <>
                    <div className="typing-indicator" aria-live="polite">
                      {connected && typingNames.length > 0 && (
                        <>
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
                        key={`${data.user.id}:${channelId}`}
                        userId={data.user.id}
                        workspaceId={data.workspace.id}
                        channelId={channelId}
                        channelName={channelName}
                        members={conversationMembers.map((m) => m.name)}
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
              </section>
              {thread && threadChannel ? (
                <aside className="thread-panel">
                  <div className="details-heading">
                    <h2>Mesaj dizisi</h2>
                    <IconButton
                      label="Mesaj dizisini kapat"
                      onClick={() => setThread(null)}
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
                      <button
                        className="load-more"
                        onClick={() => void loadMoreReplies()}
                      >
                        Önceki yanıtları yükle
                      </button>
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
                      key={`${data.user.id}:${thread.id}`}
                      userId={data.user.id}
                      workspaceId={data.workspace.id}
                      channelId={thread.channelId}
                      channelName={channelName}
                      parentId={thread.id}
                      members={conversationMembers.map((m) => m.name)}
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
          workspaces={data.workspaces}
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
                params.has("profile") &&
                action.kind === "switch" &&
                action.id === params.get("workspace") &&
                action.id !== data.workspace.id,
              ),
            );
          }}
          onClose={() => setDialog(null)}
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
      {dialog === "search" && (
        <SearchDialog
          data={data}
          onClose={() => setDialog(null)}
          onSelect={(message) => void navigateMessage(message)}
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
          onClose={() => setDialog(null)}
        />
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
                <button
                  aria-label="Kanal üyelerini gör"
                  onClick={() => openMembers("channel")}
                >
                  Tümünü gör
                </button>
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
                <button
                  className="secondary-button full-width"
                  onClick={() => {
                    setDialog(null);
                    setChannelAccess(channel);
                  }}
                >
                  <ShieldCheck size={16} />
                  Kanal erişimi ve üyeler
                </button>
              )}
              {canManage && channel.kind !== "dm" && (
                <button
                  className="secondary-button full-width"
                  onClick={() => {
                    setDialog(null);
                    setChannelAccess(channel);
                  }}
                >
                  <Plus size={16} />
                  Kanala üye ekle
                </button>
              )}
              <button
                className="primary-button full-width"
                disabled={channel.archived}
                onClick={() => {
                  setDialog(null);
                  startCall();
                }}
              >
                <Headphones size={17} />
                Bir araya gel
              </button>
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
                  <button
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
                  </button>
                  {canEditChannel(c) && (
                    <IconButton
                      label={`${c.name} arşivden çıkar`}
                      onClick={() => editChannel(c, "archive")}
                    >
                      <ArchiveRestore size={18} />
                    </IconButton>
                  )}
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`${c.name} kanal işlemleri`}
                    title="Kanal işlemleri"
                    aria-haspopup="menu"
                    aria-expanded={menuChannel?.id === c.id}
                    onClick={(event) => openChannelMenu(c, event.currentTarget)}
                  >
                    <MoreHorizontal size={18} />
                  </button>
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
            <input
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
                <button
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
                </button>
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
          <button
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
          </button>
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
            <button
              className="secondary-button"
              onClick={() => setCallSwitchTarget(null)}
            >
              Burada kal
            </button>
            <button
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
            </button>
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
              <button
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
              </button>
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
          <button
            type="button"
            className={kind === "text" ? "active" : ""}
            aria-pressed={kind === "text"}
            onClick={() => setKind("text")}
          >
            <Hash size={22} />
            <strong>Yazılı kanal</strong>
            <small>Fikirleri ve dosyaları paylaş</small>
          </button>
          <button
            type="button"
            className={kind === "voice" ? "active" : ""}
            aria-pressed={kind === "voice"}
            onClick={() => setKind("voice")}
          >
            <Volume2 size={22} />
            <strong>Sesli oda</strong>
            <small>Birlikte konuş, ekranını paylaş</small>
          </button>
        </div>
        <label>
          Kanal adı
          <input
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
          <textarea
            name="description"
            placeholder="Burada neler konuşacağız?"
            maxLength={240}
            rows={3}
          />
        </label>
        <label>
          Görünürlük
          <select name="visibility" defaultValue="public">
            <option value="public">Ekip kanalı — çalışma alanı üyeleri</option>
            <option value="private">
              Özel kanal — yalnızca eklenen kişiler
            </option>
          </select>
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
          <button type="button" className="secondary-button" onClick={onClose}>
            Vazgeç
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? (
              <Spinner label="Oluşturuluyor" />
            ) : (
              <>
                <Plus size={17} />
                Kanal oluştur
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function SearchDialog({
  data,
  onClose,
  onSelect,
}: {
  data: Bootstrap;
  onClose: () => void;
  onSelect: (message: Message) => void;
}) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState({
    channelId: "",
    userId: "",
    from: "",
    until: "",
    hasFiles: false,
  });
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const accessKey = data.channels
    .map((c) => c.id)
    .sort()
    .join(",");
  const canSearch =
    query.trim().length >= 2 ||
    Boolean(
      filters.channelId ||
      filters.userId ||
      filters.from ||
      filters.until ||
      filters.hasFiles,
    );
  const [results, setResults] = useState<Message[]>([]);
  const visibleResults = results.filter((m) =>
    data.channels.some((c) => c.id === m.channelId),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!canSearch) {
      setResults([]);
      setLoading(false);
      setError("");
      setHasMore(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        q: query.trim(),
        offset: String(offset),
      });
      for (const [key, value] of Object.entries(filters))
        if (value) params.set(key, String(value));
      api<{ messages: Message[]; hasMore: boolean }>(`/search?${params}`)
        .then((r) => {
          if (!cancelled) {
            setResults(r.messages);
            setHasMore(r.hasMore);
            setError("");
          }
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, filters, offset, canSearch, accessKey]);
  return (
    <Modal title="Çalışma alanında ara" onClose={onClose} wide>
      <div className="search-input-wrap">
        <Search size={21} />
        <input
          aria-label="Mesajlarda ara"
          data-autofocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOffset(0);
          }}
          placeholder="Bir mesaj, bir fikir, bir kelime..."
          autoFocus
          maxLength={100}
        />
        <kbd>Esc</kbd>
      </div>
      <div className="search-filters">
        <label>
          Kanal
          <select
            aria-label="Kanal"
            value={filters.channelId}
            onChange={(e) => {
              setFilters({ ...filters, channelId: e.target.value });
              setOffset(0);
            }}
          >
            <option value="">Tüm kanallar</option>
            {data.channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.visibility === "private" ? "🔒 " : ""}
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Gönderen
          <select
            aria-label="Gönderen"
            value={filters.userId}
            onChange={(e) => {
              setFilters({ ...filters, userId: e.target.value });
              setOffset(0);
            }}
          >
            <option value="">Herkes</option>
            {data.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Başlangıç tarihi (UTC)
          <input
            type="date"
            value={filters.from}
            onChange={(e) => {
              setFilters({ ...filters, from: e.target.value });
              setOffset(0);
            }}
          />
        </label>
        <label>
          Bitiş tarihi (UTC)
          <input
            type="date"
            value={filters.until}
            min={filters.from}
            onChange={(e) => {
              setFilters({ ...filters, until: e.target.value });
              setOffset(0);
            }}
          />
        </label>
        <label className="search-files">
          <input
            type="checkbox"
            checked={filters.hasFiles}
            onChange={(e) => {
              setFilters({ ...filters, hasFiles: e.target.checked });
              setOffset(0);
            }}
          />
          Yalnızca dosya içerenler
        </label>
        <button
          className="text-button"
          onClick={() => {
            setFilters({
              channelId: "",
              userId: "",
              from: "",
              until: "",
              hasFiles: false,
            });
            setOffset(0);
          }}
        >
          Filtreleri temizle
        </button>
      </div>
      <div className="search-results">
        {error ? (
          <p role="alert" className="form-error">
            {error}
          </p>
        ) : loading ? (
          <Spinner label="Mesajlar aranıyor" />
        ) : !canSearch ? (
          <div className="search-empty">
            <Search size={29} />
            <p>Aramak için en az 2 karakter yaz veya filtre seç.</p>
            <small>Erişebildiğin kanallarda ve özel mesajlarında arar.</small>
          </div>
        ) : !visibleResults.length ? (
          <div className="search-empty">
            <MessageCircle size={29} />
            <p>“{query}” için bir mesaj bulamadık.</p>
            <small>Başka bir kelimeyle tekrar deneyebilirsin.</small>
          </div>
        ) : (
          <>
            <div className="search-count">
              {offset + 1}–{offset + visibleResults.length}. sonuçlar
            </div>
            {visibleResults.map((message) => (
              <button
                key={message.id}
                className="search-result"
                onClick={() => onSelect(message)}
              >
                <span className="search-result-channel">
                  <Hash size={13} />
                  {data.channels.find((c) => c.id === message.channelId)?.name}
                  <time>{dateLabel(message.createdAt)}</time>
                </span>
                <strong>
                  {data.members.find((m) => m.id === message.userId)?.name}
                </strong>
                <p>{message.content}</p>
              </button>
            ))}
          </>
        )}
      </div>
      {(offset > 0 || hasMore) && (
        <div className="modal-actions">
          <button
            className="secondary-button"
            disabled={!offset || loading}
            onClick={() => setOffset(Math.max(0, offset - 50))}
          >
            Önceki sayfa
          </button>
          <button
            className="secondary-button"
            disabled={!hasMore || loading}
            onClick={() => setOffset(offset + 50)}
          >
            Sonraki sayfa
          </button>
        </div>
      )}
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
              <input
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
        <button
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
        </button>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
