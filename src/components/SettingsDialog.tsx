import { useState, type FormEvent } from "react";
import {
  Check,
  ChevronDown,
  LockKeyhole,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import type { User } from "../../shared/types";
import { api } from "../lib/api";
import { Avatar, Modal, Spinner } from "./ui";
import { SecuritySettings } from "./SecuritySettings";

interface SettingsDialogProps {
  user: User;
  isDemo: boolean;
  onClose: () => void;
  onSave: (user: User) => void;
  onLogout: () => void;
  quiet: boolean;
  onQuiet: () => void;
  onManage?: () => void;
}

export function SettingsDialog({
  user,
  isDemo,
  onClose,
  onSave,
  onLogout,
  quiet,
  onQuiet,
  onManage,
}: SettingsDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordSaved, setPasswordSaved] = useState(false);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const saved = await api<User>("/profile", {
        method: "PATCH",
        body: JSON.stringify({
          name: values.get("name"),
          status: values.get("status"),
        }),
      });
      onSave(saved);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Profilin kaydedilemedi. Yeniden deneyebilirsin.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (passwordBusy || isDemo) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const currentPassword = String(values.get("currentPassword") || "");
    const newPassword = String(values.get("newPassword") || "");
    const confirmation = String(values.get("confirmPassword") || "");
    setPasswordError("");
    setPasswordSaved(false);
    if (newPassword.length < 12 || newPassword.length > 128) {
      setPasswordError("Yeni parolan 12–128 karakter uzunluğunda olmalı.");
      return;
    }
    if (newPassword !== confirmation) {
      setPasswordError(
        "Yeni parolaların eşleşmiyor. İki alana da aynı parolayı yaz.",
      );
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError("Yeni parolan mevcut parolandan farklı olmalı.");
      return;
    }
    setPasswordBusy(true);
    try {
      await api("/auth/password", {
        method: "PATCH",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      form.reset();
      setPasswordSaved(true);
    } catch (error) {
      setPasswordError(
        error instanceof Error
          ? error.message
          : "Parolan değiştirilemedi. Yeniden deneyebilirsin.",
      );
    } finally {
      setPasswordBusy(false);
    }
  }

  return (
    <Modal title="Kendine ait bir köşe" onClose={onClose}>
      <div className="profile-preview">
        <Avatar user={user} size="large" online />
        <span>
          <strong>{user.name}</strong>
          <small>{user.email}</small>
        </span>
      </div>
      <form onSubmit={saveProfile} aria-label="Profil ayarları">
        <label>
          Adın soyadın
          <input
            name="name"
            defaultValue={user.name}
            autoComplete="name"
            required
            minLength={2}
            maxLength={60}
            disabled={busy}
          />
        </label>
        <label>
          Durumun
          <input
            name="status"
            defaultValue={user.status || ""}
            placeholder="Örn. 🎨 Güzel bir şeyler tasarlıyorum"
            maxLength={100}
            disabled={busy}
          />
        </label>
        <button
          className="settings-toggle"
          type="button"
          role="switch"
          aria-checked={quiet}
          onClick={onQuiet}
        >
          <span>
            <strong>Biraz odak zamanı</strong>
            <small>Uygulama içindeki yeni mesaj uyarılarını sessize al.</small>
          </span>
          <span className={`switch ${quiet ? "on" : ""}`} aria-hidden="true" />
        </button>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="primary-button full-width"
          type="submit"
          disabled={busy || passwordBusy}
        >
          {busy ? (
            <Spinner label="Kaydediliyor" />
          ) : (
            <>
              <Check size={17} />
              Değişiklikleri kaydet
            </>
          )}
        </button>
      </form>
      {!isDemo && (
        <details className="settings-security">
          <summary className="settings-toggle">
            <span>
              <strong>Parolanı değiştir</strong>
              <small>Hesabının güvenliği senin elinde.</small>
            </span>
            <ChevronDown size={17} aria-hidden="true" />
          </summary>
          <form onSubmit={changePassword} aria-label="Parola değiştirme">
            <p className="modal-description" id="password-guidance">
              Yeni parolan en az 12 karakter olmalı. Kaydettiğinde diğer
              cihazlardaki oturumların kapanır; bu oturumun açık kalır.
            </p>
            <input
              type="hidden"
              name="username"
              autoComplete="username"
              value={user.email}
              readOnly
            />
            <label>
              Mevcut parolan
              <input
                type="password"
                name="currentPassword"
                autoComplete="current-password"
                required
                maxLength={128}
                disabled={passwordBusy}
              />
            </label>
            <label>
              Yeni parolan
              <input
                type="password"
                name="newPassword"
                autoComplete="new-password"
                aria-describedby="password-guidance"
                required
                minLength={12}
                maxLength={128}
                disabled={passwordBusy}
              />
            </label>
            <label>
              Yeni parolanı tekrar yaz
              <input
                type="password"
                name="confirmPassword"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
                disabled={passwordBusy}
              />
            </label>
            {passwordError && (
              <p className="form-error" role="alert">
                {passwordError}
              </p>
            )}
            {passwordSaved && (
              <p className="modal-description" role="status">
                Parolan değiştirildi. Diğer cihazlardaki oturumların güvenle
                kapatıldı.
              </p>
            )}
            <button
              className="primary-button full-width"
              type="submit"
              disabled={passwordBusy || busy}
            >
              {passwordBusy ? (
                <Spinner label="Parolan değiştiriliyor" />
              ) : (
                <>
                  <LockKeyhole size={17} />
                  Parolayı güncelle
                </>
              )}
            </button>
          </form>
        </details>
      )}
      {!isDemo && <SecuritySettings />}
      {onManage && (
        <button
          type="button"
          className="secondary-button full-width"
          onClick={onManage}
        >
          <ShieldCheck size={17} /> Yönetim panelini aç
        </button>
      )}
      <button
        className="logout-button"
        type="button"
        onClick={onLogout}
        disabled={busy || passwordBusy}
      >
        <LogOut size={17} />
        Çıkış yap
      </button>
    </Modal>
  );
}
