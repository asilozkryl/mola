import {
  expect,
  request,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { Bootstrap, Channel, Message } from "../shared/types";
import type { NotificationState } from "../shared/collaboration-types";

const origin = "http://127.0.0.1:5174";
const headers = { Origin: origin };
const password = "workspace-topbar-browser-password";
const topbar = (page: Page) => page.getByRole("banner");
const workspacePicker = (page: Page) =>
  page.getByRole("dialog", { name: "Çalışma alanların", exact: true });
const searchDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Çalışma alanında ara", exact: true });

async function register(
  api: APIRequestContext,
  workspaceName: string,
  inviteToken?: string,
) {
  const response = await api.post("/api/auth/register", {
    headers,
    data: {
      name: inviteToken ? "Deniz Bildirim" : "Ece Üst Çubuk",
      email: `topbar-${randomUUID()}@example.invalid`,
      password,
      ...(inviteToken ? { inviteToken } : { workspaceName }),
    },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as Bootstrap;
}

async function openWorkspace(page: Page, data: Bootstrap) {
  await page.goto(`/?workspace=${data.workspace.id}`);
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

async function notifications(page: Page) {
  const response = await page.request.get("/api/notifications");
  expect(response.status()).toBe(200);
  return (await response.json()) as NotificationState;
}

test("topbar workspace switching and search keep keyboard focus and use the selected workspace", async ({
  page,
}) => {
  const home = await register(page.request, "İlk Üst Çubuk Ekibi");
  const created = await page.request.post("/api/workspaces", {
    headers,
    data: { name: "İkinci Üst Çubuk Ekibi" },
  });
  expect(created.status()).toBe(200);
  const other = (await created.json()) as Bootstrap;
  const channel = other.channels.find((item) => item.name === "genel")!;
  const content = `Yeni alanın aranabilir notu ${randomUUID()}`;
  const posted = await page.request.post(
    `/api/channels/${channel.id}/messages`,
    { headers, data: { content } },
  );
  expect(posted.status()).toBe(201);
  const message = (await posted.json()) as Message;
  await openWorkspace(page, home);

  const switcher = topbar(page).getByRole("button", {
    name: `Çalışma alanını değiştir: ${home.workspace.name}`,
    exact: true,
  });
  await switcher.focus();
  await page.keyboard.press("Enter");
  await expect(workspacePicker(page)).toBeVisible();
  await expect
    .poll(() =>
      workspacePicker(page).evaluate((dialog) =>
        dialog.contains(document.activeElement),
      ),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(workspacePicker(page)).toHaveCount(0);
  await expect(switcher).toBeFocused();

  await page.keyboard.press("Enter");
  const destination = workspacePicker(page).getByRole("button", {
    name: `${other.workspace.name} alanına geç`,
    exact: true,
  });
  await destination.focus();
  await page.keyboard.press("Enter");
  await expect(workspacePicker(page)).toHaveCount(0);
  await expect(
    topbar(page).getByRole("button", {
      name: `Çalışma alanını değiştir: ${other.workspace.name}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const response = await page.request.get("/api/auth/me");
      return ((await response.json()) as Bootstrap).workspace.id;
    })
    .toBe(other.workspace.id);

  const search = topbar(page).getByRole("button", {
    name: "Tüm mesajlarda ara",
    exact: true,
  });
  await search.focus();
  await page.keyboard.press("Enter");
  const query = searchDialog(page).getByRole("textbox", {
    name: "Mesajlarda ara",
    exact: true,
  });
  await expect(query).toBeFocused();
  await query.fill(content);
  await expect(
    searchDialog(page).getByText(content, { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(searchDialog(page)).toHaveCount(0);
  await expect(search).toBeFocused();

  await page.keyboard.press("ControlOrMeta+k");
  await expect(query).toBeFocused();
  await query.fill(content);
  await searchDialog(page)
    .getByRole("button")
    .filter({ hasText: content })
    .click();
  await expect(searchDialog(page)).toHaveCount(0);
  await expect(
    page.locator(`article[data-message-id="${message.id}"]`),
  ).toContainText(content);
});

test("topbar activity reflects a live mention and clears its count after it is read", async ({
  page,
}) => {
  const owner = await register(page.request, "Canlı Üst Çubuk Ekibi");
  const created = await page.request.post("/api/channels", {
    headers,
    data: { name: "tasarım-kararları", kind: "text" },
  });
  expect(created.status()).toBe(201);
  const channel = (await created.json()) as Channel;
  const invitation = await page.request.post("/api/invites", { headers });
  expect(invitation.status()).toBe(201);
  const inviteToken = new URL((await invitation.json()).url).searchParams.get(
    "invite",
  )!;
  const peer = await request.newContext({ baseURL: origin });
  try {
    await register(peer, "", inviteToken);
    await openWorkspace(page, owner);
    const activity = topbar(page).getByRole("button", {
      name: /^Aktiviteyi aç/,
    });
    await expect(activity).toHaveAccessibleName("Aktiviteyi aç");
    const note = `Bu tasarım kararını inceleyelim ${randomUUID()}`;
    // Mention a channel that is not open so viewing the timeline cannot read it.
    const posted = await peer.post(`/api/channels/${channel.id}/messages`, {
      headers,
      data: { content: `@[${owner.user.id}] ${note}` },
    });
    expect(posted.status()).toBe(201);
    const message = (await posted.json()) as Message;
    await expect(activity).toHaveAccessibleName(
      "Aktiviteyi aç, 1 okunmamış bildirim",
    );
    await activity.click();
    const center = page.getByRole("region", {
      name: "Aktivite akışı",
      exact: true,
    });
    await expect(center).toBeVisible();
    await expect(activity).toHaveAttribute("aria-pressed", "true");
    const mention = center.getByRole("article", {
      name: "Deniz Bildirim, Bahsetme, okunmamış",
      exact: true,
    });
    await expect(mention).toContainText(note);
    await mention
      .getByRole("button", { name: "Okundu işaretle", exact: true })
      .click();
    await expect(activity).toHaveAccessibleName("Aktiviteyi aç");
    await expect
      .poll(async () => {
        const state = await notifications(page);
        return {
          unread: state.unreadNotifications,
          read: state.notifications.find(
            (item) => item.messageId === message.id,
          )?.read,
        };
      })
      .toEqual({ unread: 0, read: true });
    await center
      .getByRole("button", { name: /Deniz Bildirim senden bahsetti/ })
      .click();
    await expect(
      page.locator(`article[data-message-id="${message.id}"]`),
    ).toContainText(note);
    await expect(activity).toHaveAttribute("aria-pressed", "false");
  } finally {
    await peer.dispose();
  }
});

test.describe("320px touch topbar", () => {
  test.use({
    viewport: { width: 320, height: 760 },
    isMobile: true,
    hasTouch: true,
  });

  test("a long workspace name leaves navigation, search, activity and settings reachable", async ({
    page,
  }) => {
    const workspaceName =
      "Uzun Çalışma Alanı Adı ve Ürün Tasarım Ekibi 2026 Türkiye";
    const owner = await register(page.request, workspaceName);
    await openWorkspace(page, owner);
    await page.evaluate(() => document.fonts.ready);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(320);

    const controls = await topbar(page).getByRole("button").all();
    const boxes = [];
    for (const control of controls) {
      await expect(control).toBeInViewport({ ratio: 1 });
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      boxes.push(box!);
    }
    for (let first = 0; first < boxes.length; first += 1) {
      for (let second = first + 1; second < boxes.length; second += 1) {
        const a = boxes[first];
        const b = boxes[second];
        const overlapWidth = Math.max(
          0,
          Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
        );
        const overlapHeight = Math.max(
          0,
          Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
        );
        expect(overlapWidth * overlapHeight).toBeLessThanOrEqual(1);
      }
    }

    await topbar(page)
      .getByRole("button", { name: "Gezinmeyi aç", exact: true })
      .tap();
    await page
      .getByRole("dialog", { name: "Çalışma alanı gezinmesi", exact: true })
      .getByRole("button", { name: "genel", exact: true })
      .tap();
    await topbar(page)
      .getByRole("button", {
        name: `Çalışma alanını değiştir: ${workspaceName}`,
        exact: true,
      })
      .tap();
    await expect(workspacePicker(page)).toBeVisible();
    await workspacePicker(page)
      .getByRole("button", { name: "Kapat", exact: true })
      .tap();
    await topbar(page)
      .getByRole("button", { name: "Tüm mesajlarda ara", exact: true })
      .tap();
    await expect(
      searchDialog(page).getByRole("textbox", {
        name: "Mesajlarda ara",
        exact: true,
      }),
    ).toBeFocused();
    await searchDialog(page)
      .getByRole("button", { name: "Kapat", exact: true })
      .tap();
    await topbar(page)
      .getByRole("button", { name: "Aktiviteyi aç", exact: true })
      .tap();
    await expect(
      page.getByRole("region", { name: "Aktivite akışı", exact: true }),
    ).toBeVisible();
    await topbar(page)
      .getByRole("button", { name: "Profil ayarları", exact: true })
      .tap();
    await expect(
      page.getByRole("dialog", { name: "Kendine ait bir köşe", exact: true }),
    ).toBeVisible();
  });
});
