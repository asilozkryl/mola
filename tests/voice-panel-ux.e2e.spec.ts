import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import sharp from "sharp";
import type { Bootstrap } from "../shared/types";

declare global {
  interface Window {
    __voicePanelTracks: MediaStreamTrack[];
  }
}

test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});

async function prepare(page: Page) {
  await page.addInitScript(() => {
    window.__voicePanelTracks = [];
    const getMedia = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await getMedia(constraints);
      window.__voicePanelTracks.push(...stream.getTracks());
      return stream;
    };
    Object.defineProperty(document, "fullscreenEnabled", {
      configurable: true,
      value: false,
    });
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 360;
      const drawing = canvas.getContext("2d")!;
      drawing.fillStyle = "#153d36";
      drawing.fillRect(0, 0, canvas.width, canvas.height);
      const stream = canvas.captureStream(1);
      window.__voicePanelTracks.push(...stream.getTracks());
      return stream;
    };
  });
  await page.goto("/");
  await expect(page.getByText("Her şey güncel", { exact: true })).toBeVisible();
  const response = await page.request.get("/api/auth/me");
  expect(response.ok()).toBe(true);
  return (await response.json()) as Bootstrap;
}

async function joinCall(page: Page) {
  await page
    .getByRole("button", { name: "Bir araya gel", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Görüşmeye katıl", exact: true })
    .click();
  await expect(page.locator(".call-person")).toHaveCount(1);
}

test("voice participants use compact profile photos and opening a profile preserves the microphone", async ({
  page,
}) => {
  const data = await prepare(page);
  const upload = await page.request.post("/api/profile/avatar", {
    headers: {
      Origin: "http://127.0.0.1:5174",
      "X-Workspace-Id": data.workspace.id,
      "X-User-Id": data.user.id,
    },
    multipart: {
      file: {
        name: "voice-profile.png",
        mimeType: "image/png",
        buffer: await sharp({
          create: { width: 60, height: 60, channels: 3, background: "#237459" },
        })
          .png()
          .toBuffer(),
      },
    },
  });
  expect(upload.ok()).toBe(true);
  await page.reload();
  await expect(page.getByText("Her şey güncel", { exact: true })).toBeVisible();
  await joinCall(page);
  const image = page.locator(".call-person-avatar img");
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((node) => (node as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  expect((await image.boundingBox())!.width).toBeLessThanOrEqual(48);
  const identity = page.locator(".call-person-identity");
  await identity.hover();
  await expect(page.locator(".profile-hover-card")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".profile-hover-card")).toHaveCount(0);
  await expect(page.locator(".call-dialog")).toBeVisible();
  await identity.click();
  await expect(
    page.getByRole("region", { name: "Üye profili", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Devam eden görüşme", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.get("profile")).toBe(data.user.id);
  expect(
    await page.evaluate(() =>
      window.__voicePanelTracks.some(
        (track) => track.kind === "audio" && track.readyState === "live",
      ),
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Görüşmeden ayrıl", exact: true })
    .click();
  expect(
    await page.evaluate(() =>
      window.__voicePanelTracks.every((track) => track.readyState === "ended"),
    ),
  ).toBe(true);
});

test("voice controls fit 320px and the minimized bar exposes muted speakers without trapping chat focus", async ({
  page,
}) => {
  await prepare(page);
  await joinCall(page);
  await page.setViewportSize({ width: 320, height: 720 });
  const panel = page.locator(".call-dialog");
  expect(
    await panel.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  for (const name of [
    "Mikrofonu kapat",
    "Kamerayı aç",
    "Ekranı paylaş",
    "Katılımcıların sesini kapat",
    "Ses ayarları",
    "Görüşmeden ayrıl",
  ]) {
    const bounds = (await panel
      .getByRole("button", { name, exact: true })
      .boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  }
  await panel
    .getByRole("button", { name: "Mikrofonu kapat", exact: true })
    .click();
  await expect(panel.locator(".call-person-status")).toHaveText(
    "Mikrofon kapalı",
  );
  await panel
    .getByRole("button", { name: "Ses ayarları", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Görüşme ses ayarları", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".call-settings-section")
        .evaluate((node) => node.contains(document.activeElement)),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("region", { name: "Görüşme ses ayarları", exact: true }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "Ses ayarları", exact: true }),
  ).toBeFocused();
  await panel
    .getByRole("button", { name: "Katılımcıların sesini kapat", exact: true })
    .click();
  await page.screenshot({
    path: "artifacts/qa-voice-panel-mobile.png",
    animations: "disabled",
  });
  const audit = await new AxeBuilder({ page })
    .include(".call-dialog")
    .analyze();
  expect(
    audit.violations
      .filter((item) => item.impact === "serious" || item.impact === "critical")
      .map((item) => ({
        id: item.id,
        targets: item.nodes.map((node) => node.target),
      })),
  ).toEqual([]);
  await page.keyboard.press("Escape");
  const dock = page.getByRole("region", {
    name: "Devam eden görüşme",
    exact: true,
  });
  await expect(dock.locator(".call-dock-main")).toBeFocused();
  await expect(
    dock.getByText("Hoparlör kapalı", { exact: true }),
  ).toBeVisible();
  await dock
    .getByRole("button", { name: "Katılımcıların sesini aç", exact: true })
    .click();
  await expect(dock.getByText("Hoparlör kapalı", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("textbox", { name: /kanalına mesaj yaz/ }).focus();
  await expect(
    page.getByRole("textbox", { name: /kanalına mesaj yaz/ }),
  ).toBeFocused();
  expect((await dock.boundingBox())!.width).toBeLessThanOrEqual(320);
  await dock
    .getByRole("button", { name: "Görüşmeden ayrıl", exact: true })
    .click();
});

test("Escape first closes expanded sharing and the dock can stop sharing while the call continues", async ({
  page,
}) => {
  await prepare(page);
  await joinCall(page);
  await page
    .getByRole("button", { name: "Ekranı paylaş", exact: true })
    .click();
  await expect(page.locator(".call-share-stage")).toBeVisible();
  await page
    .getByRole("button", { name: "Paylaşılan ekranı büyüt", exact: true })
    .click();
  await expect(page.locator(".call-share-expanded")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", {
      name: "Paylaşılan ekranı ayrı pencerede aç",
      exact: true,
    }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByRole("button", { name: "Paylaşılan ekranı büyüt", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".call-share-expanded")).toHaveCount(0);
  await expect(page.locator(".call-dialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Paylaşılan ekranı büyüt", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Görüşmeyi küçült", exact: true })
    .click();
  const dock = page.getByRole("region", {
    name: "Devam eden görüşme",
    exact: true,
  });
  await dock
    .getByRole("button", { name: "Ekran paylaşımını durdur", exact: true })
    .click();
  await expect(
    dock.getByRole("button", { name: "Ekran paylaşımını durdur", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      window.__voicePanelTracks
        .filter((track) => track.kind === "video")
        .every((track) => track.readyState === "ended"),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() =>
      window.__voicePanelTracks.some(
        (track) => track.kind === "audio" && track.readyState === "live",
      ),
    ),
  ).toBe(true);
  await dock
    .getByRole("button", { name: "Görüşmeden ayrıl", exact: true })
    .click();
});
