import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { Bootstrap, Channel, Message } from "../shared/types";

const origin = "http://127.0.0.1:5174";
const headers = { Origin: origin };
const search = (page: Page) =>
  page.getByRole("dialog", { name: "Çalışma alanında ara", exact: true });
const query = (page: Page) =>
  search(page).getByRole("textbox", { name: "Mesajlarda ara", exact: true });
const temporaryError = "Arama geçici olarak kullanılamıyor. Yeniden deneyin.";

async function account(page: Page) {
  const response = await page.request.post("/api/auth/register", {
    headers,
    data: {
      name: "Arama Geçmişi",
      email: `search-history-${randomUUID()}@example.invalid`,
      password: "search-history-browser-password",
      workspaceName: "Arama ve Geçmiş Ekibi",
    },
  });
  expect(response.status()).toBe(200);
  const data = (await response.json()) as Bootstrap;
  return {
    data,
    channel: data.channels.find((item) => item.name === "genel")!,
  };
}

async function post(
  request: APIRequestContext,
  channelId: string,
  content: string,
) {
  const response = await request.post(
    `${origin}/api/channels/${channelId}/messages`,
    { headers, data: { content } },
  );
  expect(response.status()).toBe(201);
  return (await response.json()) as Message;
}

async function open(page: Page, data: Bootstrap, channel: Channel) {
  await page.goto(`/?workspace=${data.workspace.id}&channel=${channel.id}`);
  await expect(
    page.getByRole("textbox", {
      name: `#${channel.name} kanalına mesaj yaz`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Her şey güncel", { exact: true }),
  ).toBeAttached();
}

async function openSearch(page: Page) {
  await page
    .getByRole("button", { name: "Tüm mesajlarda ara", exact: true })
    .click();
  await expect(search(page)).toBeVisible();
}

async function frames(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

test("message history can cross its fifty-message boundary after the boundary message is deleted", async ({
  page,
}) => {
  const { data, channel } = await account(page);
  const messages: Message[] = [];
  for (let index = 0; index < 55; index++)
    messages.push(
      await post(
        page.request,
        channel.id,
        `Geçmiş kaydı ${String(index).padStart(2, "0")}.`,
      ),
    );
  const initialResponse = await page.request.get(
    `/api/channels/${channel.id}/messages`,
  );
  expect(initialResponse.status()).toBe(200);
  const initial = (await initialResponse.json()) as {
    messages: Message[];
    nextCursor: string | null;
    hasMore: boolean;
  };
  expect(initial.messages).toHaveLength(50);
  expect(initial.hasMore).toBe(true);
  expect(initial.nextCursor).toBeTruthy();
  const boundary = initial.messages[0];
  const olderIds = messages
    .filter(
      (message) => !initial.messages.some((item) => item.id === message.id),
    )
    .map((message) => message.id);
  expect(olderIds).toHaveLength(5);
  await open(page, data, channel);
  const rows = page.locator(
    ".conversation-panel .message-scroll article[data-message-id]",
  );
  await expect(rows).toHaveCount(50);
  await expect(
    page.locator(`.conversation-panel [data-message-id="${boundary.id}"]`),
  ).toBeAttached();
  expect(
    (
      await page.request.delete(`/api/messages/${boundary.id}`, { headers })
    ).status(),
  ).toBe(204);
  await expect(
    page.locator(`.conversation-panel [data-message-id="${boundary.id}"]`),
  ).toHaveCount(0);
  await expect(rows).toHaveCount(49);
  const older = page.getByRole("button", {
    name: "Önceki mesajları yükle",
    exact: true,
  });
  const response = page.waitForResponse((candidate) => {
    const url = new URL(candidate.url());
    return (
      url.pathname === `/api/channels/${channel.id}/messages` &&
      url.searchParams.has("cursor")
    );
  });
  await older.click();
  expect((await response).status()).toBe(200);
  await expect(rows).toHaveCount(54);
  const ids = await rows.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-message-id")),
  );
  expect(ids.slice().sort()).toEqual(
    messages
      .filter((message) => message.id !== boundary.id)
      .map((message) => message.id)
      .sort(),
  );
  expect(new Set(ids).size).toBe(54);
  for (const id of olderIds)
    await expect(
      page.locator(`.conversation-panel [data-message-id="${id}"]`),
    ).toBeAttached();
  await expect(older).toHaveCount(0);
  await expect(
    page.locator(".conversation-panel").getByRole("alert"),
  ).toHaveCount(0);
});

test("search retries preserve its page and a newly inserted message does not duplicate or skip older results", async ({
  page,
}) => {
  const { data, channel } = await account(page);
  const seeded: Message[] = [];
  for (let index = 0; index < 51; index++)
    seeded.push(
      await post(
        page.request,
        channel.id,
        `Canlıbulgu arama kaydı ${String(index).padStart(2, "0")}.`,
      ),
    );
  let failInitial = true,
    failNext = true;
  await page.route("**/api/search?**", (route) => {
    const params = new URL(route.request().url()).searchParams;
    expect(route.request().headers()["x-workspace-id"]).toBe(data.workspace.id);
    expect(route.request().headers()["x-user-id"]).toBe(data.user.id);
    if (failInitial || (params.has("cursor") && failNext))
      return route.fulfill({ status: 503, json: { error: temporaryError } });
    return route.continue();
  });
  await open(page, data, channel);
  await openSearch(page);
  await query(page).fill("Canlıbulgu");
  const error = search(page).getByRole("alert");
  await expect(error).toContainText(temporaryError);
  await expect(search(page).locator(".search-empty")).toHaveCount(0);
  failInitial = false;
  await error.getByRole("button", { name: "Tekrar dene", exact: true }).click();
  const rows = search(page).locator(".search-result");
  await expect(rows).toHaveCount(50);
  const firstIds = await rows.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-message-id")),
  );
  expect(new Set(firstIds).size).toBe(50);
  const inserted = await post(
    page.request,
    channel.id,
    "Canlıbulgu sayfalar arasında gelen yeni mesaj.",
  );
  await search(page)
    .getByRole("button", { name: "Sonraki sayfa", exact: true })
    .click();
  await expect(error).toContainText(temporaryError);
  await expect(rows).toHaveCount(50);
  expect(
    await rows.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-message-id")),
    ),
  ).toEqual(firstIds);
  failNext = false;
  await error.getByRole("button", { name: "Tekrar dene", exact: true }).click();
  await expect(error).toHaveCount(0);
  await expect(rows).toHaveCount(1);
  const secondIds = await rows.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-message-id")),
  );
  const all = [...firstIds, ...secondIds];
  expect(new Set(all).size).toBe(51);
  expect(all.slice().sort()).toEqual(
    seeded.map((message) => message.id).sort(),
  );
  expect(all).not.toContain(inserted.id);
  await expect(
    search(page).getByRole("button", { name: "Sonraki sayfa", exact: true }),
  ).toBeDisabled();
  await expect(
    search(page).getByRole("button", { name: "Önceki sayfa", exact: true }),
  ).toBeEnabled();
  await rows.first().click();
  await expect(search(page)).toHaveCount(0);
  const linked = seeded.find((message) => message.id === secondIds[0])!;
  // Older root messages open in the existing thread panel rather than being
  // inserted into a discontinuous recent-history timeline.
  await expect(
    page.locator(`.thread-panel [data-message-id="${linked.id}"]`),
  ).toBeVisible();
  await expect(
    page.locator(
      `.thread-panel [data-message-id="${linked.id}"] .message-text`,
    ),
  ).toHaveText(linked.content);
  expect(new URL(page.url()).searchParams.get("message")).toBe(linked.id);
  expect(new URL(page.url()).searchParams.get("channel")).toBe(channel.id);
});

test("a delivered old search response cannot replace the current query or a reopened search in another workspace", async ({
  page,
}) => {
  const { data: home, channel } = await account(page);
  const old = await post(
    page.request,
    channel.id,
    "Eskisorgu yalnız ilk alana ait sonuç.",
  );
  const fresh = await post(
    page.request,
    channel.id,
    "Yenisorgu güncel ilk alan sonucu.",
  );
  const created = await page.request.post("/api/workspaces", {
    headers,
    data: { name: "Arama İkinci Alan" },
  });
  expect(created.status()).toBe(200);
  const other = (await created.json()) as Bootstrap;
  const otherChannel = other.channels.find((item) => item.name === "genel")!;
  const otherMessage = await post(
    page.request,
    otherChannel.id,
    "Yenisorgu yalnız ikinci alana ait sonuç.",
  );
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      return new URL(url, location.href).pathname === "/api/search"
        ? original(input, { ...options, signal: undefined })
        : original(input, options);
    };
  });
  await open(page, home, channel);
  await openSearch(page);
  for (const destination of ["query", "workspace"] as const) {
    let release: (() => void) | undefined;
    let settled = false;
    await page.route("**/api/search?**", async (route) => {
      if (new URL(route.request().url()).searchParams.get("q") !== "Eskisorgu")
        return route.continue();
      expect(route.request().headers()["x-workspace-id"]).toBe(
        home.workspace.id,
      );
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.messages.map((message: Message) => message.id)).toEqual([
        old.id,
      ]);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.fulfill({ response });
      settled = true;
    });
    try {
      await query(page).fill("Eskisorgu");
      await expect.poll(() => Boolean(release)).toBe(true);
      if (destination === "workspace") {
        await search(page)
          .getByRole("button", { name: "Kapat", exact: true })
          .click();
        await page
          .getByRole("complementary", { name: "Çalışma alanları", exact: true })
          .getByRole("button", {
            name: `${other.workspace.name} alanına geç`,
            exact: true,
          })
          .click();
        await expect(
          page.getByRole("textbox", {
            name: "#genel kanalına mesaj yaz",
            exact: true,
          }),
        ).toBeVisible();
        await openSearch(page);
      }
      await query(page).fill("Yenisorgu");
      const expected = destination === "query" ? fresh : otherMessage;
      await expect(search(page).locator(".search-result")).toHaveCount(1);
      await expect(search(page).locator(".search-result p")).toHaveText(
        expected.content,
      );
      release!();
      release = undefined;
      await expect.poll(() => settled).toBe(true);
      await frames(page);
      await expect(query(page)).toHaveValue("Yenisorgu");
      await expect(search(page).locator(".search-result")).toHaveCount(1);
      await expect(search(page).locator(".search-result p")).toHaveText(
        expected.content,
      );
      await expect(search(page)).not.toContainText(old.content);
      await expect(search(page).getByRole("alert")).toHaveCount(0);
      if (destination === "workspace")
        expect(new URL(page.url()).searchParams.get("workspace")).toBe(
          other.workspace.id,
        );
    } finally {
      release?.();
      await page.unroute("**/api/search?**");
    }
  }
});
