import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import type { Attachment, Bootstrap, Channel, Message } from "../shared/types";
import type { DraftState } from "../shared/collaboration-types";

const origin = "http://127.0.0.1:5174";
const headers = { Origin: origin };
const password = "draft-attachments-browser-password";
const composer = (page: Page) =>
  page.locator(".conversation-panel > .composer-ux");
const input = (page: Page, name = "genel") =>
  page.getByRole("textbox", {
    name: `#${name} kanalına mesaj yaz`,
    exact: true,
  });
const chip = (page: Page, name: string) =>
  composer(page).getByRole("button", {
    name: `${name} dosyasını kaldır`,
    exact: true,
  });
const send = (page: Page) =>
  composer(page).getByRole("button", { name: "Mesaj gönder", exact: true });

async function account(page: Page) {
  const email = `draft-files-${randomUUID()}@example.invalid`;
  const response = await page.request.post(origin + "/api/auth/register", {
    headers,
    data: {
      name: "Deniz Dosya",
      email,
      password,
      workspaceName: "Ekli Taslak Ekibi",
    },
  });
  expect(response.status()).toBe(200);
  const data = (await response.json()) as Bootstrap;
  const channel = data.channels.find((item) => item.name === "genel")!;
  await page.goto(
    `${origin}/?workspace=${data.workspace.id}&channel=${channel.id}`,
  );
  await expect(input(page)).toBeVisible();
  await expect(
    page.getByText("Her şey güncel", { exact: true }),
  ).toBeAttached();
  return { email, data, channel };
}

async function createChannel(page: Page, name: string) {
  const response = await page.request.post("/api/channels", {
    headers,
    data: { name, kind: "text" },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as Channel;
}

async function draft(
  request: APIRequestContext,
  channelId: string,
  parentId?: string,
) {
  const response = await request.get(
    `${origin}/api/channels/${channelId}/draft${parentId ? `?parentId=${parentId}` : ""}`,
  );
  expect(response.status()).toBe(200);
  return (await response.json()) as DraftState;
}

async function upload(page: Page, name: string) {
  await composer(page)
    .getByLabel("Paylaşılacak dosya", { exact: true })
    .setInputFiles({
      name,
      mimeType: "text/plain",
      buffer: Buffer.from(`${name} dosyasının içeriği.`),
    });
  await expect(chip(page, name)).toBeVisible();
  await expect(
    composer(page).getByRole("button", { name: "Dosya ekle", exact: true }),
  ).toBeEnabled();
}

async function navigate(page: Page, name: string) {
  await page
    .locator("#workspace-navigation .channel-nav")
    .filter({ hasText: name })
    .click();
  await expect(input(page, name)).toBeVisible();
}

test("uploaded draft attachments survive channel and profile navigation, reload and another tab", async ({
  page,
  browser,
}) => {
  const { email, data, channel } = await account(page);
  const other = await createChannel(page, "başka-dosya-taslağı");
  const text = "Bu kararlar ve ekleri birlikte korunur.";
  const firstName = "kararlar.txt",
    secondName = "notlar.txt";
  await input(page).fill(text);
  await upload(page, firstName);
  await upload(page, secondName);
  await expect
    .poll(async () =>
      (await draft(page.request, channel.id)).attachments.map(
        (file) => file.name,
      ),
    )
    .toEqual([firstName, secondName]);
  const saved = await draft(page.request, channel.id);
  expect(saved.content).toBe(text);
  expect(saved.attachmentIds).toEqual(saved.attachments.map((file) => file.id));
  expect(saved.unavailableAttachmentIds).toEqual([]);

  await navigate(page, other.name);
  await expect(input(page, other.name)).toHaveValue("");
  await expect(
    composer(page).locator(".composer-attachments > span"),
  ).toHaveCount(0);
  await navigate(page, channel.name);
  await expect(input(page)).toHaveValue(text);
  await expect(chip(page, firstName)).toBeVisible();
  await expect(chip(page, secondName)).toBeVisible();
  await page.locator(".topbar-avatar.profile-identity").click();
  const profile = page.getByRole("region", {
    name: "Üye profili",
    exact: true,
  });
  await expect(profile.getByRole("heading", { level: 1 })).toContainText(
    data.user.name,
  );
  await profile
    .getByRole("button", { name: "Sohbete dön", exact: true })
    .click();
  await expect(input(page)).toHaveValue(text);
  await expect(chip(page, firstName)).toBeVisible();
  await expect(chip(page, secondName)).toBeVisible();
  await page.reload();
  await expect(input(page)).toHaveValue(text);
  await expect(chip(page, firstName)).toBeVisible();
  await expect(chip(page, secondName)).toBeVisible();

  const context = await browser.newContext();
  try {
    const login = await context.request.post(origin + "/api/auth/login", {
      headers,
      data: { email, password },
    });
    expect(login.status()).toBe(200);
    const second = await context.newPage();
    await second.goto(
      `${origin}/?workspace=${data.workspace.id}&channel=${channel.id}`,
    );
    await expect(input(second)).toHaveValue(text);
    await expect(chip(second, firstName)).toBeVisible();
    await expect(chip(second, secondName)).toBeVisible();
    await chip(second, firstName).click();
    await expect(chip(second, firstName)).toHaveCount(0);
    await expect(chip(page, firstName)).toHaveCount(0);
    await expect(chip(page, secondName)).toBeVisible();
    await expect
      .poll(async () => (await draft(page.request, channel.id)).attachmentIds)
      .toEqual([saved.attachments[1].id]);
    await page.reload();
    await expect(input(page)).toHaveValue(text);
    await expect(chip(page, firstName)).toHaveCount(0);
    await expect(chip(page, secondName)).toBeVisible();
    for (const file of saved.attachments) {
      const response = await page.request.get(file.url);
      expect(response.status()).toBe(200);
      expect(await response.text()).toBe(`${file.name} dosyasının içeriği.`);
    }
  } finally {
    await context.close();
  }
});

test("different attachments with identical text cause a draft conflict and choosing the remote version applies its files", async ({
  page,
  browser,
}) => {
  const { email, data, channel } = await account(page);
  const text = "Metin aynı olsa da ek seçimi farklı olabilir.";
  await input(page).fill(text);
  await expect
    .poll(async () => (await draft(page.request, channel.id)).content)
    .toBe(text);
  const context = await browser.newContext();
  const path = `/api/channels/${channel.id}/draft`;
  let releaseUpload: (() => void) | undefined;
  let uploadSettled = false;
  try {
    expect(
      (
        await context.request.post(origin + "/api/auth/login", {
          headers,
          data: { email, password },
        })
      ).status(),
    ).toBe(200);
    const second = await context.newPage();
    await second.goto(
      `${origin}/?workspace=${data.workspace.id}&channel=${channel.id}`,
    );
    await expect(input(second)).toHaveValue(text);
    await page.route(`**${path}`, (route) =>
      route.request().method() === "PUT"
        ? route.abort("failed")
        : route.continue(),
    );
    const localName = "buradaki-ek.txt",
      remoteName = "diğer-cihazdaki-ek.txt";
    await upload(page, localName);
    await expect(
      composer(page).getByText("Taslak bu cihazda", { exact: false }),
    ).toBeVisible();
    const pendingName = "eski-seçime-ait-geç-dosya.txt";
    await page.route("**/api/uploads", async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await new Promise<void>((resolve) => {
        releaseUpload = resolve;
      });
      try {
        await route.fulfill({ response });
      } catch {
        /* choosing a version may cancel the old upload */
      }
      uploadSettled = true;
    });
    await composer(page)
      .getByLabel("Paylaşılacak dosya", { exact: true })
      .setInputFiles({
        name: pendingName,
        mimeType: "text/plain",
        buffer: Buffer.from("Eski yerel seçimin devam eden yüklemesi."),
      });
    await expect.poll(() => Boolean(releaseUpload)).toBe(true);
    await upload(second, remoteName);
    await expect
      .poll(async () =>
        (await draft(context.request, channel.id)).attachments.map(
          (file) => file.name,
        ),
      )
      .toEqual([remoteName]);
    const remote = await draft(context.request, channel.id);
    const conflict = composer(page).locator(".draft-conflict");
    await expect(conflict).toContainText(
      "Bu taslak başka bir cihazda değişti.",
    );
    await expect(input(page)).toHaveValue(text);
    await expect(chip(page, localName)).toBeVisible();
    await expect(chip(page, remoteName)).toHaveCount(0);
    await expect(send(page)).toBeDisabled();
    await conflict
      .getByText("Diğer cihazdaki taslağı göster", { exact: true })
      .click();
    await expect(conflict).toContainText(text);
    await expect(conflict).toContainText(remoteName);
    await page.unroute(`**${path}`);
    await conflict
      .getByRole("button", { name: "Diğer taslağı kullan", exact: true })
      .click();
    await expect(conflict).toHaveCount(0);
    await expect(input(page)).toHaveValue(text);
    await expect(chip(page, localName)).toHaveCount(0);
    await expect(chip(page, remoteName)).toBeVisible();
    releaseUpload!();
    releaseUpload = undefined;
    await expect.poll(() => uploadSettled).toBe(true);
    await expect(chip(page, pendingName)).toHaveCount(0);
    await expect(chip(page, remoteName)).toBeVisible();
    await expect(send(page)).toBeEnabled();
    expect((await draft(page.request, channel.id)).attachmentIds).toEqual(
      remote.attachmentIds,
    );
    await page.reload();
    await expect(input(page)).toHaveValue(text);
    await expect(chip(page, localName)).toHaveCount(0);
    await expect(chip(page, pendingName)).toHaveCount(0);
    await expect(chip(page, remoteName)).toBeVisible();
    await second.reload();
    await expect(chip(second, remoteName)).toBeVisible();
  } finally {
    releaseUpload?.();
    await context.close();
  }
});

test.describe("compact unavailable attachment", () => {
  test.use({
    viewport: { width: 320, height: 720 },
    hasTouch: true,
    isMobile: true,
  });

  test("a missing draft file is explicit and blocks sending until it is deliberately removed", async ({
    page,
  }) => {
    const { channel } = await account(page);
    const other = await createChannel(page, "geçici-dosya-hedefi");
    const text = "Dosya eksikken bu metin sessizce gönderilmemeli.";
    const name = "son-kararlar-ve-uygulama-notlarının-güncel-kopyası.txt";
    await input(page).fill(text);
    await upload(page, name);
    await expect
      .poll(
        async () =>
          (await draft(page.request, channel.id)).attachmentIds.length,
      )
      .toBe(1);
    const saved = await draft(page.request, channel.id);
    const attachment = saved.attachments[0];
    // Consume the upload in a different scope, then delete that real message/file.
    // The original draft still references the now-unavailable attachment.
    const consumed = await page.request.post(
      `/api/channels/${other.id}/messages`,
      {
        headers,
        data: {
          content: "Geçici dosya taşıyıcısı",
          attachmentIds: [attachment.id],
        },
      },
    );
    expect(consumed.status()).toBe(201);
    const message = (await consumed.json()) as Message;
    expect(
      (
        await page.request.delete(`/api/messages/${message.id}`, { headers })
      ).status(),
    ).toBe(204);
    await expect
      .poll(
        async () =>
          (await draft(page.request, channel.id)).unavailableAttachmentIds,
      )
      .toEqual([attachment.id]);
    await page.reload();
    await expect(input(page)).toHaveValue(text);
    const unavailable = composer(page).locator(
      ".composer-attachments .is-unavailable",
    );
    await expect(unavailable).toHaveCount(1);
    await expect(unavailable).toContainText(
      /Dosya kullanılamıyor|Kullanılamayan dosya/,
    );
    await expect(send(page)).toBeDisabled();
    const posts: Record<string, unknown>[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname ===
          `/api/channels/${channel.id}/messages`
      )
        posts.push(request.postDataJSON());
    });
    await input(page).press("Enter");
    await expect(input(page)).toHaveValue(text);
    expect(posts).toEqual([]);
    expect((await draft(page.request, channel.id)).attachmentIds).toEqual([
      attachment.id,
    ]);
    const bounds = await unavailable.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const audit = await new AxeBuilder({ page }).analyze();
    expect(
      audit.violations
        .filter(
          (item) => item.impact === "serious" || item.impact === "critical",
        )
        .map((item) => ({
          id: item.id,
          nodes: item.nodes.map((node) => ({
            target: node.target,
            summary: node.failureSummary,
          })),
        })),
    ).toEqual([]);
    await page.screenshot({
      path: "artifacts/third-package-draft-mobile.png",
      animations: "disabled",
    });

    const remove = unavailable.getByRole("button", {
      name: /dosyasını kaldır|Kullanılamayan dosyayı kaldır/,
    });
    await remove.focus();
    await remove.press("Enter");
    await expect(unavailable).toHaveCount(0);
    await expect(input(page)).toBeFocused();
    await expect(input(page)).toHaveValue(text);
    await expect(send(page)).toBeEnabled();
    expect(posts).toEqual([]);
    const sent = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname ===
          `/api/channels/${channel.id}/messages`,
    );
    await send(page).click();
    const response = await sent;
    expect(response.status()).toBe(201);
    const delivered = (await response.json()) as Message;
    expect(delivered.content).toBe(text);
    expect(delivered.attachments).toEqual([]);
    expect(posts).toHaveLength(1);
    expect(posts[0].attachmentIds).toEqual([]);
    await expect(input(page)).toHaveValue("");
  });
});

test("a late upload cannot enter another channel or reply draft while previously selected files remain in their original scope", async ({
  page,
}) => {
  const { channel } = await account(page);
  const other = await createChannel(page, "geç-yükleme-yalıtımı");
  const rootResponse = await page.request.post(
    `/api/channels/${other.id}/messages`,
    {
      headers,
      data: { content: "Yanıt taslağı için ayrı başlangıç" },
    },
  );
  expect(rootResponse.status()).toBe(201);
  const root = (await rootResponse.json()) as Message;
  const selectedName = "önceden-yüklenmiş.txt",
    lateName = "geç-tamamlanan.txt";
  await input(page).fill("İlk kanalın metni ve tamamlanan dosyası.");
  await upload(page, selectedName);
  await expect
    .poll(async () =>
      (await draft(page.request, channel.id)).attachments.map(
        (file) => file.name,
      ),
    )
    .toEqual([selectedName]);
  const saved = await draft(page.request, channel.id);
  let intercepted = false,
    settled = false;
  let release: (() => void) | undefined;
  let lateFile: Attachment | undefined;
  await page.route("**/api/uploads", async (route) => {
    if (route.request().method() !== "POST" || intercepted)
      return route.continue();
    intercepted = true;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    lateFile = (await response.json()) as Attachment;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    // Navigation may legitimately abort the browser fetch before delivery.
    try {
      await route.fulfill({ response });
    } catch {
      /* the canceled upload must not enter the new scope */
    }
    settled = true;
  });
  try {
    await composer(page)
      .getByLabel("Paylaşılacak dosya", { exact: true })
      .setInputFiles({
        name: lateName,
        mimeType: "text/plain",
        buffer: Buffer.from("Geciken gerçek dosya yanıtı."),
      });
    await expect.poll(() => Boolean(release)).toBe(true);
    await expect(
      composer(page)
        .getByRole("status")
        .filter({ hasText: `${lateName} yükleniyor` }),
    ).toBeVisible();
    await navigate(page, other.name);
    await input(page, other.name).fill("İkinci kanalın ayrı taslağı.");
    const article = page.locator(
      `.conversation-panel [data-message-id="${root.id}"]`,
    );
    await article.hover();
    await article
      .getByRole("button", { name: "Mesajı yanıtla", exact: true })
      .click();
    const reply = page.getByRole("textbox", {
      name: "Yanıtını yaz",
      exact: true,
    });
    await reply.fill("İkinci kanaldaki ayrı yanıt taslağı.");
    release!();
    release = undefined;
    await expect.poll(() => settled).toBe(true);
    expect(lateFile?.name).toBe(lateName);
    await expect(
      composer(page).locator(".composer-attachments > span"),
    ).toHaveCount(0);
    await expect(
      page.locator(".thread-composer .composer-attachments > span"),
    ).toHaveCount(0);
    await expect(input(page, other.name)).toHaveValue(
      "İkinci kanalın ayrı taslağı.",
    );
    await expect(reply).toHaveValue("İkinci kanaldaki ayrı yanıt taslağı.");
    await expect
      .poll(async () => (await draft(page.request, other.id)).content)
      .toBe("İkinci kanalın ayrı taslağı.");
    await expect
      .poll(async () => (await draft(page.request, other.id, root.id)).content)
      .toBe("İkinci kanaldaki ayrı yanıt taslağı.");
    expect((await draft(page.request, other.id)).attachmentIds).toEqual([]);
    expect(
      (await draft(page.request, other.id, root.id)).attachmentIds,
    ).toEqual([]);
    await page
      .getByRole("button", { name: "Mesaj dizisini kapat", exact: true })
      .click();
    await navigate(page, channel.name);
    await expect(input(page)).toHaveValue(saved.content);
    await expect(chip(page, selectedName)).toBeVisible();
    await expect(chip(page, lateName)).toHaveCount(0);
    expect((await draft(page.request, channel.id)).attachmentIds).toEqual(
      saved.attachmentIds,
    );
    await page.reload();
    await expect(chip(page, selectedName)).toBeVisible();
    await expect(chip(page, lateName)).toHaveCount(0);
  } finally {
    release?.();
  }
});
