import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { Bootstrap } from "../shared/types";

test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});

async function ready(page: Page) {
  await page.goto("/");
  await expect(
    page.getByText("Her şey güncel", { exact: true }),
  ).toBeAttached();
  const response = await page.request.get("/api/auth/me");
  expect(response.status()).toBe(200);
  return (await response.json()) as Bootstrap;
}

test("voice creation shortcut selects voice and returns to normal text creation afterwards", async ({
  page,
}) => {
  await ready(page);
  await page
    .getByRole("button", { name: "Sesli oda oluştur", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Yeni bir kanal oluştur",
    exact: true,
  });
  await expect(
    dialog.getByRole("button", { name: /Sesli oda/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await dialog.getByLabel("Kanal adı", { exact: true }).fill("Hızlı ses odası");
  await dialog
    .getByRole("button", { name: "Kanal oluştur", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.locator(".voice-nav").filter({ hasText: "Hızlı ses odası" }),
  ).toBeVisible();
  const current = await page.request.get("/api/auth/me");
  expect(
    ((await current.json()) as Bootstrap).channels.find(
      (item) => item.name === "Hızlı ses odası",
    )?.kind,
  ).toBe("voice");
  await page.getByRole("button", { name: "Kanal ekle", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: /Yazılı kanal/ }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("room preview shows capacity and privacy without capturing a microphone and stays usable on mobile", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__roomCaptureCount", {
      value: 0,
      writable: true,
    });
    const acquire = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (options) => {
      (window as unknown as { __roomCaptureCount: number })
        .__roomCaptureCount++;
      return acquire(options);
    };
  });
  const data = await ready(page);
  const voice = data.channels.find((item) => item.kind === "voice")!;
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 844 });
    if (width === 320)
      await page
        .getByRole("button", { name: "Gezinmeyi aç", exact: true })
        .click();
    await page
      .getByRole("button", {
        name: `${voice.name} katılımcılarını gör`,
        exact: true,
      })
      .click();
    const preview = page.getByRole("dialog", { name: voice.name, exact: true });
    await expect(
      preview.getByText("Oda şu an boş", { exact: true }),
    ).toBeVisible();
    await expect(
      preview.getByLabel("0 kişi, kapasite 6 kişi", { exact: true }),
    ).toBeVisible();
    await expect(
      preview.getByText("Ekibe açık sesli oda", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __roomCaptureCount: number })
            .__roomCaptureCount,
      ),
    ).toBe(0);
    expect(
      await preview.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    await preview.evaluate(async (el) => {
      await Promise.all(
        el.getAnimations().map((a) => a.finished.catch(() => {})),
      );
    });
    const accessibility = await new AxeBuilder({ page })
      .include("dialog[open]")
      .analyze();
    expect(
      accessibility.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      ),
    ).toEqual([]);
    await page.screenshot({
      path: `artifacts/voice-room-${width}.png`,
      animations: "disabled",
    });
    await preview
      .getByRole("button", { name: "Sesli odaya katıl", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Görüşmeye hazırlan", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __roomCaptureCount: number })
            .__roomCaptureCount,
      ),
    ).toBe(0);
    await page.keyboard.press("Escape");
  }
});

test("switching rooms can be cancelled and then safely opens preparation after leaving the old call", async ({
  page,
}) => {
  const data = await ready(page);
  const [first, second] = data.channels.filter((item) => item.kind === "voice");
  expect(second).toBeTruthy();
  await page.getByRole("button", { name: first.name, exact: true }).click();
  await page
    .getByRole("button", { name: "Görüşmeye katıl", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Mikrofonu kapat", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Görüşmeyi küçült", exact: true })
    .click();
  const dock = page.getByRole("region", {
    name: "Devam eden görüşme",
    exact: true,
  });
  await page.getByRole("button", { name: second.name, exact: true }).click();
  const switcher = page.getByRole("dialog", {
    name: "Başka bir görüşmeye geç",
    exact: true,
  });
  await expect(switcher).toBeVisible();
  await expect(switcher).toContainText(first.name);
  await expect(switcher).toContainText(second.name);
  await page.keyboard.press("Escape");
  await expect(switcher).toHaveCount(0);
  await expect(dock).toContainText(first.name);
  await page.getByRole("button", { name: second.name, exact: true }).click();
  await switcher
    .getByRole("button", { name: "Ayrıl ve devam et", exact: true })
    .click();
  await expect(dock).toHaveCount(0);
  const setup = page.getByRole("dialog", {
    name: "Görüşmeye hazırlan",
    exact: true,
  });
  await expect(setup).toContainText(second.name);
  const before = await page.request.get("/api/auth/me");
  expect(
    ((await before.json()) as Bootstrap).voiceChannels
      .flatMap((item) => item.peers)
      .filter((peer) => peer.user.id === data.user.id),
  ).toHaveLength(0);
  await setup
    .getByRole("button", { name: "Görüşmeye katıl", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: second.name, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Görüşmeden ayrıl", exact: true })
    .click();
});

test("failed room join does not label its sidebar entry as an active call", async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("denied", "NotAllowedError");
    };
  });
  const data = await ready(page);
  const voice = data.channels.find((item) => item.kind === "voice")!;
  await page.getByRole("button", { name: voice.name, exact: true }).click();
  await page
    .getByRole("button", { name: "Görüşmeye katıl", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Mikrofon izni verilmedi",
  );
  await expect(page.locator(".voice-nav.voice-active")).toHaveCount(0);
  await page.getByRole("button", { name: "Kapat", exact: true }).click();
  await page
    .getByRole("button", {
      name: `${voice.name} katılımcılarını gör`,
      exact: true,
    })
    .click();
  const preview = page.getByRole("dialog", { name: voice.name, exact: true });
  await expect(
    preview.getByRole("button", { name: "Sesli odaya katıl", exact: true }),
  ).toBeVisible();
  await expect(preview.getByText("Bu odadasın", { exact: true })).toHaveCount(
    0,
  );
});
