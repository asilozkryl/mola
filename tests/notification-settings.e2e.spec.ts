import { expect, test, type Page } from "@playwright/test";
import { createECDH, randomBytes } from "node:crypto";

declare global {
  interface Window {
    __notificationQa: {
      permissionRequests: number;
      subscriptions: number;
      shown: Array<{ title: string; options?: NotificationOptions }>;
      setPermission: (value: NotificationPermission) => void;
      setNextPermission: (value: NotificationPermission) => void;
      failTest: boolean;
    };
  }
}

async function mockNotifications(
  page: Page,
  initial: NotificationPermission = "default",
) {
  const curve = createECDH("prime256v1");
  curve.generateKeys();
  await page.addInitScript(
    ({ initial, endpoint, keys }) => {
      let permission = initial;
      let nextPermission: NotificationPermission = "granted";
      let subscribed = false;
      window.__notificationQa = {
        permissionRequests: 0,
        subscriptions: 0,
        shown: [],
        setPermission: (value) => {
          permission = value;
        },
        setNextPermission: (value) => {
          nextPermission = value;
        },
        failTest: false,
      };
      Object.defineProperty(Notification, "permission", {
        configurable: true,
        get: () => permission,
      });
      Notification.requestPermission = async () => {
        window.__notificationQa.permissionRequests++;
        return (permission = nextPermission);
      };
      const subscription = {
        endpoint,
        options: { applicationServerKey: null, userVisibleOnly: true },
        toJSON: () => ({ endpoint, keys }),
      } as unknown as PushSubscription;
      PushManager.prototype.getSubscription = async () =>
        subscribed ? subscription : null;
      PushManager.prototype.subscribe = async () => {
        window.__notificationQa.subscriptions++;
        subscribed = true;
        return subscription;
      };
      ServiceWorkerRegistration.prototype.showNotification = async (
        title,
        options,
      ) => {
        if (window.__notificationQa.failTest)
          throw new Error("Test bildirimi gösterilemedi.");
        window.__notificationQa.shown.push({ title, options });
      };
    },
    {
      initial,
      endpoint: `https://fcm.googleapis.com/fcm/send/mola-settings-${randomBytes(12).toString("hex")}`,
      keys: {
        p256dh: curve.getPublicKey().toString("base64url"),
        auth: randomBytes(16).toString("base64url"),
      },
    },
  );
}

async function openSettings(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Bildirimler ve uygulama", exact: true })
    .click();
  await expect(page.locator(".notification-settings")).toHaveAttribute(
    "aria-busy",
    "false",
  );
}

const enableButton = (page: Page) =>
  page.getByRole("button", { name: "Bu cihazda bildirimleri aç", exact: true });
const status = (page: Page) => page.locator(".notification-device-state");

test("failed settings load can be retried without requesting notification permission", async ({
  page,
}) => {
  await mockNotifications(page);
  let fail = true;
  await page.route("**/api/notifications/preferences", (route) => {
    if (fail && route.request().method() === "GET") {
      return route.fulfill({
        status: 503,
        json: { error: "Bildirim ayarlarına ulaşılamadı." },
      });
    }
    return route.continue();
  });
  await openSettings(page);
  await expect(status(page)).toHaveAttribute("data-state", "error");
  await expect(page.getByRole("alert")).toContainText(
    "Bildirim ayarlarına ulaşılamadı",
  );
  await expect(enableButton(page)).toBeDisabled();
  fail = false;
  await page
    .getByRole("button", { name: "Durumu yenile", exact: true })
    .click();
  await expect(status(page)).toHaveAttribute("data-state", "permission");
  await expect(enableButton(page)).toBeEnabled();
  expect(
    await page.evaluate(() => window.__notificationQa.permissionRequests),
  ).toBe(0);
});

test("blocked permission shows recovery and detects a site-settings change without another prompt", async ({
  page,
}) => {
  await mockNotifications(page, "denied");
  await openSettings(page);
  await expect(status(page)).toHaveAttribute("data-state", "denied");
  await expect(status(page)).toContainText("site ayarlarını aç");
  await expect(enableButton(page)).toBeDisabled();
  await page.evaluate(() => {
    window.__notificationQa.setPermission("granted");
    window.dispatchEvent(new Event("focus"));
  });
  await expect(status(page)).toHaveAttribute("data-state", "disabled");
  await enableButton(page).click();
  await expect(status(page)).toHaveAttribute("data-state", "enabled");
  expect(
    await page.evaluate(() => window.__notificationQa.permissionRequests),
  ).toBe(0);
  expect(await page.evaluate(() => window.__notificationQa.subscriptions)).toBe(
    1,
  );
});

test("dismissing permission leaves the explicit opt-in action available", async ({
  page,
}) => {
  await mockNotifications(page);
  await openSettings(page);
  await page.evaluate(() =>
    window.__notificationQa.setNextPermission("default"),
  );
  await enableButton(page).click();
  await expect(page.getByRole("alert")).toContainText("İzin verilmedi");
  await expect(status(page)).toHaveAttribute("data-state", "permission");
  await expect(enableButton(page)).toBeEnabled();
  expect(await page.evaluate(() => window.__notificationQa.subscriptions)).toBe(
    0,
  );
  await page.evaluate(() =>
    window.__notificationQa.setNextPermission("granted"),
  );
  await enableButton(page).click();
  await expect(status(page)).toHaveAttribute("data-state", "enabled");
  expect(
    await page.evaluate(() => window.__notificationQa.permissionRequests),
  ).toBe(2);
});

test("unavailable server configuration does not ask for browser permission", async ({
  page,
}) => {
  await mockNotifications(page);
  await page.route("**/api/notifications/preferences", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), publicKey: "" },
    });
  });
  await openSettings(page);
  await expect(status(page)).toHaveAttribute("data-state", "unavailable");
  await expect(enableButton(page)).toBeDisabled();
  expect(
    await page.evaluate(() => window.__notificationQa.permissionRequests),
  ).toBe(0);
});

for (const capability of ["insecure", "unsupported", "install"] as const) {
  test(`${capability} environment gives a specific explanation without prompting`, async ({
    page,
  }) => {
    await mockNotifications(page);
    await page.addInitScript((value) => {
      if (value === "insecure")
        Object.defineProperty(window, "isSecureContext", {
          configurable: true,
          value: false,
        });
      else Reflect.deleteProperty(window, "PushManager");
      if (value === "install")
        Object.defineProperty(navigator, "userAgent", {
          configurable: true,
          value: "iPhone",
        });
    }, capability);
    await openSettings(page);
    await expect(status(page)).toHaveAttribute("data-state", capability);
    await expect(enableButton(page)).toBeDisabled();
    expect(
      await page.evaluate(() => window.__notificationQa.permissionRequests),
    ).toBe(0);
  });
}

test("test notification is explicit, contains generic content and can be retried", async ({
  page,
}) => {
  await mockNotifications(page);
  await openSettings(page);
  await enableButton(page).click();
  await expect(status(page)).toHaveAttribute("data-state", "enabled");
  expect(await page.evaluate(() => window.__notificationQa.shown)).toEqual([]);
  await page.evaluate(() => {
    window.__notificationQa.failTest = true;
  });
  await page
    .getByRole("button", { name: "Test bildirimi göster", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Test bildirimi gösterilemedi",
  );
  await expect(status(page)).toHaveAttribute("data-state", "enabled");
  await page.evaluate(() => {
    window.__notificationQa.failTest = false;
  });
  await page
    .getByRole("button", { name: "Test bildirimi göster", exact: true })
    .click();
  await expect(page.locator(".notification-success")).toContainText(
    "Test bildirimi tarayıcıya gönderildi",
  );
  const shown = await page.evaluate(() => window.__notificationQa.shown);
  expect(shown).toHaveLength(1);
  expect(shown[0]).toMatchObject({
    title: "Mola · Test bildirimi",
    options: {
      body: "Bu cihazda bildirim görünümünü test ediyorsun.",
      data: { test: true },
    },
  });
  expect(new URL(shown[0].options!.data.url).search).toBe("");
  await page.screenshot({
    path: test.info().outputPath("notification-status-desktop.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: test.info().outputPath("notification-status-mobile.png"),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("revoked and restored browser consent refreshes an existing endpoint without subscribing again", async ({
  page,
}) => {
  await mockNotifications(page);
  await openSettings(page);
  await enableButton(page).click();
  await expect(status(page)).toHaveAttribute("data-state", "enabled");
  await page.evaluate(() => {
    window.__notificationQa.setPermission("denied");
    window.dispatchEvent(new Event("focus"));
  });
  await expect(status(page)).toHaveAttribute("data-state", "denied");
  await page.evaluate(() => {
    window.__notificationQa.setPermission("granted");
    window.dispatchEvent(new Event("focus"));
  });
  await expect(status(page)).toHaveAttribute("data-state", "enabled");
  expect(
    await page.evaluate(() => window.__notificationQa.permissionRequests),
  ).toBe(1);
  expect(await page.evaluate(() => window.__notificationQa.subscriptions)).toBe(
    1,
  );
});
