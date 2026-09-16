import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";

declare global {
  interface Window {
    __handoffTest: {
      tracks: MediaStreamTrack[];
      peers: RTCPeerConnection[];
      deny: boolean;
      pause: boolean;
      release: (() => void) | null;
    };
  }
}
const origin = "http://127.0.0.1:5174";
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
    const state = (window.__handoffTest = {
      tracks: [] as MediaStreamTrack[],
      peers: [] as RTCPeerConnection[],
      deny: false,
      pause: false,
      release: null as (() => void) | null,
    });
    const Original = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Original {
      constructor(config?: RTCConfiguration) {
        super(config);
        state.peers.push(this);
      }
    };
    const acquire = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (state.deny)
        throw new DOMException("Permission denied", "NotAllowedError");
      if (state.pause) {
        state.pause = false;
        await new Promise<void>((resolve) => {
          state.release = resolve;
        });
        state.release = null;
      }
      const stream = await acquire(constraints);
      state.tracks.push(...stream.getTracks());
      return stream;
    };
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 180;
      canvas.getContext("2d")!.fillRect(0, 0, 320, 180);
      const stream = canvas.captureStream(1);
      state.tracks.push(...stream.getTracks());
      return stream;
    };
  });
}

async function setup(
  browser: Browser,
  withPeer = false,
  configure?: (a: Page, b: Page) => Promise<void>,
) {
  const source = await browser.newContext({
    permissions: ["microphone", "camera"],
  });
  const target = await browser.newContext({
    permissions: ["microphone", "camera"],
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Test Phone) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36",
  });
  const contexts: BrowserContext[] = [source, target];
  const email = `handoff-${randomUUID()}@example.com`;
  const password = "TestHandoff-Secure42!";
  const registered = await source.request.post(`${origin}/api/auth/register`, {
    headers: { Origin: origin },
    data: {
      email,
      password,
      name: "Aktarım Testi",
      workspaceName: "Aktarım Ekibi",
    },
  });
  expect(registered.ok()).toBeTruthy();
  const login = await target.request.post(`${origin}/api/auth/login`, {
    headers: { Origin: origin },
    data: { email, password },
  });
  expect(login.ok()).toBeTruthy();
  const a = await source.newPage();
  const b = await target.newPage();
  await configure?.(a, b);
  await instrument(a);
  await instrument(b);
  await a.goto("/");
  await b.goto("/");
  for (const page of [a, b])
    await expect(page.locator(".channel-tab-end")).toHaveAttribute(
      "data-connected",
      "true",
    );
  let c: Page | undefined;
  if (withPeer) {
    const observer = await browser.newContext({
      permissions: ["microphone", "camera"],
    });
    contexts.push(observer);
    await observer.addCookies(await source.cookies());
    c = await observer.newPage();
    await instrument(c);
    await c.goto("/");
    await expect(c.getByText("Her şey güncel", { exact: true })).toBeVisible();
  }
  return {
    a,
    b,
    c,
    close: () => Promise.all(contexts.map((context) => context.close())),
  };
}
async function join(page: Page) {
  await page
    .getByRole("button", { name: "Bir araya gel", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Görüşmeye katıl", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Mikrofonu kapat", exact: true }),
  ).toBeVisible();
}
async function offer(a: Page, b: Page, open = true) {
  if (open)
    await a
      .getByRole("button", {
        name: "Görüşmeyi başka cihaza aktar",
        exact: true,
      })
      .click();
  await expect(a.locator(".call-transfer-device")).toHaveCount(1);
  await a.locator(".call-transfer-device").click();
  await expect(
    b.getByRole("dialog", { name: "Görüşmeyi bu cihaza al", exact: true }),
  ).toBeVisible();
  await expect(
    a.getByText("Diğer cihazda aktarımı kabul et.", { exact: true }),
  ).toBeVisible();
}

test("handoff waits for consent and capture, connects the other peer, preserves mute and releases every source track", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { a, b, c, close } = await setup(browser, true);
  try {
    await join(a);
    await join(c!);
    await expect
      .poll(() =>
        a.evaluate(() =>
          window.__handoffTest.peers.some(
            (pc) => pc.connectionState === "connected",
          ),
        ),
      )
      .toBe(true);
    await a.getByRole("button", { name: "Kamerayı aç", exact: true }).click();
    await a.getByRole("button", { name: "Ekranı paylaş", exact: true }).click();
    await a
      .getByRole("button", { name: "Mikrofonu kapat", exact: true })
      .click();
    await offer(a, b);
    await expect(
      b.getByRole("dialog", { name: "Görüşmeyi bu cihaza al", exact: true }),
    ).toBeInViewport();
    await b.evaluate(() => {
      window.__handoffTest.pause = true;
    });
    await b
      .getByRole("button", { name: "Bu cihazda devam et", exact: true })
      .click();
    await expect
      .poll(() => b.evaluate(() => Boolean(window.__handoffTest.release)))
      .toBe(true);
    expect(
      await a.evaluate(
        () =>
          window.__handoffTest.tracks.filter(
            (track) => track.readyState === "live",
          ).length,
      ),
    ).toBeGreaterThanOrEqual(3);
    await expect(
      a.getByRole("button", { name: "Görüşmeden ayrıl", exact: true }),
    ).toBeVisible();
    await b.evaluate(() => window.__handoffTest.release!());
    await expect(
      b.getByText("Görüşme bu cihazda devam ediyor.", { exact: true }),
    ).toBeVisible();
    await expect(a.getByText(/Görüşme .* cihazına aktarıldı\./)).toBeVisible();
    await expect
      .poll(() =>
        a.evaluate(
          () =>
            window.__handoffTest.tracks.every(
              (track) => track.readyState === "ended",
            ) &&
            window.__handoffTest.peers.every(
              (pc) => pc.connectionState === "closed",
            ),
        ),
      )
      .toBe(true);
    await expect(
      b.getByRole("button", { name: "Mikrofonu aç", exact: true }),
    ).toBeVisible();
    expect(
      await b.evaluate(() =>
        window.__handoffTest.tracks.every(
          (track) => track.kind === "audio" && !track.enabled,
        ),
      ),
    ).toBe(true);
    await expect
      .poll(() =>
        b.evaluate(
          () =>
            window.__handoffTest.peers.filter(
              (pc) => pc.connectionState === "connected",
            ).length,
        ),
      )
      .toBe(1);
    await expect(c!.getByText(/2 kişi görüşmede/)).toBeVisible();
    await b.getByRole("button", { name: "Mikrofonu aç", exact: true }).click();
    await expect
      .poll(() =>
        b.evaluate(async () => {
          let bytes = 0;
          for (const pc of window.__handoffTest.peers.filter(
            (pc) => pc.connectionState === "connected",
          ))
            (await pc.getStats()).forEach((stat) => {
              if (stat.type === "outbound-rtp" && stat.kind === "audio")
                bytes += Number(stat.bytesSent || 0);
            });
          return bytes;
        }),
      )
      .toBeGreaterThan(0);
  } finally {
    await close();
  }
});

test("declining, denied microphone and cancellation during capture all keep the source call alive", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { a, b, close } = await setup(browser);
  try {
    await join(a);
    await offer(a, b);
    await b.getByRole("button", { name: "Şimdi değil", exact: true }).click();
    await expect(
      b.getByRole("dialog", { name: "Görüşmeyi bu cihaza al", exact: true }),
    ).toBeHidden();
    expect(await b.evaluate(() => window.__handoffTest.tracks.length)).toBe(0);
    await offer(a, b, false);
    await b.evaluate(() => {
      window.__handoffTest.deny = true;
    });
    await b
      .getByRole("button", { name: "Bu cihazda devam et", exact: true })
      .click();
    await expect(b.getByText(/Mikrofon izni verilmedi/)).toBeVisible();
    await expect(
      a.getByRole("button", { name: "Mikrofonu kapat", exact: true }),
    ).toBeVisible();
    await b.getByRole("button", { name: "Kapat", exact: true }).click();
    await b.evaluate(() => {
      window.__handoffTest.deny = false;
      window.__handoffTest.pause = true;
    });
    await offer(a, b, false);
    await b
      .getByRole("button", { name: "Bu cihazda devam et", exact: true })
      .click();
    await expect
      .poll(() => b.evaluate(() => Boolean(window.__handoffTest.release)))
      .toBe(true);
    await a
      .getByRole("button", { name: "Aktarımı iptal et", exact: true })
      .click();
    await expect(
      b.getByText("Mikrofon ve bağlantı hazırlanıyor", { exact: true }),
    ).toBeHidden();
    await b.evaluate(() => window.__handoffTest.release!());
    await expect
      .poll(() =>
        b.evaluate(
          () =>
            window.__handoffTest.tracks.length > 0 &&
            window.__handoffTest.tracks.every(
              (track) => track.readyState === "ended",
            ),
        ),
      )
      .toBe(true);
    expect(
      await a.evaluate(() =>
        window.__handoffTest.tracks.some(
          (track) => track.readyState === "live" && track.enabled,
        ),
      ),
    ).toBe(true);
    await expect(
      a.getByRole("button", { name: "Mikrofonu kapat", exact: true }),
    ).toBeVisible();
  } finally {
    await close();
  }
});

test("a completed transfer is applied even when the source request acknowledgement arrives late", async ({
  browser,
}) => {
  let releaseAck: (() => void) | undefined;
  let sourceCompleted = false;
  const { a, b, close } = await setup(browser, false, async (a) => {
    await a.routeWebSocket(/socket\.io\//, (route) => {
      const server = route.connectToServer();
      server.onMessage((message) => {
        const text = String(message);
        if (/^43\d+\[/.test(text) && text.includes('"transfer":'))
          releaseAck = () => route.send(message);
        else {
          if (
            text.includes('"call:transfer:status"') &&
            text.includes('"completed"')
          )
            sourceCompleted = true;
          route.send(message);
        }
      });
    });
  });
  try {
    await join(a);
    await a
      .getByRole("button", {
        name: "Görüşmeyi başka cihaza aktar",
        exact: true,
      })
      .click();
    await expect(a.locator(".call-transfer-device")).toHaveCount(1);
    await a.locator(".call-transfer-device").click();
    await expect(
      b.getByRole("button", { name: "Bu cihazda devam et", exact: true }),
    ).toBeVisible();
    await b
      .getByRole("button", { name: "Bu cihazda devam et", exact: true })
      .click();
    await expect.poll(() => sourceCompleted && Boolean(releaseAck)).toBe(true);
    releaseAck!();
    await expect(a.getByText(/Görüşme .* cihazına aktarıldı\./)).toBeVisible();
    await expect
      .poll(() =>
        a.evaluate(() =>
          window.__handoffTest.tracks.every(
            (track) => track.readyState === "ended",
          ),
        ),
      )
      .toBe(true);
    await expect(
      b.getByRole("button", { name: "Mikrofonu kapat", exact: true }),
    ).toBeVisible();
  } finally {
    await close();
  }
});

test("a cancel click cannot undo a transfer already committed while completion delivery is delayed", async ({
  browser,
}) => {
  let releaseMessages: (() => void) | undefined;
  const { a, b, close } = await setup(browser, false, async (_a, b) => {
    await b.routeWebSocket(/socket\.io\//, (route) => {
      const server = route.connectToServer();
      let holding = false;
      const queued: (string | Buffer)[] = [];
      server.onMessage((message) => {
        const text = String(message);
        if (
          text.includes('"call:transfer:status"') &&
          text.includes('"completed"')
        ) {
          holding = true;
          releaseMessages = () => {
            holding = false;
            for (const item of queued.splice(0)) route.send(item);
          };
        }
        if (holding) queued.push(message);
        else route.send(message);
      });
    });
  });
  try {
    await join(a);
    await offer(a, b);
    await b
      .getByRole("button", { name: "Bu cihazda devam et", exact: true })
      .click();
    await expect.poll(() => Boolean(releaseMessages)).toBe(true);
    await b.getByRole("button", { name: "İptal et", exact: true }).click();
    releaseMessages!();
    await expect(
      b.getByText("Görüşme bu cihazda devam ediyor.", { exact: true }),
    ).toBeVisible();
    await expect(
      b.getByRole("button", { name: "Mikrofonu kapat", exact: true }),
    ).toBeVisible();
    expect(
      await b.evaluate(() =>
        window.__handoffTest.tracks.some(
          (track) => track.readyState === "live" && track.enabled,
        ),
      ),
    ).toBe(true);
    await expect
      .poll(() =>
        a.evaluate(() =>
          window.__handoffTest.tracks.every(
            (track) => track.readyState === "ended",
          ),
        ),
      )
      .toBe(true);
  } finally {
    await close();
  }
});

test("accepting a transfer preserves unsaved profile work on the receiving device", async ({
  browser,
}) => {
  const { a, b, close } = await setup(browser);
  try {
    await b.setViewportSize({ width: 1440, height: 1000 });
    await b
      .getByRole("button", { name: "Profil ayarları", exact: true })
      .click();
    const settings = b.getByRole("dialog", {
      name: "Kendine ait bir köşe",
      exact: true,
    });
    await settings
      .getByLabel("Unvanın", { exact: true })
      .fill("Kaydedilmemiş unvan");
    await join(a);
    await offer(a, b);
    await b
      .getByRole("button", { name: "Bu cihazda devam et", exact: true })
      .click();
    await expect(
      b.getByRole("button", { name: "Mikrofonu kapat", exact: true }),
    ).toBeVisible();
    await b
      .getByRole("button", { name: "Görüşmeyi küçült", exact: true })
      .click();
    await expect(settings).toBeVisible();
    await expect(settings.getByLabel("Unvanın", { exact: true })).toHaveValue(
      "Kaydedilmemiş unvan",
    );
  } finally {
    await close();
  }
});
