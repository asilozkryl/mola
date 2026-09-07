import { expect, test, type APIRequestContext, type Page, type Response } from "@playwright/test";
import { createECDH, randomBytes, randomUUID } from "node:crypto";

declare global {
  interface Window {
    __pushRebind: {
      permissionRequests: number;
      subscriptions: number;
      unsubscriptions: number;
      pending: boolean;
      holdNext: () => void;
      release: () => void;
    };
  }
}

const origin = "http://127.0.0.1:5174";
const password = "push-rebind-browser-password-123";

async function account(request: APIRequestContext, name: string) {
  const email = `push-${randomUUID()}@example.invalid`;
  const response = await request.post("/api/auth/register", {
    headers: { Origin: origin },
    data: { name, email, password, workspaceName: "Push doğrulama ekibi" },
  });
  expect(response.status()).toBe(200);
  const data = await response.json();
  return { email, id: data.user.id as string };
}

async function mockExistingBrowserService(page: Page) {
  const curve = createECDH("prime256v1");
  curve.generateKeys();
  await page.addInitScript(({ endpoint, keys }) => {
    const storageKey = "mola:test-push-rebind";
    const stored = JSON.parse(sessionStorage.getItem(storageKey) || "{}");
    let permission: NotificationPermission = stored.permission || "default";
    let active = Boolean(stored.active);
    let hold = false;
    window.__pushRebind = {
      permissionRequests: stored.permissionRequests || 0,
      subscriptions: stored.subscriptions || 0,
      unsubscriptions: stored.unsubscriptions || 0,
      pending: false,
      holdNext: () => { hold = true; },
      release: () => {},
    };
    const persist = () => sessionStorage.setItem(storageKey, JSON.stringify({
      permission, active,
      permissionRequests: window.__pushRebind.permissionRequests,
      subscriptions: window.__pushRebind.subscriptions,
      unsubscriptions: window.__pushRebind.unsubscriptions,
    }));
    Object.defineProperty(Notification, "permission", { configurable: true, get: () => permission });
    Notification.requestPermission = async () => {
      window.__pushRebind.permissionRequests++;
      permission = "granted";
      persist();
      return permission;
    };
    const subscription = {
      endpoint,
      toJSON: () => ({ endpoint, keys }),
      unsubscribe: async () => {
        active = false;
        window.__pushRebind.unsubscriptions++;
        persist();
        return true;
      },
    } as unknown as PushSubscription;
    PushManager.prototype.getSubscription = async () => {
      if (hold) {
        hold = false;
        window.__pushRebind.pending = true;
        await new Promise<void>((resolve) => { window.__pushRebind.release = resolve; });
        window.__pushRebind.pending = false;
      }
      return active ? subscription : null;
    };
    PushManager.prototype.subscribe = async () => {
      active = true;
      window.__pushRebind.subscriptions++;
      persist();
      return subscription;
    };
  }, {
    endpoint: `https://fcm.googleapis.com/fcm/send/rebind-${randomUUID()}`,
    keys: { p256dh: curve.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") },
  });
}

function restored(response: Response, userId: string) {
  const request = response.request();
  return request.method() === "POST" &&
    response.url().endsWith("/api/notifications/subscriptions") &&
    request.headers()["x-user-id"] === userId && request.postDataJSON()?.restore === true;
}

async function enable(page: Page) {
  await page.getByRole("button", { name: "Bildirimler ve uygulama", exact: true }).click();
  await page.getByRole("button", { name: "Bu cihazda bildirimleri aç", exact: true }).click();
  await expect(page.getByText("Bu cihazda bildirimler açık", { exact: true })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Kapat", exact: true }).click();
}

async function logout(page: Page) {
  await page.getByTitle("Profil ve ayarlar", { exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Çıkış yap", exact: true }).click();
  await expect(page.getByLabel("E-posta adresin", { exact: true })).toBeVisible();
}

async function login(page: Page, email: string) {
  await page.getByLabel("E-posta adresin", { exact: true }).fill(email);
  await page.getByLabel("Parola", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Giriş yap", exact: true }).last().click();
  await expect(page.getByTitle("Profil ve ayarlar", { exact: true })).toBeVisible();
}

test("logout/login and bootstrap restore existing push consent without reopening settings", async ({ page }) => {
  await mockExistingBrowserService(page);
  const member = await account(page.request, "Push sahibi");
  await page.goto("/");
  await enable(page);
  const original = await (await page.request.get("/api/notifications/preferences")).json();
  await logout(page);
  expect((await page.request.get("/api/auth/me")).status()).toBe(401);
  const rebound = page.waitForResponse(response => restored(response, member.id));
  await login(page, member.email);
  expect((await rebound).status()).toBe(201);
  const fresh = await (await page.request.get("/api/notifications/preferences")).json();
  expect(fresh.sessionBinding).not.toBe(original.sessionBinding);
  expect(fresh.pushEnabled).toBe(true);
  await expect(page.getByRole("dialog", { name: "Bildirimler ve uygulama" })).toHaveCount(0);
  const afterReload = page.waitForResponse(response => restored(response, member.id));
  await page.reload();
  expect((await afterReload).status()).toBe(201);
  expect(await page.evaluate(() => ({
    permissionRequests: window.__pushRebind.permissionRequests,
    subscriptions: window.__pushRebind.subscriptions,
    unsubscriptions: window.__pushRebind.unsubscriptions,
  }))).toEqual({ permissionRequests: 1, subscriptions: 1, unsubscriptions: 0 });
});

test("an old account's delayed browser lookup cannot rebind after another account logs in", async ({ page, request }) => {
  await mockExistingBrowserService(page);
  const next = await account(request, "Yeni push hesabı");
  expect((await request.patch("/api/notifications/preferences", {
    headers: { Origin: origin }, data: { pushEnabled: true },
  })).status()).toBe(200);
  const original = await account(page.request, "Önceki push hesabı");
  await page.goto("/");
  await enable(page);
  const oldRestores: string[] = [];
  page.on("request", sent => {
    if (sent.method() === "POST" && sent.url().endsWith("/api/notifications/subscriptions") &&
      sent.headers()["x-user-id"] === original.id && sent.postDataJSON()?.restore)
      oldRestores.push(sent.headers()["x-push-session"]);
  });
  await page.evaluate(() => {
    window.__pushRebind.holdNext();
    window.dispatchEvent(new Event("focus"));
  });
  await expect.poll(() => page.evaluate(() => window.__pushRebind.pending)).toBe(true);
  await logout(page);
  const rebound = page.waitForResponse(response => restored(response, next.id));
  await login(page, next.email);
  expect((await rebound).status()).toBe(201);
  const beforeRelease = oldRestores.length;
  await page.evaluate(() => window.__pushRebind.release());
  await expect.poll(() => page.evaluate(() => window.__pushRebind.pending)).toBe(false);
  expect(oldRestores).toHaveLength(beforeRelease);
  expect((await (await page.request.get("/api/notifications/preferences")).json()).userId).toBe(next.id);
  expect(await page.evaluate(() => ({
    permissionRequests: window.__pushRebind.permissionRequests,
    subscriptions: window.__pushRebind.subscriptions,
    unsubscriptions: window.__pushRebind.unsubscriptions,
  }))).toEqual({ permissionRequests: 1, subscriptions: 1, unsubscriptions: 0 });
});
