import {
  expect,
  test,
  type Page,
  type Request as BrowserRequest,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import type { Attachment, Bootstrap, Channel, Message } from "../shared/types";

const origin = "http://127.0.0.1:5174";
const headers = { Origin: origin };
const panel = (page: Page) => page.locator(".conversation-panel");
const collectionTab = (page: Page, name: string) =>
  panel(page).getByRole("tab", { name, exact: true });
const temporaryError = "Koleksiyon şu anda yüklenemiyor. Lütfen yeniden dene.";

async function addContent(page: Page, channel: Channel, label: string) {
  const uploaded = await page.request.post("/api/uploads", {
    headers,
    multipart: {
      file: {
        name: `${label}-kararlari.txt`,
        mimeType: "text/plain",
        buffer: Buffer.from(`${label} için kaydedilen kararlar.`),
      },
    },
  });
  expect(uploaded.status()).toBe(201);
  const file = (await uploaded.json()) as Attachment;
  const sent = await page.request.post(`/api/channels/${channel.id}/messages`, {
    headers,
    data: {
      content: `${label} için sabitlenen karar ve gerçek dosya.`,
      attachmentIds: [file.id],
    },
  });
  expect(sent.status()).toBe(201);
  const message = (await sent.json()) as Message;
  const pinned = await page.request.patch(`/api/messages/${message.id}`, {
    headers,
    data: { pinned: true },
  });
  expect(pinned.status()).toBe(200);
  return { file, message };
}

async function fixture(page: Page) {
  const registered = await page.request.post("/api/auth/register", {
    headers,
    data: {
      name: "Deniz Koleksiyon",
      email: `collection-state-${randomUUID()}@example.invalid`,
      password: "collection-state-browser-password",
      workspaceName: "Koleksiyon Ekibi",
    },
  });
  expect(registered.status()).toBe(200);
  const data = (await registered.json()) as Bootstrap;
  const channel = data.channels.find((value) => value.name === "genel")!;
  const content = await addContent(page, channel, "ekip");
  return { data, channel, ...content };
}

async function openWorkspace(page: Page) {
  await page.goto("/");
  await expect(
    panel(page).getByRole("textbox", {
      name: "#genel kanalına mesaj yaz",
      exact: true,
    }),
  ).toBeVisible();
}

function assertScope(request: BrowserRequest, data: Bootstrap) {
  expect(request.headers()["x-workspace-id"]).toBe(data.workspace.id);
  expect(request.headers()["x-user-id"]).toBe(data.user.id);
}

async function audit(page: Page) {
  const result = await new AxeBuilder({ page })
    .include(".conversation-panel")
    .analyze();
  expect(
    result.violations
      .filter((item) => item.impact === "serious" || item.impact === "critical")
      .map((item) => ({
        id: item.id,
        nodes: item.nodes.map((node) => node.failureSummary),
      })),
  ).toEqual([]);
}

test("320px files show a retryable failure instead of an empty collection and recover the stored file", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: 320, height: 720 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    const { data, channel, file } = await fixture(page);
    const path = `/api/channels/${channel.id}/files`;
    let unavailable = true;
    await page.route(`**${path}`, (route) =>
      unavailable
        ? route.fulfill({ status: 503, json: { error: temporaryError } })
        : route.continue(),
    );
    await openWorkspace(page);
    const failedRequest = page.waitForRequest((request) =>
      request.url().endsWith(path),
    );
    await collectionTab(page, "Dosyalar").tap();
    assertScope(await failedRequest, data);
    const error = panel(page).getByRole("alert", {
      name: "Dosyalar yüklenemedi",
      exact: true,
    });
    await expect(error).toBeVisible();
    await expect(error).toContainText(temporaryError);
    await expect(
      panel(page).getByRole("heading", {
        name: "İlk dosyaya yer açtık.",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(panel(page).locator(".channel-file-list")).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320);
    const retry = error.getByRole("button", {
      name: "Yeniden dene",
      exact: true,
    });
    const bounds = (await retry.boundingBox())!;
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
    await audit(page);
    await page.screenshot({
      path: "artifacts/collection-error-mobile.png",
      animations: "disabled",
    });
    unavailable = false;
    const recovered = page.waitForResponse((response) =>
      response.url().endsWith(path),
    );
    await retry.tap();
    const response = await recovered;
    expect(response.status()).toBe(200);
    assertScope(response.request(), data);
    await expect(error).toHaveCount(0);
    const link = panel(page)
      .locator(".channel-file-list")
      .getByRole("link")
      .filter({ hasText: file.name });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", file.url);
    expect((await page.request.get(file.url)).status()).toBe(200);
  } finally {
    await context.close();
  }
});

test("pinned messages show a retryable failure instead of an empty collection and recover the stored pin", async ({
  page,
}) => {
  const { data, channel, message } = await fixture(page);
  const path = `/api/channels/${channel.id}/pins`;
  let unavailable = true;
  await page.route(`**${path}`, (route) =>
    unavailable
      ? route.fulfill({ status: 503, json: { error: temporaryError } })
      : route.continue(),
  );
  await openWorkspace(page);
  const failedRequest = page.waitForRequest((request) =>
    request.url().endsWith(path),
  );
  await collectionTab(page, "Sabitlenenler").click();
  assertScope(await failedRequest, data);
  const error = panel(page).getByRole("alert", {
    name: "Sabitlenen mesajlar yüklenemedi",
    exact: true,
  });
  await expect(error).toBeVisible();
  await expect(error).toContainText(temporaryError);
  await expect(
    panel(page).getByRole("heading", {
      name: "Henüz sabitlenen mesaj yok.",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(panel(page).locator("article[data-message-id]")).toHaveCount(0);
  await audit(page);
  await page.screenshot({
    path: "artifacts/collection-error-desktop.png",
    animations: "disabled",
  });
  unavailable = false;
  const recovered = page.waitForResponse((response) =>
    response.url().endsWith(path),
  );
  const retry = error.getByRole("button", {
    name: "Yeniden dene",
    exact: true,
  });
  await retry.focus();
  await page.keyboard.press("Enter");
  const response = await recovered;
  expect(response.status()).toBe(200);
  assertScope(response.request(), data);
  await expect(error).toHaveCount(0);
  await expect(panel(page).locator(".message-scroll")).toBeFocused();
  const pinned = panel(page).locator(
    `article[data-message-id="${message.id}"]`,
  );
  await expect(pinned).toHaveClass(/message-pinned/);
  await expect(pinned.locator(".message-text")).toHaveText(message.content);
});

test("a delayed file retry keeps the composer focused when the user starts writing", async ({
  page,
}) => {
  const { data, channel, file } = await fixture(page);
  const path = `/api/channels/${channel.id}/files`;
  let unavailable = true;
  let release!: () => void;
  let captured!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const responseReady = new Promise<void>((resolve) => {
    captured = resolve;
  });
  await page.route(`**${path}`, async (route) => {
    if (unavailable)
      return route.fulfill({ status: 503, json: { error: temporaryError } });
    const response = await route.fetch();
    captured();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await openWorkspace(page);
    await collectionTab(page, "Dosyalar").click();
    const error = panel(page).getByRole("alert", {
      name: "Dosyalar yüklenemedi",
      exact: true,
    });
    await expect(error).toBeVisible();
    unavailable = false;
    const retryRequest = page.waitForRequest((request) =>
      request.url().endsWith(path),
    );
    await error
      .getByRole("button", { name: "Yeniden dene", exact: true })
      .click();
    assertScope(await retryRequest, data);
    await responseReady;
    const loading = panel(page).getByText("Sohbet yükleniyor", { exact: true });
    await expect(loading).toBeVisible();
    const composer = panel(page).getByRole("textbox", {
      name: "#genel kanalına mesaj yaz",
      exact: true,
    });
    const draft = "Dosyalar yüklenirken bu mesaja devam ediyorum.";
    await composer.fill(draft);
    await expect(composer).toBeFocused();
    await expect(loading).toBeVisible();

    const recovered = page.waitForResponse((response) =>
      response.url().endsWith(path),
    );
    release();
    const response = await recovered;
    expect(response.status()).toBe(200);
    expect(await response.finished()).toBeNull();
    await expect(panel(page).locator(".channel-file-list")).toContainText(
      file.name,
    );
    await expect(loading).toHaveCount(0);
    await expect(error).toHaveCount(0);
    // Retry completion schedules focus restoration on the next animation frame.
    // Wait for that callback before checking that it did not steal typing focus.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(composer).toBeFocused();
    await expect(composer).toHaveValue(draft);
    await expect(panel(page).locator(".message-scroll")).not.toBeFocused();
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("late file failures cannot replace pins, chat or another channel's collection", async ({
  page,
}) => {
  const { data, channel, file, message } = await fixture(page);
  const created = await page.request.post("/api/channels", {
    headers,
    data: { name: "ikinci-koleksiyon", kind: "text" },
  });
  expect(created.status()).toBe(201);
  const other = (await created.json()) as Channel;
  const otherContent = await addContent(page, other, "ikinci-ekip");
  const path = `/api/channels/${channel.id}/files`;
  // Simulate a transport that has already accepted the request: cancelling the
  // effect cannot stop this response. The stale-result guard must still reject it.
  await page.addInitScript(
    ({ delayedPath }) => {
      const fetch = window.fetch.bind(window);
      window.fetch = (input, options) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        return new URL(url, location.href).pathname === delayedPath
          ? fetch(input, { ...options, signal: undefined })
          : fetch(input, options);
      };
    },
    { delayedPath: path },
  );
  await openWorkspace(page);

  for (const destination of ["pins", "chat", "channel"] as const) {
    await test.step(`files → ${destination} while the old request is in flight`, async () => {
      await collectionTab(page, "Sohbet").click();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route(`**${path}`, async (route) => {
        await gate;
        await route.fulfill({
          status: 503,
          json: { error: `Eski dosya yanıtı: ${destination}` },
        });
      });
      try {
        const pending = page.waitForRequest((request) =>
          request.url().endsWith(path),
        );
        await collectionTab(page, "Dosyalar").click();
        assertScope(await pending, data);
        await expect(
          panel(page).getByText("Sohbet yükleniyor", { exact: true }),
        ).toBeVisible();
        if (destination === "pins") {
          await collectionTab(page, "Sabitlenenler").click();
          await expect(
            panel(page).locator(`article[data-message-id="${message.id}"]`),
          ).toBeVisible();
        } else if (destination === "chat") {
          await collectionTab(page, "Sohbet").click();
          await expect(
            panel(page).getByRole("textbox", {
              name: "#genel kanalına mesaj yaz",
              exact: true,
            }),
          ).toBeVisible();
        } else {
          await page
            .locator("#workspace-navigation .channel-nav")
            .filter({ hasText: other.name })
            .click();
          const nextRequest = page.waitForRequest((request) =>
            request.url().endsWith(`/api/channels/${other.id}/files`),
          );
          await collectionTab(page, "Dosyalar").click();
          assertScope(await nextRequest, data);
          await expect(panel(page).locator(".channel-file-list")).toContainText(
            otherContent.file.name,
          );
        }
        const lateResponse = page.waitForResponse((response) =>
          response.url().endsWith(path),
        );
        release();
        const delivered = await lateResponse;
        expect(delivered.status()).toBe(503);
        expect(await delivered.finished()).toBeNull();
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            ),
        );
        await expect(panel(page).getByRole("alert")).toHaveCount(0);
        await expect(panel(page)).not.toContainText(
          `Eski dosya yanıtı: ${destination}`,
        );
        if (destination === "channel") {
          await expect(collectionTab(page, "Dosyalar")).toHaveAttribute(
            "aria-selected",
            "true",
          );
          await expect(panel(page).locator(".channel-file-list")).toContainText(
            otherContent.file.name,
          );
          await expect(
            panel(page)
              .locator(".channel-file-list")
              .getByText(file.name, { exact: true }),
          ).toHaveCount(0);
        } else {
          await expect(
            collectionTab(
              page,
              destination === "pins" ? "Sabitlenenler" : "Sohbet",
            ),
          ).toHaveAttribute("aria-selected", "true");
          await expect(
            panel(page).locator(
              `article[data-message-id="${message.id}"] .message-text`,
            ),
          ).toHaveText(message.content);
        }
      } finally {
        release();
        await page.unrouteAll({ behavior: "wait" });
      }
    });
  }
});
