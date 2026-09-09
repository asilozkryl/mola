import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { Bootstrap, Channel, Message } from "../shared/types";

const origin = "http://127.0.0.1:5174";
const headers = { Origin: origin };

async function account(page: Page, name: string, inviteToken?: string) {
  const response = await page.request.post("/api/auth/register", {
    headers,
    data: {
      name,
      email: `consistency-${randomUUID()}@example.invalid`,
      password: "conversation-consistency-password",
      workspaceName: "Tutarlı konuşmalar",
      ...(inviteToken ? { inviteToken } : {}),
    },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as Bootstrap;
}

async function ready(page: Page) {
  await page.goto("/");
  await expect(
    page.getByText("Her şey güncel", { exact: true }),
  ).toBeAttached();
}

const savedSource = (page: Page) => page.locator(".saved-channel-label");

test("search and saved sources resolve the other participant for both DM members and follow profile renames", async ({
  page,
  browser,
}) => {
  const owner = await account(page, "Aslı Demir");
  const invited = await page.request.post("/api/invites", { headers });
  expect(invited.status()).toBe(201);
  const token = new URL((await invited.json()).url).searchParams.get("invite")!;
  const otherContext = await browser.newContext({ baseURL: origin });
  const other = await otherContext.newPage();
  try {
    const peer = await account(other, "Deniz Kaya", token);
    const created = await page.request.post("/api/dms", {
      headers,
      data: { userId: peer.user.id },
    });
    expect(created.status()).toBe(201);
    const direct = (await created.json()) as Channel;
    const posted = await page.request.post(
      `/api/channels/${direct.id}/messages`,
      {
        headers,
        data: { content: "Özel konuşmanın kaynak etiketi" },
      },
    );
    expect(posted.status()).toBe(201);
    const message = (await posted.json()) as Message;
    for (const [viewer, peerName, ownName] of [
      [page, peer.user.name, owner.user.name],
      [other, owner.user.name, peer.user.name],
    ] as const) {
      await ready(viewer);
      await viewer.keyboard.press("Control+k");
      const search = viewer.getByRole("dialog", {
        name: "Çalışma alanında ara",
        exact: true,
      });
      await expect(search.locator(`option[value="${direct.id}"]`)).toHaveText(
        `Özel mesaj · ${peerName}`,
      );
      await search
        .getByRole("textbox", { name: "Mesajlarda ara", exact: true })
        .fill("kaynak etiketi");
      const result = search
        .locator(".search-result")
        .filter({ hasText: message.content });
      await expect(result.locator(".search-result-channel")).toContainText(
        peerName,
      );
      await expect(result.locator(".search-result-channel")).not.toContainText(
        ownName,
      );
      await result.click();
      const article = viewer.locator(
        `.conversation-panel article[data-message-id="${message.id}"]`,
      );
      await expect(article).toBeVisible();
      await article.press("Shift+F10");
      await viewer
        .getByRole("menuitem", { name: "Mesajı kaydet", exact: true })
        .click();
      await viewer
        .locator("#workspace-navigation")
        .getByRole("button", { name: /^Kaydedilenler(?: \d+)?$/ })
        .click();
      await expect(savedSource(viewer)).toHaveText(peerName);
      await expect(
        savedSource(viewer).locator("svg.lucide-message-circle"),
      ).toHaveCount(1);
    }
    expect(
      (
        await page.request.patch("/api/profile", {
          headers,
          data: { name: "Aslı Güncel" },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await other.request.patch("/api/profile", {
          headers,
          data: { name: "Deniz Güncel" },
        })
      ).ok(),
    ).toBe(true);
    await expect(savedSource(page)).toHaveText("Deniz Güncel");
    await expect(savedSource(other)).toHaveText("Aslı Güncel");
    await page.keyboard.press("Control+k");
    const search = page.getByRole("dialog", {
      name: "Çalışma alanında ara",
      exact: true,
    });
    await expect(search.locator(`option[value="${direct.id}"]`)).toHaveText(
      "Özel mesaj · Deniz Güncel",
    );
    await search
      .getByRole("textbox", { name: "Mesajlarda ara", exact: true })
      .fill("kaynak etiketi");
    await expect(search.locator(".search-result-channel")).toContainText(
      "Deniz Güncel",
    );
    await page.screenshot({
      path: "artifacts/search-direct-source.png",
      animations: "disabled",
    });
  } finally {
    await otherContext.close();
  }
});

test("the topbar names local alerts explicitly and does not change the account push preference", async ({
  page,
}) => {
  await account(page, "Bildirim Kapsamı");
  await ready(page);
  const readPreference = async () => {
    const result = await page.request.get("/api/notifications/preferences");
    expect(result.status()).toBe(200);
    return result.json();
  };
  const before = await readPreference();
  const toggle = page.getByRole("button", {
    name: "Uygulama içi uyarıları sustur",
    exact: true,
  });
  await toggle.click();
  await expect(
    page.getByRole("button", {
      name: "Uygulama içi uyarıları aç",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByText(
      "Uygulama içi uyarılar susturuldu. Tarayıcı bildirimleri kendi ayarını kullanır.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(await readPreference()).toEqual(before);
  await page.reload();
  const enable = page.getByRole("button", {
    name: "Uygulama içi uyarıları aç",
    exact: true,
  });
  await expect(enable).toHaveAttribute("aria-pressed", "true");
  await enable.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(await readPreference()).toEqual(before);
});
