import { chromium, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

// Explicit local-only smoke test: creates one isolated QA workspace in local Docker.
const origin = 'http://localhost:3000';
const mailbox = 'http://localhost:8025';
const config = await (await fetch(`${origin}/api/config`)).json();
if (!config.demoEnabled || new URL(config.localMailboxUrl || origin).origin !== mailbox) throw new Error('Expected the local Docker/Mailpit configuration.');
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const email = `docker-smoke-${Date.now()}@mola.local`;
const password = randomBytes(24).toString('base64url');
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.addInitScript(() => sessionStorage.setItem('mola:logged-out', 'true'));
  await page.goto(origin);
  await page.getByRole('button', { name: 'Hesap oluştur', exact: true }).click();
  await page.getByLabel('Adın soyadın', { exact: true }).fill('Docker Kontrol');
  await page.getByLabel('E-posta adresin', { exact: true }).fill(email);
  await page.getByLabel('Parola', { exact: true }).fill(password);
  await page.getByLabel('Çalışma alanı adı', { exact: true }).fill('Yerel Docker Kontrolü');
  await page.getByRole('button', { name: 'Hesap oluştur', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'Gelen kutunda buluşalım.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'E-posta kutusunu aç' })).toHaveAttribute('href', `${mailbox}/`);
  let mailId;
  await expect.poll(async () => {
    const data = await (await fetch(`${mailbox}/api/v1/messages`)).json();
    mailId = data.messages.find(message => message.To.some(to => to.Address === email))?.ID;
    return Boolean(mailId);
  }, { timeout: 20_000 }).toBe(true);
  const mail = await (await fetch(`${mailbox}/api/v1/message/${mailId}`)).json();
  const link = mail.Text.match(/http[^\s]+/)[0];
  expect(new URL(link).origin).toBe(origin);
  expect(new URL(link).hash).toContain('action=verify-email');
  await page.goto(link);
  await page.getByRole('button', { name: 'E-posta adresimi doğrula' }).click();
  await expect(page.getByRole('heading', { name: 'E-postan doğrulandı.' })).toBeVisible();
  await page.getByRole('button', { name: 'Devam et' }).click();
  const composer = page.getByRole('textbox', { name: /kanalına mesaj yaz/ });
  await expect(composer).toBeVisible();
  const message = 'Docker SMTP ve e-posta doğrulaması tamamlandı.';
  await composer.fill(message);
  await page.getByRole('button', { name: 'Mesaj gönder', exact: true }).click();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/qa-docker-auth.png' });
  expect(errors).toEqual([]);
  const report = { passed: true, at: new Date().toISOString(), origin, smtp: 'Mailpit Docker SMTP', checks: ['actual SMTP mail delivery', 'email verification gate', 'fragment link + explicit confirmation', 'verified workspace access', 'message persistence after reload'], runtimeErrors: errors };
  await writeFile('artifacts/docker-account-smoke.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await context.close(); await browser.close(); }
