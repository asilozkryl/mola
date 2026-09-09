import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { Bootstrap, Message } from "../shared/types";

const origin = "http://127.0.0.1:5174";
const headers = { Origin: origin };
const password = "saved-messages-browser-password";
const center = (page: Page) =>
  page.getByRole("region", { name: "Kaydedilen mesajlar", exact: true });
async function register(page: Page) {
  const email = `saved-${randomUUID()}@example.invalid`;
  const response = await page.request.post("/api/auth/register", {
    headers,
    data: {
      name: "Kayıt Sahibi",
      email,
      password,
      workspaceName: "Kayıt Ekibi",
    },
  });
  expect(response.status()).toBe(200);
  return { data: (await response.json()) as Bootstrap, email };
}
async function messages(page: Page, data: Bootstrap, count: number) {
  const channel = data.channels.find((item) => item.name === "genel")!;
  const results: Message[] = [];
  for (let offset = 0; offset < count; offset += 10) {
    results.push(
      ...(await Promise.all(
        Array.from(
          { length: Math.min(10, count - offset) },
          async (_, local) => {
            const index = offset + local;
            const response = await page.request.post(
              `/api/channels/${channel.id}/messages`,
              {
                headers,
                data: {
                  content: `${index % 2 === 0 ? "Arşiv araması" : "Karar notu"} ${index}`,
                },
              },
            );
            expect(response.status()).toBe(201);
            return (await response.json()) as Message;
          },
        ),
      )),
    );
  }
  return results;
}
async function openSaved(page: Page) {
  await page.getByRole("button", { name: /^Kaydedilenler(?: \d+)?$/ }).click();
  await expect(center(page)).toBeVisible();
}
async function readIds(page: Page) {
  const response = await page.request.get("/api/saved/ids");
  expect(response.status()).toBe(200);
  return (await response.json()).ids as string[];
}

test("250 local bookmarks migrate completely and a second device can search, paginate and open the source message", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const { data, email } = await register(page);
  const records = await messages(page, data, 250);
  const key = `mola:saved:${data.user.id}:${data.workspace.id}`;
  await page.addInitScript(
    ({ key, records }) => {
      if (sessionStorage.getItem("saved-migration-seeded")) return;
      localStorage.setItem(key, JSON.stringify(records));
      sessionStorage.setItem("saved-migration-seeded", "true");
    },
    { key, records },
  );
  await page.goto("/");
  await expect.poll(async () => (await readIds(page)).length).toBe(250);
  await openSaved(page);
  await expect(center(page).getByRole("status")).toHaveText("250 kayıt");
  await expect(center(page).locator(".saved-center-item")).toHaveCount(50);
  await expect(center(page).locator(".message-text").first()).toHaveText(
    "Karar notu 249",
  );
  expect(
    await page.evaluate((key) => localStorage.getItem(key), key),
  ).toBeNull();

  const device = await browser.newContext();
  try {
    const login = await device.request.post(`${origin}/api/auth/login`, {
      headers,
      data: { email, password },
    });
    expect(login.status()).toBe(200);
    const second = await device.newPage();
    await second.goto(origin);
    await openSaved(second);
    await expect(center(second).getByRole("status")).toHaveText("250 kayıt");
    for (const total of [100, 150, 200, 250]) {
      await center(second)
        .getByRole("button", { name: "Daha fazla göster", exact: true })
        .click();
      await expect(center(second).locator(".saved-center-item")).toHaveCount(
        total,
      );
    }
    await expect(
      center(second).getByRole("button", {
        name: "Daha fazla göster",
        exact: true,
      }),
    ).toHaveCount(0);
    const search = center(second).getByRole("searchbox", {
      name: "Kaydedilen mesajlarda ara",
    });
    await search.fill("Arşiv araması");
    await expect(center(second).getByRole("status")).toHaveText("125 sonuç");
    await expect(center(second).locator(".saved-center-item")).toHaveCount(50);
    await center(second)
      .getByRole("button", { name: "Daha fazla göster", exact: true })
      .click();
    await expect(center(second).locator(".saved-center-item")).toHaveCount(100);
    const source = center(second).locator(".saved-center-item").first();
    await expect(source.locator(".message-text")).toHaveText(
      "Arşiv araması 248",
    );
    await source
      .getByRole("button", { name: "genel içindeki mesaja git", exact: true })
      .click();
    await expect(center(second)).toHaveCount(0);
    await expect(
      second.locator(`article[data-message-id="${records[248].id}"]`),
    ).toBeVisible();
    await expect(
      second.getByRole("textbox", {
        name: "#genel kanalına mesaj yaz",
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await device.close();
  }
});

test("a failed removal keeps the saved message and can be retried without losing the bookmark", async ({
  page,
}) => {
  const { data } = await register(page);
  const [message] = await messages(page, data, 1);
  expect(
    (await page.request.put(`/api/saved/${message.id}`, { headers })).status(),
  ).toBe(200);
  await page.goto("/");
  await openSaved(page);
  const article = center(page).locator(
    `article[data-message-id="${message.id}"]`,
  );
  await expect(article).toBeVisible();
  await page.route(`**/api/saved/${message.id}`, async (route) => {
    if (route.request().method() === "DELETE")
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Kayıt kaldırılamadı. Yeniden dene." }),
      });
    return route.continue();
  });
  await article.hover();
  await article
    .getByRole("button", { name: "Kaydedilenlerden kaldır", exact: true })
    .click();
  await expect(center(page).getByRole("alert")).toContainText(
    "Kayıt kaldırılamadı",
  );
  await expect(article).toBeVisible();
  expect(await readIds(page)).toContain(message.id);
  await page.unroute(`**/api/saved/${message.id}`);
  await article.hover();
  await article
    .getByRole("button", { name: "Kaydedilenlerden kaldır", exact: true })
    .click();
  await expect(article).toHaveCount(0);
  await expect(
    center(page).getByRole("heading", { name: "Kaydettiğin mesajlar burada" }),
  ).toBeVisible();
  expect(await readIds(page)).not.toContain(message.id);
});

test("a delayed ID refresh cannot undo a newer save mutation", async ({
  page,
}) => {
  const { data } = await register(page);
  const [message] = await messages(page, data, 1);
  await page.goto("/");
  const article = page.locator(`article[data-message-id="${message.id}"]`);
  await expect(article).toBeVisible();
  await article.hover();
  await expect(
    article.getByRole("button", { name: "Mesajı kaydet", exact: true }),
  ).toBeEnabled();
  let release!: () => void;
  let capture!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const captured = new Promise<void>((resolve) => {
    capture = resolve;
  });
  let hold = true;
  await page.route("**/api/saved/ids", async (route) => {
    if (!hold) return route.continue();
    const response = await route.fetch();
    capture();
    await gate;
    await route.fulfill({ response }).catch(() => {});
  });
  try {
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await captured;
    await article.hover();
    await article
      .getByRole("button", { name: "Mesajı kaydet", exact: true })
      .click();
    await expect(
      article.getByRole("button", {
        name: "Kaydedilenlerden kaldır",
        exact: true,
      }),
    ).toBeVisible();
    hold = false;
    release();
    await expect.poll(() => readIds(page)).toContain(message.id);
    await expect(
      article.getByRole("button", {
        name: "Kaydedilenlerden kaldır",
        exact: true,
      }),
    ).toBeEnabled();
    await openSaved(page);
    await expect(
      center(page).locator(`article[data-message-id="${message.id}"]`),
    ).toBeVisible();
  } finally {
    hold = false;
    release();
  }
});

test.describe("saved messages on a small touch screen", () => {
  test.use({
    viewport: { width: 320, height: 640 },
    hasTouch: true,
    isMobile: true,
  });
  test("load errors retry, search clears and a source network failure keeps the saved result visible", async ({
    page,
  }) => {
    const { data } = await register(page);
    const [message] = await messages(page, data, 1);
    expect(
      (
        await page.request.put(`/api/saved/${message.id}`, { headers })
      ).status(),
    ).toBe(200);
    await page.route("**/api/saved?*", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Kayıtlar yüklenemedi. Yeniden dene." }),
      }),
    );
    await page.goto("/");
    await page.getByRole("button", { name: "Gezinmeyi aç", exact: true }).tap();
    await openSaved(page);
    await expect(center(page).getByRole("alert")).toContainText(
      "Kayıtlar yüklenemedi",
    );
    await expect(
      center(page).getByRole("heading", {
        name: "Kaydettiğin mesajlar burada",
      }),
    ).toHaveCount(0);
    await page.unroute("**/api/saved?*");
    await center(page)
      .getByRole("button", { name: "Yeniden dene", exact: true })
      .tap();
    await expect(center(page).locator(".saved-center-item")).toHaveCount(1);
    await center(page)
      .getByRole("searchbox", { name: "Kaydedilen mesajlarda ara" })
      .fill("eşleşmeyen kelime");
    await expect(
      center(page).getByRole("heading", { name: "Eşleşen kayıt yok" }),
    ).toBeVisible();
    await center(page)
      .getByRole("button", { name: "Aramayı temizle", exact: true })
      .tap();
    await expect(center(page).locator(".saved-center-item")).toHaveCount(1);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320);
    await page.route(`**/api/messages/${message.id}`, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Mesaj yüklenemedi. Yeniden dene." }),
      }),
    );
    await center(page)
      .getByRole("button", { name: "genel içindeki mesaja git", exact: true })
      .tap();
    await expect(center(page).getByRole("alert")).toContainText(
      "Mesaj yüklenemedi. Yeniden dene.",
    );
    await expect(
      center(page).locator(`article[data-message-id="${message.id}"]`),
    ).toBeVisible();
  });
});
