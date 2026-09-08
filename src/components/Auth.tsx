import { useState, type FormEvent } from "react";
import { ArrowRight, Check, Eye, EyeOff } from "lucide-react";
import type { SessionBootstrap } from "../../shared/types";
import type { TwoFactorChallenge } from "../../shared/security-types";
import { ApiError, post } from "../lib/api";
import { IconButton, Spinner } from "./ui";
import { AuthLayout } from "./AuthLayout";
import { EmailUnavailableNotice, ForgotPassword } from "./AccountRecovery";

export function Auth({
  onLogin,
  demoEnabled,
  emailDeliveryAvailable = true,
  registrationAvailable = true,
}: {
  onLogin: (data: SessionBootstrap) => void;
  demoEnabled: boolean;
  emailDeliveryAvailable?: boolean;
  registrationAvailable?: boolean;
}) {
  const inviteToken = new URLSearchParams(location.search).get("invite") || "";
  const [mode, setMode] = useState<"login" | "register" | "forgot">(
    inviteToken ? "register" : "login",
  );
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [challenge, setChallenge] = useState<TwoFactorChallenge | null>(null);
  const [useRecovery, setUseRecovery] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (mode === "register" && !registrationAvailable) return;
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const result = await post<SessionBootstrap | TwoFactorChallenge>(
        `/auth/${mode}`,
        {
          ...values,
          ...(inviteToken ? { inviteToken } : {}),
        },
      );
      if ("twoFactorRequired" in result) {
        setChallenge(result);
        setUseRecovery(false);
        return;
      }
      sessionStorage.removeItem("mola:logged-out");
      history.replaceState(
        null,
        "",
        mode === "login" && inviteToken
          ? `/?invite=${encodeURIComponent(inviteToken)}`
          : "/",
      );
      onLogin(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function verifyChallenge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const values = new FormData(event.currentTarget);
    try {
      const result = await post<SessionBootstrap>("/auth/2fa/challenge", {
        code: values.get("code"),
      });
      sessionStorage.removeItem("mola:logged-out");
      history.replaceState(
        null,
        "",
        inviteToken ? `/?invite=${encodeURIComponent(inviteToken)}` : "/",
      );
      onLogin(result);
    } catch (error) {
      setError((error as Error).message);
      if (error instanceof ApiError && error.code === "TWO_FACTOR_EXPIRED")
        setChallenge(null);
    } finally {
      setBusy(false);
    }
  }
  async function demo() {
    setBusy(true);
    setError("");
    try {
      onLogin(await post<SessionBootstrap>("/auth/demo"));
      sessionStorage.removeItem("mola:logged-out");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (challenge)
    return (
      <AuthLayout>
        <span className="auth-greeting">Son bir güvenlik adımı</span>
        <h2>Sensiz kapı açılmaz.</h2>
        <p>
          {useRecovery
            ? "Kaydettiğin kurtarma kodlarından birini kullan. Her kod bir kez geçerlidir."
            : "Doğrulama uygulamandaki 6 haneli kodu gir."}
        </p>
        <form
          onSubmit={verifyChallenge}
          className="two-factor-form"
          aria-label="İki aşamalı giriş"
        >
          <label>
            {useRecovery ? "Kurtarma kodu" : "Doğrulama kodu"}
            <input
              key={String(useRecovery)}
              className={useRecovery ? "" : "two-factor-code"}
              name="code"
              autoComplete="one-time-code"
              inputMode={useRecovery ? "text" : "numeric"}
              autoFocus
              required
              minLength={6}
              maxLength={useRecovery ? 32 : 6}
              pattern={useRecovery ? undefined : "[0-9]{6}"}
              placeholder={useRecovery ? "XXXXX-XXXXX-XXXXX-XXXXX" : "000000"}
              disabled={busy}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary-button full-width" disabled={busy}>
            {busy ? (
              <Spinner label="Doğrulanıyor" />
            ) : (
              <>
                Doğrula ve giriş yap <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>
        <button
          className="auth-text-button two-factor-switch"
          disabled={busy}
          onClick={() => {
            setUseRecovery(!useRecovery);
            setError("");
          }}
        >
          {useRecovery
            ? "Doğrulama uygulamamı kullan"
            : "Telefonuma erişemiyorum"}
        </button>
        <button
          className="auth-text-button"
          disabled={busy}
          onClick={() => {
            setChallenge(null);
            setError("");
          }}
        >
          Giriş ekranına dön
        </button>
      </AuthLayout>
    );
  if (mode === "forgot")
    return (
      <ForgotPassword
        emailDeliveryAvailable={emailDeliveryAvailable}
        onBack={() => {
          setMode("login");
          setError("");
        }}
      />
    );
  return (
    <AuthLayout>
      <span className="auth-greeting">
        {inviteToken ? "Ekibin seni bekliyor" : "Hadi, bir araya gelelim"}
      </span>
      <h2>
        {mode === "login"
          ? "Tekrar hoş geldin."
          : inviteToken
            ? "Ekibine katıl."
            : "Ekibine bir yer aç."}
      </h2>
      <p>
        {mode === "login"
          ? "Sohbet kaldığı yerden devam etsin."
          : "Birkaç küçük detayla başlayalım."}
      </p>
      <div className="auth-tabs">
        <button
          className={mode === "login" ? "active" : ""}
          onClick={() => {
            setMode("login");
            setError("");
          }}
        >
          Giriş yap
        </button>
        <button
          className={mode === "register" ? "active" : ""}
          disabled={!registrationAvailable}
          aria-describedby={
            !registrationAvailable ? "email-unavailable" : undefined
          }
          onClick={() => {
            setMode("register");
            setError("");
          }}
        >
          Hesap oluştur
        </button>
      </div>
      {!emailDeliveryAvailable && (
        <EmailUnavailableNotice id="email-unavailable">
          {!registrationAvailable
            ? "Hesap oluşturma ve parola yenileme, hizmet bağlandığında açılacak. Mevcut, doğrulanmış hesabınla giriş yapabilirsin."
            : "Parola yenileme, hizmet bağlandığında açılacak. Hesabına parolanla giriş yapabilirsin."}
        </EmailUnavailableNotice>
      )}
      {mode === "register" && !registrationAvailable ? (
        <button
          className="primary-button full-width recovery-secondary"
          onClick={() => setMode("login")}
        >
          Mevcut hesabımla giriş yap
          <ArrowRight size={18} />
        </button>
      ) : (
        <form onSubmit={submit}>
          {mode === "register" && (
            <label>
              Adın soyadın
              <input
                name="name"
                placeholder="Örn. Asil Yılmaz"
                autoComplete="name"
                required
                minLength={2}
                maxLength={60}
              />
            </label>
          )}
          <label>
            E-posta adresin
            <input
              name="email"
              type="email"
              placeholder="sen@ekibin.com"
              autoComplete="email"
              required
              maxLength={254}
            />
          </label>
          <label>
            Parola
            <div className="password-field">
              <input
                name="password"
                type={showPassword ? "text" : "password"}
                placeholder={
                  mode === "register" ? "En az 12 karakter" : "Parolanı gir"
                }
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                minLength={mode === "register" ? 12 : 1}
                maxLength={128}
                required
              />
              <IconButton
                label={showPassword ? "Parolayı gizle" : "Parolayı göster"}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </IconButton>
            </div>
          </label>
          {mode === "login" && (
            <button
              className="auth-text-button forgot-link"
              type="button"
              disabled={!emailDeliveryAvailable}
              aria-describedby={
                !emailDeliveryAvailable ? "email-unavailable" : undefined
              }
              onClick={() => {
                setMode("forgot");
                setError("");
              }}
            >
              Parolamı unuttum
            </button>
          )}
          {mode === "register" && !inviteToken && (
            <label>
              Çalışma alanı adı
              <input
                name="workspaceName"
                placeholder="Örn. Studio North"
                required
                minLength={2}
                maxLength={60}
              />
            </label>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary-button full-width" disabled={busy}>
            {busy ? (
              <Spinner label="Birazdan oradasın" />
            ) : (
              <>
                {mode === "login" ? "Giriş yap" : "Hesap oluştur"}
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>
      )}
      {demoEnabled && (
        <>
          <div className="or-divider">
            <span>Önce bir göz atmak istersen</span>
          </div>
          <button
            className="secondary-button full-width"
            onClick={demo}
            disabled={busy}
          >
            Örnek çalışma alanını keşfet
          </button>
          <p className="auth-demo-note">
            <Check size={14} /> Hesap gerekmez. Sana özel bir örnek alan açılır.
          </p>
        </>
      )}
    </AuthLayout>
  );
}
