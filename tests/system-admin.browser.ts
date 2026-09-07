import {
  test,
  expect,
  request,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import type { Bootstrap } from "../shared/types";

const origin = "http://127.0.0.1:5178";
const password = "Mola-admin-browser-test-2026";
const suffix = randomUUID();
const contexts: APIRequestContext[] = [];
let administrator: Bootstrap;
let otherWorkspace: Bootstrap;
let member: Bootstrap;
let memberClient: APIRequestContext;

async function client() {
  const context = await request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  contexts.push(context);
  return context;
}
async function register(
  context: APIRequestContext,
  name: string,
  email: string,
  workspaceName?: string,
  inviteToken?: string,
) {
  const response = await context.post("/api/auth/register", {
    data: {
      name,
      email,
      password,
      ...(inviteToken ? { inviteToken } : { workspaceName }),
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<Bootstrap>;
}
async function loginAndOpen(page: Page) {
  await page.addInitScript(() =>
    sessionStorage.setItem("mola:logged-out", "true"),
  );
  await page.goto("/");
  await page
    .getByLabel("E-posta adresin", { exact: true })
    .fill(administrator.user.email);
  await page.getByLabel("Parola", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Giriş yap", exact: true })
    .last()
    .click();
  if ((page.viewportSize()?.width ?? 1440) < 700) {
    await page
      .getByRole("button", { name: "Profil ayarları", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Yönetim panelini aç", exact: true })
      .click();
  } else {
    await page
      .getByRole("button", { name: "Yönetim paneli", exact: true })
      .click();
  }
  await page
    .getByRole("button", { name: "Genel yönetim", exact: true })
    .click();
  await expect(page.locator(".system-admin-table")).toBeVisible();
}
async function search(page: Page, value: string) {
  const panel = page.locator(".system-admin");
  await panel.getByRole("searchbox").fill(value);
  await expect(
    panel.getByRole("button", { name: "Sistem bilgilerini yenile" }),
  ).toBeEnabled();
}
async function checkAxe(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const violations = results.violations.filter(
    (item) => item.impact === "critical" || item.impact === "serious",
  );
  expect(
    violations.map((item) => ({
      id: item.id,
      nodes: item.nodes.map((node) => ({
        target: node.target,
        summary: node.failureSummary,
      })),
    })),
  ).toEqual([]);
}
async function changeStatus(page: Page, name: string, suspend: boolean) {
  await page
    .locator(".system-admin")
    .getByRole("button", {
      name: `${name}: ${suspend ? "askıya al" : "etkinleştir"}`,
      exact: true,
    })
    .click();
  const confirmation = page.getByRole("dialog", {
    name: suspend ? "Askıya almayı onaylayın" : "Yeniden etkinleştirin",
    exact: true,
  });
  await expect(confirmation).toContainText(name);
  await confirmation
    .getByRole("button", {
      name: suspend ? "Askıya al" : "Etkinleştir",
      exact: true,
    })
    .click();
  await expect(confirmation).not.toBeVisible();
  await expect(
    page.locator(".system-admin").getByRole("button", {
      name: `${name}: ${suspend ? "etkinleştir" : "askıya al"}`,
      exact: true,
    }),
  ).toBeVisible();
}

test.beforeAll(async () => {
  const owner = await client();
  administrator = await register(
    owner,
    "Deniz Yönetici",
    `admin-${suffix}@example.invalid`,
    `Mola Merkez ${suffix.slice(0, 6)}`,
  );
  const other = await client();
  otherWorkspace = await register(
    other,
    "Selin Arslan",
    `owner-${suffix}@example.invalid`,
    `Kıyı Tasarım Ekibi ${suffix.slice(0, 6)}`,
  );
  const invitation = await other.post("/api/invites");
  expect(invitation.status()).toBe(201);
  const token = new URL((await invitation.json()).url).searchParams.get(
    "invite",
  )!;
  memberClient = await client();
  member = await register(
    memberClient,
    "Eren Yılmaz",
    `member-${suffix}@example.invalid`,
    undefined,
    token,
  );

  // Real registration creates enough independent workspaces to require a second page.
  // Only email verification below is fixture state; administrative authority comes from the real CLI.
  const fixtures = await client();
  for (let index = 1; index <= 26; index++) {
    await register(
      fixtures,
      `Ekip Sahibi ${index}`,
      `fixture-${index}-${suffix}@example.invalid`,
      `Atölye ${String(index).padStart(2, "0")}`,
    );
  }
  const directory = resolve(process.env.MOLA_ADMIN_E2E_DATA_DIR!);
  if (
    !directory.startsWith(resolve(tmpdir()) + sep) ||
    !basename(directory).startsWith("mola-admin-e2e-")
  )
    throw new Error(
      "Admin fixtures require their isolated temporary test directory.",
    );
  const database = new DatabaseSync(join(directory, "mola.sqlite"));
  database.exec("PRAGMA busy_timeout=5000");
  database
    .prepare("UPDATE users SET email_verified=1 WHERE id IN (?,?)")
    .run(administrator.user.id, member.user.id);
  database.close();
  execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "server/admin-cli.ts",
      "grant",
      "--email",
      administrator.user.email,
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATA_DIR: directory },
      timeout: 15_000,
      stdio: "pipe",
    },
  );
  expect((await owner.get("/api/auth/me")).status()).toBe(401);
  await mkdir("artifacts", { recursive: true });
});
test.afterAll(async () => {
  await Promise.all(contexts.map((context) => context.dispose()));
});

test("global admin searches all pages, protects privileged accounts, confirms access changes and records audit", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await loginAndOpen(page);
  const system = page.locator(".system-admin");
  await expect(system.locator(".system-admin-pagination")).toContainText(
    "1 / 2",
  );
  await system.getByRole("button", { name: "Sonraki sayfa" }).click();
  await expect(system.locator(".system-admin-pagination")).toContainText(
    "2 / 2",
  );
  await search(page, administrator.workspace.name);
  await expect(system.locator("tbody > tr")).toHaveCount(1);
  await expect(
    system.getByText(administrator.workspace.name, { exact: true }),
  ).toBeVisible();
  await search(page, "Olmayan çalışma alanı");
  await expect(
    system.getByRole("heading", { name: "Bu aramaya uygun kayıt yok" }),
  ).toBeVisible();

  await system.getByRole("tab", { name: /Kullanıcılar/ }).click();
  await search(page, administrator.user.email);
  await expect(
    system.getByRole("button", {
      name: `${administrator.user.name}: askıya al`,
      exact: true,
    }),
  ).toBeDisabled();
  await search(page, otherWorkspace.user.email);
  await expect(
    system.getByRole("button", {
      name: `${otherWorkspace.user.name}: askıya al`,
      exact: true,
    }),
  ).toBeDisabled();
  await search(page, member.user.email);
  await system
    .getByRole("button", {
      name: `${member.user.name}: askıya al`,
      exact: true,
    })
    .click();
  const confirmation = page.getByRole("dialog", {
    name: "Askıya almayı onaylayın",
    exact: true,
  });
  await checkAxe(page);
  await confirmation
    .getByRole("button", { name: "Vazgeç", exact: true })
    .click();
  expect((await memberClient.get("/api/auth/me")).status()).toBe(200);
  await changeStatus(page, member.user.name, true);
  expect((await memberClient.get("/api/auth/me")).status()).toBe(401);
  await system.getByLabel("Duruma göre filtrele").selectOption("suspended");
  await expect(system.locator(".system-admin-status")).toHaveText("Askıda");
  await system.getByLabel("Duruma göre filtrele").selectOption("all");
  await changeStatus(page, member.user.name, false);
  await expect(system.locator(".system-admin-status")).toHaveText("Etkin");

  await system.getByRole("tab", { name: /Çalışma alanları/ }).click();
  await search(page, otherWorkspace.workspace.name);
  await changeStatus(page, otherWorkspace.workspace.name, true);
  await changeStatus(page, otherWorkspace.workspace.name, false);
  await system.getByRole("tab", { name: /İşlem geçmişi/ }).click();
  await search(page, administrator.user.name);
  await expect(
    system.getByText("Çalışma alanı etkinleştirildi", { exact: true }),
  ).toBeVisible();
  await system
    .getByRole("button", { name: "Ayrıntılar", exact: true })
    .first()
    .click();
  await expect(system.locator(".system-admin-audit-details")).toContainText(
    otherWorkspace.workspace.id,
  );
  await checkAxe(page);
  await system.getByRole("tab", { name: /Çalışma alanları/ }).click();
  await expect(
    system.getByRole("button", { name: "Sistem bilgilerini yenile" }),
  ).toBeEnabled();
  await page.screenshot({ path: "artifacts/admin-system.png" });
  expect(errors).toEqual([]);
});

test("mobile global admin can suspend its own workspace and retain management access to restore it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAndOpen(page);
  const system = page.locator(".system-admin");
  await search(page, administrator.workspace.name);
  await changeStatus(page, administrator.workspace.name, true);
  expect((await page.request.get("/api/admin/system")).status()).toBe(200);
  const write = await page.request.post(
    `/api/channels/${administrator.channels.find((channel) => channel.kind === "text")!.id}/messages`,
    {
      headers: { Origin: origin },
      data: { content: "Bu mesaj askıdaki alana yazılmamalı." },
    },
  );
  expect(write.status()).toBe(403);
  await expect(
    system.getByRole("button", {
      name: `${administrator.workspace.name}: etkinleştir`,
      exact: true,
    }),
  ).toBeEnabled();
  await page.reload();
  await expect(
    page.getByRole("dialog", { name: "Yönetim paneli", exact: true }),
  ).toBeVisible();
  await search(page, administrator.workspace.name);
  await changeStatus(page, administrator.workspace.name, false);
  await checkAxe(page);
  await system.getByRole("tab", { name: /Kullanıcılar/ }).click();
  await search(page, member.user.email);
  await checkAxe(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({ path: "artifacts/admin-system-mobile.png" });
});
