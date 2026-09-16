import { test, expect, type Page } from "@playwright/test";
import { parseDesktopReleases } from "../server/desktop-downloads.js";

async function desktop(page: Page, version: string) {
  await page.addInitScript((version) => {
    Object.defineProperty(navigator, "userAgent", {
      value: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Electron/44.3.0${version ? ` MolaDesktop/${version}` : ""}`,
    });
    Object.defineProperty(navigator, "platform", { value: "MacIntel" });
    Object.defineProperty(navigator, "userAgentData", { value: undefined });
    const requests: string[] = [];
    Object.assign(window, { desktopUpdateRequests: requests });
    window.open = (url) => {
      requests.push(String(url));
      return null;
    };
  }, version);
  await page.route("**/api/desktop/releases", (route) =>
    route.fulfill({ json: parseDesktopReleases([]) }),
  );
}

test("native update entries in Help and settings open the updater without leaving the workspace", async ({ page }) => {
  await desktop(page, "1.0.7");
  await page.goto("/");
  await page.getByRole("button", { name: "Kullanım rehberi", exact: true }).click();
  const help = page.getByRole("dialog", { name: "Mola’ya hoş geldin.", exact: true });
  await expect(help).toContainText("İlk geçişte Mola’yı Uygulamalar klasörüne sürüklemen gerekir.");
  await help.getByRole("button", { name: "Güncellemeleri kontrol et", exact: true }).click();
  await expect(help).toBeVisible();
  await expect(help.getByRole("link", { name: "Masaüstü uygulamasını indir →", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Bildirimler ve uygulama", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Bildirimler ve uygulama", exact: true });
  await expect(settings).toContainText("İlk geçişte Mola’yı Uygulamalar klasörüne sürüklemen gerekir.");
  await settings.getByRole("button", { name: "Güncellemeleri kontrol et", exact: true }).click();
  await expect(settings).toBeVisible();
  expect(await page.evaluate(() => (window as any).desktopUpdateRequests)).toEqual([
    "mola-desktop://app/updates",
    "mola-desktop://app/updates",
  ]);
  await expect(page).not.toHaveURL(/\/download/);
});

test("native download page leads back to the updater while retaining other computer installers", async ({ page }) => {
  await desktop(page, "1.0.7");
  await page.goto("/download");
  const note = page.locator(".desktop-download-device-note");
  await expect(note).toContainText("Yüklü sürüm: 1.0.7");
  await expect(note).toContainText("İlk geçişte Mola’yı Uygulamalar klasörüne sürüklemen gerekir.");
  await note.getByRole("button", { name: "Güncellemeleri kontrol et", exact: true }).click();
  expect(await page.evaluate(() => (window as any).desktopUpdateRequests)).toEqual(["mola-desktop://app/updates"]);
  await expect(page.getByRole("heading", { name: "Bilgisayarın için Mola", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/download$/);
});

test("modern Mac update entries no longer request the legacy manual installation step", async ({ page }) => {
  await desktop(page, "1.0.8");
  await page.goto("/");
  await page.getByRole("button", { name: "Kullanım rehberi", exact: true }).click();
  const help = page.getByRole("dialog", { name: "Mola’ya hoş geldin.", exact: true });
  await expect(help).not.toContainText("İlk geçişte");
  await help.getByRole("button", { name: "Güncellemeleri kontrol et", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Bildirimler ve uygulama", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Bildirimler ve uygulama", exact: true });
  await expect(settings).not.toContainText("İlk geçişte");
  await settings.getByRole("button", { name: "Güncellemeleri kontrol et", exact: true }).click();
  expect(await page.evaluate(() => (window as any).desktopUpdateRequests)).toEqual([
    "mola-desktop://app/updates", "mola-desktop://app/updates",
  ]);
  await page.goto("/download");
  const note = page.locator(".desktop-download-device-note");
  await expect(note).not.toContainText("İlk geçişte");
  await note.getByRole("button", { name: "Güncellemeleri kontrol et", exact: true }).click();
  expect(await page.evaluate(() => (window as any).desktopUpdateRequests)).toEqual(["mola-desktop://app/updates"]);
});

test("legacy desktop entries explain the one-time installer step instead of promising an unavailable updater", async ({ page }) => {
  await desktop(page, "");
  await page.goto("/");
  await page.getByRole("button", { name: "Kullanım rehberi", exact: true }).click();
  const help = page.getByRole("dialog", { name: "Mola’ya hoş geldin.", exact: true });
  await expect(help).toContainText("Bu eski sürümde uygulama içinden güncelleme yok.");
  await expect(help.getByRole("link", { name: "İlk güncelleme için kurulum dosyasını indir", exact: true })).toHaveAttribute("href", "/download");
  await expect(help.getByRole("button", { name: "Güncellemeleri kontrol et", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Bildirimler ve uygulama", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Bildirimler ve uygulama", exact: true });
  await expect(settings).toContainText("Bu eski sürümde uygulama içinden güncelleme yok.");
  await expect(settings.getByRole("link", { name: "İlk güncelleme için kurulum dosyasını indir", exact: true })).toHaveAttribute("href", "/download");
  await page.goto("/download");
  await expect(page.locator(".desktop-download-device-note")).toContainText("Bu eski sürümde uygulama içinden güncelleme yok.");
  await expect(page.getByRole("button", { name: "Güncellemeleri kontrol et", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).desktopUpdateRequests)).toEqual([]);
});

test("browser Help keeps the desktop installer entry", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Kullanım rehberi", exact: true }).click();
  const help = page.getByRole("dialog", { name: "Mola’ya hoş geldin.", exact: true });
  await expect(help.getByRole("link", { name: "Masaüstü uygulamasını indir →", exact: true })).toHaveAttribute("href", "/download");
  await expect(help.getByRole("button", { name: "Güncellemeleri kontrol et", exact: true })).toHaveCount(0);
});
