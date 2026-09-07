import { useEffect, useState } from "react";
import { Bell, BellOff, Check, Download, Smartphone } from "lucide-react";
import { api } from "../lib/api";
import {
  loadPushPreferences,
  pushContextHeaders,
  savePushSubscription,
  type PushPreferences,
} from "../lib/pushSubscription";
import {
  applicationKey,
  canInstallPwa,
  installedPwa,
  installPwa,
  pwaRegistration,
  supportsPush,
} from "../lib/pwa";
import { Modal } from "./ui";
import "./notification-settings.css";

const permission = () =>
  "Notification" in window ? Notification.permission : "denied";

export function NotificationSettings({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [preferences, setPreferences] = useState<PushPreferences | null>(null);
  const [registered, setRegistered] = useState(false);
  const [browserPermission, setBrowserPermission] = useState(permission);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [installAvailable, setInstallAvailable] = useState(canInstallPwa);
  const [installed, setInstalled] = useState(installedPwa);
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const next = await loadPushPreferences(userId, controller.signal);
        if (!active || next.userId !== userId) return;
        setPreferences(next);
        if (!supportsPush() || permission() !== "granted") return;
        const service = await pwaRegistration();
        const subscription = await service.pushManager.getSubscription();
        if (!active || !subscription || !next.pushEnabled) return;
        // Rebind an already permitted browser subscription to this authenticated
        // session. A fresh subscription always requires the explicit button.
        await savePushSubscription(subscription, next, { signal: controller.signal, restore: true });
        if (active) setRegistered(true);
      } catch (err) {
        if (active)
          setError(
            err instanceof Error
              ? err.message
              : "Bildirim ayarları yüklenemedi.",
          );
      }
    })();
    const refresh = () => {
      setBrowserPermission(permission());
      setInstallAvailable(canInstallPwa());
      setInstalled(installedPwa());
    };
    window.addEventListener("mola:install-state", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      controller.abort();
      window.removeEventListener("mola:install-state", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [userId]);
  const enable = async () => {
    if (!preferences || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    let created: PushSubscription | null = null;
    try {
      // Request directly from the click, before any registration/network await.
      const allowed = await Notification.requestPermission();
      setBrowserPermission(allowed);
      if (allowed !== "granted")
        throw new Error(
          allowed === "denied"
            ? "Bildirim izni kapalı. Tarayıcının site ayarlarından Mola için bildirimlere izin verin."
            : "İzin verilmedi. İstediğiniz zaman yeniden açabilirsiniz.",
        );
      const service = await pwaRegistration();
      const existing = await service.pushManager.getSubscription();
      const subscription =
        existing ??
        (created = await service.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationKey(preferences.publicKey),
        }));
      await savePushSubscription(subscription, preferences);
      await api("/notifications/preferences", {
        method: "PATCH",
        headers: pushContextHeaders(preferences),
        body: JSON.stringify({ pushEnabled: true }),
      });
      setPreferences({ ...preferences, pushEnabled: true });
      setRegistered(true);
      setNotice("Bildirimler bu cihazda açık.");
    } catch (err) {
      if (created) {
        await api("/notifications/subscriptions", {
          method: "DELETE",
          headers: pushContextHeaders(preferences),
          body: JSON.stringify({ endpoint: created.endpoint }),
        }).catch(() => {});
        // The origin-wide browser subscription may already belong to a newer
        // login. Only remove our session-bound server record on failure.
      }
      setError(
        err instanceof Error
          ? err.message
          : "Bildirimler açılamadı. Yeniden deneyin.",
      );
    } finally {
      setBusy(false);
    }
  };
  const disable = async () => {
    if (!preferences || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/notifications/preferences", {
        method: "PATCH",
        headers: pushContextHeaders(preferences),
        body: JSON.stringify({ pushEnabled: false }),
      });
      setPreferences({ ...preferences, pushEnabled: false });
      setRegistered(false);
      if (supportsPush()) {
        const service = await pwaRegistration();
        const subscription = await service.pushManager.getSubscription();
        if (subscription) {
          await api("/notifications/subscriptions", {
            method: "DELETE",
            headers: pushContextHeaders(preferences),
            body: JSON.stringify({ endpoint: subscription.endpoint }),
          });
          // Retain browser consent. Unsubscribing here could revoke an endpoint
          // that another tab has rebound to a newer authenticated session.
        }
      }
      setNotice("Hesabının tarayıcı bildirimleri tüm cihazlarda kapatıldı.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Bildirim ayarı tamamlanamadı. Yeniden deneyin.",
      );
    } finally {
      setBusy(false);
    }
  };
  const enabledHere = Boolean(
    preferences?.pushEnabled && registered && browserPermission === "granted",
  );
  return (
    <Modal
      title="Bildirimler ve uygulama"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="notification-settings">
        <section aria-labelledby="push-heading">
          <div className="notification-section-heading">
            <span>
              {enabledHere ? <Bell size={22} /> : <BellOff size={22} />}
            </span>
            <div>
              <h3 id="push-heading">Bir mesajı kaçırma</h3>
              <p>Bahsetmeler, direkt mesajlar ve yanıtlar için bildirim al.</p>
            </div>
          </div>
          <div
            className={`notification-device-state ${enabledHere ? "is-enabled" : ""}`}
          >
            {enabledHere ? <Check size={15} /> : <BellOff size={15} />}
            <span>
              {!preferences
                ? "Ayarların yükleniyor…"
                : enabledHere
                  ? "Bu cihazda bildirimler açık"
                  : "Bu cihazda bildirimler kapalı"}
            </span>
          </div>
          {!supportsPush() && (
            <p className="notification-help">
              Bu tarayıcı bildirimleri desteklemiyor.{" "}
              {ios && !installed
                ? "Safari'de Mola'yı ana ekranına ekleyip uygulamadan açmayı deneyebilirsin."
                : "Güncel bir tarayıcı ve güvenli bağlantı kullanabilirsin."}
            </p>
          )}
          {browserPermission === "denied" && supportsPush() && (
            <p className="notification-help">
              Bildirim izni engellenmiş. Tarayıcının site ayarlarından Mola için
              bildirimleri açabilirsin.
            </p>
          )}
          <div className="notification-actions">
            {!enabledHere && (
              <button
                type="button"
                className="notification-primary"
                disabled={busy || !preferences || !supportsPush()}
                onClick={() => void enable()}
              >
                <Bell size={16} />
                {busy ? "Ayarlanıyor…" : "Bu cihazda bildirimleri aç"}
              </button>
            )}
            {preferences?.pushEnabled && (
              <button
                type="button"
                className="notification-secondary"
                disabled={busy}
                onClick={() => void disable()}
              >
                {busy ? "Ayarlanıyor…" : "Tüm cihazlarda kapat"}
              </button>
            )}
          </div>
          <p className="notification-help">
            Bildirimlerde mesaj içeriği gösterilmez. İzin her cihazda ayrıca
            verilir; sohbet içindeki okunmamış işaretleri her zaman çalışır.
          </p>
        </section>
        <section aria-labelledby="install-heading">
          <div className="notification-section-heading">
            <span>
              <Smartphone size={22} />
            </span>
            <div>
              <h3 id="install-heading">Mola hep elinin altında</h3>
              <p>Uygulamayı ana ekranından veya masaüstünden aç.</p>
            </div>
          </div>
          {installed ? (
            <p className="notification-installed">
              <Check size={16} />
              Mola uygulama olarak açık.
            </p>
          ) : installAvailable ? (
            <button
              type="button"
              className="notification-secondary"
              disabled={busy}
              onClick={() => {
                setError("");
                void installPwa()
                  .then((accepted) => {
                    setInstallAvailable(canInstallPwa());
                    if (accepted) {
                      setInstalled(true);
                      setNotice("Mola cihazına eklendi.");
                    }
                  })
                  .catch(() =>
                    setError(
                      "Yükleme açılamadı. Tarayıcının uygulama yükleme menüsünü kullanabilirsin.",
                    ),
                  );
              }}
            >
              <Download size={16} />
              Mola'yı yükle
            </button>
          ) : (
            <p className="notification-help">
              {ios
                ? "Safari'de Paylaş menüsünü aç, Ana Ekrana Ekle'yi seç ve Ekle'ye dokun."
                : "Tarayıcının adres çubuğundaki yükleme simgesini veya menüsündeki uygulama yükleme seçeneğini kullanabilirsin. Bu seçenek görünmüyorsa siteyi yer imlerine ekleyebilirsin."}
            </p>
          )}
          <p className="notification-help">
            İnternet kesildiğinde bağlantı ekranı görünür; özel sohbetlerin
            çevrimdışı kopyası tutulmaz.
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
