import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { io, type Socket } from "socket.io-client";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
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
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
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
  Channel,
  Message,
  PublicConfig,
  User,
} from "../shared/types";
import { api, bootstrap, post, ApiError, setApiWorkspace } from "./lib/api";
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
import { useCall } from "./lib/useCall";
import { CallPanel } from "./components/CallPanel";
import { CallSetup } from "./components/CallSetup";
import ChannelAccessDialog from "./components/ChannelAccessDialog";
import { NotificationsInbox } from "./components/NotificationsInbox";
import IntegrationsDialog from "./components/IntegrationsDialog";
import { NotificationSettings } from "./components/NotificationSettings";
import type { NotificationState } from "../shared/collaboration-types";
import { SettingsDialog } from "./components/SettingsDialog";
import AdminPanel from "./components/AdminPanel";
import {
  WorkspaceSwitcher,
  workspaceInitials,
  type WorkspaceAction,
  type WorkspaceMode,
} from "./components/WorkspaceSwitcher";
import {
  VoiceParticipants,
  VoiceRoomPreview,
} from "./components/VoiceParticipants";

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
  | null;
type View = "channel" | "saved" | "inbox";
let initialBootstrap: Promise<Bootstrap | null> | undefined;
const uniqueMessages = (list: Message[]) =>
  [...new Map(list.map((m) => [m.id, m])).values()].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );

export default function App() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState("");
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [emailDeliveryAvailable, setEmailDeliveryAvailable] = useState(true);
  const [registrationAvailable, setRegistrationAvailable] = useState(true);
  const [mailbox, setMailbox] = useState<string>();
  const [authLink, setAuthLink] = useState(readAuthLink);
  const verificationPending = Boolean(
    data?.emailVerificationRequired && !data.user.emailVerified,
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
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("list");
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceTarget, setWorkspaceTarget] = useState<string>();
  const [workspaceInvite, setWorkspaceInvite] = useState("");
  const [voicePreviewId, setVoicePreviewId] = useState<string | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [view, setView] = useState<View>("channel");
  const [tab, setTab] = useState<"chat" | "files" | "pins">("chat");
  const [details, setDetails] = useState(true);
  const [mobileNav, setMobileNav] = useState(false);
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
  const [channelAccess, setChannelAccess] = useState<Channel | null>(null);
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
  quietRef.current = quiet;
  viewRef.current = view;
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
  const acceptData = useCallback((next: Bootstrap) => {
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
      setChannelAccess(null);
      setVoicePreviewId(null);
      setView("channel");
      setTab("chat");
      setDialog(null);
      setMobileNav(false);
      if (contextChanged)
        setAdminOpen(Boolean(next.workspace.suspended && next.user.siteAdmin));
      else if (next.workspace.suspended && next.user.siteAdmin)
        setAdminOpen(true);
      else if (next.user.suspended && !next.user.siteAdmin) setAdminOpen(false);
      highlightRef.current = null;
    } else if (
      !["owner", "admin"].includes(next.user.role) &&
      !next.user.siteAdmin
    )
      setAdminOpen(false);
    const selected =
      !changed &&
      next.channels.some((c) => c.id === channelRef.current && !c.archived)
        ? channelRef.current
        : next.channels.find((c) => c.name === "tasarım" && !c.archived)?.id ||
          next.channels.find((c) => c.kind === "text" && !c.archived)?.id ||
          "";
    if (!changed) {
      const allowed = new Set(
        next.channels.filter((c) => !c.archived).map((c) => c.id),
      );
      setSaved((old) => old.filter((m) => allowed.has(m.channelId)));
      setCallSetupChannel((old) => (old && allowed.has(old.id) ? old : null));
      setChannelAccess((old) => (old && allowed.has(old.id) ? old : null));
      if (channelRef.current !== selected) {
        setMessages([]);
        setReplies([]);
        setThread(null);
        setPins([]);
        setChannelFiles([]);
        setHasMore(false);
        threadRef.current = null;
      }
    }
    channelRef.current = selected;
    dataRef.current = next;
    setData(next);
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
  }, []);
  const refreshAccess = useCallback(async () => {
    const version = ++accessVersion.current;
    try {
      const next = await api<Bootstrap>("/auth/me");
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
    function key(e: KeyboardEvent) {
      if (adminOpen) return;
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
  }, [adminOpen]);
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
          if (threadRef.current?.id === message.parentId)
            setReplies((old) => uniqueMessages([...old, message]));
        } else {
          const nearBottom = scrollRef.current
            ? scrollRef.current.scrollHeight -
                scrollRef.current.scrollTop -
                scrollRef.current.clientHeight <
              160
            : true;
          setMessages((old) => uniqueMessages([...old, message]));
          if (nearBottom)
            setTimeout(
              () =>
                scrollRef.current?.scrollTo({
                  top: scrollRef.current.scrollHeight,
                  behavior: "smooth",
                }),
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
      if (!id || !workspace) return;
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

  const channel = data?.channels.find((c) => c.id === channelId);
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
  const onlineMembers =
    data?.members.filter((m) => data.onlineIds.includes(m.id)) || [];
  const conversationMembers =
    channel?.kind === "dm" || channel?.visibility === "private"
      ? data?.members.filter((m) => channel.memberIds?.includes(m.id)) || []
      : data?.members.filter(
          (m) =>
            !m.suspended &&
            (m.role !== "guest" || channel?.memberIds?.includes(m.id)),
        ) || [];
  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);
  const canManage = Boolean(
    data &&
    (["owner", "admin"].includes(data.user.role) || data.user.siteAdmin),
  );
  const canCreate = Boolean(data && data.user.role !== "guest");
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
  async function changeWorkspace(action: WorkspaceAction) {
    if (workspaceChanging.current) return;
    const actorId = dataRef.current?.user.id;
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
      if (dataRef.current?.user.id !== actorId) return;
      acceptData(next);
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
    channelRef.current = id;
    setChannelId(id);
    setView("channel");
    setTab("chat");
    setThread(null);
    setMobileNav(false);
    setUnread((old) => ({ ...old, [id]: 0 }));
  }
  function onSent(message: Message) {
    if (message.channelId !== channelRef.current) return;
    if (message.parentId) {
      if (threadRef.current?.id === message.parentId)
        setReplies((old) => uniqueMessages([...old, message]));
    } else {
      setMessages((old) => uniqueMessages([...old, message]));
      setTimeout(
        () =>
          scrollRef.current?.scrollTo({
            top: scrollRef.current.scrollHeight,
            behavior: "smooth",
          }),
        50,
      );
    }
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
        author={userMap.get(message.userId)}
        selfId={data!.user.id}
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
  async function openDm(user: User) {
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
      setDialog(null);
      setMessages([]);
      setSaved([]);
      setUnread({});
    } catch (e) {
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
          element?.scrollIntoView({ block: "center", behavior: "smooth" });
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
      fail("Başka bir odaya geçmeden önce mevcut aramadan ayrıl.");
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
    setData(null);
    setMessages([]);
    setChannelId("");
    if (action === "verify-email") {
      try {
        acceptData(await api<Bootstrap>("/auth/me"));
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
    <div className="app-shell">
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
          <button
            className="rail-profile"
            title="Profil ve ayarlar"
            onClick={() => setDialog("settings")}
          >
            <Avatar user={data.user} size="small" online />
          </button>
        </div>
      </aside>
      {mobileNav && (
        <button
          className="nav-scrim"
          aria-label="Gezinmeyi kapat"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside
        className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}
        aria-label="Çalışma alanı gezinmesi"
      >
        <button
          className="workspace-heading"
          aria-label="Çalışma alanlarını değiştir"
          onClick={() => openWorkspaces()}
        >
          <span>
            <strong>{data.workspace.name}</strong>
            <small>
              <span className="small-status-dot" />
              {data.workspace.isDemo
                ? "Sana özel örnek alan"
                : "Ekibinin çalışma alanı"}
            </small>
          </span>
          <ChevronDown size={17} />
        </button>
        <div className="sidebar-content">
          <button
            className="sidebar-search"
            aria-label="Çalışma alanında ara"
            onClick={() => setDialog("search")}
          >
            <Search size={17} />
            <span>Bir şeyler ara</span>
            <kbd>Ctrl K</kbd>
          </button>
          <nav className="primary-nav">
            <button
              className={view === "inbox" ? "selected" : ""}
              onClick={() => {
                setView("inbox");
                setMobileNav(false);
              }}
            >
              <Bell size={18} />
              <span>Gelen kutusu</span>
              {totalUnread > 0 && (
                <span className="count-badge">{totalUnread}</span>
              )}
            </button>
            <button
              className={view === "saved" ? "selected" : ""}
              onClick={() => {
                setView("saved");
                setMobileNav(false);
              }}
            >
              <Bookmark size={18} />
              <span>Kaydedilenler</span>
              {saved.length > 0 && <small>{saved.length}</small>}
            </button>
          </nav>
          <div className="nav-section">
            <div className="nav-section-title">
              <span>
                <ChevronDown size={14} /> Kanallar
              </span>
              <IconButton
                label="Kanal oluştur"
                disabled={!canCreate}
                onClick={() => setDialog("channel")}
              >
                <Plus size={16} />
              </IconButton>
            </div>
            {data.channels
              .filter((c) => c.kind === "text" && !c.archived)
              .map((c) => (
                <button
                  key={c.id}
                  className={`channel-nav ${channelId === c.id && view === "channel" ? "selected" : ""}`}
                  onClick={() => selectChannel(c.id)}
                >
                  <>
                    {c.visibility === "private" ? (
                      <Lock size={16} />
                    ) : (
                      <Hash size={18} />
                    )}
                  </>
                  <span>{c.name}</span>
                  {(unread[c.id] || 0) > 0 && (
                    <span className="count-badge">{unread[c.id]}</span>
                  )}
                  {channelId === c.id && view === "channel" && (
                    <span className="selected-dot" />
                  )}
                </button>
              ))}
            <button
              className="add-channel"
              disabled={!canCreate}
              onClick={() => setDialog("channel")}
            >
              <Plus size={16} />
              Kanal ekle
            </button>
          </div>
          <div className="nav-section voice-section">
            <div className="nav-section-title">
              <span>
                <ChevronDown size={14} /> Sesli odalar
              </span>
              <AudioLines size={15} />
            </div>
            {data.channels
              .filter((c) => c.kind === "voice" && !c.archived)
              .map((c) => {
                const peers = connected ? voiceChannels.get(c.id) || [] : [];
                return (
                  <div key={c.id} className="voice-channel-entry">
                    <div className="voice-channel-row">
                      <button
                        aria-label={c.name}
                        className={`channel-nav voice-nav ${call.channelId === c.id ? "voice-active" : ""}`}
                        onClick={() => startCall(c)}
                      >
                        <Volume2 size={18} />
                        <span>{c.name}</span>
                        {peers.length > 0 && (
                          <span
                            className="voice-peer-count"
                            title={`${peers.length} kişi görüşmede`}
                          >
                            {peers.length}
                          </span>
                        )}
                        {call.channelId === c.id && (
                          <span className="small-status-dot" />
                        )}
                      </button>
                      <IconButton
                        label={`${c.name} katılımcılarını gör`}
                        onClick={() => setVoicePreviewId(c.id)}
                      >
                        <Users size={15} />
                      </IconButton>
                    </div>
                    {peers.length > 0 && (
                      <VoiceParticipants
                        peers={peers}
                        channelName={c.name}
                        currentUserId={data.user.id}
                      />
                    )}
                  </div>
                );
              })}
            <div className="voice-nav-note">
              {connected
                ? "Bir odaya gir, sohbete katıl."
                : "Katılımcı listesi için bağlanılıyor…"}
            </div>
          </div>
          <div className="nav-section dm-section">
            <div className="nav-section-title">
              <span>
                <ChevronDown size={14} /> Direkt mesajlar
              </span>
              <IconButton
                label="Yeni direkt mesaj"
                onClick={() => setDialog("members")}
              >
                <Plus size={16} />
              </IconButton>
            </div>
            {data.members
              .filter(
                (u) =>
                  u.id !== data.user.id &&
                  !u.suspended &&
                  !u.isBot &&
                  ((u.role !== "guest" && data.user.role !== "guest") ||
                    data.channels.some(
                      (c) => c.kind === "dm" && c.memberIds?.includes(u.id),
                    )),
              )
              .slice(0, 5)
              .map((user) => (
                <button
                  key={user.id}
                  className={`channel-nav dm-nav ${channel?.kind === "dm" && channel.memberIds?.includes(user.id) && view === "channel" ? "selected" : ""}`}
                  onClick={() => void openDm(user)}
                >
                  <Avatar
                    user={user}
                    size="tiny"
                    online={data.onlineIds.includes(user.id)}
                  />
                  <span>{user.name}</span>
                </button>
              ))}
            {data.members.length === 1 && (
              <button
                className="add-channel"
                disabled={!canManage}
                onClick={() => setDialog("invite")}
              >
                <Plus size={16} />
                İlk ekip arkadaşını davet et
              </button>
            )}
          </div>
        </div>
        <div className="sidebar-bottom">
          {canManage && (
            <button
              className="sidebar-utility"
              onClick={() => {
                setMobileNav(false);
                setDialog("integrations");
              }}
            >
              <Plug size={18} />
              Entegrasyonlar
            </button>
          )}
          <button
            className="sidebar-utility"
            onClick={() => {
              setMobileNav(false);
              setDialog("notifications");
            }}
          >
            <Bell size={18} />
            Bildirimler ve uygulama
          </button>
          {canManage && (
            <button
              className="mobile-admin-entry"
              onClick={() => {
                setMobileNav(false);
                setAdminOpen(true);
              }}
            >
              <ShieldCheck size={18} /> Yönetim paneli
            </button>
          )}
          {call.joined ? (
            <button
              className="active-call-banner"
              onClick={() => setShowCall(true)}
            >
              <AudioLines size={21} />
              <span>
                <strong>Sesli görüşmedesin</strong>
                <small>{call.channelName}</small>
              </span>
              <ChevronRight size={17} />
            </button>
          ) : (
            <div className="invite-card">
              <span className="invite-card-icon">
                <Users size={20} />
              </span>
              <strong>Birlikte daha güzel.</strong>
              <p>Ekibine de bir yer aç.</p>
              <button disabled={!canManage} onClick={() => setDialog("invite")}>
                Arkadaşlarını davet et
                <ArrowRight size={15} />
              </button>
            </div>
          )}
          <div className="sidebar-status">
            <span
              className={
                connected ? "small-status-dot" : "small-status-dot disconnected"
              }
            />
            <span>{connected ? "Her şey güncel" : "Yeniden bağlanılıyor"}</span>
            <span className="mola-wordmark">mola.</span>
          </div>
        </div>
      </aside>

      <div className="workspace-main">
        <header className="topbar">
          <div className="topbar-breadcrumb">
            <IconButton
              label="Gezinmeyi aç"
              onClick={() => setMobileNav(true)}
              className="mobile-menu"
            >
              <Menu size={21} />
            </IconButton>
            <span className="workspace-breadcrumb">Çalışma alanı</span>
            <ChevronRight size={14} />
            <span>
              {view === "saved"
                ? "Kaydedilenler"
                : view === "inbox"
                  ? "Gelen kutusu"
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
            <kbd>⌘ K</kbd>
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
            <button
              className="topbar-avatar"
              aria-label="Profil ayarları"
              onClick={() => setDialog("settings")}
            >
              <Avatar user={data.user} size="small" online />
            </button>
          </div>
        </header>
        {!connected && !data.user.suspended && !data.workspace.suspended && (
          <div className="connection-banner" role="status">
            <WifiOff size={15} /> Bağlantı kuruluyor. Mesaj taslakların
            korunuyor.
          </div>
        )}
        <main id="main-content" className="main-content">
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
          ) : (
            <>
              <section className="conversation-panel" aria-label="Sohbet">
                <div className="channel-heading">
                  <div className="channel-title-icon">
                    {view === "saved" ? (
                      <Bookmark size={23} />
                    ) : view === "inbox" ? (
                      <Bell size={23} />
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
                          ? "Gelen kutusu"
                          : channelName}
                    </h1>
                    <p>
                      {view === "saved"
                        ? "Tekrar dönmek istediğin mesajlar, elinin altında."
                        : view === "inbox"
                          ? "Sen yokken neler oldu?"
                          : channel?.description ||
                            "Ekibinle aynı yerde, aynı sohbette."}
                    </p>
                  </div>
                  {view === "channel" && (
                    <div className="channel-heading-actions">
                      <button
                        className="member-stack"
                        aria-label="Kanal üyelerini gör"
                        onClick={() => setDialog("members")}
                      >
                        {conversationMembers.slice(0, 3).map((u) => (
                          <Avatar key={u.id} user={u} size="tiny" />
                        ))}
                        <span>{conversationMembers.length}</span>
                      </button>
                      <button
                        className="huddle-button"
                        aria-label="Bir araya gel"
                        onClick={() => startCall()}
                      >
                        <Headphones size={17} />
                        <span>Bir araya gel</span>
                      </button>
                      <IconButton
                        label="Kanal bilgisi"
                        pressed={details}
                        onClick={() => {
                          if (window.matchMedia("(max-width:1100px)").matches) {
                            setDialog("info");
                            return;
                          }
                          setDetails(!details);
                          setThread(null);
                        }}
                      >
                        <Info size={20} />
                      </IconButton>
                    </div>
                  )}
                </div>
                {view === "channel" && (
                  <div
                    className="channel-tabs"
                    role="tablist"
                    aria-label="Kanal içeriği"
                  >
                    <button
                      role="tab"
                      aria-selected={tab === "chat"}
                      className={tab === "chat" ? "active" : ""}
                      onClick={() => setTab("chat")}
                    >
                      <MessageSquare size={16} />
                      Sohbet
                    </button>
                    <button
                      role="tab"
                      aria-selected={tab === "files"}
                      className={tab === "files" ? "active" : ""}
                      onClick={() => setTab("files")}
                    >
                      <FileText size={16} />
                      Dosyalar
                    </button>
                    <button
                      role="tab"
                      aria-selected={tab === "pins"}
                      className={tab === "pins" ? "active" : ""}
                      onClick={() => setTab("pins")}
                    >
                      <Pin size={15} />
                      Sabitlenenler
                    </button>
                    <div className="channel-tab-end">
                      <span className="small-status-dot" />
                      {onlineMembers.length} çevrimiçi
                    </div>
                  </div>
                )}
                <div className="message-scroll" ref={scrollRef}>
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
                  ) : view === "inbox" ? (
                    <NotificationsInbox
                      state={notificationState}
                      channels={data.channels}
                      error={notificationError}
                      loading={notificationsLoading}
                      onSettings={() => setDialog("notifications")}
                      onChannel={selectChannel}
                      onReadAll={() => {
                        void post("/notifications/read")
                          .then(() => api<NotificationState>("/notifications"))
                          .then((next) => {
                            if (
                              next.workspaceId === dataRef.current?.workspace.id
                            ) {
                              setNotificationState(next);
                              setUnread(next.unreadByChannel);
                            }
                          })
                          .catch((e) => setNotificationError(e.message));
                      }}
                      onOpen={(id) => {
                        void api<Message>(`/messages/${id}`)
                          .then(navigateMessage)
                          .catch((e) => fail(e.message));
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
                        <h2>Fikirlerin dosya hâli.</h2>
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
                        />
                      )}
                    </>
                  ) : tab === "pins" ? (
                    <>
                      <div className="list-intro">
                        <Pin size={20} />
                        <h2>Göz önünde dursun.</h2>
                        <p>Ekibin için önemli mesajlar.</p>
                      </div>
                      {pins.length ? (
                        pins.map((m) => renderMessage(m))
                      ) : (
                        <EmptyState
                          icon={<Pin size={27} />}
                          title="Henüz sabitlenen mesaj yok."
                          text="Mesaj menüsünden “Kanala sabitle” seçeneğiyle önemli notları buraya ekle."
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
                        <div className="channel-welcome">
                          <span className="welcome-hash">
                            {channel?.kind === "dm" ? (
                              <MessageCircle size={33} />
                            ) : (
                              <Hash size={36} />
                            )}
                          </span>
                          <div>
                            <div className="welcome-eyebrow">
                              {channel?.kind === "dm"
                                ? "Sohbet burada başlıyor"
                                : "Birlikte düşünmek için bir yer"}
                            </div>
                            <h2>
                              {channel?.kind === "dm"
                                ? `${channelName} ile sohbetin`
                                : `Merhaba, #${channelName} 👋`}
                            </h2>
                            <p>
                              {channel?.description ||
                                "Fikirlerini paylaş, bir soru sor ya da sadece merhaba de."}
                            </p>
                          </div>
                          <span className="welcome-doodle" aria-hidden="true">
                            <Sparkles size={29} />
                          </span>
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
                              <span>
                                {dateLabel(message.createdAt)}
                                <ChevronDown size={12} />
                              </span>
                            </div>
                          )}
                          {renderMessage(message)}
                        </div>
                      ))}
                    </>
                  )}
                </div>
                {view === "channel" && (
                  <>
                    <div className="typing-indicator" aria-live="polite">
                      {typingNames.length > 0 && (
                        <>
                          <span className="typing-dots">•••</span>
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
              {thread ? (
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
                  {data.channels.find((c) => c.id === thread.channelId)
                    ?.archived ? (
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
              ) : (
                details &&
                view === "channel" && (
                  <aside className="details-panel">
                    <div className="details-heading">
                      <h2>Kanal hakkında</h2>
                      <IconButton
                        label="Kanal bilgisini kapat"
                        onClick={() => setDetails(false)}
                      >
                        <X size={18} />
                      </IconButton>
                    </div>
                    <div className="details-body">
                      <div className="channel-detail-mark">
                        <Hash size={29} />
                        <span className="detail-star">✳</span>
                      </div>
                      <h3>{channelName}</h3>
                      <p className="channel-about">
                        {channel?.description ||
                          "Ekibinin fikirlerini ve günlük sohbetini paylaştığı yer."}
                      </p>
                      <div className="channel-detail-meta">
                        <span>
                          <Users size={14} />
                          {channel?.kind === "dm" ? 2 : data.members.length} üye
                        </span>
                        <span>
                          <ShieldCheck size={14} />
                          {channel?.kind === "dm"
                            ? "Özel sohbet"
                            : "Ekip kanalı"}
                        </span>
                      </div>
                      <div className="detail-divider" />
                      <div className="detail-section-title">
                        <h4>Bir mesajdan fazlası</h4>
                        <span>✦</span>
                      </div>
                      <div className="huddle-card">
                        <div className="huddle-art" aria-hidden="true">
                          <div className="orbit orbit-one" />
                          <div className="orbit orbit-two" />
                          <span className="huddle-art-avatar one">
                            <Avatar user={data.members[0]} size="small" />
                          </span>
                          <span className="huddle-art-avatar two">
                            <Avatar
                              user={data.members[1] || data.user}
                              size="small"
                            />
                          </span>
                          <span className="huddle-art-avatar three">
                            <Avatar
                              user={data.members[2] || data.user}
                              size="small"
                            />
                          </span>
                          <span className="huddle-art-center">
                            <AudioLines size={28} />
                          </span>
                          <span className="art-spark spark-one">✧</span>
                          <span className="art-spark spark-two">✦</span>
                        </div>
                        <h4>Bazen konuşmak daha kolay.</h4>
                        <p>
                          Bir araya gel, ekranını paylaş.
                          <br />
                          Fikri birlikte büyütün.
                        </p>
                        <button onClick={() => startCall()}>
                          <Headphones size={16} />
                          Sesli sohbet başlat
                          <ArrowRight size={14} />
                        </button>
                      </div>
                      <div className="detail-divider" />
                      <div className="detail-section-title">
                        <h4>
                          Ekip arkadaşları <span>{data.members.length}</span>
                        </h4>
                        <button onClick={() => setDialog("members")}>
                          Tümü
                        </button>
                      </div>
                      <div className="detail-members">
                        {conversationMembers.slice(0, 5).map((user) => (
                          <button
                            key={user.id}
                            onClick={() => void openDm(user)}
                          >
                            <Avatar
                              user={user}
                              size="small"
                              online={data.onlineIds.includes(user.id)}
                            />
                            <span>
                              <strong>
                                {user.name}
                                {user.id === data.user.id && (
                                  <small> (sen)</small>
                                )}
                              </strong>
                              <small>
                                {user.status ||
                                  (data.onlineIds.includes(user.id)
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
                          </button>
                        ))}
                      </div>
                      <button
                        className="detail-invite"
                        disabled={!canManage}
                        onClick={() => setDialog("invite")}
                      >
                        <Plus size={15} />
                        Ekibe birini davet et
                      </button>
                      <div className="quiet-note">
                        <span>🌿</span>
                        <p>
                          İyi fikirlerin biraz
                          <br />
                          nefes almaya ihtiyacı var.
                        </p>
                      </div>
                    </div>
                  </aside>
                )
              )}
            </>
          )}
        </main>
      </div>
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
          onAction={changeWorkspace}
          onClose={() => setDialog(null)}
        />
      )}
      {voicePreview && (
        <VoiceRoomPreview
          channel={voicePreview}
          peers={voiceChannels.get(voicePreview.id) || []}
          currentUserId={data.user.id}
          isCurrentCall={call.channelId === voicePreview.id}
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
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "channel" && (
        <CreateChannel
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
            notify(`#${created.name} kanalı oluşturuldu.`);
          }}
        />
      )}
      {dialog === "invite" && (
        <InviteDialog data={data} onClose={() => setDialog(null)} />
      )}
      {dialog === "settings" && (
        <SettingsDialog
          user={data.user}
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
      {dialog === "info" && (
        <Modal
          title={`#${channelName} hakkında`}
          onClose={() => setDialog(null)}
        >
          <p className="modal-description">
            {channel?.description || "Ekibinle aynı yerde, aynı sohbette."}
          </p>
          <p className="modal-description">
            {conversationMembers.length} üye ·{" "}
            {channel?.kind === "dm"
              ? "Özel sohbet"
              : channel?.visibility === "private"
                ? "Özel kanal"
                : "Ekip kanalı"}
          </p>
          {channel && channel.kind !== "dm" && (
            <button
              className="secondary-button full-width channel-access-button"
              onClick={() => {
                setDialog(null);
                setChannelAccess(channel);
              }}
            >
              <ShieldCheck size={17} />
              Kanal erişimi ve üyeler
            </button>
          )}
          <button
            className="primary-button full-width"
            onClick={() => {
              setDialog(null);
              startCall();
            }}
          >
            <Headphones size={18} />
            Bir araya gel
          </button>
        </Modal>
      )}
      {dialog === "members" && (
        <Modal title="Ekibindeki insanlar" onClose={() => setDialog(null)}>
          <p className="modal-description">
            {data.workspace.name} · {data.members.length} üye
          </p>
          <div className="members-modal-list">
            {data.members
              .filter((user) => !user.suspended)
              .map((user) => (
                <button
                  key={user.id}
                  disabled={
                    user.id !== data.user.id &&
                    (Boolean(user.isBot) ||
                      ((user.role === "guest" || data.user.role === "guest") &&
                        !data.channels.some(
                          (c) =>
                            c.kind === "dm" && c.memberIds?.includes(user.id),
                        )))
                  }
                  onClick={() => void openDm(user)}
                >
                  <Avatar
                    user={user}
                    online={data.onlineIds.includes(user.id)}
                  />
                  <span>
                    <strong>{user.name}</strong>
                    <small>
                      {user.status ||
                        (data.onlineIds.includes(user.id)
                          ? "Çevrimiçi"
                          : "Çevrimdışı")}
                    </small>
                  </span>
                  {user.id === data.user.id ? (
                    <Settings2 size={17} />
                  ) : (
                    <MessageCircle size={18} />
                  )}
                </button>
              ))}
          </div>
          <button
            className="primary-button full-width"
            disabled={!canManage}
            onClick={() => setDialog("invite")}
          >
            <Plus size={17} />
            Ekibe birini davet et
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
        />
      )}
      {callSetupChannel && (
        <CallSetup
          call={call}
          channel={callSetupChannel}
          onClose={() => setCallSetupChannel(null)}
          onJoin={() => {
            const target = callSetupChannel;
            setCallSetupChannel(null);
            setShowCall(true);
            void call.join({ id: target.id, name: target.name });
          }}
        />
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
      {adminOpen &&
        (["owner", "admin"].includes(data.user.role) ||
          data.user.siteAdmin) && (
          <AdminPanel
            data={data}
            onClose={() => setAdminOpen(false)}
            onChanged={() => void refreshAccess()}
          />
        )}
      {toast && (
        <div
          className={`toast ${toastError ? "toast-error" : ""}`}
          role={toastError ? "alert" : "status"}
        >
          {toastError ? <Info size={18} /> : <Check size={18} />}
          <span>{toast}</span>
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
}: {
  onClose: () => void;
  onCreate: (channel: Channel) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<"text" | "voice">("text");
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
            onClick={() => setKind("text")}
          >
            <Hash size={22} />
            <strong>Yazılı kanal</strong>
            <small>Fikirleri ve dosyaları paylaş</small>
          </button>
          <button
            type="button"
            className={kind === "voice" ? "active" : ""}
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
    <Modal title="Ekibine bir yer daha aç." onClose={onClose}>
      <div className="invite-modal-art">
        <Users size={37} />
        <span>✦</span>
      </div>
      <p className="modal-description">
        Davet bağlantısını paylaş, ekip arkadaşların{" "}
        <strong>{data.workspace.name}</strong> çalışma alanına katılsın.
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
