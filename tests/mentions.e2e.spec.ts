import {
  expect,
  request,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { Bootstrap, Channel, Message } from "../shared/types";

const origin = "http://127.0.0.1:5174";
const headers = { Origin: origin };
const input = (page: Page) =>
  page.getByRole("textbox", { name: /kanalına mesaj yaz/ });

async function setup(page: Page) {
  const response = await page.request.post("/api/auth/register", {
    headers,
    data: {
      name: "Bahsetme Sahibi",
      email: `mention-owner-${randomUUID()}@example.invalid`,
      password: "mention-browser-test-password",
      workspaceName: "Bahsetme Ekibi",
    },
  });
  expect(response.status()).toBe(200);
  const owner = (await response.json()) as Bootstrap;
  const invitation = await page.request.post("/api/invites", { headers });
  expect(invitation.status()).toBe(201);
  const inviteToken = new URL((await invitation.json()).url).searchParams.get(
    "invite",
  );
  const peers: { api: APIRequestContext; data: Bootstrap }[] = [];
  try {
    for (const jobTitle of ["Tasarım", "Geliştirme"]) {
      const api = await request.newContext({ baseURL: origin });
      const joined = await api.post("/api/auth/register", {
        headers,
        data: {
          name: "Deniz Kaya",
          email: `mention-peer-${randomUUID()}@example.invalid`,
          password: "mention-browser-test-password",
          inviteToken,
        },
      });
      expect(joined.status()).toBe(200);
      const data = (await joined.json()) as Bootstrap;
      peers.push({ api, data });
      expect(
        (
          await api.patch("/api/profile", { headers, data: { jobTitle } })
        ).status(),
      ).toBe(200);
    }
    await page.goto("/");
    await expect(input(page)).toBeVisible();
    await expect(page.locator(".channel-tab-end")).toHaveAttribute(
      "data-connected",
      "true",
    );
    const channel = owner.channels.find((channel) => channel.name === "genel")!;
    return { owner, peers, channel };
  } catch (error) {
    await Promise.all(peers.map((peer) => peer.api.dispose()));
    throw error;
  }
}

async function choose(page: Page, email: string) {
  await page
    .getByRole("button", { name: "Birinden bahset", exact: true })
    .click();
  const search = page.getByRole("searchbox", {
    name: "Bahsedilecek kişiyi ara",
    exact: true,
  });
  await expect(search).toBeFocused();
  await search.fill(email);
  await search.press("ArrowDown");
  await expect(page.locator(".mention-options button")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(input(page)).toBeFocused();
}

async function send(page: Page, channelId: string) {
  const pending = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith(`/channels/${channelId}/messages`),
  );
  await page.getByRole("button", { name: "Mesaj gönder", exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(201);
  return (await response.json()) as Message;
}

async function mentioned(api: APIRequestContext, messageId: string) {
  const response = await api.get("/api/notifications");
  expect(response.status()).toBe(200);
  const state = await response.json();
  return state.notifications.some(
    (item: { messageId: string; kind: string }) =>
      item.messageId === messageId && item.kind === "mention",
  );
}

test("a selected duplicate-name recipient survives draft reload, renaming and message edits", async ({
  page,
}) => {
  const { peers, channel } = await setup(page);
  const [first, second] = peers;
  try {
    await page
      .getByRole("button", { name: "Birinden bahset", exact: true })
      .click();
    await page
      .getByRole("searchbox", { name: "Bahsedilecek kişiyi ara" })
      .fill("Deniz");
    await expect(page.locator(".mention-options button")).toHaveCount(2);
    await expect(page.locator(".mention-options")).toContainText("Tasarım");
    await expect(page.locator(".mention-options")).toContainText("Geliştirme");
    await page
      .getByRole("searchbox", { name: "Bahsedilecek kişiyi ara" })
      .press("ArrowUp");
    await expect(page.locator(".mention-options button").last()).toBeFocused();
    await page.keyboard.press("Escape");
    await choose(page, second.data.user.email);
    await input(page).pressSequentially("Lütfen bak.");
    await expect(input(page)).toHaveValue("@Deniz Kaya Lütfen bak.");
    await expect
      .poll(
        async () =>
          (
            await (
              await page.request.get(`/api/channels/${channel.id}/draft`)
            ).json()
          ).content,
      )
      .toBe(`@[${second.data.user.id}] Lütfen bak.`);
    await page.reload();
    await expect(input(page)).toHaveValue("@Deniz Kaya Lütfen bak.");
    await expect(page.locator(".channel-tab-end")).toHaveAttribute(
      "data-connected",
      "true",
    );
    expect(
      (
        await second.api.patch("/api/profile", {
          headers,
          data: { name: "Deniz Yıldız" },
        })
      ).status(),
    ).toBe(200);
    await expect(input(page)).toHaveValue("@Deniz Yıldız Lütfen bak.");
    const message = await send(page, channel.id);
    expect(message.content).toBe(`@[${second.data.user.id}] Lütfen bak.`);
    await expect.poll(() => mentioned(second.api, message.id)).toBe(true);
    expect(await mentioned(first.api, message.id)).toBe(false);
    const article = page.locator(`article[data-message-id="${message.id}"]`);
    await expect(article.locator(".message-text")).toHaveText(
      "@Deniz Yıldız Lütfen bak.",
    );
    await article.hover();
    await article
      .getByRole("button", { name: "Diğer mesaj işlemleri", exact: true })
      .click();
    await article
      .getByRole("button", { name: "Mesajı düzenle", exact: true })
      .click();
    const edit = article.getByRole("textbox", {
      name: "Mesajı düzenle",
      exact: true,
    });
    await expect(edit).toHaveValue("@Deniz Yıldız Lütfen bak.");
    await edit.press("Home");
    await edit.pressSequentially("Güncel: ");
    await article.getByRole("button", { name: "Kaydet", exact: true }).click();
    await expect(article.locator(".message-text")).toHaveText(
      "Güncel: @Deniz Yıldız Lütfen bak.",
    );
    expect(
      (await (await page.request.get(`/api/messages/${message.id}`)).json())
        .content,
    ).toBe(`Güncel: @[${second.data.user.id}] Lütfen bak.`);
    await expect(article).not.toHaveAttribute(
      "aria-label",
      new RegExp(second.data.user.id),
    );

    const rich = await page.request.post(
      `/api/channels/${channel.id}/messages`,
      {
        headers,
        data: {
          content: `**@[${second.data.user.id}]** \`@[${second.data.user.id}]\` @EskiAd <img src=x onerror=alert(1)>`,
        },
      },
    );
    expect(rich.status()).toBe(201);
    const richArticle = page.locator(
      `article[data-message-id="${(await rich.json()).id}"]`,
    );
    await expect(richArticle.locator(".message-text strong")).toHaveText(
      "@Deniz Yıldız",
    );
    await expect(richArticle.locator(".message-text code")).toHaveText(
      "@Deniz Yıldız",
    );
    await expect(richArticle.locator(".message-text")).toContainText(
      "@EskiAd <img src=x onerror=alert(1)>",
    );
    await expect(richArticle.locator('img[src="x"]')).toHaveCount(0);
    await expect(richArticle.locator(".message-text")).not.toContainText(
      second.data.user.id,
    );
  } finally {
    await Promise.all(peers.map((peer) => peer.api.dispose()));
  }
});

test.describe("small touch mentions", () => {
  test.use({
    viewport: { width: 320, height: 640 },
    hasTouch: true,
    isMobile: true,
  });

  test("removing the first identical mention keeps the second recipient", async ({
    page,
  }) => {
    const { peers, channel } = await setup(page);
    const [first, second] = peers;
    try {
      await choose(page, first.data.user.email);
      await choose(page, second.data.user.email);
      await expect(input(page)).toHaveValue("@Deniz Kaya @Deniz Kaya ");
      await input(page).press("Home");
      for (let index = 0; index < 12; index++)
        await input(page).press("Shift+ArrowRight");
      await input(page).press("Backspace");
      await expect(input(page)).toHaveValue("@Deniz Kaya ");
      const message = await send(page, channel.id);
      expect(message.content).toBe(`@[${second.data.user.id}]`);
      await expect.poll(() => mentioned(second.api, message.id)).toBe(true);
      expect(await mentioned(first.api, message.id)).toBe(false);
    } finally {
      await Promise.all(peers.map((peer) => peer.api.dispose()));
    }
  });
});

test("copy stays readable while composer and message-edit undo restore both identical recipients", async ({
  page,
}) => {
  const { peers, channel } = await setup(page);
  const [first, second] = peers;
  try {
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await choose(page, first.data.user.email);
    await choose(page, second.data.user.email);
    await input(page).press("ControlOrMeta+a");
    await input(page).press("ControlOrMeta+c");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      "@Deniz Kaya @Deniz Kaya ",
    );
    await input(page).press("Home");
    for (let index = 0; index < 12; index++)
      await input(page).press("Shift+ArrowRight");
    await input(page).press("Backspace");
    await expect(input(page)).toHaveValue("@Deniz Kaya ");
    await input(page).press("ControlOrMeta+z");
    await expect(input(page)).toHaveValue("@Deniz Kaya @Deniz Kaya ");
    await input(page).press("ControlOrMeta+Shift+z");
    await expect(input(page)).toHaveValue("@Deniz Kaya ");
    await input(page).press("ControlOrMeta+z");
    const message = await send(page, channel.id);
    expect(message.content).toBe(
      `@[${first.data.user.id}] @[${second.data.user.id}]`,
    );
    await input(page).press("ControlOrMeta+z");
    await expect(input(page)).toHaveValue("");

    const article = page.locator(`article[data-message-id="${message.id}"]`);
    await article.hover();
    await article
      .getByRole("button", { name: "Diğer mesaj işlemleri", exact: true })
      .click();
    await article
      .getByRole("button", { name: "Mesajı düzenle", exact: true })
      .click();
    const edit = article.getByRole("textbox", {
      name: "Mesajı düzenle",
      exact: true,
    });
    await edit.press("Home");
    for (let index = 0; index < 12; index++)
      await edit.press("Shift+ArrowRight");
    await edit.press("Backspace");
    await expect(edit).toHaveValue("@Deniz Kaya");
    await edit.press("ControlOrMeta+z");
    await expect(edit).toHaveValue("@Deniz Kaya @Deniz Kaya");
    await edit.press("ControlOrMeta+y");
    await expect(edit).toHaveValue("@Deniz Kaya");
    // A delayed paint must not let undo overwrite a later caret movement.
    const deferredFrames = await page.evaluateHandle(() => {
      const requestFrame = window.requestAnimationFrame;
      const cancelFrame = window.cancelAnimationFrame;
      const callbacks = new Map<number, FrameRequestCallback>();
      let nextId = 0;
      window.requestAnimationFrame = (callback) => {
        const id = --nextId;
        callbacks.set(id, callback);
        return id;
      };
      window.cancelAnimationFrame = (id) => {
        if (callbacks.has(id)) callbacks.delete(id);
        else cancelFrame.call(window, id);
      };
      return () => {
        window.requestAnimationFrame = requestFrame;
        window.cancelAnimationFrame = cancelFrame;
        const pending = [...callbacks.values()];
        callbacks.clear();
        pending.forEach((callback) => callback(performance.now()));
      };
    });
    try {
      await edit.press("ControlOrMeta+z");
      await expect(edit).toHaveValue("@Deniz Kaya @Deniz Kaya");
      await edit.press("End");
    } finally {
      await deferredFrames.evaluate((flush) => flush());
      await deferredFrames.dispose();
    }
    expect(
      await edit.evaluate((element: HTMLTextAreaElement) => [
        element.selectionStart,
        element.selectionEnd,
      ]),
    ).toEqual([23, 23]);
    await edit.pressSequentially(" kontrol");
    await article.getByRole("button", { name: "Kaydet", exact: true }).click();
    await expect(article.locator(".message-text")).toHaveText(
      "@Deniz Kaya @Deniz Kaya kontrol",
    );
    expect(
      (await (await page.request.get(`/api/messages/${message.id}`)).json())
        .content,
    ).toBe(`@[${first.data.user.id}] @[${second.data.user.id}] kontrol`);
  } finally {
    await Promise.all(peers.map((peer) => peer.api.dispose()));
  }
});

test("the picker and explicit mention delivery respect a private channel's membership", async ({
  page,
}) => {
  const { peers } = await setup(page);
  const [first, second] = peers;
  try {
    const created = await page.request.post("/api/channels", {
      headers,
      data: {
        name: "bahsetme-ozel",
        kind: "text",
        visibility: "private",
        memberIds: [first.data.user.id],
      },
    });
    expect(created.status()).toBe(201);
    const channel = (await created.json()) as Channel;
    await page.getByRole("button", { name: channel.name, exact: true }).click();
    await page
      .getByRole("button", { name: "Birinden bahset", exact: true })
      .click();
    await page
      .getByRole("searchbox", { name: "Bahsedilecek kişiyi ara" })
      .fill(second.data.user.email);
    await expect(page.locator(".mention-options button")).toHaveCount(0);
    await expect(
      page.getByText("Bu aramayla eşleşen bir üye yok.", { exact: true }),
    ).toBeVisible();
    const response = await page.request.post(
      `/api/channels/${channel.id}/messages`,
      {
        headers,
        data: { content: `@[${first.data.user.id}] @[${second.data.user.id}]` },
      },
    );
    expect(response.status()).toBe(201);
    const message = (await response.json()) as Message;
    await expect.poll(() => mentioned(first.api, message.id)).toBe(true);
    expect(await mentioned(second.api, message.id)).toBe(false);
  } finally {
    await Promise.all(peers.map((peer) => peer.api.dispose()));
  }
});
