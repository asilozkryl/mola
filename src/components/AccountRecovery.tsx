import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  Mail,
  ShieldCheck,
} from "lucide-react";
import type { SessionBootstrap, PublicConfig } from "../../shared/types";
import { api, post } from "../lib/api";
import { clearAuthLink, type AuthLink } from "../lib/auth-links";
import { AuthLayout } from "./AuthLayout";
import { IconButton, Spinner } from "./ui";

function LocalMailbox({ url }: { url?: string }) {
  if (!url) return null;
  return (
    <p className="local-mail-note">
      Yerel deneme ortamı ·{" "}
      <a href={url} target="_blank" rel="noreferrer">
        E-posta kutusunu aç
      </a>
    </p>
  );
}

export function EmailUnavailableNotice({
  children,
  id,
}: {
  children: ReactNode;
  id?: string;
}) {
  return (
    <p className="demo-notice" role="status" id={id}>
      <strong>E-posta hizmeti henüz bağlanmadı.</strong> {children}
    </p>
  );
}

function useEmailDelivery(emailDeliveryAvailable: boolean) {
  const [mailbox, setMailbox] = useState<string>();
  const [deliveryAvailable, setDeliveryAvailable] = useState(
    emailDeliveryAvailable,
  );
  useEffect(() => {
    let cancelled = false;
    void api<PublicConfig>("/config")
      .then((c) => {
        if (cancelled) return;
        setMailbox(c.localMailboxUrl);
        setDeliveryAvailable(c.emailDeliveryAvailable !== false);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return { canSend: emailDeliveryAvailable && deliveryAvailable, mailbox };
}

export function ForgotPassword({
  onBack,
  emailDeliveryAvailable = true,
}: {
  onBack: () => void;
  emailDeliveryAvailable?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const { canSend, mailbox } = useEmailDelivery(emailDeliveryAvailable);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSend) return;
    setBusy(true);
    setError("");
    const email = new FormData(event.currentTarget).get("email");
    try {
      await post("/auth/forgot-password", { email });
      setSent(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthLayout>
      <span className="recovery-symbol">
        <Mail size={28} />
      </span>
      <span className="auth-greeting">Yeniden buluşalım</span>
      <h2>{sent ? "E-postanı kontrol et." : "Parolanı yenileyelim."}</h2>
      {canSend && (
        <p>
          {sent
            ? "Bu adresle bir hesabın varsa parola yenileme bağlantısı yola çıktı. Gelen kutuna ve istenmeyen postalara göz at."
            : "Hesabına bağlı e-posta adresini yaz. Sana parolanı yenileyebileceğin bir bağlantı gönderelim."}
        </p>
      )}
      {!canSend && (
        <EmailUnavailableNotice>
          Parola yenileme bağlantısı şu anda gönderilemiyor. Yardım için çalışma
          alanı yöneticinle iletişime geçebilirsin.
        </EmailUnavailableNotice>
      )}
      {!sent && canSend && (
        <form onSubmit={submit}>
          <label>
            E-posta adresin
            <Input
              unstyled
              name="email"
              type="email"
              autoComplete="email"
              placeholder="sen@ekibin.com"
              maxLength={254}
              required
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <Button
            variant="default"
            size="unset"
            type="submit"
            className="primary-button full-width"
            disabled={busy}
          >
            {busy ? (
              <Spinner label="Bağlantı hazırlanıyor" />
            ) : (
              <>
                Yenileme bağlantısı gönder
                <ArrowRight size={18} />
              </>
            )}
          </Button>
        </form>
      )}
      {sent && (
        <p className="recovery-detail" role="status">
          Bağlantı 15 dakika geçerli. Bu süre dolarsa yeni bir bağlantı
          isteyebilirsin.
        </p>
      )}
      <Button
        variant="unstyled"
        size="unset"
        type="submit"
        className="auth-text-button recovery-back"
        onClick={onBack}
      >
        <ArrowLeft size={16} /> Girişe dön
      </Button>
      {canSend && <LocalMailbox url={mailbox} />}
    </AuthLayout>
  );
}

export function AccountRecovery({
  link,
  onDone,
  emailDeliveryAvailable = true,
}: {
  link: AuthLink;
  onDone: (action: AuthLink["action"]) => void;
  emailDeliveryAvailable?: boolean;
}) {
  const verify = link.action === "verify-email";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [show, setShow] = useState(false);
  const [forgot, setForgot] = useState(false);
  const { canSend } = useEmailDelivery(emailDeliveryAvailable);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const values = new FormData(event.currentTarget);
    if (!verify && values.get("password") !== values.get("confirmation")) {
      setError("Parolalar aynı olmalı. İkinci parolayı kontrol et.");
      return;
    }
    setBusy(true);
    try {
      await post(`/auth/${link.action}`, {
        token: link.token,
        ...(!verify ? { newPassword: values.get("password") } : {}),
      });
      clearAuthLink();
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (forgot)
    return (
      <ForgotPassword
        emailDeliveryAvailable={canSend}
        onBack={() => onDone("reset-password")}
      />
    );
  return (
    <AuthLayout>
      <span className="recovery-symbol">
        {done ? <Check size={28} /> : <ShieldCheck size={28} />}
      </span>
      <span className="auth-greeting">Hesabın güvende</span>
      <h2>
        {done
          ? verify
            ? "E-postan doğrulandı."
            : "Yeni parolan hazır."
          : verify
            ? "Son bir küçük adım."
            : "Yeni bir başlangıç."}
      </h2>
      <p>
        {done
          ? verify
            ? "Artık ekibinle buluşmaya hazırsın."
            : "Güvenliğin için açık oturumların kapatıldı. Yeni parolanla giriş yapabilirsin."
          : verify
            ? "E-posta adresinin sana ait olduğunu onayla; ardından sohbete katıl."
            : "En az 12 karakterden oluşan, bu hesaba özel bir parola seç."}
      </p>
      {done ? (
        <Button
          variant="default"
          size="unset"
          type="submit"
          className="primary-button full-width"
          onClick={() => onDone(link.action)}
        >
          Devam et
          <ArrowRight size={18} />
        </Button>
      ) : (
        <form onSubmit={submit}>
          {!verify && (
            <>
              <label>
                Yeni parola
                <div className="password-field">
                  <Input
                    unstyled
                    name="password"
                    type={show ? "text" : "password"}
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    required
                    placeholder="En az 12 karakter"
                  />
                  <IconButton
                    label={show ? "Parolayı gizle" : "Parolayı göster"}
                    onClick={() => setShow(!show)}
                  >
                    {show ? <EyeOff size={18} /> : <Eye size={18} />}
                  </IconButton>
                </div>
              </label>
              <label>
                Yeni parola tekrar
                <Input
                  unstyled
                  name="confirmation"
                  type={show ? "text" : "password"}
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  required
                  placeholder="Aynı parolayı tekrar yaz"
                />
              </label>
            </>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {!link.token && (
            <p className="form-error" role="alert">
              Bağlantı eksik görünüyor. E-postandaki bağlantının tamamını aç.
            </p>
          )}
          <Button
            variant="default"
            size="unset"
            type="submit"
            className="primary-button full-width"
            disabled={busy || !link.token}
          >
            {busy ? (
              <Spinner label="İşlem tamamlanıyor" />
            ) : (
              <>
                {verify ? "E-posta adresimi doğrula" : "Parolamı yenile"}
                <ArrowRight size={18} />
              </>
            )}
          </Button>
        </form>
      )}
      {!done && (
        <Button
          variant="unstyled"
          size="unset"
          type="submit"
          className="auth-text-button recovery-back"
          disabled={!verify && !canSend}
          aria-describedby={
            !verify && !canSend ? "email-unavailable" : undefined
          }
          onClick={() => (verify ? onDone(link.action) : setForgot(true))}
        >
          {verify ? "Hesabıma dön" : "Yeni bağlantı iste"}
        </Button>
      )}
      {!done && !verify && !canSend && (
        <EmailUnavailableNotice id="email-unavailable">
          Yeni bir parola yenileme bağlantısı şu anda gönderilemiyor. Elindeki
          bağlantı geçerliyse yeni parolanı belirleyebilirsin.
        </EmailUnavailableNotice>
      )}
    </AuthLayout>
  );
}

export function VerificationGate({
  data,
  mailbox,
  onVerified,
  onLogout,
  emailDeliveryAvailable = data.emailDeliveryAvailable !== false,
}: {
  data: SessionBootstrap;
  mailbox?: string;
  onVerified: (data: SessionBootstrap) => void;
  onLogout: () => Promise<void>;
  emailDeliveryAvailable?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);
  async function perform(action: "check" | "resend" | "logout") {
    if (action === "resend" && !emailDeliveryAvailable) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (action === "logout") await onLogout();
      else if (action === "resend") {
        const result = await post<{ message: string }>(
          "/auth/resend-verification",
        );
        setMessage(result.message);
        setCooldown(60);
      } else {
        const result = await api<SessionBootstrap>("/auth/me");
        if (result.user.emailVerified) onVerified(result);
        else
          setMessage(
            emailDeliveryAvailable
              ? "Henüz doğrulama gelmedi. E-postandaki bağlantıyı açıp doğrulama düğmesine bas."
              : "E-posta adresin henüz doğrulanmamış. Daha önce gelen bir bağlantını kullanabilir veya çalışma alanı yöneticinle iletişime geçebilirsin.",
          );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthLayout>
      <span className="recovery-symbol">
        <Mail size={28} />
      </span>
      <span className="auth-greeting">
        Az kaldı, {data.user.name.split(" ")[0]}
      </span>
      <h2>
        {emailDeliveryAvailable
          ? "Gelen kutunda buluşalım."
          : "E-posta doğrulaması bekleniyor."}
      </h2>
      {emailDeliveryAvailable ? (
        <>
          <p>
            <strong className="verification-email">{data.user.email}</strong>{" "}
            adresine bir doğrulama bağlantısı gönderdik. Çalışma alanına girmek
            için e-postandaki adımı tamamla.
          </p>
          <div className="verification-steps">
            <span>
              <b>1</b>E-postandaki bağlantıyı aç.
            </span>
            <span>
              <b>2</b>E-posta adresini doğrula.
            </span>
            <span>
              <b>3</b>Buraya dön ve sohbete katıl.
            </span>
          </div>
        </>
      ) : (
        <EmailUnavailableNotice id="email-unavailable">
          <strong className="verification-email">{data.user.email}</strong>{" "}
          adresini doğrulaman gerekiyor; şu anda yeni bağlantı gönderilemiyor.
          Daha önce gelen bir bağlantın varsa onu kullanabilir, yoksa çalışma
          alanı yöneticinle iletişime geçebilirsin.
        </EmailUnavailableNotice>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="form-success" role="status">
          {message}
        </p>
      )}
      <Button
        variant="default"
        size="unset"
        type="submit"
        className="primary-button full-width"
        disabled={busy}
        onClick={() => void perform("check")}
      >
        {busy ? (
          <Spinner label="Kontrol ediliyor" />
        ) : (
          <>
            Doğrulamayı tamamladım
            <ArrowRight size={18} />
          </>
        )}
      </Button>
      <Button
        variant="outline"
        size="unset"
        type="submit"
        className="secondary-button full-width recovery-secondary"
        disabled={busy || cooldown > 0 || !emailDeliveryAvailable}
        aria-describedby={
          !emailDeliveryAvailable ? "email-unavailable" : undefined
        }
        onClick={() => void perform("resend")}
      >
        {cooldown
          ? `Tekrar gönder (${cooldown} sn)`
          : "E-postayı tekrar gönder"}
      </Button>
      {emailDeliveryAvailable && (
        <p className="recovery-detail">
          E-posta ulaşmadıysa istenmeyen posta klasörünü de kontrol et. Bağlantı
          24 saat geçerli.
        </p>
      )}
      <Button
        variant="unstyled"
        size="unset"
        type="submit"
        className="auth-text-button recovery-back"
        disabled={busy}
        onClick={() => void perform("logout")}
      >
        <ArrowLeft size={16} /> Farklı bir hesapla giriş yap
      </Button>
      {emailDeliveryAvailable && <LocalMailbox url={mailbox} />}
    </AuthLayout>
  );
}
