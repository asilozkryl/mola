import { expect, test, type Locator, type Page } from "@playwright/test";

declare global {
  interface Window {
    __callDockTracks: MediaStreamTrack[];
    __callDockViewport: { height: number | null; offsetTop: number };
  }
}

test.use({
  permissions: ["microphone", "camera"],
  reducedMotion: "reduce",
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});

const dock = (page: Page) =>
  page.getByRole("region", { name: "Devam eden görüşme", exact: true });
const handle = (page: Page) =>
  dock(page).getByRole("button", {
    name: "Görüşme çubuğunu taşı",
    exact: true,
  });

async function bounds(locator: Locator) {
  await expect(locator).toBeVisible();
  const rect = await locator.boundingBox();
  expect(rect).not.toBeNull();
  return rect!;
}

async function joinAndMinimize(page: Page) {
  await page.addInitScript(() => {
    window.__callDockTracks = [];
    const capture = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    // Observe Chromium's real fake microphone; keep the acquired streams intact.
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await capture(constraints);
      window.__callDockTracks.push(...stream.getTracks());
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
  const room = page.locator(".call-dialog");
  await expect(
    room.getByRole("button", { name: "Mikrofonu kapat", exact: true }),
  ).toBeEnabled();
  await expect.poll(() => microphoneState(page)).toEqual([true]);
  await room
    .getByRole("button", { name: "Görüşmeyi küçült", exact: true })
    .click();
  await expect(room).toHaveCount(0);
  await expect(handle(page)).toBeVisible();
}

function microphoneState(page: Page) {
  return page.evaluate(() =>
    window.__callDockTracks
      .filter((track) => track.kind === "audio" && track.readyState === "live")
      .map((track) => track.enabled),
  );
}

async function expectPosition(page: Page, expected: { x: number; y: number }) {
  await expect
    .poll(async () => {
      const rect = await dock(page).boundingBox();
      return rect
        ? Math.max(Math.abs(rect.x - expected.x), Math.abs(rect.y - expected.y))
        : Infinity;
    })
    .toBeLessThanOrEqual(2);
}

async function expectClearComposer(page: Page) {
  await expect
    .poll(async () => {
      const floating = await dock(page).boundingBox();
      if (!floating) return false;
      for (const composer of await page.locator(".composer-wrap").all()) {
        const rect = await composer.boundingBox();
        if (!rect) continue;
        const overlaps =
          floating.x < rect.x + rect.width &&
          floating.x + floating.width > rect.x &&
          floating.y < rect.y + rect.height &&
          floating.y + floating.height > rect.y;
        if (overlaps) return false;
      }
      return true;
    })
    .toBe(true);
}

async function expectBounded(
  page: Page,
  width: number,
  height: number,
  top = 0,
) {
  await expect
    .poll(async () => {
      const rect = await dock(page).boundingBox();
      return Boolean(
        rect &&
        rect.x >= 0 &&
        rect.y >= top &&
        rect.x + rect.width <= width + 1 &&
        rect.y + rect.height <= top + height + 1,
      );
    })
    .toBe(true);
  for (const control of await dock(page).getByRole("button").all()) {
    const rect = await bounds(control);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(top);
    expect(rect.x + rect.width).toBeLessThanOrEqual(width + 1);
    expect(rect.y + rect.height).toBeLessThanOrEqual(top + height + 1);
  }
}

async function leave(page: Page) {
  await dock(page)
    .getByRole("button", { name: "Görüşmeden ayrıl", exact: true })
    .click();
  await expect(dock(page)).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__callDockTracks.length > 0 &&
          window.__callDockTracks.every(
            (track) => track.readyState === "ended",
          ),
      ),
    )
    .toBe(true);
}

test("the mini dock clears the composer, drags independently of mute and keeps its position after expanding", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await joinAndMinimize(page);
  await expectClearComposer(page);
  await expectBounded(page, 1440, 1000);
  const original = await bounds(dock(page));
  const grip = await bounds(handle(page));
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    grip.x + grip.width / 2 - 140,
    grip.y + grip.height / 2 - 110,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => original.x - (await bounds(dock(page))).x)
    .toBeGreaterThan(100);
  await expect
    .poll(async () => original.y - (await bounds(dock(page))).y)
    .toBeGreaterThan(70);
  const moved = await bounds(dock(page));

  await dock(page)
    .getByRole("button", { name: "Mikrofonu kapat", exact: true })
    .click();
  await expect(
    dock(page).getByRole("button", { name: "Mikrofonu aç", exact: true }),
  ).toBeVisible();
  await expect.poll(() => microphoneState(page)).toEqual([false]);
  await expectPosition(page, moved);
  await dock(page)
    .getByRole("button", { name: "Görüşmeyi aç", exact: true })
    .click();
  const room = page.locator(".call-dialog");
  await expect(room).toBeVisible();
  await room
    .getByRole("button", { name: "Görüşmeyi genişlet", exact: true })
    .click();
  await expect(
    room.getByRole("button", { name: "Normal görünüme dön", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await room
    .getByRole("button", { name: "Görüşmeyi küçült", exact: true })
    .click();
  await expect(room).toHaveCount(0);
  await expectPosition(page, moved);
  await expect.poll(() => microphoneState(page)).toEqual([false]);
  await dock(page)
    .getByRole("button", { name: "Mikrofonu aç", exact: true })
    .click();
  await expect.poll(() => microphoneState(page)).toEqual([true]);
  await expectPosition(page, moved);
  await leave(page);
});

test("the move handle supports keyboard movement, faster shifted arrows and Home reset", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await joinAndMinimize(page);
  const original = await bounds(dock(page));
  await handle(page).focus();
  await handle(page).press("ArrowLeft");
  const left = await bounds(dock(page));
  expect(left.x).toBeLessThan(original.x);
  expect(Math.abs(left.y - original.y)).toBeLessThanOrEqual(2);
  await handle(page).press("ArrowUp");
  const up = await bounds(dock(page));
  expect(up.y).toBeLessThan(left.y);
  await handle(page).press("Shift+ArrowLeft");
  const faster = await bounds(dock(page));
  expect(up.x - faster.x).toBeGreaterThan(original.x - left.x);
  await expect(handle(page)).toBeFocused();
  await handle(page).press("Home");
  await expectPosition(page, original);
  await expectClearComposer(page);
  await expect(handle(page)).toBeFocused();
  await leave(page);
});

test.describe("touch mini dock", () => {
  test.use({
    viewport: { width: 320, height: 720 },
    hasTouch: true,
    isMobile: true,
  });

  test("touch dragging, orientation changes and an overlaid keyboard keep the dock and its controls reachable", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__callDockViewport = { height: null, offsetTop: 0 };
      const viewport = new EventTarget();
      Object.defineProperties(viewport, {
        width: { get: () => innerWidth },
        height: { get: () => window.__callDockViewport.height ?? innerHeight },
        offsetTop: { get: () => window.__callDockViewport.offsetTop },
        offsetLeft: { get: () => 0 },
        scale: { get: () => 1 },
      });
      Object.defineProperty(window, "visualViewport", {
        value: viewport,
        configurable: true,
      });
    });
    await joinAndMinimize(page);
    await expectBounded(page, 320, 720);
    await expectClearComposer(page);
    const original = await bounds(dock(page));
    const grip = await bounds(handle(page));
    const x = grip.x + grip.width / 2;
    const y = grip.y + grip.height / 2;
    const session = await page.context().newCDPSession(page);
    try {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      });
      for (let step = 1; step <= 6; step++) {
        await session.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: y - step * 20 }],
        });
      }
      await session.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    } finally {
      await session.detach();
    }
    await expect
      .poll(async () => original.y - (await bounds(dock(page))).y)
      .toBeGreaterThan(80);
    await expectBounded(page, 320, 720);
    await expectClearComposer(page);
    await page.setViewportSize({ width: 568, height: 320 });
    await expectBounded(page, 568, 320);
    await expectClearComposer(page);
    await page.setViewportSize({ width: 320, height: 720 });
    await expectBounded(page, 320, 720);

    // Move below the upcoming keyboard boundary so the viewport change must
    // actually relocate a user-positioned dock.
    await handle(page).press("Home");
    await handle(page).press("ArrowUp");
    await expect
      .poll(async () => {
        const rect = await bounds(dock(page));
        return rect.y + rect.height;
      })
      .toBeGreaterThan(360);

    const composer = page.getByRole("textbox", { name: /kanalına mesaj yaz/ });
    await composer.focus();
    await page.evaluate(() => {
      window.__callDockViewport = { height: 360, offsetTop: 12 };
      window.visualViewport!.dispatchEvent(new Event("resize"));
    });
    await expect(page.locator("html")).toHaveAttribute(
      "data-mobile-keyboard",
      "true",
    );
    await composer.fill("Klavye açık görüşme taslağı");
    await expectBounded(page, 320, 360, 12);
    await expectClearComposer(page);
    await expect(composer).toHaveValue("Klavye açık görüşme taslağı");
    await dock(page)
      .getByRole("button", { name: "Mikrofonu kapat", exact: true })
      .tap();
    await expect.poll(() => microphoneState(page)).toEqual([false]);
    await expectBounded(page, 320, 360, 12);
    await page.evaluate(() => {
      window.__callDockViewport = { height: null, offsetTop: 0 };
      window.visualViewport!.dispatchEvent(new Event("resize"));
    });
    await expectBounded(page, 320, 720);
    await leave(page);
  });
});
