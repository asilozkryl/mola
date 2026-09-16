import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import {
  createDesktopCatalogLoader,
  installDesktopDownloads,
  parseDesktopReleases,
} from "../server/desktop-downloads.js";
import {
  detectDownloadDevice,
  formatDownloadSize,
} from "../src/lib/desktop-platform.js";

const release = (version = "1.0.0", publishedAt = "2026-09-16T10:00:00Z") => {
  const tag = `desktop-v${version}`;
  return {
    draft: false,
    prerelease: false,
    tag_name: tag,
    published_at: publishedAt,
    html_url: `https://github.com/asilozkryl/mola/releases/tag/${tag}`,
    assets: [
      ...[
        "linux-amd64.deb",
        "linux-x86_64.AppImage",
        "win-x64.exe",
        "mac-x64.dmg",
        "mac-x64.zip",
        "mac-arm64.dmg",
        "mac-arm64.zip",
      ].map((suffix) => `Mola-${version}-${suffix}`),
      "SHA256SUMS",
    ].map((name) => ({
      name,
      state: "uploaded",
      size: 104_857_600,
      digest: `sha256:${"a".repeat(64)}`,
      browser_download_url: `https://github.com/asilozkryl/mola/releases/download/${tag}/${name}`,
    })),
  };
};
const response = (value: unknown) =>
  new Response(JSON.stringify(value), { status: 200 });

test("catalog selects the newest complete published desktop release, independent of latest marker", () => {
  const old = release("1.0.0", "2026-09-14T10:00:00Z");
  const current = release("1.1.0");
  const draft = { ...release("2.0.0"), draft: true };
  const preview = { ...release("3.0.0"), prerelease: true };
  const web = { ...release("4.0.0"), tag_name: "v4.0.0" };
  const result = parseDesktopReleases([old, draft, preview, web, current]);
  assert.equal(result.status, "ready");
  assert.equal(result.version, "1.1.0");
  assert.equal(result.assets.length, 7);
  assert.equal(
    result.assets.find((asset) => asset.format === "deb")?.architecture,
    "x64",
  );
  assert.equal(
    result.assets.find((asset) => asset.format === "AppImage")?.architecture,
    "x64",
  );
  assert.equal(
    result.assets.find((asset) => asset.architecture === "arm64")?.platform,
    "macos",
  );
  assert.equal(result.assets[0].sha256, "a".repeat(64));
  assert.match(result.checksumsUrl!, /desktop-v1\.1\.0\/SHA256SUMS$/);
});

test("catalog never invents installer links for tags, drafts, missing or mismatched assets", () => {
  assert.equal(parseDesktopReleases([]).status, "unpublished");
  assert.equal(
    parseDesktopReleases([{ ...release(), draft: true }]).status,
    "unpublished",
  );
  for (const mutate of [
    (item: ReturnType<typeof release>) => {
      item.assets.pop();
    },
    (item: ReturnType<typeof release>) => {
      item.assets[0].name = "Mola-0.9.0-linux-amd64.deb";
    },
    (item: ReturnType<typeof release>) => {
      item.assets[0].state = "new";
    },
    (item: ReturnType<typeof release>) => {
      item.assets[0].size = 0;
    },
    (item: ReturnType<typeof release>) => {
      item.assets.push(item.assets[0]);
    },
    (item: ReturnType<typeof release>) => {
      item.html_url =
        "https://github.com/outsider/mola/releases/tag/desktop-v1.0.0";
    },
  ]) {
    const item = release();
    mutate(item);
    assert.equal(parseDesktopReleases([item]).status, "unavailable");
    assert.deepEqual(parseDesktopReleases([item]).assets, []);
  }
  assert.throws(() => parseDesktopReleases({ message: "upstream error" }));
});

test("catalog rejects hostile URLs, credentials, redirects and similarly named repositories", () => {
  for (const url of [
    "javascript:alert(1)",
    "https://github.com.evil.test/asilozkryl/mola/releases/download/desktop-v1.0.0/Mola-1.0.0-linux-amd64.deb",
    "https://github.com@evil.test/asilozkryl/mola/releases/download/desktop-v1.0.0/Mola-1.0.0-linux-amd64.deb",
    "https://github.com/outsider/mola/releases/download/desktop-v1.0.0/Mola-1.0.0-linux-amd64.deb",
    "https://github.com/asilozkryl/mola/releases/download/desktop-v1.0.0/Mola-1.0.0-linux-amd64.deb?redirect=evil",
    "http://github.com/asilozkryl/mola/releases/download/desktop-v1.0.0/Mola-1.0.0-linux-amd64.deb",
  ]) {
    const item = release();
    item.assets[0].browser_download_url = url;
    assert.equal(parseDesktopReleases([item]).status, "unavailable", url);
  }
});

test("an incomplete new upload keeps the previous complete stable release available", () => {
  const incomplete = release("1.1.0");
  incomplete.assets.pop();
  assert.equal(
    parseDesktopReleases([incomplete, release("1.0.0", "2026-09-15T10:00:00Z")])
      .version,
    "1.0.0",
  );
});

test("catalog shares concurrent requests and caches success for ten minutes", async () => {
  let time = 0;
  let calls = 0;
  let resolveFetch!: (value: Response) => void;
  const load = createDesktopCatalogLoader({
    now: () => time,
    fetcher: async (url, options) => {
      assert.equal(
        String(url),
        "https://api.github.com/repos/asilozkryl/mola/releases?per_page=100",
      );
      assert.equal(options?.redirect, "error");
      calls++;
      if (calls > 1) return response([release()]);
      return new Promise<Response>((done) => {
        resolveFetch = done;
      });
    },
  });
  const a = load();
  const b = load();
  assert.equal(a, b);
  resolveFetch(response([release()]));
  assert.equal((await a).status, "ready");
  await load();
  assert.equal(calls, 1);
  time = 600_001;
  await load();
  assert.equal(calls, 2);
});

test("catalog retries negative results once per minute and bounds stale fallback", async () => {
  let time = 0;
  let calls = 0;
  let mode: "empty" | "ready" | "error" = "empty";
  const load = createDesktopCatalogLoader({
    now: () => time,
    fetcher: async () => {
      calls++;
      if (mode === "error") throw new Error("offline");
      return response(mode === "ready" ? [release()] : []);
    },
  });
  assert.equal((await load()).status, "unpublished");
  time = 59_000;
  await load();
  assert.equal(calls, 1);
  time = 60_001;
  mode = "ready";
  assert.equal((await load()).status, "ready");
  time += 600_001;
  mode = "error";
  const stale = await load();
  assert.equal(stale.status, "ready");
  assert.equal(stale.stale, true);
  time += 24 * 60 * 60_000;
  assert.equal((await load()).status, "unavailable");
});

test("removed releases are not revived by a subsequent network failure", async () => {
  let time = 0;
  let calls = 0;
  const load = createDesktopCatalogLoader({
    now: () => time,
    fetcher: async () => {
      calls++;
      if (calls === 1) return response([release()]);
      if (calls === 2) return response([]);
      return new Response("", { status: 403 });
    },
  });
  assert.equal((await load()).status, "ready");
  time += 600_001;
  assert.equal((await load()).status, "unpublished");
  time += 60_001;
  assert.equal((await load()).status, "unavailable");
});

test("download catalog route is public and does not require a user session", async () => {
  const app = express();
  installDesktopDownloads(app, async () => parseDesktopReleases([release()]));
  app.use((_req, res) => {
    res.sendStatus(401);
  });
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((done) => server.once("listening", done));
    const result = await fetch(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/desktop/releases`,
    );
    assert.equal(result.status, 200);
    assert.match(result.headers.get("cache-control")!, /public/);
    assert.equal((await result.json()).assets.length, 7);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
});

test("device detection distinguishes native desktop, mobile shells, iPad, ChromeOS and CPU gaps", () => {
  const cases = [
    [
      { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/150.0" },
      "windows",
      "x64",
      false,
    ],
    [
      {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Electron/44.3.0",
      },
      "windows",
      "x64",
      true,
    ],
    [
      { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
      "macos",
      "unknown",
      false,
    ],
    [{ userAgent: "Mozilla/5.0 (X11; Linux x86_64)" }, "linux", "x64", false],
    [
      { userAgent: "Mozilla/5.0 (X11; Linux aarch64)" },
      "linux",
      "arm64",
      false,
    ],
    [
      { userAgent: "Mozilla/5.0 (X11; Linux i686)" },
      "linux",
      "unsupported",
      false,
    ],
    [
      { userAgent: "Mozilla/5.0 (Linux; Android 16) Chrome/150.0" },
      "android",
      "unknown",
      false,
    ],
    [{ userAgent: "MolaMobile/1.0 Android" }, "android", "unknown", false],
    [{ userAgent: "MolaMobile/1.0 iOS" }, "ios", "unknown", false],
    [
      { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X)" },
      "ios",
      "unknown",
      false,
    ],
    [
      {
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        platform: "MacIntel",
        maxTouchPoints: 5,
      },
      "ios",
      "unknown",
      false,
    ],
    [
      { userAgent: "Mozilla/5.0 (X11; CrOS x86_64 16442.0.0)" },
      "chromeos",
      "unknown",
      false,
    ],
    [
      { userAgent: "", userAgentData: { platform: "Android", mobile: true } },
      "android",
      "unknown",
      false,
    ],
    [{ userAgent: "custom" }, "unknown", "unknown", false],
  ] as const;
  for (const [input, platform, architecture, nativeDesktop] of cases)
    assert.deepEqual(
      detectDownloadDevice(input),
      { platform, architecture, nativeDesktop },
      input.userAgent,
    );
  assert.equal(formatDownloadSize(104_857_600), "100 MB");
});
