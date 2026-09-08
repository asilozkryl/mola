import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { Bootstrap } from "../shared/types";

const origin = "http://127.0.0.1:5174";
const settings = (page: Page) =>
  page.getByRole("dialog", { name: "Kendine ait bir köşe", exact: true });

async function account(page: Page) {
  const response = await page.request.post("/api/auth/register", {
    headers: { Origin: origin },
    data: {
      name: "Profil Testi",
      email: `profile-${randomUUID()}@example.invalid`,
      password: "profile-browser-password-123",
      workspaceName: "Profil ekibi",
    },
  });
  expect(response.status()).toBe(200);
  const data = (await response.json()) as Bootstrap;
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: /kanalına mesaj yaz/ }),
  ).toBeVisible();
  return data;
}

async function openSettings(page: Page) {
  await page
    .getByRole("button", { name: "Profil ayarları", exact: true })
    .click();
  await expect(settings(page)).toBeVisible();
  return settings(page);
}

async function photo() {
  return {
    name: "profil.png",
    mimeType: "image/png",
    buffer: await sharp({
      create: { width: 90, height: 90, channels: 3, background: "#368062" },
    })
      .png()
      .toBuffer(),
  };
}

test("profile details survive a failed save, persist after retry and can be cleared", async ({
  page,
}) => {
  const data = await account(page);
  const dialog = await openSettings(page);
  await dialog.getByLabel("Adın soyadın", { exact: true }).fill("Deniz Kaya");
  await dialog
    .getByLabel("Durumun", { exact: true })
    .fill("Tasarıma odaklandım");
  await dialog.getByLabel("Unvanın", { exact: true }).fill("Ürün tasarımcısı");
  await dialog.getByLabel("Konumun", { exact: true }).fill("İstanbul");
  await dialog
    .getByLabel("Hakkında", { exact: true })
    .fill("Arayüz, erişilebilirlik ve ekip çalışması.\nBirlikte üretiyoruz.");
  let attempts = 0;
  await page.route("**/api/profile", async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    expect(route.request().headers()["x-workspace-id"]).toBe(data.workspace.id);
    expect(route.request().headers()["x-user-id"]).toBe(data.user.id);
    attempts++;
    if (attempts === 1)
      return route.fulfill({
        status: 503,
        json: { error: "Profil şu an kaydedilemedi. Yeniden dene." },
      });
    return route.continue();
  });
  await dialog
    .getByRole("button", { name: "Değişiklikleri kaydet", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("Yeniden dene");
  await expect(dialog.getByLabel("Unvanın", { exact: true })).toHaveValue(
    "Ürün tasarımcısı",
  );
  await expect(dialog.getByLabel("Hakkında", { exact: true })).toHaveValue(
    "Arayüz, erişilebilirlik ve ekip çalışması.\nBirlikte üretiyoruz.",
  );
  await dialog
    .getByRole("button", { name: "Değişiklikleri kaydet", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toHaveText("Profilin güncellendi.");
  await page.reload();
  await openSettings(page);
  await expect(dialog.getByLabel("Adın soyadın", { exact: true })).toHaveValue(
    "Deniz Kaya",
  );
  await expect(dialog.getByLabel("Konumun", { exact: true })).toHaveValue(
    "İstanbul",
  );
  for (const name of ["Durumun", "Unvanın", "Konumun", "Hakkında"])
    await dialog.getByLabel(name, { exact: true }).fill("");
  await dialog
    .getByRole("button", { name: "Değişiklikleri kaydet", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toHaveText("Profilin güncellendi.");
  const current = (await (
    await page.request.get("/api/auth/me")
  ).json()) as Bootstrap;
  for (const field of ["status", "jobTitle", "location", "bio"] as const)
    expect(current.user[field] || "").toBe("");
});

test("photo preview can be cancelled, upload can be retried, and removal persists", async ({
  page,
}) => {
  const data = await account(page);
  const dialog = await openSettings(page);
  const input = dialog.getByLabel("Profil fotoğrafı seç", { exact: true });
  const newPhoto = await photo();
  let uploads = 0;
  await page.route("**/api/profile/avatar", async (route) => {
    expect(route.request().headers()["x-workspace-id"]).toBe(data.workspace.id);
    expect(route.request().headers()["x-user-id"]).toBe(data.user.id);
    if (route.request().method() === "POST" && ++uploads === 1)
      return route.fulfill({
        status: 503,
        json: { error: "Fotoğraf yüklenemedi. Tekrar deneyebilirsin." },
      });
    return route.continue();
  });
  await input.setInputFiles(newPhoto);
  await expect(
    dialog.getByRole("img", { name: "Yeni profil fotoğrafının önizlemesi" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Vazgeç", exact: true }).click();
  await expect(
    dialog.getByRole("img", { name: "Yeni profil fotoğrafının önizlemesi" }),
  ).toHaveCount(0);
  expect(uploads).toBe(0);
  await input.setInputFiles(newPhoto);
  await dialog
    .getByLabel("Unvanın", { exact: true })
    .fill("Kaydedilmemiş unvan");
  await dialog
    .getByRole("button", { name: "Fotoğrafı kaydet", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Tekrar deneyebilirsin",
  );
  await expect(
    dialog.getByRole("img", { name: "Yeni profil fotoğrafının önizlemesi" }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Fotoğrafı kaydet", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toHaveText(
    "Profil fotoğrafın güncellendi.",
  );
  await expect(dialog.getByLabel("Unvanın", { exact: true })).toHaveValue(
    "Kaydedilmemiş unvan",
  );
  await expect(
    dialog.locator(".profile-photo-preview .avatar img"),
  ).toBeVisible();
  const current = (await (
    await page.request.get("/api/auth/me")
  ).json()) as Bootstrap;
  expect(current.user.avatarUrl).toBeTruthy();
  await page.reload();
  await openSettings(page);
  await expect(
    dialog.locator(".profile-photo-preview .avatar img"),
  ).toHaveAttribute("src", current.user.avatarUrl!);
  await dialog
    .getByRole("button", { name: "Fotoğrafı kaldır", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toHaveText(
    "Profil fotoğrafın kaldırıldı.",
  );
  await expect(
    dialog.locator(".profile-photo-preview .avatar img"),
  ).toHaveCount(0);
  await page.reload();
  await openSettings(page);
  await expect(
    dialog.getByRole("button", { name: "Fotoğraf ekle", exact: true }),
  ).toBeVisible();
  expect(uploads).toBe(2);
});

test("photo selection rejects unsupported, oversized and undecodable files before upload", async ({
  page,
}) => {
  await account(page);
  const dialog = await openSettings(page);
  const input = dialog.getByLabel("Profil fotoğrafı seç", { exact: true });
  let uploads = 0;
  page.on("request", (request) => {
    if (
      request.url().endsWith("/api/profile/avatar") &&
      request.method() === "POST"
    )
      uploads++;
  });
  await input.setInputFiles({
    name: "vector.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  });
  await expect(dialog.getByRole("alert")).toContainText("PNG, JPG veya WebP");
  await input.setInputFiles({
    name: "large.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  });
  await expect(dialog.getByRole("alert")).toContainText("en fazla 5 MB");
  await input.setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from("This is not an image"),
  });
  await expect(dialog.getByRole("alert")).toContainText(
    "Bu fotoğraf açılamadı",
  );
  await expect(
    dialog.getByRole("button", { name: "Fotoğrafı kaydet", exact: true }),
  ).toBeDisabled();
  expect(uploads).toBe(0);
  await input.setInputFiles(await photo());
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Fotoğrafı kaydet", exact: true }),
  ).toBeEnabled();
});

for (const width of [320, 390]) {
  test(`profile settings remain usable at ${width}px with accessible labels and visible focus`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await account(page);
    const dialog = await openSettings(page);
    await dialog
      .getByLabel("Profil fotoğrafı seç", { exact: true })
      .setInputFiles(await photo());
    await expect(
      dialog.getByRole("button", { name: "Fotoğrafı kaydet", exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () =>
        dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
      )
      .toBe(true);
    await dialog
      .getByLabel("Hakkında", { exact: true })
      .fill("Mobil profil düzenleme");
    await dialog
      .getByLabel("Unvanın", { exact: true })
      .fill("Ürün tasarımcısı");
    await dialog.getByLabel("Konumun", { exact: true }).fill("İstanbul");
    await dialog
      .getByRole("button", { name: "Değişiklikleri kaydet", exact: true })
      .focus();
    await expect(
      dialog.getByRole("button", {
        name: "Değişiklikleri kaydet",
        exact: true,
      }),
    ).toBeFocused();
    if (width === 390) {
      await dialog.evaluate((element) => {
        element.scrollTop = 0;
      });
      await page.screenshot({
        path: "artifacts/profile-settings-mobile.png",
        animations: "disabled",
      });
      const results = await new AxeBuilder({ page })
        .include("dialog[open]")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(results.violations).toEqual([]);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Profil ayarları", exact: true }),
    ).toBeFocused();
  });
}
