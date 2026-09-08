import {
  test,
  expect,
  request,
  type Page,
  type APIRequestContext,
  type Locator,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import type { Attachment, Bootstrap, Channel, Message } from "../shared/types";

const origin = "http://127.0.0.1:5174";
const headers = { Origin: origin };
const password = "direct-conversation-browser-password";
const conversation = (page: Page) => page.locator(".dm-conversation");
const timeline = (page: Page) => conversation(page).locator(".dm-timeline");
const article = (page: Page, id: string) =>
  timeline(page).locator(`article[data-message-id="${id}"]`);
const composer = (page: Page, name: string) =>
  page.getByRole("textbox", {
    name: `${name} kişisine mesaj yaz`,
    exact: true,
  });

async function openDirect(page: Page, peerName: string) {
  const opener = page.getByRole("button", {
    name: "Gezinmeyi aç",
    exact: true,
  });
  if (await opener.isVisible()) await opener.click();
  await page
    .locator("#workspace-navigation")
    .getByRole("button", { name: "Özel mesajlar", exact: true })
    .click();
  await page
    .getByRole("region", { name: "Özel konuşmalar", exact: true })
    .getByRole("button", { name: `${peerName} ile konuşmayı aç`, exact: true })
    .click();
  await expect(conversation(page)).toBeVisible();
  await expect(composer(page, peerName)).toBeVisible();
}

async function setup(page: Page) {
  const registration = await page.request.post("/api/auth/register", {
    headers,
    data: {
      name: "Aslı Sohbet",
      email: `direct-owner-${randomUUID()}@example.invalid`,
      password,
      workspaceName: "Bire Bir Sohbet",
    },
  });
  expect(registration.status()).toBe(200);
  const owner = (await registration.json()) as Bootstrap;
  const invite = await page.request.post("/api/invites", { headers });
  expect(invite.status()).toBe(201);
  const inviteToken = new URL((await invite.json()).url).searchParams.get(
    "invite",
  )!;
  const peerApi = await request.newContext({ baseURL: origin });
  try {
    const joined = await peerApi.post("/api/auth/register", {
      headers,
      data: {
        name: "Selin Kaya",
        email: `direct-peer-${randomUUID()}@example.invalid`,
        password,
        inviteToken,
      },
    });
    expect(joined.status()).toBe(200);
    const peer = (await joined.json()) as Bootstrap;
    const direct = await page.request.post("/api/dms", {
      headers,
      data: { userId: peer.user.id },
    });
    expect(direct.status()).toBe(201);
    const channel = (await direct.json()) as Channel;
    await page.goto("/");
    await expect(
      page.getByRole("textbox", {
        name: "#genel kanalına mesaj yaz",
        exact: true,
      }),
    ).toBeVisible();
    await openDirect(page, peer.user.name);
    return { owner, peer, peerApi, channel };
  } catch (error) {
    await peerApi.dispose();
    throw error;
  }
}

async function postMessage(
  api: APIRequestContext,
  channelId: string,
  content: string,
  attachmentIds: string[] = [],
) {
  const response = await api.post(`/api/channels/${channelId}/messages`, {
    headers,
    data: { content, attachmentIds },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as Message;
}

async function sendMessage(
  page: Page,
  channelId: string,
  name: string,
  content: string,
  touch = false,
) {
  await composer(page, name).fill(content);
  const pending = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith(`/api/channels/${channelId}/messages`),
  );
  const send = conversation(page).getByRole("button", {
    name: "Mesaj gönder",
    exact: true,
  });
  if (touch) await send.tap();
  else await send.click();
  const response = await pending;
  expect(response.status()).toBe(201);
  const message = (await response.json()) as Message;
  await expect(article(page, message.id)).toBeVisible();
  return message;
}

async function contextMenu(page: Page, message: Locator) {
  await message.click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Mesaj işlemleri", exact: true });
  await expect(menu).toBeVisible();
  return menu;
}

async function audit(page: Page) {
  const result = await new AxeBuilder({ page })
    .include(".dm-conversation")
    .analyze();
  expect(
    result.violations
      .filter((item) => item.impact === "serious" || item.impact === "critical")
      .map((item) => ({
        id: item.id,
        nodes: item.nodes.map((node) => node.failureSummary),
      })),
  ).toEqual([]);
}

test("a direct conversation opens the person's profile and preserves its draft on return", async ({
  page,
}) => {
  const { owner, peer, peerApi, channel } = await setup(page);
  try {
    const heading = conversation(page).locator(".direct-conversation-heading");
    await expect(heading.getByRole("heading", { level: 1 })).toHaveText(
      peer.user.name,
    );
    await expect(
      heading.getByRole("button", { name: "Bir araya gel", exact: true }),
    ).toBeVisible();
    await expect(
      heading.getByRole("button", { name: "Kanal üyelerini gör", exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: "artifacts/direct-conversation-empty.png",
      animations: "disabled",
    });
    const draft =
      "Profilden döndüğümde kaldığım yerden yazmaya devam edeceğim.";
    await composer(page, peer.user.name).fill(draft);
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
    const identity = heading.locator(".profile-identity").first();
    await identity.hover();
    const preview = page.getByRole("dialog", {
      name: `${peer.user.name} profil kartı`,
      exact: true,
    });
    await expect(preview).toBeVisible();
    await identity.click();
    const profile = page.getByRole("region", {
      name: "Üye profili",
      exact: true,
    });
    await expect(profile.getByRole("heading", { level: 1 })).toHaveText(
      peer.user.name,
    );
    expect(new URL(page.url()).searchParams.get("profile")).toBe(peer.user.id);
    await profile
      .getByRole("button", { name: "Sohbete dön", exact: true })
      .click();
    await expect(profile).toHaveCount(0);
    await expect(composer(page, peer.user.name)).toHaveValue(draft);
    await heading
      .getByRole("button", { name: "Sohbet bilgisi", exact: true })
      .click();
    const details = page.getByRole("dialog", {
      name: "Sohbet hakkında",
      exact: true,
    });
    await expect(details).toContainText(peer.user.name);
    await expect(details).toContainText(owner.user.name);
    await details.getByRole("button", { name: "Kapat", exact: true }).click();
    await expect(composer(page, peer.user.name)).toHaveValue(draft);
    const sent = await sendMessage(page, channel.id, peer.user.name, draft);
    await expect(article(page, sent.id)).toHaveAttribute("data-self", "true");
    await expect(composer(page, peer.user.name)).toHaveValue("");
    await expect
      .poll(
        async () =>
          (
            await (
              await page.request.get(`/api/channels/${channel.id}/draft`)
            ).json()
          ).content,
      )
      .toBe("");
    await audit(page);
    await page.screenshot({
      path: "artifacts/direct-conversation-profile-return.png",
      animations: "disabled",
    });
  } finally {
    await peerApi.dispose();
  }
});

test("direct message groups keep alignment, reply actions, files and pinned messages usable", async ({
  page,
}) => {
  const { owner, peer, peerApi, channel } = await setup(page);
  try {
    const incoming = await postMessage(
      peerApi,
      channel.id,
      "Son taslağı inceleyelim mi?",
    );
    const first = await postMessage(
      page.request,
      channel.id,
      "Olur, birazdan bakıyorum.",
    );
    const grouped = await postMessage(
      page.request,
      channel.id,
      "Önce akışı tamamlayayım.",
    );
    await expect(article(page, incoming.id)).toHaveAttribute(
      "data-self",
      "false",
    );
    await expect(article(page, incoming.id)).toHaveAttribute(
      "data-grouped",
      "false",
    );
    await expect(article(page, first.id)).toHaveAttribute("data-self", "true");
    await expect(article(page, first.id)).toHaveAttribute(
      "data-grouped",
      "false",
    );
    const groupedItem = article(page, grouped.id);
    await expect(groupedItem).toHaveAttribute("data-grouped", "true");
    await expect(groupedItem).not.toHaveClass(/message-compact/);
    await expect(groupedItem).toHaveAttribute(
      "aria-label",
      new RegExp(owner.user.name),
    );
    await expect(groupedItem.locator("time").first()).toHaveAttribute(
      "datetime",
      grouped.createdAt,
    );
    const incomingBounds = await article(page, incoming.id)
      .locator(".message-body")
      .boundingBox();
    const selfBounds = await article(page, first.id)
      .locator(".message-body")
      .boundingBox();
    expect(selfBounds!.x).toBeGreaterThan(incomingBounds!.x + 20);
    await page.screenshot({
      path: "artifacts/direct-conversation-desktop.png",
      animations: "disabled",
    });
    await (
      await contextMenu(page, groupedItem)
    )
      .getByRole("menuitem", { name: "Mesajı yanıtla", exact: true })
      .click();
    const thread = page.locator(".thread-panel");
    await expect(
      thread.locator(`[data-message-id="${grouped.id}"]`),
    ).toHaveClass(/message-compact/);
    await thread
      .getByRole("textbox", { name: "Yanıtını yaz", exact: true })
      .fill("Gruplanmış mesaja ayrı bir yanıt.");
    await thread
      .getByRole("button", { name: "Yanıt gönder", exact: true })
      .click();
    await expect(
      thread
        .locator(".message-text")
        .filter({ hasText: "Gruplanmış mesaja ayrı bir yanıt." }),
    ).toBeVisible();
    await thread
      .getByRole("button", { name: "Mesaj dizisini kapat", exact: true })
      .click();
    await expect(
      groupedItem.getByRole("button", { name: /1 yanıt/ }),
    ).toBeVisible();
    await (
      await contextMenu(page, groupedItem)
    )
      .getByRole("menuitem", { name: "Kanala sabitle", exact: true })
      .click();
    await expect(groupedItem).toHaveClass(/message-pinned/);
    await expect(groupedItem).toHaveAttribute("data-grouped", "false");
    await conversation(page)
      .getByRole("tab", { name: "Sabitlenenler", exact: true })
      .click();
    await expect(
      conversation(page).locator(
        `[data-message-id="${grouped.id}"] .message-text`,
      ),
    ).toHaveText(grouped.content);
    const upload = await page.request.post("/api/uploads", {
      headers,
      multipart: {
        file: {
          name: "sohbet-kararlari.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("Birlikte aldığımız kararlar."),
        },
      },
    });
    expect(upload.status()).toBe(201);
    const attachment = (await upload.json()) as Attachment;
    await postMessage(page.request, channel.id, "Karar dosyası burada.", [
      attachment.id,
    ]);
    await conversation(page)
      .getByRole("tab", { name: "Dosyalar", exact: true })
      .click();
    const file = conversation(page)
      .locator(".channel-file-list")
      .getByRole("link")
      .filter({ hasText: attachment.name });
    await expect(file).toBeVisible();
    const content = await peerApi.get(attachment.url);
    expect(content.status()).toBe(200);
    expect(await content.text()).toBe("Birlikte aldığımız kararlar.");
    await conversation(page)
      .getByRole("tab", { name: "Sohbet", exact: true })
      .click();
    const reply = await postMessage(
      peerApi,
      channel.id,
      "Dosyayı aldım, teşekkürler.",
    );
    await expect(article(page, reply.id)).toHaveAttribute("data-self", "false");
    await expect(article(page, reply.id)).toHaveAttribute(
      "data-grouped",
      "false",
    );
    await page.reload();
    await openDirect(page, peer.user.name);
    await expect(article(page, grouped.id)).toHaveClass(/message-pinned/);
    await expect(article(page, reply.id).locator(".message-text")).toHaveText(
      reply.content,
    );
  } finally {
    await peerApi.dispose();
  }
});

test("320px direct conversations wrap long text and attachments and respect touch and reduced motion", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: 320, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const state = window as typeof window & {
      directScrollCalls: ScrollBehavior[];
    };
    state.directScrollCalls = [];
    const scroll = Element.prototype.scrollTo;
    Element.prototype.scrollTo = function (
      optionsOrX?: ScrollToOptions | number,
      y?: number,
    ) {
      if (this.classList.contains("message-scroll"))
        state.directScrollCalls.push(
          typeof optionsOrX === "object"
            ? optionsOrX.behavior || "auto"
            : "auto",
        );
      Reflect.apply(
        scroll,
        this,
        typeof optionsOrX === "number" ? [optionsOrX, y || 0] : [optionsOrX],
      );
    };
  });
  let peerApi: APIRequestContext | undefined;
  try {
    const fixture = await setup(page);
    peerApi = fixture.peerApi;
    const { peer, channel } = fixture;
    const filename = `tasarim-raporu-${"uzun-belge-adi-".repeat(10)}.txt`;
    await page.getByLabel("Paylaşılacak dosya", { exact: true }).setInputFiles({
      name: filename,
      mimeType: "text/plain",
      buffer: Buffer.from("Mobilde indirilebilir dosya."),
    });
    await expect(
      conversation(page)
        .locator(".composer-attachments")
        .getByRole("button", {
          name: `${filename} dosyasını kaldır`,
          exact: true,
        }),
    ).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(320);
    await page.evaluate(() => {
      (
        window as typeof window & { directScrollCalls: ScrollBehavior[] }
      ).directScrollCalls = [];
    });
    const longText = `Telefondan gönderilen uzun mesaj. ${"KesintisizMetin".repeat(28)}`;
    const sent = await sendMessage(
      page,
      channel.id,
      peer.user.name,
      longText,
      true,
    );
    await expect(
      article(page, sent.id).getByRole("link", {
        name: new RegExp("dosyasını indir"),
      }),
    ).toBeVisible();
    const incoming = await postMessage(
      peerApi,
      channel.id,
      "Mobilde gelen mesajı da görebiliyorum.",
    );
    await expect(
      article(page, incoming.id).locator(".message-text"),
    ).toHaveText(incoming.content);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as typeof window & { directScrollCalls: ScrollBehavior[] })
              .directScrollCalls.length,
        ),
      )
      .toBeGreaterThan(0);
    expect(
      await page.evaluate(() =>
        (
          window as typeof window & { directScrollCalls: ScrollBehavior[] }
        ).directScrollCalls.every((behavior) => behavior !== "smooth"),
      ),
    ).toBe(true);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(320);
    const sentItem = article(page, sent.id);
    await sentItem
      .getByRole("button", { name: "Diğer mesaj işlemleri", exact: true })
      .tap();
    const menu = sentItem.getByRole("group", {
      name: "Mesaj işlemleri",
      exact: true,
    });
    await expect(
      menu.getByRole("button", { name: "Mesajı yanıtla", exact: true }),
    ).toBeVisible();
    await menu
      .getByRole("button", { name: "Mesajı kaydet", exact: true })
      .tap();
    await sentItem
      .getByRole("button", { name: "Diğer mesaj işlemleri", exact: true })
      .tap();
    await expect(
      menu.getByRole("button", {
        name: "Kaydedilenlerden kaldır",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await audit(page);
    await page.screenshot({
      path: "artifacts/direct-conversation-mobile.png",
      animations: "disabled",
    });
    await conversation(page)
      .getByRole("tab", { name: "Dosyalar", exact: true })
      .tap();
    await expect(
      conversation(page)
        .locator(".channel-file-list")
        .getByRole("link")
        .filter({ hasText: filename }),
    ).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(320);
  } finally {
    await peerApi?.dispose();
    await context.close();
  }
});
