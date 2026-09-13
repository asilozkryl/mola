import {
  expect,
  test,
  request,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import type { Bootstrap, Channel, Message } from "../shared/types";
import type { NotificationState } from "../shared/collaboration-types";
import type {
  WorkspaceNotificationSettings,
  ChannelNotificationSettings,
} from "../shared/notification-types";

const origin = "http://127.0.0.1:5174";
const headers = { Origin: origin };
const password = "notification-policy-browser-password";
const attentionText = "Diğer bir sohbette yeni bir mesaj var.";
const workspaceRegion = (page: Page) =>
  page.getByRole("region", {
    name: "Çalışma alanı bildirim tercihleri",
    exact: true,
  });
const preferencesDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Bildirimler ve uygulama", exact: true });

async function register(
  api: APIRequestContext,
  name: string,
  inviteToken?: string,
) {
  const response = await api.post("/api/auth/register", {
    headers,
    data: {
      name,
      email: `policy-${randomUUID()}@example.invalid`,
      password,
      ...(inviteToken ? { inviteToken } : { workspaceName: "Bildirim Ekibi" }),
    },
  });
  expect(response.status()).toBe(200);
  return response.json() as Promise<Bootstrap>;
}
function socketStates(page: Page) {
  const states: NotificationState[] = [];
  page.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => {
      const text = typeof payload === "string" ? payload : payload.toString();
      if (!text.startsWith("42[")) return;
      try {
        const [event, body] = JSON.parse(text.slice(2));
        if (event === "notifications:state") states.push(body);
      } catch {
        /* Other Engine.IO frames are unrelated to the delivery barrier. */
      }
    }),
  );
  return states;
}
async function setup(page: Page) {
  const states = socketStates(page);
  const owner = await register(page.request, "Asil Bildirim");
  const invitation = await page.request.post("/api/invites", { headers });
  expect(invitation.status()).toBe(201);
  const token = new URL((await invitation.json()).url).searchParams.get(
    "invite",
  )!;
  const peer = await request.newContext({ baseURL: origin });
  try {
    const peerData = await register(peer, "Deniz Bildirim", token);
    const current = owner.channels.find((channel) => channel.name === "genel")!;
    const other = owner.channels.find(
      (channel) => channel.name === "duyurular",
    )!;
    await page.goto(`/?workspace=${owner.workspace.id}&channel=${current.id}`);
    await expect(
      page.getByRole("textbox", {
        name: "#genel kanalına mesaj yaz",
        exact: true,
      }),
    ).toBeVisible();
    // The initial state is fetched over HTTP; an empty workspace does not emit
    // notifications:state until a message or read event happens.
    await expect(page.locator(".sidebar-account-profile")).toContainText(
      "Her şey güncel",
    );
    expect((await rawState(page.request)).workspaceId).toBe(owner.workspace.id);
    return { owner, peer, peerData, current, other, states };
  } catch (error) {
    await peer.dispose();
    throw error;
  }
}
async function navigateOpen(page: Page) {
  const button = page.getByRole("button", {
    name: "Gezinmeyi aç",
    exact: true,
  });
  if (
    (await button.isVisible()) &&
    (await button.getAttribute("aria-expanded")) !== "true"
  )
    await button.click();
  return page.locator("#workspace-navigation");
}
async function settings(page: Page) {
  const navigation = await navigateOpen(page);
  await navigation
    .getByRole("button", { name: "Bildirimler ve uygulama", exact: true })
    .click();
  const region = workspaceRegion(page);
  await expect(region).toBeVisible();
  await expect(region).toHaveAttribute("aria-busy", "false");
  return region;
}
async function closeSettings(page: Page) {
  await preferencesDialog(page)
    .getByRole("button", { name: "Kapat", exact: true })
    .click();
  await expect(preferencesDialog(page)).not.toBeVisible();
}
async function policy(api: APIRequestContext) {
  const response = await api.get("/api/notifications/settings");
  expect(response.status()).toBe(200);
  return response.json() as Promise<WorkspaceNotificationSettings>;
}
async function channelPolicy(api: APIRequestContext, channel: Channel) {
  const response = await api.get(
    `/api/channels/${channel.id}/notification-settings`,
  );
  expect(response.status()).toBe(200);
  return response.json() as Promise<ChannelNotificationSettings>;
}
async function rawState(api: APIRequestContext) {
  const response = await api.get("/api/notifications");
  expect(response.status()).toBe(200);
  return response.json() as Promise<NotificationState>;
}
async function workspaceMode(page: Page, mode: "all" | "mentions" | "off") {
  const region = await settings(page);
  await region
    .getByRole("combobox", { name: "Varsayılan bildirimler", exact: true })
    .selectOption(mode);
  await expect(region).toHaveAttribute("aria-busy", "false");
  await expect
    .poll(async () => (await policy(page.request)).defaultMode)
    .toBe(mode);
  await closeSettings(page);
}
async function channelSettings(page: Page, channel: Channel, keyboard = false) {
  const navigation = await navigateOpen(page);
  const row = navigation.getByRole("button", {
    name: channel.name,
    exact: true,
  });
  if (keyboard) {
    await row.focus();
    await page.keyboard.press("Shift+F10");
  } else await row.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Bildirim tercihleri", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Kanal bildirimleri",
    exact: true,
  });
  const region = dialog.getByRole("region", {
    name: `${channel.name} bildirim tercihleri`,
    exact: true,
  });
  await expect(region).toHaveAttribute("aria-busy", "false");
  return { dialog, region, row };
}
async function reloadWithoutToast(page: Page) {
  await page.reload();
  await expect(
    page.getByRole("textbox", {
      name: "#genel kanalına mesaj yaz",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".sidebar-account-profile")).toContainText(
    "Her şey güncel",
  );
  await expect(page.locator(".toast")).toHaveCount(0);
}
async function sendAndObserve(
  page: Page,
  peer: APIRequestContext,
  states: NotificationState[],
  channel: Channel,
  content: string,
  expectedUnread: number,
  alert: boolean,
) {
  const response = await peer.post(`/api/channels/${channel.id}/messages`, {
    headers,
    data: { content },
  });
  expect(response.status()).toBe(201);
  const message = (await response.json()) as Message;
  // The state frame follows any attention event on the same real socket. Wait for
  // its visible unread badge as well, so a negative toast assertion cannot run
  // before the message's live delivery has reached this browser.
  await expect
    .poll(() => states.at(-1)?.unreadByChannel[channel.id])
    .toBe(expectedUnread);
  await expect(
    page
      .locator("#workspace-navigation")
      .getByRole("button", { name: channel.name, exact: true })
      .locator(".count-badge"),
  ).toHaveText(String(expectedUnread));
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  if (alert) await expect(page.locator(".toast")).toHaveText(attentionText);
  else await expect(page.locator(".toast")).toHaveCount(0);
  return message;
}
async function assertQuietRaw(
  api: APIRequestContext,
  channelId: string,
  unread: number,
  messageIds: string[],
) {
  const state = await rawState(api);
  expect(state.unreadByChannel[channelId]).toBe(unread);
  expect(state.unreadNotifications).toBe(messageIds.length);
  expect(state.notifications.map((item) => item.messageId).sort()).toEqual(
    [...messageIds].sort(),
  );
  expect(state.notifications.every((item) => !item.read)).toBe(true);
  return state;
}
async function audit(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations
      .filter((item) => item.impact === "serious" || item.impact === "critical")
      .map((item) => ({
        id: item.id,
        nodes: item.nodes.map((node) => ({
          target: node.target,
          summary: node.failureSummary,
        })),
      })),
  ).toEqual([]);
}

test("workspace mentions, all and off control live attention without deleting activity or unread messages", async ({
  page,
}) => {
  const { owner, peer, other, states } = await setup(page);
  try {
    const initial = await settings(page);
    await expect(
      initial.getByRole("combobox", {
        name: "Varsayılan bildirimler",
        exact: true,
      }),
    ).toHaveValue("mentions");
    await closeSettings(page);
    await sendAndObserve(
      page,
      peer,
      states,
      other,
      "Varsayılan sıradan mesaj",
      1,
      false,
    );
    const mentioned = await sendAndObserve(
      page,
      peer,
      states,
      other,
      `@[${owner.user.id}] İlk kişisel haber`,
      2,
      true,
    );
    await assertQuietRaw(page.request, other.id, 2, [mentioned.id]);

    await workspaceMode(page, "all");
    await reloadWithoutToast(page);
    expect((await policy(page.request)).defaultMode).toBe("all");
    await sendAndObserve(
      page,
      peer,
      states,
      other,
      "Tümü açıkken sıradan mesaj",
      3,
      true,
    );
    await assertQuietRaw(page.request, other.id, 3, [mentioned.id]);

    await workspaceMode(page, "off");
    await reloadWithoutToast(page);
    const silent = await sendAndObserve(
      page,
      peer,
      states,
      other,
      `@[${owner.user.id}] Sessize alınan kişisel haber`,
      4,
      false,
    );
    const raw = await assertQuietRaw(page.request, other.id, 4, [
      mentioned.id,
      silent.id,
    ]);
    await (
      await navigateOpen(page)
    )
      .getByRole("button", { name: "Aktivite", exact: true })
      .click();
    const activity = page.getByRole("region", {
      name: "Aktivite akışı",
      exact: true,
    });
    for (const item of raw.notifications)
      await expect(
        activity.locator(`article[data-notification-id="${item.id}"]`),
      ).toBeVisible();
    await assertQuietRaw(page.request, other.id, 4, [mentioned.id, silent.id]);
  } finally {
    await peer.dispose();
  }
});

test("a channel override, temporary mute and quiet hours affect attention while preserving personal history", async ({
  page,
}) => {
  const { owner, peer, other, states } = await setup(page);
  try {
    await workspaceMode(page, "off");
    let quick = await channelSettings(page, other);
    await quick.region
      .getByRole("combobox", { name: "Bu kanaldaki bildirimler", exact: true })
      .selectOption("all");
    await expect
      .poll(
        async () => (await channelPolicy(page.request, other)).effectiveMode,
      )
      .toBe("all");
    await quick.dialog
      .getByRole("button", { name: "Kapat", exact: true })
      .click();
    await sendAndObserve(
      page,
      peer,
      states,
      other,
      "Kanalın tümü tercihi çalışmaalanını geçersiz kılar",
      1,
      true,
    );

    quick = await channelSettings(page, other);
    await quick.region
      .getByRole("group", {
        name: "Kanal bildirimlerini geçici sustur",
        exact: true,
      })
      .getByRole("button", { name: "30 dakika", exact: true })
      .click();
    await expect(
      quick.region.getByRole("button", {
        name: "Susturmayı kaldır",
        exact: true,
      }),
    ).toBeVisible();
    const muted = await channelPolicy(page.request, other);
    expect(
      Date.parse(muted.mutedUntil!) - Date.parse(muted.serverNow),
    ).toBeGreaterThan(29 * 60_000);
    expect(
      Date.parse(muted.mutedUntil!) - Date.parse(muted.serverNow),
    ).toBeLessThanOrEqual(30 * 60_000);
    await quick.dialog
      .getByRole("button", { name: "Kapat", exact: true })
      .click();
    await reloadWithoutToast(page);
    const mutedMention = await sendAndObserve(
      page,
      peer,
      states,
      other,
      `@[${owner.user.id}] Otuz dakika sessiz haber`,
      2,
      false,
    );

    quick = await channelSettings(page, other);
    await quick.region
      .getByRole("button", { name: "Susturmayı kaldır", exact: true })
      .click();
    await expect
      .poll(async () => (await channelPolicy(page.request, other)).mutedUntil)
      .toBeNull();
    await quick.dialog
      .getByRole("button", { name: "Kapat", exact: true })
      .click();
    const panel = await settings(page);
    await panel
      .locator("summary")
      .filter({ hasText: "Sessiz saatler" })
      .click();
    const form = panel.getByRole("form", {
      name: "Sessiz saatler",
      exact: true,
    });
    await form
      .getByRole("checkbox", {
        name: "Sessiz saatleri etkinleştir",
        exact: true,
      })
      .check();
    await form.getByLabel("Başlangıç saati", { exact: true }).fill("10:00");
    await form.getByLabel("Bitiş saati", { exact: true }).fill("10:00");
    await expect(form.getByRole("alert")).toContainText(
      "Başlangıç ve bitiş saatleri farklı olmalı",
    );
    await expect(
      form.getByRole("button", { name: "Sessiz saatleri kaydet", exact: true }),
    ).toBeDisabled();
    const serverNow = new Date((await policy(page.request)).serverNow);
    const minute = serverNow.getUTCHours() * 60 + serverNow.getUTCMinutes();
    const clock = (value: number) =>
      `${String(Math.floor(((value + 1440) % 1440) / 60)).padStart(2, "0")}:${String(((value + 1440) % 1440) % 60).padStart(2, "0")}`;
    const quiet = {
      enabled: true,
      timeZone: "UTC",
      start: clock(minute - 60),
      end: clock(minute + 60),
    };
    await form.getByLabel("Başlangıç saati", { exact: true }).fill(quiet.start);
    await form.getByLabel("Bitiş saati", { exact: true }).fill(quiet.end);
    await form.getByLabel("Saat dilimi", { exact: true }).fill(quiet.timeZone);
    await form
      .getByRole("button", { name: "Sessiz saatleri kaydet", exact: true })
      .click();
    await expect
      .poll(async () => (await policy(page.request)).quietHours)
      .toEqual(quiet);
    await closeSettings(page);
    await reloadWithoutToast(page);
    const quietMention = await sendAndObserve(
      page,
      peer,
      states,
      other,
      `@[${owner.user.id}] Saat diliminde sessiz haber`,
      3,
      false,
    );
    await assertQuietRaw(page.request, other.id, 3, [
      mutedMention.id,
      quietMention.id,
    ]);
    quick = await channelSettings(page, other);
    await expect(quick.region).toContainText(
      `${quiet.start}–${quiet.end} (UTC)`,
    );
  } finally {
    await peer.dispose();
  }
});

test("remote policy changes synchronize the same account, stay personal and recover from a failed refresh", async ({
  page,
  browser,
}) => {
  const { owner, peer, peerData, current } = await setup(page);
  const peerContext = await browser.newContext({
    baseURL: origin,
    storageState: await peer.storageState(),
  });
  const peerPage = await peerContext.newPage();
  const remote = await request.newContext({
    baseURL: origin,
    storageState: await page.context().storageState(),
  });
  try {
    const ownerPanel = await settings(page);
    await peerPage.goto(
      `/?workspace=${owner.workspace.id}&channel=${current.id}`,
    );
    await expect(
      peerPage.getByRole("textbox", {
        name: "#genel kanalına mesaj yaz",
        exact: true,
      }),
    ).toBeVisible();
    const peerPanel = await settings(peerPage);
    await expect(
      ownerPanel.getByRole("combobox", {
        name: "Varsayılan bildirimler",
        exact: true,
      }),
    ).toHaveValue("mentions");
    await expect(
      peerPanel.getByRole("combobox", {
        name: "Varsayılan bildirimler",
        exact: true,
      }),
    ).toHaveValue("mentions");
    const changed = await remote.patch("/api/notifications/settings", {
      headers,
      data: { defaultMode: "all" },
    });
    expect(changed.status()).toBe(200);
    await expect(
      ownerPanel.getByRole("combobox", {
        name: "Varsayılan bildirimler",
        exact: true,
      }),
    ).toHaveValue("all");
    await expect(
      peerPanel.getByRole("combobox", {
        name: "Varsayılan bildirimler",
        exact: true,
      }),
    ).toHaveValue("mentions");
    expect((await policy(peer)).defaultMode).toBe("mentions");
    expect(
      (
        await peerPage.request
          .get("/api/auth/me")
          .then((response) => response.json())
      ).user.id,
    ).toBe(peerData.user.id);

    await peerPanel
      .getByRole("combobox", { name: "Varsayılan bildirimler", exact: true })
      .selectOption("off");
    await expect.poll(async () => (await policy(peer)).defaultMode).toBe("off");
    await expect(
      ownerPanel.getByRole("combobox", {
        name: "Varsayılan bildirimler",
        exact: true,
      }),
    ).toHaveValue("all");
    await closeSettings(page);
    await page.reload();
    let rejectLoad = true;
    await page.route("**/api/notifications/settings", (route) => {
      if (rejectLoad && route.request().method() === "GET")
        return route.fulfill({
          status: 503,
          json: { error: "Tercih servisi geçici olarak ulaşılamıyor." },
        });
      return route.continue();
    });
    const unavailable = await settings(page);
    await expect(unavailable.getByRole("alert")).toContainText(
      "Tercih servisi geçici olarak ulaşılamıyor",
    );
    await expect(
      unavailable.getByRole("combobox", {
        name: "Varsayılan bildirimler",
        exact: true,
      }),
    ).toHaveCount(0);
    rejectLoad = false;
    await unavailable
      .getByRole("button", { name: "Tercihleri yeniden yükle", exact: true })
      .click();
    await expect(
      unavailable.getByRole("combobox", {
        name: "Varsayılan bildirimler",
        exact: true,
      }),
    ).toHaveValue("all");
    await expect(unavailable.getByRole("alert")).toHaveCount(0);
    expect((await policy(page.request)).defaultMode).toBe("all");
    expect((await policy(peer)).defaultMode).toBe("off");
  } finally {
    await remote.dispose();
    await peerContext.close();
    await peer.dispose();
  }
});

test.describe("compact personal channel preferences", () => {
  test.use({
    viewport: { width: 320, height: 720 },
    isMobile: true,
    hasTouch: true,
  });
  test("the channel context menu opens a usable keyboard-contained 320px preference dialog", async ({
    page,
  }) => {
    const { peer, other } = await setup(page);
    try {
      expect(
        await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
      ).toBe(true);
      const { dialog, region } = await channelSettings(page, other, true);
      const mode = region.getByRole("combobox", {
        name: "Bu kanaldaki bildirimler",
        exact: true,
      });
      await expect(mode).toHaveValue("inherit");
      await expect(region).toContainText("Bahsetmeler ve yanıtlar");
      await mode.selectOption("off");
      await expect
        .poll(async () => (await channelPolicy(page.request, other)).mode)
        .toBe("off");
      await region
        .getByRole("group", {
          name: "Kanal bildirimlerini geçici sustur",
          exact: true,
        })
        .getByRole("button", { name: "1 saat", exact: true })
        .tap();
      await expect(
        region.getByRole("button", { name: "Susturmayı kaldır", exact: true }),
      ).toBeVisible();
      await expect(region).toHaveAttribute("aria-busy", "false");
      for (const control of await dialog.locator("button,select").all()) {
        if (!(await control.isVisible())) continue;
        const bounds = await control.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const close = dialog.getByRole("button", { name: "Kapat", exact: true });
      await close.focus();
      await page.keyboard.press("Shift+Tab");
      // Base UI wraps boundary focus on the next animation frame.
      await expect
        .poll(() =>
          dialog.evaluate((element) =>
            element.contains(document.activeElement),
          ),
        )
        .toBe(true);
      await page.keyboard.press("Tab");
      await expect(close).toBeFocused();
      await audit(page);
      await page.screenshot({
        path: "artifacts/fifth-package-notification-mobile.png",
        fullPage: true,
      });
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      const reopened = await channelSettings(page, other, true);
      await expect(
        reopened.region.getByRole("combobox", {
          name: "Bu kanaldaki bildirimler",
          exact: true,
        }),
      ).toHaveValue("off");
      await reopened.region
        .getByRole("button", { name: "Susturmayı kaldır", exact: true })
        .tap();
      await expect
        .poll(async () => (await channelPolicy(page.request, other)).mutedUntil)
        .toBeNull();
      await reopened.region
        .getByRole("combobox", {
          name: "Bu kanaldaki bildirimler",
          exact: true,
        })
        .selectOption("inherit");
      await expect
        .poll(
          async () => (await channelPolicy(page.request, other)).effectiveMode,
        )
        .toBe("mentions");
    } finally {
      await peer.dispose();
    }
  });
});
