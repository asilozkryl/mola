import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appRouteAddress,
  readAppRoute,
  type AppRoute,
} from "../src/lib/navigation.js";

test("every main route survives an address roundtrip", () => {
  const routes: AppRoute[] = [
    { workspaceId: "w", view: "channel", channelId: "c", tab: "chat" },
    { workspaceId: "w", view: "channel", channelId: "dm", tab: "files" },
    {
      workspaceId: "w",
      view: "channel",
      channelId: "c",
      tab: "pins",
      threadId: "t",
    },
    {
      workspaceId: "w",
      view: "channel",
      channelId: "c",
      tab: "chat",
      messageId: "m",
    },
    { workspaceId: "w", view: "messages" },
    { workspaceId: "w", view: "inbox" },
    { workspaceId: "w", view: "saved" },
    { workspaceId: "w", view: "saved", threadId: "t" },
    { workspaceId: "w", view: "profile", profileId: "u" },
  ];
  for (const route of routes) {
    const url = new URL(
      appRouteAddress(route, "https://example.com/"),
      "https://example.com",
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(readAppRoute(url.search))),
      route,
    );
  }
});

test("navigation preserves invite/auth context and clears incompatible route fields", () => {
  const address = appRouteAddress(
    { workspaceId: "next", view: "saved" },
    "https://example.com/?workspace=old&channel=c&tab=files&thread=t&message=m&profile=u&invite=secret#verify",
  );
  assert.equal(address, "/?invite=secret&workspace=next&view=saved#verify");
});

test("legacy profile and message URLs retain precedence over hubs and invalid tabs", () => {
  assert.deepEqual(
    readAppRoute("?workspace=w&profile=u&message=m&view=saved"),
    { workspaceId: "w", view: "profile", profileId: "u" },
  );
  assert.equal(
    readAppRoute("?workspace=w&message=m&view=saved&tab=files").view,
    "channel",
  );
  const route = readAppRoute("?view=unknown&tab=unknown", "current");
  assert.equal(route.workspaceId, "current");
  assert.equal(route.view === "channel" && route.tab, "chat");
});
