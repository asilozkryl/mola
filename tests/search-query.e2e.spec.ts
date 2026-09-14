import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { Attachment, Bootstrap, Channel, Message } from "../shared/types";

const origin = "http://127.0.0.1:5174";
const headers = { Origin: origin };
const dialog = (page: Page) =>
  page.getByRole("dialog", { name: "Çalışma alanında ara", exact: true });
const query = (page: Page) =>
  dialog(page).getByRole("textbox", { name: "Mesajlarda ara", exact: true });

async function register(request: APIRequestContext, inviteToken?: string) {
  const response = await request.post(`${origin}/api/auth/register`, {
    headers,
    data: {
      name: inviteToken ? "Arama Arkadaşı" : "Arama Sahibi",
      email: `search-query-${randomUUID()}@example.invalid`,
      password: "search-query-browser-password",
      workspaceName: "Metinle Arama Ekibi",
      ...(inviteToken ? { inviteToken } : {}),
    },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as Bootstrap;
}

async function createChannel(request: APIRequestContext) {
  const response = await request.post(`${origin}/api/channels`, {
    headers,
    data: { name: "arama-diger", kind: "text", visibility: "public" },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as Channel;
}

function pdfFile() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << >> >>",
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

async function upload(request: APIRequestContext, name: string) {
  const pdf = name.endsWith(".pdf");
  const response = await request.post(`${origin}/api/uploads`, {
    headers,
    multipart: {
      file: {
        name,
        mimeType: pdf ? "application/pdf" : "text/plain",
        buffer: pdf ? pdfFile() : Buffer.from("Metin dosyası"),
      },
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as Attachment;
}

async function post(
  request: APIRequestContext,
  channelId: string,
  content: string,
  attachment?: Attachment,
) {
  const response = await request.post(
    `${origin}/api/channels/${channelId}/messages`,
    {
      headers,
      data: { content, attachmentIds: attachment ? [attachment.id] : [] },
    },
  );
  expect(response.status()).toBe(201);
  return (await response.json()) as Message;
}

async function openSearch(page: Page, data: Bootstrap) {
  const channel = data.channels.find((item) => item.name === "genel")!;
  await page.goto(`/?workspace=${data.workspace.id}&channel=${channel.id}`);
  await expect(
    page.getByRole("textbox", {
      name: "#genel kanalına mesaj yaz",
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(dialog(page)).toBeVisible();
  await expect(
    dialog(page).getByRole("button", { name: "Filtreler", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(dialog(page).getByLabel("Kanal", { exact: true })).toBeHidden();
}

test("typed channel, author, date and PDF filters isolate a highlighted message and open its real location", async ({
  page,
  browser,
}) => {
  const data = await register(page.request);
  const channel = data.channels.find((item) => item.name === "genel")!;
  const otherChannel = await createChannel(page.request);
  const invitation = await page.request.post("/api/invites", { headers });
  expect(invitation.status()).toBe(201);
  const token = new URL((await invitation.json()).url).searchParams.get(
    "invite",
  )!;
  const peer = await browser.newContext({ baseURL: origin });
  try {
    await register(peer.request, token);
    const needle = `teslim${randomUUID().slice(0, 8)}`;
    const target = await post(
      page.request,
      channel.id,
      `${needle} aranacak rapor`,
      await upload(page.request, "hedef.pdf"),
    );
    await post(page.request, channel.id, `${needle} dosyasız mesaj`);
    await post(
      page.request,
      channel.id,
      `${needle} metin eki`,
      await upload(page.request, "notlar.txt"),
    );
    await post(
      page.request,
      otherChannel.id,
      `${needle} başka kanal`,
      await upload(page.request, "diger-kanal.pdf"),
    );
    await post(
      peer.request,
      channel.id,
      `${needle} başka gönderen`,
      await upload(peer.request, "diger-gonderen.pdf"),
    );
    await openSearch(page, data);
    await query(page).fill(
      `${needle} kanal:genel kimden:ben tarih:bugün dosya:pdf`,
    );
    const rows = dialog(page).locator(".search-result");
    await expect(rows).toHaveCount(1);
    await expect(rows).toHaveAttribute("data-message-id", target.id);
    await expect(rows.locator("p mark")).toHaveText(needle);
    await query(page).fill(
      `${needle} kanal:genel kimden:"Arama Sahibi" tarih:bugün dosya:pdf`,
    );
    await expect(rows).toHaveCount(1);
    await expect(rows).toHaveAttribute("data-message-id", target.id);
    await expect(rows.locator("p mark")).toHaveText(needle);
    await rows.click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(
      page.locator(`.message[data-message-id="${target.id}"] .message-text`),
    ).toHaveText(target.content);
    expect(new URL(page.url()).searchParams.get("message")).toBe(target.id);
    expect(new URL(page.url()).searchParams.get("channel")).toBe(channel.id);
  } finally {
    await peer.close();
  }
});

test("an unknown channel filter clears previous results and never falls back to a broader request", async ({
  page,
}) => {
  const data = await register(page.request);
  const channel = data.channels.find((item) => item.name === "genel")!;
  const needle = `korunan${randomUUID().slice(0, 8)}`;
  const target = await post(
    page.request,
    channel.id,
    `${needle} görünür mesaj`,
  );
  await openSearch(page, data);
  await query(page).fill(`${needle} kanal:genel`);
  await expect(dialog(page).locator(".search-result")).toHaveAttribute(
    "data-message-id",
    target.id,
  );
  // Observe beyond the search debounce: invalid scopes must not send a request.
  const requested = page
    .waitForRequest(
      (request) => new URL(request.url()).pathname === "/api/search",
      {
        timeout: 800,
      },
    )
    .then(
      () => true,
      () => false,
    );
  await query(page).fill(`${needle} kanal:olmayan-kanal`);
  await expect(dialog(page).getByRole("alert")).toContainText(/kanal/i);
  await expect(dialog(page).locator(".search-result")).toHaveCount(0);
  expect(await requested).toBe(false);
  await query(page).fill(`${needle} kanal:genel`);
  await expect(dialog(page).locator(".search-result")).toHaveAttribute(
    "data-message-id",
    target.id,
  );
});

test.describe("compact text-first search", () => {
  test.use({
    viewport: { width: 320, height: 740 },
    hasTouch: true,
    isMobile: true,
  });

  test("keyboard suggestions dismiss before the dialog, chips remove scopes and advanced filters work at 320px", async ({
    page,
  }) => {
    const data = await register(page.request);
    const channel = data.channels.find((item) => item.name === "genel")!;
    const other = await createChannel(page.request);
    const needle = `mobil${randomUUID().slice(0, 8)}`;
    const target = await post(
      page.request,
      channel.id,
      `${needle} genel dosyası`,
      await upload(page.request, "mobil.pdf"),
    );
    await post(page.request, other.id, `${needle} diğer kanal`);
    await openSearch(page, data);
    const suggestions = dialog(page).getByRole("listbox", {
      name: "Arama önerileri",
      exact: true,
    });
    await query(page).fill(`${needle} kanal:gene`);
    await expect(
      suggestions.getByRole("option", { name: /genel/i }),
    ).toBeVisible();
    await query(page).press("Escape");
    await expect(suggestions).toBeHidden();
    await expect(dialog(page)).toBeVisible();
    await query(page).fill(`${needle} kanal:gen`);
    await expect(
      suggestions.getByRole("option", { name: /genel/i }),
    ).toBeVisible();
    await query(page).press("ArrowDown");
    await query(page).press("Enter");
    await expect(suggestions).toBeHidden();
    await expect(query(page)).toHaveValue(new RegExp(`${needle}.*kanal:genel`));
    await expect(dialog(page).locator(".search-result")).toHaveAttribute(
      "data-message-id",
      target.id,
    );
    await dialog(page)
      .getByRole("button", { name: /genel.*filtresini kaldır/i })
      .click();
    await expect(query(page)).toHaveValue(needle);
    await expect(dialog(page).locator(".search-result")).toHaveCount(2);

    const filters = dialog(page).getByRole("button", {
      name: /^Filtreler(?:\s*\d+)?$/,
    });
    await filters.click();
    await expect(filters).toHaveAttribute("aria-expanded", "true");
    await dialog(page)
      .getByLabel("Kanal", { exact: true })
      .selectOption(channel.id);
    await dialog(page)
      .getByLabel("Gönderen", { exact: true })
      .selectOption(data.user.id);
    const today = await page.evaluate(() => {
      const date = new Date();
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    });
    await dialog(page)
      .getByLabel("Başlangıç tarihi", { exact: true })
      .fill(today);
    await dialog(page).getByLabel("Bitiş tarihi", { exact: true }).fill(today);
    await dialog(page)
      .getByLabel("Yalnızca dosya içerenler", { exact: true })
      .check();
    await dialog(page)
      .getByLabel("Dosya türü", { exact: true })
      .selectOption("pdf");
    await expect(dialog(page).locator(".search-result")).toHaveAttribute(
      "data-message-id",
      target.id,
    );
    for (const label of [
      "Kanal",
      "Gönderen",
      "Başlangıç tarihi",
      "Bitiş tarihi",
      "Dosya türü",
    ]) {
      const bounds = await dialog(page)
        .getByLabel(label, { exact: true })
        .boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    }
    await filters.click();
    await expect(filters).toHaveAttribute("aria-expanded", "false");
    await expect(
      dialog(page).getByLabel("Kanal", { exact: true }),
    ).toBeHidden();
    await expect(dialog(page).locator(".search-result")).toHaveAttribute(
      "data-message-id",
      target.id,
    );
  });
});
