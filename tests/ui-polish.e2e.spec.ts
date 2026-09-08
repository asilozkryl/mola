import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { Bootstrap } from "../shared/types";

async function openWorkspace(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: /kanalına mesaj yaz/ }),
  ).toBeVisible();
  await expect(
    page.getByText("Her şey güncel", { exact: true }),
  ).toBeAttached();
}

test("channel details start closed and remember both open and closed preferences", async ({
  page,
}) => {
  await openWorkspace(page);
  const details = page.locator(".details-panel");
  const toggle = page.getByRole("button", {
    name: "Kanal bilgisi",
    exact: true,
  });
  await expect(details).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  await toggle.click();
  await expect(
    details.getByRole("heading", { name: "Kanal hakkında", exact: true }),
  ).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(
    details.getByRole("heading", { name: "Kanal hakkında", exact: true }),
  ).toBeVisible();

  await details
    .getByRole("button", { name: "Kanal bilgisini kapat", exact: true })
    .click();
  await expect(details).toHaveCount(0);
  await page.reload();
  await expect(toggle).toBeVisible();
  await expect(details).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
});

for (const width of [390, 768]) {
  test(`navigation at ${width}px keeps keyboard focus inside until Escape and exposes channel information`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await openWorkspace(page);
    const sidebar = page.locator("#workspace-navigation");
    const trigger = page.locator(
      'button[aria-controls="workspace-navigation"]',
    );
    const composer = page.getByRole("textbox", { name: /kanalına mesaj yaz/ });
    await expect(sidebar).toHaveJSProperty("inert", true);
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await trigger.click();

    await expect(sidebar).toHaveRole("dialog");
    await expect(sidebar).toHaveAttribute("aria-modal", "true");
    await expect(sidebar).toHaveJSProperty("inert", false);
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const first = sidebar.getByRole("button").first();
    const last = sidebar.getByRole("button").last();
    await expect(first).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(last).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(first).toBeFocused();

    // The conversation cannot take focus while navigation covers it.
    await page
      .locator(".conversation-panel textarea")
      .evaluate((element) => (element as HTMLTextAreaElement).focus());
    await expect(first).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(sidebar).toHaveJSProperty("inert", true);
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger).toBeFocused();
    await expect(composer).toBeVisible();

    await page
      .getByRole("button", { name: "Kanal bilgisi", exact: true })
      .click();
    const information = page.getByRole("dialog", { name: /hakkında$/ });
    await expect(information).toBeVisible();
    await expect(
      information.getByRole("button", {
        name: "Kanal erişimi ve üyeler",
        exact: true,
      }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(information).toHaveCount(0);
    await composer.focus();
    await expect(composer).toBeFocused();
  });
}

test("a search opened from mobile navigation returns focus to the visible menu opener when closed", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWorkspace(page);
  const trigger = page.getByRole("button", {
    name: "Gezinmeyi aç",
    exact: true,
  });
  await trigger.click();
  const navigation = page.getByRole("dialog", {
    name: "Çalışma alanı gezinmesi",
    exact: true,
  });
  await navigation
    .getByRole("button", { name: "Çalışma alanında ara", exact: true })
    .click();
  const search = page.getByRole("dialog", {
    name: "Çalışma alanında ara",
    exact: true,
  });
  await expect(search).toBeVisible();
  await expect(
    search.getByRole("textbox", { name: "Mesajlarda ara", exact: true }),
  ).toBeFocused();
  await expect(page.locator("#workspace-navigation")).toHaveJSProperty(
    "inert",
    true,
  );
  await page.keyboard.press("Escape");
  await expect(search).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.press("Enter");
  await expect(navigation).toBeVisible();
});

test("resizing an open tablet drawer to desktop releases the conversation and leaves navigation closed when returning", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 844 });
  await openWorkspace(page);
  const sidebar = page.locator("#workspace-navigation");
  await page.getByRole("button", { name: "Gezinmeyi aç", exact: true }).click();
  await expect(sidebar).toHaveRole("dialog");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(sidebar).not.toHaveAttribute("role", "dialog");
  await expect(sidebar).toHaveJSProperty("inert", false);
  const composer = page.getByRole("textbox", { name: /kanalına mesaj yaz/ });
  await composer.focus();
  await expect(composer).toBeFocused();
  await page.setViewportSize({ width: 768, height: 844 });
  await expect(sidebar).toHaveJSProperty("inert", true);
  await expect(
    page.getByRole("button", { name: "Gezinmeyi aç", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
});

test("channel tabs support arrows, Home and End with a correctly named content panel", async ({
  page,
}) => {
  await openWorkspace(page);
  const tabs = page.getByRole("tablist", {
    name: "Kanal içeriği",
    exact: true,
  });
  const chat = tabs.getByRole("tab", { name: "Sohbet", exact: true });
  const files = tabs.getByRole("tab", { name: "Dosyalar", exact: true });
  const pins = tabs.getByRole("tab", { name: "Sabitlenenler", exact: true });
  await chat.focus();
  for (const [key, target, label] of [
    ["ArrowRight", files, "Dosyalar"],
    ["End", pins, "Sabitlenenler"],
    ["ArrowRight", chat, "Sohbet"],
    ["ArrowLeft", pins, "Sabitlenenler"],
    ["Home", chat, "Sohbet"],
  ] as const) {
    await page.keyboard.press(key);
    await expect(target).toBeFocused();
    await expect(target).toHaveAttribute("aria-selected", "true");
    await expect(tabs.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
    await expect(
      page.getByRole("tabpanel", { name: label, exact: true }),
    ).toBeVisible();
  }
});

test("member search respects a private channel and resets when opening the workspace directory", async ({
  page,
  baseURL,
}) => {
  await openWorkspace(page);
  const response = await page.request.get("/api/auth/me");
  expect(response.ok()).toBe(true);
  const data = (await response.json()) as Bootstrap;
  const others = data.members.filter(
    (member) =>
      member.id !== data.user.id && !member.suspended && !member.isBot,
  );
  expect(others.length).toBeGreaterThanOrEqual(2);
  const [included, excluded] = others;
  const name = `ui-scope-${randomUUID().slice(0, 8)}`;
  const created = await page.request.post("/api/channels", {
    headers: { Origin: new URL(baseURL!).origin },
    data: {
      name,
      kind: "text",
      visibility: "private",
      memberIds: [included.id],
    },
  });
  expect(created.status()).toBe(201);
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Kanal bilgisi", exact: true })
    .click();
  const details = page.locator(".details-panel");
  await expect(details.getByText("2 üye", { exact: true })).toBeVisible();
  await expect(details.getByText("Özel kanal", { exact: true })).toBeVisible();

  await page
    .getByRole("button", { name: "Kanal üyelerini gör", exact: true })
    .click();
  const directory = page.getByRole("dialog", {
    name: "Ekibindeki insanlar",
    exact: true,
  });
  const rows = directory.locator(".members-modal-list > button");
  const search = directory.getByRole("textbox", {
    name: "Ekip arkadaşını ara",
    exact: true,
  });
  await expect(rows).toHaveCount(2);
  await expect(
    directory.getByText(included.name, { exact: true }),
  ).toBeVisible();
  await expect(directory.getByText(excluded.name, { exact: true })).toHaveCount(
    0,
  );
  await search.fill(included.name.toLocaleUpperCase("tr-TR"));
  await expect(rows).toHaveCount(1);
  await expect(
    directory.getByText(included.name, { exact: true }),
  ).toBeVisible();
  await search.fill(excluded.name);
  await expect(rows).toHaveCount(0);
  await expect(directory.getByRole("status")).toContainText(
    "Bu isimle bir kişi bulunamadı",
  );
  await directory
    .getByRole("button", { name: "Kişi aramasını temizle", exact: true })
    .click();
  await expect(rows).toHaveCount(2);
  await search.fill("bulunmayan-kişi");
  await directory.getByRole("button", { name: "Kapat", exact: true }).click();

  await page
    .getByRole("button", { name: "Yeni direkt mesaj", exact: true })
    .click();
  await expect(search).toHaveValue("");
  await expect(
    directory.getByText(excluded.name, { exact: true }),
  ).toBeVisible();
  await expect(rows).toHaveCount(
    data.members.filter((member) => !member.suspended).length,
  );
});
