import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

async function audit(page: Page, region?: string) {
  await page.evaluate(() => document.fonts.ready);
  let builder = new AxeBuilder({ page });
  if (region) builder = builder.include(region);
  const results = await builder.analyze();
  const failures = results.violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical');
  await test.info().attach('accessibility-results', { body: JSON.stringify(results.violations, null, 2), contentType: 'application/json' });
  expect(failures.map(violation => ({ rule: violation.id, impact: violation.impact, nodes: violation.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }))).toEqual([]);
}

async function openWorkspace(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: /kanalına mesaj yaz/ })).toBeVisible();
  await expect(page.getByText('Her şey güncel', { exact: true })).toBeAttached();
}

test('desktop workspace has no serious or critical accessibility violations', async ({ page }) => {
  await openWorkspace(page);
  await audit(page);
});

test('mobile workspace has no serious or critical accessibility violations', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWorkspace(page);
  await audit(page);
});

test('sign-in form has no serious or critical accessibility violations', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('mola:logged-out', 'true'));
  await page.goto('/');
  await expect(page.getByLabel('E-posta adresin', { exact: true })).toBeVisible();
  await audit(page);
});

test('channel creation dialog has no serious or critical accessibility violations', async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Kanal oluştur', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Yeni bir kanal oluştur' })).toBeVisible();
  await audit(page, 'dialog, [role="dialog"]');
});

test('call permission error has no serious or critical accessibility violations', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
  });
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Bir araya gel', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Mikrofon izni verilmedi');
  await audit(page, 'dialog, [role="dialog"]');
});

test('active call controls and waiting state have no serious or critical accessibility violations', async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Bir araya gel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mikrofonu kapat', exact: true })).toBeVisible();
  await audit(page, '.call-dialog');
  await page.setViewportSize({ width: 390, height: 844 });
  await audit(page, '.call-dialog');
  const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(widths.content).toBeLessThanOrEqual(widths.viewport + 1);
  await page.screenshot({ path: 'artifacts/qa-call-mobile.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Görüşmeden ayrıl', exact: true }).click();
});
