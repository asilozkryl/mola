import { useState, type FormEvent } from "react";
import { ArrowRight, Check, Eye, EyeOff } from "lucide-react";
import type { Bootstrap } from "../../shared/types";
import { post } from "../lib/api";
import { IconButton, Spinner } from "./ui";
import { AuthLayout } from "./AuthLayout";
import { ForgotPassword } from "./AccountRecovery";

export function Auth({
  onLogin,
  demoEnabled,
}: {
  onLogin: (data: Bootstrap) => void;
  demoEnabled: boolean;
}) {
  const inviteToken = new URLSearchParams(location.search).get("invite") || "";
  const [mode, setMode] = useState<"login" | "register" | "forgot">(
    inviteToken ? "register" : "login",
  );
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const result = await post<Bootstrap>(`/auth/${mode}`, {
        ...values,
        ...(inviteToken ? { inviteToken } : {}),
      });
      sessionStorage.removeItem("mola:logged-out");
      history.replaceState(null, "", "/");
      onLogin(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function demo() {
    setBusy(true);
    setError("");
    try {
      onLogin(await post<Bootstrap>("/auth/demo"));
      sessionStorage.removeItem("mola:logged-out");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (mode === "forgot")
    return (
      <ForgotPassword
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
          onClick={() => {
            setMode("register");
            setError("");
          }}
        >
          Hesap oluştur
        </button>
      </div>
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
