import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import type { Bootstrap } from '../shared/types';

declare global {
  interface Window {
    __workspaceTracks: MediaStreamTrack[];
  }
}

const appOrigin = 'http://127.0.0.1:5174';
const password = 'multi-workspace-browser-test-password';

test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

async function register(page: Page, name: string) {
  const email = `workspaces-${randomUUID()}@example.invalid`;
  const workspaceName = `${name} ${randomUUID().slice(0, 8)}`;
  const response = await page.request.post('/api/auth/register', {
    headers: { Origin: appOrigin },
    data: { name, email, password, workspaceName },
  });
  expect(response.status()).toBe(200);
  const data = await response.json() as Bootstrap;
  await page.goto('/');
  await ready(page);
  return { email, data };
}

async function ready(page: Page) {
  await expect(page.getByRole('textbox', { name: '#genel kanalına mesaj yaz', exact: true })).toBeVisible();
  await expect(page.getByText('Her şey güncel', { exact: true })).toBeVisible();
}

async function snapshot(page: Page): Promise<Bootstrap> {
  const response = await page.request.get('/api/auth/me');
  expect(response.status()).toBe(200);
  return response.json();
}

async function message(page: Page, content: string) {
  await page.getByRole('textbox', { name: '#genel kanalına mesaj yaz', exact: true }).fill(content);
  await page.getByRole('button', { name: 'Mesaj gönder', exact: true }).click();
  await expect(page.locator('p.message-text').filter({ hasText: content })).toBeVisible();
}

async function workspaceDialog(page: Page) {
  await page.getByRole('button', { name: 'Çalışma alanı menüsü', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Çalışma alanlarını değiştir', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Çalışma alanların', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function switchWorkspace(page: Page, name: string) {
  const dialog = await workspaceDialog(page);
  await dialog.getByRole('button', { name: `${name} alanına geç`, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await ready(page);
}

async function invite(page: Page) {
  const response = await page.request.post('/api/invites', { headers: { Origin: appOrigin } });
  expect(response.status()).toBe(201);
  const { url } = await response.json() as { url: string };
  const token = new URL(url).searchParams.get('invite');
  expect(token).toMatch(/^[a-f0-9]{64}$/);
  return { url, token: token! };
}

async function captureResponsive(page: Page, name: string, showSidebar = false) {
  await page.evaluate(() => document.fonts.ready);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: `artifacts/${name}-desktop.png`, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  if (showSidebar) await page.getByRole('button', { name: 'Gezinmeyi aç', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await page.screenshot({ path: `artifacts/${name}-mobile.png`, animations: 'disabled' });
  if (showSidebar) {
    const scrim = page.getByRole('button', { name: 'Gezinmeyi kapat', exact: true });
    const box = (await scrim.boundingBox())!;
    // The drawer covers the scrim's center; click its visible right edge.
    await scrim.click({ position: { x: box.width - 4, y: box.height / 2 } });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

async function accessibleModal(page: Page) {
  // Check the settled surface, not the changing composited colors during entry.
  await page.locator('[role="dialog"][aria-modal="true"]').evaluate(async element => {
    await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {})));
  });
  const result = await new AxeBuilder({ page }).include('[role="dialog"][aria-modal="true"]').analyze();
  expect(result.violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical')
    .map(violation => ({ rule: violation.id, nodes: violation.nodes.map(node => ({ target: node.target, reason: node.failureSummary })) }))).toEqual([]);
}

test('creating and switching workspaces preserves their messages without changing a separate login session', async ({ page, browser }) => {
  const account = await register(page, 'Çalışma Alanı Sahibi');
  const home = account.data.workspace;
  const homeMessage = `İlk alanda kalacak not ${randomUUID()}`;
  const newMessage = `İkinci alanda kalacak not ${randomUUID()}`;
  const newName = `İkinci Ekip ${randomUUID().slice(0, 8)}`;
  await message(page, homeMessage);

  const otherContext = await browser.newContext();
  try {
    const otherSession = await otherContext.newPage();
    // Log in independently: sharing cookies would deliberately share the active workspace.
    const login = await otherSession.request.post('/api/auth/login', {
      headers: { Origin: appOrigin }, data: { email: account.email, password },
    });
    expect(login.status()).toBe(200);
    await otherSession.goto('/');
    await ready(otherSession);
    await expect(otherSession.getByText(homeMessage, { exact: true })).toBeVisible();

    const dialog = await workspaceDialog(page);
    await dialog.getByRole('button', { name: 'Yeni çalışma alanı', exact: true }).click();
    await dialog.getByLabel('Çalışma alanı adı', { exact: true }).fill(newName);
    await accessibleModal(page);
    await captureResponsive(page, 'workspace-create');
    await dialog.getByRole('button', { name: 'Alanı oluştur', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await ready(page);
    const created = await snapshot(page);
    expect(created.user.id).toBe(account.data.user.id);
    expect(created.workspace.name).toBe(newName);
    expect(created.user.role).toBe('owner');
    expect(created.workspaces.map(workspace => workspace.id)).toEqual(expect.arrayContaining([home.id, created.workspace.id]));
    await expect(page.getByText(homeMessage, { exact: true })).toHaveCount(0);
    await message(page, newMessage);

    await otherSession.reload();
    await ready(otherSession);
    expect((await snapshot(otherSession)).workspace.id).toBe(home.id);
    await expect(otherSession.getByText(homeMessage, { exact: true })).toBeVisible();
    await expect(otherSession.getByText(newMessage, { exact: true })).toHaveCount(0);

    const list = await workspaceDialog(page);
    await accessibleModal(page);
    await captureResponsive(page, 'workspace-list');
    await list.getByRole('button', { name: `${home.name} alanına geç`, exact: true }).click();
    await expect(list).toHaveCount(0);
    await ready(page);
    await expect(page.getByText(homeMessage, { exact: true })).toBeVisible();
    await expect(page.getByText(newMessage, { exact: true })).toHaveCount(0);
    await page.getByRole('complementary', { name: 'Çalışma alanları', exact: true })
      .getByRole('button', { name: `${newName} alanına geç`, exact: true }).click();
    await ready(page);
    await expect(page.getByText(newMessage, { exact: true })).toBeVisible();
    await page.reload();
    await ready(page);
    expect((await snapshot(page)).workspace.id).toBe(created.workspace.id);
    await expect(page.getByText(newMessage, { exact: true })).toBeVisible();
    await expect(page.getByText(homeMessage, { exact: true })).toHaveCount(0);
    expect((await snapshot(otherSession)).workspace.id).toBe(home.id);
  } finally { await otherContext.close(); }
});

test('an existing account joins an invitation and restores the correct membership role when switching', async ({ page, browser }) => {
  const owner = await register(page, 'Davet Eden');
  const sharedMessage = `Yeni üyeye açık ekip notu ${randomUUID()}`;
  await message(page, sharedMessage);
  const invitation = await invite(page);
  const guestContext = await browser.newContext();
  try {
    const guest = await guestContext.newPage();
    const existing = await register(guest, 'Mevcut Üye');
    const privateMessage = `Kendi alanımın notu ${randomUUID()}`;
    await message(guest, privateMessage);
    await expect(guest.getByRole('button', { name: 'Yönetim paneli', exact: true }).first()).toBeVisible();

    const dialog = await workspaceDialog(guest);
    await dialog.getByRole('button', { name: 'Davetle katıl', exact: true }).click();
    await dialog.getByLabel('Davet bağlantısı veya kodu', { exact: true }).fill(invitation.url);
    await accessibleModal(guest);
    await captureResponsive(guest, 'workspace-join');
    await dialog.getByRole('button', { name: 'Çalışma alanına katıl', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await ready(guest);
    const joined = await snapshot(guest);
    expect(joined.user.id).toBe(existing.data.user.id);
    expect(joined.workspace.id).toBe(owner.data.workspace.id);
    expect(joined.user.role).toBe('member');
    expect(joined.workspaces.find(workspace => workspace.id === existing.data.workspace.id)?.role).toBe('owner');
    await expect(guest.getByRole('button', { name: 'Yönetim paneli', exact: true })).toHaveCount(0);
    await expect(guest.getByText(sharedMessage, { exact: true })).toBeVisible();
    await expect(guest.getByText(privateMessage, { exact: true })).toHaveCount(0);
    const reply = `Mevcut hesabımla katıldım ${randomUUID()}`;
    await message(guest, reply);
    await expect(page.getByText(reply, { exact: true })).toBeVisible();

    await switchWorkspace(guest, existing.data.workspace.name);
    expect((await snapshot(guest)).user.role).toBe('owner');
    await expect(guest.getByRole('button', { name: 'Yönetim paneli', exact: true }).first()).toBeVisible();
    await expect(guest.getByText(privateMessage, { exact: true })).toBeVisible();
    await expect(guest.getByText(sharedMessage, { exact: true })).toHaveCount(0);
    await switchWorkspace(guest, owner.data.workspace.name);
    await guest.reload();
    await ready(guest);
    expect((await snapshot(guest)).user.role).toBe('member');
    await expect(guest.getByRole('button', { name: 'Yönetim paneli', exact: true })).toHaveCount(0);
    await expect(guest.getByText(reply, { exact: true })).toBeVisible();
  } finally { await guestContext.close(); }
});

test('voice room sidebars show both accounts and update remote microphone and departure state', async ({ browser }) => {
  test.setTimeout(75_000);
  const contexts = await Promise.all([
    browser.newContext({ permissions: ['microphone', 'camera'] }),
    browser.newContext({ permissions: ['microphone', 'camera'] }),
  ]);
  try {
    const [ownerPage, guestPage] = await Promise.all(contexts.map(context => context.newPage()));
    const owner = await register(ownerPage, 'Ses Odası Sahibi');
    const guest = await register(guestPage, 'Ses Odası Konuğu');
    const invitation = await invite(ownerPage);
    const joined = await guestPage.request.post('/api/workspaces/join', {
      headers: { Origin: appOrigin }, data: { inviteToken: invitation.token },
    });
    expect(joined.status()).toBe(200);
    const shared = await joined.json() as Bootstrap;
    const sharedChannel = shared.channels.find(channel => channel.name === 'genel')!;
    // Reloading the old explicit URL would correctly reopen the guest's own team.
    await guestPage.goto(`/?workspace=${shared.workspace.id}&channel=${sharedChannel.id}`);
    await ready(guestPage);
    expect((await snapshot(guestPage)).workspace.id).toBe(owner.data.workspace.id);
    await expect(guestPage.getByRole('button', { name: 'Çalışma alanı menüsü', exact: true })).toContainText(owner.data.workspace.name);
    const voice = owner.data.channels.find(channel => channel.kind === 'voice')!;
    expect(voice).toBeTruthy();
    const ownerRoster = ownerPage.getByRole('list', { name: `${voice.name} katılımcıları`, exact: true });
    const guestRoster = guestPage.getByRole('list', { name: `${voice.name} katılımcıları`, exact: true });

    await ownerPage.getByRole('button', { name: voice.name, exact: true }).click();
    await ownerPage.getByRole('button', { name: 'Görüşmeye katıl', exact: true }).click();
    await expect(ownerPage.getByRole('button', { name: 'Mikrofonu kapat', exact: true })).toBeVisible();
    await ownerPage.getByRole('button', { name: 'Görüşmeyi küçült', exact: true }).click();
    await expect(ownerRoster.getByRole('listitem', { name: owner.data.user.name, exact: true })).toBeVisible();
    await expect(guestRoster.getByRole('listitem', { name: owner.data.user.name, exact: true })).toBeVisible();

    await guestPage.getByRole('button', { name: voice.name, exact: true }).click();
    await guestPage.getByRole('button', { name: 'Görüşmeye katıl', exact: true }).click();
    await expect(guestPage.getByRole('dialog', { name: voice.name, exact: true }).getByText('2 kişi görüşmede')).toBeVisible();
    await guestPage.getByRole('button', { name: 'Görüşmeyi küçült', exact: true }).click();
    for (const roster of [ownerRoster, guestRoster]) {
      await expect(roster.getByRole('listitem')).toHaveCount(2);
      await expect(roster.getByRole('listitem', { name: owner.data.user.name, exact: true })).toBeVisible();
      await expect(roster.getByRole('listitem', { name: guest.data.user.name, exact: true })).toBeVisible();
    }
    await guestPage.getByRole('region', { name: 'Devam eden görüşme', exact: true })
      .getByRole('button', { name: 'Mikrofonu kapat', exact: true }).click();
    const remoteGuest = ownerRoster.getByRole('listitem', { name: guest.data.user.name, exact: true });
    await expect(remoteGuest.getByLabel(`${guest.data.user.name}: mikrofon kapalı`, { exact: true })).toBeVisible();
    await captureResponsive(ownerPage, 'voice-sidebar', true);
    await guestPage.getByRole('region', { name: 'Devam eden görüşme', exact: true })
      .getByRole('button', { name: 'Görüşmeden ayrıl', exact: true }).click();
    await expect(ownerRoster.getByRole('listitem')).toHaveCount(1);
    await expect(ownerRoster.getByRole('listitem', { name: guest.data.user.name, exact: true })).toHaveCount(0);
    await expect(guestRoster.getByRole('listitem')).toHaveCount(1);
    await ownerPage.getByRole('region', { name: 'Devam eden görüşme', exact: true })
      .getByRole('button', { name: 'Görüşmeden ayrıl', exact: true }).click();
    await expect(ownerRoster.getByRole('listitem')).toHaveCount(0);
    await expect(guestRoster.getByRole('listitem')).toHaveCount(0);
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test('an invitation survives signing into an existing account and opens the join form', async ({ page, browser }) => {
  const owner = await register(page, 'Bağlantı Daveti');
  const invitation = await invite(page);
  const context = await browser.newContext();
  try {
    const guest = await context.newPage();
    const account = await register(guest, 'Davetle Giriş');
    await guest.getByTitle('Profil ve ayarlar', { exact: true }).click();
    await guest.getByRole('button', { name: 'Çıkış yap', exact: true }).click();
    await expect(guest.getByLabel('E-posta adresin', { exact: true })).toBeVisible();
    await guest.goto(invitation.url);
    await expect(guest.getByRole('heading', { name: 'Ekibine katıl.', exact: true })).toBeVisible();
    await guest.getByRole('button', { name: 'Giriş yap', exact: true }).first().click();
    await guest.getByLabel('E-posta adresin', { exact: true }).fill(account.email);
    await guest.getByLabel('Parola', { exact: true }).fill(password);
    await guest.getByRole('button', { name: 'Giriş yap', exact: true }).last().click();
    const dialog = guest.getByRole('dialog', { name: 'Çalışma alanların', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Davet bağlantısı veya kodu', { exact: true })).toHaveValue(invitation.token);
    expect((await snapshot(guest)).workspace.id).toBe(account.data.workspace.id);
    await dialog.getByRole('button', { name: 'Çalışma alanına katıl', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await ready(guest);
    const joined = await snapshot(guest);
    expect(joined.user.id).toBe(account.data.user.id);
    expect(joined.workspace.id).toBe(owner.data.workspace.id);
    expect(joined.user.role).toBe('member');
    expect(new URL(guest.url()).searchParams.has('invite')).toBe(false);
  } finally { await context.close(); }
});

test('switching during a voice call asks first, then releases media and updates another tab in the same session', async ({ page }) => {
  await page.addInitScript(() => {
    const state = window;
    state.__workspaceTracks = [];
    const getMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await getMedia(constraints);
      state.__workspaceTracks.push(...stream.getTracks());
      return stream;
    };
  });
  const account = await register(page, 'Sekme ve Görüşme');
  const home = account.data.workspace;
  const response = await page.request.post('/api/workspaces', {
    headers: { Origin: appOrigin }, data: { name: `Sekmelerin İkinci Alanı ${randomUUID().slice(0, 8)}` },
  });
  expect(response.status()).toBe(200);
  const created = await response.json() as Bootstrap;
  const back = await page.request.post(`/api/workspaces/${home.id}/switch`, { headers: { Origin: appOrigin } });
  expect(back.status()).toBe(200);
  await page.reload();
  await ready(page);
  const sibling = await page.context().newPage();
  try {
    await sibling.goto('/');
    await ready(sibling);
    const voice = account.data.channels.find(channel => channel.kind === 'voice')!;
    await page.getByRole('button', { name: voice.name, exact: true }).click();
    await page.getByRole('button', { name: 'Görüşmeye katıl', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Mikrofonu kapat', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Görüşmeyi küçült', exact: true }).click();
    await expect(sibling.getByRole('list', { name: `${voice.name} katılımcıları`, exact: true })
      .getByRole('listitem', { name: account.data.user.name, exact: true })).toBeVisible();

    const rail = page.getByRole('complementary', { name: 'Çalışma alanları', exact: true });
    await rail.getByRole('button', { name: `${created.workspace.name} alanına geç`, exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Çalışma alanların', exact: true });
    await expect(confirmation.getByRole('heading', { name: 'Görüşmeden ayrılıp devam et', exact: true })).toBeVisible();
    expect((await snapshot(page)).workspace.id).toBe(home.id);
    await confirmation.getByRole('button', { name: 'Vazgeç', exact: true }).click();
    await confirmation.getByRole('button', { name: 'Kapat', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Devam eden görüşme', exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__workspaceTracks.some(track => track.readyState === 'live'))).toBe(true);

    await rail.getByRole('button', { name: `${created.workspace.name} alanına geç`, exact: true }).click();
    await confirmation.getByRole('button', { name: 'Görüşmeden ayrıl ve devam et', exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    for (const tab of [page, sibling]) {
      await ready(tab);
      await expect(tab.getByRole('button', { name: 'Çalışma alanı menüsü', exact: true })).toContainText(created.workspace.name);
      await expect(tab.getByRole('region', { name: 'Devam eden görüşme', exact: true })).toHaveCount(0);
      expect((await snapshot(tab)).workspace.id).toBe(created.workspace.id);
      await expect(tab.getByRole('list', { name: `${voice.name} katılımcıları`, exact: true }).getByRole('listitem')).toHaveCount(0);
    }
    await expect.poll(() => page.evaluate(() => {
      const tracks = window.__workspaceTracks;
      return tracks.length > 0 && tracks.every(track => track.readyState === 'ended');
    })).toBe(true);
  } finally { await sibling.close(); }
});
