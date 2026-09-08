import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { Bootstrap } from '../shared/types';

const origin = 'http://127.0.0.1:5174';
const password = 'draft-isolation-browser-password';
const composer = (page: Page) => page.getByRole('textbox', { name: '#genel kanalına mesaj yaz', exact: true });

async function signIn(page: Page, email: string) {
  await page.getByTitle('Profil ve ayarlar', { exact: true }).click();
  await page.getByRole('button', { name: 'Çıkış yap', exact: true }).click();
  await page.getByLabel('E-posta adresin', { exact: true }).fill(email);
  await page.getByLabel('Parola', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Giriş yap', exact: true }).last().click();
  await expect(composer(page)).toBeVisible();
}

async function openReply(page: Page, content: string) {
  const article = page.locator('article[data-message-id]').filter({ has: page.getByText(content, { exact: true }) });
  await article.hover();
  await article.getByRole('button', { name: 'Mesajı yanıtla', exact: true }).click();
  const reply = page.getByRole('textbox', { name: 'Yanıtını yaz', exact: true });
  await expect(reply).toBeVisible();
  return reply;
}

test('channel and reply drafts stay private across account changes and survive the author switching workspaces', async ({ page, browser }) => {
  const ownerEmail = `draft-owner-${randomUUID()}@example.invalid`;
  const ownerResponse = await page.request.post('/api/auth/register', {
    headers: { Origin: origin },
    data: { name: 'Taslak Sahibi', email: ownerEmail, password, workspaceName: `Taslak Ekibi ${randomUUID().slice(0, 8)}` },
  });
  expect(ownerResponse.status()).toBe(200);
  const owner = await ownerResponse.json() as Bootstrap;
  const channel = owner.channels.find(item => item.name === 'genel')!;
  const legacyDraft = `Yazarı bilinmeyen eski taslak ${randomUUID()}`;
  await page.addInitScript(({ key, value }) => sessionStorage.setItem(key, value), {
    key: `mola:draft:${channel.id}:`, value: legacyDraft,
  });
  await page.goto('/');
  await expect(composer(page)).toHaveValue('');

  const inviteResponse = await page.request.post('/api/invites', { headers: { Origin: origin } });
  expect(inviteResponse.status()).toBe(201);
  const inviteToken = new URL((await inviteResponse.json()).url).searchParams.get('invite')!;
  const memberEmail = `draft-member-${randomUUID()}@example.invalid`;
  const memberContext = await browser.newContext();
  try {
    const response = await memberContext.request.post('/api/auth/register', {
      headers: { Origin: origin }, data: { name: 'Taslak Üyesi', email: memberEmail, password, inviteToken },
    });
    expect(response.status()).toBe(200);
  } finally { await memberContext.close(); }

  const parent = `Ortak konuşma ${randomUUID()}`;
  await composer(page).fill(parent);
  await page.getByRole('button', { name: 'Mesaj gönder', exact: true }).click();
  await expect(page.locator('.message-text').filter({ hasText: parent })).toBeVisible();
  const ownerReply = `Sahibin gizli yanıt taslağı ${randomUUID()}`;
  await (await openReply(page, parent)).fill(ownerReply);
  await page.getByRole('button', { name: 'Mesaj dizisini kapat', exact: true }).click();
  const ownerDraft = `Sahibin gizli kanal taslağı ${randomUUID()}`;
  await composer(page).fill(ownerDraft);

  await page.getByRole('button', { name: 'Çalışma alanı menüsü', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Çalışma alanlarını değiştir', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Çalışma alanların', exact: true });
  await dialog.getByRole('button', { name: 'Yeni çalışma alanı', exact: true }).click();
  await dialog.getByLabel('Çalışma alanı adı', { exact: true }).fill(`Taslak İkinci Ekip ${randomUUID().slice(0, 8)}`);
  await dialog.getByRole('button', { name: 'Alanı oluştur', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(composer(page)).toHaveValue('');
  await composer(page).fill(`İkinci alanın ayrı taslağı ${randomUUID()}`);
  await page.getByRole('button', { name: 'Çalışma alanı menüsü', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Çalışma alanlarını değiştir', exact: true }).click();
  await dialog.getByRole('button', { name: `${owner.workspace.name} alanına geç`, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(composer(page)).toHaveValue(ownerDraft);
  await expect(await openReply(page, parent)).toHaveValue(ownerReply);
  await page.getByRole('button', { name: 'Mesaj dizisini kapat', exact: true }).click();

  await signIn(page, memberEmail);
  await expect(composer(page)).toHaveValue('');
  await expect(page.locator('.message-text').filter({ hasText: parent })).toBeVisible();
  await expect(await openReply(page, parent)).toHaveValue('');
  await page.getByRole('textbox', { name: 'Yanıtını yaz', exact: true }).fill(`Üyenin gizli yanıtı ${randomUUID()}`);
  await page.getByRole('button', { name: 'Mesaj dizisini kapat', exact: true }).click();
  await composer(page).fill(`Üyenin gizli kanal taslağı ${randomUUID()}`);

  await signIn(page, ownerEmail);
  await expect(composer(page)).toHaveValue(ownerDraft);
  await expect(await openReply(page, parent)).toHaveValue(ownerReply);
  // Historic drafts have no author binding and must never be adopted by either account.
  expect(await page.evaluate(key => sessionStorage.getItem(key), `mola:draft:${channel.id}:`)).toBe(legacyDraft);
});
