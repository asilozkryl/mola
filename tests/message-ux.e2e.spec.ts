import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { Bootstrap, Message } from "../shared/types";

const origin = "http://127.0.0.1:5174";
const headers = { Origin: origin };

async function account(page: Page) {
  const response = await page.request.post("/api/auth/register", {
    headers,
    data: {
      name: "Deniz Mesaj",
      email: `message-ux-${randomUUID()}@example.invalid`,
      password: "message-ux-browser-password-2026",
      workspaceName: "Mesaj Kullanımı",
    },
  });
  expect(response.status()).toBe(200);
  const data = (await response.json()) as Bootstrap;
  return {
    data,
    channel: data.channels.find((channel) => channel.name === "genel")!,
  };
}

async function send(page: Page, channelId: string, content: string) {
  const response = await page.request.post(
    `/api/channels/${channelId}/messages`,
    {
      headers,
      data: { content },
    },
  );
  expect(response.status()).toBe(201);
  return (await response.json()) as Message;
}

test.describe("touch message actions", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("overflow works without hover and its final action remains reachable near the composer", async ({
    page,
  }) => {
    const { channel } = await account(page);
    for (let index = 0; index < 8; index++) {
      await send(
        page,
        channel.id,
        `Önceki konuşma ${index}\nEkip notları burada.\nBir sonraki adımı birlikte planlayalım.`,
      );
    }
    const message = await send(
      page,
      channel.id,
      "Dokunarak yönetilecek son mesaj",
    );
    await page.goto("/");
    const article = page.locator(`article[data-message-id="${message.id}"]`);
    await expect(article).toBeVisible();
    const trigger = article.getByRole("button", {
      name: "Diğer mesaj işlemleri",
      exact: true,
    });
    const menu = article.getByRole("group", {
      name: "Mesaj işlemleri",
      exact: true,
    });

    // A real touch action must work without the hover state that reveals desktop controls.
    await trigger.tap();
    for (const name of [
      "Mesaj bağlantısını kopyala",
      "Tepki ekle",
      "Mesajı yanıtla",
      "Mesajı kaydet",
    ]) {
      await expect(
        menu.getByRole("button", { name, exact: true }),
      ).toBeEnabled();
    }
    await menu
      .getByRole("button", { name: "Mesajı kaydet", exact: true })
      .tap();
    await trigger.tap();
    await expect(
      menu.getByRole("button", {
        name: "Kaydedilenlerden kaldır",
        exact: true,
      }),
    ).toBeVisible();
    await menu.getByRole("button", { name: "Tepki ekle", exact: true }).tap();
    await article
      .getByRole("button", { name: "👍 tepkisi ekle", exact: true })
      .tap();
    await expect(
      article.getByRole("button", { name: "👍 tepkisi, 1 kişi", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");

    await trigger.tap();
    await menu
      .getByRole("button", { name: "Mesajı yanıtla", exact: true })
      .tap();
    await expect(
      page.getByRole("textbox", { name: "Yanıtını yaz", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Mesaj dizisini kapat", exact: true })
      .tap();

    await trigger.tap();
    // This last menu item previously fell behind the composer at the bottom of the list.
    await menu.getByRole("button", { name: "Mesajı sil", exact: true }).tap();
    const dialog = page.getByRole("dialog", {
      name: "Mesaj silinsin mi?",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Vazgeç", exact: true }).tap();
    await expect(article.locator(".message-text")).toHaveText(message.content);
  });
});

test("failed message edits preserve the draft and keyboard retry persists the change", async ({
  page,
}) => {
  const { channel } = await account(page);
  const message = await send(page, channel.id, "Düzenlenecek tasarım notu");
  await page.goto("/");
  const article = page.locator(`article[data-message-id="${message.id}"]`);
  const trigger = article.getByRole("button", {
    name: "Diğer mesaj işlemleri",
    exact: true,
  });
  await article.hover();
  await trigger.click();
  await expect(
    article.getByRole("button", { name: "Kanala sabitle", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(article.locator(".message-menu")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await article
    .getByRole("button", { name: "Mesajı düzenle", exact: true })
    .click();
  const editor = article.getByRole("textbox", {
    name: "Mesajı düzenle",
    exact: true,
  });
  const updated = "Bağlantı kesilse de korunacak düzenleme";
  await editor.fill(updated);
  let failures = 1;
  await page.route(`**/api/messages/${message.id}`, (route) => {
    if (route.request().method() === "PATCH" && failures-- > 0) {
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Geçici bağlantı hatası" }),
      });
    }
    return route.continue();
  });
  await editor.press("Control+Enter");
  await expect(article.getByRole("alert")).toContainText(
    "Değişiklikler kaydedilemedi",
  );
  await expect(editor).toHaveValue(updated);
  await expect(
    article.getByRole("button", { name: "Kaydet", exact: true }),
  ).toBeEnabled();
  await editor.press("Control+Enter");
  await expect(article.locator(".message-text")).toHaveText(updated);
  await page.reload();
  await expect(article.locator(".message-text")).toHaveText(updated);
});
