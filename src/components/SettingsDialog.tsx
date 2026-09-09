import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  Camera,
  Check,
  ChevronDown,
  LockKeyhole,
  LogOut,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type { User } from "../../shared/types";
import { api } from "../lib/api";
import { Avatar, Modal, Spinner } from "./ui";
import { SecuritySettings } from "./SecuritySettings";
import "./profile-settings.css";

interface SettingsDialogProps {
  user: User;
  workspaceId: string;
  connected?: boolean;
  isDemo: boolean;
  onClose: () => void;
  onSave: (user: User) => void;
  onPhotoChanged?: (user: User) => void;
  onLogout: () => void;
  quiet: boolean;
  onQuiet: () => void;
  onManage?: () => void;
}

type LeaveAction = "close" | "logout" | "manage";

function profileValues(user: User) {
  return {
    name: user.name,
    status: user.status || "",
    jobTitle: user.jobTitle || "",
    location: user.location || "",
    bio: user.bio || "",
  };
}

export function SettingsDialog(props: SettingsDialogProps) {
  return (
    <SettingsDialogForm
      key={`${props.workspaceId}:${props.user.id}`}
      {...props}
    />
  );
}

function SettingsDialogForm({
  user,
  workspaceId,
  connected = false,
  isDemo,
  onClose,
  onSave,
  onPhotoChanged,
  onLogout,
  quiet,
  onQuiet,
  onManage,
}: SettingsDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedNotice, setSavedNotice] = useState("");
  const [profileName, setProfileName] = useState(user.name);
  const [profileStatus, setProfileStatus] = useState(user.status || "");
  const [jobTitle, setJobTitle] = useState(user.jobTitle || "");
  const [location, setLocation] = useState(user.location || "");
  const [bio, setBio] = useState(user.bio || "");
  const [savedProfile, setSavedProfile] = useState(() => profileValues(user));
  const [leaveAction, setLeaveAction] = useState<LeaveAction | null>(null);
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [photoBusy, setPhotoBusy] = useState<"upload" | "remove" | null>(null);
  const [photoError, setPhotoError] = useState("");
  const [photoNotice, setPhotoNotice] = useState("");
  const [previewFailed, setPreviewFailed] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordSaved, setPasswordSaved] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const photoPicker = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false);
  const operation = useRef(false);
  const processing = busy || passwordBusy || Boolean(photoBusy);
  const profileChanged =
    profileName !== savedProfile.name ||
    profileStatus !== savedProfile.status ||
    jobTitle !== savedProfile.jobTitle ||
    location !== savedProfile.location ||
    bio !== savedProfile.bio;
  const requestHeaders = {
    "X-Workspace-Id": workspaceId,
    "X-User-Id": user.id,
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    setAvatarUrl(user.avatarUrl);
  }, [user.avatarUrl]);

  useEffect(() => {
    return () => {
      if (photo) URL.revokeObjectURL(photo.url);
    };
  }, [photo]);

  function leave(action: LeaveAction) {
    setLeaveAction(null);
    if (action === "logout") onLogout();
    else if (action === "manage") onManage?.();
    else onClose();
  }

  function requestLeave(action: LeaveAction) {
    if (operation.current) return;
    if (profileChanged || photo) setLeaveAction(action);
    else leave(action);
  }

  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || operation.current) return;
    setPhotoNotice("");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setPhotoError("PNG, JPG veya WebP biçiminde bir fotoğraf seç.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setPhotoError(
        "Fotoğrafın en fazla 5 MB olabilir. Daha küçük bir dosya seç.",
      );
      return;
    }
    if (!file.size) {
      setPhotoError("Bu dosya boş. Farklı bir fotoğraf seç.");
      return;
    }
    setPhotoError("");
    setPreviewFailed(false);
    setPhoto({ file, url: URL.createObjectURL(file) });
  }

  async function savePhoto(action: "upload" | "remove") {
    if (operation.current || (action === "upload" && (!photo || previewFailed)))
      return;
    operation.current = true;
    setPhotoBusy(action);
    setPhotoError("");
    setPhotoNotice("");
    try {
      const form = new FormData();
      if (photo && action === "upload") form.append("file", photo.file);
      const saved = await api<User>("/profile/avatar", {
        method: action === "upload" ? "POST" : "DELETE",
        headers: requestHeaders,
        ...(action === "upload" ? { body: form } : {}),
      });
      if (!mounted.current) return;
      setAvatarUrl(saved.avatarUrl);
      setPhoto(null);
      setPhotoNotice(
        action === "upload"
          ? "Profil fotoğrafın güncellendi."
          : "Profil fotoğrafın kaldırıldı.",
      );
      (onPhotoChanged || onSave)(saved);
      requestAnimationFrame(() => {
        if (mounted.current) photoPicker.current?.focus();
      });
    } catch (error) {
      if (mounted.current)
        setPhotoError(
          error instanceof Error
            ? error.message
            : "Fotoğrafın güncellenemedi. Yeniden deneyebilirsin.",
        );
    } finally {
      operation.current = false;
      if (mounted.current) setPhotoBusy(null);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError("");
    setSavedNotice("");
    try {
      const saved = await api<User>("/profile", {
        method: "PATCH",
        headers: requestHeaders,
        body: JSON.stringify({
          name: profileName.trim(),
          status: profileStatus.trim(),
          jobTitle: jobTitle.trim(),
          location: location.trim(),
          bio: bio.trim(),
        }),
      });
      if (!mounted.current) return;
      setProfileName(saved.name);
      setProfileStatus(saved.status || "");
      setJobTitle(saved.jobTitle || "");
      setLocation(saved.location || "");
      setBio(saved.bio || "");
      setSavedProfile(profileValues(saved));
      setSavedNotice("Profilin güncellendi.");
      onSave(saved);
    } catch (error) {
      if (mounted.current)
        setError(
          error instanceof Error
            ? error.message
            : "Profilin kaydedilemedi. Yeniden deneyebilirsin.",
        );
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operation.current || isDemo) return;
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
    operation.current = true;
    setPasswordBusy(true);
    try {
      await api("/auth/password", {
        method: "PATCH",
        headers: requestHeaders,
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!mounted.current) return;
      form.reset();
      setPasswordSaved(true);
    } catch (error) {
      if (mounted.current)
        setPasswordError(
          error instanceof Error
            ? error.message
            : "Parolan değiştirilemedi. Yeniden deneyebilirsin.",
        );
    } finally {
      operation.current = false;
      if (mounted.current) setPasswordBusy(false);
    }
  }

  return (
    <Modal title="Kendine ait bir köşe" onClose={() => requestLeave("close")}>
      <div className="profile-settings">
        <section
          className="profile-photo-section"
          aria-label="Profil fotoğrafı"
        >
          <div className="profile-photo-preview">
            {photo && !previewFailed ? (
              <img
                src={photo.url}
                alt="Yeni profil fotoğrafının önizlemesi"
                onError={() => {
                  setPreviewFailed(true);
                  setPhotoError(
                    "Bu fotoğraf açılamadı. Farklı bir PNG, JPG veya WebP dosyası seç.",
                  );
                }}
              />
            ) : (
              <Avatar
                user={{ ...user, avatarUrl }}
                size="large"
                online={connected}
              />
            )}
            {photo && <span className="profile-photo-pending">Önizleme</span>}
          </div>
          <div className="profile-photo-controls">
            <strong>Profil fotoğrafın</strong>
            <p>Ekibinin seni bir bakışta tanımasını sağla.</p>
            <div className="profile-photo-buttons">
              <button
                ref={photoPicker}
                type="button"
                className="secondary-button"
                disabled={processing}
                onClick={() => fileInput.current?.click()}
              >
                <Camera size={15} aria-hidden="true" />
                {photo || avatarUrl ? "Fotoğrafı değiştir" : "Fotoğraf ekle"}
              </button>
              {avatarUrl && !photo && (
                <button
                  type="button"
                  className="profile-text-button profile-remove-photo"
                  disabled={processing}
                  onClick={() => void savePhoto("remove")}
                >
                  {photoBusy === "remove" ? (
                    <Spinner label="Kaldırılıyor" />
                  ) : (
                    <>
                      <Trash2 size={14} aria-hidden="true" /> Fotoğrafı kaldır
                    </>
                  )}
                </button>
              )}
            </div>
            <input
              ref={fileInput}
              className="visually-hidden"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label="Profil fotoğrafı seç"
              aria-describedby="profile-photo-guidance"
              tabIndex={-1}
              disabled={processing}
              onChange={choosePhoto}
            />
            <small id="profile-photo-guidance">
              PNG, JPG veya WebP · En fazla 5 MB
            </small>
          </div>
          {photo && (
            <div className="profile-photo-confirm">
              <p>
                Fotoğrafın kare olarak görünür. Kaydettiğinde tüm çalışma
                alanlarında güncellenir.
              </p>
              <div>
                <button
                  type="button"
                  className="primary-button"
                  disabled={processing || previewFailed}
                  onClick={() => void savePhoto("upload")}
                >
                  {photoBusy === "upload" ? (
                    <Spinner label="Fotoğraf yükleniyor" />
                  ) : (
                    <>
                      <Check size={15} aria-hidden="true" /> Fotoğrafı kaydet
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="profile-text-button"
                  disabled={processing}
                  onClick={() => {
                    setPhoto(null);
                    setPhotoError("");
                    setPreviewFailed(false);
                  }}
                >
                  Vazgeç
                </button>
              </div>
            </div>
          )}
          {photoError && (
            <p className="form-error" role="alert">
              {photoError}
            </p>
          )}
          {photoNotice && (
            <p className="profile-save-notice" role="status">
              <Check size={14} aria-hidden="true" />
              {photoNotice}
            </p>
          )}
        </section>
        <div className="profile-settings-intro">
          <h3>Profil bilgilerin</h3>
          <p>Ekip arkadaşların bu bilgileri profilinde görebilir.</p>
        </div>
        <form
          onSubmit={saveProfile}
          aria-label="Profil ayarları"
          className="profile-settings-form"
          onChange={() => setSavedNotice("")}
        >
          <div className="profile-fields-row">
            <label>
              Adın soyadın
              <input
                name="name"
                value={profileName}
                onChange={(event) => setProfileName(event.target.value)}
                autoComplete="name"
                required
                minLength={2}
                maxLength={60}
                disabled={processing}
              />
            </label>
            <label>
              Durumun
              <input
                name="status"
                value={profileStatus}
                onChange={(event) => setProfileStatus(event.target.value)}
                placeholder="Örn. Tasarıma odaklandım"
                maxLength={100}
                disabled={processing}
              />
            </label>
          </div>
          <div className="profile-fields-row">
            <label>
              Unvanın
              <input
                name="jobTitle"
                value={jobTitle}
                onChange={(event) => setJobTitle(event.target.value)}
                placeholder="Örn. Ürün tasarımcısı"
                maxLength={80}
                autoComplete="organization-title"
                disabled={processing}
              />
            </label>
            <label>
              Konumun
              <input
                name="location"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                placeholder="Örn. İstanbul"
                maxLength={80}
                autoComplete="address-level2"
                disabled={processing}
              />
            </label>
          </div>
          <label>
            <span id="profile-bio-label">Hakkında</span>
            <textarea
              name="bio"
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              placeholder="Nelerle ilgileniyorsun? Ekibin sana hangi konularda ulaşabilir?"
              maxLength={500}
              rows={3}
              disabled={processing}
              aria-labelledby="profile-bio-label"
              aria-describedby="profile-bio-guidance"
            />
            <span className="profile-field-hint" id="profile-bio-guidance">
              <span>Kendini birkaç cümleyle tanıt.</span>
              <span>{bio.length}/500</span>
            </span>
          </label>
          <div className="profile-account-email">
            <span>E-posta</span>
            <strong>{user.email}</strong>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {savedNotice && (
            <p className="profile-save-notice" role="status">
              <Check size={14} aria-hidden="true" />
              {savedNotice}
            </p>
          )}
          <div className="profile-save-row">
            <small>Bilgilerin tüm çalışma alanlarında güncellenir.</small>
            <button
              className="primary-button"
              type="submit"
              disabled={processing}
            >
              {busy ? (
                <Spinner label="Kaydediliyor" />
              ) : (
                <>
                  <Check size={16} aria-hidden="true" /> Değişiklikleri kaydet
                </>
              )}
            </button>
          </div>
        </form>
        <div className="profile-settings-preferences">
          <button
            className="settings-toggle"
            type="button"
            role="switch"
            aria-checked={quiet}
            onClick={onQuiet}
            disabled={processing}
          >
            <span>
              <strong>Biraz odak zamanı</strong>
              <small>
                Uygulama içindeki yeni mesaj uyarılarını sessize al.
              </small>
            </span>
            <span
              className={`switch ${quiet ? "on" : ""}`}
              aria-hidden="true"
            />
          </button>
        </div>
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
                  disabled={processing}
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
                  disabled={processing}
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
                  disabled={processing}
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
                disabled={processing}
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
            onClick={() => requestLeave("manage")}
            disabled={processing}
          >
            <ShieldCheck size={17} /> Yönetim panelini aç
          </button>
        )}
        <button
          className="logout-button"
          type="button"
          onClick={() => requestLeave("logout")}
          disabled={processing}
        >
          <LogOut size={17} />
          Çıkış yap
        </button>
      </div>
      {leaveAction && (
        <Modal
          title="Kaydedilmemiş değişikliklerin var"
          onClose={() => setLeaveAction(null)}
        >
          <div className="profile-discard-confirm">
            <p>
              {profileChanged && photo
                ? "Profil bilgilerindeki düzenlemeler ve seçtiğin fotoğraf henüz kaydedilmedi."
                : photo
                  ? "Seçtiğin fotoğraf henüz kaydedilmedi."
                  : "Profil bilgilerindeki düzenlemeler henüz kaydedilmedi."}{" "}
              Ayrılırsan bu değişiklikler kaybolacak.
            </p>
            {leaveAction !== "close" && (
              <p className="profile-discard-destination">
                {leaveAction === "logout"
                  ? "Devam edersen hesabından çıkış yapılacak."
                  : "Devam edersen yönetim paneli açılacak."}
              </p>
            )}
            <div className="profile-discard-actions">
              <button
                type="button"
                className="primary-button"
                data-autofocus
                onClick={() => setLeaveAction(null)}
              >
                Düzenlemeye devam et
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  if (!operation.current) leave(leaveAction);
                }}
              >
                Değişiklikleri bırak
              </button>
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
