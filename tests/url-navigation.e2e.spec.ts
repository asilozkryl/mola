import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { Attachment, Bootstrap, Channel, Message } from "../shared/types";

const origin = "http://127.0.0.1:5174";
const headers = { Origin: origin };
const routeKeys = [
  "workspace",
  "channel",
  "view",
  "tab",
  "thread",
  "profile",
  "message",
];
const conversation = (page: Page) => page.locator(".conversation-panel");
const thread = (page: Page) => page.locator(".thread-panel");
const composer = (page: Page, name: string) =>
  conversation(page).getByRole("textbox", {
    name: `#${name} kanalına mesaj yaz`,
    exact: true,
  });
const tab = (page: Page, name: string) =>
  conversation(page).getByRole("tab", { name, exact: true });
const channelButton = (page: Page, name: string) =>
  page.locator("#workspace-navigation .channel-nav").filter({ hasText: name });

function path(data: Bootstrap, target: Record<string, string>) {
  return `/?${new URLSearchParams({ workspace: data.workspace.id, ...target })}`;
}

async function expectRoute(
  page: Page,
  data: Bootstrap,
  target: Record<string, string>,
) {
  await expect
    .poll(() =>
      Object.fromEntries(
        [...new URL(page.url()).searchParams].filter(([key]) =>
          routeKeys.includes(key),
        ),
      ),
    )
    .toEqual({ workspace: data.workspace.id, ...target });
}

async function register(
  page: Page,
  name = "Deniz Gezinme",
  inviteToken?: string,
) {
  const response = await page.request.post("/api/auth/register", {
    headers,
    data: {
      name,
      email: `url-navigation-${randomUUID()}@example.invalid`,
      password: "url-navigation-browser-password",
      workspaceName: `Adres Ekibi ${randomUUID().slice(0, 8)}`,
      ...(inviteToken ? { inviteToken } : {}),
    },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as Bootstrap;
}

async function createChannel(page: Page, name: string, members?: string[]) {
  const response = await page.request.post("/api/channels", {
    headers,
    data: {
      name,
      kind: "text",
      ...(members ? { visibility: "private", memberIds: members } : {}),
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as Channel;
}

async function send(
  page: Page,
  channelId: string,
  content: string,
  options: { parentId?: string; attachmentIds?: string[] } = {},
) {
  const response = await page.request.post(
    `/api/channels/${channelId}/messages`,
    {
      headers,
      data: { content, ...options },
    },
  );
  expect(response.status()).toBe(201);
  return (await response.json()) as Message;
}

async function workspaceReady(page: Page, name: string) {
  await expect(composer(page, name)).toBeVisible();
  await expect(
    page.getByText("Her şey güncel", { exact: true }),
  ).toBeAttached();
}

async function openHub(
  page: Page,
  name: "Özel mesajlar" | "Aktivite" | "Kaydedilenler",
) {
  await page
    .locator("#workspace-navigation")
    .getByRole("button", { name, exact: true })
    .click();
  await expect(
    conversation(page).getByRole("heading", { level: 1, name, exact: true }),
  ).toBeVisible();
}

test("channel and collection URLs survive reload without falling back to the default conversation", async ({
  page,
}) => {
  const data = await register(page);
  await page.goto("/");
  await workspaceReady(page, "genel");
  const channel = await createChannel(page, "yol-haritasi");
  const uploaded = await page.request.post("/api/uploads", {
    headers,
    multipart: {
      file: {
        name: "paylasilabilir-plan.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Adresle tekrar açılabilen plan."),
      },
    },
  });
  expect(uploaded.status()).toBe(201);
  const file = (await uploaded.json()) as Attachment;
  const message = await send(page, channel.id, "Bu kanalın kalıcı planı.", {
    attachmentIds: [file.id],
  });
  expect(
    (
      await page.request.patch(`/api/messages/${message.id}`, {
        headers,
        data: { pinned: true },
      })
    ).status(),
  ).toBe(200);
  await channelButton(page, channel.name).click();
  await expectRoute(page, data, { channel: channel.id });
  // A channel created after the navigation effect mounted must also be valid
  // when browser history revisits it, without first refreshing the bootstrap.
  await channelButton(page, "genel").click();
  await workspaceReady(page, "genel");
  await page.goBack();
  await workspaceReady(page, channel.name);
  await expectRoute(page, data, { channel: channel.id });
  await page.reload();
  await workspaceReady(page, channel.name);
  await expect(
    conversation(page).locator(
      `[data-message-id="${message.id}"] .message-text`,
    ),
  ).toHaveText(message.content);

  await tab(page, "Dosyalar").click();
  await expectRoute(page, data, { channel: channel.id, tab: "files" });
  await page.reload();
  await expect(tab(page, "Dosyalar")).toHaveAttribute("aria-selected", "true");
  await expect(
    conversation(page)
      .locator(".channel-file-list")
      .getByRole("button", {
        name: `${file.name} dosyasını önizle`,
        exact: true,
      }),
  ).toBeVisible();
  await expectRoute(page, data, { channel: channel.id, tab: "files" });
  await tab(page, "Sabitlenenler").click();
  await expectRoute(page, data, { channel: channel.id, tab: "pins" });
  await page.reload();
  await expect(tab(page, "Sabitlenenler")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    conversation(page).locator(`[data-message-id="${message.id}"]`),
  ).toHaveClass(/message-pinned/);
  await expectRoute(page, data, { channel: channel.id, tab: "pins" });
  await tab(page, "Sohbet").click();
  await expectRoute(page, data, { channel: channel.id });
});

test("message, activity and saved hubs retain their addresses through reload and browser history", async ({
  page,
}) => {
  const data = await register(page);
  const general = data.channels.find((value) => value.name === "genel")!;
  const hubs = [
    { name: "Özel mesajlar", view: "messages" },
    { name: "Aktivite", view: "inbox" },
    { name: "Kaydedilenler", view: "saved" },
  ] as const;
  await page.goto(path(data, { channel: general.id }));
  await workspaceReady(page, general.name);
  for (const hub of hubs) {
    await openHub(page, hub.name);
    await expectRoute(page, data, { view: hub.view });
    await page.reload();
    await expect(
      conversation(page).getByRole("heading", {
        level: 1,
        name: hub.name,
        exact: true,
      }),
    ).toBeVisible();
    await expectRoute(page, data, { view: hub.view });
  }
  for (const hub of [hubs[1], hubs[0]]) {
    await page.goBack();
    await expect(
      conversation(page).getByRole("heading", {
        level: 1,
        name: hub.name,
        exact: true,
      }),
    ).toBeVisible();
    await expectRoute(page, data, { view: hub.view });
  }
  await page.goBack();
  await workspaceReady(page, general.name);
  await expectRoute(page, data, { channel: general.id });
  for (const hub of hubs) {
    await page.goForward();
    await expect(
      conversation(page).getByRole("heading", {
        level: 1,
        name: hub.name,
        exact: true,
      }),
    ).toBeVisible();
    await expectRoute(page, data, { view: hub.view });
  }
});

test("a thread address reloads its root and replies and closing it remains reversible with Back", async ({
  page,
}) => {
  const data = await register(page);
  const channel = await createChannel(page, "karar-dizisi");
  const root = await send(page, channel.id, "Konuşmanın kalıcı başlangıcı.");
  const reply = await send(page, channel.id, "Adresten geri gelen yanıt.", {
    parentId: root.id,
  });
  await page.goto(path(data, { channel: channel.id }));
  await workspaceReady(page, channel.name);
  await conversation(page)
    .locator(`[data-message-id="${root.id}"]`)
    .getByRole("button", { name: /1 yanıt/ })
    .click();
  await expectRoute(page, data, { channel: channel.id, thread: root.id });
  await expect(
    thread(page).locator(`[data-message-id="${reply.id}"] .message-text`),
  ).toHaveText(reply.content);
  await page.reload();
  await expect(
    thread(page).locator(`[data-message-id="${root.id}"] .message-text`),
  ).toHaveText(root.content);
  await expect(
    thread(page).locator(`[data-message-id="${reply.id}"] .message-text`),
  ).toHaveText(reply.content);
  await expectRoute(page, data, { channel: channel.id, thread: root.id });
  await thread(page)
    .getByRole("button", { name: "Mesaj dizisini kapat", exact: true })
    .click();
  await expect(thread(page)).toHaveCount(0);
  await expectRoute(page, data, { channel: channel.id });
  await page.goBack();
  await expect(
    thread(page).getByRole("textbox", { name: "Yanıtını yaz", exact: true }),
  ).toBeVisible();
  await expect(
    thread(page).locator(`[data-message-id="${reply.id}"] .message-text`),
  ).toHaveText(reply.content);
  await expectRoute(page, data, { channel: channel.id, thread: root.id });
  await page.goForward();
  await expect(thread(page)).toHaveCount(0);
  await expectRoute(page, data, { channel: channel.id });
});

test("profile history restores the original channel draft and reading position", async ({
  page,
}) => {
  const data = await register(page);
  const channel = await createChannel(page, "okuma-gecmisi");
  for (let index = 0; index < 18; index++)
    await send(
      page,
      channel.id,
      `Karar ${index + 1}\nOkuma konumu için saklanan açıklama.\nBir sonraki adım da bu konuşmada.`,
    );
  await page.goto(path(data, { channel: channel.id }));
  await workspaceReady(page, channel.name);
  const input = composer(page, channel.name);
  const draft = "Profil dönüşünde tamamlanacak taslağım.";
  await input.fill(draft);
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/api/channels/${channel.id}/draft`)
          ).json()
        ).content,
    )
    .toBe(draft);
  const scroll = conversation(page).locator(".message-scroll");
  await expect
    .poll(() =>
      scroll.evaluate((element) => element.scrollHeight - element.clientHeight),
    )
    .toBeGreaterThan(600);
  await scroll.evaluate((element) => {
    element.scrollTop = Math.floor(
      (element.scrollHeight - element.clientHeight) * 0.4,
    );
  });
  const position = await scroll.evaluate((element) => element.scrollTop);
  expect(position).toBeGreaterThan(100);
  await page.locator(".topbar-avatar.profile-identity").click();
  const profile = page.getByRole("region", {
    name: "Üye profili",
    exact: true,
  });
  await expect(profile.getByRole("heading", { level: 1 })).toContainText(
    data.user.name,
  );
  await expectRoute(page, data, { profile: data.user.id });
  await profile
    .getByRole("button", { name: "Sohbete dön", exact: true })
    .click();
  await expectRoute(page, data, { channel: channel.id });
  await expect(input).toHaveValue(draft);
  await expect
    .poll(() =>
      scroll.evaluate(
        (element, expected) => Math.abs(element.scrollTop - expected),
        position,
      ),
    )
    .toBeLessThanOrEqual(2);
  await page.goForward();
  await expect(profile.getByRole("heading", { level: 1 })).toContainText(
    data.user.name,
  );
  await expectRoute(page, data, { profile: data.user.id });
  await page.goBack();
  await expectRoute(page, data, { channel: channel.id });
  await expect(input).toHaveValue(draft);
  await expect
    .poll(() =>
      scroll.evaluate(
        (element, expected) => Math.abs(element.scrollTop - expected),
        position,
      ),
    )
    .toBeLessThanOrEqual(2);
});

test("a revoked private channel address cannot recover its previous messages or thread", async ({
  page,
  browser,
}) => {
  const owner = await register(page, "Adres Sahibi");
  const invitation = await page.request.post("/api/invites", { headers });
  expect(invitation.status()).toBe(201);
  const token = new URL((await invitation.json()).url).searchParams.get(
    "invite",
  )!;
  const context = await browser.newContext({ baseURL: origin });
  try {
    const viewer = await context.newPage();
    const member = await register(viewer, "Özel Adres Üyesi", token);
    const general = member.channels.find((value) => value.name === "genel")!;
    const restricted = await createChannel(page, "ozel-adres", [
      member.user.id,
    ]);
    const root = await send(
      page,
      restricted.id,
      "Üyelik bittiğinde gizli kalacak karar.",
    );
    const reply = await send(
      page,
      restricted.id,
      "Eski URL bu özel yanıtı geri getirmemeli.",
      { parentId: root.id },
    );
    const address = path(member, { channel: restricted.id, thread: root.id });
    await viewer.goto(address);
    await expect(
      thread(viewer).locator(`[data-message-id="${reply.id}"] .message-text`),
    ).toHaveText(reply.content);
    await expect(
      viewer.getByText("Her şey güncel", { exact: true }),
    ).toBeAttached();
    expect(
      (
        await page.request.patch(`/api/channels/${restricted.id}/access`, {
          headers,
          data: { visibility: "private", memberIds: [owner.user.id] },
        })
      ).status(),
    ).toBe(200);
    await workspaceReady(viewer, general.name);
    await expectRoute(viewer, member, { channel: general.id });
    await expect(viewer.getByText(root.content, { exact: true })).toHaveCount(
      0,
    );
    await expect(viewer.getByText(reply.content, { exact: true })).toHaveCount(
      0,
    );
    await viewer.goto(address);
    await workspaceReady(viewer, general.name);
    await expectRoute(viewer, member, { channel: general.id });
    await expect(thread(viewer)).toHaveCount(0);
    await expect(channelButton(viewer, restricted.name)).toHaveCount(0);
    await expect(viewer.getByText(root.content, { exact: true })).toHaveCount(
      0,
    );
    await expect(viewer.getByText(reply.content, { exact: true })).toHaveCount(
      0,
    );
    expect(
      (
        await viewer.request.get(`/api/channels/${restricted.id}/messages`)
      ).status(),
    ).toBe(404);
  } finally {
    await context.close();
  }
});

test("an unknown channel and thread address settles on an accessible canonical conversation", async ({
  page,
}) => {
  const data = await register(page);
  const general = data.channels.find((value) => value.name === "genel")!;
  const previous = await createChannel(page, "onceki-ekran");
  const message = await send(
    page,
    previous.id,
    "Yanlış kanal adresinde görünmemesi gereken önceki içerik.",
  );
  await page.goto(path(data, { channel: previous.id }));
  await workspaceReady(page, previous.name);
  await expect(
    conversation(page).locator(`[data-message-id="${message.id}"]`),
  ).toBeVisible();
  await page.goto(
    path(data, { channel: randomUUID(), tab: "pins", thread: message.id }),
  );
  await workspaceReady(page, general.name);
  await expectRoute(page, data, { channel: general.id });
  await expect(thread(page)).toHaveCount(0);
  await expect(page.getByText(message.content, { exact: true })).toHaveCount(0);
  await expect(tab(page, "Sohbet")).toHaveAttribute("aria-selected", "true");
  await page.reload();
  await workspaceReady(page, general.name);
  await expectRoute(page, data, { channel: general.id });
});

test("workspace history restores the target channel and tab while switching the server session", async ({
  page,
}) => {
  const home = await register(page);
  const channel = await createChannel(page, "ilk-ekip-plani");
  const note = await send(
    page,
    channel.id,
    "Yalnız ilk çalışma alanındaki sabit karar.",
  );
  expect(
    (
      await page.request.patch(`/api/messages/${note.id}`, {
        headers,
        data: { pinned: true },
      })
    ).status(),
  ).toBe(200);
  const created = await page.request.post("/api/workspaces", {
    headers,
    data: { name: `İkinci Adres Ekibi ${randomUUID().slice(0, 8)}` },
  });
  expect(created.status()).toBe(200);
  const other = (await created.json()) as Bootstrap;
  const otherGeneral = other.channels.find((value) => value.name === "genel")!;
  await page.goto(path(home, { channel: channel.id, tab: "pins" }));
  await expect(
    conversation(page).locator(`[data-message-id="${note.id}"] .message-text`),
  ).toHaveText(note.content);
  await expectRoute(page, home, { channel: channel.id, tab: "pins" });
  expect(
    (await (await page.request.get("/api/auth/me")).json()).workspace.id,
  ).toBe(home.workspace.id);
  await page
    .getByRole("complementary", { name: "Çalışma alanları", exact: true })
    .getByRole("button", {
      name: `${other.workspace.name} alanına geç`,
      exact: true,
    })
    .click();
  await workspaceReady(page, otherGeneral.name);
  await expectRoute(page, other, { channel: otherGeneral.id });
  await expect(page.getByText(note.content, { exact: true })).toHaveCount(0);
  await page.goBack();
  await expect(
    conversation(page).locator(`[data-message-id="${note.id}"] .message-text`),
  ).toHaveText(note.content);
  await expect(tab(page, "Sabitlenenler")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expectRoute(page, home, { channel: channel.id, tab: "pins" });
  expect(
    (await (await page.request.get("/api/auth/me")).json()).workspace.id,
  ).toBe(home.workspace.id);
  await page.goForward();
  await workspaceReady(page, otherGeneral.name);
  await expectRoute(page, other, { channel: otherGeneral.id });
  await expect(page.getByText(note.content, { exact: true })).toHaveCount(0);
  expect(
    (await (await page.request.get("/api/auth/me")).json()).workspace.id,
  ).toBe(other.workspace.id);
});

test("existing reply permalinks remain valid and reload the exact message", async ({
  page,
}) => {
  const data = await register(page);
  const channel = await createChannel(page, "paylasilan-yanit");
  const root = await send(page, channel.id, "Paylaşılan yanıtın kök mesajı.");
  const reply = await send(
    page,
    channel.id,
    "Eski message parametresindeki tam yanıt.",
    { parentId: root.id },
  );
  await page.goto(path(data, { message: reply.id }));
  await expect(
    thread(page).locator(`[data-message-id="${reply.id}"] .message-text`),
  ).toHaveText(reply.content);
  await expect(
    thread(page).locator(`[data-message-id="${root.id}"] .message-text`),
  ).toHaveText(root.content);
  await expectRoute(page, data, { message: reply.id });
  await page.reload();
  await expect(
    thread(page).locator(`[data-message-id="${reply.id}"] .message-text`),
  ).toHaveText(reply.content);
  await expectRoute(page, data, { message: reply.id });
});
