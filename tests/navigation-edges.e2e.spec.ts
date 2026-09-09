import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { Bootstrap, Channel, Message } from "../shared/types";

test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
  permissions: ["microphone", "camera"],
});

const origin = "http://127.0.0.1:5174";
const headers = { Origin: origin };
const saved = (page: Page) =>
  page.getByRole("region", { name: "Kaydedilen mesajlar", exact: true });
const thread = (page: Page) => page.locator(".thread-panel");
const channelButton = (page: Page, name: string) =>
  page.locator("#workspace-navigation .channel-nav").filter({ hasText: name });

async function register(page: Page) {
  const response = await page.request.post("/api/auth/register", {
    headers,
    data: {
      name: "Gezinme Koruması",
      email: `navigation-edges-${randomUUID()}@example.invalid`,
      password: "navigation-edges-browser-password",
      workspaceName: `Gezinme Ekibi ${randomUUID().slice(0, 8)}`,
    },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as Bootstrap;
}

async function createChannel(page: Page, name: string) {
  const response = await page.request.post("/api/channels", {
    headers,
    data: { name, kind: "text" },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as Channel;
}

async function message(
  page: Page,
  channelId: string,
  content: string,
  parentId?: string,
) {
  const response = await page.request.post(
    `/api/channels/${channelId}/messages`,
    {
      headers,
      data: { content, ...(parentId ? { parentId } : {}) },
    },
  );
  expect(response.status()).toBe(201);
  return (await response.json()) as Message;
}

async function ready(page: Page, name = "genel") {
  await expect(
    page.getByRole("textbox", {
      name: `#${name} kanalına mesaj yaz`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Her şey güncel", { exact: true }),
  ).toBeAttached();
}

async function openSaved(page: Page) {
  await page
    .locator("#workspace-navigation")
    .getByRole("button", { name: /^Kaydedilenler(?: \d+)?$/ })
    .click();
  await expect(saved(page)).toBeVisible();
}

async function savedRoute(page: Page, workspaceId: string, threadId?: string) {
  await expect
    .poll(() => Object.fromEntries(new URL(page.url()).searchParams))
    .toEqual({
      workspace: workspaceId,
      view: "saved",
      ...(threadId ? { thread: threadId } : {}),
    });
}

test("cancelling a history workspace switch during a call preserves the saved screen and its URL", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = window as typeof window & {
      navigationEdgeTracks: MediaStreamTrack[];
    };
    state.navigationEdgeTracks = [];
    const capture = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await capture(constraints);
      state.navigationEdgeTracks.push(...stream.getTracks());
      return stream;
    };
  });
  const home = await register(page);
  const general = home.channels.find((channel) => channel.name === "genel")!;
  const note = await message(
    page,
    general.id,
    "Görüşme sırasında bu kayıtta kalıyorum.",
  );
  expect(
    (await page.request.put(`/api/saved/${note.id}`, { headers })).status(),
  ).toBe(200);
  const created = await page.request.post("/api/workspaces", {
    headers,
    data: { name: `Geçmişteki Ekip ${randomUUID().slice(0, 8)}` },
  });
  expect(created.status()).toBe(200);
  const other = (await created.json()) as Bootstrap;
  const otherGeneral = other.channels.find(
    (channel) => channel.name === "genel",
  )!;
  await page.goto(
    `/?workspace=${other.workspace.id}&channel=${otherGeneral.id}`,
  );
  await ready(page);
  await page
    .getByRole("complementary", { name: "Çalışma alanları", exact: true })
    .getByRole("button", {
      name: `${home.workspace.name} alanına geç`,
      exact: true,
    })
    .click();
  await ready(page);
  await page
    .getByRole("button", { name: "Bir araya gel", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Görüşmeye katıl", exact: true })
    .click();
  const call = page.locator(".call-dialog");
  await expect(
    call.getByRole("button", { name: "Mikrofonu kapat", exact: true }),
  ).toBeEnabled();
  const liveAudio = () =>
    page.evaluate(() =>
      (
        window as typeof window & { navigationEdgeTracks: MediaStreamTrack[] }
      ).navigationEdgeTracks
        .filter(
          (track) => track.kind === "audio" && track.readyState === "live",
        )
        .map((track) => track.id),
    );
  await expect.poll(liveAudio).toHaveLength(1);
  const microphone = await liveAudio();
  await call
    .getByRole("button", { name: "Görüşmeyi küçült", exact: true })
    .click();
  await openSaved(page);
  await savedRoute(page, home.workspace.id);
  await expect(
    saved(page).locator(`[data-message-id="${note.id}"]`),
  ).toBeVisible();

  // The real history is B channel → A channel → A Saved. Skip the intermediate
  // channel entry so the cross-workspace request starts with Saved still visible.
  await page.evaluate(() => history.go(-2));
  const confirmation = page.getByRole("dialog", {
    name: "Çalışma alanların",
    exact: true,
  });
  await expect(
    confirmation.getByRole("heading", {
      name: "Görüşmeden ayrılıp devam et",
      exact: true,
    }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.get("workspace")).toBe(
    other.workspace.id,
  );
  expect(
    (await (await page.request.get("/api/auth/me")).json()).workspace.id,
  ).toBe(home.workspace.id);
  await confirmation
    .getByRole("button", { name: "Vazgeç", exact: true })
    .click();
  await confirmation
    .getByRole("button", { name: "Kapat", exact: true })
    .click();
  await expect(confirmation).toHaveCount(0);
  await expect(
    saved(page).locator(`[data-message-id="${note.id}"]`),
  ).toBeVisible();
  await savedRoute(page, home.workspace.id);
  expect(await liveAudio()).toEqual(microphone);
  const dock = page.getByRole("region", {
    name: "Devam eden görüşme",
    exact: true,
  });
  await expect(dock).toBeVisible();
  expect(
    (await (await page.request.get("/api/auth/me")).json()).workspace.id,
  ).toBe(home.workspace.id);
  await dock
    .getByRole("button", { name: "Görüşmeden ayrıl", exact: true })
    .click();
  await expect.poll(liveAudio).toHaveLength(0);
  await page.reload();
  await savedRoute(page, home.workspace.id);
  await expect(
    saved(page).locator(`[data-message-id="${note.id}"]`),
  ).toBeVisible();
});

test("deleting the underlying channel keeps an accessible saved thread open and reloadable", async ({
  page,
}) => {
  const data = await register(page);
  const underlying = await createChannel(page, "arka-plan-kanali");
  const source = await createChannel(page, "korunan-kayit");
  await message(
    page,
    underlying.id,
    "Kaydedilenler açılmadan önce seçili kanal.",
  );
  const root = await message(
    page,
    source.id,
    "Başka kanaldaki kayıtlı konuşma açık kalmalı.",
  );
  const reply = await message(
    page,
    source.id,
    "Kaynak kanala erişimimiz hâlâ sürüyor.",
    root.id,
  );
  expect(
    (await page.request.put(`/api/saved/${root.id}`, { headers })).status(),
  ).toBe(200);
  await page.goto(`/?workspace=${data.workspace.id}&channel=${underlying.id}`);
  await ready(page, underlying.name);
  await openSaved(page);
  const savedRoot = saved(page).locator(
    `article[data-message-id="${root.id}"]`,
  );
  await expect(savedRoot).toBeVisible();
  await savedRoot.getByRole("button", { name: /1 yanıt/ }).click();
  await savedRoute(page, data.workspace.id, root.id);
  await expect(
    thread(page).locator(`[data-message-id="${reply.id}"] .message-text`),
  ).toHaveText(reply.content);
  const deletion = await page.request.delete(
    `/api/admin/workspace/channels/${underlying.id}`,
    {
      headers: {
        ...headers,
        "X-Workspace-Id": data.workspace.id,
        "X-User-Id": data.user.id,
      },
      data: { confirmName: underlying.name },
    },
  );
  expect(deletion.status()).toBe(204);
  // Wait for the bootstrap refresh to remove A from navigation before inspecting
  // B's thread; an assertion before that refresh could miss the invalidation bug.
  await expect(channelButton(page, underlying.name)).toHaveCount(0);
  await expect(channelButton(page, source.name)).toBeVisible();
  await expect(savedRoot).toBeVisible();
  await expect(
    thread(page).locator(`[data-message-id="${root.id}"] .message-text`),
  ).toHaveText(root.content);
  await expect(
    thread(page).locator(`[data-message-id="${reply.id}"] .message-text`),
  ).toHaveText(reply.content);
  await expect(
    thread(page).getByRole("textbox", { name: "Yanıtını yaz", exact: true }),
  ).toBeVisible();
  await savedRoute(page, data.workspace.id, root.id);
  expect((await page.request.get(`/api/messages/${root.id}`)).status()).toBe(
    200,
  );
  await page.reload();
  await savedRoute(page, data.workspace.id, root.id);
  await expect(saved(page)).toBeVisible();
  await expect(
    thread(page).locator(`[data-message-id="${reply.id}"] .message-text`),
  ).toHaveText(reply.content);
  await expect(channelButton(page, underlying.name)).toHaveCount(0);
});
