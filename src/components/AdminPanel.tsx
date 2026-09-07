import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Archive,
  ArrowLeft,
  Check,
  Copy,
  Hash,
  History,
  Link,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Users,
  Volume2,
} from "lucide-react";
import type {
  Bootstrap,
  Channel,
  WorkspaceAdminData,
} from "../../shared/types";
import { api, post, ApiError } from "../lib/api";
import { Avatar, Logo, Modal, Spinner, fileSize } from "./ui";
import SystemAdmin from "./SystemAdmin";
import "./admin.css";

type Section =
  "members" | "channels" | "invites" | "settings" | "audit" | "system";
type Snapshot = WorkspaceAdminData;
type Action = {
  title: string;
  description: string;
  label: string;
  path: string;
  method: "PATCH" | "POST" | "DELETE";
  body?: object;
  password?: boolean;
};
const date = (value: string) =>
  new Date(value).toLocaleString("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
const auditNames: Record<string, string> = {
  "workspace.renamed": "Çalışma alanı güncellendi",
  "workspace.member.suspended": "Üye askıya alındı",
  "workspace.member.restored": "Üye etkinleştirildi",
  "system.member.suspended": "Hesap askıya alındı",
  "system.member.restored": "Hesap etkinleştirildi",
  "workspace.ownership.transferred": "Sahiplik devredildi",
  "system.workspace.suspended": "Çalışma alanı askıya alındı",
  "system.workspace.restored": "Çalışma alanı etkinleştirildi",
  "system.admin.granted": "Uygulama yöneticisi atandı",
  "system.admin.revoked": "Uygulama yöneticisi yetkisi kaldırıldı",
  "site_admin.granted": "Uygulama yöneticisi atandı",
  "site_admin.revoked": "Uygulama yöneticisi yetkisi kaldırıldı",
  "channel.created": "Kanal oluşturuldu",
  "workspace.updated": "Çalışma alanı güncellendi",
  "member.suspended": "Üye askıya alındı",
  "member.reactivated": "Üye etkinleştirildi",
  "ownership.transferred": "Sahiplik devredildi",
  "channel.updated": "Kanal güncellendi",
  "channel.archived": "Kanal arşivlendi",
  "channel.restored": "Kanal arşivden çıkarıldı",
  "invite.revoked": "Davet iptal edildi",
  "invite.created": "Davet oluşturuldu",
  "workspace.suspended": "Çalışma alanı askıya alındı",
  "workspace.reactivated": "Çalışma alanı etkinleştirildi",
};

export default function AdminPanel({
  data,
  onClose,
  onChanged,
}: {
  data: Bootstrap;
  onClose: () => void;
  onChanged: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [section, setSection] = useState<Section>(
    data.workspace.suspended && data.user.siteAdmin ? "system" : "members",
  );
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [action, setAction] = useState<Action>();
  const [actionError, setActionError] = useState("");
  const [editing, setEditing] = useState<Channel | "new">();
  const [inviteUrl, setInviteUrl] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const canManage = data.user.role === "owner" || data.user.siteAdmin;
  const changedRef = useRef(onChanged);
  changedRef.current = onChanged;
  const refresh = useCallback(async () => {
    setError("");
    if (data.workspace.suspended) {
      setLoading(false);
      return;
    }
    try {
      setSnapshot(await api<Snapshot>("/admin/workspace"));
    } catch (e) {
      setSnapshot(undefined);
      setError((e as Error).message);
      if (e instanceof ApiError && (e.status === 401 || e.status === 403))
        changedRef.current();
    } finally {
      setLoading(false);
    }
  }, [data.workspace.suspended]);
  useEffect(() => {
    if (data.workspace.suspended && data.user.siteAdmin) setSection("system");
  }, [data.workspace.suspended, data.user.siteAdmin]);
  useEffect(() => {
    dialog.current?.showModal();
    const node = dialog.current;
    return () => node?.close();
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!canManage) onClose();
  }, [canManage, onClose]);
  useEffect(() => {
    if (section === "system" && !data.user.siteAdmin) setSection("members");
  }, [section, data.user.siteAdmin]);
  useEffect(() => {
    const reload = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("mola:admin-refresh", reload);
    document.addEventListener("visibilitychange", reload);
    return () => {
      window.removeEventListener("mola:admin-refresh", reload);
      document.removeEventListener("visibilitychange", reload);
    };
  }, [refresh]);
  const changed = async (message: string) => {
    setNotice(message);
    onChanged();
    await refresh();
  };
  const confirm = (next: Action) => {
    setActionError("");
    setAction(next);
  };
  async function runAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || busy) return;
    const currentPassword = String(
      new FormData(event.currentTarget).get("currentPassword") || "",
    );
    setBusy(true);
    setActionError("");
    try {
      await api(action.path, {
        method: action.method,
        body:
          action.method === "DELETE"
            ? undefined
            : JSON.stringify({
                ...action.body,
                ...(action.password ? { currentPassword } : {}),
              }),
      });
      setAction(undefined);
      await changed("Değişiklik kaydedildi.");
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || busy) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setActionError("");
    try {
      if (editing === "new") await post("/channels", values);
      else
        await api(`/admin/workspace/channels/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(values),
        });
      setEditing(undefined);
      await changed(
        editing === "new" ? "Yeni kanal oluşturuldu." : "Kanal güncellendi.",
      );
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function createInvite() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await post<{ url: string }>("/invites");
      setInviteUrl(result.url);
      await changed("Davet bağlantısı hazır. Ekibinle paylaşabilirsin.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const name = new FormData(event.currentTarget).get("name");
    setBusy(true);
    setError("");
    try {
      await api("/admin/workspace", {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      await changed("Çalışma alanının adı güncellendi.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const nav = [
    ["members", "Üyeler", Users],
    ["channels", "Kanallar", Hash],
    ["invites", "Davetler", Link],
    ["settings", "Ekip ayarları", Settings2],
    ["audit", "İşlem geçmişi", History],
  ] as const;
  const matches = (text: string) =>
    text.toLocaleLowerCase("tr").includes(query.toLocaleLowerCase("tr").trim());
  const members =
    snapshot?.members.filter((m) => matches(`${m.name} ${m.email}`)) || [];
  const channels =
    snapshot?.channels.filter(
      (c) =>
        c.kind !== "dm" &&
        Boolean(c.archived) === showArchived &&
        matches(`${c.name} ${c.description}`),
    ) || [];
  return (
    <dialog
      ref={dialog}
      className="adm-dialog"
      aria-label="Yönetim paneli"
      onCancel={(event) => {
        event.preventDefault();
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="adm-shell">
        <aside className="adm-nav">
          <Logo />
          <button className="adm-back" onClick={onClose}>
            <ArrowLeft size={17} /> Sohbete dön
          </button>
          <div className="adm-workspace">
            <span>
              {data.workspace.name.slice(0, 1).toLocaleUpperCase("tr")}
            </span>
            <strong>
              {data.workspace.name}
              <small>Yönetim paneli</small>
            </strong>
          </div>
          <nav aria-label="Yönetim bölümleri">
            {nav.map(([key, label, Icon]) => (
              <button
                key={key}
                aria-current={section === key ? "page" : undefined}
                disabled={Boolean(data.workspace.suspended)}
                onClick={() => {
                  setSection(key);
                  setQuery("");
                  setNotice("");
                }}
              >
                <Icon size={18} />
                {label}
              </button>
            ))}
          </nav>
          {data.user.siteAdmin && (
            <button
              className={`adm-system-link ${section === "system" ? "selected" : ""}`}
              aria-current={section === "system" ? "page" : undefined}
              onClick={() => setSection("system")}
            >
              <ShieldCheck size={18} /> Genel yönetim
            </button>
          )}
          <div className="adm-identity">
            <Avatar user={data.user} size="small" />
            <span>
              {data.user.name}
              <small>
                {data.user.siteAdmin
                  ? "Uygulama yöneticisi"
                  : "Çalışma alanı sahibi"}
              </small>
            </span>
          </div>
        </aside>
        <main className="adm-main">
          {section === "system" && data.user.siteAdmin ? (
            <SystemAdmin
              currentUser={data.user}
              onNotice={setNotice}
              onChanged={onChanged}
            />
          ) : (
            <>
              <header className="adm-heading">
                <div>
                  <h1>{nav.find(([key]) => key === section)?.[1]}</h1>
                  <p>
                    {section === "members"
                      ? "Ekibindeki insanlar ve erişimleri."
                      : section === "channels"
                        ? "Her konuya bir yer, her kanala bir düzen."
                        : section === "invites"
                          ? "Ekibe katılım bağlantılarını buradan yönet."
                          : section === "settings"
                            ? "Ekibinin adı ve çalışma alanının sahipliği."
                            : "Yönetim değişikliklerinin kaydı."}
                  </p>
                </div>
                <span className="adm-owner-label">
                  <ShieldCheck size={16} /> Ekip yönetimi
                </span>
              </header>
              {loading ? (
                <Spinner label="Yönetim bilgileri yükleniyor" />
              ) : (
                snapshot && (
                  <>
                    {(section === "members" || section === "channels") && (
                      <div className="adm-toolbar">
                        <label className="adm-search">
                          <Search size={18} />
                          <input
                            aria-label={
                              section === "members"
                                ? "Üyelerde ara"
                                : "Kanallarda ara"
                            }
                            placeholder={
                              section === "members"
                                ? "İsim veya e-posta ile ara"
                                : "Kanal adı ile ara"
                            }
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                          />
                        </label>
                        {section === "members" ? (
                          <button
                            className="primary-button"
                            onClick={() => setSection("invites")}
                          >
                            <Plus size={17} /> Üye davet et
                          </button>
                        ) : (
                          <button
                            className="primary-button"
                            onClick={() => {
                              setActionError("");
                              setEditing("new");
                            }}
                          >
                            <Plus size={17} /> Kanal oluştur
                          </button>
                        )}
                      </div>
                    )}
                    {section === "members" && (
                      <>
                        <div className="adm-list-caption">
                          <strong>
                            {
                              snapshot.members.filter((m) => !m.suspended)
                                .length
                            }{" "}
                            aktif üye
                          </strong>
                          <span>
                            Erişim kapatılsa da mesaj geçmişi korunur.
                          </span>
                        </div>
                        <div className="adm-table-wrap">
                          <table className="adm-table">
                            <thead>
                              <tr>
                                <th>Üye</th>
                                <th>Rol</th>
                                <th>Durum</th>
                                <th>
                                  <span className="visually-hidden">
                                    İşlemler
                                  </span>
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {members.map((member) => (
                                <tr key={member.id}>
                                  <td>
                                    <div className="adm-person">
                                      <Avatar user={member} />
                                      <span>
                                        <strong>
                                          {member.name}
                                          {member.id === data.user.id && (
                                            <small> (sen)</small>
                                          )}
                                        </strong>
                                        <small>{member.email}</small>
                                      </span>
                                    </div>
                                  </td>
                                  <td>
                                    {member.role === "owner"
                                      ? "Alan sahibi"
                                      : "Üye"}
                                  </td>
                                  <td>
                                    <span
                                      className={`adm-badge ${member.suspended ? "paused" : ""}`}
                                    >
                                      {member.suspended ? "Askıda" : "Aktif"}
                                    </span>
                                  </td>
                                  <td className="adm-actions">
                                    {member.role !== "owner" &&
                                      member.id !== data.user.id && (
                                        <button
                                          className="secondary-button"
                                          disabled={busy || member.siteAdmin}
                                          onClick={() =>
                                            confirm({
                                              title: member.suspended
                                                ? "Üyeyi etkinleştir"
                                                : "Üyeyi askıya al",
                                              description: member.suspended
                                                ? `${member.name} yeniden giriş yapıp ekibe erişebilecek.`
                                                : `${member.name} için oturumlar ve görüşmeler kapanacak. Mesajları korunacak; erişimi daha sonra açabilirsin.`,
                                              label: member.suspended
                                                ? "Etkinleştir"
                                                : "Askıya al",
                                              path: `/admin/workspace/members/${member.id}`,
                                              method: "PATCH",
                                              body: {
                                                suspended: !member.suspended,
                                              },
                                            })
                                          }
                                        >
                                          {member.suspended
                                            ? "Etkinleştir"
                                            : "Askıya al"}
                                        </button>
                                      )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {!members.length && (
                          <p className="adm-empty">
                            Bu aramayla eşleşen üye yok.
                          </p>
                        )}
                      </>
                    )}
                    {section === "channels" && (
                      <>
                        <div className="adm-filters" aria-label="Kanal durumu">
                          <button
                            aria-pressed={!showArchived}
                            onClick={() => setShowArchived(false)}
                          >
                            Aktif kanallar
                          </button>
                          <button
                            aria-pressed={showArchived}
                            onClick={() => setShowArchived(true)}
                          >
                            <Archive size={15} /> Arşiv
                          </button>
                        </div>
                        <div className="adm-channel-list">
                          {channels.map((channel) => (
                            <div className="adm-channel" key={channel.id}>
                              <span className="adm-channel-icon">
                                {channel.kind === "voice" ? (
                                  <Volume2 size={22} />
                                ) : (
                                  <Hash size={22} />
                                )}
                              </span>
                              <div>
                                <strong>{channel.name}</strong>
                                <p>
                                  {channel.description ||
                                    "Açıklama eklenmemiş."}
                                </p>
                                <small>
                                  {channel.kind === "voice"
                                    ? "Sesli oda"
                                    : "Yazılı kanal"}
                                </small>
                              </div>
                              <div className="adm-actions">
                                <button
                                  className="secondary-button"
                                  onClick={() => {
                                    setEditing(channel);
                                    setActionError("");
                                  }}
                                >
                                  Düzenle
                                  <span className="visually-hidden">
                                    {" "}
                                    {channel.name}
                                  </span>
                                </button>
                                <button
                                  className="adm-text-button"
                                  onClick={() =>
                                    confirm({
                                      title: channel.archived
                                        ? "Kanalı arşivden çıkar"
                                        : "Kanalı arşivle",
                                      description: channel.archived
                                        ? `${channel.name} yeniden kanal listesinde görünecek ve kullanılabilecek.`
                                        : `${channel.name} kanal listesinden kaldırılacak ve görüşmesi kapatılacak. Mesajları korunacak; arşivden çıkararak yeniden açabilirsin.`,
                                      label: channel.archived
                                        ? "Arşivden çıkar"
                                        : "Arşivle",
                                      path: `/admin/workspace/channels/${channel.id}`,
                                      method: "PATCH",
                                      body: { archived: !channel.archived },
                                    })
                                  }
                                >
                                  {channel.archived
                                    ? "Arşivden çıkar"
                                    : "Arşivle"}
                                  <span className="visually-hidden">
                                    {" "}
                                    {channel.name}
                                  </span>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                        {!channels.length && (
                          <p className="adm-empty">
                            {query
                              ? "Aramanla eşleşen kanal yok."
                              : showArchived
                                ? "Arşivde kanal yok. Kullanılmayan kanalları geçmişini koruyarak buraya alabilirsin."
                                : "Henüz kanal yok. Ekibin için bir kanal oluştur."}
                          </p>
                        )}
                      </>
                    )}
                    {section === "invites" && (
                      <>
                        <div className="adm-invite-intro">
                          <div className="adm-invite-mark">
                            <Link size={28} />
                          </div>
                          <div>
                            <h2>Ekibe yer aç.</h2>
                            <p>
                              Davet bağlantıları 3 gün boyunca, en fazla 20
                              katılım için geçerlidir. Gerek kalmayan
                              bağlantıları iptal edebilirsin.
                            </p>
                          </div>
                          <button
                            className="primary-button"
                            disabled={busy || data.workspace.isDemo}
                            onClick={() => void createInvite()}
                          >
                            <Plus size={17} /> Davet oluştur
                          </button>
                        </div>
                        {data.workspace.isDemo && (
                          <p className="adm-hint">
                            Davet göndermek için kendi çalışma alanını oluştur.
                            Örnek ekip herkese açık bir deneme alanıdır.
                          </p>
                        )}
                        {inviteUrl && (
                          <div className="adm-invite-copy">
                            <label>
                              Yeni davet bağlantısı
                              <input
                                readOnly
                                value={inviteUrl}
                                onFocus={(e) => e.target.select()}
                              />
                            </label>
                            <button
                              className="secondary-button"
                              onClick={() => {
                                void navigator.clipboard
                                  .writeText(inviteUrl)
                                  .then(() =>
                                    setNotice("Davet bağlantısı kopyalandı."),
                                  )
                                  .catch(() =>
                                    setError(
                                      "Kopyalanamadı. Bağlantıyı seçip elle kopyalayabilirsin.",
                                    ),
                                  );
                              }}
                            >
                              <Copy size={17} /> Kopyala
                            </button>
                          </div>
                        )}
                        <div className="adm-table-wrap">
                          <table className="adm-table">
                            <thead>
                              <tr>
                                <th>Oluşturulma</th>
                                <th>Katılım</th>
                                <th>Durum</th>
                                <th>
                                  <span className="visually-hidden">
                                    İşlemler
                                  </span>
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {snapshot.invites.map((invite) => {
                                const active =
                                  !invite.revoked &&
                                  new Date(invite.expiresAt).getTime() >
                                    Date.now() &&
                                  invite.uses < invite.maxUses;
                                return (
                                  <tr key={invite.id}>
                                    <td>
                                      <strong>{date(invite.createdAt)}</strong>
                                      <small className="adm-cell-note">
                                        Bitiş: {date(invite.expiresAt)}
                                      </small>
                                    </td>
                                    <td>
                                      {invite.uses} / {invite.maxUses}
                                    </td>
                                    <td>
                                      <span
                                        className={`adm-badge ${active ? "" : "paused"}`}
                                      >
                                        {invite.revoked
                                          ? "İptal edildi"
                                          : active
                                            ? "Aktif"
                                            : "Süresi / hakkı doldu"}
                                      </span>
                                    </td>
                                    <td className="adm-actions">
                                      {active && (
                                        <button
                                          className="secondary-button"
                                          onClick={() =>
                                            confirm({
                                              title: "Daveti iptal et",
                                              description:
                                                "Bu bağlantı artık yeni üyeler tarafından kullanılamayacak. Daha önce katılanların erişimi değişmeyecek.",
                                              label: "Daveti iptal et",
                                              path: `/admin/workspace/invites/${invite.id}`,
                                              method: "DELETE",
                                            })
                                          }
                                        >
                                          İptal et
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        {!snapshot.invites.length && (
                          <p className="adm-empty">
                            Henüz davet oluşturulmamış.
                          </p>
                        )}
                      </>
                    )}
                    {section === "settings" && (
                      <div className="adm-settings">
                        <form
                          onSubmit={saveWorkspace}
                          className="adm-settings-section"
                        >
                          <h2>Çalışma alanı</h2>
                          <label>
                            Çalışma alanının adı
                            <input
                              key={snapshot.workspace.name}
                              name="name"
                              defaultValue={snapshot.workspace.name}
                              minLength={2}
                              maxLength={60}
                              required
                            />
                          </label>
                          <button className="primary-button" disabled={busy}>
                            <Check size={17} /> Değişiklikleri kaydet
                          </button>
                        </form>
                        <section className="adm-settings-section">
                          <h2>Sahipliği devret</h2>
                          <p>
                            Yeni sahip üyeleri, kanalları ve davetleri
                            yönetebilir. Devrettiğinde senin rolün üye olur.
                          </p>
                          {data.workspace.isDemo ? (
                            <p className="adm-hint">
                              Örnek ekibin sahipliği değiştirilemez.
                            </p>
                          ) : data.user.role !== "owner" ? (
                            <p className="adm-hint">
                              Sahipliği yalnızca mevcut alan sahibi
                              devredebilir.
                            </p>
                          ) : (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                const id = String(
                                  new FormData(e.currentTarget).get("userId"),
                                );
                                const member = snapshot.members.find(
                                  (m) => m.id === id,
                                );
                                if (member)
                                  confirm({
                                    title: "Sahipliği devret",
                                    description: `${member.name} alan sahibi olacak. Üye olarak mesajlaşmaya devam edeceksin; ekip yönetimine erişimin kalkacak.`,
                                    label: "Sahipliği devret",
                                    path: "/admin/workspace/transfer",
                                    method: "POST",
                                    body: { userId: id },
                                    password: true,
                                  });
                              }}
                            >
                              <label>
                                Yeni alan sahibi
                                <select name="userId" required defaultValue="">
                                  <option value="" disabled>
                                    Bir ekip arkadaşı seç
                                  </option>
                                  {snapshot.members
                                    .filter(
                                      (m) =>
                                        m.id !== data.user.id &&
                                        !m.suspended &&
                                        m.emailVerified,
                                    )
                                    .map((m) => (
                                      <option key={m.id} value={m.id}>
                                        {m.name} ({m.email})
                                      </option>
                                    ))}
                                </select>
                              </label>
                              <p className="adm-hint">
                                E-posta adresi doğrulanmış, aktif üyeler
                                seçilebilir.
                              </p>
                              <button
                                className="secondary-button"
                                disabled={busy}
                              >
                                Sahipliği devret
                              </button>
                            </form>
                          )}
                        </section>
                        <div className="adm-storage">
                          <strong>
                            {snapshot.stats.messages.toLocaleString("tr-TR")}{" "}
                            mesaj
                          </strong>
                          <span>
                            {fileSize(snapshot.stats.storageBytes)} dosya
                            kullanımı
                          </span>
                        </div>
                      </div>
                    )}
                    {section === "audit" && (
                      <>
                        <p className="adm-list-caption">
                          En son yönetim işlemleri. Mesaj içerikleri bu
                          kayıtlara dahil edilmez.
                        </p>
                        <ol className="adm-audit">
                          {snapshot.audit.map((event) => (
                            <li key={event.id}>
                              <span className="adm-audit-dot" />
                              <div>
                                <strong>
                                  {auditNames[event.action] || event.action}
                                </strong>
                                <p>{event.actorName || "Sistem"}</p>
                                {event.details && (
                                  <details>
                                    <summary>Ayrıntı</summary>
                                    <pre>{event.details}</pre>
                                  </details>
                                )}
                              </div>
                              <time dateTime={event.createdAt}>
                                {date(event.createdAt)}
                              </time>
                            </li>
                          ))}
                        </ol>
                        {!snapshot.audit.length && (
                          <p className="adm-empty">
                            Henüz bir yönetim işlemi yapılmadı.
                          </p>
                        )}
                      </>
                    )}
                  </>
                )
              )}
            </>
          )}
          {error && (
            <div className="adm-feedback error" role="alert">
              <p>{error}</p>
              <button onClick={() => void refresh()}>Yeniden yükle</button>
            </div>
          )}
          {notice && (
            <p className="adm-feedback" role="status">
              <Check size={17} />
              {notice}
            </p>
          )}
        </main>
      </div>
      {action && (
        <Modal
          title={action.title}
          onClose={() => {
            if (!busy) setAction(undefined);
          }}
        >
          <form onSubmit={runAction}>
            <p className="modal-description">{action.description}</p>
            {action.password && (
              <label>
                Mevcut parolan
                <input
                  type="password"
                  name="currentPassword"
                  autoComplete="current-password"
                  required
                  maxLength={128}
                />
              </label>
            )}
            {actionError && (
              <p className="form-error" role="alert">
                {actionError}
              </p>
            )}
            <div className="adm-confirm-buttons">
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => setAction(undefined)}
              >
                Vazgeç
              </button>
              <button className="primary-button" disabled={busy}>
                {busy ? <Spinner label="Kaydediliyor" /> : action.label}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {editing && (
        <Modal
          title={editing === "new" ? "Yeni kanal" : "Kanalı düzenle"}
          onClose={() => {
            if (!busy) setEditing(undefined);
          }}
        >
          <form onSubmit={saveChannel}>
            <label>
              Kanal adı
              <input
                name="name"
                required
                minLength={2}
                maxLength={40}
                defaultValue={editing === "new" ? "" : editing.name}
              />
            </label>
            <label>
              Kanal açıklaması
              <textarea
                name="description"
                maxLength={300}
                rows={3}
                defaultValue={editing === "new" ? "" : editing.description}
              />
            </label>
            {editing === "new" && (
              <label>
                Kanal türü
                <select name="kind" defaultValue="text">
                  <option value="text">Yazılı kanal</option>
                  <option value="voice">Sesli oda</option>
                </select>
              </label>
            )}
            {actionError && (
              <p className="form-error" role="alert">
                {actionError}
              </p>
            )}
            <div className="adm-confirm-buttons">
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => setEditing(undefined)}
              >
                Vazgeç
              </button>
              <button className="primary-button" disabled={busy}>
                {busy ? (
                  <Spinner label="Kaydediliyor" />
                ) : editing === "new" ? (
                  "Kanal oluştur"
                ) : (
                  "Kanalı kaydet"
                )}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </dialog>
  );
}
