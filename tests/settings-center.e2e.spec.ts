import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

async function account(page: Page) {
  const response = await page.request.post("/api/auth/register", {
    headers: { Origin: "http://127.0.0.1:5174" },
    data: {
      name: "Ayar Merkezi",
      email: `settings-center-${randomUUID()}@example.invalid`,
      password: "settings-browser-password-123",
      workspaceName: "Tasarım ekibi",
    },
  });
  expect(response.status()).toBe(200);
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: /kanalına mesaj yaz/ }),
  ).toBeVisible();
}

async function openSettings(page: Page) {
  await page
    .getByRole("button", { name: "Profil ayarları", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Kendine ait bir köşe",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("settings navigation preserves text and photo drafts and guards notification handoff", async ({
  page,
}) => {
  await account(page);
  const dialog = await openSettings(page);
  await dialog.getByLabel("Unvanın", { exact: true }).fill("Ürün tasarımcısı");
  await dialog
    .getByLabel("Profil fotoğrafı seç", { exact: true })
    .setInputFiles({
      name: "profile.png",
      mimeType: "image/png",
      buffer: await sharp({
        create: { width: 64, height: 64, channels: 3, background: "#2d6650" },
      })
        .png()
        .toBuffer(),
    });
  await dialog.getByRole("tab", { name: "Görünüm", exact: true }).click();
  await dialog.getByRole("button", { name: "Koyu", exact: true }).click();
  await dialog.getByRole("tab", { name: "Güvenlik", exact: true }).click();
  await dialog.getByText("Parolanı değiştir", { exact: true }).click();
  await dialog
    .getByLabel("Mevcut parolan", { exact: true })
    .fill("unfinished-password");
  await dialog.getByRole("tab", { name: "Profil", exact: true }).click();
  await expect(dialog.getByLabel("Unvanın", { exact: true })).toHaveValue(
    "Ürün tasarımcısı",
  );
  await expect(
    dialog.getByRole("img", { name: "Yeni profil fotoğrafının önizlemesi" }),
  ).toBeVisible();
  await dialog.getByRole("tab", { name: "Güvenlik", exact: true }).click();
  await expect(
    dialog.getByLabel("Mevcut parolan", { exact: true }),
  ).toHaveValue("unfinished-password");
  await dialog.getByRole("tab", { name: "Bildirimler", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Bildirim tercihlerini aç", exact: true })
    .click();
  const confirmation = page.getByRole("dialog", {
    name: "Kaydedilmemiş değişikliklerin var",
    exact: true,
  });
  await expect(confirmation).toContainText("bildirim tercihlerin açılacak");
  await confirmation
    .getByRole("button", { name: "Düzenlemeye devam et", exact: true })
    .click();
  await expect(confirmation).toHaveCount(0);
  await dialog.getByRole("tab", { name: "Profil", exact: true }).click();
  await expect(dialog.getByLabel("Unvanın", { exact: true })).toHaveValue(
    "Ürün tasarımcısı",
  );
  await dialog.getByRole("tab", { name: "Bildirimler", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Bildirim tercihlerini aç", exact: true })
    .click();
  await confirmation
    .getByRole("button", { name: "Değişiklikleri bırak", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "Bildirimler ve uygulama", exact: true }),
  ).toBeVisible();
  const current = await (await page.request.get("/api/auth/me")).json();
  expect(current.user.jobTitle || "").toBe("");
  expect(current.user.avatarUrl).toBeFalsy();
});

test("appearance choices persist and system theme follows device changes", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await account(page);
  const dialog = await openSettings(page);
  await dialog.getByRole("tab", { name: "Görünüm", exact: true }).click();
  await dialog.getByRole("button", { name: "Koyu", exact: true }).click();
  await dialog.getByRole("button", { name: /^Rahat/ }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator("html")).toHaveAttribute(
    "data-density",
    "comfortable",
  );
  await page.reload();
  await openSettings(page);
  await dialog.getByRole("tab", { name: "Görünüm", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Koyu", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByRole("button", { name: /^Rahat/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await dialog.getByRole("button", { name: "Sistem", exact: true }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  await dialog.getByRole("button", { name: "Açık", exact: true }).click();
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});

for (const width of [390, 1440]) {
  test(`settings categories support keyboard and stay accessible at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await account(page);
    const dialog = await openSettings(page);
    const profile = dialog.getByRole("tab", { name: "Profil", exact: true });
    await profile.focus();
    await page.keyboard.press(width < 680 ? "ArrowRight" : "ArrowDown");
    const appearance = dialog.getByRole("tab", {
      name: "Görünüm",
      exact: true,
    });
    await expect(appearance).toBeFocused();
    await expect(appearance).toHaveAttribute("aria-selected", "true");
    for (const theme of ["Açık", "Koyu"]) {
      await dialog.getByRole("button", { name: theme, exact: true }).click();
      await expect
        .poll(() =>
          dialog.evaluate(
            (element) => element.scrollWidth <= element.clientWidth + 1,
          ),
        )
        .toBe(true);
      const results = await new AxeBuilder({ page })
        .include(".modal:has(> .settings-center)")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(results.violations).toEqual([]);
    }
    await page.screenshot({
      path: `artifacts/settings-center-${width}.png`,
      animations: "disabled",
    });
  });
}
