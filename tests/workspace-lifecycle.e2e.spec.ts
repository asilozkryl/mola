import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import type { Bootstrap } from "../shared/types";

const origin = "http://127.0.0.1:5174";
const password = "workspace-lifecycle-browser-password";
async function register(page: Page, label: string) {
  const email = `lifecycle-${randomUUID()}@example.invalid`,
    workspaceName = `${label} ${randomUUID().slice(0, 8)}`;
  const response = await page.request.post("/api/auth/register", {
    headers: { Origin: origin },
    data: { name: label, email, password, workspaceName },
  });
  expect(response.status()).toBe(200);
  const data = (await response.json()) as Bootstrap;
  await page.goto("/");
  await ready(page);
  return { data, email, workspaceName };
}
async function ready(page: Page) {
  await expect(
    page.getByRole("textbox", {
      name: "#genel kanalına mesaj yaz",
      exact: true,
    }),
  ).toBeVisible();
}
async function menu(page: Page, name: string) {
  await page
    .getByRole("button", { name: "Çalışma alanı menüsü", exact: true })
    .click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
async function deletionDialog(page: Page) {
  await menu(page, "Çalışma alanı ayarları");
  await page
    .getByRole("button", { name: "Çalışma alanını sil", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Çalışma alanını sil",
    exact: true,
  });
  await expect(
    dialog.getByLabel("Silinecek çalışma alanının adı", { exact: true }),
  ).toBeVisible();
  return dialog;
}
async function confirmDelete(page: Page, name: string) {
  const dialog = await deletionDialog(page);
  await dialog
    .getByLabel("Silinecek çalışma alanının adı", { exact: true })
    .fill(name);
  await dialog.getByLabel("Mevcut parolan", { exact: true }).fill(password);
  await dialog
    .getByRole("button", {
      name: "Çalışma alanını kalıcı olarak sil",
      exact: true,
    })
    .click();
  await expect(dialog).toHaveCount(0);
}
async function accessible(page: Page, selector: string) {
  await page.locator(selector).evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations()
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  const result = await new AxeBuilder({ page }).include(selector).analyze();
  expect(
    result.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.failureSummary) })),
  ).toEqual([]);
}

test("owner deletes the final workspace with current confirmation, keeps the account and creates a new team after login", async ({
  page,
}, info) => {
  const account = await register(page, "Son Alan Sahibi");
  const dialog = await deletionDialog(page);
  await expect(dialog.locator(".workspace-deletion-counts")).toContainText(
    "Kanal / oda",
  );
  await expect(
    dialog.getByRole("button", {
      name: "Çalışma alanını kalıcı olarak sil",
      exact: true,
    }),
  ).toBeDisabled();
  await dialog
    .getByLabel("Silinecek çalışma alanının adı", { exact: true })
    .fill("yanlış alan");
  await dialog.getByLabel("Mevcut parolan", { exact: true }).fill(password);
  await expect(
    dialog.getByRole("button", {
      name: "Çalışma alanını kalıcı olarak sil",
      exact: true,
    }),
  ).toBeDisabled();
  await dialog
    .getByLabel("Silinecek çalışma alanının adı", { exact: true })
    .fill(account.workspaceName);
  await dialog
    .getByLabel("Mevcut parolan", { exact: true })
    .fill("incorrect-current-password");
  await dialog
    .getByRole("button", {
      name: "Çalışma alanını kalıcı olarak sil",
      exact: true,
    })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Mevcut parolanız hatalı",
  );
  await expect(
    dialog.getByLabel("Mevcut parolan", { exact: true }),
  ).toHaveValue("");
  await page.setViewportSize({ width: 320, height: 740 });
  await accessible(page, '[role="dialog"][aria-modal="true"]');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(320);
  await page.screenshot({
    path: info.outputPath("workspace-delete-mobile.png"),
    animations: "disabled",
  });
  await dialog.getByLabel("Mevcut parolan", { exact: true }).fill(password);
  await dialog
    .getByRole("button", {
      name: "Çalışma alanını kalıcı olarak sil",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Birlikte çalışmaya başla.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText(account.email, { exact: true })).toBeVisible();
  const state = await (await page.request.get("/api/auth/me")).json();
  expect(state.accountOnly).toBe(true);
  expect(state.user.role).toBeUndefined();
  expect(state.workspace).toBeNull();
  await accessible(page, ".account-workspaces");
  await page.screenshot({
    path: info.outputPath("workspace-account-home-mobile.png"),
    animations: "disabled",
  });
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Birlikte çalışmaya başla.",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Hesap güvenliği", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Hesap güvenliği", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Çıkış yap", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Tekrar hoş geldin.", exact: true }),
  ).toBeVisible();
  await page.getByLabel("E-posta adresin", { exact: true }).fill(account.email);
  await page.getByLabel("Parola", { exact: true }).fill(password);
  await page
    .locator("form")
    .getByRole("button", { name: "Giriş yap", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Birlikte çalışmaya başla.",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Çalışma alanı oluştur", exact: true })
    .click();
  const creation = page.getByRole("dialog", {
    name: "Çalışma alanların",
    exact: true,
  });
  await creation
    .getByLabel("Çalışma alanı adı", { exact: true })
    .fill("Yeni Başlangıç");
  await creation
    .getByRole("button", { name: "Alanı oluştur", exact: true })
    .click();
  await ready(page);
  const created = await (await page.request.get("/api/auth/me")).json();
  expect(created.workspace.name).toBe("Yeni Başlangıç");
  expect(created.user.id).toBe(account.data.user.id);
});

test("deleting one workspace switches to the surviving team and refreshes a second signed-in tab", async ({
  page,
}) => {
  const account = await register(page, "İki Alan Sahibi");
  const keepMessage = `Korunan mesaj ${randomUUID()}`;
  const composer = page.getByRole("textbox", {
    name: "#genel kanalına mesaj yaz",
    exact: true,
  });
  await composer.fill(keepMessage);
  await page.getByRole("button", { name: "Mesaj gönder", exact: true }).click();
  await expect(
    page
      .getByText(keepMessage, { exact: true })
      .and(page.locator(".message-text")),
  ).toBeVisible();
  await expect(composer).toHaveValue("");
  await expect(composer).toBeEnabled();
  const create = await page.request.post("/api/workspaces", {
    headers: { Origin: origin },
    data: { name: "Silinecek İkinci Alan" },
  });
  expect(create.status()).toBe(200);
  const second = (await create.json()) as Bootstrap;
  const secondChannel = second.channels.find(
    (channel) => channel.name === "genel",
  )!;
  // The existing URL intentionally restores the first workspace on reload.
  // This API fixture must open the workspace it just created explicitly.
  await page.goto(
    `/?workspace=${second.workspace.id}&channel=${secondChannel.id}`,
  );
  await ready(page);
  await expect(
    page.getByRole("button", { name: "Çalışma alanı menüsü", exact: true }),
  ).toContainText(second.workspace.name);
  expect(
    (await (await page.request.get("/api/auth/me")).json()).workspace.id,
  ).toBe(second.workspace.id);
  const otherTab = await page.context().newPage();
  await otherTab.goto("/");
  await ready(otherTab);
  await confirmDelete(page, second.workspace.name);
  await ready(page);
  await ready(otherTab);
  await expect(
    page
      .getByText(keepMessage, { exact: true })
      .and(page.locator(".message-text")),
  ).toBeVisible();
  await expect(
    otherTab
      .getByText(keepMessage, { exact: true })
      .and(otherTab.locator(".message-text")),
  ).toBeVisible();
  const state = await (await page.request.get("/api/auth/me")).json();
  expect(state.workspace.id).toBe(account.data.workspace.id);
  expect(state.workspaces).toHaveLength(1);
  await otherTab.close();
});

test("a member can leave and rejoin by workspace invite without regaining previous private channels", async ({
  page,
  browser,
}) => {
  const owner = await register(page, "Davet Eden Sahip");
  const inviteResponse = await page.request.post("/api/invites", {
    headers: { Origin: origin },
  });
  expect(inviteResponse.status()).toBe(201);
  const inviteUrl = (await inviteResponse.json()).url as string;
  const guestContext = await browser.newContext();
  try {
    const guest = await guestContext.newPage();
    const member = await register(guest, "Ayrılan Üye");
    const join = await guest.request.post("/api/workspaces/join", {
      headers: { Origin: origin },
      data: { inviteToken: new URL(inviteUrl).searchParams.get("invite") },
    });
    expect(join.status()).toBe(200);
    const joined = (await join.json()) as Bootstrap;
    const secretName = `gizli-${randomUUID().slice(0, 8)}`;
    const channelResponse = await page.request.post("/api/channels", {
      headers: { Origin: origin },
      data: {
        name: secretName,
        kind: "text",
        visibility: "private",
        memberIds: [member.data.user.id],
      },
    });
    expect(channelResponse.status()).toBe(201);
    const secret = await channelResponse.json();
    const joinedChannel = joined.channels.find(
      (channel) => channel.name === "genel",
    )!;
    // Follow the joined workspace, rather than reloading the member's old URL.
    await guest.goto(
      `/?workspace=${joined.workspace.id}&channel=${joinedChannel.id}`,
    );
    await ready(guest);
    expect(
      (await (await guest.request.get("/api/auth/me")).json()).workspace.id,
    ).toBe(owner.data.workspace.id);
    expect(
      (await (await guest.request.get("/api/auth/me")).json()).channels.some(
        (c: { id: string }) => c.id === secret.id,
      ),
    ).toBe(true);
    await menu(guest, "Çalışma alanından ayrıl");
    const leave = guest.getByRole("dialog", {
      name: "Çalışma alanından ayrıl",
      exact: true,
    });
    await leave.getByRole("button", { name: "Vazgeç", exact: true }).click();
    expect(
      (await (await guest.request.get("/api/auth/me")).json()).workspace.id,
    ).toBe(owner.data.workspace.id);
    await menu(guest, "Çalışma alanından ayrıl");
    await guest
      .getByRole("dialog", { name: "Çalışma alanından ayrıl", exact: true })
      .getByRole("button", { name: "Çalışma alanından ayrıl", exact: true })
      .click();
    await ready(guest);
    await expect
      .poll(
        async () =>
          (await (await guest.request.get("/api/auth/me")).json()).workspace.id,
      )
      .toBe(member.data.workspace.id);
    await menu(guest, "Çalışma alanlarını değiştir");
    const workspaces = guest.getByRole("dialog", {
      name: "Çalışma alanların",
      exact: true,
    });
    await workspaces
      .getByRole("button", { name: "Davetle katıl", exact: true })
      .click();
    await guest
      .getByRole("dialog")
      .getByLabel("Davet bağlantısı veya kodu", { exact: true })
      .fill(inviteUrl);
    await guest
      .getByRole("dialog")
      .getByRole("button", { name: "Çalışma alanına katıl", exact: true })
      .click();
    await ready(guest);
    await expect
      .poll(
        async () =>
          (await (await guest.request.get("/api/auth/me")).json()).workspace.id,
      )
      .toBe(owner.data.workspace.id);
    await guest.reload();
    await ready(guest);
    const rejoined = await (await guest.request.get("/api/auth/me")).json();
    expect(
      rejoined.channels.some((c: { id: string }) => c.id === secret.id),
    ).toBe(false);
    expect(
      (await guest.request.get(`/api/channels/${secret.id}/messages`)).status(),
    ).toBe(404);
  } finally {
    await guestContext.close();
  }
});
