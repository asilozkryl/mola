import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

declare global {
  interface Window {
    __voiceSetupQa: {
      requests: number;
      tracks: MediaStreamTrack[];
      release: (() => void) | null;
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

async function instrument(page: Page) {
  await page.addInitScript(() => {
    window.__voiceSetupQa = { requests: 0, tracks: [], release: null };
    const acquire = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      window.__voiceSetupQa.requests++;
      const stream = await acquire(constraints);
      window.__voiceSetupQa.tracks.push(...stream.getTracks());
      return stream;
    };
  });
}

async function openSetup(page: Page) {
  await page
    .getByRole("button", { name: "Bir araya gel", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Görüşmeye hazırlan" }),
  ).toBeVisible();
}

test("compact preflight keeps device settings optional and needs no microphone capture on a 320 px screen", async ({
  page,
}) => {
  await instrument(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  await openSetup(page);
  const dialog = page.getByRole("dialog", { name: "Görüşmeye hazırlan" });
  const settings = dialog.getByRole("button", {
    name: "Ses ayarları",
    exact: true,
  });
  await expect(settings).toHaveAttribute("aria-expanded", "false");
  await expect(
    dialog.getByRole("combobox", { name: "Mikrofon", exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByRole("checkbox", { name: "Mikrofonum kapalı katıl" })
    .check();
  await expect(
    dialog.getByText(/Mikrofon izni gerekir; sesin kapalı başlar/),
  ).toBeVisible();
  expect(await page.evaluate(() => window.__voiceSetupQa.requests)).toBe(0);
  await expect(
    dialog.getByRole("button", { name: "Görüşmeye katıl", exact: true }),
  ).toBeInViewport();
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  const accessibility = await new AxeBuilder({ page })
    .include(".call-preflight")
    .analyze();
  expect(
    accessibility.violations.filter(
      (issue) => issue.impact === "serious" || issue.impact === "critical",
    ),
  ).toEqual([]);
  await page.screenshot({
    path: test.info().outputPath("voice-preflight-mobile.png"),
  });
  await settings.click();
  await expect(
    dialog.getByRole("combobox", { name: "Mikrofon", exact: true }),
  ).toBeEnabled();
  expect(await page.evaluate(() => window.__voiceSetupQa.requests)).toBe(0);
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  await settings.click();
  await expect(settings).toHaveAttribute("aria-expanded", "false");
});

test("an inline cancelled permission request releases its late stream while a fresh test can run", async ({
  page,
}) => {
  await instrument(page);
  await page.addInitScript(() => {
    const acquire = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    let first = true;
    navigator.mediaDevices.getUserMedia = (constraints) => {
      if (!first) return acquire(constraints);
      first = false;
      return new Promise((resolve, reject) => {
        window.__voiceSetupQa.release = () => {
          void acquire(constraints).then(resolve, reject);
        };
      });
    };
  });
  await page.goto("/");
  await openSetup(page);
  await page
    .getByRole("button", { name: "Mikrofonu test et", exact: true })
    .click();
  await expect(
    page.getByText(
      "Mikrofon izni bekleniyor. Tarayıcıdaki izin isteğini kontrol et.",
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Testi iptal et", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Mikrofonu test et", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Testi durdur", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => window.__voiceSetupQa.release?.());
  await expect
    .poll(() => page.evaluate(() => window.__voiceSetupQa.tracks.length))
    .toBe(2);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__voiceSetupQa.tracks.filter(
            (track) => track.readyState === "live",
          ).length,
      ),
    )
    .toBe(1);
  await expect(
    page.getByRole("button", { name: "Testi durdur", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Testi durdur", exact: true }).click();
  expect(
    await page.evaluate(() =>
      window.__voiceSetupQa.tracks.every(
        (track) => track.readyState === "ended",
      ),
    ),
  ).toBe(true);
  await expect(page.getByText(/Test tamamlandı/)).toBeVisible();
});

test("a denied microphone test can retry without joining and changing the input stops the test", async ({
  page,
}) => {
  await instrument(page);
  await page.addInitScript(() => {
    const acquire = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    let denied = false;
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (!denied) {
        denied = true;
        throw new DOMException("Denied", "NotAllowedError");
      }
      return acquire(constraints);
    };
  });
  await page.goto("/");
  await openSetup(page);
  await page
    .getByRole("button", { name: "Mikrofonu test et", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Mikrofon izni verilmedi",
  );
  await expect(
    page.getByRole("button", { name: "Görüşmeye katıl", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Mikrofonu test et", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Testi durdur", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Ses ayarları", exact: true }).click();
  const input = page.getByRole("combobox", { name: "Mikrofon", exact: true });
  await expect(input).toBeEnabled();
  await expect
    .poll(() =>
      input
        .locator("option")
        .evaluateAll((options) =>
          options.some((option) =>
            Boolean((option as HTMLOptionElement).value),
          ),
        ),
    )
    .toBe(true);
  const device = await input
    .locator("option")
    .evaluateAll((options) =>
      options
        .map((option) => (option as HTMLOptionElement).value)
        .find(Boolean)!,
    );
  await input.selectOption(device);
  await expect(
    page.getByRole("button", { name: "Mikrofonu test et", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.__voiceSetupQa.tracks.every(
        (track) => track.readyState === "ended",
      ),
    ),
  ).toBe(true);
  await expect(page.getByText("Henüz test edilmedi.")).toBeVisible();
});

test("an output selection finishing after preflight closes cannot overwrite the current device preference", async ({
  page,
}) => {
  await instrument(page);
  await page.addInitScript(() => {
    const enumerate = navigator.mediaDevices.enumerateDevices.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.enumerateDevices = async () => [
      ...(await enumerate()),
      {
        deviceId: "qa-speaker",
        groupId: "qa-output",
        kind: "audiooutput" as MediaDeviceKind,
        label: "Test hoparlörü",
        toJSON: () => ({}),
      },
    ];
    HTMLMediaElement.prototype.setSinkId = function (id) {
      if (id !== "qa-speaker") return Promise.resolve();
      return new Promise((resolve) => {
        window.__voiceSetupQa.release = resolve;
      });
    };
  });
  await page.goto("/");
  await openSetup(page);
  await page.getByRole("button", { name: "Ses ayarları", exact: true }).click();
  const output = page.getByRole("combobox", { name: "Hoparlör", exact: true });
  await expect(output).toBeEnabled();
  await output.selectOption("qa-speaker");
  await expect(page.getByText("Cihaz değiştiriliyor…")).toBeVisible();
  await expect(output).toBeDisabled();
  await page.getByRole("button", { name: "Vazgeç", exact: true }).click();
  await page.evaluate(() => window.__voiceSetupQa.release?.());
  await openSetup(page);
  await page.getByRole("button", { name: "Ses ayarları", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Hoparlör", exact: true }),
  ).toHaveValue("");
  expect(await page.evaluate(() => window.__voiceSetupQa.requests)).toBe(0);
});
