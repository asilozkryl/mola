import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { Bootstrap } from "../shared/types";

const origin = "http://127.0.0.1:5174";
const headers = { Origin: origin };
const opener = (page: Page) =>
  page.getByRole("button", { name: "Çalışma alanı menüsü", exact: true });
const menu = (page: Page) =>
  page.getByRole("menu", { name: "Çalışma alanı menüsü", exact: true });

async function register(request: APIRequestContext, inviteToken?: string) {
  const response = await request.post(`${origin}/api/auth/register`, {
    headers,
    data: {
      name: inviteToken ? "Menü Üyesi" : "Menü Sahibi",
      email: `workspace-menu-${randomUUID()}@example.invalid`,
      password: "workspace-menu-browser-password",
      workspaceName: "Ürün Tasarımı ve İletişim Ekibi",
      ...(inviteToken ? { inviteToken } : {}),
    },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as Bootstrap;
}

async function ready(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("textbox", {
      name: "#genel kanalına mesaj yaz",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Her şey güncel", { exact: true }),
  ).toBeAttached();
}

test("the grouped owner menu shows workspace identity and preserves keyboard and dialog focus", async ({
  page,
}) => {
  const data = await register(page.request);
  await ready(page);
  await opener(page).focus();
  await opener(page).press("Enter");
  await expect(opener(page)).toHaveAttribute("aria-expanded", "true");
  await expect(menu(page).locator(".workspace-menu-identity")).toContainText(
    data.workspace.name,
  );
  await expect(menu(page).locator(".workspace-menu-presence")).toContainText(
    `${data.members.filter((member) => !member.suspended).length} üye`,
  );
  await expect(
    menu(page).getByText("Çalışma alanı sahibi", { exact: true }),
  ).toBeVisible();
  await expect(
    menu(page).locator(".workspace-menu-identity .workspace-avatar"),
  ).toBeVisible();
  await expect(
    menu(page)
      .getByRole("group", { name: "Çalışma alanları", exact: true })
      .getByRole("menuitem"),
  ).toHaveCount(3);
  await expect(
    menu(page)
      .getByRole("group", { name: "Bu çalışma alanı", exact: true })
      .getByRole("menuitem"),
  ).toHaveCount(4);
  const change = menu(page).getByRole("menuitem", {
    name: "Çalışma alanlarını değiştir",
    exact: true,
  });
  await expect(change).toBeFocused();
  await page.keyboard.press("End");
  await expect(
    menu(page).getByRole("menuitem", { name: "Sahipliği devret", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  await expect(opener(page)).toBeFocused();
  await expect(opener(page)).toHaveAttribute("aria-expanded", "false");

  await opener(page).click();
  const composer = page.getByRole("textbox", {
    name: "#genel kanalına mesaj yaz",
    exact: true,
  });
  await composer.click();
  await expect(menu(page)).toHaveCount(0);
  await expect(composer).toBeFocused();
  await opener(page).focus();
  await opener(page).press("ArrowDown");
  await expect(change).toBeFocused();
  await change.press("Enter");
  const workspaces = page.getByRole("dialog", {
    name: "Çalışma alanların",
    exact: true,
  });
  await expect(workspaces).toBeVisible();
  await expect(menu(page)).toHaveCount(0);
  await expect
    .poll(() =>
      workspaces.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    )
    .toBe(true);
});

test("the 320px member menu stays reachable and Escape closes only the menu before opening members", async ({
  page,
  browser,
}) => {
  await register(page.request);
  const invitation = await page.request.post("/api/invites", { headers });
  expect(invitation.status()).toBe(201);
  const token = new URL((await invitation.json()).url).searchParams.get(
    "invite",
  )!;
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: 320, height: 720 },
    hasTouch: true,
    isMobile: true,
  });
  try {
    const member = await context.newPage();
    const data = await register(member.request, token);
    await ready(member);
    await member
      .getByRole("button", { name: "Gezinmeyi aç", exact: true })
      .tap();
    const drawer = member.getByRole("dialog", {
      name: "Çalışma alanı gezinmesi",
      exact: true,
    });
    await expect(drawer).toBeVisible();
    await opener(member).tap();
    await expect(
      menu(member).locator(".workspace-menu-identity"),
    ).toContainText(data.workspace.name);
    await expect(menu(member).getByText("Üye", { exact: true })).toBeVisible();
    for (const name of [
      "Çalışma alanına davet et",
      "Çalışma alanı ayarları",
      "Entegrasyonlar",
      "Sahipliği devret",
    ]) {
      await expect(
        menu(member).getByRole("menuitem", { name, exact: true }),
      ).toHaveCount(0);
    }
    await expect(
      menu(member).getByRole("menuitem", {
        name: "Çalışma alanından ayrıl",
        exact: true,
      }),
    ).toBeEnabled();
    const bounds = await menu(member).boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(721);
    for (const item of await menu(member).getByRole("menuitem").all()) {
      expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(40);
    }
    await member.keyboard.press("Escape");
    await expect(menu(member)).toHaveCount(0);
    await expect(drawer).toBeVisible();
    await expect(opener(member)).toBeFocused();
    await opener(member).tap();
    await menu(member)
      .getByRole("menuitem", { name: "Üyeler", exact: true })
      .tap();
    const members = member.getByRole("dialog", {
      name: "Ekibindeki insanlar",
      exact: true,
    });
    await expect(members).toBeVisible();
    await expect(menu(member)).toHaveCount(0);
    await expect(
      members.getByRole("textbox", {
        name: "Ekip arkadaşını ara",
        exact: true,
      }),
    ).toBeFocused();
  } finally {
    await context.close();
  }
});
