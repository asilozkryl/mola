import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const origin = "http://127.0.0.1:5176";
const password = "Mola-original-password-2026";
async function mailLink(email: string, action: string) {
  let found = "";
  await expect
    .poll(
      async () => {
        const folder = join(process.env.MOLA_AUTH_E2E_DATA_DIR!, "mail");
        for (const name of await readdir(folder).catch(() => [])) {
          const mail = JSON.parse(await readFile(join(folder, name), "utf8"));
          if (mail.to === email && mail.text.includes(`action=${action}`))
            found = mail.text.match(/http[^\s]+/)[0];
        }
        return found;
      },
      { timeout: 15_000 },
    )
    .not.toBe("");
  return found;
}
async function login(page: Page, email: string, secret: string) {
  await page.getByLabel("E-posta adresin", { exact: true }).fill(email);
  await page.getByLabel("Parola", { exact: true }).fill(secret);
  await page
    .getByRole("button", { name: "Giriş yap", exact: true })
    .last()
    .click();
}

test("signup, explicit email verification, reset and revoked sessions work through real mail links", async ({
  page,
  browser,
}) => {
  const email = `mail-${randomUUID()}@example.invalid`;
  await page.addInitScript(() =>
    sessionStorage.setItem("mola:logged-out", "true"),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Hesap oluştur", exact: true })
    .click();
  await page.getByLabel("Adın soyadın", { exact: true }).fill("Eposta Testi");
  await page.getByLabel("E-posta adresin", { exact: true }).fill(email);
  await page.getByLabel("Parola", { exact: true }).fill(password);
  await page
    .getByLabel("Çalışma alanı adı", { exact: true })
    .fill("Doğrulanan Ekip");
  await page
    .getByRole("button", { name: "Hesap oluştur", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("heading", { name: "Gelen kutunda buluşalım." }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: /kanalına mesaj yaz/ }),
  ).toHaveCount(0);
  expect((await page.request.get("/api/rtc/config")).status()).toBe(403);
  await page.getByRole("button", { name: "Doğrulamayı tamamladım" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Henüz doğrulama gelmedi",
  );
  await page.screenshot({ path: "artifacts/qa-verification.png" });

  const verifyLink = await mailLink(email, "verify-email");
  const verifier = await browser.newContext();
  const verificationPage = await verifier.newPage();
  const requestUrls: string[] = [];
  verificationPage.on("request", (request) => requestUrls.push(request.url()));
  await verificationPage.goto(verifyLink);
  await expect(
    verificationPage.getByRole("button", { name: "E-posta adresimi doğrula" }),
  ).toBeVisible();
  expect(
    (await page.request.get("/api/auth/verification-status")).ok(),
  ).toBeTruthy();
  expect(
    (await (await page.request.get("/api/auth/me")).json()).user.emailVerified,
  ).toBe(false);
  await verificationPage
    .getByRole("button", { name: "E-posta adresimi doğrula" })
    .click();
  await expect(
    verificationPage.getByRole("heading", { name: "E-postan doğrulandı." }),
  ).toBeVisible();
  expect(new URL(verificationPage.url()).hash).toBe("");
  expect(requestUrls.some((url) => url.includes("token="))).toBe(false);
  await verifier.close();
  await page.getByRole("button", { name: "Doğrulamayı tamamladım" }).click();
  await expect(
    page.getByRole("textbox", { name: /kanalına mesaj yaz/ }),
  ).toBeVisible();

  const resetContext = await browser.newContext();
  const reset = await resetContext.newPage();
  await reset.addInitScript(() =>
    sessionStorage.setItem("mola:logged-out", "true"),
  );
  await reset.goto("/");
  await reset.getByRole("button", { name: "Parolamı unuttum" }).click();
  await reset.getByLabel("E-posta adresin", { exact: true }).fill(email);
  await reset
    .getByRole("button", { name: "Yenileme bağlantısı gönder" })
    .click();
  await expect(
    reset.getByRole("heading", { name: "E-postanı kontrol et." }),
  ).toBeVisible();
  const resetLink = await mailLink(email, "reset-password");
  await reset.goto(resetLink);
  await reset
    .getByLabel("Yeni parola", { exact: true })
    .fill("Mola-new-password-2026");
  await reset
    .getByLabel("Yeni parola tekrar", { exact: true })
    .fill("Mola-wrong-password-2026");
  await reset.getByRole("button", { name: "Parolamı yenile" }).click();
  await expect(reset.getByRole("alert")).toContainText("Parolalar aynı olmalı");
  await reset
    .getByLabel("Yeni parola tekrar", { exact: true })
    .fill("Mola-new-password-2026");
  await reset.getByRole("button", { name: "Parolamı yenile" }).click();
  await expect(
    reset.getByRole("heading", { name: "Yeni parolan hazır." }),
  ).toBeVisible();
  expect((await page.request.get("/api/auth/me")).status()).toBe(401);
  await expect(
    page.getByRole("heading", { name: "Tekrar hoş geldin." }),
  ).toBeVisible();
  await reset.getByRole("button", { name: "Devam et" }).click();
  await login(reset, email, password);
  await expect(reset.getByRole("alert")).toBeVisible();
  await login(reset, email, "Mola-new-password-2026");
  await expect(
    reset.getByRole("textbox", { name: /kanalına mesaj yaz/ }),
  ).toBeVisible();
  await reset.goto(resetLink);
  await reset
    .getByLabel("Yeni parola", { exact: true })
    .fill("Mola-another-password-2026");
  await reset
    .getByLabel("Yeni parola tekrar", { exact: true })
    .fill("Mola-another-password-2026");
  await reset.getByRole("button", { name: "Parolamı yenile" }).click();
  await expect(reset.getByRole("alert")).toBeVisible();
  await resetContext.close();
});

test("mobile recovery screens have no overflow or serious accessibility issues", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#action=reset-password&token=invalid");
  await expect(
    page.getByRole("heading", { name: "Yeni bir başlangıç." }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "artifacts/qa-recovery-mobile.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const report = await new AxeBuilder({ page }).analyze();
  expect(
    report.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact || ""),
    ),
  ).toEqual([]);
  await page.getByRole("button", { name: "Yeni bağlantı iste" }).click();
  await expect(
    page.getByRole("heading", { name: "Parolanı yenileyelim." }),
  ).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter((v) =>
      ["serious", "critical"].includes(v.impact || ""),
    ),
  ).toEqual([]);
});

test("expired verification sessions can return to sign-in", async ({
  page,
}) => {
  const response = await page.request.post("/api/auth/register", {
    headers: { Origin: origin },
    data: {
      name: "Eski Oturum",
      email: `expired-${randomUUID()}@example.invalid`,
      password,
      workspaceName: "Oturum Testi",
    },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Gelen kutunda buluşalım." }),
  ).toBeVisible();
  expect(
    (
      await page.request.post("/api/auth/logout", {
        headers: { Origin: origin },
      })
    ).ok(),
  ).toBeTruthy();
  await page
    .getByRole("button", { name: "Farklı bir hesapla giriş yap" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Tekrar hoş geldin." }),
  ).toBeVisible();
});
