import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { Bootstrap, Channel } from "../shared/types";
import type { SidebarPreferencesState } from "../shared/sidebar";

const headers = { Origin: "http://127.0.0.1:5174" };
const sidebar = (page: Page) => page.locator("#workspace-navigation");
const rows = (page: Page, section = "text") =>
  sidebar(page).locator(`[data-order-section="${section}"]`);
const row = (page: Page, id: string, section = "text") =>
  sidebar(page).locator(
    `[data-channel-id="${id}"][data-order-section="${section}"]`,
  );
const ids = (page: Page, section = "text") =>
  rows(page, section).evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-channel-id")),
  );
const preferences = async (page: Page) =>
  (await (
    await page.request.get("/api/sidebar-preferences")
  ).json()) as SidebarPreferencesState;
async function open(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: /kanalına mesaj yaz/ }),
  ).toBeVisible();
  const response = await page.request.get("/api/auth/me");
  expect(response.status()).toBe(200);
  const data = (await response.json()) as Bootstrap;
  if (
    await page
      .getByRole("button", { name: "Gezinmeyi aç", exact: true })
      .isVisible()
  )
    await page
      .getByRole("button", { name: "Gezinmeyi aç", exact: true })
      .click();
  await expect(
    rows(page).first().locator(".channel-drag-handle"),
  ).toBeEnabled();
  return data;
}
async function menu(page: Page, channel: Channel, section = "text") {
  await row(page, channel.id, section)
    .locator(".channel-nav")
    .click({ button: "right" });
  const menu = page.getByRole("menu", {
    name: `${channel.name} kanal işlemleri`,
    exact: true,
  });
  await expect(menu).toBeVisible();
  return menu;
}
async function dragAbove(page: Page, sourceId: string, targetId: string) {
  const source = row(page, sourceId).locator(".channel-drag-handle");
  const target = row(page, targetId);
  await row(page, sourceId).hover();
  await source.dragTo(target, { targetPosition: { x: 80, y: 3 } });
}

test("sidebar favorites and section collapse persist without changing the active conversation", async ({
  page,
}) => {
  const data = await open(page);
  const channel = data.channels.find(
    (item) => item.kind === "text" && item.name !== "genel",
  )!;
  const title = await page.getByRole("heading", { level: 1 }).innerText();
  await (
    await menu(page, channel)
  )
    .getByRole("menuitem", { name: "Favorilere ekle", exact: true })
    .click();
  await expect(row(page, channel.id, "favorites")).toBeVisible();
  await expect
    .poll(async () => (await preferences(page)).preferences.favoriteIds)
    .toEqual([channel.id]);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  const voiceToggle = sidebar(page).getByRole("button", {
    name: "Sesli odalar",
    exact: true,
  });
  await voiceToggle.click();
  await expect(voiceToggle).toHaveAttribute("aria-expanded", "false");
  await expect
    .poll(async () => (await preferences(page)).preferences.collapsedSections)
    .toContain("voice");
  await page.reload();
  await expect(row(page, channel.id, "favorites")).toBeVisible();
  await expect(voiceToggle).toHaveAttribute("aria-expanded", "false");
  await (
    await menu(page, channel, "favorites")
  )
    .getByRole("menuitem", { name: "Favorilerden çıkar", exact: true })
    .click();
  await expect(rows(page, "favorites")).toHaveCount(0);
  await expect(row(page, channel.id)).toBeVisible();
});

test("sidebar supports real dragging, undo and persistent channel order", async ({
  page,
}) => {
  await open(page);
  const original = (await ids(page)) as string[];
  expect(original.length).toBeGreaterThan(2);
  await dragAbove(page, original.at(-1)!, original[0]);
  await expect
    .poll(() => ids(page))
    .toEqual([original.at(-1), ...original.slice(0, -1)]);
  const undo = page.getByRole("button", { name: "Geri al", exact: true });
  await expect(undo).toBeVisible();
  await undo.click();
  await expect.poll(() => ids(page)).toEqual(original);
  await expect
    .poll(async () => (await preferences(page)).preferences.textOrder)
    .toEqual(original);
  await expect(
    rows(page).first().locator(".channel-drag-handle"),
  ).toBeEnabled();
  await dragAbove(page, original.at(-1)!, original[0]);
  const reordered = [original.at(-1)!, ...original.slice(0, -1)];
  await expect
    .poll(async () => (await preferences(page)).preferences.textOrder)
    .toEqual(reordered);
  await page.reload();
  await expect.poll(() => ids(page)).toEqual(reordered);
});

test("sidebar keyboard menu reorders channels and its accessible resizer persists width", async ({
  page,
}) => {
  const data = await open(page);
  const original = (await ids(page)) as string[];
  const channel = data.channels.find((item) => item.id === original[1])!;
  const button = row(page, channel.id).locator(".channel-nav");
  await button.focus();
  await page.keyboard.press("Shift+F10");
  await page
    .getByRole("menuitem", { name: "Yukarı taşı", exact: true })
    .click();
  await expect
    .poll(() => ids(page))
    .toEqual([original[1], original[0], ...original.slice(2)]);
  await expect(button).toBeFocused();
  await expect
    .poll(async () => (await preferences(page)).revision)
    .toBeGreaterThan(0);
  const resizer = page.getByRole("separator", {
    name: "Sol menü genişliği",
    exact: true,
  });
  await resizer.focus();
  await page.keyboard.press("End");
  await expect(resizer).toHaveAttribute("aria-valuenow", "340");
  await expect
    .poll(async () => (await preferences(page)).preferences.width)
    .toBe(340);
  await page.reload();
  await expect(resizer).toHaveAttribute("aria-valuenow", "340");
  await resizer.focus();
  await page.keyboard.press("Home");
  await expect(resizer).toHaveAttribute("aria-valuenow", "240");
  await expect
    .poll(async () => (await preferences(page)).preferences.width)
    .toBe(240);
  await resizer.dblclick();
  await expect(resizer).toHaveAttribute("aria-valuenow", "272");
  await page.screenshot({
    path: "artifacts/sidebar-live-desktop.png",
    animations: "disabled",
  });
});

test("sidebar recent DMs stay empty until a real message or personal draft and follow latest activity", async ({
  page,
}) => {
  const data = await open(page);
  const members = data.members.filter(
    (user) => user.id !== data.user.id && !user.suspended && !user.isBot,
  );
  await expect(sidebar(page).locator(".dm-nav-row")).toHaveCount(0);
  await expect(
    sidebar(page).getByText("Son konuşmaların burada görünecek.", {
      exact: true,
    }),
  ).toBeVisible();
  const first = await page.request.post("/api/dms", {
    headers,
    data: { userId: members[0].id },
  });
  expect(first.status()).toBe(201);
  const firstDm = (await first.json()) as Channel;
  await expect(sidebar(page).locator(".dm-nav-row")).toHaveCount(0);
  const message = await page.request.post(
    `/api/channels/${firstDm.id}/messages`,
    { headers, data: { content: "Son konuşma sırası için gerçek mesaj" } },
  );
  expect(message.status()).toBe(201);
  await expect(sidebar(page).locator(".dm-nav-row")).toHaveCount(1);
  await expect(
    sidebar(page).locator(".dm-nav-row").first().locator(".dm-nav"),
  ).toHaveText(members[0].name);
  const second = await page.request.post("/api/dms", {
    headers,
    data: { userId: members[1].id },
  });
  expect(second.status()).toBe(201);
  const secondDm = (await second.json()) as Channel;
  const draft = await page.request.put(`/api/channels/${secondDm.id}/draft`, {
    headers,
    data: { content: "Henüz gönderilmemiş kişisel taslak", revision: 0 },
  });
  expect(draft.status()).toBe(200);
  await expect(sidebar(page).locator(".dm-nav-row")).toHaveCount(2);
  await expect(
    sidebar(page).locator(".dm-nav-row").first().locator(".dm-nav"),
  ).toContainText(members[1].name);
  await expect(
    sidebar(page)
      .locator(".dm-nav-row")
      .first()
      .getByText("Taslak", { exact: true }),
  ).toBeVisible();
  await sidebar(page).locator(".dm-nav-row").first().locator(".dm-nav").click();
  await expect(page.getByRole("textbox", { name: /mesaj yaz/ })).toHaveValue(
    "Henüz gönderilmemiş kişisel taslak",
  );
  await page.reload();
  await expect(sidebar(page).locator(".dm-nav-row")).toHaveCount(2);
});

test("sidebar filters names and unread channels and clearly restores an empty result", async ({
  page,
}) => {
  const data = await open(page);
  const original = await ids(page);
  const channel = data.channels.find(
    (item) => item.kind === "text" && item.name === "genel",
  )!;
  await sidebar(page)
    .getByRole("button", { name: "Kanal veya kişi bul", exact: true })
    .click();
  const input = sidebar(page).getByRole("textbox", {
    name: "Kanal veya kişi bul",
    exact: true,
  });
  await expect(input).toBeFocused();
  await input.fill(channel.name);
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, channel.id)).toBeVisible();
  await input.fill("olmayan-kanal-qzqzqz");
  await expect(rows(page)).toHaveCount(0);
  await sidebar(page)
    .getByRole("button", {
      name: "Eşleşme yok. Filtreleri temizle",
      exact: true,
    })
    .click();
  await expect.poll(() => ids(page)).toEqual(original);
  await (
    await menu(page, channel)
  )
    .getByRole("menuitem", { name: "Okundu olarak işaretle", exact: true })
    .click();
  await expect(row(page, channel.id).locator(".channel-nav")).toHaveAttribute(
    "data-unread",
    "false",
  );
  await sidebar(page)
    .getByRole("button", { name: "Tüm konuşmalar", exact: true })
    .click();
  await expect(
    sidebar(page).getByRole("button", { name: "Okunmamış", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(row(page, channel.id)).toHaveCount(0);
  await sidebar(page)
    .getByRole("button", { name: "Okunmamış", exact: true })
    .click();
  await expect.poll(() => ids(page)).toEqual(original);
});

test("320px touch sidebar exposes move menus and keeps keyboard focus accessible", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    const data = await open(page);
    const original = (await ids(page)) as string[];
    const channel = data.channels.find((item) => item.id === original[1])!;
    const menuButton = row(page, channel.id).getByRole("button", {
      name: `${channel.name} kanal işlemleri`,
      exact: true,
    });
    await expect(menuButton).toBeVisible();
    const size = await menuButton.boundingBox();
    expect(size!.width).toBeGreaterThanOrEqual(44);
    expect(size!.height).toBeGreaterThanOrEqual(44);
    await menuButton.tap();
    await page
      .getByRole("menuitem", { name: "Yukarı taşı", exact: true })
      .tap();
    await expect
      .poll(() => ids(page))
      .toEqual([original[1], original[0], ...original.slice(2)]);
    await expect(menuButton).toBeFocused();
    await expect
      .poll(async () => (await preferences(page)).revision)
      .toBeGreaterThan(0);
    await menuButton.press("Enter");
    await expect(
      page.getByRole("menuitem", { name: "Aşağı taşı", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menuButton).toBeFocused();
    expect(
      await sidebar(page).evaluate(
        (node) => node.scrollWidth <= node.clientWidth,
      ),
    ).toBe(true);
    const audit = await new AxeBuilder({ page })
      .include("#workspace-navigation")
      .analyze();
    expect(
      audit.violations.filter(
        (item) => item.impact === "serious" || item.impact === "critical",
      ),
    ).toEqual([]);
    await page.screenshot({
      path: "artifacts/sidebar-live-mobile.png",
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Gezinmeyi aç", exact: true }),
    ).toBeFocused();
  } finally {
    await context.close();
  }
});
