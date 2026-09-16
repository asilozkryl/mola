import type { Express } from "express";
import type {
  DesktopDownloadAsset,
  DesktopReleaseCatalog,
} from "../shared/desktop-downloads.js";

const repository = "asilozkryl/mola";
const releasesApi = `https://api.github.com/repos/${repository}/releases?per_page=100`;
const releaseBase = `https://github.com/${repository}/releases`;
const stableTag = /^desktop-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const cacheTtl = 10 * 60_000;
const retryTtl = 60_000;
const staleTtl = 24 * 60 * 60_000;

const emptyCatalog = (
  status: "unpublished" | "unavailable",
): DesktopReleaseCatalog => ({
  status,
  version: null,
  publishedAt: null,
  releaseUrl: null,
  checksumsUrl: null,
  assets: [],
  stale: false,
});
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** Only canonical, published installer assets in our own repository are links. */
export function parseDesktopReleases(value: unknown): DesktopReleaseCatalog {
  if (!Array.isArray(value)) throw new Error("Invalid release response");
  const releases = value
    .map(record)
    .filter(
      (release): release is Record<string, unknown> =>
        !!release &&
        release.draft === false &&
        release.prerelease === false &&
        typeof release.tag_name === "string" &&
        stableTag.test(release.tag_name) &&
        typeof release.published_at === "string" &&
        Number.isFinite(Date.parse(release.published_at)),
    )
    .sort(
      (a, b) =>
        Date.parse(b.published_at as string) -
        Date.parse(a.published_at as string),
    );

  for (const release of releases) {
    const tag = release.tag_name as string;
    const version = tag.slice("desktop-v".length);
    if (
      release.html_url !== `${releaseBase}/tag/${tag}` ||
      !Array.isArray(release.assets)
    )
      continue;
    const expected: Omit<DesktopDownloadAsset, "name" | "url" | "size">[] = [
      { platform: "linux", architecture: "x64", format: "deb" },
      { platform: "linux", architecture: "x64", format: "AppImage" },
      { platform: "windows", architecture: "x64", format: "exe" },
      { platform: "macos", architecture: "arm64", format: "dmg" },
      { platform: "macos", architecture: "arm64", format: "zip" },
      { platform: "macos", architecture: "x64", format: "dmg" },
      { platform: "macos", architecture: "x64", format: "zip" },
    ];
    const assets = release.assets.map(record).filter(Boolean);
    const validAsset = (name: string) => {
      const matches = assets.filter((asset) => asset!.name === name);
      if (matches.length !== 1) return null;
      const asset = matches[0]!;
      return asset.state === "uploaded" &&
        typeof asset.size === "number" &&
        Number.isSafeInteger(asset.size) &&
        asset.size > 0 &&
        asset.browser_download_url === `${releaseBase}/download/${tag}/${name}`
        ? asset
        : null;
    };
    const downloads: DesktopDownloadAsset[] = [];
    for (const target of expected) {
      const os = { linux: "linux", windows: "win", macos: "mac" }[
        target.platform
      ];
      const arch =
        target.platform === "linux"
          ? target.format === "deb"
            ? "amd64"
            : "x86_64"
          : target.architecture;
      const name = `Mola-${version}-${os}-${arch}.${target.format}`;
      const asset = validAsset(name);
      if (!asset) continue;
      downloads.push({
        ...target,
        name,
        url: asset.browser_download_url as string,
        size: asset.size as number,
        ...(typeof asset.digest === "string" &&
        /^sha256:[a-f0-9]{64}$/.test(asset.digest)
          ? { sha256: asset.digest.slice(7) }
          : {}),
      });
    }
    const checksums = validAsset("SHA256SUMS");
    // Publication is atomic at the workflow level; partial sets are never recommended.
    if (downloads.length !== expected.length || !checksums) continue;
    return {
      status: "ready",
      version,
      publishedAt: release.published_at as string,
      releaseUrl: release.html_url as string,
      checksumsUrl: checksums.browser_download_url as string,
      assets: downloads,
      stale: false,
    };
  }
  return emptyCatalog(releases.length ? "unavailable" : "unpublished");
}

/** One shared request per process; visitors cannot force an upstream refresh. */
export function createDesktopCatalogLoader({
  fetcher = fetch,
  now = Date.now,
}: { fetcher?: typeof fetch; now?: () => number } = {}) {
  let cached: DesktopReleaseCatalog | null = null;
  let expiresAt = 0;
  let lastReady: { value: DesktopReleaseCatalog; at: number } | null = null;
  let inFlight: Promise<DesktopReleaseCatalog> | null = null;
  return function load(): Promise<DesktopReleaseCatalog> {
    if (cached && now() < expiresAt) return Promise.resolve(cached);
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const response = await fetcher(releasesApi, {
          headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2026-03-10",
            "User-Agent": "Mola-Desktop-Downloads",
          },
          signal: AbortSignal.timeout(8_000),
          redirect: "error",
        });
        if (!response.ok) throw new Error("Release service unavailable");
        cached = parseDesktopReleases(await response.json());
        expiresAt = now() + (cached.status === "ready" ? cacheTtl : retryTtl);
        if (cached.status === "ready") lastReady = { value: cached, at: now() };
        else lastReady = null; // Removed releases must disappear, even during a later outage.
      } catch {
        cached =
          lastReady && now() - lastReady.at < staleTtl
            ? { ...lastReady.value, stale: true }
            : emptyCatalog("unavailable");
        expiresAt = now() + retryTtl;
      }
      return cached;
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}

export function installDesktopDownloads(
  app: Express,
  load = createDesktopCatalogLoader(),
) {
  app.get("/api/desktop/releases", async (_req, res) => {
    const catalog = await load();
    res.set("Cache-Control", "public, max-age=30");
    res.json(catalog);
  });
}
