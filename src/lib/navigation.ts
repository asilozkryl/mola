export type ConversationTab = "chat" | "files" | "pins";
export type AppRoute = {
  workspaceId: string;
} & (
  | {
      view: "channel";
      channelId?: string;
      tab: ConversationTab;
      threadId?: string;
      messageId?: string;
    }
  | { view: "messages" | "inbox" | "saved"; threadId?: string }
  | { view: "profile"; profileId: string }
);

const routeKeys = [
  "workspace",
  "view",
  "channel",
  "tab",
  "thread",
  "message",
  "profile",
];
const identifier = (value: string | null) =>
  value && value.length <= 200 ? value : undefined;

/** Keep existing profile/message links valid while giving every main screen an address. */
export function readAppRoute(search: string, workspaceId = ""): AppRoute {
  const params = new URLSearchParams(search);
  const workspace = identifier(params.get("workspace")) || workspaceId;
  const profileId = identifier(params.get("profile"));
  if (profileId) return { workspaceId: workspace, view: "profile", profileId };
  const messageId = identifier(params.get("message"));
  const view = params.get("view");
  if (
    !messageId &&
    (view === "messages" || view === "inbox" || view === "saved")
  )
    return {
      workspaceId: workspace,
      view,
      ...(identifier(params.get("thread"))
        ? { threadId: identifier(params.get("thread")) }
        : {}),
    };
  const tab = params.get("tab");
  return {
    workspaceId: workspace,
    view: "channel",
    channelId: identifier(params.get("channel")),
    tab: messageId ? "chat" : tab === "files" || tab === "pins" ? tab : "chat",
    threadId: identifier(params.get("thread")),
    messageId,
  };
}

export function appRouteAddress(route: AppRoute, current: string): string {
  const url = new URL(current, "http://mola.local");
  routeKeys.forEach((key) => url.searchParams.delete(key));
  if (route.workspaceId) url.searchParams.set("workspace", route.workspaceId);
  if (route.view === "profile")
    url.searchParams.set("profile", route.profileId);
  else if (route.view !== "channel") {
    url.searchParams.set("view", route.view);
    if (route.threadId) url.searchParams.set("thread", route.threadId);
  } else {
    if (route.channelId) url.searchParams.set("channel", route.channelId);
    if (route.tab !== "chat") url.searchParams.set("tab", route.tab);
    if (route.messageId) url.searchParams.set("message", route.messageId);
    else if (route.threadId) url.searchParams.set("thread", route.threadId);
  }
  return url.pathname + url.search + url.hash;
}
