import { test, expect, type Page, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

declare global {
  interface Window {
    __callPanelLayout: {
      captures: number;
      tracks: MediaStreamTrack[];
    };
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

const panel = (page: Page) => page.locator(".call-dialog");
const footerControls = [
  "Mikrofonu kapat",
  "Kamerayı aç",
  "Ekranı paylaş",
  "Katılımcıların sesini kapat",
  "Ses ayarları",
  "Görüşmeden ayrıl",
] as const;

async function prepare(page: Page) {
  await page.addInitScript(() => {
    window.__callPanelLayout = { captures: 0, tracks: [] };
    const capture = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    // Observe the real Chromium fake devices without replacing their streams.
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      window.__callPanelLayout.captures++;
      const stream = await capture(constraints);
      window.__callPanelLayout.tracks.push(...stream.getTracks());
      return stream;
    };
  });
  await page.goto("/");
  await expect(
    page.getByText("Her şey güncel", { exact: true }),
  ).toBeAttached();
  await page
    .getByRole("button", { name: "Bir araya gel", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Görüşmeye katıl", exact: true })
    .click();
  await expect(panel(page)).toBeVisible();
  await expect(
    panel(page).getByRole("button", { name: "Mikrofonu kapat", exact: true }),
  ).toBeEnabled();
  await expect
    .poll(() => mediaState(page).then((state) => state.microphones.length))
    .toBe(1);
}

const mediaState = (page: Page) =>
  page.evaluate(() => ({
    captures: window.__callPanelLayout.captures,
    microphones: window.__callPanelLayout.tracks
      .filter((track) => track.kind === "audio" && track.readyState === "live")
      .map((track) => ({ id: track.id, enabled: track.enabled })),
    cameras: window.__callPanelLayout.tracks
      .filter((track) => track.kind === "video" && track.readyState === "live")
      .map((track) => track.id),
  }));

async function bounds(element: Locator) {
  await expect(element).toBeVisible();
  const value = await element.boundingBox();
  expect(value).not.toBeNull();
  return value!;
}

async function controlsInsideViewport(
  page: Page,
  width: number,
  height: number,
) {
  for (const name of footerControls) {
    const button = panel(page).getByRole("button", { name, exact: true });
    await expect(button).toBeVisible();
    const rect = await bounds(button);
    expect(rect.x, `${name} left`).toBeGreaterThanOrEqual(0);
    expect(rect.y, `${name} top`).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width, `${name} right`).toBeLessThanOrEqual(width + 1);
    expect(rect.y + rect.height, `${name} bottom`).toBeLessThanOrEqual(
      height + 1,
    );
  }
  expect(
    await panel(page).evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
}

async function audit(page: Page) {
  const result = await new AxeBuilder({ page })
    .include(".call-dialog")
    .analyze();
  expect(
    result.violations
      .filter((item) => item.impact === "serious" || item.impact === "critical")
      .map((item) => ({
        id: item.id,
        nodes: item.nodes.map((node) => node.failureSummary),
      })),
  ).toEqual([]);
}

async function expectReleased(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__callPanelLayout.tracks.length > 0 &&
          window.__callPanelLayout.tracks.every(
            (track) => track.readyState === "ended",
          ),
      ),
    )
    .toBe(true);
}

test("desktop calls expand without recapturing devices and retain their size when the camera opens", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await prepare(page);
  const room = panel(page);
  const originalMedia = await mediaState(page);
  expect(originalMedia.microphones[0].enabled).toBe(true);
  const normal = await bounds(room);
  expect(normal.width).toBeGreaterThan(1000);
  expect(normal.height).toBeGreaterThanOrEqual(600);
  await page.screenshot({
    path: "artifacts/call-panel-desktop.png",
    animations: "disabled",
  });
  const expand = room.locator(".call-room-expand");
  await expect(expand).toHaveAccessibleName("Görüşmeyi genişlet");
  await expect(expand).toHaveAttribute("aria-pressed", "false");
  await expand.click();
  await expect(expand).toHaveAccessibleName("Normal görünüme dön");
  await expect(expand).toHaveAttribute("aria-pressed", "true");
  const expanded = await bounds(room);
  expect(expanded.width).toBeGreaterThan(normal.width);
  expect(expanded.height).toBeGreaterThan(normal.height);
  expect(await mediaState(page)).toEqual(originalMedia);
  await page.screenshot({
    path: "artifacts/call-panel-expanded.png",
    animations: "disabled",
  });

  await page.setViewportSize({ width: 1280, height: 850 });
  const resized = await bounds(room);
  expect(resized.x).toBeGreaterThanOrEqual(0);
  expect(resized.y).toBeGreaterThanOrEqual(0);
  expect(resized.x + resized.width).toBeLessThanOrEqual(1281);
  expect(resized.y + resized.height).toBeLessThanOrEqual(851);
  expect(await mediaState(page)).toEqual(originalMedia);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const beforeCamera = await bounds(room);
  await room.getByRole("button", { name: "Kamerayı aç", exact: true }).click();
  await expect(
    room.getByRole("button", { name: "Kamerayı kapat", exact: true }),
  ).toBeEnabled();
  await expect(room.locator(".call-person-camera video")).toBeVisible();
  const withCamera = await mediaState(page);
  expect(withCamera.microphones).toEqual(originalMedia.microphones);
  expect(withCamera.captures).toBe(originalMedia.captures + 1);
  expect(withCamera.cameras).toHaveLength(1);
  const afterCamera = await bounds(room);
  for (const dimension of ["x", "y", "width", "height"] as const)
    expect(
      Math.abs(afterCamera[dimension] - beforeCamera[dimension]),
      dimension,
    ).toBeLessThanOrEqual(1);

  await page.keyboard.press("Escape");
  await expect(room).toBeVisible();
  await expect(expand).toHaveAccessibleName("Görüşmeyi genişlet");
  await expect(expand).toHaveAttribute("aria-pressed", "false");
  const restored = await bounds(room);
  expect(Math.abs(restored.width - normal.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(restored.height - normal.height)).toBeLessThanOrEqual(1);
  expect(await mediaState(page)).toEqual(withCamera);
  await page.keyboard.press("Escape");
  await expect(room).toHaveCount(0);
  const dock = page.getByRole("region", {
    name: "Devam eden görüşme",
    exact: true,
  });
  await expect(dock).toBeVisible();
  await expect(dock.locator(".call-dock-main")).toBeFocused();
  expect(await mediaState(page)).toEqual(withCamera);
  await dock
    .getByRole("button", { name: "Görüşmeden ayrıl", exact: true })
    .click();
  await expectReleased(page);
});

test("touch and short landscape calls keep footer controls reachable and modal focus inside the call", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:5174",
    viewport: { width: 320, height: 720 },
    hasTouch: true,
    isMobile: true,
    permissions: ["microphone", "camera"],
  });
  const page = await context.newPage();
  try {
    await prepare(page);
    const originalMedia = await mediaState(page);
    expect(originalMedia.microphones[0].enabled).toBe(true);
    await expect(panel(page).locator(".call-room-expand")).toBeHidden();
    for (const viewport of [
      { width: 320, height: 720, name: "mobile" },
      { width: 844, height: 390, name: "landscape" },
    ]) {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await controlsInsideViewport(page, viewport.width, viewport.height);
      const first = panel(page)
        .locator("button:visible:not(:disabled)")
        .first();
      const last = panel(page).locator("button:visible:not(:disabled)").last();
      await last.focus();
      await page.keyboard.press("Tab");
      await expect(first).toBeFocused();
      await first.focus();
      await page.keyboard.press("Shift+Tab");
      await expect(last).toBeFocused();
      const settingsButton = panel(page).getByRole("button", {
        name: "Ses ayarları",
        exact: true,
      });
      await settingsButton.tap();
      const settings = page.getByRole("region", {
        name: "Görüşme ses ayarları",
        exact: true,
      });
      await expect(settings).toBeVisible();
      await expect
        .poll(() =>
          settings.evaluate((element) =>
            element.contains(document.activeElement),
          ),
        )
        .toBe(true);
      await page.keyboard.press("Escape");
      await expect(settings).toHaveCount(0);
      await expect(panel(page)).toBeVisible();
      await expect(settingsButton).toBeFocused();
      expect(await mediaState(page)).toEqual(originalMedia);
      await controlsInsideViewport(page, viewport.width, viewport.height);
      await audit(page);
      await page.screenshot({
        path: `artifacts/call-panel-${viewport.name}.png`,
        animations: "disabled",
      });
    }
    await panel(page)
      .getByRole("button", { name: "Görüşmeden ayrıl", exact: true })
      .tap();
    await expect(panel(page)).toHaveCount(0);
    await expectReleased(page);
  } finally {
    await context.close();
  }
});
