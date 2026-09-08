import { test, expect, type Page, type Browser } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import type { Bootstrap, Channel, Message } from "../shared/types";
import type { SidebarPreferencesState } from "../shared/sidebar";

const origin = "http://127.0.0.1:5174";
const headers = { Origin: origin };
const password = "sidebar-personal-sections-password";
const sidebar = (page: Page) => page.locator("#workspace-navigation");
const section = (page: Page, id = "default") =>
  sidebar(page).locator(`[data-sidebar-group="${id}"]`);
const row = (page: Page, id: string) =>
  sidebar(page).locator(`[data-channel-id="${id}"][data-order-section="text"]`);
const sectionIds = (page: Page, groupId = "default") =>
  section(page, groupId)
    .locator('[data-channel-id][data-order-section="text"]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-channel-id")),
    );
const preferences = async (page: Page) =>
  (await (
    await page.request.get("/api/sidebar-preferences")
  ).json()) as SidebarPreferencesState;

async function openNavigation(page: Page) {
  if (!(await sidebar(page).isVisible()))
    await page
      .getByRole("button", { name: "Gezinmeyi aç", exact: true })
      .click();
  await expect(sidebar(page)).toBeVisible();
}

async function setup(page: Page) {
  const response = await page.request.post("/api/auth/register", {
    headers,
    data: {
      name: "Kişisel Düzen Sahibi",
      email: `sidebar-groups-${randomUUID()}@example.invalid`,
      password,
      workspaceName: "Kişisel Bölümler",
    },
  });
  expect(response.status()).toBe(200);
  const channels: Channel[] = [];
  for (const name of ["gorevler", "tasarim", "arsiv-notlari"]) {
    const created = await page.request.post("/api/channels", {
      headers,
      data: {
        name,
        kind: "text",
        description: "Bölümler arasında korunacak kanal",
      },
    });
    expect(created.status()).toBe(201);
    channels.push((await created.json()) as Channel);
  }
  await page.goto("/");
  await expect(
    page.getByRole("textbox", {
      name: "#genel kanalına mesaj yaz",
      exact: true,
    }),
  ).toBeVisible();
  await openNavigation(page);
  await expect(
    row(page, channels[0].id).locator(".channel-drag-handle"),
  ).toBeEnabled();
  return {
    data: (await (await page.request.get("/api/auth/me")).json()) as Bootstrap,
    channels,
  };
}

async function createGroup(page: Page, name: string) {
  await sidebar(page)
    .getByRole("button", { name: "Kanallar bölüm işlemleri", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Bölüm oluştur", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Bölüm oluştur",
    exact: true,
  });
  const input = dialog.getByRole("textbox", { name: "Bölüm adı", exact: true });
  await expect(input).toBeFocused();
  await input.fill(name);
  await dialog.getByRole("button", { name: "Oluştur", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await preferences(page)).preferences.channelGroups?.some(
          (group) => group.name === name,
        ) || false,
    )
    .toBe(true);
  const group = (await preferences(page)).preferences.channelGroups!.find(
    (value) => value.name === name,
  )!;
  await expect(section(page, group.id)).toBeVisible();
  return group;
}

async function groupMenu(page: Page, name: string, action: string) {
  await sidebar(page)
    .getByRole("button", { name: `${name} bölüm işlemleri`, exact: true })
    .click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}

async function joinedPeer(page: Page, browser: Browser) {
  const invitation = await page.request.post("/api/invites", { headers });
  expect(invitation.status()).toBe(201);
  const token = new URL((await invitation.json()).url).searchParams.get(
    "invite",
  )!;
  const context = await browser.newContext({ baseURL: origin });
  const peer = await context.newPage();
  try {
    const response = await peer.request.post("/api/auth/register", {
      headers,
      data: {
        name: "Diğer Bölüm Üyesi",
        email: `group-peer-${randomUUID()}@example.invalid`,
        password,
        inviteToken: token,
      },
    });
    expect(response.status()).toBe(200);
    await peer.goto("/");
    await expect(
      peer.getByRole("textbox", {
        name: "#genel kanalına mesaj yaz",
        exact: true,
      }),
    ).toBeVisible();
    return { page: peer, context };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function channelMenu(page: Page, channel: Channel, keyboard = false) {
  const button = row(page, channel.id).locator(".channel-nav");
  if (keyboard) {
    await button.focus();
    await page.keyboard.press("Shift+F10");
  } else await button.click({ button: "right" });
  const menu = page.getByRole("menu", {
    name: `${channel.name} kanal işlemleri`,
    exact: true,
  });
  await expect(menu).toBeVisible();
  return menu;
}

test("dragging the channel's main row reorders without opening it and supports persistent undo", async ({
  page,
}) => {
  await setup(page);
  const original = (await sectionIds(page)) as string[];
  const activeTitle = await page.getByRole("heading", { level: 1 }).innerText();
  const sourceId = original.at(-1)!;
  const reordered = [sourceId, ...original.slice(0, -1)];
  const drag = async () => {
    const source = row(page, sourceId).locator(".channel-nav");
    await source.dragTo(row(page, original[0]), {
      sourcePosition: { x: 75, y: 16 },
      targetPosition: { x: 85, y: 3 },
    });
  };
  await drag();
  await expect.poll(() => sectionIds(page)).toEqual(reordered);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(activeTitle);
  await expect(
    page.getByRole("textbox", {
      name: "#genel kanalına mesaj yaz",
      exact: true,
    }),
  ).toBeVisible();
  await expect
    .poll(async () => (await preferences(page)).preferences.textOrder)
    .toEqual(reordered);
  await page.getByRole("button", { name: "Geri al", exact: true }).click();
  await expect.poll(() => sectionIds(page)).toEqual(original);
  await expect
    .poll(async () => (await preferences(page)).preferences.textOrder)
    .toEqual(original);
  await expect(
    row(page, sourceId).locator(".channel-drag-handle"),
  ).toBeEnabled();
  await drag();
  await expect
    .poll(async () => (await preferences(page)).preferences.textOrder)
    .toEqual(reordered);
  await page.reload();
  await expect.poll(() => sectionIds(page)).toEqual(reordered);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(activeTitle);
});

test("personal sections support cross-section drag, collapse, rename and removal without deleting shared channels", async ({
  page,
  browser,
}, info) => {
  const { channels } = await setup(page);
  const channel = channels[0];
  const messageResponse = await page.request.post(
    `/api/channels/${channel.id}/messages`,
    {
      headers,
      data: { content: "Kişisel bölüm kaldırılsa da bu mesaj korunur." },
    },
  );
  expect(messageResponse.status()).toBe(201);
  const message = (await messageResponse.json()) as Message;
  const peer = await joinedPeer(page, browser);
  try {
    const first = await createGroup(page, "Odak Alanım");
    const second = await createGroup(page, "Sonra Bakacağım");
    const activeTitle = await page
      .getByRole("heading", { level: 1 })
      .innerText();
    await row(page, channel.id)
      .locator(".channel-nav")
      .dragTo(
        section(page, first.id).getByText("Kanalları buraya sürükle", {
          exact: true,
        }),
      );
    await expect.poll(() => sectionIds(page, first.id)).toEqual([channel.id]);
    await expect
      .poll(
        async () =>
          (await preferences(page)).preferences.channelGroups?.find(
            (group) => group.id === first.id,
          )?.channelIds,
      )
      .toEqual([channel.id]);
    await row(page, channel.id)
      .locator(".channel-nav")
      .dragTo(
        section(page, second.id).getByText("Kanalları buraya sürükle", {
          exact: true,
        }),
      );
    await expect.poll(() => sectionIds(page, second.id)).toEqual([channel.id]);
    await expect.poll(() => sectionIds(page, first.id)).toEqual([]);
    await expect
      .poll(
        async () =>
          (await preferences(page)).preferences.channelGroups?.find(
            (group) => group.id === second.id,
          )?.channelIds,
      )
      .toEqual([channel.id]);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      activeTitle,
    );
    await page.reload();
    await expect.poll(() => sectionIds(page, second.id)).toEqual([channel.id]);
    await peer.page.reload();
    await expect(
      peer.page.getByRole("textbox", {
        name: "#genel kanalına mesaj yaz",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (await preferences(peer.page)).preferences.channelGroups || [],
    ).toEqual([]);
    await expect(
      sidebar(peer.page).getByRole("button", {
        name: "Odak Alanım",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      section(peer.page).locator(`[data-channel-id="${channel.id}"]`),
    ).toBeVisible();
    const toggle = section(page, second.id).getByRole("button", {
      name: second.name,
      exact: true,
    });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(row(page, channel.id)).toBeHidden();
    await expect
      .poll(
        async () =>
          (await preferences(page)).preferences.channelGroups?.find(
            (group) => group.id === second.id,
          )?.collapsed,
      )
      .toBe(true);
    await page.reload();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(row(page, channel.id)).toBeVisible();
    await groupMenu(page, second.name, "Bölüm adını düzenle");
    const rename = page.getByRole("dialog", {
      name: "Bölüm adını düzenle",
      exact: true,
    });
    await rename
      .getByRole("textbox", { name: "Bölüm adı", exact: true })
      .fill("Gelecek Hafta");
    await rename.getByRole("button", { name: "Kaydet", exact: true }).click();
    await expect(rename).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await preferences(page)).preferences.channelGroups?.find(
            (group) => group.id === second.id,
          )?.name,
      )
      .toBe("Gelecek Hafta");
    await page.screenshot({
      path: info.outputPath("personal-channel-sections-desktop.png"),
      animations: "disabled",
    });
    await groupMenu(page, "Gelecek Hafta", "Bölümü kaldır");
    const remove = page.getByRole("dialog", {
      name: "Bölümü kaldır",
      exact: true,
    });
    await remove
      .getByRole("button", { name: "Bölümü kaldır", exact: true })
      .click();
    await expect(remove).toHaveCount(0);
    await expect(section(page, second.id)).toHaveCount(0);
    await expect(
      section(page).locator(`[data-channel-id="${channel.id}"]`),
    ).toBeVisible();
    await expect
      .poll(async () =>
        (await preferences(page)).preferences.channelGroups?.some(
          (group) => group.id === second.id,
        ),
      )
      .toBe(false);
    const state = (await (
      await page.request.get("/api/auth/me")
    ).json()) as Bootstrap;
    const retained = state.channels.find((item) => item.id === channel.id);
    expect(retained).toBeTruthy();
    expect(Boolean(retained!.archived)).toBe(false);
    const messages = await page.request.get(
      `/api/channels/${channel.id}/messages`,
    );
    expect(messages.status()).toBe(200);
    expect(
      (await messages.json()).messages.some(
        (item: Message) =>
          item.id === message.id && item.content === message.content,
      ),
    ).toBe(true);
    await page.reload();
    await expect(section(page, second.id)).toHaveCount(0);
    await expect(
      section(page).locator(`[data-channel-id="${channel.id}"]`),
    ).toBeVisible();
    await row(page, channel.id).locator(".channel-nav").click();
    await expect(
      page.locator(".message-text").filter({ hasText: message.content }),
    ).toBeVisible();
  } finally {
    await peer.context.close();
  }
});

test("320px personal sections support keyboard and touch move menus and keep the conversation unchanged", async ({
  browser,
}, info) => {
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: 320, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    const { channels } = await setup(page);
    const sectionMenu = sidebar(page).getByRole("button", {
      name: "Kanallar bölüm işlemleri",
      exact: true,
    });
    await sectionMenu.click();
    await page
      .getByRole("menuitem", { name: "Bölüm oluştur", exact: true })
      .click();
    const cancelledCreate = page.getByRole("dialog", {
      name: "Bölüm oluştur",
      exact: true,
    });
    const nameInput = cancelledCreate.getByRole("textbox", {
      name: "Bölüm adı",
      exact: true,
    });
    await expect(nameInput).toBeFocused();
    await nameInput.fill("Vazgeçilen bölüm");
    await cancelledCreate
      .getByRole("button", { name: "Oluştur", exact: true })
      .focus();
    await page.keyboard.press("Tab");
    await expect
      .poll(() =>
        cancelledCreate.evaluate((element) =>
          element.contains(document.activeElement),
        ),
      )
      .toBe(true);
    await cancelledCreate
      .getByRole("button", { name: "Kapat", exact: true })
      .focus();
    await page.keyboard.press("Shift+Tab");
    await expect
      .poll(() =>
        cancelledCreate.evaluate((element) =>
          element.contains(document.activeElement),
        ),
      )
      .toBe(true);
    await page.keyboard.press("Escape");
    await expect(cancelledCreate).toHaveCount(0);
    await expect(sidebar(page)).toBeVisible();
    await expect(sectionMenu).toBeFocused();
    expect((await preferences(page)).preferences.channelGroups || []).toEqual(
      [],
    );
    const group = await createGroup(page, "Mobil Odağım");
    const channel = channels[1];
    // The open mobile drawer makes the conversation inert, so read its
    // unchanged title without selecting it through the accessibility tree.
    const activeTitle = await page.locator("h1").innerText();
    await (
      await channelMenu(page, channel, true)
    )
      .getByRole("menuitem", { name: "Bölüme taşı", exact: true })
      .click();
    const move = page.getByRole("dialog", {
      name: "Kanalı bölüme taşı",
      exact: true,
    });
    await expect(move).toContainText("Bu düzen yalnızca sana ait.");
    const destination = move.getByRole("button", {
      name: `${group.name} bölümüne taşı`,
      exact: true,
    });
    await destination.focus();
    await destination.press("Enter");
    await expect(move).toHaveCount(0);
    await expect.poll(() => sectionIds(page, group.id)).toEqual([channel.id]);
    await expect
      .poll(
        async () =>
          (await preferences(page)).preferences.channelGroups?.find(
            (item) => item.id === group.id,
          )?.channelIds,
      )
      .toEqual([channel.id]);
    await expect(page.locator("h1")).toHaveText(activeTitle);
    const menuButton = row(page, channel.id).getByRole("button", {
      name: `${channel.name} kanal işlemleri`,
      exact: true,
    });
    await menuButton.tap();
    await page
      .getByRole("menuitem", { name: "Bölüme taşı", exact: true })
      .tap();
    await move
      .getByRole("button", { name: "Kanallar bölümüne taşı", exact: true })
      .tap();
    await expect(move).toHaveCount(0);
    await expect(
      section(page).locator(`[data-channel-id="${channel.id}"]`),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (await preferences(page)).preferences.channelGroups?.find(
            (item) => item.id === group.id,
          )?.channelIds,
      )
      .toEqual([]);
    expect(
      await sidebar(page).evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    const audit = await new AxeBuilder({ page })
      .include("#workspace-navigation")
      .analyze();
    expect(
      audit.violations.filter(
        (item) => item.impact === "serious" || item.impact === "critical",
      ),
    ).toEqual([]);
    await page.screenshot({
      path: info.outputPath("personal-channel-sections-mobile.png"),
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("textbox", {
        name: "#genel kanalına mesaj yaz",
        exact: true,
      }),
    ).toBeVisible();
    await page.reload();
    await openNavigation(page);
    await expect(
      section(page).locator(`[data-channel-id="${channel.id}"]`),
    ).toBeVisible();
    await expect(
      section(page, group.id).getByText("Kanalları buraya sürükle", {
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
