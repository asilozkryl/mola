import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

const appOrigin = "http://127.0.0.1:5174";
const unavailableConfig = {
  demoEnabled: false,
  emailDeliveryAvailable: false,
  registrationAvailable: false,
  relayConfigured: false,
};

async function noEmail(page: Page) {
  await page.route("**/api/config", (route) =>
    route.fulfill({ json: unavailableConfig }),
  );
}

test("email setup notice prevents registration and recovery, including invite links", async ({
  page,
}) => {
  await noEmail(page);
  const submissions: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") submissions.push(request.url());
  });
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText(
    "E-posta hizmeti henüz bağlanmadı.",
  );
  await expect(
    page.getByRole("button", { name: "Hesap oluştur", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Parolamı unuttum", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Giriş yap", exact: true }).last(),
  ).toBeEnabled();
  await page.goto("/?invite=provider-setup-pending");
  await expect(page.getByRole("status")).toContainText(
    "Hesap oluşturma ve parola yenileme",
  );
  await expect(page.getByLabel("Adın soyadın", { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Mevcut hesabımla giriş yap", exact: true })
    .click();
  await expect(
    page.getByLabel("E-posta adresin", { exact: true }),
  ).toBeVisible();
  expect(submissions).toEqual([]);
});

test("existing accounts can sign in while email delivery is unavailable", async ({
  page,
}) => {
  const email = `optional-provider-${randomUUID()}@example.invalid`;
  const password = "existing-account-password-123";
  const created = await page.request.post("/api/auth/register", {
    headers: { Origin: appOrigin },
    data: { name: "Mevcut Üye", email, password, workspaceName: "Mevcut Ekip" },
  });
  expect(created.status()).toBe(200);
  const logout = await page.request.post("/api/auth/logout", {
    headers: { Origin: appOrigin },
  });
  expect(logout.ok()).toBe(true);
  await noEmail(page);
  await page.goto("/");
  await page.getByLabel("E-posta adresin", { exact: true }).fill(email);
  await page.getByLabel("Parola", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Giriş yap", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("textbox", { name: /kanalına mesaj yaz/ }),
  ).toBeVisible();
});

test("unverified accounts remain gated without claiming a verification email was sent", async ({
  page,
}) => {
  await noEmail(page);
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "pending-user",
          name: "Bekleyen Üye",
          email: "pending@example.invalid",
          color: "#b8cabe",
          role: "owner",
          emailVerified: false,
        },
        workspace: {
          id: "pending-workspace",
          name: "Bekleyen Ekip",
          isDemo: false,
        },
        channels: [],
        members: [],
        onlineIds: [],
        emailVerificationRequired: true,
        emailDeliveryAvailable: false,
      },
    }),
  );
  const submissions: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") submissions.push(request.url());
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "E-posta doğrulaması bekleniyor." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "E-postayı tekrar gönder", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText(/bir doğrulama bağlantısı gönderdik/),
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: /kanalına mesaj yaz/ }),
  ).toHaveCount(0);
  expect(submissions).toEqual([]);
});

test("recovery handles unavailable delivery and keeps an existing reset link usable", async ({
  page,
}) => {
  let available = true;
  await page.route("**/api/config", (route) =>
    route.fulfill({
      json: {
        ...unavailableConfig,
        emailDeliveryAvailable: available,
        registrationAvailable: available,
      },
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Parolamı unuttum", exact: true }),
  ).toBeEnabled();
  available = false;
  await page
    .getByRole("button", { name: "Parolamı unuttum", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Parola yenileme bağlantısı şu anda gönderilemiyor.",
  );
  await expect(
    page.getByRole("button", {
      name: "Yenileme bağlantısı gönder",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Girişe dön", exact: true }).click();
  await page.goto("/#action=reset-password&token=existing-unconsumed-link");
  await expect(
    page.getByRole("button", { name: "Yeni bağlantı iste", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Parolamı yenile", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("status")).toContainText(
    "Elindeki bağlantı geçerliyse yeni parolanı belirleyebilirsin.",
  );
});
