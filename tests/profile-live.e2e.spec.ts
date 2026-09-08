import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { Bootstrap, User } from "../shared/types";

const origin = "http://127.0.0.1:5174";
const headers = { Origin: origin };

async function register(page: Page, name: string, inviteToken?: string) {
  const response = await page.request.post("/api/auth/register", {
    headers,
    data: {
      name,
      email: `profile-live-${randomUUID()}@example.invalid`,
      password: "profile-live-browser-password",
      workspaceName: `Canlı Profil Ekibi ${randomUUID().slice(0, 8)}`,
      ...(inviteToken ? { inviteToken } : {}),
    },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as Bootstrap;
}

async function uploadPhoto(page: Page, user: Bootstrap) {
  const buffer = await sharp({
    create: { width: 96, height: 96, channels: 3, background: "#237459" },
  })
    .png()
    .toBuffer();
  const response = await page.request.post("/api/profile/avatar", {
    headers: {
      ...headers,
      "X-Workspace-Id": user.workspace.id,
      "X-User-Id": user.user.id,
    },
    multipart: {
      file: { name: "canli-profil.png", mimeType: "image/png", buffer },
    },
  });
  expect(response.status()).toBe(200);
  const updated = (await response.json()) as User;
  expect(updated.avatarUrl).toBeTruthy();
  return updated.avatarUrl!;
}

function profilePath(workspaceId: string, userId: string) {
  return `/?workspace=${encodeURIComponent(workspaceId)}&profile=${encodeURIComponent(userId)}`;
}

test("profile text and photo changes from another tab update the open profile without a reload", async ({
  page,
}) => {
  const data = await register(page, "İlk Profil Adı");
  let release!: () => void;
  let captured!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const responseReady = new Promise<void>((resolve) => {
    captured = resolve;
  });
  let delayed = false;
  await page.route(`**/api/members/${data.user.id}/profile`, async (route) => {
    if (delayed) return route.continue();
    delayed = true;
    const response = await route.fetch();
    captured();
    await gate;
    await route.fulfill({ response }).catch(() => {});
  });
  await page.goto(profilePath(data.workspace.id, data.user.id));
  await responseReady;
  const profile = page.getByRole("region", {
    name: "Üye profili",
    exact: true,
  });
  await expect(
    profile.getByText("Profil yükleniyor", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Her şey güncel", { exact: true }),
  ).toBeAttached();
  const sibling = await page.context().newPage();
  try {
    await sibling.goto("/");
    await expect(
      sibling.getByRole("textbox", { name: /kanalına mesaj yaz/ }),
    ).toBeVisible();
    const changed = await sibling.request.patch("/api/profile", {
      headers: {
        ...headers,
        "X-Workspace-Id": data.workspace.id,
        "X-User-Id": data.user.id,
      },
      data: {
        name: "Deniz Canlı",
        jobTitle: "Ürün tasarımcısı",
        bio: "Ekip için okunabilir arayüzler tasarlıyorum.",
        location: "İstanbul",
        status: "Yeni arayüze odaklandım",
      },
    });
    expect(changed.status()).toBe(200);
    await expect(
      page.locator(".topbar-avatar.profile-identity"),
    ).toHaveAttribute("aria-label", "Deniz Canlı profilini görüntüle");
    release();
    await expect(profile.getByRole("heading", { level: 1 })).toContainText(
      "Deniz Canlı",
    );
    await expect(profile.locator(".member-profile-about")).toContainText(
      "Ekip için okunabilir arayüzler tasarlıyorum.",
    );
    await expect(profile.locator(".member-profile-information")).toContainText(
      "İstanbul",
    );
    await expect(profile.locator(".member-profile-status")).toHaveText(
      "Yeni arayüze odaklandım",
    );
    const avatarUrl = await uploadPhoto(sibling, data);
    const image = profile.locator(".member-profile-avatar img");
    await expect(image).toHaveAttribute("src", avatarUrl);
    await expect
      .poll(() =>
        image.evaluate(
          (element) =>
            (element as HTMLImageElement).complete &&
            (element as HTMLImageElement).naturalWidth > 0,
        ),
      )
      .toBe(true);
    await expect(page.locator(".topbar-avatar img")).toHaveAttribute(
      "src",
      avatarUrl,
    );
    const removed = await sibling.request.delete("/api/profile/avatar", {
      headers,
    });
    expect(removed.status()).toBe(200);
    await expect(image).toHaveCount(0);
    await expect(page.locator(".topbar-avatar img")).toHaveCount(0);
    await expect(profile.getByRole("heading", { level: 1 })).toContainText(
      "Deniz Canlı",
    );
    expect(new URL(page.url()).searchParams.get("profile")).toBe(data.user.id);
  } finally {
    release();
    await sibling.close();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("removing a member clears their already-open profile details and photo", async ({
  page,
  browser,
}) => {
  const owner = await register(page, "Profil Sahibi");
  const invitation = await page.request.post("/api/invites", { headers });
  expect(invitation.status()).toBe(201);
  const token = new URL((await invitation.json()).url).searchParams.get(
    "invite",
  )!;
  const memberContext = await browser.newContext({ baseURL: origin });
  try {
    const memberPage = await memberContext.newPage();
    const member = await register(memberPage, "Ayrılan Profil Üyesi", token);
    const updated = await memberPage.request.patch("/api/profile", {
      headers,
      data: {
        bio: "Üyelik sona erdiğinde bu tanıtım görünmemeli.",
        location: "Ankara",
      },
    });
    expect(updated.status()).toBe(200);
    const avatarUrl = await uploadPhoto(memberPage, member);
    await page.goto(profilePath(owner.workspace.id, member.user.id));
    const profile = page.getByRole("region", {
      name: "Üye profili",
      exact: true,
    });
    await expect(profile.getByRole("heading", { level: 1 })).toHaveText(
      member.user.name,
    );
    await expect(profile.locator(".member-profile-about")).toContainText(
      "Üyelik sona erdiğinde bu tanıtım görünmemeli.",
    );
    await expect(profile.locator(".member-profile-avatar img")).toHaveAttribute(
      "src",
      avatarUrl,
    );
    await expect(
      page.getByText("Her şey güncel", { exact: true }),
    ).toBeAttached();
    const removal = await page.request.delete(
      `/api/admin/workspace/members/${member.user.id}`,
      { headers },
    );
    expect(removal.status()).toBe(204);
    await expect(
      profile.getByRole("heading", {
        name: "Profil görüntülenemiyor",
        exact: true,
      }),
    ).toBeVisible();
    await expect(profile.locator(".member-profile-about")).toHaveCount(0);
    await expect(profile.locator(".member-profile-avatar img")).toHaveCount(0);
    await expect(
      profile.getByRole("link", { name: member.user.email, exact: true }),
    ).toHaveCount(0);
    await expect(
      profile.getByRole("button", { name: "Mesaj gönder", exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await page.request.get(`/api/members/${member.user.id}/profile`)
      ).status(),
    ).toBe(404);
    expect((await page.request.get(avatarUrl)).status()).toBe(404);
  } finally {
    await memberContext.close();
  }
});

test("an unauthenticated profile link opens sign-in without creating a demo session", async ({
  page,
}) => {
  const workspaceId = randomUUID();
  const userId = randomUUID();
  let demoRequests = 0;
  let profileRequests = 0;
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/auth/demo") demoRequests++;
    if (pathname === `/api/members/${userId}/profile`) profileRequests++;
  });
  await page.goto(profilePath(workspaceId, userId));
  await expect(
    page.getByLabel("E-posta adresin", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Üye profili", exact: true }),
  ).toHaveCount(0);
  expect(demoRequests).toBe(0);
  expect(profileRequests).toBe(0);
  expect((await page.request.get("/api/auth/me")).status()).toBe(401);
  expect(new URL(page.url()).searchParams.get("profile")).toBe(userId);
});
