import { expect, test, type Page } from "@playwright/test";
import { createECDH, randomBytes } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";

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

test("push diagnostic is explicit, retries a request failure and distinguishes provider acceptance from display", async ({
  page,
}) => {
  await mockNotifications(page);
  let failing = true,
    posted = 0,
    polled = 0;
  let workspaceId = "";
  const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
  const result = (state: "queued" | "providerAccepted") => ({
    id,
    workspaceId,
    status: state,
    attempts: state === "queued" ? 0 : 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nextAttemptAt: state === "queued" ? new Date().toISOString() : null,
    reasonCode: null,
  });
  // Browser coverage exercises the API contract; backend coverage injects a fake
  // provider into the real queue. Never send a diagnostic to an external service.
  await page.route("**/api/notifications/push-tests{,/**}", async (route) => {
    if (route.request().method() === "POST") {
      posted++;
      expect(route.request().postDataJSON().endpoint).toContain(
        "mola-settings-",
      );
      const headers = route.request().headers();
      expect(headers["x-user-id"]).toBeTruthy();
      expect(headers["x-push-session"]).toBeTruthy();
      workspaceId = headers["x-workspace-id"];
      expect(workspaceId).toBeTruthy();
      return route.fulfill(
        failing
          ? { status: 503, json: { error: "Test kuyruğuna ulaşılamadı." } }
          : { status: 202, json: result("queued") },
      );
    }
    polled++;
    return route.fulfill({
      json: result(polled > 1 ? "providerAccepted" : "queued"),
    });
  });
  await openSettings(page);
  await enableButton(page).click();
  await expect(status(page)).toHaveAttribute("data-state", "enabled");
  expect(await page.evaluate(() => window.__notificationQa.shown)).toEqual([]);
  expect(posted).toBe(0);
  await page
    .getByRole("button", { name: "Test bildirimi gönder", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Test kuyruğuna ulaşılamadı",
  );
  await expect(status(page)).toHaveAttribute("data-state", "enabled");
  failing = false;
  await page
    .getByRole("button", { name: "Test bildirimi gönder", exact: true })
    .click();
  await expect(page.locator(".notification-diagnostic")).toHaveAttribute(
    "data-state",
    "queued",
  );
  await expect(page.locator(".notification-diagnostic")).toHaveAttribute(
    "data-state",
    "providerAccepted",
  );
  await expect(page.locator(".notification-diagnostic")).toContainText(
    "anlamına gelmez",
  );
  expect(posted).toBe(2);
  expect(await page.evaluate(() => window.__notificationQa.shown)).toEqual([]);
  await page.screenshot({
    path: test.info().outputPath("notification-status-desktop.png"),
  });
  const accessibility = await new AxeBuilder({ page })
    .include('[role="dialog"][aria-modal="true"]')
    .analyze();
  expect(
    accessibility.violations.filter((item) =>
      ["serious", "critical"].includes(item.impact || ""),
    ),
  ).toEqual([]);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.screenshot({
    path: test.info().outputPath("notification-status-mobile.png"),
  });
  await page.locator(".notification-diagnostic").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: test.info().outputPath("notification-diagnostic-mobile.png"),
  });
  expect(
    await page
      .getByRole("dialog", { name: "Bildirimler ve uygulama" })
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  const mobileAccessibility = await new AxeBuilder({ page })
    .include('[role="dialog"][aria-modal="true"]')
    .analyze();
  expect(
    mobileAccessibility.violations.filter((item) =>
      ["serious", "critical"].includes(item.impact || ""),
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Bildirimler ve uygulama" }),
  ).toHaveCount(0);
});

test("closing a queued diagnostic stops status polling", async ({ page }) => {
  await mockNotifications(page);
  let gets = 0;
  await page.route("**/api/notifications/push-tests{,/**}", (route) => {
    if (route.request().method() === "GET") gets++;
    return route.fulfill({
      status: route.request().method() === "POST" ? 202 : 200,
      json: {
        id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        workspaceId: route.request().headers()["x-workspace-id"],
        status: "queued",
        attempts: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        nextAttemptAt: new Date().toISOString(),
        reasonCode: null,
      },
    });
  });
  await openSettings(page);
  await enableButton(page).click();
  await expect(status(page)).toHaveAttribute("data-state", "enabled");
  await page
    .getByRole("button", { name: "Test bildirimi gönder", exact: true })
    .click();
  await expect(page.locator(".notification-diagnostic")).toHaveAttribute(
    "data-state",
    "queued",
  );
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Bildirimler ve uygulama" }),
  ).toHaveCount(0);
  const closedGets = gets;
  await page.waitForTimeout(2200);
  expect(gets).toBe(closedGets);
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
