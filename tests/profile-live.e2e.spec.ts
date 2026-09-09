import {
  expect,
  test,
  type APIResponse,
  type Page,
  type Request as BrowserRequest,
} from "@playwright/test";
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
  let releaseGate!: () => void;
  let captured!: () => void;
  let released = false;
  let queued = 0;
  let settled = 0;
  let originalResponse: Promise<APIResponse> | undefined;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const release = () => {
    released = true;
    releaseGate();
  };
  const responseReady = new Promise<void>((resolve) => {
    captured = resolve;
  });
  await page.route(`**/api/members/${data.user.id}/profile`, async (route) => {
    if (released) return route.continue();
    queued++;
    // StrictMode can cancel and repeat the initial effect. Hold every initial
    // request behind the same real, pre-edit server snapshot, so an uncancelled
    // second request cannot bypass the delayed-response scenario.
    originalResponse ||= route.fetch();
    const response = await originalResponse;
    captured();
    await gate;
    // One of the held requests may have been cancelled by effect cleanup.
    await route.fulfill({ response }).catch(() => {});
    settled++;
  });
  let sibling: Page | undefined;
  try {
    await page.goto(profilePath(data.workspace.id, data.user.id));
    await responseReady;
    const profile = page.getByRole("region", {
      name: "Üye profili",
      exact: true,
    });
    await expect(
      profile.getByText("Profil yükleniyor", { exact: true }),
    ).toBeVisible();
    expect((await (await originalResponse!).json()).user.name).toBe(
      data.user.name,
    );
    await expect(
      page.getByText("Her şey güncel", { exact: true }),
    ).toBeAttached();
    sibling = await page.context().newPage();
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
    await expect(
      profile.getByText("Profil yükleniyor", { exact: true }),
    ).toBeVisible();
    release();
    await expect.poll(() => settled === queued && queued > 0).toBe(true);
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
    await sibling?.close();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("a delayed session refresh cannot overwrite a newer live profile update", async ({
  page,
}) => {
  const data = await register(page, "Oturumun Eski Adı");
  const nextName = "Canlı Güncel Ad";
  const isBootstrap = (request: BrowserRequest) =>
    new URL(request.url()).pathname === "/api/auth/me";
  const pendingBootstraps = new Set<BrowserRequest>();
  const started = (request: BrowserRequest) => {
    if (isBootstrap(request)) pendingBootstraps.add(request);
  };
  const finished = (request: BrowserRequest) => {
    pendingBootstraps.delete(request);
  };
  page.on("request", started);
  page.on("requestfinished", finished);
  page.on("requestfailed", finished);
  await page.goto(profilePath(data.workspace.id, data.user.id));
  const profile = page.getByRole("region", {
    name: "Üye profili",
    exact: true,
  });
  const identity = page.locator(".topbar-avatar.profile-identity");
  await expect(profile.getByRole("heading", { level: 1 })).toContainText(
    data.user.name,
  );
  await expect(
    page.getByText("Her şey güncel", { exact: true }),
  ).toBeAttached();
  // Finish the initial and socket-connect bootstrap requests before arming the
  // deliberate refresh, so StrictMode cannot select the wrong request to hold.
  await expect.poll(() => pendingBootstraps.size).toBe(0);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  page.off("request", started);
  page.off("requestfinished", finished);
  page.off("requestfailed", finished);

  let release!: () => void;
  let captured!: (response: APIResponse) => void;
  let firstRequest: BrowserRequest | undefined;
  let refreshRequests = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const snapshotReady = new Promise<APIResponse>((resolve) => {
    captured = resolve;
  });
  await page.route("**/api/auth/me", async (route) => {
    refreshRequests++;
    if (refreshRequests !== 1) return route.continue();
    firstRequest = route.request();
    const response = await route.fetch();
    captured(response);
    await gate;
    await route.fulfill({ response });
  });
  const sibling = await page.context().newPage();
  try {
    await page.evaluate(() =>
      window.dispatchEvent(new Event("mola:workspace-changed")),
    );
    const snapshotResponse = await snapshotReady;
    expect(snapshotResponse.status()).toBe(200);
    const snapshot = (await snapshotResponse.json()) as Bootstrap;
    expect(snapshot.user.id).toBe(data.user.id);
    expect(snapshot.workspace.id).toBe(data.workspace.id);
    expect(snapshot.user.name).toBe(data.user.name);
    expect(
      snapshot.members.find((member) => member.id === data.user.id)?.name,
    ).toBe(data.user.name);
    expect(firstRequest!.headers()["x-workspace-id"]).toBe(data.workspace.id);
    const changed = await sibling.request.patch("/api/profile", {
      headers: {
        ...headers,
        "X-Workspace-Id": data.workspace.id,
        "X-User-Id": data.user.id,
      },
      data: { name: nextName },
    });
    expect(changed.status()).toBe(200);
    expect((await changed.json()).id).toBe(data.user.id);
    await expect(identity).toHaveAttribute(
      "aria-label",
      `${nextName} profilini görüntüle`,
    );
    await expect(profile.getByRole("heading", { level: 1 })).toContainText(
      nextName,
    );
    expect(refreshRequests).toBe(1);
    // Record every identity transition, including a transient stale render that
    // a final-state assertion alone could miss before the corrective refetch.
    await identity.evaluate((element) => {
      const state = window as typeof window & {
        refreshIdentityLabels: string[];
      };
      state.refreshIdentityLabels = [];
      new MutationObserver((records) => {
        for (const record of records) {
          state.refreshIdentityLabels.push(record.oldValue || "");
          state.refreshIdentityLabels.push(
            element.getAttribute("aria-label") || "",
          );
        }
      }).observe(element, {
        attributes: true,
        attributeFilter: ["aria-label"],
        attributeOldValue: true,
      });
    });
    const oldResponse = page.waitForResponse(
      (response) => response.request() === firstRequest,
    );
    const currentResponse = page.waitForResponse(
      (response) =>
        isBootstrap(response.request()) && response.request() !== firstRequest,
    );
    release();
    const deliveredOld = await oldResponse;
    expect(await deliveredOld.finished()).toBeNull();
    expect((await deliveredOld.json()).user.name).toBe(data.user.name);
    const deliveredCurrent = await currentResponse;
    expect(deliveredCurrent.status()).toBe(200);
    expect(await deliveredCurrent.finished()).toBeNull();
    const current = (await deliveredCurrent.json()) as Bootstrap;
    expect(current.user.id).toBe(data.user.id);
    expect(current.workspace.id).toBe(data.workspace.id);
    expect(current.user.name).toBe(nextName);
    expect(deliveredCurrent.request().headers()["x-workspace-id"]).toBe(
      data.workspace.id,
    );
    expect(refreshRequests).toBeGreaterThanOrEqual(2);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(identity).toHaveAttribute(
      "aria-label",
      `${nextName} profilini görüntüle`,
    );
    await expect(profile.getByRole("heading", { level: 1 })).toContainText(
      nextName,
    );
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { refreshIdentityLabels: string[] })
            .refreshIdentityLabels,
      ),
    ).not.toContain(`${data.user.name} profilini görüntüle`);
    expect(new URL(page.url()).searchParams.get("profile")).toBe(data.user.id);
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
    await sibling.close();
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
