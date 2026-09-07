import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { totpCode } from "../server/account-security.js";

const origin = "http://127.0.0.1:5174";
const password = "browser-security-password-123";
function decode32(value: string): Buffer {
  let accumulator = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const character of value) {
    accumulator =
      (accumulator << 5) |
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >> bits) & 255);
    }
  }
  return Buffer.from(bytes);
}

test("a member enables two-factor authentication, saves recovery codes and completes the gated login", async ({
  page,
}) => {
  const email = `security-browser-${randomUUID()}@example.invalid`;
  expect(
    (
      await page.request.post("/api/auth/register", {
        headers: { Origin: origin },
        data: {
          name: "Security Browser",
          email,
          password,
          workspaceName: "Güvenli ekip",
        },
      })
    ).status(),
  ).toBe(200);
  await page.goto("/");
  await expect(
    page.getByRole("textbox", {
      name: "#genel kanalına mesaj yaz",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByTitle("Profil ve ayarlar", { exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Kendine ait bir köşe" });
  await settings
    .getByText("Hesap güvenliği ve cihazlar", { exact: true })
    .click();
  await expect(settings.getByText("Bu cihaz", { exact: true })).toBeVisible();
  await settings
    .getByRole("button", { name: "İki aşamalı doğrulamayı kur", exact: true })
    .click();
  const setupForm = settings.getByRole("form", {
    name: "İki aşamalı doğrulama kurulumu",
  });
  await setupForm.getByLabel("Mevcut parolan", { exact: true }).fill(password);
  await setupForm
    .getByRole("button", { name: "Kuruluma devam et", exact: true })
    .click();
  await expect(
    settings.getByRole("img", {
      name: "Mola doğrulama hesabını eklemek için QR kod",
    }),
  ).toBeVisible();
  await settings.getByText("QR kodu tarayamıyorum", { exact: true }).click();
  const secret = await settings.locator(".security-manual code").textContent();
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  const setup = settings.getByRole("form", {
    name: "Doğrulama uygulamasını bağla",
  });
  await setup
    .getByLabel("Doğrulama kodu", { exact: true })
    .fill(totpCode(decode32(secret!), Date.now()));
  await setup
    .getByRole("button", { name: "Doğrula ve etkinleştir", exact: true })
    .click();
  const recovery = settings.getByRole("region", { name: "Kurtarma kodların" });
  await expect(recovery).toBeVisible();
  const codes = await recovery.locator("li code").allTextContents();
  expect(codes).toHaveLength(10);
  const downloadPromise = page.waitForEvent("download");
  await recovery
    .getByRole("button", { name: "Kodları indir", exact: true })
    .click();
  expect((await downloadPromise).suggestedFilename()).toBe(
    "mola-kurtarma-kodlari.txt",
  );
  await recovery
    .getByRole("button", { name: "Kodlarımı sakladım", exact: true })
    .click();
  await expect(settings.getByText("Açık", { exact: true })).toBeVisible();
  const accessibility = await new AxeBuilder({ page })
    .include(".account-security")
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await settings
    .getByRole("button", { name: "Çıkış yap", exact: true })
    .click();
  await page.getByLabel("E-posta adresin", { exact: true }).fill(email);
  await page.getByLabel("Parola", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Giriş yap", exact: true })
    .last()
    .click();
  const challenge = page.getByRole("form", { name: "İki aşamalı giriş" });
  await expect(challenge).toBeVisible();
  expect((await page.request.get("/api/auth/me")).status()).toBe(401);
  await page
    .getByRole("button", { name: "Telefonuma erişemiyorum", exact: true })
    .click();
  await challenge.getByLabel("Kurtarma kodu", { exact: true }).fill(codes[0]);
  await challenge
    .getByRole("button", { name: "Doğrula ve giriş yap", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", {
      name: "#genel kanalına mesaj yaz",
      exact: true,
    }),
  ).toBeVisible();
  const status = await (await page.request.get("/api/account/security")).json();
  expect(status.enabled).toBe(true);
  expect(status.recoveryCodesRemaining).toBe(9);
});
