import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type Route,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { Attachment, Bootstrap, Channel, Message } from "../shared/types";

const origin = "http://127.0.0.1:5174";
const headers = { Origin: origin };
const panel = (page: Page) => page.locator(".conversation-panel");
const files = (page: Page) =>
  page.getByRole("region", { name: "Paylaşılan dosyalar", exact: true });
const pins = (page: Page) =>
  page.getByRole("region", { name: "Sabitlenen mesajlar", exact: true });
const temporaryError = "Liste geçici olarak yüklenemiyor. Yeniden deneyin.";

async function register(
  request: APIRequestContext,
  name = "Koleksiyon Sahibi",
  inviteToken?: string,
) {
  const response = await request.post(origin + "/api/auth/register", {
    headers,
    data: {
      name,
      email: `collections-pages-${randomUUID()}@example.invalid`,
      password: "collections-pages-browser-password",
      workspaceName: "Koleksiyon Sayfaları",
      ...(inviteToken ? { inviteToken } : {}),
    },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as Bootstrap;
}

async function upload(
  request: APIRequestContext,
  name: string,
  buffer = Buffer.from(`${name} gerçek dosya içeriği.`),
  mimeType = "text/plain",
) {
  const response = await request.post(origin + "/api/uploads", {
    headers,
    multipart: { file: { name, mimeType, buffer } },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as Attachment;
}

async function post(
  request: APIRequestContext,
  channelId: string,
  content: string,
  attachments: Attachment[] = [],
) {
  const response = await request.post(
    `${origin}/api/channels/${channelId}/messages`,
    {
      headers,
      data: { content, attachmentIds: attachments.map((file) => file.id) },
    },
  );
  expect(response.status()).toBe(201);
  return (await response.json()) as Message;
}

async function open(
  page: Page,
  data: Bootstrap,
  channel: Channel,
  tab = "Dosyalar",
) {
  await page.goto(`/?workspace=${data.workspace.id}&channel=${channel.id}`);
  await expect(
    panel(page).getByRole("textbox", {
      name: `#${channel.name} kanalına mesaj yaz`,
      exact: true,
    }),
  ).toBeVisible();
  await panel(page).getByRole("tab", { name: tab, exact: true }).click();
}

async function smallPage(route: Route) {
  // The real endpoint supplies all items/cursors. Only the transport page size is
  // shortened; 150+ item coverage lives in the server pagination tests.
  const url = new URL(route.request().url());
  url.searchParams.set("limit", "2");
  const response = await route.fetch({ url: url.toString() });
  await route.fulfill({ response });
}

async function frames(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function allowLateDelivery(page: Page) {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      return /\/api\/channels\/[^/]+\/(files|pins)$/.test(
        new URL(url, location.href).pathname,
      )
        ? original(input, { ...options, signal: undefined })
        : original(input, options);
    };
  });
}

test("files recover from first and next page failures, search names across pages and open the source message", async ({
  page,
}) => {
  const data = await register(page.request);
  const channel = data.channels.find((item) => item.name === "genel")!;
  const entries: { file: Attachment; message: Message }[] = [];
  for (const [index, name] of [
    "yalnız-dosya-adında-aranır.txt",
    "toplantı-kararları.txt",
    "tasarım-notları.txt",
  ].entries()) {
    const file = await upload(page.request, name);
    const message = await post(
      page.request,
      channel.id,
      `Kayıt sırası ${index}; metin dosya arama ifadesini içermiyor.`,
      [file],
    );
    entries.push({ file, message });
  }
  const path = `/api/channels/${channel.id}/files`;
  let failInitial = true,
    failNext = true;
  await page.route(`**${path}**`, async (route) => {
    const url = new URL(route.request().url());
    expect(route.request().headers()["x-workspace-id"]).toBe(data.workspace.id);
    expect(route.request().headers()["x-user-id"]).toBe(data.user.id);
    if (failInitial || (url.searchParams.has("cursor") && failNext))
      return route.fulfill({ status: 503, json: { error: temporaryError } });
    await smallPage(route);
  });
  await open(page, data, channel);
  const error = panel(page).getByRole("alert", {
    name: "Dosyalar yüklenemedi",
    exact: true,
  });
  await expect(error).toContainText(temporaryError);
  await expect(
    panel(page).getByRole("heading", {
      name: "İlk dosyaya yer açtık.",
      exact: true,
    }),
  ).toHaveCount(0);
  failInitial = false;
  await error
    .getByRole("button", { name: "Yeniden dene", exact: true })
    .click();
  const previews = files(page).getByRole("button", {
    name: / dosyasını önizle$/,
  });
  await expect(previews).toHaveCount(2);
  const firstPage = await previews.allTextContents();
  await files(page)
    .getByRole("button", { name: "Daha fazla göster", exact: true })
    .click();
  await expect(error).toContainText(temporaryError);
  await expect(previews).toHaveCount(2);
  expect(await previews.allTextContents()).toEqual(firstPage);
  failNext = false;
  await error
    .getByRole("button", { name: "Yeniden dene", exact: true })
    .click();
  await expect(error).toHaveCount(0);
  await expect(previews).toHaveCount(3);
  for (const entry of entries)
    await expect(
      files(page).getByRole("button", {
        name: `${entry.file.name} dosyasını önizle`,
        exact: true,
      }),
    ).toBeVisible();
  await expect(
    files(page).getByRole("button", { name: "Daha fazla göster", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "artifacts/fourth-package-files-desktop.png",
    animations: "disabled",
  });
  await files(page)
    .getByRole("searchbox", { name: "Dosyalarda ara", exact: true })
    .fill("yalnız-dosya-adında");
  await expect(previews).toHaveCount(1);
  await expect(
    files(page).getByRole("button", {
      name: `${entries[0].file.name} dosyasını önizle`,
      exact: true,
    }),
  ).toBeVisible();
  await files(page)
    .getByRole("button", {
      name: `${entries[0].file.name} dosyasının mesajına git`,
      exact: true,
    })
    .click();
  await expect(
    panel(page).getByRole("tab", { name: "Sohbet", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    panel(page).locator(
      `[data-message-id="${entries[0].message.id}"] .message-text`,
    ),
  ).toHaveText(entries[0].message.content);
  expect(new URL(page.url()).searchParams.get("message")).toBe(
    entries[0].message.id,
  );
});

test("pins retain existing messages on a later page failure and all pages remain searchable", async ({
  page,
}) => {
  const data = await register(page.request);
  const channel = data.channels.find((item) => item.name === "genel")!;
  const messages: Message[] = [];
  for (const content of [
    "Eski ve bulunacak sabit karar.",
    "İkinci sabit karar.",
    "En yeni sabit karar.",
  ]) {
    const message = await post(page.request, channel.id, content);
    expect(
      (
        await page.request.patch(`/api/messages/${message.id}`, {
          headers,
          data: { pinned: true },
        })
      ).status(),
    ).toBe(200);
    messages.push(message);
  }
  let failNext = true;
  await page.route(`**/api/channels/${channel.id}/pins**`, (route) => {
    if (failNext && new URL(route.request().url()).searchParams.has("cursor"))
      return route.fulfill({ status: 503, json: { error: temporaryError } });
    return smallPage(route);
  });
  await open(page, data, channel, "Sabitlenenler");
  const rows = pins(page).locator("article[data-message-id]");
  await expect(rows).toHaveCount(2);
  const firstIds = await rows.evaluateAll((elements) =>
    elements.map((item) => item.getAttribute("data-message-id")),
  );
  await pins(page)
    .getByRole("button", { name: "Daha fazla göster", exact: true })
    .click();
  const error = panel(page).getByRole("alert", {
    name: "Sabitlenen mesajlar yüklenemedi",
    exact: true,
  });
  await expect(error).toContainText(temporaryError);
  await expect(rows).toHaveCount(2);
  expect(
    await rows.evaluateAll((elements) =>
      elements.map((item) => item.getAttribute("data-message-id")),
    ),
  ).toEqual(firstIds);
  failNext = false;
  await error
    .getByRole("button", { name: "Yeniden dene", exact: true })
    .click();
  await expect(rows).toHaveCount(3);
  const ids = await rows.evaluateAll((elements) =>
    elements.map((item) => item.getAttribute("data-message-id")),
  );
  expect(ids.slice().sort()).toEqual(messages.map((item) => item.id).sort());
  expect(new Set(ids).size).toBe(3);
  await expect(
    pins(page).getByRole("button", { name: "Daha fazla göster", exact: true }),
  ).toHaveCount(0);
  await pins(page)
    .getByRole("searchbox", { name: "Sabitlenen mesajlarda ara", exact: true })
    .fill("bulunacak");
  await expect(rows).toHaveCount(1);
  await expect(rows.locator(".message-text")).toHaveText(messages[0].content);
});

test("late collection responses cannot replace a newer filename query or another workspace's files", async ({
  page,
}) => {
  const home = await register(page.request);
  const channel = home.channels.find((item) => item.name === "genel")!;
  const oldFile = await upload(page.request, "eski-sonuç.txt");
  const freshFile = await upload(page.request, "yeni-sonuç.txt");
  await post(page.request, channel.id, "İlk alan dosyaları.", [
    oldFile,
    freshFile,
  ]);
  const created = await page.request.post("/api/workspaces", {
    headers,
    data: { name: "Koleksiyon İkinci Alan" },
  });
  expect(created.status()).toBe(200);
  const other = (await created.json()) as Bootstrap;
  const otherChannel = other.channels.find((item) => item.name === "genel")!;
  const otherFile = await upload(page.request, "ikinci-alanın-dosyası.txt");
  await post(page.request, otherChannel.id, "İkinci alana ait içerik.", [
    otherFile,
  ]);
  await allowLateDelivery(page);
  await open(page, home, channel);
  await expect(
    files(page).getByRole("button", { name: / dosyasını önizle$/ }),
  ).toHaveCount(2);
  const path = `/api/channels/${channel.id}/files`;
  for (const destination of ["query", "workspace"] as const) {
    let release: (() => void) | undefined;
    let settled = false;
    await page.route(`**${path}**`, async (route) => {
      if (new URL(route.request().url()).searchParams.get("q") !== "eski")
        return route.continue();
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.files.map((file: Attachment) => file.id)).toEqual([
        oldFile.id,
      ]);
      expect(route.request().headers()["x-workspace-id"]).toBe(
        home.workspace.id,
      );
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.fulfill({ response });
      settled = true;
    });
    try {
      await files(page)
        .getByRole("searchbox", { name: "Dosyalarda ara", exact: true })
        .fill("eski");
      await expect.poll(() => Boolean(release)).toBe(true);
      if (destination === "query") {
        await files(page)
          .getByRole("searchbox", { name: "Dosyalarda ara", exact: true })
          .fill("yeni");
        await expect(
          files(page).getByRole("button", {
            name: `${freshFile.name} dosyasını önizle`,
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          files(page).getByRole("button", { name: / dosyasını önizle$/ }),
        ).toHaveCount(1);
      } else {
        await page
          .getByRole("complementary", { name: "Çalışma alanları", exact: true })
          .getByRole("button", {
            name: `${other.workspace.name} alanına geç`,
            exact: true,
          })
          .click();
        await expect(
          panel(page).getByRole("textbox", {
            name: "#genel kanalına mesaj yaz",
            exact: true,
          }),
        ).toBeVisible();
        await panel(page)
          .getByRole("tab", { name: "Dosyalar", exact: true })
          .click();
        await expect(
          files(page).getByRole("button", {
            name: `${otherFile.name} dosyasını önizle`,
            exact: true,
          }),
        ).toBeVisible();
      }
      release!();
      release = undefined;
      await expect.poll(() => settled).toBe(true);
      await frames(page);
      await expect(
        files(page).getByRole("button", { name: / dosyasını önizle$/ }),
      ).toHaveCount(1);
      await expect(
        files(page).getByRole("button", {
          name: `${oldFile.name} dosyasını önizle`,
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(panel(page).getByRole("alert")).toHaveCount(0);
      const expected = destination === "query" ? freshFile : otherFile;
      await expect(
        files(page).getByRole("button", {
          name: `${expected.name} dosyasını önizle`,
          exact: true,
        }),
      ).toBeVisible();
      if (destination === "workspace") {
        expect(new URL(page.url()).searchParams.get("workspace")).toBe(
          other.workspace.id,
        );
        await expect(
          files(page).getByRole("button", {
            name: `${freshFile.name} dosyasını önizle`,
            exact: true,
          }),
        ).toHaveCount(0);
      }
    } finally {
      release?.();
      await page.unroute(`**${path}**`);
    }
  }
});

async function imageFile(request: APIRequestContext, name: string) {
  const buffer = await sharp({
    create: { width: 960, height: 640, channels: 3, background: "#b9d9d0" },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="960" height="640"><rect x="100" y="100" width="760" height="440" rx="32" fill="#21483f"/><circle cx="480" cy="320" r="100" fill="#e9c57e"/></svg>',
        ),
      },
    ])
    .png()
    .toBuffer();
  return upload(request, name, buffer, "image/png");
}

function pdfFile() {
  const stream = "BT /F1 24 Tf 72 700 Td (ASOC - File preview) Tj ET\n";
  const secondStream = "BT /F1 24 Tf 72 700 Td (ASOC - Second page) Tj ET\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>",
    `<< /Length ${Buffer.byteLength(secondStream)} >>\nstream\n${secondStream}endstream`,
  ];
  let text = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(text));
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(text);
  text += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  text += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  text += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text);
}

test.describe("compact file preview", () => {
  test.use({
    viewport: { width: 320, height: 720 },
    hasTouch: true,
    isMobile: true,
  });

  test("image and PDF previews remain accessible at 320px and keyboard dismissal restores the opener", async ({
    page,
  }) => {
    const data = await register(page.request);
    const channel = data.channels.find((item) => item.name === "genel")!;
    const image = await imageFile(
      page.request,
      "tasarım-kararlarının-güncel-görseli.png",
    );
    const pdf = await upload(
      page.request,
      "toplantı-kararları.pdf",
      pdfFile(),
      "application/pdf",
    );
    const message = await post(
      page.request,
      channel.id,
      "Görsel ve belge birlikte incelenebilir.",
      [image, pdf],
    );
    await open(page, data, channel);
    const preview = page.getByRole("dialog", {
      name: "Dosya önizlemesi",
      exact: true,
    });
    for (const file of [image, pdf]) {
      const trigger = files(page).getByRole("button", {
        name: `${file.name} dosyasını önizle`,
        exact: true,
      });
      await trigger.focus();
      await trigger.press("Enter");
      await expect(preview).toBeVisible();
      await expect(preview).toContainText(file.name);
      await expect(
        preview.getByRole("link", { name: "Dosyayı indir", exact: true }),
      ).toHaveAttribute("href", file.url);
      if (file.id === image.id) {
        const picture = preview.getByRole("img", {
          name: file.name,
          exact: true,
        });
        await expect(picture).toBeVisible();
        await expect
          .poll(() =>
            picture.evaluate(
              (element) => (element as HTMLImageElement).naturalWidth,
            ),
          )
          .toBe(960);
        const box = await picture.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(320);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
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
          path: "artifacts/fourth-package-preview-mobile.png",
          animations: "disabled",
        });
      } else {
        const document = preview.getByRole("region", {
          name: `${file.name} PDF önizlemesi`,
          exact: true,
        });
        const previous = document.getByRole("button", {
          name: "Önceki PDF sayfası",
          exact: true,
        });
        const next = document.getByRole("button", {
          name: "Sonraki PDF sayfası",
          exact: true,
        });
        async function renderedPage(number: number, expectedText: string) {
          const canvas = document.getByRole("img", {
            name: `${file.name}, ${number}. sayfa`,
            exact: true,
          });
          await expect(canvas).toHaveAttribute("data-pdf-rendered", "true");
          await expect(canvas).toBeVisible();
          // A completed but blank canvas does not prove that PDF contents rendered.
          const darkPixels = await canvas.evaluate((element) => {
            const canvas = element as HTMLCanvasElement;
            const context = canvas.getContext("2d")!;
            const pixels = context.getImageData(
              0,
              0,
              canvas.width,
              canvas.height,
            ).data;
            let dark = 0;
            for (let index = 0; index < pixels.length; index += 4)
              if (
                pixels[index + 3] > 0 &&
                pixels[index] < 120 &&
                pixels[index + 1] < 120 &&
                pixels[index + 2] < 120
              )
                dark++;
            return dark;
          });
          expect(darkPixels).toBeGreaterThan(20);
          await expect(document.getByRole("status")).toHaveText(
            `${number} / 2`,
          );
          const summary = document.getByText("Sayfa metnini göster", {
            exact: true,
          });
          await summary.click();
          const text = document.getByRole("region", {
            name: "PDF sayfa metni",
            exact: true,
          });
          await expect(text).toBeVisible();
          await expect(text).toHaveText(expectedText);
          await expect(text).toHaveCSS("user-select", "text");
          expect(
            await text.evaluate((element) => {
              const range = window.document.createRange();
              range.selectNodeContents(element);
              const selection = window.getSelection()!;
              selection.removeAllRanges();
              selection.addRange(range);
              const selected = selection.toString();
              selection.removeAllRanges();
              return selected;
            }),
          ).toBe(expectedText);
          await summary.click();
          await expect(text).not.toBeVisible();
          const bounds = await canvas.boundingBox();
          expect(bounds!.x).toBeGreaterThanOrEqual(0);
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
        }
        await renderedPage(1, "ASOC - File preview");
        await expect(previous).toBeDisabled();
        await expect(next).toBeEnabled();
        await next.click();
        await renderedPage(2, "ASOC - Second page");
        await expect(previous).toBeEnabled();
        await expect(next).toBeDisabled();
        await previous.click();
        await renderedPage(1, "ASOC - File preview");
        await expect(previous).toBeDisabled();
        expect(
          await page.evaluate(
            () => window.document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        const pdfAudit = await new AxeBuilder({ page }).analyze();
        expect(
          pdfAudit.violations
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
        const downloaded = await page.request.get(file.url);
        expect(downloaded.status()).toBe(200);
        expect(downloaded.headers()["content-type"]).toContain(
          "application/pdf",
        );
        expect((await downloaded.body()).subarray(0, 5).toString()).toBe(
          "%PDF-",
        );
        await page.screenshot({
          path: "artifacts/fourth-package-preview-pdf.png",
          animations: "disabled",
        });
      }
      const close = preview.getByRole("button", { name: "Kapat", exact: true });
      await close.focus();
      for (const key of ["Shift+Tab", "Tab", "Tab", "Tab"]) {
        await page.keyboard.press(key);
        // Base UI's focus guard completes boundary wrapping asynchronously.
        // Wait for that cycle while still requiring focus inside the popup.
        await expect
          .poll(() =>
            preview.evaluate((element) =>
              element.contains(document.activeElement),
            ),
          )
          .toBe(true);
      }
      await close.focus();
      await page.keyboard.press("Escape");
      await expect(preview).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
    await files(page)
      .getByRole("button", {
        name: `${image.name} dosyasını önizle`,
        exact: true,
      })
      .click();
    await preview
      .getByRole("button", { name: "Mesaja git", exact: true })
      .click();
    await expect(preview).toHaveCount(0);
    await expect(
      panel(page).locator(`[data-message-id="${message.id}"] .message-text`),
    ).toHaveText(message.content);
  });
});

test("revoking a private channel closes its open file preview and releases the old image", async ({
  page,
  playwright,
}) => {
  const ownerApi = await playwright.request.newContext({ baseURL: origin });
  try {
    const owner = await register(ownerApi, "Özel Dosya Sahibi");
    const invitation = await ownerApi.post("/api/invites", { headers });
    expect(invitation.status()).toBe(201);
    const token = new URL((await invitation.json()).url).searchParams.get(
      "invite",
    )!;
    const member = await register(page.request, "Özel Dosya Üyesi", token);
    const created = await ownerApi.post("/api/channels", {
      headers,
      data: {
        name: "özel-önizleme",
        kind: "text",
        visibility: "private",
        memberIds: [member.user.id],
      },
    });
    expect(created.status()).toBe(201);
    const channel = (await created.json()) as Channel;
    const image = await imageFile(ownerApi, "özel-alanın-görseli.png");
    await post(
      ownerApi,
      channel.id,
      "Erişim bitince açık görsel de kapanmalı.",
      [image],
    );
    await page.addInitScript(() => {
      const scope = window as Window & { revokedPreviewUrls?: string[] };
      scope.revokedPreviewUrls = [];
      const original = URL.revokeObjectURL.bind(URL);
      URL.revokeObjectURL = (url) => {
        scope.revokedPreviewUrls!.push(url);
        original(url);
      };
    });
    await open(page, member, channel);
    await files(page)
      .getByRole("button", {
        name: `${image.name} dosyasını önizle`,
        exact: true,
      })
      .click();
    const preview = page.getByRole("dialog", {
      name: "Dosya önizlemesi",
      exact: true,
    });
    const picture = preview.getByRole("img", { name: image.name, exact: true });
    await expect(picture).toBeVisible();
    await expect
      .poll(() =>
        picture.evaluate(
          (element) => (element as HTMLImageElement).naturalWidth,
        ),
      )
      .toBe(960);
    const blobUrl = await picture.getAttribute("src");
    expect(blobUrl).toMatch(/^blob:/);
    const revoked = await ownerApi.patch(`/api/channels/${channel.id}/access`, {
      headers,
      data: { visibility: "private", memberIds: [owner.user.id] },
    });
    expect(revoked.status()).toBe(200);
    await expect(preview).toHaveCount(0);
    await expect(
      page.getByRole("img", { name: image.name, exact: true }),
    ).toHaveCount(0);
    await expect(
      page
        .locator("#workspace-navigation")
        .getByRole("button", { name: channel.name, exact: true }),
    ).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(
          (url) =>
            (
              window as Window & { revokedPreviewUrls?: string[] }
            ).revokedPreviewUrls?.includes(url!),
          blobUrl,
        ),
      )
      .toBe(true);
    expect((await page.request.get(image.url)).status()).toBe(404);
    await expect(page.getByText(image.name, { exact: true })).toHaveCount(0);
  } finally {
    await ownerApi.dispose();
  }
});

test("changing a file filter cancels an earlier source-message navigation even when its response is delivered", async ({
  page,
}) => {
  const data = await register(page.request);
  const channel = data.channels.find((item) => item.name === "genel")!;
  const oldFile = await upload(page.request, "önceki-kaynağın-dosyası.txt");
  const freshFile = await upload(page.request, "yeni-filtrenin-dosyası.txt");
  const oldMessage = await post(
    page.request,
    channel.id,
    "Artık açılmaması gereken eski kaynak.",
    [oldFile],
  );
  await post(
    page.request,
    channel.id,
    "Seçili filtrede kalacak güncel kaynak.",
    [freshFile],
  );
  const path = `/api/messages/${oldMessage.id}`;
  await page.addInitScript((sourcePath) => {
    const original = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      return new URL(url, location.href).pathname === sourcePath
        ? original(input, { ...options, signal: undefined })
        : original(input, options);
    };
  }, path);
  await open(page, data, channel);
  await expect(
    files(page).getByRole("button", { name: / dosyasını önizle$/ }),
  ).toHaveCount(2);
  let release: (() => void) | undefined;
  let settled = false;
  await page.route(`**${path}`, async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    expect((await response.json()).id).toBe(oldMessage.id);
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.fulfill({ response });
    settled = true;
  });
  try {
    await files(page)
      .getByRole("button", {
        name: `${oldFile.name} dosyasının mesajına git`,
        exact: true,
      })
      .click();
    await expect.poll(() => Boolean(release)).toBe(true);
    await files(page)
      .getByRole("searchbox", { name: "Dosyalarda ara", exact: true })
      .fill("yeni-filtrenin");
    await expect(
      files(page).getByRole("button", { name: / dosyasını önizle$/ }),
    ).toHaveCount(1);
    await expect(
      files(page).getByRole("button", {
        name: `${freshFile.name} dosyasını önizle`,
        exact: true,
      }),
    ).toBeVisible();
    const selectedUrl = page.url();
    release!();
    release = undefined;
    await expect.poll(() => settled).toBe(true);
    await frames(page);
    expect(page.url()).toBe(selectedUrl);
    await expect(
      panel(page).getByRole("tab", { name: "Dosyalar", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      files(page).getByRole("searchbox", {
        name: "Dosyalarda ara",
        exact: true,
      }),
    ).toHaveValue("yeni-filtrenin");
    await expect(
      files(page).getByRole("button", { name: / dosyasını önizle$/ }),
    ).toHaveCount(1);
    await expect(
      files(page).getByRole("button", {
        name: `${freshFile.name} dosyasını önizle`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.locator(`article[data-message-id="${oldMessage.id}"]`),
    ).toHaveCount(0);
    await expect(panel(page).getByRole("alert")).toHaveCount(0);
  } finally {
    release?.();
  }
});

test("a preview whose source was deleted clears the displayed blob when opening its message returns 404", async ({
  page,
}) => {
  let deletedId: string | undefined;
  let droppedDeletes = 0;
  await page.routeWebSocket(/\/socket\.io\//, (socket) => {
    const server = socket.connectToServer();
    server.onMessage((frame) => {
      if (typeof frame === "string" && frame.startsWith("42[")) {
        const [event, payload] = JSON.parse(frame.slice(2)) as [
          string,
          { id?: string },
        ];
        if (event === "message:deleted" && payload.id === deletedId) {
          droppedDeletes += 1;
          return;
        }
      }
      socket.send(frame);
    });
  });
  const data = await register(page.request);
  const channel = data.channels.find((item) => item.name === "genel")!;
  const image = await imageFile(page.request, "silinen-kaynağın-görseli.png");
  const message = await post(
    page.request,
    channel.id,
    "Önizleme açıkken kaynağı silinen mesaj.",
    [image],
  );
  deletedId = message.id;
  await page.addInitScript(() => {
    const scope = window as Window & { revokedSourceUrls?: string[] };
    scope.revokedSourceUrls = [];
    const original = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url) => {
      scope.revokedSourceUrls!.push(url);
      original(url);
    };
  });
  await open(page, data, channel);
  await files(page)
    .getByRole("button", {
      name: `${image.name} dosyasını önizle`,
      exact: true,
    })
    .click();
  const preview = page.getByRole("dialog", {
    name: "Dosya önizlemesi",
    exact: true,
  });
  const picture = preview.getByRole("img", { name: image.name, exact: true });
  await expect
    .poll(() =>
      picture.evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBe(960);
  const blob = await picture.getAttribute("src");
  expect(blob).toMatch(/^blob:/);
  expect(
    (
      await page.request.delete(`/api/messages/${message.id}`, { headers })
    ).status(),
  ).toBe(204);
  await expect.poll(() => droppedDeletes).toBe(1);
  // The missed realtime event leaves the old preview open; the source action
  // must revalidate on the server and stop displaying its already fetched image.
  await expect(picture).toBeVisible();
  const missingSource = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/messages/${message.id}` &&
      response.request().method() === "GET",
  );
  await preview
    .getByRole("button", { name: "Mesaja git", exact: true })
    .click();
  expect((await missingSource).status()).toBe(404);
  await expect(
    page.getByRole("img", { name: image.name, exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await preview.count()) === 0 ||
        (await preview.getByRole("alert").isVisible()),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        (url) =>
          (
            window as Window & { revokedSourceUrls?: string[] }
          ).revokedSourceUrls?.includes(url!),
        blob,
      ),
    )
    .toBe(true);
  expect((await page.request.get(image.url)).status()).toBe(404);
});
