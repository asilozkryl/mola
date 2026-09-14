import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import type { Bootstrap, Channel, Message } from "../shared/types";

const origin = "http://127.0.0.1:5174",
  password = "collaboration-test-password-2026";

test("a permalink exposes its exact older reply even beyond the latest thread page", async ({
  page,
}) => {
  const { data } = await account(page),
    channel = data.channels.find((c) => c.name === "genel")!;
  const root = (await (
    await page.request.post(`/api/channels/${channel.id}/messages`, {
      headers: { Origin: origin },
      data: { content: "Uzun konuşmanın başlangıcı" },
    })
  ).json()) as Message;
  let first: Message | undefined;
  for (let index = 0; index < 55; index++) {
    const response = await page.request.post(
      `/api/channels/${channel.id}/messages`,
      {
        headers: { Origin: origin },
        data: { parentId: root.id, content: `Sıralı yanıt ${index}` },
      },
    );
    expect(response.status()).toBe(201);
    if (index === 0) first = (await response.json()) as Message;
  }
  await page.goto(`/?workspace=${data.workspace.id}&message=${first!.id}`);
  const linked = page.getByRole("region", {
    name: "Bağlantıdaki yanıt",
    exact: true,
  });
  await expect(linked.locator(".message-text")).toHaveText("Sıralı yanıt 0");
  await expect(
    page
      .locator(".thread-messages .message-text")
      .filter({ hasText: /^Sıralı yanıt 54$/ }),
  ).toBeVisible();
});
const composer = (page: Page) =>
  page.getByRole("textbox", { name: "#genel kanalına mesaj yaz", exact: true });
async function account(page: Page) {
  const email = `collab-${randomUUID()}@example.invalid`;
  const response = await page.request.post("/api/auth/register", {
    headers: { Origin: origin },
    data: {
      name: "Deniz Taslak",
      email,
      password,
      workspaceName: "Bildirim Ekibi",
    },
  });
  expect(response.status()).toBe(200);
  const data = (await response.json()) as Bootstrap;
  await page.goto("/");
  await expect(composer(page)).toBeVisible();
  return { email, data };
}
async function audit(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      })),
  ).toEqual([]);
}

test("drafts follow the account across devices and conflicting edits require a deliberate choice", async ({
  page,
  browser,
}) => {
  const { email, data } = await account(page);
  const channel = data.channels.find((c) => c.name === "genel")!;
  await composer(page).fill("İlk cihazdan ortak taslak");
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/api/channels/${channel.id}/draft`)
          ).json()
        ).content,
    )
    .toBe("İlk cihazdan ortak taslak");
  const other = await browser.newContext();
  try {
    const login = await other.request.post(origin + "/api/auth/login", {
      headers: { Origin: origin },
      data: { email, password },
    });
    expect(login.status()).toBe(200);
    const second = await other.newPage();
    await second.goto(origin);
    await expect(composer(second)).toHaveValue("İlk cihazdan ortak taslak");
    await composer(second).fill("İkinci cihazdan güncel taslak");
    await expect(composer(page)).toHaveValue("İkinci cihazdan güncel taslak");
    await page.route(`**/api/channels/${channel.id}/draft**`, (route) =>
      route.request().method() === "PUT" ? route.abort() : route.continue(),
    );
    await composer(page).fill("Yerelde korunacak çalışma");
    await expect(
      page.getByText("Taslak bu cihazda", { exact: false }),
    ).toBeVisible();
    await composer(second).fill("Sunucudaki farklı çalışma");
    await expect(
      page.getByText("Bu taslak başka bir cihazda değişti.", { exact: false }),
    ).toBeVisible();
    await expect(composer(page)).toHaveValue("Yerelde korunacak çalışma");
    await page.unroute(`**/api/channels/${channel.id}/draft**`);
    await page
      .getByRole("button", { name: "Buradaki taslağı kullan", exact: true })
      .click();
    await expect(composer(second)).toHaveValue("Yerelde korunacak çalışma");
    await page
      .getByRole("button", { name: "Mesaj gönder", exact: true })
      .click();
    await expect(
      page
        .locator(".message-text")
        .filter({ hasText: "Yerelde korunacak çalışma" }),
    ).toBeVisible();
    await expect(composer(page)).toHaveValue("");
    await expect(composer(second)).toHaveValue("");
    await second.reload();
    await expect(composer(second)).toHaveValue("");
  } finally {
    await other.close();
  }
});

test("mentions persist through reload, open their message and synchronize read state", async ({
  page,
  browser,
}) => {
  const { data } = await account(page);
  const channel = data.channels.find((c) => c.name === "genel")!;
  const invite = await (
    await page.request.post("/api/invites", { headers: { Origin: origin } })
  ).json();
  const other = await browser.newContext();
  try {
    const registration = await other.request.post(
      origin + "/api/auth/register",
      {
        headers: { Origin: origin },
        data: {
          name: "Ece Bildirim",
          email: `notify-${randomUUID()}@example.invalid`,
          password,
          inviteToken: new URL(invite.url).searchParams.get("invite"),
        },
      },
    );
    expect(registration.status()).toBe(200);
    await page.getByRole("button", { name: "Aktivite", exact: true }).click();
    const content = "@DenizTaslak teslim planına bakabilir misin?";
    expect(
      (
        await other.request.post(
          origin + `/api/channels/${channel.id}/messages`,
          { headers: { Origin: origin }, data: { content } },
        )
      ).status(),
    ).toBe(201);
    await expect(
      page.locator(".activity-open").filter({ hasText: content }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Aktivite akışı", exact: true })
        .getByRole("button", { name: "Okunmamış", exact: true }),
    ).toContainText("1");
    await page.reload();
    await expect(
      page.getByRole("heading", { level: 1, name: "Aktivite", exact: true }),
    ).toBeVisible();
    const activity = page.getByRole("region", {
      name: "Aktivite akışı",
      exact: true,
    });
    await expect(activity).toBeVisible();
    expect(new URL(page.url()).searchParams.get("workspace")).toBe(
      data.workspace.id,
    );
    expect(new URL(page.url()).searchParams.get("view")).toBe("inbox");
    await expect(
      activity.getByRole("button", { name: "Okunmamış", exact: true }),
    ).toContainText("1");
    await expect(
      page.locator(".activity-open").filter({ hasText: content }),
    ).toBeVisible();
    await audit(page);
    await page.screenshot({
      path: "artifacts/notifications-desktop.png",
      animations: "disabled",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await audit(page);
    await page.screenshot({
      path: "artifacts/notifications-mobile.png",
      animations: "disabled",
    });
    await page.locator(".activity-open").filter({ hasText: content }).click();
    await expect(
      page.locator(".message-text").filter({ hasText: content }),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (await (await page.request.get("/api/notifications")).json())
            .unreadNotifications,
      )
      .toBe(0);
  } finally {
    await other.close();
  }
});

test("advanced search filters attachments, author, channel and date; message links open in the right workspace", async ({
  page,
}) => {
  const { data } = await account(page),
    channel = data.channels.find((c) => c.name === "genel")!;
  const special = (await (
    await page.request.post("/api/channels", {
      headers: { Origin: origin },
      data: { name: "arama-kanıtı", kind: "text", visibility: "private" },
    })
  ).json()) as Channel;
  const upload = await (
    await page.request.post("/api/uploads", {
      headers: { Origin: origin },
      multipart: {
        file: {
          name: "arama.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("filtre kanıtı"),
        },
      },
    })
  ).json();
  const target = (await (
    await page.request.post(`/api/channels/${special.id}/messages`, {
      headers: { Origin: origin },
      data: { content: "Özel arama kanıtı", attachmentIds: [upload.id] },
    })
  ).json()) as Message;
  await page.request.post(`/api/channels/${channel.id}/messages`, {
    headers: { Origin: origin },
    data: { content: "Genel arama kanıtı" },
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Tüm mesajlarda ara", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Çalışma alanında ara",
    exact: true,
  });
  await dialog
    .getByRole("textbox", { name: "Mesajlarda ara", exact: true })
    .fill("kanıtı");
  await expect(dialog.locator(".search-result")).toHaveCount(2);
  await dialog.getByRole("button", { name: "Filtreler", exact: true }).click();
  await dialog.getByLabel("Kanal", { exact: true }).selectOption(special.id);
  await expect(dialog.locator(".search-result")).toHaveCount(1);
  await dialog
    .getByLabel("Gönderen", { exact: true })
    .selectOption(data.user.id);
  await dialog.getByLabel("Yalnızca dosya içerenler", { exact: true }).check();
  const today = await page.evaluate(() => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  });
  await dialog.getByLabel("Başlangıç tarihi", { exact: true }).fill(today);
  await dialog.getByLabel("Bitiş tarihi", { exact: true }).fill(today);
  await expect(dialog.locator(".search-result")).toHaveCount(1);
  await audit(page);
  await dialog.locator(".search-result").click();
  await expect(
    page.locator(".message-text").filter({ hasText: target.content }),
  ).toBeVisible();
  const second = (await (
    await page.request.post("/api/workspaces", {
      headers: { Origin: origin },
      data: { name: "Bağlantı İkinci Alan" },
    })
  ).json()) as Bootstrap;
  expect(second.workspace.id).not.toBe(data.workspace.id);
  await page.goto(`/?workspace=${data.workspace.id}&message=${target.id}`);
  await expect(
    page.locator(".message-text").filter({ hasText: target.content }),
  ).toBeVisible();
  expect(
    (await (await page.request.get("/api/auth/me")).json()).workspace.id,
  ).toBe(data.workspace.id);
});
