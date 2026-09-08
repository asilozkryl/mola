import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { Bootstrap } from "../shared/types";

const origin = "http://127.0.0.1:5174";
const headers = { Origin: origin };

async function snapshot(page: Page) {
  const response = await page.request.get("/api/auth/me");
  expect(response.status()).toBe(200);
  return (await response.json()) as Bootstrap;
}

async function ready(page: Page) {
  await expect(
    page.getByRole("textbox", { name: /kanalına mesaj yaz/ }),
  ).toBeVisible();
  await expect(
    page.getByText("Her şey güncel", { exact: true }),
  ).toBeAttached();
}

function profilePath(data: Bootstrap, userId = data.user.id) {
  return `/?workspace=${encodeURIComponent(data.workspace.id)}&profile=${encodeURIComponent(userId)}`;
}

async function twoWorkspaces(page: Page) {
  const response = await page.request.post("/api/auth/register", {
    headers,
    data: {
      name: "Profil Gezinme",
      email: `profile-navigation-${randomUUID()}@example.invalid`,
      password: "profile-navigation-browser-password",
      workspaceName: `Profil Ekibi ${randomUUID().slice(0, 8)}`,
    },
  });
  expect(response.status()).toBe(200);
  const home = (await response.json()) as Bootstrap;
  const created = await page.request.post("/api/workspaces", {
    headers,
    data: { name: `Diğer Ekip ${randomUUID().slice(0, 8)}` },
  });
  expect(created.status()).toBe(200);
  return { home, other: (await created.json()) as Bootstrap };
}

test("opening another profile keeps the return-to-chat action and browser forward consistent", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  const data = await snapshot(page);
  const originalChannel = await page.locator(".channel-heading h1").innerText();
  await page.locator(".message .profile-identity").first().click();
  const profile = page.getByRole("region", {
    name: "Üye profili",
    exact: true,
  });
  await expect(profile.getByRole("heading", { level: 1 })).toBeVisible();
  await page.locator(".topbar-avatar.profile-identity").click();
  await expect(profile.getByRole("heading", { level: 1 })).toContainText(
    data.user.name,
  );
  await profile
    .getByRole("button", { name: "Sohbete dön", exact: true })
    .click();
  await expect(profile).toHaveCount(0);
  await expect(page.locator(".channel-heading h1")).toHaveText(originalChannel);
  expect(new URL(page.url()).searchParams.has("profile")).toBe(false);
  await page.goForward();
  await expect(profile.getByRole("heading", { level: 1 })).toContainText(
    data.user.name,
  );
  expect(new URL(page.url()).searchParams.get("profile")).toBe(data.user.id);
});

test("a member profile opens a direct conversation with that member", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  const data = await snapshot(page);
  const peer = data.members.find(
    (user) => user.id !== data.user.id && !user.suspended && !user.isBot,
  )!;
  await page.goto(profilePath(data, peer.id));
  const profile = page.getByRole("region", {
    name: "Üye profili",
    exact: true,
  });
  await expect(profile.getByRole("heading", { level: 1 })).toContainText(
    peer.name,
  );
  await profile
    .getByRole("button", { name: "Mesaj gönder", exact: true })
    .click();
  await expect(profile).toHaveCount(0);
  await expect(page.locator(".channel-heading h1")).toHaveText(peer.name);
  expect(new URL(page.url()).searchParams.has("profile")).toBe(false);
  const latest = await snapshot(page);
  const direct = latest.channels.find(
    (channel) =>
      channel.kind === "dm" &&
      channel.memberIds?.includes(peer.id) &&
      channel.memberIds?.includes(data.user.id),
  );
  expect(direct).toBeTruthy();
  await expect(page.locator(".dm-nav.selected")).toContainText(peer.name);
});

test("a profile link selects its workspace and a manual workspace switch clears the profile route", async ({
  page,
}) => {
  const { home, other } = await twoWorkspaces(page);
  expect((await snapshot(page)).workspace.id).toBe(other.workspace.id);
  await page.goto(profilePath(home));
  const profile = page.getByRole("region", {
    name: "Üye profili",
    exact: true,
  });
  await expect(profile.getByRole("heading", { level: 1 })).toContainText(
    home.user.name,
  );
  expect((await snapshot(page)).workspace.id).toBe(home.workspace.id);
  await expect(
    page.getByRole("button", {
      name: "Çalışma alanlarını değiştir",
      exact: true,
    }),
  ).toContainText(home.workspace.name);
  const rail = page.getByRole("complementary", {
    name: "Çalışma alanları",
    exact: true,
  });
  await rail
    .getByRole("button", {
      name: `${other.workspace.name} alanına geç`,
      exact: true,
    })
    .click();
  await ready(page);
  await expect(profile).toHaveCount(0);
  expect((await snapshot(page)).workspace.id).toBe(other.workspace.id);
  expect(new URL(page.url()).searchParams.has("profile")).toBe(false);
  await page.reload();
  await ready(page);
  expect((await snapshot(page)).workspace.id).toBe(other.workspace.id);
});

test("an external session workspace switch closes the old profile without switching back", async ({
  page,
}) => {
  const { home, other } = await twoWorkspaces(page);
  await page.goto(profilePath(home));
  const profile = page.getByRole("region", {
    name: "Üye profili",
    exact: true,
  });
  await expect(profile.getByRole("heading", { level: 1 })).toContainText(
    home.user.name,
  );
  await expect(
    page.getByText("Her şey güncel", { exact: true }),
  ).toBeAttached();
  const switched = await page.request.post(
    `/api/workspaces/${other.workspace.id}/switch`,
    { headers },
  );
  expect(switched.status()).toBe(200);
  await ready(page);
  await expect(profile).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Çalışma alanlarını değiştir",
      exact: true,
    }),
  ).toContainText(other.workspace.name);
  expect(new URL(page.url()).searchParams.has("profile")).toBe(false);
  expect((await snapshot(page)).workspace.id).toBe(other.workspace.id);
});
