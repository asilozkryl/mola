import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { Bootstrap } from "../shared/types";

async function openWorkspace(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: /kanalına mesaj yaz/ }),
  ).toBeVisible();
  await expect(
    page.getByText("Her şey güncel", { exact: true }),
  ).toBeAttached();
  const response = await page.request.get("/api/auth/me");
  expect(response.status()).toBe(200);
  return (await response.json()) as Bootstrap;
}

function routeFor(data: Bootstrap, userId: string) {
  return `/?workspace=${encodeURIComponent(data.workspace.id)}&profile=${encodeURIComponent(userId)}`;
}

test("message identity shows a compact hover card and opens the matching profile with a shareable route", async ({
  page,
  context,
}) => {
  const data = await openWorkspace(page);
  const trigger = page.locator(".message .profile-identity").first();
  const triggerLabel = await trigger.getAttribute("aria-label");
  const member = data.members.find(
    (user) => `${user.name} profilini görüntüle` === triggerLabel,
  )!;
  expect(member).toBeTruthy();
  await trigger.hover();
  const card = page.getByRole("dialog", {
    name: `${member.name} profil kartı`,
    exact: true,
  });
  await expect(card).toBeVisible();
  await expect(card.getByText(member.email, { exact: true })).toHaveCount(0);
  const bounds = (await card.boundingBox())!;
  expect(bounds.width).toBeLessThanOrEqual(300);
  expect(bounds.height).toBeLessThan(300);
  await card.hover();
  await expect(card).toBeVisible();
  await page.screenshot({
    path: "artifacts/qa-profile-hover.png",
    animations: "disabled",
  });
  await card
    .getByRole("button", { name: "Profili görüntüle", exact: true })
    .click();
  const profile = page.getByRole("region", {
    name: "Üye profili",
    exact: true,
  });
  await expect(profile.getByRole("heading", { level: 1 })).toContainText(
    member.name,
  );
  await expect(profile.getByRole("heading", { level: 1 })).toBeFocused();
  expect(new URL(page.url()).searchParams.get("profile")).toBe(member.id);
  expect(new URL(page.url()).searchParams.get("workspace")).toBe(
    data.workspace.id,
  );
  await expect(card).toHaveCount(0);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await profile
    .getByRole("button", { name: "Profil bağlantısını kopyala", exact: true })
    .click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(new URL(copied).searchParams.get("profile")).toBe(member.id);
  await page.reload();
  await expect(profile.getByRole("heading", { level: 1 })).toContainText(
    member.name,
  );
  await profile
    .getByRole("button", { name: "Sohbete dön", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: /kanalına mesaj yaz/ }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.has("profile")).toBe(false);
});

test("profile previews support keyboard traversal, Escape and viewport dismissal", async ({
  page,
}) => {
  await openWorkspace(page);
  const trigger = page.locator(".message .profile-identity").first();
  await trigger.focus();
  const card = page.locator(".profile-hover-card");
  await expect(card).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    card.getByRole("button", { name: "Profili görüntüle", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.getByRole("textbox", { name: /kanalına mesaj yaz/ }).focus();
  await trigger.hover();
  await expect(card).toBeVisible();
  await page
    .locator(".message-scroll")
    .evaluate((element) =>
      element.dispatchEvent(new Event("scroll", { bubbles: true })),
    );
  await expect(card).toHaveCount(0);
  await page.mouse.move(0, 0);
  await trigger.hover();
  await expect(card).toBeVisible();
  await page.setViewportSize({ width: 900, height: 600 });
  await expect(card).toHaveCount(0);
});

test("profile failures offer retry without showing cached member information", async ({
  page,
}) => {
  const data = await openWorkspace(page);
  let fail = true;
  await page.route(`**/api/members/${data.user.id}/profile`, async (route) => {
    if (fail)
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Profil servisine ulaşılamadı." }),
      });
    else await route.continue();
  });
  await page.goto(routeFor(data, data.user.id));
  const profile = page.getByRole("region", {
    name: "Üye profili",
    exact: true,
  });
  await expect(
    profile.getByRole("heading", {
      name: "Profil görüntülenemiyor",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    profile.getByRole("link", { name: data.user.email, exact: true }),
  ).toHaveCount(0);
  await expect(
    profile.getByRole("button", { name: "Profili düzenle", exact: true }),
  ).toHaveCount(0);
  fail = false;
  await profile
    .getByRole("button", { name: "Yeniden dene", exact: true })
    .click();
  await expect(profile.getByRole("heading", { level: 1 })).toContainText(
    data.user.name,
  );
  await expect(
    profile.getByRole("button", { name: "Profili düzenle", exact: true }),
  ).toBeVisible();
  await expect(
    profile.getByRole("button", { name: "Mesaj gönder", exact: true }),
  ).toHaveCount(0);
});

test("a delayed profile response cannot replace a subsequently opened member", async ({
  page,
}) => {
  const data = await openWorkspace(page);
  const peer = data.members.find(
    (user) => user.id !== data.user.id && !user.suspended && !user.isBot,
  )!;
  let release!: () => void;
  let captured!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    captured = resolve;
  });
  await page.route(`**/api/members/${peer.id}/profile`, async (route) => {
    const response = await route.fetch();
    captured();
    await gate;
    await route.fulfill({ response }).catch(() => {});
  });
  try {
    await page.goto(routeFor(data, peer.id));
    await ready;
    const profile = page.getByRole("region", {
      name: "Üye profili",
      exact: true,
    });
    await expect(
      profile.getByText("Profil yükleniyor", { exact: true }),
    ).toBeVisible();
    await profile
      .getByRole("button", { name: "Sohbete dön", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: `${data.user.name} profilini görüntüle`,
        exact: true,
      })
      .first()
      .click();
    await expect(profile.getByRole("heading", { level: 1 })).toContainText(
      data.user.name,
    );
    release();
    await expect(profile.getByRole("heading", { level: 1 })).toContainText(
      data.user.name,
    );
    expect(new URL(page.url()).searchParams.get("profile")).toBe(data.user.id);
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("profile layout and hover card have no serious accessibility violations", async ({
  page,
}) => {
  const data = await openWorkspace(page);
  await page.goto(routeFor(data, data.user.id));
  await expect(page.locator(".member-profile-name")).toBeVisible();
  const result = await new AxeBuilder({ page })
    .include(".member-profile-page")
    .analyze();
  expect(
    result.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact || ""),
    ),
  ).toEqual([]);
  await page.screenshot({
    path: "artifacts/qa-profile-desktop.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Sohbete dön", exact: true }).click();
  await page.locator(".message .profile-identity").first().focus();
  await expect(page.locator(".profile-hover-card")).toBeVisible();
  await page.locator(".profile-hover-card").evaluate(async (card) => {
    await Promise.all(
      card
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  const hoverResult = await new AxeBuilder({ page })
    .include(".profile-hover-card")
    .analyze();
  expect(
    hoverResult.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact || ""),
    ),
  ).toEqual([]);
});

test.describe("touch profiles", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("tapping a message avatar opens the profile directly and remains usable down to 320px", async ({
    page,
  }) => {
    await openWorkspace(page);
    await page.locator(".message .profile-identity").first().tap();
    const profile = page.getByRole("region", {
      name: "Üye profili",
      exact: true,
    });
    await expect(profile.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator(".profile-hover-card")).toHaveCount(0);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const measurements = await page.evaluate(() => ({
        screen: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth,
      }));
      expect(measurements.content).toBeLessThanOrEqual(measurements.screen + 1);
      await expect(
        profile.getByRole("button", {
          name: "Profil bağlantısını kopyala",
          exact: true,
        }),
      ).toBeVisible();
    }
    await page.screenshot({
      path: "artifacts/qa-profile-mobile.png",
      animations: "disabled",
    });
    await profile
      .getByRole("button", { name: "Sohbete dön", exact: true })
      .tap();
    await expect(
      page.getByRole("textbox", { name: /kanalına mesaj yaz/ }),
    ).toBeVisible();
  });
});

test("the self biography shortcut saves changes back to the open profile", async ({
  page,
}) => {
  const origin = "http://127.0.0.1:5174";
  const registration = await page.request.post("/api/auth/register", {
    headers: { Origin: origin },
    data: {
      name: "Profil Kısayolu",
      email: `profile-shortcut-${randomUUID()}@example.invalid`,
      password: "profile-shortcut-browser-password",
      workspaceName: "Profil Kısayolu Ekibi",
    },
  });
  expect(registration.status()).toBe(200);
  const data = await openWorkspace(page);
  const bio = "Ekip için erişilebilir arayüzler tasarlıyorum.";
  const updatedBio =
    "Ekip için erişilebilir ve anlaşılır arayüzler tasarlıyorum.";
  const changed = await page.request.patch("/api/profile", {
    headers: {
      Origin: origin,
      "X-Workspace-Id": data.workspace.id,
      "X-User-Id": data.user.id,
    },
    data: { bio, jobTitle: "Ürün tasarımcısı", location: "İstanbul" },
  });
  expect(changed.status()).toBe(200);
  await page.goto(routeFor(data, data.user.id));
  const profile = page.getByRole("region", {
    name: "Üye profili",
    exact: true,
  });
  await expect(profile.locator(".member-profile-about")).toContainText(bio);
  await profile.getByRole("button", { name: /Düzenle.*Hakkında/ }).click();
  const settings = page.getByRole("dialog", {
    name: "Kendine ait bir köşe",
    exact: true,
  });
  await expect(settings.getByLabel("Hakkında", { exact: true })).toHaveValue(
    bio,
  );
  await settings.getByLabel("Hakkında", { exact: true }).fill(updatedBio);
  await settings
    .getByRole("button", { name: "Değişiklikleri kaydet", exact: true })
    .click();
  await expect(settings.getByRole("status")).toHaveText(
    "Profilin güncellendi.",
  );
  await settings.getByRole("button", { name: "Kapat", exact: true }).click();
  await expect(settings).toHaveCount(0);
  await expect(profile.locator(".member-profile-about")).toContainText(
    updatedBio,
  );
});
