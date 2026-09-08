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

const origin = "http://127.0.0.1:5174";
const password = "conversation-centers-test-password";
const headers = { Origin: origin };
const privateCenter = (page: Page) =>
  page.getByRole("region", { name: "Özel konuşmalar", exact: true });
const activityCenter = (page: Page) =>
  page.getByRole("region", { name: "Aktivite akışı", exact: true });
const privateRows = (page: Page) =>
  privateCenter(page).getByRole("button", { name: / ile konuşmayı aç$/ });

async function account(page: Page, name = "Merkez Sahibi") {
  const response = await page.request.post("/api/auth/register", {
    headers,
    data: {
      name,
      email: `hubs-${randomUUID()}@example.invalid`,
      password,
      workspaceName: `Merkez ${randomUUID().slice(0, 8)}`,
    },
  });
  expect(response.status()).toBe(200);
  const data = (await response.json()) as Bootstrap;
  await page.goto("/");
  await expect(
    page.getByRole("textbox", {
      name: "#genel kanalına mesaj yaz",
      exact: true,
    }),
  ).toBeVisible();
  return data;
}
async function invitation(api: APIRequestContext) {
  const response = await api.post("/api/invites", { headers });
  expect(response.status()).toBe(201);
  return new URL((await response.json()).url).searchParams.get("invite")!;
}
async function member(inviteToken: string, name: string) {
  const api = await request.newContext({ baseURL: origin });
  try {
    const response = await api.post("/api/auth/register", {
      headers,
      data: {
        name,
        email: `hub-peer-${randomUUID()}@example.invalid`,
        password,
        inviteToken,
      },
    });
    expect(response.status()).toBe(200);
    return { api, data: (await response.json()) as Bootstrap };
  } catch (error) {
    await api.dispose();
    throw error;
  }
}
async function dm(api: APIRequestContext, userId: string) {
  const response = await api.post("/api/dms", { headers, data: { userId } });
  expect(response.status()).toBe(201);
  return response.json() as Promise<Channel>;
}
async function send(
  api: APIRequestContext,
  channelId: string,
  content: string,
  parentId?: string,
) {
  const response = await api.post(`/api/channels/${channelId}/messages`, {
    headers,
    data: { content, ...(parentId ? { parentId } : {}) },
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<Message>;
}
async function navigation(page: Page) {
  const show = page.getByRole("button", { name: "Gezinmeyi aç", exact: true });
  if (await show.isVisible()) await show.click();
  return page.locator("#workspace-navigation");
}
async function hub(page: Page, name: "Özel mesajlar" | "Aktivite") {
  await (
    await navigation(page)
  )
    .getByRole("button", { name, exact: true })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name, exact: true }),
  ).toBeVisible();
  await expect(
    name === "Özel mesajlar" ? privateCenter(page) : activityCenter(page),
  ).toBeVisible();
}
async function workspaceMenu(page: Page, name: string) {
  await (
    await navigation(page)
  )
    .getByRole("button", { name: "Çalışma alanı menüsü", exact: true })
    .click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
async function audit(page: Page, selector: string) {
  const result = await new AxeBuilder({ page }).include(selector).analyze();
  expect(
    result.violations
      .filter((item) => item.impact === "serious" || item.impact === "critical")
      .map((item) => ({
        id: item.id,
        nodes: item.nodes.map((node) => node.failureSummary),
      })),
  ).toEqual([]);
}

test("private messages have a real empty state, create conversations and expose incoming unread messages without opening them", async ({
  page,
}, info) => {
  const owner = await account(page);
  const peer = await member(await invitation(page.request), "Deniz Konuşma");
  try {
    await hub(page, "Özel mesajlar");
    await expect(
      privateCenter(page).getByRole("heading", {
        name: "Bir konuşma başlat.",
        exact: true,
      }),
    ).toBeVisible();
    await expect(privateRows(page)).toHaveCount(0);
    await expect(
      privateCenter(page).getByRole("button", {
        name: "Yeni mesaj",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page
        .locator("#workspace-navigation")
        .getByRole("button", { name: peer.data.user.name, exact: true }),
    ).toHaveCount(0);
    await privateCenter(page)
      .getByRole("button", { name: "Yeni mesaj", exact: true })
      .click();
    const picker = page.getByRole("dialog", {
      name: "Yeni direkt mesaj",
      exact: true,
    });
    await picker
      .getByLabel("Ekip arkadaşını ara", { exact: true })
      .fill(peer.data.user.name);
    await picker
      .getByRole("button", {
        name: `${peer.data.user.name} ile mesajlaş`,
        exact: true,
      })
      .click();
    await expect(picker).toHaveCount(0);
    const composer = page.getByRole("textbox", {
      name: `#${peer.data.user.name} kanalına mesaj yaz`,
      exact: true,
    });
    await expect(composer).toBeVisible();
    await composer.fill("Merkezden başlayan konuşma");
    await page
      .getByRole("button", { name: "Mesaj gönder", exact: true })
      .click();
    await expect(
      page
        .locator(".message-text")
        .filter({ hasText: /^Merkezden başlayan konuşma$/ }),
    ).toBeVisible();
    const state = (await (
      await page.request.get("/api/auth/me")
    ).json()) as Bootstrap;
    const channel = state.channels.find(
      (value) =>
        value.kind === "dm" && value.memberIds?.includes(peer.data.user.id),
    )!;
    expect(channel).toBeTruthy();
    await hub(page, "Özel mesajlar");
    const row = privateCenter(page).getByRole("button", {
      name: `${peer.data.user.name} ile konuşmayı aç`,
      exact: true,
    });
    await expect(row).toContainText("Merkezden başlayan konuşma");
    await send(peer.api, channel.id, "Merkez açıkken gelen yeni mesaj");
    await expect(row).toContainText("Merkez açıkken gelen yeni mesaj");
    await expect(
      page
        .locator("#workspace-navigation")
        .getByRole("button", { name: "Özel mesajlar", exact: true }),
    ).toContainText("1");
    await privateCenter(page)
      .getByRole("button", { name: "Okunmamış", exact: true })
      .click();
    await expect(
      privateCenter(page).getByRole("button", {
        name: "Okunmamış",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(privateRows(page)).toHaveCount(1);
    await expect
      .poll(
        async () =>
          (await (await page.request.get("/api/notifications")).json())
            .unreadByChannel[channel.id],
      )
      .toBe(1);
    await hub(page, "Aktivite");
    await activityCenter(page)
      .getByRole("button", { name: "Tümünü okundu işaretle", exact: true })
      .click();
    await expect
      .poll(async () => {
        const current = await (
          await page.request.get("/api/notifications")
        ).json();
        return {
          activity: current.unreadNotifications,
          conversation: current.unreadByChannel[channel.id],
        };
      })
      .toEqual({ activity: 0, conversation: 1 });
    await hub(page, "Özel mesajlar");
    await privateCenter(page)
      .getByRole("button", { name: "Okunmamış", exact: true })
      .click();
    await expect(privateRows(page)).toHaveCount(1);
    await expect(row).toContainText("Merkez açıkken gelen yeni mesaj");
    await expect(
      row.getByLabel("1 okunmamış mesaj", { exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 320, height: 760 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(320);
    await audit(page, '[aria-label="Özel konuşmalar"]');
    await page.screenshot({
      path: info.outputPath("private-messages-mobile.png"),
      animations: "disabled",
    });
    await row.click();
    await expect(
      page
        .locator(".message-text")
        .filter({ hasText: /^Merkez açıkken gelen yeni mesaj$/ }),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (await (await page.request.get("/api/notifications")).json())
            .unreadByChannel[channel.id] || 0,
      )
      .toBe(0);
    expect(
      (await (await page.request.get("/api/auth/me")).json()).user.id,
    ).toBe(owner.user.id);
  } finally {
    await peer.api.dispose();
  }
});

test("private messages paginate actual conversations and search reaches a conversation beyond the first page", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await account(page, "Konuşma Arşivi Sahibi");
  const conversations: { name: string; channelId: string; preview: string }[] =
    [];
  let token = "";
  // Real accounts, memberships and messages cross the product's 30-row page
  // boundary. Invitations are renewed before their normal twenty-use limit.
  for (let index = 0; index < 31; index++) {
    if (index % 20 === 0) token = await invitation(page.request);
    const name = `Arşiv Kişisi ${String(index + 1).padStart(2, "0")}`;
    const peer = await member(token, name);
    try {
      const channel = await dm(page.request, peer.data.user.id);
      const preview = `Konuşma kaydı ${String(index + 1).padStart(2, "0")}`;
      await send(page.request, channel.id, preview);
      conversations.push({ name, channelId: channel.id, preview });
    } finally {
      await peer.api.dispose();
    }
  }
  await hub(page, "Özel mesajlar");
  await expect(privateRows(page)).toHaveCount(30);
  const oldest = conversations[0];
  await expect(
    privateCenter(page).getByRole("button", {
      name: `${oldest.name} ile konuşmayı aç`,
      exact: true,
    }),
  ).toHaveCount(0);
  const search = privateCenter(page).getByLabel("Özel konuşmalarda ara", {
    exact: true,
  });
  await search.fill(oldest.name);
  const target = privateCenter(page).getByRole("button", {
    name: `${oldest.name} ile konuşmayı aç`,
    exact: true,
  });
  await expect(privateRows(page)).toHaveCount(1);
  await expect(target).toContainText(oldest.preview);
  await search.fill("");
  await expect(privateRows(page)).toHaveCount(30);
  await privateCenter(page)
    .getByRole("button", { name: "Daha fazla konuşma yükle", exact: true })
    .click();
  await expect(privateRows(page)).toHaveCount(31);
  await expect(target).toContainText(oldest.preview);
  await expect(
    privateCenter(page).getByRole("button", {
      name: "Daha fazla konuşma yükle",
      exact: true,
    }),
  ).toHaveCount(0);
  await target.click();
  await expect(
    page.locator(".message-text").filter({ hasText: oldest.preview }),
  ).toBeVisible();
});

test("a delayed private-conversation response cannot leak the previous workspace after switching", async ({
  page,
}) => {
  const owner = await account(page, "İzolasyon Sahibi");
  const peer = await member(
    await invitation(page.request),
    "Önceki Alan Kişisi",
  );
  const channel = await dm(page.request, peer.data.user.id);
  await send(page.request, channel.id, "Önceki alanda kalacak özel özet");
  const create = await page.request.post("/api/workspaces", {
    headers,
    data: { name: "İkinci Merkez Alanı" },
  });
  expect(create.status()).toBe(200);
  const second = (await create.json()) as Bootstrap;
  expect(
    (
      await page.request.post(`/api/workspaces/${owner.workspace.id}/switch`, {
        headers,
      })
    ).status(),
  ).toBe(200);
  await page.reload();
  await expect(
    page.getByRole("textbox", {
      name: "#genel kanalına mesaj yaz",
      exact: true,
    }),
  ).toBeVisible();
  let release!: () => void, received!: () => void, delivered!: () => void;
  const releaseResponse = new Promise<void>((resolve) => {
    release = resolve;
  });
  const intercepted = new Promise<void>((resolve) => {
    received = resolve;
  });
  const responseDelivered = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  let held = false;
  await page.route("**/api/direct-conversations**", async (route) => {
    if (
      held ||
      route.request().headers()["x-workspace-id"] !== owner.workspace.id
    ) {
      await route.continue();
      return;
    }
    held = true;
    const response = await route.fetch();
    received();
    await releaseResponse;
    try {
      await route.fulfill({ response });
    } finally {
      delivered();
    }
  });
  try {
    await hub(page, "Özel mesajlar");
    await intercepted;
    await workspaceMenu(page, "Çalışma alanlarını değiştir");
    await page
      .getByRole("dialog", { name: "Çalışma alanların", exact: true })
      .getByRole("button", {
        name: `${second.workspace.name} alanına geç`,
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("textbox", {
        name: "#genel kanalına mesaj yaz",
        exact: true,
      }),
    ).toBeVisible();
    await hub(page, "Özel mesajlar");
    await expect(
      privateCenter(page).getByRole("button", {
        name: "Konuşmaları yenile",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(privateRows(page)).toHaveCount(0);
    release();
    await responseDelivered;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(
      privateCenter(page).getByRole("button", {
        name: `${peer.data.user.name} ile konuşmayı aç`,
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(privateCenter(page)).not.toContainText(
      "Önceki alanda kalacak özel özet",
    );
    expect(
      (await (await page.request.get("/api/auth/me")).json()).workspace.id,
    ).toBe(second.workspace.id);
    await privateCenter(page)
      .getByRole("button", { name: "Konuşmaları yenile", exact: true })
      .click();
    await expect(
      privateCenter(page).getByRole("button", {
        name: "Konuşmaları yenile",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(privateRows(page)).toHaveCount(0);
  } finally {
    release();
    await page.unroute("**/api/direct-conversations**");
    await peer.api.dispose();
  }
});

test("activity filters persisted mentions and replies, marks one read and opens the exact reply thread", async ({
  page,
}, info) => {
  const owner = await account(page, "Aktivite Sahibi");
  const peer = await member(await invitation(page.request), "Ece Aktivite");
  try {
    const channel = owner.channels.find((value) => value.name === "genel")!;
    const parent = await send(
      page.request,
      channel.id,
      "Aktivite hedefi olan konuşma",
    );
    await hub(page, "Aktivite");
    const reply = await send(
      peer.api,
      channel.id,
      "Aktiviteden açılacak belirli yanıt",
      parent.id,
    );
    const mention = await send(
      peer.api,
      channel.id,
      `@[${owner.user.id}] bu planı gözden geçirir misin?`,
    );
    const center = activityCenter(page);
    const replyItem = center
      .locator("article.activity-item")
      .filter({ hasText: reply.content });
    const mentionItem = center
      .locator("article.activity-item")
      .filter({ hasText: "bu planı gözden geçirir misin?" });
    await expect(replyItem).toBeVisible();
    await expect(mentionItem).toBeVisible();
    await expect(
      page
        .locator("#workspace-navigation")
        .getByRole("button", { name: "Aktivite", exact: true }),
    ).toContainText("2");
    await center
      .getByRole("combobox", { name: "Aktivite türü", exact: true })
      .selectOption({ label: "Bahsetmeler" });
    await expect(mentionItem).toBeVisible();
    await expect(replyItem).toHaveCount(0);
    await mentionItem
      .getByRole("button", { name: "Okundu işaretle", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            await (await page.request.get("/api/notifications")).json()
          ).notifications.find(
            (item: { messageId: string }) => item.messageId === mention.id,
          )?.read,
      )
      .toBe(true);
    await center
      .getByRole("button", { name: "Okunmamış", exact: true })
      .click();
    await expect(
      center.getByRole("button", { name: "Okunmamış", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(center.locator("article.activity-item")).toHaveCount(0);
    await center
      .getByRole("combobox", { name: "Aktivite türü", exact: true })
      .selectOption({ label: "Yanıtlar" });
    await expect(replyItem).toBeVisible();
    await center
      .getByLabel("Aktivitelerde ara", { exact: true })
      .fill("belirli yanıt");
    await expect(replyItem).toBeVisible();
    await audit(page, '[aria-label="Aktivite akışı"]');
    await page.screenshot({
      path: info.outputPath("activity-center-desktop.png"),
      animations: "disabled",
    });
    await replyItem.locator("button.activity-open").click();
    await expect(
      page
        .locator(".thread-messages .message-text")
        .filter({ hasText: reply.content }),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (
            await (await page.request.get("/api/notifications")).json()
          ).notifications.find(
            (item: { messageId: string }) => item.messageId === reply.id,
          )?.read,
      )
      .toBe(true);
    await hub(page, "Aktivite");
    await center.getByRole("button", { name: "Tümü", exact: true }).click();
    await center
      .getByRole("combobox", { name: "Aktivite türü", exact: true })
      .selectOption({ label: "Her tür" });
    await center.getByLabel("Aktivitelerde ara", { exact: true }).fill("");
    await expect(mentionItem).toBeVisible();
    await expect(replyItem).toBeVisible();
  } finally {
    await peer.api.dispose();
  }
});
