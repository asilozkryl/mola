import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createECDH, randomBytes } from 'node:crypto';

declare global { interface Window { __pushUi: { permissionRequests: number; subscriptions: number; unsubscriptions: number; installed: number } } }
async function mockPushService(page: Page, denied = false) {
  const curve = createECDH('prime256v1'); curve.generateKeys();
  await page.addInitScript(({ denied, endpoint, keys }) => {
    window.__pushUi = { permissionRequests: 0, subscriptions: 0, unsubscriptions: 0, installed: 0 };
    let permission: NotificationPermission = 'default';
    let active = false;
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => permission });
    Notification.requestPermission = async () => { window.__pushUi.permissionRequests++; permission = denied ? 'denied' : 'granted'; return permission; };
    const subscription = { endpoint, expirationTime: null, options: { userVisibleOnly: true, applicationServerKey: null }, toJSON: () => ({ endpoint, keys }), getKey: () => null, unsubscribe: async () => { active = false; window.__pushUi.unsubscriptions++; return true; } } as unknown as PushSubscription;
    PushManager.prototype.getSubscription = async () => active ? subscription : null;
    PushManager.prototype.subscribe = async () => { active = true; window.__pushUi.subscriptions++; return subscription; };
  }, { denied, endpoint: `https://fcm.googleapis.com/fcm/send/mola-ui-${randomBytes(12).toString('hex')}`, keys: { p256dh: curve.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } });
}
async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Bildirimler ve uygulama', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Bildirimler ve uygulama', exact: true })).toBeVisible();
  await expect(page.getByText('Ayarların yükleniyor…', { exact: true })).toHaveCount(0);
}

test('push permission requires a click, subscription rebinds on reopen and disabling revokes it', async ({ page }) => {
  await mockPushService(page);
  let binds = 0;
  page.on('request', request => { if (request.url().endsWith('/api/notifications/subscriptions') && request.method() === 'POST') binds++; });
  await page.goto('/');
  await openSettings(page);
  expect(await page.evaluate(() => window.__pushUi.permissionRequests)).toBe(0);
  expect(await page.evaluate(() => window.__pushUi.subscriptions)).toBe(0);
  const audit = await new AxeBuilder({ page }).include('.notification-settings').analyze();
  expect(audit.violations.filter(item => item.impact === 'serious' || item.impact === 'critical')).toEqual([]);
  await page.getByRole('button', { name: 'Bu cihazda bildirimleri aç', exact: true }).click();
  await expect(page.getByText('Bu cihazda bildirimler açık', { exact: true })).toBeVisible();
  expect((await (await page.request.get('/api/notifications/preferences')).json()).pushEnabled).toBe(true);
  expect(await page.evaluate(() => window.__pushUi.permissionRequests)).toBe(1);
  expect(await page.evaluate(() => window.__pushUi.subscriptions)).toBe(1);
  await page.screenshot({ path: test.info().outputPath('notifications-desktop.png') });
  await page.getByRole('dialog').getByRole('button', { name: 'Kapat', exact: true }).click();
  await openSettings(page);
  await expect.poll(() => binds).toBe(2);
  expect(await page.evaluate(() => window.__pushUi.subscriptions)).toBe(1);
  const revoked = page.waitForResponse(response => response.url().endsWith('/api/notifications/subscriptions') && response.request().method() === 'DELETE');
  await page.getByRole('button', { name: 'Tüm cihazlarda kapat', exact: true }).click();
  expect((await revoked).status()).toBe(204);
  await expect(page.getByText('Hesabının tarayıcı bildirimleri tüm cihazlarda kapatıldı.', { exact: true })).toBeVisible();
  expect((await (await page.request.get('/api/notifications/preferences')).json()).pushEnabled).toBe(false);
  // The subscription is shared by the origin, so another tab's new session must
  // not be unsubscribed by this delayed settings action. Delivery is disabled in DB.
  expect(await page.evaluate(() => window.__pushUi.unsubscriptions)).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: test.info().outputPath('notifications-mobile.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const mobile = await new AxeBuilder({ page }).include('.notification-settings').analyze();
  expect(mobile.violations.filter(item => item.impact === 'serious' || item.impact === 'critical')).toEqual([]);
});

test('denied notification permission gives actionable help without creating a subscription', async ({ page }) => {
  await mockPushService(page, true);
  await page.goto('/');
  await openSettings(page);
  await page.getByRole('button', { name: 'Bu cihazda bildirimleri aç', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Bildirim izni kapalı');
  expect(await page.evaluate(() => window.__pushUi.subscriptions)).toBe(0);
  expect((await (await page.request.get('/api/notifications/preferences')).json()).pushEnabled).toBe(false);
});

test('public offline fallback never caches authentication or messages', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Çalışma alanı menüsü', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toContain('512x512');
  const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async name => (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname)))).flat());
  expect(cached.sort()).toEqual(['/favicon.svg', '/icons/mola-192.png', '/icons/mola-512.png', '/icons/mola-maskable-512.png', '/manifest.webmanifest', '/offline.html'].sort());
  await context.setOffline(true);
  try {
    await page.goto('/?offline-check=1');
    await expect(page.getByRole('heading', { name: 'Bağlantını bekliyoruz.', exact: true })).toBeVisible();
    expect(await page.evaluate(async () => fetch('/api/auth/me').then(() => false, () => true))).toBe(true);
    await page.screenshot({ path: test.info().outputPath('offline.png') });
  } finally { await context.setOffline(false); }
  await page.getByRole('link', { name: 'Yeniden dene', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Çalışma alanı menüsü', exact: true })).toBeVisible();
});

test('install affordance waits for the browser prompt and only prompts after clicking', async ({ page }) => {
  await mockPushService(page);
  await page.goto('/');
  await openSettings(page);
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt') as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
    event.prompt = async () => { window.__pushUi.installed++; };
    event.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(event);
  });
  await expect(page.getByRole('button', { name: "Mola'yı yükle", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__pushUi.installed)).toBe(0);
  await page.getByRole('button', { name: "Mola'yı yükle", exact: true }).click();
  await expect(page.getByText('Mola cihazına eklendi.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__pushUi.installed)).toBe(1);
});
