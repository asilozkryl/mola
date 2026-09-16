export type DesktopPlatform = "windows" | "macos" | "linux";
export type DesktopArchitecture = "x64" | "arm64";
export type DesktopFormat = "exe" | "dmg" | "zip" | "deb" | "AppImage";

export interface DesktopDownloadAsset {
  name: string;
  platform: DesktopPlatform;
  architecture: DesktopArchitecture;
  format: DesktopFormat;
  size: number;
  url: string;
  sha256?: string;
}

export interface DesktopReleaseCatalog {
  status: "ready" | "unpublished" | "unavailable";
  version: string | null;
  publishedAt: string | null;
  releaseUrl: string | null;
  checksumsUrl: string | null;
  assets: DesktopDownloadAsset[];
  stale: boolean;
}
