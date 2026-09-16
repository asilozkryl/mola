import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function desktop(page: Page, version = "") {
  await page.addInitScript((desktopVersion: string) => {
    Object.defineProperty(navigator, "userAgent", {
      value: `${navigator.userAgent} Electron/44.3.0${desktopVersion ? ` MolaDesktop/${desktopVersion}` : ""}`,
    });
    let permission: NotificationPermission = "denied";
    const qa = {
      prompts: 0,
      pushes: 0,
      shown: [] as NotificationOptions[],
      sounds: 0,
      allow: true,
      fail: false,
    };
    Object.assign(window, { desktopNotificationQa: qa });
    class NativeNotification extends EventTarget {
      static get permission() {
        return permission;
      }
      static async requestPermission() {
        qa.prompts++;
        return (permission = qa.allow ? "granted" : "denied");
      }
      onshow: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onclick: (() => void) | null = null;
      onclose: (() => void) | null = null;
      constructor(_title: string, options: NotificationOptions = {}) {
        super();
        qa.shown.push(options);
        setTimeout(() => (qa.fail ? this.onerror?.() : this.onshow?.()), 0);
      }
      close() {
        this.onclose?.();
      }
    }
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: NativeNotification,
    });
    PushManager.prototype.subscribe = async () => {
      qa.pushes++;
      throw new Error("Registration failed - push service not available");
    };
    HTMLMediaElement.prototype.play = async function () {
      qa.sounds++;
      setTimeout(() => this.dispatchEvent(new Event("ended")), 0);
    };
  }, version);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Bildirimler ve uygulama", exact: true })
    .click();
}

test("desktop update settings open only the fixed native updater capability", async ({ page }) => {
  await desktop(page, "1.0.6");
  await page.evaluate(() => {
    const requests: string[] = [];
    Object.assign(window, { desktopUpdateRequests: requests });
    window.open = (url) => { requests.push(String(url)); return null; };
  });
  await expect(page.getByText("Yüklü sürüm: 1.0.6", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Güncellemeleri kontrol et", exact: true }).click();
  expect(await page.evaluate(() => (window as any).desktopUpdateRequests)).toEqual(["mola-desktop://app/updates"]);
  await expect(page.getByRole("dialog", { name: "Bildirimler ve uygulama" })).toBeVisible();
});

test("Electron can request initially denied permission without a Web Push subscription", async ({
  page,
}) => {
  let webPreferenceRequests = 0;
  await page.route("**/api/notifications/preferences", (route) => {
    webPreferenceRequests++;
    return route.continue();
  });
  await desktop(page);
  await expect(
    page.getByRole("heading", { name: "Masaüstü bildirimleri", exact: true }),
  ).toBeVisible();
  const enable = page.getByRole("button", {
    name: "Bu cihazda bildirimleri aç",
    exact: true,
  });
  await expect(enable).toBeEnabled();
  await enable.click();
  await expect(page.locator(".notification-device-state")).toHaveAttribute(
    "data-state",
    "enabled",
  );
  await page
    .getByRole("button", { name: "Test bildirimi gönder", exact: true })
    .click();
  await expect(page.locator(".notification-success")).toContainText(
    "sistemine gönderildi",
  );
  const qa = await page.evaluate(() => (window as any).desktopNotificationQa);
  expect(qa.prompts).toBe(1);
  expect(qa.pushes).toBe(0);
  expect(qa.shown).toHaveLength(1);
  expect(qa.shown[0].silent).toBe(true);
  expect(qa.sounds).toBe(1);
  expect(webPreferenceRequests).toBe(0);
  // Audit settled theme colors, not an intermediate CSS transition frame.
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
  for (const width of [1440, 320])
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(
        (theme) =>
          document.documentElement.classList.toggle("dark", theme === "dark"),
        theme,
      );
      const dialog = page.getByRole("dialog", {
        name: "Bildirimler ve uygulama",
      });
      expect(
        await dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      const audit = await new AxeBuilder({ page })
        .include('[role="dialog"][aria-modal="true"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(audit.violations).toEqual([]);
      await page
        .getByRole("heading", { name: "Mola sesi", exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: test
          .info()
          .outputPath(`desktop-notifications-${width}-${theme}.png`),
      });
    }
});

test("desktop quiet mode reports paused delivery and resumes without changing message preferences", async ({
  page,
}) => {
  const errors: string[] = [];
  const policyChanges: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (
      request.method() === "PATCH" &&
      /\/api\/(?:notifications\/settings|channels\/[^/]+\/notification-settings)$/.test(
        new URL(request.url()).pathname,
      )
    )
      policyChanges.push(request.url());
  });
  await page.addInitScript(() => localStorage.setItem("mola:quiet", "true"));
  await desktop(page);
  const deviceState = page.locator(".notification-device-state");
  await page
    .getByRole("button", { name: "Bu cihazda bildirimleri aç", exact: true })
    .click();
  await expect(deviceState).toHaveAttribute("data-state", "paused");
  await expect(deviceState).toContainText("Bildirimler bu cihazda duraklatıldı");
  await expect(deviceState).toContainText("Sessiz mod açık");
  await expect(
    page.getByText("Test bildirimi, mesaj filtrelerini ve sessiz modu atlar.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Test bildirimi gönder", exact: true })
    .click();
  await expect(page.locator(".notification-success")).toContainText(
    "sistemine gönderildi",
  );
  await expect(deviceState).toHaveAttribute("data-state", "paused");
  expect(await page.evaluate(() => localStorage.getItem("mola:quiet"))).toBe(
    "true",
  );
  const resume = page.getByRole("button", {
    name: "Bildirimleri sürdür",
    exact: true,
  });
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await resume.scrollIntoViewIfNeeded();
    const dialog = page.getByRole("dialog", {
      name: "Bildirimler ve uygulama",
      exact: true,
    });
    expect(
      await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: `/tmp/mola-desktop-quiet-${width}.png`,
      animations: "disabled",
    });
  }
  await resume.click();
  await expect(deviceState).toHaveAttribute("data-state", "enabled");
  await expect(deviceState).toContainText("Bu cihazda bildirimler açık");
  await expect(resume).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("mola:quiet"))).toBe(
    "false",
  );
  expect(
    await page.evaluate(() => (window as any).desktopNotificationQa.prompts),
  ).toBe(1);
  expect(policyChanges).toEqual([]);
  expect(errors).toEqual([]);
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
});

test("desktop denial can be retried and local sound can be previewed or silenced", async ({
  page,
}) => {
  await desktop(page);
  await page.evaluate(() => {
    (window as any).desktopNotificationQa.allow = false;
  });
  const enable = page.getByRole("button", {
    name: "Bu cihazda bildirimleri aç",
    exact: true,
  });
  await enable.click();
  await expect(page.getByRole("alert")).toContainText("İzin verilmedi");
  await expect(enable).toBeEnabled();
  await page.evaluate(() => {
    (window as any).desktopNotificationQa.allow = true;
  });
  await enable.click();
  await page.getByRole("button", { name: "Sesi dinle", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).desktopNotificationQa.sounds),
    )
    .toBe(1);
  await page.getByRole("checkbox", { name: "Mola bildirim sesi" }).uncheck();
  await page
    .getByRole("button", { name: "Test bildirimi gönder", exact: true })
    .click();
  await expect(page.locator(".notification-success")).toContainText(
    "sistemine gönderildi",
  );
  expect(
    await page.evaluate(() => (window as any).desktopNotificationQa.sounds),
  ).toBe(1);
  await page
    .getByRole("button", { name: "Bu cihazda kapat", exact: true })
    .click();
  await expect(page.locator(".notification-device-state")).toHaveAttribute(
    "data-state",
    "disabled",
  );
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Bildirimler ve uygulama", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Mola bildirim sesi" }),
  ).not.toBeChecked();
});

test("failed native delivery does not claim that a test notification was sent", async ({
  page,
}) => {
  await desktop(page);
  await page
    .getByRole("button", { name: "Bu cihazda bildirimleri aç", exact: true })
    .click();
  await page.evaluate(() => {
    (window as any).desktopNotificationQa.fail = true;
  });
  await page
    .getByRole("button", { name: "Test bildirimi gönder", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("gönderilemedi");
  await expect(page.locator(".notification-success")).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as any).desktopNotificationQa.sounds),
  ).toBe(0);
});
