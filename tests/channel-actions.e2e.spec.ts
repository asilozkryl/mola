import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { Attachment, Bootstrap, Channel, Message } from "../shared/types";

const origin = "http://127.0.0.1:5174";
const headers = { Origin: origin };

async function account(page: Page, inviteToken?: string) {
  const response = await page.request.post("/api/auth/register", {
    headers,
    data: {
      name: "Deniz Kanal",
      email: `channel-actions-${randomUUID()}@example.invalid`,
      password: "channel-actions-browser-password-2026",
      workspaceName: "Kanal Kullanımı",
      ...(inviteToken ? { inviteToken } : {}),
    },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as Bootstrap;
}

async function createChannel(page: Page, kind: "text" | "voice" = "text") {
  const response = await page.request.post("/api/channels", {
    headers,
    data: {
      name: `kanal-${randomUUID().slice(0, 8)}`,
      description: "İlk açıklama",
      kind,
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as Channel;
}

async function openWorkspace(page: Page) {
  await page.goto("/");
  await expect(
    page.getByText("Her şey güncel", { exact: true }),
  ).toBeAttached();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

function channelButton(page: Page, name: string) {
  return page
    .locator("#workspace-navigation .channel-nav")
    .filter({ hasText: name });
}

async function menu(page: Page, channel: Channel) {
  await channelButton(page, channel.name).click({ button: "right" });
  const result = page.getByRole("menu", {
    name: `${channel.name} kanal işlemleri`,
    exact: true,
  });
  await expect(result).toBeVisible();
  return result;
}

async function message(
  page: Page,
  channelId: string,
  content: string,
  attachmentIds: string[] = [],
  parentId?: string,
) {
  const response = await page.request.post(
    `/api/channels/${channelId}/messages`,
    {
      headers,
      data: { content, attachmentIds, ...(parentId ? { parentId } : {}) },
    },
  );
  expect(response.status()).toBe(201);
  return (await response.json()) as Message;
}

test("right-click keeps the current conversation and channel edits survive errors and reload", async ({
  page,
}) => {
  const data = await account(page);
  const channel = await createChannel(page);
  await openWorkspace(page);
  const currentTitle = await page
    .getByRole("heading", { level: 1 })
    .innerText();
  const currentUrl = page.url();
  await (
    await menu(page, channel)
  )
    .getByRole("menuitem", { name: "Kanalı düzenle", exact: true })
    .click();
  expect(page.url()).toBe(currentUrl);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    currentTitle,
  );
  const edit = page.getByRole("dialog", {
    name: "Kanalı düzenle",
    exact: true,
  });
  const name = edit.getByRole("textbox", { name: "Kanal adı", exact: true });
  const description = edit.getByRole("textbox", { name: /Açıklama/ });
  await expect(name).toBeFocused();
  await name.fill("genel");
  await description.fill("Hata olsa da korunacak açıklama");
  await edit
    .getByRole("button", { name: "Değişiklikleri kaydet", exact: true })
    .click();
  await expect(edit.getByRole("alert")).toContainText(
    "Bu isimde bir kanal var",
  );
  await expect(name).toHaveValue("genel");
  await expect(description).toHaveValue("Hata olsa da korunacak açıklama");
  const renamed = `${channel.name}-yeni`;
  await name.fill(renamed);
  const mutation = page.waitForRequest(
    (request) =>
      request.method() === "PATCH" &&
      request.url().endsWith(`/admin/workspace/channels/${channel.id}`),
  );
  await edit
    .getByRole("button", { name: "Değişiklikleri kaydet", exact: true })
    .click();
  const request = await mutation;
  expect(request.headers()["x-workspace-id"]).toBe(data.workspace.id);
  expect(request.headers()["x-user-id"]).toBe(data.user.id);
  await expect(edit).toHaveCount(0);
  await expect(channelButton(page, renamed)).toBeVisible();
  await page.reload();
  await channelButton(page, renamed).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(renamed);
  await expect(page.locator(".channel-heading")).toContainText(
    "Hata olsa da korunacak açıklama",
  );
});

test("channel deletion requires the exact name, supports cancellation and clears open pages and files", async ({
  page,
  context,
}) => {
  await account(page);
  const channel = await createChannel(page);
  const upload = await page.request.post("/api/uploads", {
    headers,
    multipart: {
      file: {
        name: "silinecek-not.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Silinecek ek"),
      },
    },
  });
  expect(upload.status()).toBe(201);
  const attachment = (await upload.json()) as Attachment;
  const content = `KaliciSilme${randomUUID().slice(0, 8)}`;
  const sent = await message(page, channel.id, content, [attachment.id]);
  const reply = await message(
    page,
    channel.id,
    "Bu yanıt da silinecek",
    [],
    sent.id,
  );
  await openWorkspace(page);
  await channelButton(page, channel.name).click();
  await expect(
    page.locator(`article[data-message-id="${sent.id}"]`),
  ).toBeVisible();
  const other = await context.newPage();
  await openWorkspace(other);
  await channelButton(other, channel.name).click();
  await expect(
    other.locator(`article[data-message-id="${sent.id}"]`),
  ).toBeVisible();

  await (
    await menu(page, channel)
  )
    .getByRole("menuitem", { name: "Kanalı sil", exact: true })
    .click();
  const confirmation = page.getByRole("dialog", {
    name: "Kanalı sil",
    exact: true,
  });
  const input = confirmation.getByRole("textbox", {
    name: "Kanal adını doğrula",
    exact: true,
  });
  const remove = confirmation.getByRole("button", {
    name: "Kanalı kalıcı olarak sil",
    exact: true,
  });
  await expect(input).toBeFocused();
  await expect(remove).toBeDisabled();
  await input.fill(`${channel.name} `);
  await expect(remove).toBeDisabled();
  await input.fill(channel.name);
  await expect(remove).toBeEnabled();
  await confirmation
    .getByRole("button", { name: "Vazgeç", exact: true })
    .click();
  await expect(
    page.locator(`article[data-message-id="${sent.id}"]`),
  ).toBeVisible();
  expect((await page.request.get(attachment.url)).status()).toBe(200);
  await (
    await menu(page, channel)
  )
    .getByRole("menuitem", { name: "Kanalı sil", exact: true })
    .click();
  await expect(input).toHaveValue("");
  await input.fill(channel.name);
  await remove.click();
  await expect(confirmation).toHaveCount(0);
  for (const target of [page, other]) {
    await expect(channelButton(target, channel.name)).toHaveCount(0);
    await expect(
      target.locator(`article[data-message-id="${sent.id}"]`),
    ).toHaveCount(0);
  }
  await other.reload();
  await expect(channelButton(other, channel.name)).toHaveCount(0);
  expect((await other.request.get(attachment.url)).status()).toBe(404);
  expect(
    (await other.request.get(`/api/channels/${channel.id}/messages`)).status(),
  ).toBe(404);
  expect((await other.request.get(`/api/messages/${reply.id}`)).status()).toBe(
    404,
  );
  const search = await other.request.get(`/api/search?q=${content}`);
  expect((await search.json()).messages).toEqual([]);
  await other.close();
});

test("archived history and saved messages survive reload and the archive directory restores the channel", async ({
  page,
}) => {
  await account(page);
  const channel = await createChannel(page);
  const sent = await message(page, channel.id, "Arşivde korunacak ekip kararı");
  await openWorkspace(page);
  await channelButton(page, channel.name).click();
  const article = page.locator(`article[data-message-id="${sent.id}"]`);
  await article.click({ button: "right" });
  await page
    .getByRole("menu")
    .getByRole("menuitem", { name: "Mesajı kaydet", exact: true })
    .click();
  await (
    await menu(page, channel)
  )
    .getByRole("menuitem", { name: "Kanalı arşivle", exact: true })
    .click();
  const archive = page.getByRole("dialog", {
    name: "Kanalı arşivle",
    exact: true,
  });
  await archive
    .getByRole("button", { name: "Kanalı arşivle", exact: true })
    .click();
  await expect(archive).toHaveCount(0);
  await expect(channelButton(page, channel.name)).toHaveCount(0);
  await page.getByRole("button", { name: /Arşivlenmiş kanallar/ }).click();
  const directory = page.getByRole("dialog", {
    name: "Arşivlenmiş kanallar",
    exact: true,
  });
  await directory
    .locator(".archive-channel-row")
    .filter({ hasText: channel.name })
    .locator("button")
    .first()
    .click();
  await expect(article).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: /kanalına mesaj yaz/ }),
  ).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: /Arşivlenmiş kanallar/ }).click();
  await directory
    .getByRole("button", {
      name: `${channel.name} kanal işlemleri`,
      exact: true,
    })
    .click();
  await page
    .getByRole("menu", { name: `${channel.name} kanal işlemleri`, exact: true })
    .getByRole("menuitem", { name: "Sohbeti aç", exact: true })
    .click();
  await expect(directory).toHaveCount(0);
  await expect(article).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: /kanalına mesaj yaz/ }),
  ).toHaveCount(0);
  await page
    .locator(".primary-nav")
    .getByRole("button", { name: /^Kaydedilenler/ })
    .click();
  await expect(article).toBeVisible();
  await page
    .locator(".saved-channel-label")
    .filter({ hasText: channel.name })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    channel.name,
  );
  await expect(article).toBeVisible();
  // A later administrative refresh must preserve the archived conversation and saved entry.
  await page.request.patch(`/api/admin/workspace/channels/${channel.id}`, {
    headers,
    data: { description: "Arşivden güncellenen açıklama" },
  });
  await expect(page.locator(".channel-heading")).toContainText(
    "Arşivden güncellenen açıklama",
  );
  await expect(article).toBeVisible();
  await page.getByRole("button", { name: /Arşivlenmiş kanallar/ }).click();
  await directory
    .getByRole("button", {
      name: `${channel.name} arşivden çıkar`,
      exact: true,
    })
    .click();
  const restore = page.getByRole("dialog", {
    name: "Kanalı arşivden çıkar",
    exact: true,
  });
  await expect(
    restore.getByRole("button", { name: "Vazgeç", exact: true }),
  ).toBeFocused();
  await restore
    .getByRole("button", { name: "Kanalı arşivden çıkar", exact: true })
    .click();
  await expect(channelButton(page, channel.name)).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: /kanalına mesaj yaz/ }),
  ).toBeVisible();
  await page.reload();
  await channelButton(page, channel.name).click();
  await expect(article).toBeVisible();
  await page
    .locator(".primary-nav")
    .getByRole("button", { name: /^Kaydedilenler/ })
    .click();
  await expect(article).toBeVisible();
});

test("deleting another channel closes its saved-message thread and removes cached content", async ({
  page,
  context,
}) => {
  const data = await account(page);
  const otherChannel = await createChannel(page);
  const currentChannel = data.channels.find(
    (channel) => channel.name === "genel",
  )!;
  const parent = await message(
    page,
    otherChannel.id,
    "Başka kanaldan kaydedilmiş karar",
  );
  const reply = await message(
    page,
    otherChannel.id,
    "Silinince açık kalmaması gereken yanıt",
    [],
    parent.id,
  );
  await openWorkspace(page);
  await channelButton(page, otherChannel.name).click();
  const parentArticle = page.locator(`article[data-message-id="${parent.id}"]`);
  await parentArticle.click({ button: "right" });
  await page
    .getByRole("menu")
    .getByRole("menuitem", { name: "Mesajı kaydet", exact: true })
    .click();
  await channelButton(page, currentChannel.name).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    currentChannel.name,
  );
  await page
    .locator(".primary-nav")
    .getByRole("button", { name: /^Kaydedilenler/ })
    .click();
  await expect(parentArticle).toBeVisible();
  await parentArticle.click({ button: "right" });
  await page
    .getByRole("menu")
    .getByRole("menuitem", { name: "Mesajı yanıtla", exact: true })
    .click();
  const thread = page.locator(".thread-panel");
  await expect(thread).toBeVisible();
  await expect(
    thread.locator(`article[data-message-id="${reply.id}"]`),
  ).toBeVisible();
  const replyInput = page.getByRole("textbox", {
    name: "Yanıtını yaz",
    exact: true,
  });
  await replyInput.fill("Silinmiş kanala gönderilmemesi gereken taslak");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Kaydedilenler",
  );

  // The visible thread belongs to B, while the main selected channel remains A.
  // A server refresh from another page must invalidate B's thread independently.
  const remote = await context.newPage();
  try {
    const response = await remote.request.delete(
      `/api/admin/workspace/channels/${otherChannel.id}`,
      {
        headers,
        data: { confirmName: otherChannel.name },
      },
    );
    expect(response.status()).toBe(204);
    await expect(thread).toHaveCount(0);
    await expect(replyInput).toHaveCount(0);
    await expect(
      page.locator(`article[data-message-id="${reply.id}"]`),
    ).toHaveCount(0);
    await expect(parentArticle).toHaveCount(0);
    await channelButton(page, currentChannel.name).click();
    await expect(
      page.getByRole("textbox", {
        name: `#${currentChannel.name} kanalına mesaj yaz`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      currentChannel.name,
    );
    await page.reload();
    await page
      .locator(".primary-nav")
      .getByRole("button", { name: /^Kaydedilenler/ })
      .click();
    await expect(parentArticle).toHaveCount(0);
  } finally {
    await remote.close();
  }
});

test("a regular member sees navigation actions but no channel management actions", async ({
  page,
  browser,
}) => {
  await account(page);
  const channel = await createChannel(page);
  const invitation = await page.request.post("/api/invites", { headers });
  expect(invitation.status()).toBe(201);
  const token = new URL((await invitation.json()).url).searchParams.get(
    "invite",
  )!;
  const memberContext = await browser.newContext({ baseURL: origin });
  try {
    const memberPage = await memberContext.newPage();
    const data = await account(memberPage, token);
    expect(data.user.role).toBe("member");
    await openWorkspace(memberPage);
    const actions = await menu(memberPage, channel);
    await expect(
      actions.getByRole("menuitem", { name: "Sohbeti aç", exact: true }),
    ).toBeVisible();
    await expect(
      actions.getByRole("menuitem", {
        name: "Kanal adını kopyala",
        exact: true,
      }),
    ).toBeVisible();
    for (const name of ["Kanalı düzenle", "Kanalı arşivle", "Kanalı sil"]) {
      await expect(
        actions.getByRole("menuitem", { name, exact: true }),
      ).toHaveCount(0);
    }
    expect(
      (
        await memberPage.request.delete(
          `/api/admin/workspace/channels/${channel.id}`,
          { headers, data: { confirmName: channel.name } },
        )
      ).status(),
    ).toBe(403);
  } finally {
    await memberContext.close();
  }
});

test("an admin deletion dialog follows a remote rename and requires the current channel name", async ({
  page,
}) => {
  await account(page);
  const channel = await createChannel(page);
  await openWorkspace(page);
  await page
    .getByRole("button", { name: "Yönetim paneli", exact: true })
    .click();
  const admin = page.getByRole("dialog", {
    name: "Yönetim paneli",
    exact: true,
  });
  await admin.getByRole("button", { name: "Kanallar", exact: true }).click();
  await admin
    .getByRole("button", { name: `${channel.name} kanalını sil`, exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Kanalı sil", exact: true });
  const input = dialog.getByRole("textbox", {
    name: "Kanal adını doğrula",
    exact: true,
  });
  const remove = dialog.getByRole("button", {
    name: "Kanalı kalıcı olarak sil",
    exact: true,
  });
  await input.fill(channel.name);
  await expect(remove).toBeEnabled();
  const renamed = `${channel.name}-guncel`;
  const changed = await page.request.patch(
    `/api/admin/workspace/channels/${channel.id}`,
    { headers, data: { name: renamed } },
  );
  expect(changed.status()).toBe(200);
  await expect(dialog.locator(".channel-action-summary > strong")).toHaveText(
    renamed,
  );
  await expect(input).toHaveValue(channel.name);
  await expect(remove).toBeDisabled();
  await input.fill(renamed);
  await expect(remove).toBeEnabled();
  await remove.click();
  await expect(dialog).toHaveCount(0);
  await expect(
    admin.locator(".adm-channel").filter({ hasText: renamed }),
  ).toHaveCount(0);
  await admin
    .getByRole("button", { name: "İşlem geçmişi", exact: true })
    .click();
  await expect(admin.locator(".adm-audit")).toContainText(
    "Kanal kalıcı olarak silindi",
  );
  const snapshot = await (
    await page.request.get("/api/admin/workspace")
  ).json();
  expect(
    snapshot.channels.some((entry: Channel) => entry.id === channel.id),
  ).toBe(false);
  expect(
    snapshot.audit.some(
      (entry: { action: string; targetId: string }) =>
        entry.action === "channel.deleted" && entry.targetId === channel.id,
    ),
  ).toBe(true);
});

test("voice room right-click and overflow actions do not join the room", async ({
  page,
}) => {
  await account(page);
  const channel = await createChannel(page, "voice");
  await page.addInitScript(() => {
    (window as typeof window & { mediaRequests: number }).mediaRequests = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      (window as typeof window & { mediaRequests: number }).mediaRequests++;
      throw new Error("Channel menus must not request media");
    };
  });
  await openWorkspace(page);
  const currentTitle = await page
    .getByRole("heading", { level: 1 })
    .innerText();
  const actions = await menu(page, channel);
  await expect(
    actions.getByRole("menuitem", { name: "Sesli odaya katıl", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", {
      name: `${channel.name} kanal işlemleri`,
      exact: true,
    })
    .click();
  await actions
    .getByRole("menuitem", { name: "Kanalı düzenle", exact: true })
    .click();
  const edit = page.getByRole("dialog", {
    name: "Kanalı düzenle",
    exact: true,
  });
  await expect(edit).toBeVisible();
  await edit.getByRole("button", { name: "Vazgeç", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    currentTitle,
  );
  expect(
    await page.evaluate(
      () => (window as typeof window & { mediaRequests: number }).mediaRequests,
    ),
  ).toBe(0);
  expect(
    (
      await (await page.request.get("/api/auth/me")).json()
    ).voiceChannels.flatMap((entry: { peers: unknown[] }) => entry.peers),
  ).toEqual([]);
  await expect(page.locator(".call-setup")).toHaveCount(0);
});

test.describe("touch channel actions", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("the drawer overflow opens an editable dialog with focus and no horizontal overflow", async ({
    page,
  }) => {
    await account(page);
    const channel = await createChannel(page);
    await openWorkspace(page);
    await page.getByRole("button", { name: "Gezinmeyi aç", exact: true }).tap();
    await page
      .getByRole("button", {
        name: `${channel.name} kanal işlemleri`,
        exact: true,
      })
      .tap();
    const actions = page.getByRole("menu", {
      name: `${channel.name} kanal işlemleri`,
      exact: true,
    });
    await expect(actions).toBeVisible();
    await actions
      .getByRole("menuitem", { name: "Kanalı düzenle", exact: true })
      .tap();
    const edit = page.getByRole("dialog", {
      name: "Kanalı düzenle",
      exact: true,
    });
    const input = edit.getByRole("textbox", { name: "Kanal adı", exact: true });
    await expect(input).toBeFocused();
    await input.fill(`${channel.name}-mobil`);
    const bounds = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      dialog: document.querySelector("dialog[open]")!.getBoundingClientRect()
        .width,
      content: document.querySelector("dialog[open]")!.scrollWidth,
      dialogClient: document.querySelector("dialog[open]")!.clientWidth,
    }));
    expect(bounds.document).toBeLessThanOrEqual(bounds.viewport + 1);
    expect(bounds.dialog).toBeLessThanOrEqual(bounds.viewport);
    expect(bounds.content).toBeLessThanOrEqual(bounds.dialogClient + 1);
    await page.screenshot({
      path: "artifacts/channel-actions-mobile.png",
      animations: "disabled",
    });
    await edit
      .getByRole("button", { name: "Değişiklikleri kaydet", exact: true })
      .tap();
    await expect(edit).toHaveCount(0);
    await page.getByRole("button", { name: "Gezinmeyi aç", exact: true }).tap();
    await expect(channelButton(page, `${channel.name}-mobil`)).toBeVisible();
  });
});
