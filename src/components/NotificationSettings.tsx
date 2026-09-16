import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";
import {
  Bell,
  BellOff,
  Check,
  Download,
  Monitor,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { api } from "../lib/api";
import type { Channel, User } from "../../shared/types";
import type { PushDiagnostic } from "../../shared/notification-types";
import {
  loadPushPreferences,
  pushConfigured,
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
import { NotificationPreferencesPanel } from "./NotificationPreferencesPanel";
import "./notification-settings.css";
import { isDesktopRuntime } from "../lib/desktopNotifications";
import { DesktopNotificationSettings } from "./DesktopNotificationSettings";

const permission = () =>
  "Notification" in window ? Notification.permission : "default";
type Operation = "enable" | "disable" | "test" | "install";

export interface NotificationSettingsProps {
  userId: string;
  workspaceId: string;
  workspaceName: string;
  channels: readonly Channel[];
  members: readonly User[];
  revision?: number;
  onClose: () => void;
}

export function NotificationSettings(props: NotificationSettingsProps) {
  return isDesktopRuntime() ? (
    <DesktopNotificationSettings
      key={`${props.userId}:${props.workspaceId}`}
      {...props}
    />
  ) : (
    <BrowserNotificationSettings {...props} />
  );
}

function BrowserNotificationSettings({
  userId,
  workspaceId,
  workspaceName,
  channels,
  members,
  revision: settingsRevision = 0,
  onClose,
}: NotificationSettingsProps) {
  const [preferences, setPreferences] = useState<PushPreferences | null>(null);
  const [registered, setRegistered] = useState(false);
  const [browserPermission, setBrowserPermission] = useState(permission);
  const [busy, setBusy] = useState<Operation | null>(null);
  const [checking, setChecking] = useState(true);
  const [inspectionFailed, setInspectionFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [diagnostic, setDiagnostic] = useState<
    (PushDiagnostic & { userId: string }) | null
  >(null);
  const [diagnosticClock, setDiagnosticClock] = useState(Date.now);
  const [diagnosticError, setDiagnosticError] = useState("");
  const [diagnosticRetry, setDiagnosticRetry] = useState(0);
  const [installAvailable, setInstallAvailable] = useState(canInstallPwa);
  const [installed, setInstalled] = useState(installedPwa);
  const [installationAccepted, setInstallationAccepted] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const reading = useRef(false);
  const generation = useRef(0);
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const currentPreferences =
    preferences?.userId === userId ? preferences : null;
  const currentDiagnostic =
    diagnostic?.workspaceId === workspaceId && diagnostic.userId === userId
      ? diagnostic
      : null;

  useEffect(() => {
    if (currentDiagnostic?.status !== "queued") return;
    setDiagnosticClock(Date.now());
    const timer = window.setInterval(
      () => setDiagnosticClock(Date.now()),
      15_000,
    );
    return () => window.clearInterval(timer);
  }, [currentDiagnostic?.id, currentDiagnostic?.status]);

  useEffect(() => {
    if (currentDiagnostic?.status !== "queued" || !currentPreferences) return;
    const controller = new AbortController();
    let timer: number | undefined;
    const diagnosticId = currentDiagnostic.id;
    setDiagnosticError("");
    const check = async () => {
      try {
        const next = await api<PushDiagnostic>(
          `/notifications/push-tests/${encodeURIComponent(diagnosticId)}`,
          {
            signal: controller.signal,
            headers: {
              ...pushContextHeaders(currentPreferences),
              "X-Workspace-Id": workspaceId,
            },
          },
        );
        if (controller.signal.aborted) return;
        if (next.workspaceId !== workspaceId || next.id !== diagnosticId)
          throw new Error(
            "Test sonucu bu çalışma alanına ait değil. Ayarları yeniden açabilirsin.",
          );
        setDiagnostic({ ...next, userId });
        if (next.status === "queued")
          timer = window.setTimeout(() => void check(), 1500);
      } catch (reason) {
        if (!controller.signal.aborted)
          setDiagnosticError(
            reason instanceof Error
              ? reason.message
              : "Test sonucu alınamadı. Sonucu yeniden kontrol edebilirsin.",
          );
      }
    };
    timer = window.setTimeout(() => void check(), 1500);
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [
    currentDiagnostic?.id,
    currentDiagnostic?.status,
    currentPreferences?.sessionBinding,
    userId,
    workspaceId,
    diagnosticRetry,
  ]);

  useEffect(() => {
    return () => {
      generation.current++;
      operation.current?.abort();
      operation.current = null;
    };
  }, [userId, workspaceId]);

  useEffect(() => {
    const controller = new AbortController();
    const version = ++generation.current;
    const current = () =>
      !controller.signal.aborted && version === generation.current;
    reading.current = true;
    setChecking(true);
    setInspectionFailed(false);
    setBusy(null);
    setError("");
    setNotice("");
    setRegistered(false);
    setBrowserPermission(permission());
    void (async () => {
      try {
        const next = await loadPushPreferences(userId, controller.signal);
        if (!current()) return;
        if (next.userId !== userId)
          throw new Error(
            "Bu tarayıcıdaki oturum değişti. Sayfayı yenileyip bildirim ayarlarını yeniden açabilirsin.",
          );
        setPreferences(next);
        if (
          !supportsPush() ||
          permission() !== "granted" ||
          !next.pushEnabled ||
          !pushConfigured(next)
        )
          return;
        const service = await pwaRegistration();
        if (!current()) return;
        const subscription = await service.pushManager.getSubscription();
        if (!current() || !subscription || permission() !== "granted") return;
        await savePushSubscription(subscription, next, {
          signal: controller.signal,
          restore: true,
        });
        if (current()) setRegistered(true);
      } catch (err) {
        if (current()) {
          setInspectionFailed(true);
          setError(
            err instanceof Error
              ? err.message
              : "Bildirim ayarları yüklenemedi.",
          );
        }
      } finally {
        if (current()) {
          reading.current = false;
          setChecking(false);
          setBrowserPermission(permission());
        }
      }
    })();
    return () => {
      controller.abort();
    };
  }, [userId, revision]);

  useEffect(() => {
    const installChanged = () => {
      setInstallAvailable(canInstallPwa());
      setInstalled(installedPwa());
    };
    const refresh = () => {
      installChanged();
      setBrowserPermission(permission());
      if (
        !operation.current &&
        !reading.current &&
        document.visibilityState !== "hidden"
      )
        setRevision((value) => value + 1);
    };
    window.addEventListener("mola:install-state", installChanged);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("mola:install-state", installChanged);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  const run = async (
    kind: Operation,
    action: (signal: AbortSignal) => Promise<void>,
  ) => {
    if (operation.current || reading.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(kind);
    setError("");
    setNotice("");
    try {
      await action(controller.signal);
    } catch (err) {
      if (!controller.signal.aborted)
        setError(
          err instanceof Error
            ? err.message
            : "İşlem tamamlanamadı. Yeniden deneyebilirsin.",
        );
    } finally {
      if (!controller.signal.aborted) {
        operation.current = null;
        setBusy(null);
        setBrowserPermission(permission());
      }
    }
  };

  const enable = () => {
    if (
      !currentPreferences ||
      !supportsPush() ||
      !pushConfigured(currentPreferences) ||
      permission() === "denied"
    )
      return;
    void run("enable", async (signal) => {
      // Keep the native prompt in the button's gesture, before network/worker awaits.
      const allowed =
        permission() === "granted"
          ? "granted"
          : await Notification.requestPermission();
      if (signal.aborted) return;
      setBrowserPermission(allowed);
      if (allowed !== "granted")
        throw new Error(
          allowed === "denied"
            ? "Bildirim izni kapalı. Tarayıcının site ayarlarından Mola için bildirimlere izin verin."
            : "İzin verilmedi. İstediğin zaman yeniden açabilirsin.",
        );
      let created: PushSubscription | null = null;
      try {
        const service = await pwaRegistration();
        if (signal.aborted) return;
        const existing = await service.pushManager.getSubscription();
        if (signal.aborted) return;
        const subscription =
          existing ??
          (created = await service.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: applicationKey(currentPreferences.publicKey),
          }));
        if (signal.aborted) return;
        await savePushSubscription(subscription, currentPreferences, {
          signal,
        });
        await api("/notifications/preferences", {
          method: "PATCH",
          signal,
          headers: pushContextHeaders(currentPreferences),
          body: JSON.stringify({ pushEnabled: true }),
        });
        if (signal.aborted) return;
        setPreferences({ ...currentPreferences, pushEnabled: true });
        setRegistered(true);
        setNotice("Bildirimler bu cihazda açık.");
      } catch (err) {
        if (created) {
          await api("/notifications/subscriptions", {
            method: "DELETE",
            headers: pushContextHeaders(currentPreferences),
            body: JSON.stringify({ endpoint: created.endpoint }),
          }).catch(() => {});
          // The origin-wide endpoint may belong to a newer login; never unsubscribe it here.
        }
        throw err;
      }
    });
  };

  const disable = () => {
    if (!currentPreferences) return;
    void run("disable", async (signal) => {
      await api("/notifications/preferences", {
        method: "PATCH",
        signal,
        headers: pushContextHeaders(currentPreferences),
        body: JSON.stringify({ pushEnabled: false }),
      });
      if (signal.aborted) return;
      setPreferences({ ...currentPreferences, pushEnabled: false });
      setRegistered(false);
      if (supportsPush()) {
        const service = await pwaRegistration();
        if (signal.aborted) return;
        const subscription = await service.pushManager.getSubscription();
        if (signal.aborted) return;
        if (subscription)
          await api("/notifications/subscriptions", {
            method: "DELETE",
            signal,
            headers: pushContextHeaders(currentPreferences),
            body: JSON.stringify({ endpoint: subscription.endpoint }),
          });
      }
      if (!signal.aborted)
        setNotice("Hesabının tarayıcı bildirimleri tüm cihazlarda kapatıldı.");
    });
  };

  const configured = pushConfigured(currentPreferences);
  const supported = supportsPush();
  const enabledHere = Boolean(
    currentPreferences?.pushEnabled &&
    registered &&
    browserPermission === "granted" &&
    supported &&
    configured,
  );
  const needsHomeScreen = ios && !installed && !supported;
  const canEnable = Boolean(
    currentPreferences &&
    configured &&
    supported &&
    browserPermission !== "denied" &&
    !checking &&
    !inspectionFailed,
  );
  const state = checking
    ? "loading"
    : !window.isSecureContext
      ? "insecure"
      : needsHomeScreen
        ? "install"
        : !supported
          ? "unsupported"
          : !currentPreferences || inspectionFailed
            ? "error"
            : !configured
              ? "unavailable"
              : browserPermission === "denied"
                ? "denied"
                : enabledHere
                  ? "enabled"
                  : browserPermission === "default"
                    ? "permission"
                    : currentPreferences.pushEnabled
                      ? "disconnected"
                      : "disabled";
  const titles: Record<typeof state, string> = {
    loading: "Ayarların yükleniyor…",
    insecure: "Güvenli bağlantı gerekiyor",
    install: "Mola'yı ana ekranından aç",
    unsupported: "Bu tarayıcı bildirimleri desteklemiyor",
    error: "Bildirim durumu doğrulanamadı",
    unavailable: "Bildirim hizmeti şu anda hazır değil",
    denied: "Tarayıcı izni engellenmiş",
    enabled: "Bu cihazda bildirimler açık",
    permission: "Tarayıcı izni bekleniyor",
    disconnected: "Bu cihazın yeniden bağlanması gerekiyor",
    disabled: "Hesabının tarayıcı bildirimleri kapalı",
  };
  const descriptions: Record<typeof state, string> = {
    loading: "Tarayıcı izni ve bu cihazın bağlantısı kontrol ediliyor.",
    insecure: "Mola'nın HTTPS adresini açıp buradan tekrar deneyebilirsin.",
    install:
      "Paylaş menüsünden Ana Ekrana Ekle'yi seç, ardından Mola'yı eklediğin simgeden aç.",
    unsupported:
      "Bildirimler için güncel bir tarayıcı kullanabilirsin. Gelen kutun burada çalışmaya devam eder.",
    error: "Ayarları yeniden kontrol ederek devam edebilirsin.",
    unavailable:
      "Daha sonra yeniden deneyebilirsin. Gelen kutun ve okunmamış işaretlerin çalışmaya devam eder.",
    denied:
      "Adres çubuğundaki site ayarlarını aç, Bildirimler için İzin ver'i seç ve durumu yenile.",
    enabled:
      "Çalışma alanı ve kanal tercihlerine uyan bildirimler bu cihaza gönderilir.",
    permission:
      "Bildirimleri aç düğmesine bastığında tarayıcın senden izin isteyecek.",
    disconnected:
      "Tarayıcı iznin açık. Bildirimleri bu hesabına yeniden bağlayabilirsin.",
    disabled:
      "Tarayıcı iznin duruyor. Bildirimleri bu cihazda tekrar açabilirsin.",
  };

  return (
    <Modal
      title="Bildirimler ve uygulama"
      onClose={() => {
        if (!operation.current) onClose();
      }}
    >
      <div
        className="notification-settings"
        aria-busy={checking || Boolean(busy)}
      >
        <NotificationPreferencesPanel
          userId={userId}
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          channels={channels}
          members={members}
          revision={settingsRevision}
        />
        <section aria-labelledby="push-heading">
          <div className="notification-section-heading">
            <span>
              <Bell size={20} />
            </span>
            <div>
              <h3 id="push-heading">Tarayıcı bildirimleri</h3>
              <p>Seni ilgilendiren mesajlardan haberdar ol.</p>
            </div>
          </div>
          <div
            className={`notification-device-state ${enabledHere ? "is-enabled" : ""}`}
            data-state={state}
            role="status"
            aria-live="polite"
          >
            {enabledHere ? <Check size={17} /> : <BellOff size={17} />}
            <div>
              <strong>{titles[state]}</strong>
              <p>{descriptions[state]}</p>
            </div>
          </div>
          <dl className="notification-status-list" aria-label="Bildirim durumu">
            <div>
              <dt>
                <Monitor size={14} /> Tarayıcı izni
              </dt>
              <dd>
                {!supported
                  ? "Kullanılamıyor"
                  : browserPermission === "granted"
                    ? "İzin verildi"
                    : browserPermission === "denied"
                      ? "Engelli"
                      : "Henüz verilmedi"}
              </dd>
            </div>
            <div>
              <dt>
                <Bell size={14} /> Bu cihaz
              </dt>
              <dd>
                {checking
                  ? "Kontrol ediliyor"
                  : enabledHere
                    ? "Bağlı"
                    : "Bağlı değil"}
              </dd>
            </div>
            <div>
              <dt>
                <ShieldCheck size={14} /> Hesap tercihi
              </dt>
              <dd>
                {checking
                  ? "Kontrol ediliyor"
                  : !currentPreferences
                    ? "Kontrol edilemedi"
                    : currentPreferences.pushEnabled
                      ? "Açık"
                      : "Kapalı"}
              </dd>
            </div>
          </dl>
          <div className="notification-actions">
            {!enabledHere && (
              <Button
                variant="unstyled"
                size="unset"
                type="button"
                className="notification-primary"
                disabled={Boolean(busy) || !canEnable}
                onClick={enable}
              >
                <Bell size={15} />
                {busy === "enable"
                  ? "Bağlanıyor…"
                  : "Bu cihazda bildirimleri aç"}
              </Button>
            )}
            {enabledHere && (
              <Button
                variant="unstyled"
                size="unset"
                type="button"
                className="notification-primary"
                disabled={
                  Boolean(busy) ||
                  checking ||
                  currentDiagnostic?.status === "queued"
                }
                onClick={() => {
                  void run("test", async (signal) => {
                    if (!currentPreferences) return;
                    setDiagnostic(null);
                    setDiagnosticError("");
                    if (permission() !== "granted")
                      throw new Error(
                        "Tarayıcı izni değişmiş. Durumu yenileyip tekrar deneyebilirsin.",
                      );
                    const service = await pwaRegistration();
                    if (signal.aborted) return;
                    const subscription =
                      await service.pushManager.getSubscription();
                    if (signal.aborted) return;
                    if (!subscription)
                      throw new Error(
                        "Bu cihazın bildirim bağlantısı bulunamadı. Durumu yenileyip yeniden bağlanabilirsin.",
                      );
                    const next = await api<PushDiagnostic>(
                      "/notifications/push-tests",
                      {
                        method: "POST",
                        signal,
                        headers: {
                          ...pushContextHeaders(currentPreferences),
                          "X-Workspace-Id": workspaceId,
                        },
                        body: JSON.stringify({
                          endpoint: subscription.endpoint,
                        }),
                      },
                    );
                    if (signal.aborted) return;
                    if (next.workspaceId !== workspaceId)
                      throw new Error(
                        "Çalışma alanı değişti. Testi bu çalışma alanından yeniden başlatabilirsin.",
                      );
                    setDiagnostic({ ...next, userId });
                  });
                }}
              >
                <Send size={15} />
                {busy === "test" ? "Gönderiliyor…" : "Test bildirimi gönder"}
              </Button>
            )}
            <Button
              variant="unstyled"
              size="unset"
              type="button"
              className="notification-secondary"
              disabled={Boolean(busy) || checking}
              onClick={() => {
                setNotice("");
                setRevision((value) => value + 1);
              }}
            >
              <RefreshCw size={14} />
              {checking ? "Kontrol ediliyor…" : "Durumu yenile"}
            </Button>
          </div>
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
          {currentDiagnostic && (
            <div
              className="notification-diagnostic"
              data-state={currentDiagnostic.status}
            >
              <div
                role={
                  currentDiagnostic.status === "failed" ? "alert" : "status"
                }
              >
                <strong>
                  {currentDiagnostic.status === "queued"
                    ? "Test bildirimi kuyruğa alındı"
                    : currentDiagnostic.status === "providerAccepted"
                      ? "Bildirim sağlayıcısı testi kabul etti"
                      : "Test bildirimi gönderilemedi"}
                </strong>
                <p>
                  {currentDiagnostic.status === "queued"
                    ? "Sunucu bu cihazın bildirim sağlayıcısına ulaşmayı deniyor. Sonuç burada güncellenecek."
                    : currentDiagnostic.status === "providerAccepted"
                      ? "Sağlayıcı kabulü, bildirimin ekranda göründüğü anlamına gelmez. Görünmüyorsa cihazının bildirim ve odak ayarlarını kontrol edebilirsin."
                      : diagnosticFailure(currentDiagnostic.reasonCode)}
                </p>
                {currentDiagnostic.attempts > 0 && (
                  <small>{currentDiagnostic.attempts} gönderim denemesi</small>
                )}
                {currentDiagnostic.status === "queued" && (
                  <small>
                    Kuyrukta geçen süre:{" "}
                    {Math.max(
                      0,
                      Math.floor(
                        (diagnosticClock -
                          Date.parse(currentDiagnostic.createdAt)) /
                          1000,
                      ),
                    )}{" "}
                    saniye
                    {currentDiagnostic.nextAttemptAt
                      ? ` · Sonraki deneme ${new Date(currentDiagnostic.nextAttemptAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}`
                      : ""}
                  </small>
                )}
                {currentDiagnostic.lastFailureCode && (
                  <small>
                    Son deneme:{" "}
                    {diagnosticFailureDetail(currentDiagnostic.lastFailureCode)}
                    {currentDiagnostic.lastFailureAt
                      ? ` (${new Date(currentDiagnostic.lastFailureAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })})`
                      : ""}
                  </small>
                )}
              </div>
              {diagnosticError && (
                <div className="notification-diagnostic-error" role="alert">
                  <p>{diagnosticError}</p>
                  <Button
                    variant="unstyled"
                    size="unset"
                    type="button"
                    className="notification-secondary"
                    onClick={() => setDiagnosticRetry((value) => value + 1)}
                  >
                    <RefreshCw size={14} aria-hidden="true" /> Sonucu yeniden
                    kontrol et
                  </Button>
                </div>
              )}
            </div>
          )}
          <p className="notification-help">
            Bildirimlerde mesaj içeriği gösterilmez. İzin her cihazda ayrı
            verilir. Test yalnız bu cihaza gönderilir ve bu tek deneme için
            susturma ile sessiz saatler uygulanmaz.
          </p>
          {currentPreferences?.pushEnabled && (
            <div className="notification-account-action">
              <p>Hesabına bağlı tüm cihazlarda bildirimleri durdur.</p>
              <Button
                variant="unstyled"
                size="unset"
                type="button"
                className="notification-text-button"
                disabled={Boolean(busy) || checking}
                onClick={disable}
              >
                {busy === "disable" ? "Kapatılıyor…" : "Tüm cihazlarda kapat"}
              </Button>
            </div>
          )}
        </section>
        <section aria-labelledby="install-heading">
          <div className="notification-section-heading">
            <span>
              <Smartphone size={20} />
            </span>
            <div>
              <h3 id="install-heading">Mola'ya daha hızlı ulaş</h3>
              <p>Masaüstüne veya ana ekranına ekle.</p>
            </div>
          </div>
          {installed || installationAccepted ? (
            <p className="notification-installed">
              <Check size={16} />
              {installed
                ? "Mola uygulama olarak açık."
                : "Mola cihazına eklendi."}
            </p>
          ) : installAvailable ? (
            <Button
              variant="unstyled"
              size="unset"
              type="button"
              className="notification-secondary"
              disabled={Boolean(busy) || checking}
              onClick={() => {
                void run("install", async (signal) => {
                  const accepted = await installPwa();
                  if (signal.aborted) return;
                  setInstallAvailable(canInstallPwa());
                  if (accepted) setInstallationAccepted(true);
                });
              }}
            >
              <Download size={15} />
              Mola'yı yükle
            </Button>
          ) : (
            <p className="notification-help">
              {ios
                ? "Paylaş menüsünü aç, Ana Ekrana Ekle'yi seç ve Ekle'ye dokun."
                : "Tarayıcının adres çubuğundaki yükleme simgesini veya menüsündeki uygulama yükleme seçeneğini kullanabilirsin. Bu seçenek görünmüyorsa siteyi yer imlerine ekleyebilirsin."}
            </p>
          )}
        </section>
      </div>
    </Modal>
  );
}

function diagnosticFailure(reason: string | null) {
  if (
    reason === "SUBSCRIPTION_GONE" ||
    reason === "SUBSCRIPTION_EXPIRED" ||
    reason === "PROVIDER_GONE"
  )
    return "Bu cihazın bildirim kaydı artık geçerli değil. Durumu yenileyip cihazı yeniden bağlayabilirsin.";
  if (reason === "PUSH_DISABLED")
    return "Hesabının tarayıcı bildirimleri kapalı. Bildirimleri açıp yeniden deneyebilirsin.";
  return "Sunucu testi bildirim sağlayıcısına ulaştıramadı. Bağlantıyı kontrol edip daha sonra yeniden test gönderebilirsin.";
}

function diagnosticFailureDetail(code: string) {
  if (code === "PROVIDER_TIMEOUT") return "sağlayıcı zamanında yanıt vermedi";
  if (code === "PROVIDER_UNAVAILABLE")
    return "sağlayıcı geçici olarak kullanılamıyor";
  if (code === "PROVIDER_THROTTLED") return "sağlayıcı yeniden denemeyi istedi";
  if (code === "NETWORK_ERROR") return "bağlantı kurulamadı";
  if (code === "SUBSCRIPTION_EXPIRED") return "bu cihazın kaydı geçersiz";
  if (code === "PROVIDER_REJECTED") return "sağlayıcı isteği reddetti";
  return "gönderim tamamlanamadı";
}
