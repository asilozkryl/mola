import { expect, test, type Browser, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { Bootstrap } from '../shared/types';

const origin = 'http://127.0.0.1:5174';
const headers = { Origin: origin };
async function register(page: Page, name: string, inviteToken?: string) {
  const response = await page.request.post('/api/auth/register', { headers, data: { name, email: `privacy-${randomUUID()}@example.invalid`, password: 'privacy-refresh-password', workspaceName: 'Privacy Team', ...(inviteToken ? { inviteToken } : {}) } });
  expect(response.status()).toBe(200); return response.json() as Promise<Bootstrap>;
}
async function fixture(owner: Page, browser: Browser, run: (context: { viewer: Page; ownerId: string; privateId: string; revoke: () => Promise<void> }) => Promise<void>) {
  const ownerState = await register(owner, 'Private Owner');
  const invitation = await owner.request.post('/api/invites', { headers });
  const token = new URL((await invitation.json()).url).searchParams.get('invite')!;
  const context = await browser.newContext({ baseURL: origin });
  const viewer = await context.newPage();
  try {
    const viewerState = await register(viewer, 'Private Admin', token);
    expect((await owner.request.patch(`/api/admin/workspace/members/${viewerState.user.id}/role`, { headers, data: { role: 'admin' } })).status()).toBe(200);
    const created = await owner.request.post('/api/channels', { headers, data: { name: 'restricted-plans', kind: 'text', visibility: 'private', memberIds: [viewerState.user.id] } });
    expect(created.status()).toBe(201); const privateId = (await created.json()).id as string;
    expect((await owner.request.post(`/api/channels/${privateId}/messages`, { headers, data: { content: 'Private refresh content must disappear.' } })).status()).toBe(201);
    await viewer.goto('/'); await expect(viewer.getByText('Her şey güncel', { exact: true })).toBeAttached();
    const revoke = async () => {
      const response = await owner.request.patch(`/api/channels/${privateId}/access`, { headers, data: { visibility: 'private', memberIds: [ownerState.user.id] } });
      expect(response.status()).toBe(200);
    };
    await run({ viewer, privateId, ownerId: ownerState.user.id, revoke });
  } finally { await context.close(); }
}

test('open search drops already rendered private previews when access changes', async ({ page, browser }) => fixture(page, browser, async ({ viewer, privateId, revoke }) => {
  await viewer.keyboard.press('Control+k');
  const dialog = viewer.getByRole('dialog', { name: 'Çalışma alanında ara', exact: true });
  await dialog.getByRole('textbox', { name: 'Mesajlarda ara', exact: true }).fill('Private refresh');
  await expect(dialog.getByText('Private refresh content must disappear.', { exact: true })).toBeVisible();
  await revoke();
  await expect(dialog.locator(`select[aria-label="Kanal"] option[value="${privateId}"]`)).toHaveCount(0);
  await expect(dialog.getByText('Private refresh content must disappear.', { exact: true })).toHaveCount(0);
}));

test('a delayed authorized search response cannot restore revoked message content', async ({ page, browser }) => fixture(page, browser, async ({ viewer, privateId, revoke }) => {
  let release!: () => void; let captured!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); const responseReady = new Promise<void>(resolve => { captured = resolve; });
  await viewer.route('**/api/search?**', async route => { const response = await route.fetch(); captured(); await gate; await route.fulfill({ response }); });
  try {
    await viewer.keyboard.press('Control+k');
    const dialog = viewer.getByRole('dialog', { name: 'Çalışma alanında ara', exact: true });
    await dialog.getByRole('textbox', { name: 'Mesajlarda ara', exact: true }).fill('Private refresh');
    await responseReady; await revoke();
    await expect(dialog.locator(`select[aria-label="Kanal"] option[value="${privateId}"]`)).toHaveCount(0);
    release();
    await expect(dialog.getByText('Mesajlar aranıyor', { exact: true })).toHaveCount(0);
    await expect(dialog.getByText('Private refresh content must disappear.', { exact: true })).toHaveCount(0);
  } finally { release(); await viewer.unrouteAll({ behavior: 'wait' }); }
}));

test('channel revocation removes an open integration key and list entry', async ({ page, browser }) => fixture(page, browser, async ({ viewer, revoke }) => {
  const bootstrap = await (await viewer.request.get('/api/auth/me')).json() as Bootstrap;
  const target = bootstrap.channels.find(channel => channel.name === 'restricted-plans')!;
  await viewer.getByRole('button', { name: 'Entegrasyonlar', exact: true }).click();
  const dialog = viewer.getByRole('dialog', { name: 'Entegrasyonlar', exact: true });
  await dialog.getByRole('button', { name: 'Entegrasyon ekle', exact: true }).click();
  await dialog.getByRole('radio', { name: /Gelen webhook/ }).check();
  await dialog.getByRole('textbox', { name: 'Botun adı', exact: true }).fill('Private Integration');
  await dialog.getByRole('combobox', { name: 'Bildirim kanalı', exact: true }).selectOption(target.id);
  await dialog.getByRole('button', { name: 'Entegrasyonu oluştur', exact: true }).click();
  await expect(dialog.getByLabel('Entegrasyon anahtarı', { exact: true })).toHaveCount(1);
  await revoke();
  await expect(dialog.getByLabel('Entegrasyon anahtarı', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('Private Integration', { exact: true })).toHaveCount(0);
}));

test('delayed integration creation cannot display a secret after its channel is revoked', async ({ page, browser }) => fixture(page, browser, async ({ viewer, privateId, revoke }) => {
  let release!: () => void; let captured!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); const responseReady = new Promise<void>(resolve => { captured = resolve; });
  await viewer.route('**/api/integrations', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch(); captured(); await gate; await route.fulfill({ response });
  });
  try {
    await viewer.getByRole('button', { name: 'Entegrasyonlar', exact: true }).click();
    const dialog = viewer.getByRole('dialog', { name: 'Entegrasyonlar', exact: true });
    await dialog.getByRole('button', { name: 'Entegrasyon ekle', exact: true }).click();
    await dialog.getByRole('radio', { name: /Gelen webhook/ }).check();
    await dialog.getByRole('textbox', { name: 'Botun adı', exact: true }).fill('Delayed Private Bot');
    await dialog.getByRole('combobox', { name: 'Bildirim kanalı', exact: true }).selectOption(privateId);
    await dialog.getByRole('button', { name: 'Entegrasyonu oluştur', exact: true }).click();
    await responseReady; await revoke();
    await expect(dialog.locator(`select[name="channelId"] option[value="${privateId}"]`)).toHaveCount(0);
    release();
    await expect(dialog.getByRole('button', { name: 'Entegrasyonu oluştur', exact: true })).toBeDisabled();
    await expect(dialog.getByLabel('Entegrasyon anahtarı', { exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('combobox', { name: 'Bildirim kanalı', exact: true })).toHaveValue('');
  } finally { release(); await viewer.unrouteAll({ behavior: 'wait' }); }
}));
