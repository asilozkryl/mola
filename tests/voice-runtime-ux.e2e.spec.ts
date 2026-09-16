import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

type CaptureKind = "audio" | "camera" | "screen";
declare global {
  interface Window {
    __voiceRuntime: {
      pauseNext: CaptureKind | null;
      tracks: MediaStreamTrack[];
      peers: RTCPeerConnection[];
      requests: {
        kind: CaptureKind;
        release?: () => void;
        stream?: MediaStream;
      }[];
    };
    __voiceReplace?: { track: MediaStreamTrack; release: () => void };
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

async function instrumentCapture(page: Page) {
  await page.addInitScript(() => {
    const state: Window["__voiceRuntime"] = {
      pauseNext: null,
      tracks: [],
      peers: [],
      requests: [],
    };
    window.__voiceRuntime = state;
    const PeerConnection = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends PeerConnection {
      constructor(configuration?: RTCConfiguration) {
        super(configuration);
        state.peers.push(this);
      }
    };
    const acquire = (
      kind: CaptureKind,
      getStream: () => Promise<MediaStream>,
    ) => {
      const request: Window["__voiceRuntime"]["requests"][number] = { kind };
      state.requests.push(request);
      const paused = state.pauseNext === kind;
      if (paused) state.pauseNext = null;
      return new Promise<MediaStream>((resolve, reject) => {
        const complete = () => {
          delete request.release;
          void getStream().then((stream) => {
            request.stream = stream;
            state.tracks.push(...stream.getTracks());
            resolve(stream);
          }, reject);
        };
        if (paused) request.release = complete;
        else complete();
      });
    };
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = (constraints) =>
      acquire(constraints?.video ? "camera" : "audio", () =>
        getUserMedia(constraints),
      );
    navigator.mediaDevices.getDisplayMedia = () =>
      acquire("screen", async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 180;
        canvas.getContext("2d")!.fillRect(0, 0, 320, 180);
        return canvas.captureStream(1);
      });
  });
}

async function joinCall(page: Page) {
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

async function openCallParticipants(pages: Page[]) {
  const origin = "http://127.0.0.1:5174";
  const headers = { Origin: origin };
  let inviteToken: string | undefined;
  for (const [index, page] of pages.entries()) {
    const registered = await page.request.post(`${origin}/api/auth/register`, {
      headers,
      data: {
        name: `Ses Katılımcısı ${index + 1}`,
        email: `voice-participant-${randomUUID()}@example.invalid`,
        password: "voice-participant-password-2026",
        ...(inviteToken
          ? { inviteToken }
          : { workspaceName: "Ses Test Ekibi" }),
      },
    });
    expect(registered.status()).toBe(200);
    if (index === 0) {
      const invitation = await page.request.post(`${origin}/api/invites`, {
        headers,
      });
      expect(invitation.status()).toBe(201);
      inviteToken = new URL((await invitation.json()).url).searchParams.get(
        "invite",
      )!;
      expect(inviteToken).toBeTruthy();
    }
    await page.goto("/");
    await expect(page.getByText("Her şey güncel", { exact: true })).toBeVisible();
  }
}

async function changeMicrophone(page: Page) {
  await page.getByRole("button", { name: "Ses ayarları", exact: true }).click();
  const select = page.getByRole("combobox", { name: "Mikrofon", exact: true });
  await expect
    .poll(() =>
      select
        .locator("option")
        .evaluateAll((options) =>
          options.some((option) =>
            Boolean((option as HTMLOptionElement).value),
          ),
        ),
    )
    .toBe(true);
  const deviceId = await select
    .locator("option")
    .evaluateAll((options) =>
      options
        .map((option) => (option as HTMLOptionElement).value)
        .find(Boolean)!,
    );
  await select.selectOption(deviceId);
}

for (const pending of ["camera", "screen", "audio"] as const) {
  test(`leaving a pending ${pending} request releases the next call's controls and ignores the old completion`, async ({
    page,
  }) => {
    await instrumentCapture(page);
    await page.goto("/");
    await expect(
      page.getByText("Her şey güncel", { exact: true }),
    ).toBeVisible();
    await joinCall(page);
    await page.evaluate((kind) => {
      window.__voiceRuntime.pauseNext = kind;
    }, pending);
    if (pending === "audio") await changeMicrophone(page);
    else
      await page
        .getByRole("button", {
          name: pending === "camera" ? "Kamerayı aç" : "Ekranı paylaş",
          exact: true,
        })
        .click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__voiceRuntime.requests.filter((request) => request.release)
              .length,
        ),
      )
      .toBe(1);
    await page
      .getByRole("button", { name: "Görüşmeden ayrıl", exact: true })
      .click();

    await joinCall(page);
    const camera = page.getByRole("button", {
      name: "Kamerayı aç",
      exact: true,
    });
    await expect(camera).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Ekranı paylaş", exact: true }),
    ).toBeEnabled();
    await page.evaluate(() => {
      window.__voiceRuntime.pauseNext = "camera";
    });
    await camera.click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__voiceRuntime.requests.filter((request) => request.release)
              .length,
        ),
      )
      .toBe(2);

    // A late picker from the previous call must release its new capture but must
    // not unlock the still-pending camera request belonging to this call.
    const oldRequest = await page.evaluate(() =>
      window.__voiceRuntime.requests.findIndex((request) =>
        Boolean(request.release),
      ),
    );
    await page.evaluate(
      (index) => window.__voiceRuntime.requests[index].release!(),
      oldRequest,
    );
    await expect
      .poll(() =>
        page.evaluate((index) => {
          const stream = window.__voiceRuntime.requests[index].stream;
          return Boolean(
            stream &&
            stream.getTracks().every((track) => track.readyState === "ended"),
          );
        }, oldRequest),
      )
      .toBe(true);
    await expect(camera).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Ekranı paylaş", exact: true }),
    ).toBeDisabled();

    await page.evaluate(() =>
      window.__voiceRuntime.requests.find((request) => request.release)!
        .release!(),
    );
    await expect(
      page.getByRole("button", { name: "Kamerayı kapat", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Ekranı paylaş", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Görüşmeden ayrıl", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.__voiceRuntime.tracks.every(
            (track) => track.readyState === "ended",
          ),
        ),
      )
      .toBe(true);
  });
}

test("muting during microphone replacement keeps the new sender silent", async ({
  browser,
}) => {
  const first = await browser.newContext({ permissions: ["microphone"] });
  const second = await browser.newContext({ permissions: ["microphone"] });
  try {
    const a = await first.newPage();
    const b = await second.newPage();
    await instrumentCapture(a);
    await instrumentCapture(b);
    await openCallParticipants([a, b]);
    await joinCall(a);
    await joinCall(b);
    await expect
      .poll(
        () =>
          a.evaluate(() =>
            window.__voiceRuntime.peers.some(
              (peer) => peer.connectionState === "connected",
            ),
          ),
        { timeout: 20_000 },
      )
      .toBe(true);
    await a.evaluate(() => {
      const replace = RTCRtpSender.prototype.replaceTrack;
      RTCRtpSender.prototype.replaceTrack = function (track) {
        const result = replace.call(this, track);
        if (track?.kind !== "audio") return result;
        return result.then(
          () =>
            new Promise<void>((resolve) => {
              window.__voiceReplace = { track, release: resolve };
            }),
        );
      };
    });
    await changeMicrophone(a);
    await expect
      .poll(() => a.evaluate(() => Boolean(window.__voiceReplace)))
      .toBe(true);
    await a
      .getByRole("button", { name: "Mikrofonu kapat", exact: true })
      .click();
    expect(await a.evaluate(() => window.__voiceReplace!.track.enabled)).toBe(
      false,
    );
    await a.evaluate(() => window.__voiceReplace!.release());
    await expect(
      a.getByRole("combobox", { name: "Mikrofon", exact: true }),
    ).toBeEnabled();
    expect(await a.evaluate(() => window.__voiceReplace!.track.enabled)).toBe(
      false,
    );
    await a.getByRole("button", { name: "Mikrofonu aç", exact: true }).click();
    expect(await a.evaluate(() => window.__voiceReplace!.track.enabled)).toBe(
      true,
    );
    for (const page of [a, b]) {
      await page
        .getByRole("button", { name: "Görüşmeden ayrıl", exact: true })
        .click();
      expect(
        await page.evaluate(() =>
          window.__voiceRuntime.tracks.every(
            (track) => track.readyState === "ended",
          ),
        ),
      ).toBe(true);
    }
  } finally {
    await first.close();
    await second.close();
  }
});

test("a disconnected microphone can be replaced in the active call and clears its resolved error", async ({
  page,
}) => {
  await instrumentCapture(page);
  await page.goto("/");
  await expect(page.getByText("Her şey güncel", { exact: true })).toBeVisible();
  await joinCall(page);
  await page.evaluate(() => {
    const track = window.__voiceRuntime.tracks.find(
      (track) => track.kind === "audio" && track.readyState === "live",
    )!;
    track.stop();
    track.dispatchEvent(new Event("ended"));
  });
  const warning = page.getByText(
    "Mikrofon bağlantısı kesildi. Ses ayarlarından başka bir mikrofon seçin.",
    { exact: true },
  );
  await expect(warning).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Mikrofonu aç", exact: true }),
  ).toBeVisible();
  await changeMicrophone(page);
  await expect(warning).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__voiceRuntime.tracks.filter(
            (track) => track.kind === "audio" && track.readyState === "live",
          ).length,
      ),
    )
    .toBe(1);
  // Replacing a device preserves the user's muted state until they unmute.
  await page.getByRole("button", { name: "Mikrofonu aç", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__voiceRuntime.tracks.some(
          (track) =>
            track.kind === "audio" &&
            track.readyState === "live" &&
            track.enabled,
        ),
      ),
    )
    .toBe(true);
  await page
    .getByRole("button", { name: "Görüşmeden ayrıl", exact: true })
    .click();
  expect(
    await page.evaluate(() =>
      window.__voiceRuntime.tracks.every(
        (track) => track.readyState === "ended",
      ),
    ),
  ).toBe(true);
});
