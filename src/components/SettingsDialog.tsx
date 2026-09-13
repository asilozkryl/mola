import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  Bell,
  Building2,
  Camera,
  Check,
  ChevronDown,
  LockKeyhole,
  LogOut,
  Monitor,
  Moon,
  Palette,
  ShieldCheck,
  Sun,
  Trash2,
  UserRound,
} from "lucide-react";
import type { User } from "../../shared/types";
import { api } from "../lib/api";
import { useAppearance } from "../lib/appearance";
import { Avatar, Modal, Spinner } from "./ui";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Switch } from "./ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import { SecuritySettings } from "./SecuritySettings";
import "./profile-settings.css";
import "./settings-center.css";

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
  onNotifications?: () => void;
}

type LeaveAction = "close" | "logout" | "manage" | "notifications";
type SettingsSection =
  "profile" | "appearance" | "notifications" | "security" | "workspace";

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
  onNotifications,
}: SettingsDialogProps) {
  const [section, setSection] = useState<SettingsSection>("profile");
  const [narrow, setNarrow] = useState(
    () => window.matchMedia("(max-width: 680px)").matches,
  );
  const { theme, density, setTheme, setDensity } = useAppearance();
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
    const query = window.matchMedia("(max-width: 680px)");
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

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
    else if (action === "notifications") onNotifications?.();
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
      <Tabs
        value={section}
        onValueChange={(value) => {
          if (!operation.current) setSection(value as SettingsSection);
        }}
        orientation={narrow ? "horizontal" : "vertical"}
        className="settings-center"
      >
        <aside className="settings-center-sidebar">
          <div className="settings-center-account">
            <Avatar user={{ ...user, avatarUrl }} size="small" />
            <div>
              <strong>{user.name}</strong>
              <span>Kişisel ayarların</span>
            </div>
          </div>
          <TabsList
            aria-label="Ayar kategorileri"
            className="settings-center-nav"
          >
            <TabsTrigger
              value="profile"
              disabled={processing}
              aria-description={
                profileChanged || photo
                  ? "Kaydedilmemiş değişikliklerin var"
                  : undefined
              }
            >
              <UserRound size={16} aria-hidden="true" /> Profil
              {(profileChanged || photo) && (
                <span className="settings-draft-dot" aria-hidden="true" />
              )}
            </TabsTrigger>
            <TabsTrigger value="appearance" disabled={processing}>
              <Palette size={16} aria-hidden="true" /> Görünüm
            </TabsTrigger>
            <TabsTrigger value="notifications" disabled={processing}>
              <Bell size={16} aria-hidden="true" /> Bildirimler
            </TabsTrigger>
            <TabsTrigger value="security" disabled={processing}>
              <ShieldCheck size={16} aria-hidden="true" /> Güvenlik
            </TabsTrigger>
            {onManage && (
              <TabsTrigger value="workspace" disabled={processing}>
                <Building2 size={16} aria-hidden="true" /> Çalışma alanı
              </TabsTrigger>
            )}
          </TabsList>
          <Button
            variant="ghost"
            className="settings-center-logout logout-button"
            title="Çıkış yap"
            onClick={() => requestLeave("logout")}
            disabled={processing}
          >
            <LogOut size={16} aria-hidden="true" /> Çıkış yap
          </Button>
        </aside>
        <div className="settings-center-body">
          <TabsContent
            value="profile"
            keepMounted
            className="settings-center-panel profile-settings"
          >
            <div className="settings-section-heading">
              <h3>Profilin</h3>
              <p>
                Ekibinin seni tanıdığı yer. Bilgilerini ve fotoğrafını düzenle.
              </p>
            </div>
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
                {photo && (
                  <span className="profile-photo-pending">Önizleme</span>
                )}
              </div>
              <div className="profile-photo-controls">
                <strong>Profil fotoğrafın</strong>
                <p>Ekibinin seni bir bakışta tanımasını sağla.</p>
                <div className="profile-photo-buttons">
                  <Button
                    ref={photoPicker}
                    type="button"
                    variant="outline"
                    className="secondary-button"
                    disabled={processing}
                    onClick={() => fileInput.current?.click()}
                  >
                    <Camera size={15} aria-hidden="true" />
                    {photo || avatarUrl
                      ? "Fotoğrafı değiştir"
                      : "Fotoğraf ekle"}
                  </Button>
                  {avatarUrl && !photo && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="profile-text-button profile-remove-photo"
                      disabled={processing}
                      onClick={() => void savePhoto("remove")}
                    >
                      {photoBusy === "remove" ? (
                        <Spinner label="Kaldırılıyor" />
                      ) : (
                        <>
                          <Trash2 size={14} aria-hidden="true" /> Fotoğrafı
                          kaldır
                        </>
                      )}
                    </Button>
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
                    <Button
                      type="button"
                      className="primary-button"
                      disabled={processing || previewFailed}
                      onClick={() => void savePhoto("upload")}
                    >
                      {photoBusy === "upload" ? (
                        <Spinner label="Fotoğraf yükleniyor" />
                      ) : (
                        <>
                          <Check size={15} aria-hidden="true" /> Fotoğrafı
                          kaydet
                        </>
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="profile-text-button"
                      disabled={processing}
                      onClick={() => {
                        setPhoto(null);
                        setPhotoError("");
                        setPreviewFailed(false);
                      }}
                    >
                      Vazgeç
                    </Button>
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
                  <Input
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
                  <Input
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
                  <Input
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
                  <Input
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
                <Textarea
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
                <Button
                  className="primary-button"
                  type="submit"
                  disabled={processing}
                >
                  {busy ? (
                    <Spinner label="Kaydediliyor" />
                  ) : (
                    <>
                      <Check size={16} aria-hidden="true" /> Değişiklikleri
                      kaydet
                    </>
                  )}
                </Button>
              </div>
            </form>
          </TabsContent>
          <TabsContent
            value="appearance"
            keepMounted
            className="settings-center-panel"
          >
            <div className="settings-section-heading">
              <h3>Görünüm</h3>
              <p>Mola’yı gözün ve çalışma düzenin için rahat bir hale getir.</p>
            </div>
            <fieldset className="settings-choice-group">
              <legend>Tema</legend>
              <p>Ayarın bu tarayıcıda saklanır ve anında uygulanır.</p>
              <div
                className="settings-theme-options"
                role="group"
                aria-label="Tema seçimi"
              >
                {(
                  [
                    { value: "light", label: "Açık", Icon: Sun },
                    { value: "dark", label: "Koyu", Icon: Moon },
                    { value: "system", label: "Sistem", Icon: Monitor },
                  ] as const
                ).map(({ value, label, Icon }) => (
                  <Button
                    key={value}
                    variant="outline"
                    className={`settings-theme-option settings-theme-${value}`}
                    aria-pressed={theme === value}
                    onClick={() => setTheme(value)}
                  >
                    <span className="settings-theme-preview" aria-hidden="true">
                      <i />
                      <span>
                        <b />
                        <b />
                        <b />
                      </span>
                    </span>
                    <span className="settings-choice-label">
                      <Icon size={15} aria-hidden="true" />
                      {label}
                      {theme === value && (
                        <Check size={14} aria-hidden="true" />
                      )}
                    </span>
                  </Button>
                ))}
              </div>
            </fieldset>
            <fieldset className="settings-choice-group">
              <legend>Görünüm yoğunluğu</legend>
              <p>Kanal listesi ve mesajlar arasındaki boşluğu seç.</p>
              <div
                className="settings-density-options"
                role="group"
                aria-label="Görünüm yoğunluğu"
              >
                <Button
                  variant="outline"
                  className="settings-density-option"
                  aria-pressed={density === "compact"}
                  onClick={() => setDensity("compact")}
                >
                  <span
                    className="settings-density-preview settings-density-compact"
                    aria-hidden="true"
                  >
                    <i />
                    <i />
                    <i />
                  </span>
                  <span>
                    <strong>Kompakt</strong>
                    <small>Ekranda daha fazla içerik</small>
                  </span>
                  {density === "compact" && (
                    <Check size={16} aria-hidden="true" />
                  )}
                </Button>
                <Button
                  variant="outline"
                  className="settings-density-option"
                  aria-pressed={density === "comfortable"}
                  onClick={() => setDensity("comfortable")}
                >
                  <span className="settings-density-preview" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span>
                    <strong>Rahat</strong>
                    <small>Biraz daha geniş aralıklar</small>
                  </span>
                  {density === "comfortable" && (
                    <Check size={16} aria-hidden="true" />
                  )}
                </Button>
              </div>
            </fieldset>
          </TabsContent>
          <TabsContent
            value="notifications"
            keepMounted
            className="settings-center-panel"
          >
            <div className="settings-section-heading">
              <h3>Bildirimler</h3>
              <p>Çalışma ritmine uygun bildirimleri seç.</p>
            </div>
            <div className="settings-preference-row">
              <label htmlFor="settings-quiet">
                <strong>Biraz odak zamanı</strong>
                <span>
                  Uygulama içindeki yeni mesaj uyarılarını sessize al.
                </span>
              </label>
              <Switch
                id="settings-quiet"
                checked={quiet}
                onCheckedChange={onQuiet}
                disabled={processing}
              />
            </div>
            {onNotifications && (
              <div className="settings-linked-panel">
                <Bell size={20} aria-hidden="true" />
                <div>
                  <h4>Bildirim tercihlerin</h4>
                  <p>
                    Kanal bildirimlerini, sessiz saatlerini ve tarayıcı
                    bildirimlerini yönet.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => requestLeave("notifications")}
                    disabled={processing}
                  >
                    Bildirim tercihlerini aç
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>
          <TabsContent
            value="security"
            keepMounted
            className="settings-center-panel"
          >
            <div className="settings-section-heading">
              <h3>Hesap güvenliği</h3>
              <p>
                Parolanı, iki aşamalı doğrulamayı ve açık oturumlarını yönet.
              </p>
            </div>
            {isDemo && (
              <p className="settings-demo-note">
                Parola ve cihaz ayarları kendi hesabınla giriş yaptığında
                kullanılabilir.
              </p>
            )}
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
                    <Input
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
                    <Input
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
                    <Input
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
                      Parolan değiştirildi. Diğer cihazlardaki oturumların
                      güvenle kapatıldı.
                    </p>
                  )}
                  <Button
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
                  </Button>
                </form>
              </details>
            )}
            {!isDemo && <SecuritySettings />}
          </TabsContent>
          {onManage && (
            <TabsContent
              value="workspace"
              keepMounted
              className="settings-center-panel"
            >
              <div className="settings-section-heading">
                <h3>Çalışma alanı</h3>
                <p>Ekibinin çalışma alanını tek yerden yönet.</p>
              </div>
              <div className="settings-linked-panel">
                <Building2 size={22} aria-hidden="true" />
                <div>
                  <h4>Çalışma alanı yönetimi</h4>
                  <p>
                    Üyeler, davetler ve çalışma alanı ayarlarına buradan
                    ulaşabilirsin.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => requestLeave("manage")}
                    disabled={processing}
                  >
                    <ShieldCheck size={17} /> Yönetim panelini aç
                  </Button>
                </div>
              </div>
            </TabsContent>
          )}
        </div>
      </Tabs>
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
                  : leaveAction === "notifications"
                    ? "Devam edersen bildirim tercihlerin açılacak."
                    : "Devam edersen yönetim paneli açılacak."}
              </p>
            )}
            <div className="profile-discard-actions">
              <Button
                type="button"
                className="primary-button"
                data-autofocus
                onClick={() => setLeaveAction(null)}
              >
                Düzenlemeye devam et
              </Button>
              <Button
                type="button"
                variant="outline"
                className="secondary-button"
                onClick={() => {
                  if (!operation.current) leave(leaveAction);
                }}
              >
                Değişiklikleri bırak
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
