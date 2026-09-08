import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("batch uploads respect the attachment limit and preserve the draft after upload errors", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.getByRole("textbox", { name: /kanalına mesaj yaz/ });
  await expect(input).toBeVisible();
  const composer = page.locator(".composer-ux");
  const fileInput = page.getByLabel("Paylaşılacak dosya", { exact: true });
  const send = page.getByRole("button", { name: "Mesaj gönder", exact: true });
  const text = `Dosyalarla birlikte korunacak taslak ${randomUUID()}`;
  await input.fill(text);

  let releaseUpload!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  await page.route("**/api/uploads", async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await fileInput.setInputFiles(
      Array.from({ length: 5 }, (_, index) => ({
        name: `toplu-${index}.txt`,
        mimeType: "text/plain",
        buffer: Buffer.from(`Dosya ${index}`),
      })),
    );
    await expect(
      composer.getByRole("status").filter({ hasText: /yükleniyor/ }),
    ).toContainText("(1/4)");
    await expect(send).toBeDisabled();
  } finally {
    releaseUpload();
  }

  await expect(composer.locator(".composer-attachments > span")).toHaveCount(4);
  await expect(composer.getByRole("alert")).toContainText("en fazla 4 dosya");
  await expect(fileInput).toBeDisabled();
  await expect(input).toHaveValue(text);
  await composer
    .getByRole("button", {
      name: "toplu-0.txt dosyasını kaldır",
      exact: true,
    })
    .click();

  const oversizedFile = {
    name: "buyuk.txt",
    mimeType: "text/plain",
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 65),
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    await fileInput.setInputFiles(oversizedFile);
    await expect(composer.getByRole("alert")).toContainText("en fazla 10 MB");
    await expect(fileInput).toHaveValue("");
    await expect(input).toHaveValue(text);
    await composer
      .getByRole("button", {
        name: "Dosya ve mesaj uyarısını kapat",
        exact: true,
      })
      .click();
  }

  await fileInput.setInputFiles({
    name: "desteklenmeyen.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.from([0, 1, 2, 3]),
  });
  await expect(composer.getByRole("alert")).toContainText("PNG, JPG");
  await expect(input).toHaveValue(text);
  await expect(composer.locator(".composer-attachments > span")).toHaveCount(3);

  await fileInput.setInputFiles({
    name: "son-dosya.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Dördüncü dosya"),
  });
  await expect(composer.locator(".composer-attachments > span")).toHaveCount(4);
  await expect(composer.getByRole("alert")).toHaveCount(0);
  await send.click();
  const message = page.locator("article[data-message-id]").filter({
    has: page.getByText(text, { exact: true }),
  });
  await expect(message).toBeVisible();
  await expect(message.locator(".file-attachment")).toHaveCount(4);
  await expect(input).toHaveValue("");
  await expect(composer.locator(".composer-attachments")).toHaveCount(0);
});

test.describe("small touch screens", () => {
  test.use({
    viewport: { width: 320, height: 640 },
    hasTouch: true,
    isMobile: true,
  });

  test("pickers stay keyboard accessible and a failed send can be retried without losing text", async ({
    page,
  }) => {
    await page.goto("/");
    const input = page.getByRole("textbox", { name: /kanalına mesaj yaz/ });
    await expect(input).toBeVisible();
    const composer = page.locator(".composer-ux");
    const send = page.getByRole("button", {
      name: "Mesaj gönder",
      exact: true,
    });
    const text = `Telefondan gönderilen mesaj ${randomUUID()}`;
    await input.fill(text);
    await page.getByRole("button", { name: "Emoji ekle", exact: true }).tap();
    await expect(
      page.getByRole("button", { name: "🙌 ekle", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(input).toHaveValue(`${text}🙌`);
    await expect(input).toBeFocused();

    await page
      .getByRole("button", { name: "Birinden bahset", exact: true })
      .tap();
    await expect(
      page.getByRole("group", { name: "Kanal üyeleri", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("group", { name: "Kanal üyeleri", exact: true }),
    ).toHaveCount(0);
    await expect(input).toBeFocused();

    const bounds = await send.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    await page.route(
      "**/api/channels/*/messages",
      (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: "Bağlantı kurulamadı. Yeniden göndermeyi dene.",
          }),
        }),
      { times: 1 },
    );
    await send.tap();
    await expect(composer.getByRole("alert")).toContainText(
      "Bağlantı kurulamadı",
    );
    await expect(input).toHaveValue(`${text}🙌`);
    await expect(send).toBeEnabled();
    await send.tap();
    await expect(
      page.locator("p.message-text").filter({ hasText: text }),
    ).toHaveText(`${text}🙌`);
    await expect(input).toHaveValue("");
    await expect(composer.getByRole("alert")).toHaveCount(0);
  });
});
