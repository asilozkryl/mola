import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const appOrigin = 'http://127.0.0.1:5174';
const password = 'admin-browser-password-2026';
async function register(page: Page, name: string, inviteToken?: string) {
  const email = `admin-ui-${randomUUID()}@example.invalid`;
  const response = await page.request.post('/api/auth/register', { headers: { Origin: appOrigin }, data: { name, email, password, workspaceName: 'Yönetim Deneme Ekibi', ...(inviteToken ? { inviteToken } : {}) } });
  expect(response.status()).toBe(200);
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: /kanalına mesaj yaz/ })).toBeVisible();
  await expect(page.getByText('Her şey güncel', { exact: true })).toBeAttached();
  return { email, data: await response.json() };
}
async function panel(page: Page) {
  await page.getByRole('button', { name: 'Yönetim paneli', exact: true }).click();
  const admin = page.getByRole('dialog', { name: 'Yönetim paneli', exact: true });
  await expect(admin.getByRole('heading', { name: 'Üyeler', exact: true })).toBeVisible();
  await expect(admin.getByRole('table')).toBeVisible();
  return admin;
}
async function joinedMember(owner: Page, browser: Browser) {
  const invitation = await owner.request.post('/api/invites', { headers: { Origin: appOrigin } });
  expect(invitation.status()).toBe(201);
  const token = new URL((await invitation.json()).url).searchParams.get('invite')!;
  const context = await browser.newContext({ baseURL: appOrigin });
  const page = await context.newPage();
  const account = await register(page, 'Deniz Yönetim Üyesi', token);
  return { context, page, ...account };
}
async function accessibility(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const result = await new AxeBuilder({ page }).include('.adm-dialog').analyze();
  await test.info().attach('admin-accessibility', { body: JSON.stringify(result.violations, null, 2), contentType: 'application/json' });
  expect(result.violations.filter(item => ['serious', 'critical'].includes(item.impact || '')).map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) }))).toEqual([]);
}

test('workspace owner manages channel lifecycle, workspace name and audit history', async ({ page }) => {
  await register(page, 'Yönetici Aslı');
  const admin = await panel(page);
  await admin.getByRole('button', { name: 'Kanallar', exact: true }).click();
  await admin.getByRole('button', { name: 'Kanal oluştur', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Yeni kanal', exact: true });
  await expect(create).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(create).toHaveCount(0);
  await expect(admin).toBeVisible();
  await admin.getByRole('button', { name: 'Kanal oluştur', exact: true }).click();
  const name = `admin-kanal-${randomUUID().slice(0, 8)}`;
  await create.getByLabel('Kanal adı', { exact: true }).fill(name);
  await create.getByLabel('Kanal açıklaması', { exact: true }).fill('Düzenlenecek açıklama');
  await create.getByRole('button', { name: 'Kanal oluştur', exact: true }).click();
  await expect(admin.locator('.adm-channel').filter({ hasText: name })).toBeVisible();
  await admin.getByRole('button', { name: `Düzenle ${name}`, exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Kanalı düzenle', exact: true });
  const renamed = `${name}-yeni`;
  await edit.getByLabel('Kanal adı', { exact: true }).fill(renamed);
  await edit.getByRole('textbox', { name: 'Kanal açıklaması', exact: true }).fill('Kalıcı kanal açıklaması');
  await edit.getByRole('button', { name: 'Kanalı kaydet', exact: true }).click();
  await expect(admin.locator('.adm-channel').filter({ hasText: renamed })).toContainText('Kalıcı kanal açıklaması');
  const snapshot = await (await page.request.get('/api/admin/workspace')).json();
  const channel = snapshot.channels.find((entry: { name: string }) => entry.name === renamed);
  const sent = await page.request.post(`/api/channels/${channel.id}/messages`, { headers: { Origin: appOrigin }, data: { content: 'Arşivde de korunacak mesaj.' } });
  expect(sent.status()).toBe(201);
  await admin.getByRole('button', { name: `Arşivle ${renamed}`, exact: true }).click();
  await page.getByRole('dialog', { name: 'Kanalı arşivle', exact: true }).getByRole('button', { name: 'Arşivle', exact: true }).click();
  await expect(admin.locator('.adm-channel').filter({ hasText: renamed })).toHaveCount(0);
  await admin.getByRole('button', { name: 'Arşiv', exact: true }).click();
  await expect(admin.locator('.adm-channel').filter({ hasText: renamed })).toBeVisible();
  expect((await (await page.request.get(`/api/channels/${channel.id}/messages`)).json()).messages.some((message: { content: string }) => message.content === 'Arşivde de korunacak mesaj.')).toBe(true);
  await admin.getByRole('button', { name: `Arşivden çıkar ${renamed}`, exact: true }).click();
  await page.getByRole('dialog', { name: 'Kanalı arşivden çıkar', exact: true }).getByRole('button', { name: 'Arşivden çıkar', exact: true }).click();
  await admin.getByRole('button', { name: 'Aktif kanallar', exact: true }).click();
  await expect(admin.locator('.adm-channel').filter({ hasText: renamed })).toBeVisible();
  await admin.getByRole('button', { name: 'Ekip ayarları', exact: true }).click();
  await admin.getByLabel('Çalışma alanının adı', { exact: true }).fill('Yeni Ekip Adı');
  await admin.getByRole('button', { name: 'Değişiklikleri kaydet', exact: true }).click();
  await expect(admin.locator('.adm-workspace')).toContainText('Yeni Ekip Adı');
  await admin.getByRole('button', { name: 'İşlem geçmişi', exact: true }).click();
  await expect(admin.locator('.adm-audit')).toContainText('Kanal arşivlendi');
  await expect(admin.locator('.adm-audit')).toContainText('Çalışma alanı güncellendi');
  await admin.getByRole('button', { name: 'Sohbete dön', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: renamed, exact: true }).click();
  await expect(page.getByText('Arşivde de korunacak mesaj.', { exact: true })).toBeVisible();
});

test('owner can revoke an invitation and the cancelled link cannot admit a new member', async ({ page }) => {
  await register(page, 'Davet Yöneticisi');
  const admin = await panel(page);
  await admin.getByRole('button', { name: 'Davetler', exact: true }).click();
  await admin.getByRole('button', { name: 'Davet oluştur', exact: true }).click();
  const invitation = admin.getByLabel('Yeni davet bağlantısı', { exact: true });
  await expect(invitation).toHaveValue(/invite=/);
  const token = new URL(await invitation.inputValue()).searchParams.get('invite')!;
  await admin.getByRole('button', { name: 'İptal et', exact: true }).click();
  await page.getByRole('dialog', { name: 'Daveti iptal et', exact: true }).getByRole('button', { name: 'Daveti iptal et', exact: true }).click();
  await expect(admin.getByRole('cell', { name: 'İptal edildi', exact: true })).toBeVisible();
  const blocked = await page.request.post('/api/auth/register', { headers: { Origin: appOrigin }, data: { name: 'Katılamayan kişi', email: `revoked-${randomUUID()}@example.invalid`, password, inviteToken: token } });
  expect(blocked.status()).toBe(400);
});

test('member suspension signs out their active browser and preserves existing conversation history', async ({ page, browser }) => {
  await register(page, 'Erişim Yöneticisi');
  const member = await joinedMember(page, browser);
  try {
    await expect(member.page.getByRole('button', { name: 'Yönetim paneli', exact: true })).toHaveCount(0);
    expect((await member.page.request.get('/api/admin/workspace')).status()).toBe(403);
    const content = `Korunacak üye mesajı ${Date.now()}`;
    await member.page.getByRole('textbox', { name: /kanalına mesaj yaz/ }).fill(content);
    await member.page.getByRole('button', { name: 'Mesaj gönder', exact: true }).click();
    await expect(member.page.locator('p.message-text').filter({ hasText: content })).toBeVisible();
    const admin = await panel(page);
    const row = admin.getByRole('row').filter({ hasText: member.email });
    await row.getByRole('button', { name: 'Askıya al', exact: true }).click();
    await page.getByRole('dialog', { name: 'Üyeyi askıya al', exact: true }).getByRole('button', { name: 'Askıya al', exact: true }).click();
    await expect(row.getByText('Askıda', { exact: true })).toBeVisible();
    await expect(member.page.getByRole('textbox', { name: 'E-posta adresin', exact: true })).toBeVisible();
    const login = await member.page.request.post('/api/auth/login', { headers: { Origin: appOrigin }, data: { email: member.email, password } });
    expect(login.status()).toBe(200);
    const restricted = await login.json();
    expect(restricted.user.suspended).toBe(true);
    expect(restricted.workspace.id).toBe(member.data.workspace.id);
    expect(restricted.channels).toEqual([]);
    expect(restricted.members).toEqual([]);
    expect(restricted.voiceChannels).toEqual([]);
    expect((await member.page.request.get(`/api/channels/${member.data.channels[0].id}/messages`)).status()).toBe(403);
    await row.getByRole('button', { name: 'Etkinleştir', exact: true }).click();
    await page.getByRole('dialog', { name: 'Üyeyi etkinleştir', exact: true }).getByRole('button', { name: 'Etkinleştir', exact: true }).click();
    await expect(row.getByText('Aktif', { exact: true })).toBeVisible();
    const relogin = await member.page.request.post('/api/auth/login', { headers: { Origin: appOrigin }, data: { email: member.email, password } });
    expect(relogin.status()).toBe(200);
    await member.page.reload();
    await expect(member.page.locator('p.message-text').filter({ hasText: content })).toBeVisible();
  } finally { await member.context.close(); }
});

test('admin navigation is accessible on desktop and mobile and returns to the conversation', async ({ page, browser }) => {
  await register(page, 'Ekip Sahibi');
  const member = await joinedMember(page, browser);
  await member.context.close();
  await page.setViewportSize({ width: 1440, height: 1000 });
  let admin = await panel(page);
  await accessibility(page);
  await page.screenshot({ path: 'artifacts/admin-desktop.png', animations: 'disabled' });
  await admin.getByRole('button', { name: 'Sohbete dön', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Gezinmeyi aç', exact: true }).click();
  admin = await panel(page);
  await accessibility(page);
  const widths = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, dialog: document.querySelector('.adm-dialog')!.getBoundingClientRect().width }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport + 1);
  expect(widths.dialog).toBeLessThanOrEqual(widths.viewport + 1);
  await page.screenshot({ path: 'artifacts/admin-mobile.png', animations: 'disabled' });
  for (const name of ['Kanallar', 'Davetler', 'Ekip ayarları', 'İşlem geçmişi', 'Üyeler']) {
    await admin.getByRole('button', { name, exact: true }).click();
    await expect(admin.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  await admin.getByRole('button', { name: 'Sohbete dön', exact: true }).click();
  await expect(page.getByRole('textbox', { name: /kanalına mesaj yaz/ })).toBeVisible();
});
