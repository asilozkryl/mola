import { useEffect, useState, type FormEvent } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  Monitor,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import QRCode from "qrcode";
import type {
  AccountSession,
  RecoveryCodes,
  SecuritySetup,
  SecurityStatus,
} from "../../shared/security-types";
import { api, post } from "../lib/api";
import { Spinner } from "./ui";
import "./security-settings.css";

const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "İşlem tamamlanamadı. Yeniden deneyebilirsin.";
const date = (time: number | null) =>
  time
    ? new Intl.DateTimeFormat("tr-TR", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(time)
    : "Kayıtlı değil";

export function SecuritySettings() {
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [setup, setSetup] = useState<SecuritySetup | null>(null);
  const [qr, setQr] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [action, setAction] = useState<"setup" | "disable" | "codes" | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revokeId, setRevokeId] = useState<string | null>(null);
  async function refresh() {
    const [security, devices] = await Promise.all([
      api<SecurityStatus>("/account/security"),
      api<{ sessions: AccountSession[] }>("/account/sessions"),
    ]);
    setStatus(security);
    setSessions(devices.sessions);
  }
  useEffect(() => {
    let active = true;
    Promise.all([
      api<SecurityStatus>("/account/security"),
      api<{ sessions: AccountSession[] }>("/account/sessions"),
    ])
      .then(([security, devices]) => {
        if (active) {
          setStatus(security);
          setSessions(devices.sessions);
        }
      })
      .catch((error) => {
        if (active) setError(errorText(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setQr("");
    if (setup)
      void QRCode.toDataURL(setup.uri, {
        width: 220,
        margin: 2,
        color: { dark: "#153d36", light: "#ffffff" },
      })
        .then((value) => {
          if (active) setQr(value);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [setup]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (setup) {
        const result = await post<RecoveryCodes>("/account/security/enable", {
          code: values.get("code"),
        });
        setCodes(result.recoveryCodes);
        setSetup(null);
        setAction(null);
        await refresh();
        setNotice(
          "İki aşamalı doğrulama açıldı. Diğer cihazlardaki oturumların kapatıldı.",
        );
      } else if (action === "setup") {
        const result = await post<SecuritySetup>("/account/security/setup", {
          password: values.get("password"),
        });
        form.reset();
        setSetup(result);
      } else if (action === "disable") {
        await post("/account/security/disable", {
          password: values.get("password"),
          code: values.get("code"),
        });
        form.reset();
        setAction(null);
        setCodes([]);
        await refresh();
        setNotice(
          "İki aşamalı doğrulama kapatıldı. Diğer cihazlardaki oturumların kapatıldı.",
        );
      } else if (action === "codes") {
        const result = await post<RecoveryCodes>(
          "/account/security/recovery-codes",
          { password: values.get("password"), code: values.get("code") },
        );
        form.reset();
        setCodes(result.recoveryCodes);
        setAction(null);
        await refresh();
        setNotice(
          "Yeni kurtarma kodların hazır. Önceki kodlar artık geçersiz.",
        );
      }
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await post(`/account/sessions/${id}/revoke`);
      setRevokeId(null);
      await refresh();
      setNotice("Seçtiğin cihazdaki oturum kapatıldı.");
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice("Kopyalandı. Güvenli bir yerde sakla.");
    } catch {
      setError("Kopyalanamadı. Metni seçerek kendin kopyalayabilirsin.");
    }
  }
  function downloadCodes() {
    const content = [
      "Mola kurtarma kodları",
      "Her kod yalnızca bir kez kullanılabilir. Bu dosyayı güvenli bir yerde sakla.",
      "",
      ...codes,
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "mola-kurtarma-kodlari.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <details className="settings-security account-security">
      <summary className="settings-toggle">
        <span>
          <strong>Hesap güvenliği ve cihazlar</strong>
          <small>İki aşamalı doğrulama ve açık oturumların.</small>
        </span>
        <ChevronDown size={17} aria-hidden="true" />
      </summary>
      <div className="security-body">
        {loading ? (
          <Spinner label="Güvenlik ayarları yükleniyor" />
        ) : (
          <>
            {status && (
              <section aria-label="İki aşamalı doğrulama">
                <div className="security-heading">
                  <ShieldCheck size={22} aria-hidden="true" />
                  <div>
                    <h3>İki aşamalı doğrulama</h3>
                    <span
                      className={`security-badge ${status.enabled ? "enabled" : ""}`}
                    >
                      {status.enabled ? "Açık" : "Kapalı"}
                    </span>
                  </div>
                </div>
                <p className="modal-description">
                  Giriş yaparken parolana ek olarak doğrulama uygulamandaki tek
                  kullanımlık kod istenir.
                </p>
                {!action && !codes.length && (
                  <div className="security-actions">
                    {status.enabled ? (
                      <>
                        <p className="security-meta">
                          {status.recoveryCodesRemaining} kurtarma kodun kaldı.
                        </p>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => {
                            setAction("codes");
                            setError("");
                            setNotice("");
                          }}
                        >
                          <RefreshCw size={16} /> Kurtarma kodlarını yenile
                        </button>
                        <button
                          type="button"
                          className="security-text-button"
                          onClick={() => {
                            setAction("disable");
                            setError("");
                            setNotice("");
                          }}
                        >
                          <ShieldOff size={16} /> İki aşamalı doğrulamayı kapat
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="secondary-button full-width"
                        onClick={() => {
                          setAction("setup");
                          setError("");
                          setNotice("");
                        }}
                      >
                        <ShieldCheck size={17} /> İki aşamalı doğrulamayı kur
                      </button>
                    )}
                  </div>
                )}
                {action && (
                  <form
                    onSubmit={submit}
                    className="security-form"
                    aria-label={
                      setup
                        ? "Doğrulama uygulamasını bağla"
                        : action === "setup"
                          ? "İki aşamalı doğrulama kurulumu"
                          : action === "disable"
                            ? "İki aşamalı doğrulamayı kapat"
                            : "Kurtarma kodlarını yenile"
                    }
                  >
                    {setup ? (
                      <>
                        <p className="modal-description">
                          Doğrulama uygulamana yeni hesap ekleyip QR kodu tara.
                          Ardından uygulamanın ürettiği 6 haneli kodu yaz.
                        </p>
                        {qr && (
                          <img
                            className="security-qr"
                            src={qr}
                            width="220"
                            height="220"
                            alt="Mola doğrulama hesabını eklemek için QR kod"
                          />
                        )}
                        <details className="security-manual">
                          <summary>QR kodu tarayamıyorum</summary>
                          <p>
                            Uygulamada kurulum anahtarını elle gir. Hesap türü:
                            zamana dayalı.
                          </p>
                          <code>{setup.secret}</code>
                          <button
                            className="security-text-button"
                            type="button"
                            onClick={() => void copy(setup.secret)}
                          >
                            <Copy size={15} /> Kurulum anahtarını kopyala
                          </button>
                        </details>
                      </>
                    ) : (
                      <>
                        {action === "disable" && (
                          <p className="security-warning">
                            Giriş sırasında ek kod istenmeyecek. Devam etmek
                            için parolanı ve güncel doğrulama kodunu yaz.
                          </p>
                        )}
                        {action === "codes" && (
                          <p className="modal-description">
                            Önceki kurtarma kodların geçersiz olacak. Yeni
                            kodları güvenli bir yerde sakla.
                          </p>
                        )}
                        <label>
                          Mevcut parolan
                          <input
                            type="password"
                            name="password"
                            autoComplete="current-password"
                            required
                            maxLength={128}
                            disabled={busy}
                          />
                        </label>
                      </>
                    )}
                    {(setup || action !== "setup") && (
                      <label>
                        {setup
                          ? "Doğrulama kodu"
                          : "Doğrulama veya kurtarma kodu"}
                        <input
                          name="code"
                          autoComplete="one-time-code"
                          inputMode={setup ? "numeric" : "text"}
                          required
                          minLength={6}
                          maxLength={setup ? 6 : 32}
                          pattern={setup ? "[0-9]{6}" : undefined}
                          placeholder={setup ? "000000" : "Güncel kodun"}
                          disabled={busy}
                        />
                      </label>
                    )}
                    <div className="security-actions">
                      <button
                        className="primary-button full-width"
                        disabled={busy}
                      >
                        {busy ? (
                          <Spinner label="Doğrulanıyor" />
                        ) : setup ? (
                          "Doğrula ve etkinleştir"
                        ) : action === "setup" ? (
                          "Kuruluma devam et"
                        ) : action === "disable" ? (
                          "Doğrulamayı kapat"
                        ) : (
                          "Yeni kodları oluştur"
                        )}
                      </button>
                      <button
                        type="button"
                        className="security-text-button"
                        disabled={busy}
                        onClick={() => {
                          setAction(null);
                          setSetup(null);
                          setError("");
                        }}
                      >
                        Vazgeç
                      </button>
                    </div>
                  </form>
                )}
                {codes.length > 0 && (
                  <div
                    className="security-recovery"
                    role="region"
                    aria-label="Kurtarma kodların"
                  >
                    <h4>Kurtarma kodlarını sakla</h4>
                    <p>
                      Telefonuna erişemediğinde bu kodlarla giriş yapabilirsin.
                      Her kod bir kez kullanılır ve bu ekranı kapattıktan sonra
                      tekrar gösterilmez.
                    </p>
                    <ul>
                      {codes.map((code) => (
                        <li key={code}>
                          <code>{code}</code>
                        </li>
                      ))}
                    </ul>
                    <div className="security-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={downloadCodes}
                      >
                        <Download size={16} /> Kodları indir
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => void copy(codes.join("\n"))}
                      >
                        <Copy size={16} /> Kopyala
                      </button>
                      <button
                        type="button"
                        className="primary-button full-width"
                        onClick={() => setCodes([])}
                      >
                        <Check size={16} /> Kodlarımı sakladım
                      </button>
                    </div>
                  </div>
                )}
              </section>
            )}
            <section className="security-devices" aria-label="Açık oturumlar">
              <div className="security-device-heading">
                <h3>Açık oturumlar</h3>
                <button
                  type="button"
                  className="security-text-button"
                  disabled={busy}
                  aria-label="Açık oturumları yenile"
                  onClick={() => {
                    setBusy(true);
                    setError("");
                    void refresh()
                      .catch((error) => setError(errorText(error)))
                      .finally(() => setBusy(false));
                  }}
                >
                  <RefreshCw size={16} />
                </button>
              </div>
              <p className="modal-description">
                Tanımadığın bir cihazın oturumunu kapatabilirsin.
              </p>
              <ul className="security-session-list">
                {sessions.map((session) => (
                  <li key={session.id}>
                    <Monitor size={20} aria-hidden="true" />
                    <div className="security-session-details">
                      <strong>{session.device}</strong>
                      {session.current && (
                        <span className="security-badge enabled">Bu cihaz</span>
                      )}
                      <small>Son etkinlik: {date(session.lastSeenAt)}</small>
                      <small>Giriş: {date(session.createdAt)}</small>
                      {!session.current &&
                        (revokeId === session.id ? (
                          <div className="security-session-confirm">
                            <p>Bu cihazın bağlantısı hemen kesilecek.</p>
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={busy}
                              onClick={() => void revoke(session.id)}
                            >
                              Oturumu kapat
                            </button>
                            <button
                              type="button"
                              className="security-text-button"
                              disabled={busy}
                              onClick={() => setRevokeId(null)}
                            >
                              Vazgeç
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="security-text-button"
                            disabled={busy}
                            onClick={() => setRevokeId(session.id)}
                            aria-label={`${session.device} oturumunu kapat`}
                          >
                            Bu oturumu kapat
                          </button>
                        ))}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="security-notice" role="status">
            {notice}
          </p>
        )}
      </div>
    </details>
  );
}
