import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { Bootstrap } from "../shared/types";

const origin = "http://127.0.0.1:5174";
const settings = (page: Page) =>
  page.getByRole("dialog", { name: "Kendine ait bir köşe", exact: true });
const discardConfirmation = (page: Page) =>
  page.getByRole("dialog", {
    name: "Kaydedilmemiş değişikliklerin var",
    exact: true,
  });

async function account(page: Page) {
  const response = await page.request.post("/api/auth/register", {
    headers: { Origin: origin },
    data: {
      name: "Profil Testi",
      email: `profile-${randomUUID()}@example.invalid`,
      password: "profile-browser-password-123",
      workspaceName: "Profil ekibi",
    },
  });
  expect(response.status()).toBe(200);
  const data = (await response.json()) as Bootstrap;
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: /kanalına mesaj yaz/ }),
  ).toBeVisible();
  return data;
}

async function openSettings(page: Page) {
  await page
    .getByRole("button", { name: "Profil ayarları", exact: true })
    .click();
  await expect(settings(page)).toBeVisible();
  return settings(page);
}

async function photo() {
  return {
    name: "profil.png",
    mimeType: "image/png",
    buffer: await sharp({
      create: { width: 90, height: 90, channels: 3, background: "#368062" },
    })
      .png()
      .toBuffer(),
  };
}

test("profile details survive a failed save, persist after retry and can be cleared", async ({
  page,
}) => {
  const data = await account(page);
  const dialog = await openSettings(page);
  await dialog.getByLabel("Adın soyadın", { exact: true }).fill("Deniz Kaya");
  await dialog
    .getByLabel("Durumun", { exact: true })
    .fill("Tasarıma odaklandım");
  await dialog.getByLabel("Unvanın", { exact: true }).fill("Ürün tasarımcısı");
  await dialog.getByLabel("Konumun", { exact: true }).fill("İstanbul");
  await dialog
    .getByLabel("Hakkında", { exact: true })
    .fill("Arayüz, erişilebilirlik ve ekip çalışması.\nBirlikte üretiyoruz.");
  let attempts = 0;
  await page.route("**/api/profile", async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    expect(route.request().headers()["x-workspace-id"]).toBe(data.workspace.id);
    expect(route.request().headers()["x-user-id"]).toBe(data.user.id);
    attempts++;
    if (attempts === 1)
      return route.fulfill({
        status: 503,
        json: { error: "Profil şu an kaydedilemedi. Yeniden dene." },
      });
    return route.continue();
  });
  await dialog
    .getByRole("button", { name: "Değişiklikleri kaydet", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("Yeniden dene");
  await expect(dialog.getByLabel("Unvanın", { exact: true })).toHaveValue(
    "Ürün tasarımcısı",
  );
  await expect(dialog.getByLabel("Hakkında", { exact: true })).toHaveValue(
    "Arayüz, erişilebilirlik ve ekip çalışması.\nBirlikte üretiyoruz.",
  );
  await dialog
    .getByRole("button", { name: "Değişiklikleri kaydet", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toHaveText("Profilin güncellendi.");
  await page.reload();
  await openSettings(page);
  await expect(dialog.getByLabel("Adın soyadın", { exact: true })).toHaveValue(
    "Deniz Kaya",
  );
  await expect(dialog.getByLabel("Konumun", { exact: true })).toHaveValue(
    "İstanbul",
  );
  for (const name of ["Durumun", "Unvanın", "Konumun", "Hakkında"])
    await dialog.getByLabel(name, { exact: true }).fill("");
  await dialog
    .getByRole("button", { name: "Değişiklikleri kaydet", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toHaveText("Profilin güncellendi.");
  const current = (await (
    await page.request.get("/api/auth/me")
  ).json()) as Bootstrap;
  for (const field of ["status", "jobTitle", "location", "bio"] as const)
    expect(current.user[field] || "").toBe("");
});

test("photo preview can be cancelled, upload can be retried, and removal persists", async ({
  page,
}) => {
  const data = await account(page);
  const dialog = await openSettings(page);
  const input = dialog.getByLabel("Profil fotoğrafı seç", { exact: true });
  const newPhoto = await photo();
  let uploads = 0;
  await page.route("**/api/profile/avatar", async (route) => {
    expect(route.request().headers()["x-workspace-id"]).toBe(data.workspace.id);
    expect(route.request().headers()["x-user-id"]).toBe(data.user.id);
    if (route.request().method() === "POST" && ++uploads === 1)
      return route.fulfill({
        status: 503,
        json: { error: "Fotoğraf yüklenemedi. Tekrar deneyebilirsin." },
      });
    return route.continue();
  });
  await input.setInputFiles(newPhoto);
  await expect(
    dialog.getByRole("img", { name: "Yeni profil fotoğrafının önizlemesi" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Vazgeç", exact: true }).click();
  await expect(
    dialog.getByRole("img", { name: "Yeni profil fotoğrafının önizlemesi" }),
  ).toHaveCount(0);
  expect(uploads).toBe(0);
  await input.setInputFiles(newPhoto);
  await dialog
    .getByLabel("Unvanın", { exact: true })
    .fill("Kaydedilmemiş unvan");
  await dialog
    .getByRole("button", { name: "Fotoğrafı kaydet", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Tekrar deneyebilirsin",
  );
  await expect(
    dialog.getByRole("img", { name: "Yeni profil fotoğrafının önizlemesi" }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Fotoğrafı kaydet", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toHaveText(
    "Profil fotoğrafın güncellendi.",
  );
  await expect(dialog.getByLabel("Unvanın", { exact: true })).toHaveValue(
    "Kaydedilmemiş unvan",
  );
  await page.keyboard.press("Escape");
  await expect(discardConfirmation(page)).toBeVisible();
  await expect(discardConfirmation(page)).toContainText(
    "Profil bilgilerindeki düzenlemeler henüz kaydedilmedi.",
  );
  await discardConfirmation(page)
    .getByRole("button", { name: "Düzenlemeye devam et", exact: true })
    .click();
  await expect(
    dialog.locator(".profile-photo-preview .avatar img"),
  ).toBeVisible();
  const current = (await (
    await page.request.get("/api/auth/me")
  ).json()) as Bootstrap;
  expect(current.user.avatarUrl).toBeTruthy();
  await page.reload();
  await openSettings(page);
  await expect(
    dialog.locator(".profile-photo-preview .avatar img"),
  ).toHaveAttribute("src", current.user.avatarUrl!);
  await dialog
    .getByRole("button", { name: "Fotoğrafı kaldır", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toHaveText(
    "Profil fotoğrafın kaldırıldı.",
  );
  await expect(
    dialog.locator(".profile-photo-preview .avatar img"),
  ).toHaveCount(0);
  await page.reload();
  await openSettings(page);
  await expect(
    dialog.getByRole("button", { name: "Fotoğraf ekle", exact: true }),
  ).toBeVisible();
  expect(uploads).toBe(2);
});

test("photo selection rejects unsupported, oversized and undecodable files before upload", async ({
  page,
}) => {
  await account(page);
  const dialog = await openSettings(page);
  const input = dialog.getByLabel("Profil fotoğrafı seç", { exact: true });
  let uploads = 0;
  page.on("request", (request) => {
    if (
      request.url().endsWith("/api/profile/avatar") &&
      request.method() === "POST"
    )
      uploads++;
  });
  await input.setInputFiles({
    name: "vector.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  });
  await expect(dialog.getByRole("alert")).toContainText("PNG, JPG veya WebP");
  await input.setInputFiles({
    name: "large.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  });
  await expect(dialog.getByRole("alert")).toContainText("en fazla 5 MB");
  await input.setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from("This is not an image"),
  });
  await expect(dialog.getByRole("alert")).toContainText(
    "Bu fotoğraf açılamadı",
  );
  await expect(
    dialog.getByRole("button", { name: "Fotoğrafı kaydet", exact: true }),
  ).toBeDisabled();
  expect(uploads).toBe(0);
  await input.setInputFiles(await photo());
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Fotoğrafı kaydet", exact: true }),
  ).toBeEnabled();
});

for (const width of [320, 390]) {
  test(`profile settings remain usable at ${width}px with accessible labels and visible focus`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await account(page);
    const dialog = await openSettings(page);
    await dialog
      .getByLabel("Profil fotoğrafı seç", { exact: true })
      .setInputFiles(await photo());
    await expect(
      dialog.getByRole("button", { name: "Fotoğrafı kaydet", exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () =>
        dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
      )
      .toBe(true);
    await dialog
      .getByLabel("Hakkında", { exact: true })
      .fill("Mobil profil düzenleme");
    await dialog
      .getByLabel("Unvanın", { exact: true })
      .fill("Ürün tasarımcısı");
    await dialog.getByLabel("Konumun", { exact: true }).fill("İstanbul");
    await dialog
      .getByRole("button", { name: "Değişiklikleri kaydet", exact: true })
      .focus();
    await expect(
      dialog.getByRole("button", {
        name: "Değişiklikleri kaydet",
        exact: true,
      }),
    ).toBeFocused();
    if (width === 390) {
      await dialog.evaluate((element) => {
        element.scrollTop = 0;
      });
      await page.screenshot({
        path: "artifacts/profile-settings-mobile.png",
        animations: "disabled",
      });
      const results = await new AxeBuilder({ page })
        .include('[role="dialog"][aria-modal="true"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(results.violations).toEqual([]);
    }
    await page.keyboard.press("Escape");
    const confirmation = discardConfirmation(page);
    await expect(confirmation).toBeVisible();
    const continueEditing = confirmation.getByRole("button", {
      name: "Düzenlemeye devam et",
      exact: true,
    });
    await expect(continueEditing).toBeFocused();
    await expect
      .poll(() =>
        confirmation.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
      )
      .toBe(true);
    const discard = confirmation.getByRole("button", {
      name: "Değişiklikleri bırak",
      exact: true,
    });
    await discard.focus();
    await page.keyboard.press("Tab");
    await expect(
      confirmation.getByRole("button", { name: "Kapat", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(discard).toBeFocused();
    if (width === 390) {
      const results = await new AxeBuilder({ page })
        .include(".modal:has(> .profile-discard-confirm)")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(results.violations).toEqual([]);
      await page.screenshot({
        path: "artifacts/profile-unsaved-mobile.png",
        animations: "disabled",
      });
    }
    await page.keyboard.press("Escape");
    await expect(confirmation).toHaveCount(0);
    await expect(dialog.getByLabel("Hakkında", { exact: true })).toHaveValue(
      "Mobil profil düzenleme",
    );
    await expect(
      dialog.getByRole("button", {
        name: "Değişiklikleri kaydet",
        exact: true,
      }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await discard.click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Profil ayarları", exact: true }),
    ).toBeFocused();
  });
}

test("unchanged, reverted and already saved profile details close without confirmation", async ({
  page,
}) => {
  await account(page);
  const dialog = await openSettings(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(discardConfirmation(page)).toHaveCount(0);

  await openSettings(page);
  await dialog.getByLabel("Unvanın", { exact: true }).fill("Geçici unvan");
  await dialog.getByLabel("Unvanın", { exact: true }).fill("");
  await dialog.getByRole("tab", { name: "Bildirimler", exact: true }).click();
  await dialog.getByRole("switch", { name: /Biraz odak zamanı/ }).click();
  await dialog.getByRole("button", { name: "Kapat", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(discardConfirmation(page)).toHaveCount(0);

  await openSettings(page);
  await dialog.getByLabel("Konumun", { exact: true }).fill("  İzmir  ");
  await dialog
    .getByRole("button", { name: "Değişiklikleri kaydet", exact: true })
    .click();
  await expect(dialog.getByLabel("Konumun", { exact: true })).toHaveValue(
    "İzmir",
  );
  await expect(dialog.getByRole("status")).toHaveText("Profilin güncellendi.");
  await page.mouse.click(2, 2);
  await expect(dialog).toHaveCount(0);
  await expect(discardConfirmation(page)).toHaveCount(0);
});

test("every profile field survives closing attempts and only explicit discard drops the draft", async ({
  page,
}) => {
  const data = await account(page);
  const dialog = await openSettings(page);
  const confirmation = discardConfirmation(page);
  const fields = [
    ["Adın soyadın", "Deniz Kaya", data.user.name],
    ["Durumun", "Tasarım üzerinde çalışıyorum", data.user.status || ""],
    ["Unvanın", "Ürün tasarımcısı", data.user.jobTitle || ""],
    ["Konumun", "Ankara", data.user.location || ""],
    [
      "Hakkında",
      "Kaydedilmemiş bir tanıtım.\nİkinci satır.",
      data.user.bio || "",
    ],
  ];
  for (const [index, [label, draft, original]] of fields.entries()) {
    await dialog.getByLabel(label, { exact: true }).fill(draft);
    if (index % 3 === 0)
      await dialog.getByRole("button", { name: "Kapat", exact: true }).click();
    else if (index % 3 === 1) await page.keyboard.press("Escape");
    else await page.mouse.click(2, 2);
    await expect(confirmation).toBeVisible();
    await expect(
      confirmation.getByRole("button", {
        name: "Düzenlemeye devam et",
        exact: true,
      }),
    ).toBeFocused();
    if (index === 1) await page.keyboard.press("Escape");
    else if (index === 2) await page.mouse.click(2, 2);
    else
      await confirmation
        .getByRole("button", { name: "Düzenlemeye devam et", exact: true })
        .click();
    await expect(confirmation).toHaveCount(0);
    await expect(dialog.getByLabel(label, { exact: true })).toHaveValue(draft);
    await dialog.getByLabel(label, { exact: true }).fill(original);
  }
  await dialog.getByRole("button", { name: "Kapat", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(confirmation).toHaveCount(0);

  await openSettings(page);
  await dialog.getByLabel("Hakkında", { exact: true }).fill("Bırakılan taslak");
  await page.keyboard.press("Escape");
  await confirmation
    .getByRole("button", { name: "Değişiklikleri bırak", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const current = (await (
    await page.request.get("/api/auth/me")
  ).json()) as Bootstrap;
  expect(current.user.bio || "").toBe(data.user.bio || "");
  await openSettings(page);
  await expect(dialog.getByLabel("Hakkında", { exact: true })).toHaveValue(
    data.user.bio || "",
  );
});

test("an unapplied photo stays guarded after saving text and explicit preview cancellation clears it", async ({
  page,
}) => {
  await account(page);
  const dialog = await openSettings(page);
  let uploads = 0;
  page.on("request", (request) => {
    if (
      request.url().endsWith("/api/profile/avatar") &&
      request.method() === "POST"
    )
      uploads++;
  });
  await dialog
    .getByLabel("Profil fotoğrafı seç", { exact: true })
    .setInputFiles(await photo());
  const preview = dialog.getByRole("img", {
    name: "Yeni profil fotoğrafının önizlemesi",
  });
  await expect(preview).toBeVisible();
  const source = await preview.getAttribute("src");
  await page.keyboard.press("Escape");
  const confirmation = discardConfirmation(page);
  await expect(confirmation).toContainText(
    "Seçtiğin fotoğraf henüz kaydedilmedi.",
  );
  await confirmation
    .getByRole("button", { name: "Düzenlemeye devam et", exact: true })
    .click();
  await expect(preview).toHaveAttribute("src", source!);
  await dialog
    .getByLabel("Hakkında", { exact: true })
    .fill("Kaydedilmiş tanıtım");
  await dialog
    .getByRole("button", { name: "Değişiklikleri kaydet", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toHaveText("Profilin güncellendi.");
  await page.keyboard.press("Escape");
  await expect(confirmation).toContainText(
    "Seçtiğin fotoğraf henüz kaydedilmedi.",
  );
  await expect(confirmation).not.toContainText(
    "Profil bilgilerindeki düzenlemeler",
  );
  await confirmation
    .getByRole("button", { name: "Düzenlemeye devam et", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Vazgeç", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(confirmation).toHaveCount(0);
  expect(uploads).toBe(0);
  const current = (await (
    await page.request.get("/api/auth/me")
  ).json()) as Bootstrap;
  expect(current.user.bio).toBe("Kaydedilmiş tanıtım");
  expect(current.user.avatarUrl).toBeFalsy();

  await openSettings(page);
  await dialog
    .getByLabel("Profil fotoğrafı seç", { exact: true })
    .setInputFiles(await photo());
  await page.keyboard.press("Escape");
  await confirmation
    .getByRole("button", { name: "Değişiklikleri bırak", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await openSettings(page);
  await expect(
    dialog.getByRole("img", { name: "Yeni profil fotoğrafının önizlemesi" }),
  ).toHaveCount(0);
  expect(uploads).toBe(0);
  await dialog
    .getByLabel("Profil fotoğrafı seç", { exact: true })
    .setInputFiles(await photo());
  await dialog
    .getByRole("button", { name: "Fotoğrafı kaydet", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toHaveText(
    "Profil fotoğrafın güncellendi.",
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(confirmation).toHaveCount(0);
  expect(uploads).toBe(1);
});

for (const action of ["profile", "photo"] as const) {
  test(`${action} saving blocks accidental exit and a failed request keeps the draft guarded`, async ({
    page,
  }) => {
    await account(page);
    const dialog = await openSettings(page);
    const endpoint =
      action === "profile" ? "**/api/profile" : "**/api/profile/avatar";
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = false;
    await page.route(endpoint, async (route) => {
      started = true;
      await gate;
      await route.fulfill({
        status: 503,
        json: { error: "Kayıt tamamlanamadı. Yeniden dene." },
      });
    });
    if (action === "profile")
      await dialog
        .getByLabel("Unvanın", { exact: true })
        .fill("Korunan taslak");
    else
      await dialog
        .getByLabel("Profil fotoğrafı seç", { exact: true })
        .setInputFiles(await photo());
    await dialog
      .getByRole("button", {
        name:
          action === "profile" ? "Değişiklikleri kaydet" : "Fotoğrafı kaydet",
        exact: true,
      })
      .click();
    try {
      await expect.poll(() => started).toBe(true);
      await dialog.getByRole("button", { name: "Kapat", exact: true }).click();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      await expect(discardConfirmation(page)).toHaveCount(0);
      await expect(
        dialog.getByRole("button", { name: "Çıkış yap", exact: true }),
      ).toBeDisabled();
      await expect(
        dialog.getByRole("button", {
          name: "Yönetim panelini aç",
          exact: true,
          includeHidden: true,
        }),
      ).toBeDisabled();
    } finally {
      release();
    }
    await expect(dialog.getByRole("alert")).toContainText("Yeniden dene");
    await page.keyboard.press("Escape");
    const confirmation = discardConfirmation(page);
    await expect(confirmation).toBeVisible();
    await confirmation
      .getByRole("button", { name: "Düzenlemeye devam et", exact: true })
      .click();
    if (action === "profile")
      await expect(dialog.getByLabel("Unvanın", { exact: true })).toHaveValue(
        "Korunan taslak",
      );
    else
      await expect(
        dialog.getByRole("img", {
          name: "Yeni profil fotoğrafının önizlemesi",
        }),
      ).toBeVisible();
  });
}

for (const destination of ["logout", "manage"] as const) {
  test(`dirty profile asks before ${destination} and continues only after explicit discard`, async ({
    page,
  }) => {
    const data = await account(page);
    const dialog = await openSettings(page);
    const label =
      destination === "logout" ? "Çıkış yap" : "Yönetim panelini aç";
    await dialog
      .getByLabel("Konumun", { exact: true })
      .fill("Kaydedilmemiş konum");
    if (destination === "manage")
      await dialog
        .getByRole("tab", { name: "Çalışma alanı", exact: true })
        .click();
    await dialog.getByRole("button", { name: label, exact: true }).click();
    const confirmation = discardConfirmation(page);
    await expect(confirmation).toContainText(
      destination === "logout"
        ? "hesabından çıkış yapılacak"
        : "yönetim paneli açılacak",
    );
    await confirmation
      .getByRole("button", { name: "Kapat", exact: true })
      .click();
    await expect(confirmation).toHaveCount(0);
    await expect(dialog.getByLabel("Konumun", { exact: true })).toHaveValue(
      "Kaydedilmemiş konum",
    );
    const current = (await (
      await page.request.get("/api/auth/me")
    ).json()) as Bootstrap;
    expect(current.user.id).toBe(data.user.id);
    expect(current.user.location || "").toBe(data.user.location || "");
    await dialog.getByRole("button", { name: label, exact: true }).click();
    await confirmation
      .getByRole("button", { name: "Değişiklikleri bırak", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    if (destination === "logout") {
      await expect(
        page.getByRole("heading", { name: "Tekrar hoş geldin.", exact: true }),
      ).toBeVisible();
      expect((await page.request.get("/api/auth/me")).status()).toBe(401);
    } else {
      await expect(page.getByRole("dialog", { name: /Yönetim/ })).toBeVisible();
      const saved = (await (
        await page.request.get("/api/auth/me")
      ).json()) as Bootstrap;
      expect(saved.user.location || "").toBe(data.user.location || "");
    }
  });
}
