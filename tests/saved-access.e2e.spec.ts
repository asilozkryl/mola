import {
  expect,
  request,
  test,
  type APIRequestContext,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { Bootstrap, Channel, Message } from "../shared/types";

const origin = "http://127.0.0.1:5174";
const headers = { Origin: origin };
async function register(
  api: APIRequestContext,
  name: string,
  inviteToken?: string,
) {
  const response = await api.post("/api/auth/register", {
    headers,
    data: {
      name,
      email: `saved-access-${randomUUID()}@example.invalid`,
      password: "saved-access-browser-password",
      workspaceName: "Kayıt Erişim Ekibi",
      ...(inviteToken ? { inviteToken } : {}),
    },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as Bootstrap;
}

test("a denied saved source disappears before delayed access refresh and returns only after access is restored", async ({
  page,
}) => {
  const ownerApi = await request.newContext({ baseURL: origin });
  let release!: () => void;
  let held = true;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const owner = await register(ownerApi, "Kanal Sahibi");
    const invitation = await ownerApi.post("/api/invites", { headers });
    expect(invitation.status()).toBe(201);
    const inviteToken = new URL((await invitation.json()).url).searchParams.get(
      "invite",
    )!;
    const member = await register(page.request, "Kayıt Okuyucusu", inviteToken);
    const created = await ownerApi.post("/api/channels", {
      headers,
      data: {
        name: "ozel-kayit-erisim",
        kind: "text",
        visibility: "private",
        memberIds: [owner.user.id, member.user.id],
      },
    });
    expect(created.status()).toBe(201);
    const channel = (await created.json()) as Channel;
    const posted = await ownerApi.post(`/api/channels/${channel.id}/messages`, {
      headers,
      data: {
        content: `Yalnız izin verilen üyelerin görebileceği kayıt ${randomUUID()}`,
      },
    });
    expect(posted.status()).toBe(201);
    const message = (await posted.json()) as Message;
    expect(
      (
        await page.request.put(`/api/saved/${message.id}`, { headers })
      ).status(),
    ).toBe(200);
    await page.goto(`/?workspace=${member.workspace.id}&view=saved`);
    const center = page.getByRole("region", {
      name: "Kaydedilen mesajlar",
      exact: true,
    });
    const article = center.locator(`article[data-message-id="${message.id}"]`);
    await expect(article).toBeVisible();
    await expect(
      page.getByText("Her şey güncel", { exact: true }),
    ).toBeAttached();
    const refresh = center.getByRole("button", {
      name: "Kaydedilenleri yenile",
      exact: true,
    });
    await expect(refresh).toBeEnabled();
    const synchronized = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/saved",
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    expect(await (await synchronized).finished()).toBeNull();
    await expect(refresh).toBeEnabled();

    let accessRequested!: () => void;
    const accessRefresh = new Promise<void>((resolve) => {
      accessRequested = resolve;
    });
    // Prevent both access and Saved refresh from removing the stale row first.
    // The denied source response must invalidate the already-rendered content.
    await page.route(
      /\/api\/(?:auth\/me|saved(?:\/ids)?)(?:\?.*)?$/,
      async (route) => {
        if (!held) return route.continue();
        if (new URL(route.request().url()).pathname === "/api/auth/me")
          accessRequested();
        await gate;
        await route.continue().catch(() => {});
      },
    );
    const deletions: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "DELETE" &&
        new URL(request.url()).pathname === `/api/saved/${message.id}`
      )
        deletions.push(request.url());
    });
    const revoke = await ownerApi.patch(`/api/channels/${channel.id}/access`, {
      headers,
      data: { visibility: "private", memberIds: [owner.user.id] },
    });
    expect(revoke.status()).toBe(200);
    await accessRefresh;
    await expect(article).toBeVisible();
    const denied = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/messages/${message.id}`,
    );
    await center
      .getByRole("button", {
        name: "ozel-kayit-erisim içindeki mesaja git",
        exact: true,
      })
      .click();
    expect((await denied).status()).toBe(404);
    await expect(article).toHaveCount(0);
    await expect(page.getByText(message.content, { exact: true })).toHaveCount(
      0,
    );
    await expect(center.getByRole("alert")).toContainText("Mesaj bulunamadı");
    expect(deletions).toHaveLength(0);
    held = false;
    release();
    await expect(
      page.getByRole("button", { name: "ozel-kayit-erisim", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Her şey güncel", { exact: true }),
    ).toBeAttached();
    const restore = await ownerApi.patch(`/api/channels/${channel.id}/access`, {
      headers,
      data: {
        visibility: "private",
        memberIds: [owner.user.id, member.user.id],
      },
    });
    expect(restore.status()).toBe(200);
    await expect
      .poll(
        async () =>
          (await (await page.request.get("/api/saved/ids")).json()).ids,
      )
      .toContain(message.id);
    await expect(article).toBeVisible();
    expect(deletions).toHaveLength(0);
  } finally {
    held = false;
    release();
    await ownerApi.dispose();
  }
});
