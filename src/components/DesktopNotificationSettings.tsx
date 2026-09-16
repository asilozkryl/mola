import { useEffect, useRef, useState } from "react";
import { Bell, BellOff, Check, RefreshCw, Send, Volume2 } from "lucide-react";
import { Button } from "./ui/button";
import { Modal } from "./ui";
import { NotificationPreferencesPanel } from "./NotificationPreferencesPanel";
import type { NotificationSettingsProps } from "./NotificationSettings";
import {
  desktopNotificationsSupported,
  readDesktopNotificationPreferences,
  saveDesktopNotificationPreferences,
  showDesktopNotification,
} from "../lib/desktopNotifications";
import { playMolaNotificationSound } from "../lib/notificationSound";

export function DesktopNotificationSettings(props: NotificationSettingsProps) {
  const {
    userId,
    workspaceId,
    quiet = false,
    onResumeNotifications,
    onClose,
  } = props;
  const desktopVersion = navigator.userAgent.match(/(?:^|\s)MolaDesktop\/(\d+\.\d+\.\d+)(?:\s|$)/)?.[1];
  const [preferences, setPreferences] = useState(() =>
    readDesktopNotificationPreferences(userId),
  );
  const [permission, setPermission] = useState(() =>
    "Notification" in window ? Notification.permission : "default",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const alive = useRef(true);
  const operation = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const refresh = () => {
      setPreferences(readDesktopNotificationPreferences(userId));
      setPermission(
        "Notification" in window ? Notification.permission : "default",
      );
    };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("mola:desktop-notification-preferences", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener(
        "mola:desktop-notification-preferences",
        refresh,
      );
    };
  }, [userId]);
  const supported = desktopNotificationsSupported();
  const enabled = preferences.enabled && permission === "granted";
  const paused = enabled && quiet;
  const state = !supported
    ? "unsupported"
    : paused
      ? "paused"
      : enabled
        ? "enabled"
        : "disabled";
  async function run(action: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (reason) {
      if (alive.current)
        setError(
          reason instanceof Error ? reason.message : "İşlem tamamlanamadı.",
        );
    } finally {
      operation.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function save(value: typeof preferences) {
    saveDesktopNotificationPreferences(userId, value);
    if (alive.current) setPreferences(value);
  }
  return (
    <Modal
      title="Bildirimler ve uygulama"
      onClose={() => {
        if (!operation.current) onClose();
      }}
    >
      <div className="notification-settings" aria-busy={busy}>
        <NotificationPreferencesPanel {...props} />
        <section aria-labelledby="desktop-notifications-heading">
          <div className="notification-section-heading">
            <span>
              <Bell size={20} />
            </span>
            <div>
              <h3 id="desktop-notifications-heading">Masaüstü bildirimleri</h3>
              <p>Ekibinden gelen mesajları bu bilgisayarda takip et.</p>
            </div>
          </div>
          <div
            className={`notification-device-state ${state === "enabled" ? "is-enabled" : ""}`}
            data-state={state}
            role="status"
          >
            {state === "enabled" ? <Check size={17} /> : <BellOff size={17} />}
            <div>
              <strong>
                {!supported
                  ? "Bu sistemde bildirimler kullanılamıyor"
                  : paused
                    ? "Bildirimler bu cihazda duraklatıldı"
                    : enabled
                      ? "Bu cihazda bildirimler açık"
                      : "Bu cihazda bildirimler kapalı"}
              </strong>
              <p>
                {paused
                  ? "Sessiz mod açık. Gelen mesajlar için bildirim ve ses gönderilmiyor."
                  : enabled
                    ? "Kanal tercihlerin ve sessiz saatlerin uygulanır."
                    : "Aç düğmesiyle Mola için bildirim izni verebilirsin."}
              </p>
            </div>
          </div>
          <div className="notification-actions">
            {!enabled ? (
              <Button
                variant="unstyled"
                size="unset"
                className="notification-primary"
                disabled={busy || !supported}
                onClick={() =>
                  void run(async () => {
                    // Electron initially reports denied even before a first request. The
                    // explicit button must still invoke its native permission handler.
                    const result =
                      Notification.permission === "granted"
                        ? "granted"
                        : await Notification.requestPermission();
                    if (!alive.current) return;
                    setPermission(result);
                    if (result !== "granted")
                      throw new Error(
                        "İzin verilmedi. Yeniden deneyebilir veya sistem bildirim ayarlarında Mola için izinleri kontrol edebilirsin.",
                      );
                    save({
                      ...readDesktopNotificationPreferences(userId),
                      enabled: true,
                    });
                    setNotice(
                      quiet
                        ? "Bildirim izni verildi. Mesaj bildirimleri sessiz mod nedeniyle duraklatıldı."
                        : "Bildirimler bu cihazda açıldı. Test bildirimiyle kontrol edebilirsin.",
                    );
                  })
                }
              >
                <Bell size={15} /> Bu cihazda bildirimleri aç
              </Button>
            ) : (
              <>
                {paused && onResumeNotifications && (
                  <Button
                    variant="unstyled"
                    size="unset"
                    className="notification-primary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        onResumeNotifications();
                        setNotice(
                          "Bu cihazdaki sessiz mod kapatıldı. Kanal tercihlerin ve sessiz saatlerin uygulanmaya devam eder.",
                        );
                      })
                    }
                  >
                    <Bell size={15} /> Bildirimleri sürdür
                  </Button>
                )}
                <Button
                  variant="unstyled"
                  size="unset"
                  className={paused ? "notification-secondary" : "notification-primary"}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const sent = await showDesktopNotification(
                        userId,
                        { workspaceId },
                        { test: true, current: () => alive.current },
                      );
                      if (alive.current) {
                        if (!sent)
                          throw new Error(
                            "Bildirim izni değişmiş. Durumu yenileyip yeniden açabilirsin.",
                          );
                        setNotice(
                          "Test bildirimi sistemine gönderildi. Görünmüyorsa Mola için bildirim iznini ve Odak / Rahatsız Etme ayarını kontrol et.",
                        );
                      }
                    })
                  }
                >
                  <Send size={15} /> Test bildirimi gönder
                </Button>
                <Button
                  variant="unstyled"
                  size="unset"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      save({ ...preferences, enabled: false });
                      setNotice(
                        "Yalnızca bu hesaba ait bu bilgisayardaki bildirimler kapatıldı.",
                      );
                    })
                  }
                >
                  Bu cihazda kapat
                </Button>
              </>
            )}
            <Button
              variant="unstyled"
              size="unset"
              disabled={busy}
              onClick={() => {
                setPermission(
                  "Notification" in window
                    ? Notification.permission
                    : "default",
                );
                setError("");
              }}
            >
              <RefreshCw size={15} /> Durumu yenile
            </Button>
          </div>
          <p className="notification-desktop-help">
            Test bildirimi, mesaj filtrelerini ve sessiz modu atlar.
          </p>
          <p className="notification-desktop-help">
            Bildirim gelmiyorsa sisteminin Bildirimler bölümünde Mola'ya izin
            ver. macOS'ta Sistem Ayarları → Bildirimler → Mola yolunu kullan.
          </p>
        </section>
        <section aria-labelledby="notification-sound-heading">
          <div className="notification-section-heading">
            <span>
              <Volume2 size={20} />
            </span>
            <div>
              <h3 id="notification-sound-heading">Mola sesi</h3>
              <p>
                Kısa, yumuşak iki ton. Mesajını haber verir, odağını bölmez.
              </p>
            </div>
          </div>
          <div className="notification-sound-controls">
            <label>
              <input
                type="checkbox"
                checked={preferences.sound}
                disabled={busy}
                onChange={(event) => {
                  try {
                    save({ ...preferences, sound: event.target.checked });
                    setError("");
                  } catch (reason) {
                    setError(
                      reason instanceof Error
                        ? reason.message
                        : "Tercih kaydedilemedi.",
                    );
                  }
                }}
              />{" "}
              Mola bildirim sesi
            </label>
            <Button
              variant="unstyled"
              size="unset"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await playMolaNotificationSound();
                })
              }
            >
              <Volume2 size={15} /> Sesi dinle
            </Button>
          </div>
          <p className="notification-desktop-help">
            Bu tercih yalnızca bu bilgisayardaki hesabın için geçerlidir.
            Pencere açık veya küçültülmüş olmalı; Mola'dan çıkınca bildirim ve
            ses gelmez.
          </p>
        </section>
        <section aria-labelledby="desktop-updates-heading">
          <div className="notification-section-heading">
            <span><RefreshCw size={20} /></span>
            <div>
              <h3 id="desktop-updates-heading">Uygulama güncellemeleri</h3>
              <p>{desktopVersion ? `Yüklü sürüm: ${desktopVersion}` : "Mola’nın yeni masaüstü sürümlerini takip et."}</p>
            </div>
          </div>
          <div className="notification-actions">
            {desktopVersion ? (
              <Button variant="unstyled" size="unset" className="notification-primary"
                onClick={() => window.open("mola-desktop://app/updates", "_blank")}>
                <RefreshCw size={15} /> Güncellemeleri kontrol et
              </Button>
            ) : (
              <a href="/download" className="notification-primary">Yeni masaüstü sürümünü indir</a>
            )}
          </div>
          <p className="notification-desktop-help">
            {desktopVersion
              ? "Yeni sürümler otomatik kontrol edilir. İndirme ve kurulum sen başlattığında yapılır."
              : "Uygulama içinden güncelleme özelliği için Mola’yı bir kez yeni kurulum dosyasıyla güncelle."}
          </p>
        </section>
        {error && (
          <p className="notification-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="notification-success" role="status">
            {notice}
          </p>
        )}
      </div>
    </Modal>
  );
}
