import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Bootstrap } from "../shared/types";

const origin = "http://127.0.0.1:5174";
async function register(page: Page, name: string, inviteToken?: string) {
  const response = await page.request.post("/api/auth/register", {
    headers: { Origin: origin },
    data: {
      name,
      email: `permissions-${randomUUID()}@example.invalid`,
      password: "permission-browser-password",
      workspaceName: "Kanal Erişim Ekibi",
      ...(inviteToken ? { inviteToken } : {}),
    },
  });
  expect(response.status()).toBe(200);
  const data = (await response.json()) as Bootstrap;
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: /kanalına mesaj yaz/ }),
  ).toBeVisible();
  await expect(
    page.getByText("Her şey güncel", { exact: true }),
  ).toBeAttached();
  return data;
}

test("owner creates a private channel, grants access and restricts a guest through the interface", async ({
  page,
  browser,
}) => {
  await register(page, "Erişim Yöneticisi");
  const invitation = await page.request.post("/api/invites", {
    headers: { Origin: origin },
  });
  const token = new URL((await invitation.json()).url).searchParams.get(
    "invite",
  )!;
  const context = await browser.newContext({ baseURL: origin });
  const other = await context.newPage();
  try {
    const member = await register(other, "Deniz Misafir", token);
    await page
      .getByRole("button", { name: "Yönetim paneli", exact: true })
      .click();
    const admin = page.getByRole("dialog", {
      name: "Yönetim paneli",
      exact: true,
    });
    await admin.getByRole("button", { name: "Kanallar", exact: true }).click();
    await admin
      .getByRole("button", { name: "Kanal oluştur", exact: true })
      .click();
    const create = page.getByRole("dialog", {
      name: "Yeni kanal",
      exact: true,
    });
    await create.getByLabel("Kanal adı", { exact: true }).fill("özel-proje");
    await create
      .getByLabel("Kanal görünürlüğü", { exact: true })
      .selectOption("private");
    await create
      .getByRole("button", { name: "Kanal oluştur", exact: true })
      .click();
    await expect(create).toHaveCount(0);
    await expect(
      other.getByRole("button", { name: /^özel-proje(?: \d+)?$/ }),
    ).toHaveCount(0);
    const state = (await (
      await page.request.get("/api/auth/me")
    ).json()) as Bootstrap;
    const channel = state.channels.find(
      (channel) => channel.name === "özel-proje",
    )!;
    expect(channel.visibility).toBe("private");
    await page.request.post(`/api/channels/${channel.id}/messages`, {
      headers: { Origin: origin },
      data: { content: "Bu mesajı yalnızca proje üyeleri görebilir." },
    });
    await admin
      .getByRole("button", { name: "özel-proje kanal erişimi", exact: true })
      .click();
    const access = page.getByRole("dialog", {
      name: "özel-proje · Kanal erişimi",
      exact: true,
    });
    await expect(
      access.getByRole("checkbox", {
        name: "Deniz Misafir kanala erişebilsin",
        exact: true,
      }),
    ).toBeVisible();
    await access
      .getByRole("checkbox", {
        name: "Deniz Misafir kanala erişebilsin",
        exact: true,
      })
      .check();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: "artifacts/channel-access-desktop.png",
      animations: "disabled",
    });
    const accessibility = await new AxeBuilder({ page })
      .include(".channel-access")
      .analyze();
    expect(
      accessibility.violations
        .filter((violation) =>
          ["serious", "critical"].includes(violation.impact || ""),
        )
        .map((violation) => ({
          id: violation.id,
          nodes: violation.nodes.map((node) => node.target),
        })),
    ).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(391);
    await page.screenshot({
      path: "artifacts/channel-access-mobile.png",
      animations: "disabled",
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await access
      .getByRole("button", { name: "Erişimi kaydet", exact: true })
      .click();
    await expect(access).toHaveCount(0);
    await other.getByRole("button", { name: /^özel-proje(?: \d+)?$/ }).click();
    await expect(
      other.getByText("Bu mesajı yalnızca proje üyeleri görebilir.", {
        exact: true,
      }),
    ).toBeVisible();
    await admin.getByRole("button", { name: "Üyeler", exact: true }).click();
    await admin
      .getByRole("combobox", { name: "Deniz Misafir rolü", exact: true })
      .selectOption("guest");
    const role = page.getByRole("dialog", {
      name: "Üye rolünü değiştir",
      exact: true,
    });
    await role
      .getByRole("button", { name: "Rolü değiştir", exact: true })
      .click();
    await expect(role).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await (await other.request.get("/api/auth/me")).json()).user.role,
      )
      .toBe("guest");
    await other.reload();
    await expect(
      other.getByRole("button", { name: "genel", exact: true }),
    ).toHaveCount(0);
    await other.getByRole("button", { name: /^özel-proje(?: \d+)?$/ }).click();
    await expect(
      other.getByText("Bu mesajı yalnızca proje üyeleri görebilir.", {
        exact: true,
      }),
    ).toBeVisible();
    const persisted = (await (
      await other.request.get("/api/auth/me")
    ).json()) as Bootstrap;
    expect(persisted.user.id).toBe(member.user.id);
    expect(persisted.channels.map((channel) => channel.name)).toEqual([
      "özel-proje",
    ]);
  } finally {
    await context.close();
  }
});

test("channel membership actions add and remove workspace members without creating workspace invitations", async ({
  page,
  browser,
}) => {
  const owner = await register(page, "Kanal Sahibi");
  const created = await page.request.post("/api/channels", {
    headers: { Origin: origin },
    data: { name: "yalnız-proje", kind: "text", visibility: "private" },
  });
  expect(created.status()).toBe(201);
  const channel = await created.json();
  const invitation = await page.request.post("/api/invites", {
    headers: { Origin: origin },
  });
  const token = new URL((await invitation.json()).url).searchParams.get(
    "invite",
  )!;
  const context = await browser.newContext({ baseURL: origin });
  const invited = await context.newPage();
  try {
    const member = await register(invited, "Yeni Alan Üyesi", token);
    let workspaceInvites = 0;
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname === "/api/invites" &&
        request.method() === "POST"
      )
        workspaceInvites++;
    });
    await expect(
      invited.getByRole("button", { name: channel.name, exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: channel.name, exact: true }).click();
    await page
      .getByRole("button", { name: "Kanal bilgisi", exact: true })
      .click();
    const information = page.getByRole("dialog", {
      name: "Kanal hakkında",
      exact: true,
    });
    await expect(
      information.getByText("Yalnızca bu kanala eklenen kişiler erişebilir.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      information.getByRole("button", {
        name: "Ekibe birini davet et",
        exact: true,
      }),
    ).toHaveCount(0);
    await information
      .getByRole("button", { name: "Kanala üye ekle", exact: true })
      .click();
    const access = page.getByRole("dialog", {
      name: `${channel.name} · Kanal erişimi`,
      exact: true,
    });
    const save = access.getByRole("button", {
      name: "Erişimi kaydet",
      exact: true,
    });
    await expect(save).toBeDisabled();
    await expect(
      access.getByRole("heading", { name: /Çalışma alanından ekle/ }),
    ).toBeVisible();
    const search = access.getByRole("searchbox", {
      name: "Kanal üyelerinde ara",
      exact: true,
    });
    await search.fill("bulunamayan kişi");
    await expect(access.getByRole("checkbox")).toHaveCount(0);
    await search.fill("Yeni Alan");
    const memberToggle = access.getByRole("checkbox", {
      name: "Yeni Alan Üyesi kanala erişebilsin",
      exact: true,
    });
    await memberToggle.check();
    await expect(access.getByText("Eklenecek", { exact: true })).toBeVisible();
    expect(
      (
        await invited.request.get(`/api/channels/${channel.id}/messages`)
      ).status(),
    ).toBe(404);
    await search.clear();
    await page.screenshot({
      path: "artifacts/channel-membership-desktop.png",
      animations: "disabled",
    });
    await page.setViewportSize({ width: 320, height: 844 });
    expect(
      await access.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    const audit = await new AxeBuilder({ page })
      .include(".channel-access")
      .analyze();
    expect(
      audit.violations.filter(
        (item) => item.impact === "serious" || item.impact === "critical",
      ),
    ).toEqual([]);
    await page.screenshot({
      path: "artifacts/channel-membership-mobile.png",
      animations: "disabled",
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await save.click();
    await expect(access).toHaveCount(0);
    await expect(
      invited.getByRole("button", { name: channel.name, exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Kanal üyelerini gör", exact: true })
      .click();
    const directory = page.getByRole("dialog", {
      name: "Ekibindeki insanlar",
      exact: true,
    });
    await directory
      .getByRole("button", { name: "Kanala üye ekle", exact: true })
      .click();
    await expect(memberToggle).toBeChecked();
    const ownerToggle = access.getByRole("checkbox", {
      name: "Kanal Sahibi kanala erişebilsin",
      exact: true,
    });
    await ownerToggle.uncheck();
    await save.click();
    await expect(
      access.getByRole("button", {
        name: "Erişimimi kaldır ve kaydet",
        exact: true,
      }),
    ).toBeVisible();
    const unchanged = await (
      await page.request.get(`/api/channels/${channel.id}/access`)
    ).json();
    expect(unchanged.channel.memberIds).toContain(owner.user.id);
    await ownerToggle.check();
    await memberToggle.uncheck();
    await expect(
      access.getByText("Kaldırılacak", { exact: true }),
    ).toBeVisible();
    await save.click();
    await expect(access).toHaveCount(0);
    await expect(
      invited.getByRole("button", { name: channel.name, exact: true }),
    ).toHaveCount(0);
    await expect(
      invited.getByRole("button", { name: "genel", exact: true }),
    ).toBeVisible();
    const remaining = (await (
      await invited.request.get("/api/auth/me")
    ).json()) as Bootstrap;
    expect(remaining.workspace.id).toBe(owner.workspace.id);
    expect(remaining.user.id).toBe(member.user.id);
    expect(workspaceInvites).toBe(0);

    await page.getByRole("button", { name: "genel", exact: true }).click();
    await page
      .getByRole("button", { name: "Kanal üyelerini gör", exact: true })
      .click();
    await directory
      .getByRole("button", { name: "Kanala üye ekle", exact: true })
      .click();
    const publicAccess = page.getByRole("dialog", {
      name: "genel · Kanal erişimi",
      exact: true,
    });
    const automatic = publicAccess.getByRole("checkbox", {
      name: "Yeni Alan Üyesi kanala erişebilsin",
      exact: true,
    });
    await expect(automatic).toBeChecked();
    await expect(automatic).toBeDisabled();
  } finally {
    await context.close();
  }
});
