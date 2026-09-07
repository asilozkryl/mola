import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const appOrigin = 'http://127.0.0.1:5174';

async function registeredAccount(page: Page, name: string) {
  const email = `qa-${randomUUID()}@example.invalid`;
  const password = 'independent-browser-test-password';
  const response = await page.request.post('/api/auth/register', {
    headers: { Origin: appOrigin },
    data: { name, email, password, workspaceName: `${name} Ekibi` },
  });
  expect(response.status()).toBe(200);
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: /kanalına mesaj yaz/ })).toBeVisible();
  return { email, password, data: await response.json() };
}

async function openDemo(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: /kanalına mesaj yaz/ })).toBeVisible();
}

test('demo messages persist after reload and render untrusted text safely', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await openDemo(page);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'artifacts/qa-desktop.png', animations: 'disabled' });
  const message = `Kalıcı mesaj ${Date.now()} <img src=x onerror=alert(1)>`;
  await page.getByRole('textbox', { name: /kanalına mesaj yaz/ }).fill(message);
  await page.getByRole('button', { name: 'Mesaj gönder', exact: true }).click();
  await expect(page.locator('p.message-text').filter({ hasText: message })).toBeVisible();
  await page.reload();
  await expect(page.locator('p.message-text').filter({ hasText: message })).toBeVisible();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  expect(runtimeErrors).toEqual([]);
});

test('new channels can be created and reopened with their messages', async ({ page }) => {
  await openDemo(page);
  const name = `qa-${Date.now()}`;
  await page.getByRole('button', { name: 'Kanal oluştur', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Yeni bir kanal oluştur' });
  await dialog.getByLabel('Kanal adı', { exact: true }).fill(name);
  await dialog.getByLabel('Kanal açıklaması', { exact: true }).fill('Tarayıcı ile doğrulanan test kanalı.');
  await dialog.getByRole('button', { name: 'Kanal oluştur', exact: true }).click();
  const composer = page.getByRole('textbox', { name: `#${name} kanalına mesaj yaz`, exact: true });
  await expect(composer).toBeVisible();
  await composer.fill('Bu mesaj yeni kanala aittir.');
  await page.getByRole('button', { name: 'Mesaj gönder', exact: true }).click();
  const sentMessage = page.locator('p.message-text').filter({ hasText: /^Bu mesaj yeni kanala aittir\.$/ });
  await expect(sentMessage).toBeVisible();
  await expect(composer).toHaveValue('');
  await page.reload();
  await page.getByRole('button', { name, exact: true }).click();
  await expect(sentMessage).toBeVisible();
});

test('channel switching, replies and workspace search keep conversations organized', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('button', { name: 'genel', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '#genel kanalına mesaj yaz', exact: true })).toBeVisible();
  const content = `Aranabilir fikir ${Date.now()}`;
  await page.getByRole('textbox', { name: '#genel kanalına mesaj yaz', exact: true }).fill(content);
  await page.getByRole('button', { name: 'Mesaj gönder', exact: true }).click();
  const message = page.locator('article[data-message-id]').filter({ has: page.getByText(content, { exact: true }) });
  await message.hover();
  await message.getByRole('button', { name: 'Mesajı yanıtla', exact: true }).click();
  await page.getByRole('textbox', { name: 'Yanıtını yaz', exact: true }).fill('Bu fikir hakkında bir yanıt.');
  await page.getByRole('button', { name: 'Yanıt gönder', exact: true }).click();
  await expect(page.locator('p.message-text').filter({ hasText: 'Bu fikir hakkında bir yanıt.' })).toBeVisible();
  await page.getByRole('button', { name: 'Mesaj dizisini kapat', exact: true }).click();
  await page.locator('.channel-nav').filter({ has: page.getByText('tasarım', { exact: true }) }).click();
  await expect(page.getByText(content, { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Çalışma alanında ara', exact: true }).click();
  const search = page.getByRole('dialog', { name: 'Çalışma alanında ara' });
  await search.getByRole('textbox', { name: 'Mesajlarda ara', exact: true }).fill(content);
  await expect(search.getByText(content, { exact: true })).toBeVisible();
  await search.getByText(content, { exact: true }).click();
  await expect(page.getByRole('textbox', { name: '#genel kanalına mesaj yaz', exact: true })).toBeVisible();
  await expect(page.getByText(content, { exact: true })).toBeVisible();
});

test('invalid credentials show an accessible error and keep the user signed out', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('mola:logged-out', 'true'));
  await page.goto('/');
  await page.getByLabel('E-posta adresin', { exact: true }).fill('nobody@example.invalid');
  await page.getByLabel('Parola', { exact: true }).fill('incorrect-password-123');
  await page.getByRole('button', { name: 'Giriş yap', exact: true }).last().click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('textbox', { name: /kanalına mesaj yaz/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Giriş yap', exact: true }).last()).toBeEnabled();
});

test('a real account can register, send a message, log out and sign in again', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('mola:logged-out', 'true'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Hesap oluştur', exact: true }).click();
  const email = `browser-${Date.now()}@example.invalid`;
  const password = 'a-real-browser-test-password';
  await page.getByLabel('Adın soyadın', { exact: true }).fill('Tarayıcı Kullanıcısı');
  await page.getByLabel('E-posta adresin', { exact: true }).fill(email);
  await page.getByLabel('Parola', { exact: true }).fill(password);
  await page.getByLabel('Çalışma alanı adı', { exact: true }).fill('Gerçek Test Ekibi');
  await page.getByRole('button', { name: 'Hesap oluştur', exact: true }).last().click();
  const composer = page.getByRole('textbox', { name: '#genel kanalına mesaj yaz', exact: true });
  await expect(composer).toBeVisible();
  await composer.fill('Hesabımla geri geldiğimde bu mesaj burada olmalı.');
  await page.getByRole('button', { name: 'Mesaj gönder', exact: true }).click();
  await expect(page.locator('.message-text').filter({ hasText: /^Hesabımla geri geldiğimde bu mesaj burada olmalı\.$/ })).toBeVisible();
  await page.getByTitle('Profil ve ayarlar', { exact: true }).click();
  await page.getByRole('button', { name: 'Çıkış yap', exact: true }).click();
  await page.getByLabel('E-posta adresin', { exact: true }).fill(email);
  await page.getByLabel('Parola', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Giriş yap', exact: true }).last().click();
  await expect(page.locator('.message-text').filter({ hasText: /^Hesabımla geri geldiğimde bu mesaj burada olmalı\.$/ })).toBeVisible();
});

test('mobile messaging stays within the viewport, including long unbroken text', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDemo(page);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'artifacts/qa-mobile.png', animations: 'disabled' });
  const composer = page.getByRole('textbox', { name: /kanalına mesaj yaz/ });
  await composer.fill('uzunmesaj'.repeat(35));
  await page.getByRole('button', { name: 'Mesaj gönder', exact: true }).click();
  await expect(page.locator('.message-text').filter({ hasText: 'uzunmesaj'.repeat(35) })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
  const composerBox = await composer.boundingBox();
  expect(composerBox).not.toBeNull();
  expect(composerBox!.x).toBeGreaterThanOrEqual(0);
  expect(composerBox!.x + composerBox!.width).toBeLessThanOrEqual(391);
});

test('an owner can invite a second real user and exchange private messages in two browsers', async ({ page, browser }) => {
  await registeredAccount(page, 'Ekip Sahibi');
  await page.getByRole('button', { name: 'Ekip arkadaşlarını davet et', exact: true }).click();
  const invitation = page.getByRole('dialog', { name: 'Ekibine bir yer daha aç.' });
  await invitation.getByRole('button', { name: 'Davet bağlantısı oluştur', exact: true }).click();
  const inviteLink = invitation.getByRole('textbox', { name: 'Davet bağlantısı', exact: true });
  await expect(inviteLink).toHaveValue(/\?invite=/);
  const url = await inviteLink.inputValue();
  await invitation.getByRole('button', { name: 'Kapat', exact: true }).click();
  const secondContext = await browser.newContext();
  const invited = await secondContext.newPage();
  try {
    await invited.goto(url);
    await expect(invited.getByRole('heading', { name: 'Ekibine katıl.', exact: true })).toBeVisible();
    await invited.getByLabel('Adın soyadın', { exact: true }).fill('Davetli Arkadaş');
    await invited.getByLabel('E-posta adresin', { exact: true }).fill(`invited-${randomUUID()}@example.invalid`);
    await invited.getByLabel('Parola', { exact: true }).fill('a-strong-invited-password');
    await invited.getByRole('button', { name: 'Hesap oluştur', exact: true }).last().click();
    await expect(invited.getByRole('textbox', { name: '#genel kanalına mesaj yaz', exact: true })).toBeVisible();
    await page.locator('.dm-nav').filter({ hasText: 'Davetli Arkadaş' }).click();
    await page.getByRole('textbox', { name: '#Davetli Arkadaş kanalına mesaj yaz', exact: true }).fill('Bu konuşma yalnızca ikimizin arasında.');
    await page.getByRole('button', { name: 'Mesaj gönder', exact: true }).click();
    await invited.locator('.dm-nav').filter({ hasText: 'Ekip Sahibi' }).click();
    await expect(invited.getByText('Bu konuşma yalnızca ikimizin arasında.', { exact: true })).toBeVisible();
    await invited.getByRole('textbox', { name: '#Ekip Sahibi kanalına mesaj yaz', exact: true }).fill('Davet ve özel mesaj birlikte çalışıyor.');
    await invited.getByRole('button', { name: 'Mesaj gönder', exact: true }).click();
    await expect(page.getByText('Davet ve özel mesaj birlikte çalışıyor.', { exact: true })).toBeVisible();
  } finally { await secondContext.close(); }
});

test('messages can be saved, pinned, edited and deleted with state preserved after reload', async ({ page }) => {
  await openDemo(page);
  const original = `Düzenlenecek önemli not ${Date.now()}`;
  const updated = `${original} — güncellendi`;
  await page.getByRole('textbox', { name: /kanalına mesaj yaz/ }).fill(original);
  await page.getByRole('button', { name: 'Mesaj gönder', exact: true }).click();
  const originalArticle = page.locator('article[data-message-id]').filter({ has: page.getByText(original, { exact: true }) });
  await expect(originalArticle).toBeVisible();
  const id = await originalArticle.getAttribute('data-message-id');
  const article = page.locator(`article[data-message-id="${id}"]`);
  await article.hover();
  await article.getByRole('button', { name: 'Mesajı kaydet', exact: true }).click();
  await article.getByRole('button', { name: 'Diğer mesaj işlemleri', exact: true }).click();
  await article.getByRole('button', { name: 'Kanala sabitle', exact: true }).click();
  await page.getByRole('tab', { name: 'Sabitlenenler', exact: true }).click();
  await expect(page.getByText(original, { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('navigation').getByRole('button', { name: /^Kaydedilenler/ }).click();
  await expect(page.getByText(original, { exact: true })).toBeVisible();
  await page.locator('.channel-nav').filter({ has: page.getByText('tasarım', { exact: true }) }).click();
  await article.hover();
  await article.getByRole('button', { name: 'Diğer mesaj işlemleri', exact: true }).click();
  await article.getByRole('button', { name: 'Mesajı düzenle', exact: true }).click();
  await article.getByRole('textbox', { name: 'Mesajı düzenle', exact: true }).fill(updated);
  await article.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await expect(page.getByText(updated, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(updated, { exact: true })).toBeVisible();
  await article.hover();
  await article.getByRole('button', { name: 'Diğer mesaj işlemleri', exact: true }).click();
  await article.getByRole('button', { name: 'Mesajı sil', exact: true }).click();
  await page.getByRole('dialog', { name: 'Mesaj silinsin mi?' }).getByRole('button', { name: 'Mesajı sil', exact: true }).click();
  await expect(page.getByText(updated, { exact: true })).toHaveCount(0);
  await page.getByRole('navigation').getByRole('button', { name: /^Kaydedilenler/ }).click();
  await expect(page.getByText(updated, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Aklında kalmasın, burada kalsın.', exact: true })).toBeVisible();
});

test('an uploaded file appears in the channel files tab and downloads with the original contents', async ({ page }) => {
  await openDemo(page);
  const content = 'Mola dosya paylaşımı — UTF-8 içerik.\nİkinci satır.';
  const name = 'ekip-notları.txt';
  await page.getByLabel('Paylaşılacak dosya', { exact: true }).setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(content) });
  await expect(page.locator('.composer-attachments').getByRole('button', { name: `${name} dosyasını kaldır`, exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: /kanalına mesaj yaz/ }).fill('Ekibimizin notları burada.');
  await page.getByRole('button', { name: 'Mesaj gönder', exact: true }).click();
  await expect(page.locator('.file-attachment').getByText(name, { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /^Dosyalar/ }).click();
  const file = page.locator('.channel-file-list').getByRole('link').filter({ hasText: name });
  await expect(file).toBeVisible();
  const pendingDownload = page.waitForEvent('download');
  await file.click();
  const download = await pendingDownload;
  expect(download.suggestedFilename()).toBe(name);
  expect(await readFile((await download.path())!, 'utf8')).toBe(content);
});

test('password settings reject an incorrect current password and make the new password usable', async ({ page }) => {
  const account = await registeredAccount(page, 'Parola Testi');
  await page.getByTitle('Profil ve ayarlar', { exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Kendine ait bir köşe' });
  await settings.getByText('Parolanı değiştir', { exact: true }).click();
  await settings.getByLabel('Mevcut parolan', { exact: true }).fill('wrong-current-password');
  await settings.getByLabel('Yeni parolan', { exact: true }).fill('changed-password-for-browser-test');
  await settings.getByLabel('Yeni parolanı tekrar yaz', { exact: true }).fill('changed-password-for-browser-test');
  await settings.getByRole('button', { name: 'Parolayı güncelle', exact: true }).click();
  await expect(settings.getByRole('alert')).toBeVisible();
  await settings.getByLabel('Mevcut parolan', { exact: true }).fill(account.password);
  await settings.getByRole('button', { name: 'Parolayı güncelle', exact: true }).click();
  await expect(settings.getByRole('status')).toContainText('Parolan değiştirildi.');
  const oldLogin = await page.request.post('/api/auth/login', { headers: { Origin: appOrigin }, data: { email: account.email, password: account.password } });
  expect(oldLogin.status()).toBe(401);
  const newLogin = await page.request.post('/api/auth/login', { headers: { Origin: appOrigin }, data: { email: account.email, password: 'changed-password-for-browser-test' } });
  expect(newLogin.status()).toBe(200);
});
