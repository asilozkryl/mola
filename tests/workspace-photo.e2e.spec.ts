import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { Bootstrap } from "../shared/types";

const origin = "http://127.0.0.1:5174";

async function account(page: Page) {
  const response = await page.request.post("/api/auth/register", {
    headers: { Origin: origin },
    data: {
      name: "Fotoğraf Yöneticisi",
      email: `workspace-photo-${randomUUID()}@example.invalid`,
      password: "workspace-photo-browser-password-123",
      workspaceName: "Fotoğraf Ekibi",
    },
  });
  expect(response.status()).toBe(200);
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: /kanalına mesaj yaz/ }),
  ).toBeVisible();
  return (await response.json()) as Bootstrap;
}

async function openSettings(page: Page) {
  const management = page.getByRole("button", {
    name: "Yönetim paneli",
    exact: true,
  });
  if (await management.isVisible()) {
    await management.click();
  } else {
    const menu = page.getByRole("button", {
      name: "Çalışma alanı menüsü",
      exact: true,
    });
    if (!(await menu.isVisible()))
      await page
        .getByRole("button", { name: "Gezinmeyi aç", exact: true })
        .click();
    await menu.click();
    await page
      .getByRole("menuitem", { name: "Çalışma alanı ayarları", exact: true })
      .click();
  }
  const dialog = page.getByRole("dialog", {
    name: "Yönetim paneli",
    exact: true,
  });
  await dialog
    .getByRole("button", { name: "Ekip ayarları", exact: true })
    .click();
  const section = dialog.getByRole("region", {
    name: "Çalışma alanı fotoğrafı",
    exact: true,
  });
  await expect(section).toBeVisible();
  return section;
}

async function photo() {
  return {
    name: "ekip.png",
    mimeType: "image/png",
    buffer: await sharp({
      create: { width: 80, height: 80, channels: 3, background: "#8053b8" },
    })
      .png()
      .toBuffer(),
  };
}

test("workspace photo selection is explicit, retries preserve the preview, and save/removal persist", async ({
  page,
}) => {
  const data = await account(page);
  let section = await openSettings(page);
  let uploads = 0;
  await page.route(
    `**/api/workspaces/${data.workspace.id}/avatar`,
    async (route) => {
      expect(route.request().headers()["x-workspace-id"]).toBe(
        data.workspace.id,
      );
      expect(route.request().headers()["x-user-id"]).toBe(data.user.id);
      if (route.request().method() === "POST" && ++uploads === 1)
        return route.fulfill({
          status: 503,
          json: { error: "Fotoğraf kaydedilemedi. Tekrar dene." },
        });
      return route.continue();
    },
  );
  const input = section.getByLabel("Çalışma alanı fotoğrafı seç", {
    exact: true,
  });
  const image = await photo();
  await input.setInputFiles(image);
  await expect(
    section.getByRole("img", {
      name: "Yeni çalışma alanı fotoğrafının önizlemesi",
    }),
  ).toBeVisible();
  await section.getByRole("button", { name: "Vazgeç", exact: true }).click();
  expect(uploads).toBe(0);
  await expect(
    section.getByRole("button", { name: "Fotoğrafı kaydet", exact: true }),
  ).toHaveCount(0);
  await input.setInputFiles(image);
  await section
    .getByRole("button", { name: "Fotoğrafı kaydet", exact: true })
    .click();
  await expect(section.getByRole("alert")).toContainText("Tekrar dene");
  await expect(
    section.getByRole("img", {
      name: "Yeni çalışma alanı fotoğrafının önizlemesi",
    }),
  ).toBeVisible();
  await section
    .getByRole("button", { name: "Fotoğrafı kaydet", exact: true })
    .click();
  await expect(section.getByRole("status")).toHaveText(
    "Çalışma alanı fotoğrafı güncellendi.",
  );
  const saved = (await (
    await page.request.get("/api/auth/me")
  ).json()) as Bootstrap;
  expect(saved.workspace.avatarUrl).toBeTruthy();
  await expect(section.locator(".workspace-avatar img")).toHaveAttribute(
    "src",
    saved.workspace.avatarUrl!,
  );
  await page.reload();
  section = await openSettings(page);
  await expect(section.locator(".workspace-avatar img")).toHaveAttribute(
    "src",
    saved.workspace.avatarUrl!,
  );
  await section
    .getByRole("button", { name: "Fotoğrafı kaldır", exact: true })
    .click();
  await expect(section.getByRole("status")).toHaveText(
    "Çalışma alanı fotoğrafı kaldırıldı.",
  );
  await expect(section.locator(".workspace-avatar img")).toHaveCount(0);
  await expect(section.locator(".workspace-avatar")).toHaveText("FE");
  await page.reload();
  section = await openSettings(page);
  await expect(
    section.getByRole("button", { name: "Fotoğrafı kaldır", exact: true }),
  ).toHaveCount(0);
  const removed = (await (
    await page.request.get("/api/auth/me")
  ).json()) as Bootstrap;
  expect(removed.workspace.avatarUrl).toBeUndefined();
});

test("workspace photo validates files and falls back to initials when a saved photo cannot load", async ({
  page,
}) => {
  const data = await account(page);
  const section = await openSettings(page);
  const input = section.getByLabel("Çalışma alanı fotoğrafı seç", {
    exact: true,
  });
  let uploads = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith(`/workspaces/${data.workspace.id}/avatar`)
    )
      uploads++;
  });
  await input.setInputFiles({
    name: "belge.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  });
  await expect(section.getByRole("alert")).toContainText("PNG, JPEG veya WebP");
  await input.setInputFiles({
    name: "buyuk.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  });
  await expect(section.getByRole("alert")).toContainText("5 MB");
  await input.setInputFiles({
    name: "bozuk.png",
    mimeType: "image/png",
    buffer: Buffer.from("not an image"),
  });
  await expect(section.getByRole("alert")).toContainText("açılamadı");
  await expect(
    section.getByRole("button", { name: "Fotoğrafı kaydet", exact: true }),
  ).toBeDisabled();
  expect(uploads).toBe(0);
  await input.setInputFiles(await photo());
  await section
    .getByRole("button", { name: "Fotoğrafı kaydet", exact: true })
    .click();
  await expect(section.getByRole("status")).toHaveText(
    "Çalışma alanı fotoğrafı güncellendi.",
  );
  await page.route(`**/api/workspaces/${data.workspace.id}/avatar/*`, (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await page.reload();
  const reopened = await openSettings(page);
  await expect(reopened.locator(".workspace-avatar img")).toHaveCount(0);
  await expect(reopened.locator(".workspace-avatar")).toHaveText("FE");
  await expect(
    reopened.getByRole("button", { name: "Fotoğrafı kaldır", exact: true }),
  ).toBeEnabled();
});
