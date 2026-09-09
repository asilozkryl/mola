import { expect, test, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { Bootstrap, Message } from "../shared/types";

const headers = { Origin: "http://127.0.0.1:5174" };

async function messageFixture(
  page: Page,
  content = "Sağ tık ile yönetilen mesaj",
) {
  const account = await page.request.post("/api/auth/register", {
    headers,
    data: {
      name: "Deniz Menü",
      email: `context-${randomUUID()}@example.invalid`,
      password: "context-browser-password-2026",
      workspaceName: "Menü Kullanımı",
    },
  });
  expect(account.status()).toBe(200);
  const data = (await account.json()) as Bootstrap;
  const channel = data.channels.find((entry) => entry.name === "genel")!;
  const response = await page.request.post(
    `/api/channels/${channel.id}/messages`,
    {
      headers,
      data: { content },
    },
  );
  expect(response.status()).toBe(201);
  const message = (await response.json()) as Message;
  await page.goto("/");
  const article = page.locator(`article[data-message-id="${message.id}"]`);
  await expect(article).toBeVisible();
  return { article, message, channel };
}

async function openMessageMenu(page: Page, article: Locator) {
  await article.locator(".message-text").click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Mesaj işlemleri", exact: true });
  await expect(menu).toBeVisible();
  return menu;
}

test("message right-click exposes working copy, save, react, pin, reply, edit and delete actions", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const { article, message } = await messageFixture(page);
  let menu = await openMessageMenu(page, article);
  await expect(menu.getByRole("menuitem")).toHaveCount(7);
  await menu
    .getByRole("menuitem", { name: "Mesaj bağlantısını kopyala" })
    .click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain(message.id);

  menu = await openMessageMenu(page, article);
  await menu
    .getByRole("menuitem", { name: "Mesajı kaydet", exact: true })
    .click();
  menu = await openMessageMenu(page, article);
  await expect(
    menu.getByRole("menuitem", {
      name: "Kaydedilenlerden kaldır",
      exact: true,
    }),
  ).toBeVisible();
  await menu.getByRole("menuitem", { name: "Tepki ekle", exact: true }).click();
  await article
    .getByRole("button", { name: "👍 tepkisi ekle", exact: true })
    .click();
  await expect(
    article.getByRole("button", { name: "👍 tepkisi, 1 kişi", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  menu = await openMessageMenu(page, article);
  await menu
    .getByRole("menuitem", { name: "Kanala sabitle", exact: true })
    .click();
  await expect(article.locator(".message-pin-label")).toBeVisible();
  menu = await openMessageMenu(page, article);
  await expect(
    menu.getByRole("menuitem", { name: "Sabitlemeyi kaldır", exact: true }),
  ).toBeVisible();
  await menu
    .getByRole("menuitem", { name: "Mesajı yanıtla", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Yanıtını yaz", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Mesaj dizisini kapat", exact: true })
    .click();

  menu = await openMessageMenu(page, article);
  await menu
    .getByRole("menuitem", { name: "Mesajı düzenle", exact: true })
    .click();
  const editor = article.getByRole("textbox", {
    name: "Mesajı düzenle",
    exact: true,
  });
  await expect(editor).toBeFocused();
  await editor.fill("Sağ tık menüsünden güncellendi");
  await editor.press("Control+Enter");
  await expect(article.locator(".message-text")).toHaveText(
    "Sağ tık menüsünden güncellendi",
  );

  menu = await openMessageMenu(page, article);
  await menu.getByRole("menuitem", { name: "Mesajı sil", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Mesaj silinsin mi?",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Vazgeç", exact: true }).click();
  await expect(article).toBeVisible();
  menu = await openMessageMenu(page, article);
  await menu.getByRole("menuitem", { name: "Mesajı sil", exact: true }).click();
  await dialog.getByRole("button", { name: "Mesajı sil", exact: true }).click();
  await expect(article).toHaveCount(0);
});

test("message context menu supports keyboard navigation, dismissal and focus restoration", async ({
  page,
}) => {
  const { article } = await messageFixture(page);
  await article.focus();
  await article.press("Shift+F10");
  const menu = page.getByRole("menu", { name: "Mesaj işlemleri", exact: true });
  const first = menu.getByRole("menuitem", {
    name: "Mesaj bağlantısını kopyala",
  });
  await expect(first).toBeFocused();
  await page.keyboard.press("End");
  await expect(
    menu.getByRole("menuitem", { name: "Mesajı sil", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(first).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    menu.getByRole("menuitem", { name: "Mesajı yanıtla", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Home");
  await expect(first).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(article).toBeFocused();
  await article.press("ContextMenu");
  await expect(menu).toBeVisible();
  await page.locator(".topbar").click({ position: { x: 8, y: 8 } });
  await expect(menu).toHaveCount(0);
});

test("message menus fit the viewport, survive unrelated scrolling and close when their anchor moves", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 540 });
  const { article } = await messageFixture(
    page,
    "Menü ekrana sığar.\n".repeat(10),
  );
  // Give the real navigation pane enough content to scroll independently of
  // the conversation. No synthetic scroll event can prove either behavior.
  for (let index = 0; index < 14; index++) {
    const response = await page.request.post("/api/channels", {
      headers,
      data: { name: `kaydirma-kanali-${index}`, kind: "text" },
    });
    expect(response.status()).toBe(201);
  }
  await page.reload();
  await expect(article).toBeVisible();
  const bounds = await article.boundingBox();
  expect(bounds).not.toBeNull();
  await article.click({
    button: "right",
    position: { x: bounds!.width - 8, y: bounds!.height - 8 },
  });
  const menu = page.getByRole("menu", { name: "Mesaj işlemleri", exact: true });
  await expect(menu).toBeVisible();
  const fits = () =>
    menu.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return (
        box.left >= 8 &&
        box.top >= 8 &&
        box.right <= innerWidth - 8 &&
        box.bottom <= innerHeight - 8
      );
    });
  await expect.poll(fits).toBe(true);
  await page.setViewportSize({ width: 900, height: 450 });
  await expect.poll(fits).toBe(true);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  const navigation = page.locator("#workspace-navigation .sidebar-content");
  const conversation = page.locator(".conversation-panel .message-scroll");
  await expect
    .poll(() =>
      navigation.evaluate(
        (element) => element.scrollHeight - element.clientHeight,
      ),
    )
    .toBeGreaterThan(80);
  await navigation.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect
    .poll(() => navigation.evaluate((element) => element.scrollTop))
    .toBe(0);
  await openMessageMenu(page, article);
  const anchorBefore = (await article.boundingBox())!;
  await navigation.evaluate(
    (element) =>
      new Promise<void>((resolve) => {
        element.addEventListener("scroll", () => resolve(), { once: true });
        element.scrollTop = 80;
      }),
  );
  await expect
    .poll(() => navigation.evaluate((element) => element.scrollTop))
    .toBe(80);
  const anchorAfter = (await article.boundingBox())!;
  expect(anchorAfter.x).toBe(anchorBefore.x);
  expect(anchorAfter.y).toBe(anchorBefore.y);
  await expect(menu).toBeVisible();
  await expect.poll(fits).toBe(true);

  const scrollBefore = await conversation.evaluate(
    (element) => element.scrollTop,
  );
  expect(scrollBefore).toBeGreaterThan(0);
  await conversation.evaluate(
    (element) =>
      new Promise<void>((resolve) => {
        element.addEventListener("scroll", () => resolve(), { once: true });
        element.scrollTop = Math.max(0, element.scrollTop - 80);
      }),
  );
  await expect
    .poll(() => conversation.evaluate((element) => element.scrollTop))
    .toBeLessThan(scrollBefore);
  await expect
    .poll(async () =>
      Math.abs((await article.boundingBox())!.y - anchorAfter.y),
    )
    .toBeGreaterThan(1);
  await expect(menu).toHaveCount(0);
});

test("links and message editors keep their browser context menu", async ({
  page,
}) => {
  const { article } = await messageFixture(
    page,
    "Bir kaynak: https://example.com/rehber",
  );
  await page.evaluate(() => {
    document.addEventListener("contextmenu", (event) => {
      document.body.dataset.nativeContextAllowed = String(
        !event.defaultPrevented,
      );
    });
  });
  await article
    .getByRole("link", { name: "https://example.com/rehber" })
    .click({ button: "right" });
  await expect(
    page.getByRole("menu", { name: "Mesaj işlemleri", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("body")).toHaveAttribute(
    "data-native-context-allowed",
    "true",
  );
  await page.keyboard.press("Escape");
  await article.focus();
  await article.press("Shift+F10");
  await page
    .getByRole("menuitem", { name: "Mesajı düzenle", exact: true })
    .click();
  const editor = article.getByRole("textbox", {
    name: "Mesajı düzenle",
    exact: true,
  });
  await page
    .locator("body")
    .evaluate((element) => delete element.dataset.nativeContextAllowed);
  await editor.click({ button: "right" });
  await expect(
    page.getByRole("menu", { name: "Mesaj işlemleri", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("body")).toHaveAttribute(
    "data-native-context-allowed",
    "true",
  );
  await expect(editor).toHaveValue("Bir kaynak: https://example.com/rehber");
});
