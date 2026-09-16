import { test, expect, type Page } from "@playwright/test";
import { parseDesktopReleases } from "../server/desktop-downloads.js";

const tag = "desktop-v1.0.0";
const ready = parseDesktopReleases([
  {
    draft: false,
    prerelease: false,
    tag_name: tag,
    published_at: "2026-09-16T10:00:00Z",
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
      ].map((suffix) => `Mola-1.0.0-${suffix}`),
      "SHA256SUMS",
    ].map((name) => ({
      name,
      state: "uploaded",
      size: 104_857_600,
      browser_download_url: `https://github.com/asilozkryl/mola/releases/download/${tag}/${name}`,
    })),
  },
]);

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

test("public download page detects Linux and switches between actual DEB and AppImage links", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (X11; Linux x86_64) Chrome/150.0",
    });
    Object.defineProperty(navigator, "platform", { value: "Linux x86_64" });
    Object.defineProperty(navigator, "userAgentData", { value: undefined });
  });
  await page.route("**/api/desktop/releases", (route) =>
    route.fulfill({ json: ready }),
  );
  await page.goto("/download");
  await expect(page).toHaveURL(/\/download$/);
  await expect(
    page.getByRole("heading", { name: "Ekibin, masaüstünde." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Linux 64 bit/ }),
  ).toHaveAttribute("aria-pressed", "true");
  const download = page.getByRole("link", { name: /Linux için indir/ });
  await expect(download).toHaveAttribute(
    "href",
    /Mola-1\.0\.0-linux-amd64\.deb$/,
  );
  await expect(download).toHaveAttribute("rel", "noopener noreferrer");
  await page
    .getByRole("button", { name: "AppImage Diğer uyumlu dağıtımlar" })
    .click();
  await expect(download).toHaveAttribute(
    "href",
    /Mola-1\.0\.0-linux-x86_64\.AppImage$/,
  );
  await expect(
    page.getByText(/AppImage, FUSE 2 desteği gerektirir/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sunucu adresini kopyala" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /Sunucu adresi kopyalandı|Adres seçildi/ }),
  ).toBeVisible();
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Mac requires an explicit processor choice instead of trusting the Intel user agent", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    });
    Object.defineProperty(navigator, "platform", { value: "MacIntel" });
    Object.defineProperty(navigator, "maxTouchPoints", { value: 0 });
    Object.defineProperty(navigator, "userAgentData", { value: undefined });
  });
  await page.route("**/api/desktop/releases", (route) =>
    route.fulfill({ json: ready }),
  );
  await page.goto("/download");
  await expect(
    page.getByRole("link", { name: /macOS için indir/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: /Mac işlemcini seç/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Apple Silicon M1/ }).click();
  await expect(
    page.getByRole("link", { name: /macOS için indir/ }),
  ).toHaveAttribute("href", /mac-arm64\.dmg$/);
  await expect(
    page.getByRole("link", { name: /ZIP olarak indir/ }),
  ).toHaveAttribute("href", /mac-arm64\.zip$/);
  await page.getByRole("button", { name: "Intel Intel işlemcili Mac" }).click();
  await expect(
    page.getByRole("link", { name: /macOS için indir/ }),
  ).toHaveAttribute("href", /mac-x64\.dmg$/);
  await expect(
    page.getByText(/henüz Developer ID ile imzalanmış/),
  ).toBeVisible();
});

test("mobile download page identifies Android, avoids Linux recommendation and fits 320px", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (Linux; Android 16) Chrome/150.0",
    });
    Object.defineProperty(navigator, "platform", { value: "Linux armv8l" });
    Object.defineProperty(navigator, "userAgentData", { value: undefined });
  });
  await page.route("**/api/desktop/releases", (route) =>
    route.fulfill({ json: ready }),
  );
  await page.goto("/download");
  await expect(page.getByText("Şu anda mobil cihazdasın")).toBeVisible();
  await expect(
    page.getByText("Bu cihazda algılandı", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: /için indir/ })).toHaveCount(0);
  await page.getByRole("button", { name: /Windows 64 bit/ }).click();
  await expect(
    page.getByRole("link", { name: /Windows için indir/ }),
  ).toHaveAttribute("href", /win-x64\.exe$/);
  const overflow = await page.evaluate(() => {
    const frame = document.querySelector(".desktop-download-page")!;
    return (
      frame.scrollWidth > frame.clientWidth ||
      document.documentElement.scrollWidth > innerWidth
    );
  });
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});

test("unpublished or temporarily unavailable releases never expose fabricated installer links and can retry", async ({
  page,
}) => {
  let status: "unpublished" | "unavailable" | "ready" = "unpublished";
  await page.route("**/api/desktop/releases", (route) =>
    route.fulfill({
      json:
        status === "ready" ? ready : { ...parseDesktopReleases([]), status },
    }),
  );
  await page.goto("/download");
  await page.getByRole("button", { name: /Windows 64 bit/ }).click();
  await expect(
    page.getByText("Kurulum paketleri henüz yayımlanmadı"),
  ).toBeVisible();
  await expect(page.locator('a[href*="releases/download/"]')).toHaveCount(0);
  status = "unavailable";
  await page.getByRole("button", { name: "Yeniden kontrol et" }).click();
  await expect(
    page.getByText("İndirme bilgilerine şu anda ulaşılamıyor"),
  ).toBeVisible();
  await expect(page.locator('a[href*="releases/download/"]')).toHaveCount(0);
  status = "ready";
  await page.getByRole("button", { name: "Yeniden kontrol et" }).click();
  await expect(
    page.getByRole("link", { name: /Windows için indir/ }),
  ).toHaveAttribute("href", /win-x64\.exe$/);
});
