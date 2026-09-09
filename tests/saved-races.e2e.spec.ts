import {
  expect,
  test,
  type APIResponse,
  type Page,
  type Request as BrowserRequest,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { Bootstrap, Message } from "../shared/types";

const origin = "http://127.0.0.1:5174";
const headers = { Origin: origin };
const center = (page: Page) =>
  page.getByRole("region", { name: "Kaydedilen mesajlar", exact: true });
const article = (page: Page, id: string) =>
  center(page).locator(`article[data-message-id="${id}"]`);
const remove = (page: Page, id: string) =>
  article(page, id).getByRole("button", {
    name: "Kaydedilenlerden kaldır",
    exact: true,
  });

async function fixture(page: Page, count: number) {
  const response = await page.request.post("/api/auth/register", {
    headers,
    data: {
      name: "Kayıt Yarışı",
      email: `saved-races-${randomUUID()}@example.invalid`,
      password: "saved-races-browser-password",
      workspaceName: "Kalıcı Kayıt Ekibi",
    },
  });
  expect(response.status()).toBe(200);
  const data = (await response.json()) as Bootstrap;
  const channel = data.channels.find((value) => value.name === "genel")!;
  const messages: Message[] = [];
  for (let index = 0; index < count; index++) {
    const sent = await page.request.post(
      `/api/channels/${channel.id}/messages`,
      {
        headers,
        data: { content: `Korunacak kayıt ${index + 1}` },
      },
    );
    expect(sent.status()).toBe(201);
    messages.push((await sent.json()) as Message);
  }
  return { data, messages };
}

async function ids(page: Page) {
  const response = await page.request.get("/api/saved/ids");
  expect(response.status()).toBe(200);
  return (await response.json()).ids as string[];
}

async function openSaved(page: Page, data: Bootstrap) {
  await page.goto(`/?workspace=${data.workspace.id}&view=saved`);
  await expect(center(page)).toBeVisible();
}

function scope(request: BrowserRequest, data: Bootstrap) {
  expect(request.headers()["x-workspace-id"]).toBe(data.workspace.id);
  expect(request.headers()["x-user-id"]).toBe(data.user.id);
}

async function rendered(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

test("an old saved page cannot restore a removed bookmark while another removal is still pending", async ({
  page,
}) => {
  const {
    data,
    messages: [first, second],
  } = await fixture(page, 2);
  for (const message of [first, second])
    expect(
      (
        await page.request.put(`/api/saved/${message.id}`, { headers })
      ).status(),
    ).toBe(200);
  // A response already accepted by a transport can outlive cancellation. Deliver
  // it for real so this regression verifies stale-result rejection as well.
  await page.addInitScript(() => {
    const fetch = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      return new URL(url, location.href).pathname === "/api/saved"
        ? fetch(input, { ...options, signal: undefined })
        : fetch(input, options);
    };
  });
  await openSaved(page, data);
  await expect(article(page, first.id)).toBeVisible();
  await expect(article(page, second.id)).toBeVisible();
  const refresh = center(page).getByRole("button", {
    name: "Kaydedilenleri yenile",
    exact: true,
  });
  await expect(refresh).toBeEnabled();
  await expect(
    page.getByText("Her şey güncel", { exact: true }),
  ).toBeAttached();
  // Complete the normal connect/focus refresh before holding the next page;
  // otherwise that unrelated refresh could invalidate the old response itself.
  const synchronized = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/saved",
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  expect(await (await synchronized).finished()).toBeNull();
  await expect(refresh).toBeEnabled();
  let releasePage!: () => void;
  let releaseRemoval!: () => void;
  let capture!: (response: APIResponse) => void;
  let oldRequest: BrowserRequest | undefined;
  let holdPage = true;
  const pageGate = new Promise<void>((resolve) => {
    releasePage = resolve;
  });
  const removalGate = new Promise<void>((resolve) => {
    releaseRemoval = resolve;
  });
  const snapshotReady = new Promise<APIResponse>((resolve) => {
    capture = resolve;
  });
  await page.route(
    (url) => url.pathname === "/api/saved",
    async (route) => {
      if (!holdPage) return route.continue();
      holdPage = false;
      oldRequest = route.request();
      const response = await route.fetch();
      capture(response);
      await pageGate;
      await route.fulfill({ response });
    },
  );
  await page.route(`**/api/saved/${second.id}`, async (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    await removalGate;
    await route.continue();
  });
  try {
    await refresh.click();
    const snapshot = await snapshotReady;
    expect(snapshot.status()).toBe(200);
    expect(
      (await snapshot.json()).items
        .map((message: Message) => message.id)
        .sort(),
    ).toEqual([first.id, second.id].sort());
    scope(oldRequest!, data);
    const secondPending = page.waitForRequest(
      (request) =>
        request.method() === "DELETE" &&
        request.url().endsWith(`/saved/${second.id}`),
    );
    await article(page, second.id).hover();
    await remove(page, second.id).click();
    scope(await secondPending, data);
    await expect(remove(page, second.id)).toBeDisabled();

    const firstRemoved = page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        response.url().endsWith(`/saved/${first.id}`),
    );
    await article(page, first.id).hover();
    await remove(page, first.id).click();
    expect((await firstRemoved).status()).toBe(200);
    await expect(article(page, first.id)).toHaveCount(0);
    expect(await ids(page)).toEqual([second.id]);

    const oldDelivered = page.waitForResponse(
      (response) => response.request() === oldRequest,
    );
    releasePage();
    const delivered = await oldDelivered;
    expect(delivered.status()).toBe(200);
    expect(await delivered.finished()).toBeNull();
    await rendered(page);
    await expect(article(page, first.id)).toHaveCount(0);
    await expect(article(page, second.id)).toBeVisible();
    await expect(remove(page, second.id)).toBeDisabled();
    expect(await ids(page)).toEqual([second.id]);

    const secondRemoved = page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        response.url().endsWith(`/saved/${second.id}`),
    );
    releaseRemoval();
    expect((await secondRemoved).status()).toBe(200);
    await expect(center(page).locator(".saved-center-item")).toHaveCount(0);
    await expect(center(page).getByRole("status")).toHaveText("0 kayıt");
    expect(await ids(page)).toEqual([]);
  } finally {
    releasePage();
    releaseRemoval();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("an unconfirmed legacy import blocks removal until retry, then a removed bookmark stays removed after reload", async ({
  page,
}) => {
  const {
    data,
    messages: [message],
  } = await fixture(page, 1);
  const key = `mola:saved:${data.user.id}:${data.workspace.id}`;
  await page.addInitScript(
    ({ key, message }) => {
      if (sessionStorage.getItem("saved-race-source-seeded")) return;
      localStorage.setItem(key, JSON.stringify([message]));
      sessionStorage.setItem("saved-race-source-seeded", "true");
    },
    { key, message },
  );
  let importAccepted = false;
  let failConfirmation = true;
  let failedConfirmations = 0;
  let deleteRequests = 0;
  page.on("request", (request) => {
    if (
      request.method() === "DELETE" &&
      request.url().endsWith(`/saved/${message.id}`)
    )
      deleteRequests++;
  });
  await page.route("**/api/saved/import", async (route) => {
    const response = await route.fetch();
    if (response.ok()) importAccepted = true;
    await route.fulfill({ response });
  });
  await page.route("**/api/saved/ids", async (route) => {
    if (importAccepted && failConfirmation) {
      failConfirmation = false;
      failedConfirmations++;
      return route.fulfill({
        status: 503,
        json: { error: "Aktarılan kayıtlar şu anda doğrulanamıyor." },
      });
    }
    return route.continue();
  });
  await openSaved(page, data);
  const issue = center(page).getByRole("alert");
  await expect(issue).toContainText("Yerel kayıtların korunuyor");
  expect(failedConfirmations).toBe(1);
  expect(await ids(page)).toEqual([message.id]);
  await expect(article(page, message.id)).toBeVisible();
  await article(page, message.id).hover();
  await expect(remove(page, message.id)).toBeDisabled();
  expect(deleteRequests).toBe(0);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), key),
  ).not.toBeNull();

  await issue
    .getByRole("button", { name: "Yeniden dene", exact: true })
    .click();
  await expect(issue).toHaveCount(0);
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), key))
    .toBeNull();
  await article(page, message.id).hover();
  await expect(remove(page, message.id)).toBeEnabled();
  const removed = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" &&
      response.url().endsWith(`/saved/${message.id}`),
  );
  await remove(page, message.id).click();
  const removal = await removed;
  expect(removal.status()).toBe(200);
  scope(removal.request(), data);
  await expect(article(page, message.id)).toHaveCount(0);
  expect(await ids(page)).toEqual([]);
  await page.reload();
  await expect(center(page).getByRole("status")).toHaveText("0 kayıt");
  await expect(
    center(page).getByRole("heading", {
      name: "Kaydettiğin mesajlar burada",
      exact: true,
    }),
  ).toBeVisible();
  await expect(article(page, message.id)).toHaveCount(0);
  expect(await ids(page)).toEqual([]);
  expect(deleteRequests).toBe(1);
});
