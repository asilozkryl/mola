import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function desktop(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", {
      value: `${navigator.userAgent} Electron/44.3.0`,
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
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Bildirimler ve uygulama", exact: true })
    .click();
}

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
