import type {
  DesktopArchitecture,
  DesktopPlatform,
} from "../../shared/desktop-downloads";

export interface DownloadDevice {
  platform: DesktopPlatform | "android" | "ios" | "chromeos" | "unknown";
  architecture: DesktopArchitecture | "unsupported" | "unknown";
  nativeDesktop: boolean;
}

export function detectDownloadDevice({
  userAgent = "",
  platform = "",
  maxTouchPoints = 0,
  userAgentData,
}: {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  userAgentData?: { platform?: string; mobile?: boolean };
}): DownloadDevice {
  const ua = userAgent.toLowerCase();
  const devicePlatform =
    `${userAgentData?.platform || ""} ${platform}`.toLowerCase();
  const nativeDesktop = /electron\//.test(ua);
  const make = (
    detected: DownloadDevice["platform"],
    architecture: DownloadDevice["architecture"] = "unknown",
  ): DownloadDevice => ({ platform: detected, architecture, nativeDesktop });
  if (/android/.test(ua) || /android/.test(devicePlatform))
    return make("android");
  if (
    /iphone|ipad|ipod|molamobile\/[^ ]+ ios/.test(ua) ||
    (/mac/.test(devicePlatform + ua) && maxTouchPoints > 1)
  )
    return make("ios");
  if (/cros/.test(ua) || /chrome os/.test(devicePlatform))
    return make("chromeos");
  if (/windows|win32|win64/.test(devicePlatform + ua))
    return make(
      "windows",
      /arm|aarch64/.test(ua)
        ? "arm64"
        : /win64|wow64|x64|amd64/.test(ua)
          ? "x64"
          : "unknown",
    );
  // Modern browsers can report Intel for Apple Silicon; ask the user to choose.
  if (/mac/.test(devicePlatform + ua)) return make("macos");
  if (/linux/.test(devicePlatform + ua))
    return make(
      "linux",
      /arm|aarch64/.test(devicePlatform + ua)
        ? "arm64"
        : /x86_64|x64|amd64/.test(devicePlatform + ua)
          ? "x64"
          : /i[3-6]86/.test(devicePlatform + ua)
            ? "unsupported"
            : "unknown",
    );
  return make("unknown");
}

export function formatDownloadSize(bytes: number): string {
  return `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} MB`;
}
