import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { Attachment, Bootstrap, Channel, Message } from "../shared/types";
import type { NotificationState } from "../shared/collaboration-types";
import type { ChannelFilesPage } from "../shared/collection-types";

const origin = "http://127.0.0.1:5174";
const headers = { Origin: origin };
const password = "message-delivery-browser-password";
const composer = (page: Page) =>
  page.locator(".conversation-panel > .composer-ux");
const input = (page: Page, name = "genel") =>
  page.getByRole("textbox", {
    name: `#${name} kanalına mesaj yaz`,
    exact: true,
  });
const send = (page: Page) =>
  composer(page).getByRole("button", { name: "Mesaj gönder", exact: true });

async function account(page: Page) {
  const response = await page.request.post("/api/auth/register", {
    headers,
    data: {
      name: "Deniz Gönderim",
      email: `delivery-${randomUUID()}@example.invalid`,
      password,
      workspaceName: "Güvenli Gönderim Ekibi",
    },
  });
  expect(response.status()).toBe(200);
  const data = (await response.json()) as Bootstrap;
  const channel = data.channels.find((item) => item.name === "genel")!;
  await page.goto(`/?workspace=${data.workspace.id}&channel=${channel.id}`);
  await expect(input(page)).toBeVisible();
  await expect(
    page.getByText("Her şey güncel", { exact: true }),
  ).toBeAttached();
  return { data, channel };
}

async function messages(request: APIRequestContext, channelId: string) {
  const response = await request.get(`/api/channels/${channelId}/messages`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { messages: Message[] }).messages;
}

test("retrying a committed message after its response is lost creates one message, mention and attachment", async ({
  page,
  browser,
}) => {
  const { channel } = await account(page);
  const peerContext = await browser.newContext();
  try {
    const inviteResponse = await page.request.post("/api/invites", { headers });
    expect(inviteResponse.status()).toBe(201);
    const invite = await inviteResponse.json();
    const registration = await peerContext.request.post(
      origin + "/api/auth/register",
      {
        headers,
        data: {
          name: "Ece Teslim",
          email: `delivery-peer-${randomUUID()}@example.invalid`,
          password,
          inviteToken: new URL(invite.url).searchParams.get("invite"),
        },
      },
    );
    expect(registration.status()).toBe(200);
    const peer = (await registration.json()) as Bootstrap;
    await page.reload();
    await expect(input(page)).toBeVisible();
    await composer(page)
      .getByRole("button", { name: "Birinden bahset", exact: true })
      .click();
    await composer(page)
      .getByRole("button", {
        name: `${peer.user.name}, ${peer.user.email}`,
        exact: true,
      })
      .click();
    await input(page).press("End");
    await input(page).pressSequentially(
      "yanıt kaybolsa da tek kez teslim edilir.",
    );
    const visibleContent = await input(page).inputValue();
    const fileName = "teslim-kanıtı.txt";
    const fileText = "Bu dosya yalnızca bir mesaja bağlanmalı.";
    await composer(page)
      .getByLabel("Paylaşılacak dosya", { exact: true })
      .setInputFiles({
        name: fileName,
        mimeType: "text/plain",
        buffer: Buffer.from(fileText),
      });
    await expect(
      composer(page).getByRole("button", {
        name: `${fileName} dosyasını kaldır`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(send(page)).toBeEnabled();

    const path = `/api/channels/${channel.id}/messages`;
    const attempts: {
      body: Record<string, unknown>;
      status: number;
      message: Message;
    }[] = [];
    await page.route(`**${path}`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      // The server commits and returns its real response before transport is lost.
      const response = await route.fetch();
      attempts.push({
        body: route.request().postDataJSON(),
        status: response.status(),
        message: (await response.json()) as Message,
      });
      if (attempts.length === 1) await route.abort("failed");
      else await route.fulfill({ response });
    });
    await send(page).click();
    await expect(composer(page).getByRole("alert")).toContainText(
      "Sonucu doğrulayamadık",
    );
    await expect(input(page)).toHaveValue(visibleContent);
    await expect(input(page)).toBeDisabled();
    await expect(send(page)).toHaveAttribute("title", "Gönderimi yeniden dene");
    await page.screenshot({
      path: "artifacts/third-package-retry-desktop.png",
      animations: "disabled",
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe(201);
    expect(attempts[0].body.clientMessageId).toMatch(/^[0-9a-f-]{36}$/i);
    const committed = attempts[0].message;
    expect(committed.attachments.map((file) => file.name)).toEqual([fileName]);
    expect(
      (await messages(page.request, channel.id)).map((item) => item.id),
    ).toEqual([committed.id]);

    await send(page).click();
    await expect(input(page)).toHaveValue("");
    await expect(input(page)).toBeEnabled();
    await expect(composer(page).getByRole("alert")).toHaveCount(0);
    expect(attempts).toHaveLength(2);
    expect(attempts[1].status).toBe(200);
    expect(attempts[1].body).toEqual(attempts[0].body);
    expect(attempts[1].message).toEqual(committed);
    const stored = await messages(page.request, channel.id);
    expect(stored.map((item) => item.id)).toEqual([committed.id]);
    expect(stored[0].attachments).toEqual(committed.attachments);
    const notificationsResponse = await peerContext.request.get(
      origin + "/api/notifications",
    );
    expect(notificationsResponse.status()).toBe(200);
    const notifications =
      (await notificationsResponse.json()) as NotificationState;
    expect(
      notifications.notifications.map((item) => ({
        messageId: item.messageId,
        kind: item.kind,
      })),
    ).toEqual([{ messageId: committed.id, kind: "mention" }]);
    const filesResponse = await page.request.get(
      `/api/channels/${channel.id}/files`,
    );
    expect(filesResponse.status()).toBe(200);
    const filesPage = (await filesResponse.json()) as ChannelFilesPage;
    expect(
      filesPage.files.map(({ id, name, size, mime, url }) => ({
        id,
        name,
        size,
        mime,
        url,
      })),
    ).toEqual(committed.attachments);
    expect(filesPage.total).toBe(committed.attachments.length);
    expect(filesPage.nextCursor).toBeNull();
    for (const file of filesPage.files) {
      expect(file.messageId).toBe(committed.id);
      expect(file.channelId).toBe(channel.id);
      expect(file.user.id).toBe(committed.userId);
      expect(file.parentId).toBeNull();
    }
    const download = await page.request.get(committed.attachments[0].url);
    expect(download.status()).toBe(200);
    expect(await download.text()).toBe(fileText);
    await page.reload();
    const rendered = page.locator(
      `.message[data-message-id="${committed.id}"]`,
    );
    await expect(rendered).toHaveCount(1);
    await expect(
      rendered.getByRole("link", {
        name: new RegExp(`${fileName} dosyasını indir`),
      }),
    ).toBeVisible();
    await expect(input(page)).toHaveValue("");
    expect(attempts).toHaveLength(2);
  } finally {
    await peerContext.close();
  }
});

test("an unresolved send stays in its original channel through profile navigation and reload without automatic resending", async ({
  page,
}) => {
  const { data, channel } = await account(page);
  const created = await page.request.post("/api/channels", {
    headers,
    data: { name: "ayrı-taslak", kind: "text" },
  });
  expect(created.status()).toBe(201);
  const other = (await created.json()) as Channel;
  const pendingText = "Bu gönderim yalnızca genel kanalına aittir.";
  const otherText = "İkinci kanaldaki bağımsız taslak korunur.";
  const path = `/api/channels/${channel.id}/messages`;
  const attempts: {
    body: Record<string, unknown>;
    status: number;
    message: Message;
  }[] = [];
  let release: (() => void) | undefined;
  const allPosts: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/api\/channels\/[^/]+\/messages$/.test(new URL(request.url()).pathname)
    )
      allPosts.push(new URL(request.url()).pathname);
  });
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    attempts.push({
      body: route.request().postDataJSON(),
      status: response.status(),
      message: await response.json(),
    });
    if (attempts.length === 1) {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.abort("failed");
    } else await route.fulfill({ response });
  });
  try {
    await input(page).fill(pendingText);
    await send(page).click();
    await expect.poll(() => Boolean(release)).toBe(true);
    expect(attempts[0].status).toBe(201);
    await page
      .locator("#workspace-navigation .channel-nav")
      .filter({ hasText: other.name })
      .click();
    await expect(input(page, other.name)).toBeEnabled();
    await expect(input(page, other.name)).toHaveValue("");
    await input(page, other.name).fill(otherText);
    await page.locator(".topbar-avatar.profile-identity").click();
    const profile = page.getByRole("region", {
      name: "Üye profili",
      exact: true,
    });
    await expect(profile.getByRole("heading", { level: 1 })).toContainText(
      data.user.name,
    );
    release!();
    release = undefined;
    await profile
      .getByRole("button", { name: "Sohbete dön", exact: true })
      .click();
    await expect(input(page, other.name)).toHaveValue(otherText);
    await expect(composer(page).getByRole("alert")).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (
            await (
              await page.request.get(`/api/channels/${other.id}/draft`)
            ).json()
          ).content,
      )
      .toBe(otherText);
    expect(await messages(page.request, other.id)).toEqual([]);
    expect(allPosts).toEqual([path]);

    await page
      .locator("#workspace-navigation .channel-nav")
      .filter({ hasText: /^genel$/ })
      .click();
    await expect(composer(page).getByRole("alert")).toContainText(
      "Sonucu doğrulayamadık",
    );
    await expect(input(page)).toHaveValue(pendingText);
    await expect(input(page)).toBeDisabled();
    await page.reload();
    await expect(composer(page).getByRole("alert")).toContainText(
      "Sonucu doğrulayamadık",
    );
    await expect(input(page)).toHaveValue(pendingText);
    await expect(input(page)).toBeDisabled();
    await expect(send(page)).toHaveAttribute("title", "Gönderimi yeniden dene");
    expect(allPosts).toEqual([path]);
    await page.evaluate(() => {
      const fixture = window as Window & {
        blockedSubmissionWrites?: number;
        restoreSubmissionStorage?: () => void;
      };
      const original = Storage.prototype.setItem;
      fixture.blockedSubmissionWrites = 0;
      fixture.restoreSubmissionStorage = () => {
        Storage.prototype.setItem = original;
      };
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith("mola:submission:")) {
          fixture.blockedSubmissionWrites! += 1;
          throw new DOMException(
            "Fixture: submission storage is full",
            "QuotaExceededError",
          );
        }
        original.call(this, key, value);
      };
    });
    await send(page).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { blockedSubmissionWrites?: number })
              .blockedSubmissionWrites,
        ),
      )
      .toBeGreaterThan(0);
    await expect(send(page)).toBeEnabled();
    await expect(send(page)).toHaveAttribute("title", "Gönderimi yeniden dene");
    await expect(input(page)).toHaveValue(pendingText);
    await expect(input(page)).toBeDisabled();
    await expect(composer(page).getByRole("alert")).toBeVisible();
    await expect(
      composer(page).getByRole("button", { name: "Taslağa dön", exact: true }),
    ).toHaveCount(0);
    expect(allPosts).toEqual([path]);
    await page.evaluate(() =>
      (
        window as Window & { restoreSubmissionStorage?: () => void }
      ).restoreSubmissionStorage?.(),
    );
    await send(page).click();
    await expect(input(page)).toHaveValue("");
    expect(attempts).toHaveLength(2);
    expect(attempts[1].status).toBe(200);
    expect(attempts[1].body).toEqual(attempts[0].body);
    expect(attempts[1].message.id).toBe(attempts[0].message.id);
    expect(
      (await messages(page.request, channel.id)).map((item) => item.id),
    ).toEqual([attempts[0].message.id]);
    await page
      .locator("#workspace-navigation .channel-nav")
      .filter({ hasText: other.name })
      .click();
    await expect(input(page, other.name)).toHaveValue(otherText);
    expect(await messages(page.request, other.id)).toEqual([]);
    expect(allPosts).toEqual([path, path]);
  } finally {
    release?.();
    await page
      .evaluate(() =>
        (
          window as Window & { restoreSubmissionStorage?: () => void }
        ).restoreSubmissionStorage?.(),
      )
      .catch(() => {});
  }
});

test("a saved conversation reply is rendered from its retry acknowledgement while a different channel remains selected", async ({
  page,
}) => {
  let blockedParent: string | undefined;
  let blockedEvents = 0;
  await page.routeWebSocket(/\/socket\.io\//, (socket) => {
    const server = socket.connectToServer();
    server.onMessage((frame) => {
      if (typeof frame === "string" && frame.startsWith("42[")) {
        const [event, payload] = JSON.parse(frame.slice(2)) as [
          string,
          { parentId?: string },
        ];
        if (
          event === "message:created" &&
          blockedParent &&
          payload.parentId === blockedParent
        ) {
          blockedEvents += 1;
          return;
        }
      }
      socket.send(frame);
    });
  });
  const { data, channel } = await account(page);
  const created = await page.request.post("/api/channels", {
    headers,
    data: { name: "kaydedilen-yanıt-kaynağı", kind: "text" },
  });
  expect(created.status()).toBe(201);
  const source = (await created.json()) as Channel;
  const rootResponse = await page.request.post(
    `/api/channels/${source.id}/messages`,
    {
      headers,
      data: { content: "Kaydedilenler içinden süren ayrı konuşma." },
    },
  );
  expect(rootResponse.status()).toBe(201);
  const parent = (await rootResponse.json()) as Message;
  const seedResponse = await page.request.post(
    `/api/channels/${source.id}/messages`,
    {
      headers,
      data: { content: "Konuşmanın önceki yanıtı.", parentId: parent.id },
    },
  );
  expect(seedResponse.status()).toBe(201);
  const seed = (await seedResponse.json()) as Message;
  expect(
    (await page.request.put(`/api/saved/${parent.id}`, { headers })).status(),
  ).toBe(200);
  const channelDraft = "Genel kanalındaki taslağa dokunulmayacak.";
  await input(page).fill(channelDraft);
  await page
    .locator("#workspace-navigation")
    .getByRole("button", { name: /^Kaydedilenler(?: \d+)?$/ })
    .click();
  const saved = page.getByRole("region", {
    name: "Kaydedilen mesajlar",
    exact: true,
  });
  const savedRoot = saved.locator(`article[data-message-id="${parent.id}"]`);
  await expect(savedRoot).toBeVisible();
  await savedRoot.getByRole("button", { name: /1 yanıt/ }).click();
  const thread = page.locator(".thread-panel");
  await expect(
    thread.locator(`[data-message-id="${seed.id}"] .message-text`),
  ).toHaveText(seed.content);
  const reply = thread.getByRole("textbox", {
    name: "Yanıtını yaz",
    exact: true,
  });
  const replySend = thread.getByRole("button", {
    name: "Yanıt gönder",
    exact: true,
  });
  const text = "Kaybolan yanıt tekrar doğrulanınca bu mesaj dizisinde görünür.";
  blockedParent = parent.id;
  const path = `/api/channels/${source.id}/messages`;
  const attempts: {
    body: Record<string, unknown>;
    status: number;
    message: Message;
  }[] = [];
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    attempts.push({
      body: route.request().postDataJSON(),
      status: response.status(),
      message: await response.json(),
    });
    if (attempts.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await reply.fill(text);
  await replySend.click();
  await expect(thread.getByRole("alert")).toContainText(
    "Sonucu doğrulayamadık",
  );
  await expect.poll(() => blockedEvents).toBe(1);
  expect(attempts[0].status).toBe(201);
  const committed = attempts[0].message;
  expect(committed.channelId).toBe(source.id);
  expect(committed.parentId).toBe(parent.id);
  await expect(
    thread.locator(`[data-message-id="${committed.id}"]`),
  ).toHaveCount(0);
  await expect(reply).toHaveValue(text);
  await replySend.click();
  await expect(
    thread.locator(`[data-message-id="${committed.id}"] .message-text`),
  ).toHaveText(text);
  await expect(
    thread.locator(`[data-message-id="${committed.id}"]`),
  ).toHaveCount(1);
  await expect(reply).toHaveValue("");
  expect(attempts).toHaveLength(2);
  expect(attempts[1].status).toBe(200);
  expect(attempts[1].body).toEqual(attempts[0].body);
  expect(attempts[1].message.id).toBe(committed.id);
  expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual({
    workspace: data.workspace.id,
    view: "saved",
    thread: parent.id,
  });
  expect(await messages(page.request, channel.id)).toEqual([]);
  const repliesResponse = await page.request.get(
    `${path}?parentId=${parent.id}`,
  );
  expect(repliesResponse.status()).toBe(200);
  expect(
    ((await repliesResponse.json()) as { messages: Message[] }).messages.map(
      (item) => item.id,
    ),
  ).toEqual([seed.id, committed.id]);
  await thread
    .getByRole("button", { name: "Mesaj dizisini kapat", exact: true })
    .click();
  await page
    .locator("#workspace-navigation")
    .getByRole("button", { name: channel.name, exact: true })
    .click();
  await expect(input(page)).toHaveValue(channelDraft);
  await expect(
    page.locator(`.conversation-panel [data-message-id="${committed.id}"]`),
  ).toHaveCount(0);
});

test("returning a failed send to its draft keeps the frozen text and file through navigation during a delayed restore", async ({
  page,
}) => {
  const { data, channel } = await account(page);
  const created = await page.request.post("/api/channels", {
    headers,
    data: { name: "geri-dönüş-sırasında", kind: "text" },
  });
  expect(created.status()).toBe(201);
  const other = (await created.json()) as Channel;
  const frozenText = "Başarısız gönderimdeki özgün metin ve dosya korunur.";
  const remoteText = "Diğer cihazda yazılan yeni ve farklı taslak.";
  const fileName = "başarısız-gönderimin-eki.txt";
  await input(page).fill(frozenText);
  await composer(page)
    .getByLabel("Paylaşılacak dosya", { exact: true })
    .setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from("Gönderimden taslağa taşınan dosya bilgisi."),
    });
  await expect(
    composer(page).getByRole("button", {
      name: `${fileName} dosyasını kaldır`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(send(page)).toBeEnabled();
  const sendPath = `/api/channels/${channel.id}/messages`;
  const draftPath = `/api/channels/${channel.id}/draft`;
  let releasePost: (() => void) | undefined;
  let releaseDraft: (() => void) | undefined;
  let draftResponseSettled = false;
  let postResult: { status: number; code: string } | undefined;
  const posts: Record<string, unknown>[] = [];
  await page.route(`**${sendPath}`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts.push(route.request().postDataJSON());
    await new Promise<void>((resolve) => {
      releasePost = resolve;
    });
    const response = await route.fetch();
    postResult = {
      status: response.status(),
      code: (await response.json()).code,
    };
    await route.fulfill({ response });
  });
  try {
    await send(page).click();
    await expect.poll(() => Boolean(releasePost)).toBe(true);
    const original = await (await page.request.get(draftPath)).json();
    expect(original.content).toBe(frozenText);
    expect(original.attachments.map((file: Attachment) => file.name)).toEqual([
      fileName,
    ]);
    const consumed = await page.request.post(
      `/api/channels/${other.id}/messages`,
      {
        headers,
        data: {
          content: "Dosyayı kullanan bağımsız mesaj.",
          attachmentIds: original.attachmentIds,
        },
      },
    );
    expect(consumed.status()).toBe(201);
    const changed = await page.request.put(draftPath, {
      headers,
      data: {
        content: remoteText,
        attachmentIds: [],
        revision: original.revision,
      },
    });
    expect(changed.status()).toBe(200);
    const remote = await changed.json();
    expect(remote.revision).toBeGreaterThan(original.revision);
    releasePost!();
    releasePost = undefined;
    await expect(
      composer(page).getByRole("button", { name: "Taslağa dön", exact: true }),
    ).toBeVisible();
    expect(postResult).toEqual({ status: 409, code: "ATTACHMENT_UNAVAILABLE" });
    await expect(input(page)).toHaveValue(frozenText);
    await expect(input(page)).toBeDisabled();
    let held = false;
    await page.route(`**${draftPath}`, async (route) => {
      if (route.request().method() !== "GET" || held) return route.continue();
      held = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      const snapshot = await response.json();
      expect(snapshot.content).toBe(remoteText);
      expect(snapshot.attachmentIds).toEqual([]);
      await new Promise<void>((resolve) => {
        releaseDraft = resolve;
      });
      try {
        await route.fulfill({ response });
      } catch {
        /* leaving may cancel this obsolete read */
      }
      draftResponseSettled = true;
    });
    await composer(page)
      .getByRole("button", { name: "Taslağa dön", exact: true })
      .click();
    await expect.poll(() => Boolean(releaseDraft)).toBe(true);
    await page
      .locator("#workspace-navigation")
      .getByRole("button", { name: other.name, exact: true })
      .click();
    const otherDraft = "Geri dönüş beklerken diğer kanalın bağımsız metni.";
    await input(page, other.name).fill(otherDraft);
    await page.locator(".topbar-avatar.profile-identity").click();
    const profile = page.getByRole("region", {
      name: "Üye profili",
      exact: true,
    });
    await expect(profile.getByRole("heading", { level: 1 })).toContainText(
      data.user.name,
    );
    releaseDraft!();
    releaseDraft = undefined;
    await expect.poll(() => draftResponseSettled).toBe(true);
    await profile
      .getByRole("button", { name: "Sohbete dön", exact: true })
      .click();
    await expect(input(page, other.name)).toHaveValue(otherDraft);
    await page
      .locator("#workspace-navigation")
      .getByRole("button", { name: channel.name, exact: true })
      .click();
    await expect(input(page)).toHaveValue(frozenText);
    await expect(input(page)).toBeDisabled();
    await expect(
      composer(page).getByRole("button", {
        name: `${fileName} dosyasını kaldır`,
        exact: true,
      }),
    ).toBeVisible();
    const release = composer(page).getByRole("button", {
      name: "Taslağa dön",
      exact: true,
    });
    await expect(release).toBeEnabled();
    expect(posts).toHaveLength(1);
    await release.focus();
    await release.press("Enter");
    const conflict = composer(page).locator(".draft-conflict");
    await expect(conflict).toContainText(
      "Bu taslak başka bir cihazda değişti.",
    );
    await expect(input(page)).toHaveValue(frozenText);
    await expect(input(page)).toBeEnabled();
    await expect(input(page)).toBeFocused();
    await expect(
      composer(page).getByRole("button", {
        name: `${fileName} dosyasını kaldır`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(release).toHaveCount(0);
    await expect(send(page)).toBeDisabled();
    await conflict
      .getByText("Diğer cihazdaki taslağı göster", { exact: true })
      .click();
    await expect(conflict).toContainText(remoteText);
    expect((await (await page.request.get(draftPath)).json()).content).toBe(
      remoteText,
    );
    expect(await messages(page.request, channel.id)).toEqual([]);
    expect(posts).toHaveLength(1);
    await page.reload();
    await expect(conflict).toContainText(
      "Bu taslak başka bir cihazda değişti.",
    );
    await expect(input(page)).toHaveValue(frozenText);
    await expect(
      composer(page).getByRole("button", {
        name: `${fileName} dosyasını kaldır`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(send(page)).toBeDisabled();
    expect((await (await page.request.get(draftPath)).json()).content).toBe(
      remoteText,
    );
    expect(posts).toHaveLength(1);
    await conflict
      .getByRole("button", { name: "Diğer taslağı kullan", exact: true })
      .click();
    await expect(conflict).toHaveCount(0);
    await expect(input(page)).toHaveValue(remoteText);
    await expect(
      composer(page).locator(".composer-attachments > span"),
    ).toHaveCount(0);
    expect((await (await page.request.get(draftPath)).json()).content).toBe(
      remoteText,
    );
    expect(await messages(page.request, channel.id)).toEqual([]);
    expect(posts).toHaveLength(1);
  } finally {
    releasePost?.();
    releaseDraft?.();
  }
});
