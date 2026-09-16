export const legacyDesktopUpdateNote =
  "Bu eski sürümde uygulama içinden güncelleme yok. Güncelleme sistemini eklemek için Mola’yı bir kez yeni kurulum dosyasıyla kur. Sonraki güncellemeleri uygulamadan başlatabilirsin.";
export const macDesktopBootstrapNote =
  "Bu sürüm güncellemeyi uygulamadan indirir. İlk geçişte Mola’yı Uygulamalar klasörüne sürüklemen gerekir. 1.0.8 kurulduktan sonraki güncellemeler ve yeniden açılma uygulamadan tamamlanır.";

export function getDesktopUpdateCapability(
  userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
) {
  const nativeDesktop = /Electron\//i.test(userAgent);
  // The marker is supplied by clients that can open the packaged updater.
  // It advertises the entry point; the native main process validates requests.
  const version = userAgent.match(
    /(?:^|\s)MolaDesktop\/(\d+\.\d+\.\d+)(?:\s|$)/,
  )?.[1];
  const canUpdate = nativeDesktop && !!version;
  const [major, minor, patch] = version?.split(".").map(Number) || [];
  const needsMacInstallerStep = canUpdate && /Macintosh|Mac OS X/i.test(userAgent) &&
    (major < 1 || (major === 1 && minor === 0 && patch < 8));
  return { nativeDesktop, version, canUpdate, needsMacInstallerStep };
}

export function openDesktopUpdates() {
  if (getDesktopUpdateCapability().canUpdate)
    window.open("mola-desktop://app/updates", "_blank");
}
