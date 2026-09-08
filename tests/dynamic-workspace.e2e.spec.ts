import { expect, test, type Browser, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { Bootstrap, Channel, Message } from "../shared/types";

const origin = "http://127.0.0.1:5174";
const headers = { Origin: origin };

async function register(page: Page, name: string, inviteToken?: string) {
  const response = await page.request.post("/api/auth/register", {
    headers,
    data: {
      name,
      email: `dynamic-${randomUUID()}@example.invalid`,
      password: "dynamic-workspace-password-2026",
      workspaceName: "Canlı Tasarım Ekibi",
      ...(inviteToken ? { inviteToken } : {}),
    },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as Bootstrap;
}

async function open(page: Page) {
  await page.goto("/");
  await expect(page.locator(".channel-tab-end")).toHaveAttribute(
    "data-connected",
    "true",
  );
  await expect(
    page.getByRole("textbox", { name: /kanalına mesaj yaz/ }),
  ).toBeVisible();
}

async function send(page: Page, content: string) {
  const response = page.waitForResponse(
    (entry) =>
      entry.request().method() === "POST" &&
      /\/api\/channels\/[^/]+\/messages$/.test(entry.url()),
  );
  await page.getByRole("textbox", { name: /kanalına mesaj yaz/ }).fill(content);
  await page.getByRole("button", { name: "Mesaj gönder", exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(201);
  return (await result.json()) as Message;
}

async function fixture(
  owner: Page,
  browser: Browser,
  historyCount: number,
  run: (context: {
    peer: Page;
    ownerData: Bootstrap;
    peerData: Bootstrap;
    inviteToken: string;
    channel: Channel;
  }) => Promise<void>,
) {
  const ownerData = await register(owner, "Ece Akış");
  const invite = await owner.request.post("/api/invites", { headers });
  expect(invite.status()).toBe(201);
  const inviteToken = new URL((await invite.json()).url).searchParams.get(
    "invite",
  )!;
  const context = await browser.newContext({ baseURL: origin });
  const peer = await context.newPage();
  try {
    const peerData = await register(peer, "Deniz Akış", inviteToken);
    const channel = ownerData.channels.find((entry) => entry.name === "genel")!;
    for (let index = 0; index < historyCount; index += 1) {
      const seeded = await owner.request.post(
        `/api/channels/${channel.id}/messages`,
        {
          headers,
          data: {
            content: `Tasarım notu ${index + 1}: Kullanıcıların okuduğu konuşma yerinde kalmalı.`,
          },
        },
      );
      expect(seeded.status()).toBe(201);
    }
    await open(owner);
    await open(peer);
    await expect(owner.locator(".channel-tab-end")).toHaveText("2 çevrimiçi");
    await run({ peer, ownerData, peerData, inviteToken, channel });
  } finally {
    await context.close();
  }
}

async function readEarlier(page: Page) {
  const scroller = page.locator(".conversation-panel .message-scroll");
  await expect
    .poll(() =>
      scroller.evaluate(
        (element) => element.scrollHeight - element.clientHeight,
      ),
    )
    .toBeGreaterThan(600);
  await scroller.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(page.locator(".latest-message-bar button")).toBeVisible();
  return scroller;
}

test("live messages preserve reading position, count unseen arrivals and clear on read or channel change", async ({
  page,
  browser,
}) => {
  await fixture(page, browser, 32, async ({ peer }) => {
    const created = await page.request.post("/api/channels", {
      headers,
      data: { name: "akış-kontrol", kind: "text" },
    });
    expect(created.status()).toBe(201);
    const scroller = await readEarlier(page);
    const originalTop = await scroller.evaluate((element) => element.scrollTop);
    const first = await send(peer, "Canlı gelen ilk tasarım kararı");
    const firstArticle = page.locator(`article[data-message-id="${first.id}"]`);
    await expect(firstArticle).toHaveAttribute("data-fresh", "true");
    await expect(page.locator(".new-message-count")).toHaveText("1 yeni mesaj");
    await send(peer, "Canlı gelen ikinci tasarım kararı");
    await expect(page.locator(".new-message-count")).toHaveText("2 yeni mesaj");
    expect(await scroller.evaluate((element) => element.scrollTop)).toBeCloseTo(
      originalTop,
      0,
    );

    // A removed message no longer contributes to unread arrivals.
    const deleted = await peer.request.delete(`/api/messages/${first.id}`, {
      headers,
    });
    expect(deleted.status()).toBe(204);
    await expect(firstArticle).toHaveCount(0);
    await expect(page.locator(".new-message-count")).toHaveText("1 yeni mesaj");
    await page.locator(".latest-message-bar button").click();
    await expect(page.locator(".latest-message-bar")).toHaveCount(0);
    await expect
      .poll(() =>
        scroller.evaluate(
          (element) =>
            element.scrollHeight - element.scrollTop - element.clientHeight,
        ),
      )
      .toBeLessThan(3);

    await readEarlier(page);
    await send(peer, "Kanal değişmeden önceki son yeni mesaj");
    await expect(page.locator(".new-message-count")).toHaveText("1 yeni mesaj");
    await page
      .getByRole("button", { name: "akış-kontrol", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "akış-kontrol", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".latest-message-bar")).toHaveCount(0);
    await page
      .locator(".channel-nav")
      .filter({ has: page.getByText("genel", { exact: true }) })
      .click();
    await expect(
      page.getByText("Kanal değişmeden önceki son yeni mesaj", { exact: true }),
    ).toBeAttached();
    await expect(page.locator(".new-message-count")).toHaveCount(0);
    await expect(page.locator('article[data-fresh="true"]')).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByText("Kanal değişmeden önceki son yeni mesaj", { exact: true }),
    ).toBeAttached();
    await expect(page.locator('article[data-fresh="true"]')).toHaveCount(0);
    await expect(page.locator(".new-message-count")).toHaveCount(0);
  });
});

test("live presence respects private and direct conversation membership and reconnects honestly", async ({
  page,
  browser,
}) => {
  await fixture(page, browser, 0, async ({ peer, peerData, inviteToken }) => {
    const thirdContext = await browser.newContext({ baseURL: origin });
    try {
      const third = await thirdContext.newPage();
      await register(third, "Ada Akış", inviteToken);
      await open(third);
      const status = page.locator(".channel-tab-end");
      await expect(status).toHaveText("3 çevrimiçi");
      const privateChannel = await page.request.post("/api/channels", {
        headers,
        data: {
          name: "özel-akış",
          kind: "text",
          visibility: "private",
          memberIds: [peerData.user.id],
        },
      });
      expect(privateChannel.status()).toBe(201);
      await page
        .getByRole("button", { name: "özel-akış", exact: true })
        .click();
      await expect(status).toHaveText("2 çevrimiçi");
      await expect(
        third.getByRole("button", { name: "özel-akış", exact: true }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: "Yeni direkt mesaj", exact: true }).click();
      await page.getByRole("button", { name: "Deniz Akış ile mesajlaş", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Deniz Akış", exact: true }),
      ).toBeVisible();
      await expect(status).toHaveText("2 çevrimiçi");
      await peer.getByRole("button", { name: "Yeni direkt mesaj", exact: true }).click();
      await peer.getByRole("button", { name: "Ece Akış ile mesajlaş", exact: true }).click();
      await peer
        .getByRole("textbox", { name: /kanalına mesaj yaz/ })
        .fill("Birazdan paylaşacağım");
      await expect(page.locator(".typing-indicator")).toContainText(
        "Deniz yazıyor",
      );

      await page.context().setOffline(true);
      await expect(status).toHaveAttribute("data-connected", "false");
      await expect(status).toHaveText("Bağlantı bekleniyor");
      await expect(page.locator(".connection-banner")).toBeVisible();
      await expect(page.locator(".presence-dot")).toHaveCount(0);
      await expect(page.locator(".typing-indicator")).toBeEmpty();
      await peer.getByRole("textbox", { name: /kanalına mesaj yaz/ }).fill("");
      await page.context().setOffline(false);
      await expect(status).toHaveAttribute("data-connected", "true");
      await expect(status).toHaveText("2 çevrimiçi");
      await expect(page.locator(".connection-banner")).toHaveCount(0);
      await expect(page.locator(".sidebar-account-profile .presence-dot")).toHaveCount(1);
      await expect(page.locator(".typing-indicator")).toBeEmpty();
    } finally {
      await page.context().setOffline(false);
      await thirdContext.close();
    }
  });
});

test("reduced motion applies to user jumps and incoming and outgoing message scrolling", async ({
  page,
  browser,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Observe the public scrolling API without replacing scrolling behavior.
  await page.addInitScript(() => {
    const state = window as typeof window & {
      messageScrollCalls: ScrollBehavior[];
    };
    state.messageScrollCalls = [];
    const scroll = Element.prototype.scrollTo;
    Element.prototype.scrollTo = function (
      optionsOrX?: ScrollToOptions | number,
      y?: number,
    ) {
      if (this.classList.contains("message-scroll")) {
        state.messageScrollCalls.push(
          typeof optionsOrX === "object"
            ? optionsOrX.behavior || "auto"
            : "auto",
        );
      }
      Reflect.apply(
        scroll,
        this,
        typeof optionsOrX === "number" ? [optionsOrX, y || 0] : [optionsOrX],
      );
    };
  });
  const calls = () =>
    page.evaluate(
      () =>
        (window as typeof window & { messageScrollCalls: ScrollBehavior[] })
          .messageScrollCalls,
    );
  const clearCalls = () =>
    page.evaluate(() => {
      (
        window as typeof window & { messageScrollCalls: ScrollBehavior[] }
      ).messageScrollCalls = [];
    });
  await fixture(page, browser, 32, async ({ peer }) => {
    await readEarlier(page);
    await send(peer, "Azaltılmış harekette gelen mesaj");
    await expect(page.locator(".new-message-count")).toHaveText("1 yeni mesaj");
    await clearCalls();
    await page.locator(".latest-message-bar button").click();
    await expect.poll(calls).toEqual(["auto"]);
    await expect(page.locator(".latest-message-bar")).toHaveCount(0);
    await clearCalls();
    await send(page, "Azaltılmış harekette kendi mesajım");
    await expect.poll(async () => (await calls()).length).toBeGreaterThan(0);
    expect((await calls()).every((behavior) => behavior === "auto")).toBe(true);
    await clearCalls();
    await send(peer, "Sohbetin sonunda gelen başka bir mesaj");
    await expect.poll(async () => (await calls()).length).toBeGreaterThan(0);
    expect((await calls()).every((behavior) => behavior === "auto")).toBe(true);
    await expect(page.locator(".new-message-count")).toHaveCount(0);
  });
});
