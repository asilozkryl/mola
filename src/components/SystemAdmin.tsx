import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  Building2,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CirclePause,
  History,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import type { User, Workspace } from "../../shared/types";
import { api, ApiError } from "../lib/api";
import "./system-admin.css";

type SystemWorkspace = Workspace & {
  ownerName: string;
  memberCount: number;
  messageCount: number;
  storageBytes: number;
  suspended?: boolean;
};
type SystemUser = User & {
  joinedAt: string;
  siteAdmin?: boolean;
  suspended?: boolean;
  workspaceName?: string;
  workspaceId?: string;
};
type AuditEvent = {
  id: string;
  action: string;
  actorName: string;
  targetType: string;
  targetId: string;
  createdAt: string;
  details: string;
};
type SystemSnapshot = {
  workspaces: SystemWorkspace[];
  users: SystemUser[];
  audit: AuditEvent[];
  pagination: {
    page: number;
    limit: number;
    workspaceTotal: number;
    userTotal: number;
    auditTotal: number;
  };
};
type Tab = "workspaces" | "users" | "audit";
type StatusFilter = "all" | "active" | "suspended";
type PendingChange = {
  kind: "workspace" | "user";
  id: string;
  name: string;
  suspended: boolean;
  memberCount?: number;
};

const number = new Intl.NumberFormat("tr-TR");
const pageSize = 25;
const date = (value: string, includeTime = false) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "Tarih bilgisi yok"
    : parsed.toLocaleString("tr-TR", {
        day: "numeric",
        month: "short",
        year: "numeric",
        ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
      });
};
const storage = (bytes: number) => {
  if (!bytes) return "0 B";
  const unit = Math.min(
    3,
    Math.floor(Math.log(Math.max(1, bytes)) / Math.log(1024)),
  );
  return `${number.format(Math.round((bytes / 1024 ** unit) * 10) / 10)} ${["B", "KB", "MB", "GB"][unit]}`;
};
const actionNames: Record<string, string> = {
  "system.workspace.suspended": "Çalışma alanı askıya alındı",
  "system.workspace.restored": "Çalışma alanı etkinleştirildi",
  "system.member.suspended": "Hesap askıya alındı",
  "system.member.restored": "Hesap etkinleştirildi",
  "workspace.member.suspended": "Üye askıya alındı",
  "workspace.member.restored": "Üye etkinleştirildi",
  "workspace.ownership.transferred": "Çalışma alanı sahipliği devredildi",
  "workspace.renamed": "Çalışma alanının adı değiştirildi",
  "channel.updated": "Kanal bilgileri güncellendi",
  "site_admin.granted": "Sistem yöneticisi yetkisi verildi",
  "site_admin.revoked": "Sistem yöneticisi yetkisi kaldırıldı",
  "workspace.suspended": "Çalışma alanı askıya alındı",
  "workspace.unsuspended": "Çalışma alanı etkinleştirildi",
  "workspace.activated": "Çalışma alanı etkinleştirildi",
  "user.suspended": "Hesap askıya alındı",
  "user.unsuspended": "Hesap etkinleştirildi",
  "user.activated": "Hesap etkinleştirildi",
  "member.suspended": "Üye askıya alındı",
  "member.unsuspended": "Üye etkinleştirildi",
  "member.role_changed": "Üye yetkisi değiştirildi",
  "channel.archived": "Kanal arşivlendi",
  "channel.restored": "Kanal geri açıldı",
  "message.deleted": "Mesaj kaldırıldı",
  "invite.created": "Davet oluşturuldu",
  "invite.revoked": "Davet iptal edildi",
};
const actionName = (action: string) => actionNames[action] || "Yönetim işlemi";
const targetNames: Record<string, string> = {
  workspace: "Çalışma alanı",
  user: "Hesap",
  member: "Üye",
  channel: "Kanal",
  message: "Mesaj",
  invite: "Davet",
};

function Status({ suspended }: { suspended?: boolean }) {
  return (
    <span
      className={`system-admin-status ${suspended ? "system-admin-status-paused" : ""}`}
    >
      <span aria-hidden="true" />
      {suspended ? "Askıda" : "Etkin"}
    </span>
  );
}

function Confirmation({
  change,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  change: PendingChange;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    cancel.current?.focus();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="system-admin-confirm"
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <div
        className={`system-admin-confirm-icon ${change.suspended ? "system-admin-confirm-icon-pause" : ""}`}
      >
        {change.suspended ? <CirclePause size={25} /> : <Check size={25} />}
      </div>
      <h3 id={headingId}>
        {change.suspended ? "Askıya almayı onaylayın" : "Yeniden etkinleştirin"}
      </h3>
      <p className="system-admin-confirm-target">{change.name}</p>
      <p id={descriptionId}>
        {change.suspended
          ? change.kind === "workspace"
            ? `Bu çalışma alanındaki ${number.format(change.memberCount ?? 0)} üyenin çalışma alanına erişimi durdurulur. İçerikler ve sistem yöneticilerinin yönetim erişimi korunur; alanı daha sonra yeniden etkinleştirebilirsiniz.`
            : "Bu hesabın erişimi durdurulur ve açık oturumları kapatılır. Hesabın içerikleri korunur; daha sonra yeniden etkinleştirebilirsiniz."
          : change.kind === "workspace"
            ? "Çalışma alanı yeniden erişime açılır. Kendi hesabı askıda olan üyeler ayrıca etkinleştirilmelidir."
            : "Hesap yeniden giriş yapabilir. Çalışma alanı askıdaysa bu alana erişim kısıtlaması devam eder."}
      </p>
      {error && (
        <p className="system-admin-inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="system-admin-confirm-actions">
        <button
          type="button"
          ref={cancel}
          className="system-admin-button"
          disabled={busy}
          onClick={onCancel}
        >
          Vazgeç
        </button>
        <button
          type="button"
          className={`system-admin-button ${change.suspended ? "system-admin-button-danger" : "system-admin-button-primary"}`}
          disabled={busy}
          onClick={onConfirm}
        >
          {busy && <LoaderCircle size={16} className="system-admin-spin" />}
          {busy
            ? "Kaydediliyor…"
            : change.suspended
              ? "Askıya al"
              : "Etkinleştir"}
        </button>
      </div>
    </dialog>
  );
}

export default function SystemAdmin({
  currentUser,
  onNotice,
  onChanged,
}: {
  currentUser: Pick<User, "id">;
  onNotice: (text: string) => void;
  onChanged: () => void;
}) {
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("workspaces");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [expandedAudit, setExpandedAudit] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const loadingRequest = useRef<AbortController | null>(null);
  const savingRequest = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const changedCallback = useRef(onChanged);
  changedCallback.current = onChanged;
  const operation = useRef(false);
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const sectionId = useId();

  const refresh = useCallback(async () => {
    loadingRequest.current?.abort();
    const controller = new AbortController();
    loadingRequest.current = controller;
    setLoading(true);
    setLoadError(null);
    try {
      const parameters = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
        q: search,
        status: tab === "audit" ? "all" : status,
      });
      const result = await api<SystemSnapshot>(`/admin/system?${parameters}`, {
        signal: controller.signal,
      });
      if (!controller.signal.aborted && alive.current) setSnapshot(result);
    } catch (error) {
      if (!controller.signal.aborted && alive.current) {
        if (
          error instanceof ApiError &&
          (error.status === 401 || error.status === 403)
        ) {
          setSnapshot(null);
          setPending(null);
          changedCallback.current();
        }
        setLoadError(
          error instanceof Error
            ? error.message
            : "Sistem bilgileri alınamadı. Yeniden deneyin.",
        );
      }
    } finally {
      if (!controller.signal.aborted && alive.current) setLoading(false);
    }
  }, [page, search, status, tab]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      loadingRequest.current?.abort();
      savingRequest.current?.abort();
    };
  }, []);
  useEffect(() => {
    void refresh();
  }, [currentUser.id, refresh]);
  useEffect(() => {
    if (query.trim() === search) return;
    const timer = window.setTimeout(() => {
      setSearch(query.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, search]);
  useEffect(() => {
    const onRefresh = () => {
      void refresh();
    };
    window.addEventListener("mola:admin-refresh", onRefresh);
    return () => window.removeEventListener("mola:admin-refresh", onRefresh);
  }, [refresh]);

  const tabs = [
    {
      id: "workspaces" as const,
      label: "Çalışma alanları",
      Icon: Building2,
      count: snapshot?.pagination.workspaceTotal,
    },
    {
      id: "users" as const,
      label: "Kullanıcılar",
      Icon: Users,
      count: snapshot?.pagination.userTotal,
    },
    {
      id: "audit" as const,
      label: "İşlem geçmişi",
      Icon: History,
      count: snapshot?.pagination.auditTotal,
    },
  ];
  const selectTab = (next: Tab) => {
    setTab(next);
    setQuery("");
    setSearch("");
    setStatus("all");
    setPage(1);
    setExpandedAudit(null);
  };
  const navigateTabs = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = tabs.findIndex((item) => item.id === tab);
    const nextIndex =
      event.key === "ArrowRight"
        ? (index + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (index + tabs.length - 1) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : null;
    if (nextIndex === null) return;
    event.preventDefault();
    selectTab(tabs[nextIndex].id);
    tabRefs.current[tabs[nextIndex].id]?.focus();
  };
  const total =
    snapshot?.pagination[
      tab === "workspaces"
        ? "workspaceTotal"
        : tab === "users"
          ? "userTotal"
          : "auditTotal"
    ] ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const visiblePage = snapshot?.pagination.page ?? page;
  const slice = (visiblePage - 1) * pageSize;
  const workspaceRows = snapshot?.workspaces ?? [];
  const userRows = snapshot?.users ?? [];
  const auditRows = snapshot?.audit ?? [];
  const queryPending = query.trim() !== search;
  const refreshing = loading || queryPending;
  useEffect(() => {
    if (snapshot && !loading && snapshot.pagination.page > pages)
      setPage(pages);
  }, [snapshot, loading, pages]);

  const requestChange = (change: PendingChange) => {
    setSaveError(null);
    setPending(change);
  };
  const confirm = async () => {
    if (
      !pending ||
      operation.current ||
      (pending.kind === "user" &&
        (pending.id === currentUser.id ||
          snapshot?.users.some(
            (item) => item.id === pending.id && item.siteAdmin,
          )))
    )
      return;
    const change = pending;
    operation.current = true;
    setSaving(true);
    setSaveError(null);
    const controller = new AbortController();
    savingRequest.current = controller;
    try {
      await api<{ ok: true }>(
        `/admin/system/${change.kind === "workspace" ? "workspaces" : "users"}/${encodeURIComponent(change.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ suspended: change.suspended }),
          signal: controller.signal,
        },
      );
      if (!alive.current || controller.signal.aborted) return;
      setSnapshot((previous) =>
        previous
          ? ({
              ...previous,
              [change.kind === "workspace" ? "workspaces" : "users"]: previous[
                change.kind === "workspace" ? "workspaces" : "users"
              ].map((item) =>
                item.id === change.id
                  ? { ...item, suspended: change.suspended }
                  : item,
              ),
            } as SystemSnapshot)
          : previous,
      );
      setPending(null);
      onNotice(
        `${change.name} ${change.suspended ? "askıya alındı" : "etkinleştirildi"}.`,
      );
      changedCallback.current();
      void refresh();
    } catch (error) {
      if (!controller.signal.aborted && alive.current) {
        if (
          error instanceof ApiError &&
          (error.status === 401 || error.status === 403)
        ) {
          setSnapshot(null);
          setPending(null);
          changedCallback.current();
          setLoadError(error.message);
        }
        setSaveError(
          error instanceof Error
            ? error.message
            : "Değişiklik kaydedilemedi. Yeniden deneyin.",
        );
      }
    } finally {
      operation.current = false;
      if (alive.current) setSaving(false);
    }
  };

  return (
    <section className="system-admin" aria-label="Sistem yönetimi">
      <h1 className="system-admin-heading">Genel yönetim</h1>
      <div className="system-admin-intro">
        <ShieldCheck size={21} aria-hidden="true" />
        <p>
          Tüm çalışma alanlarına ve hesaplara erişimi buradan yönetin.
          Değişiklikler işlem geçmişine kaydedilir.
        </p>
      </div>
      <div
        className="system-admin-tabs"
        role="tablist"
        aria-label="Sistem yönetimi bölümleri"
      >
        {tabs.map(({ id, label, Icon, count }) => (
          <button
            key={id}
            ref={(element) => {
              tabRefs.current[id] = element;
            }}
            type="button"
            id={`${sectionId}-${id}`}
            role="tab"
            aria-selected={tab === id}
            aria-controls={`${sectionId}-panel`}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => selectTab(id)}
            onKeyDown={navigateTabs}
          >
            <Icon size={17} aria-hidden="true" />
            {label}
            {count !== undefined && (
              <span className="system-admin-tab-count">
                {number.format(count)}
              </span>
            )}
          </button>
        ))}
      </div>
      <div
        id={`${sectionId}-panel`}
        role="tabpanel"
        aria-labelledby={`${sectionId}-${tab}`}
        className="system-admin-panel"
      >
        <div className="system-admin-toolbar">
          <label className="system-admin-search">
            <Search size={17} aria-hidden="true" />
            <span
              className="system-admin-sr-only"
              id={`${sectionId}-search-label`}
            >
              {tab === "users"
                ? "Kullanıcı adı veya e-posta ara"
                : tab === "audit"
                  ? "İşlem geçmişinde ara"
                  : "Çalışma alanı veya sahibi ara"}
            </span>
            <input
              type="search"
              aria-labelledby={`${sectionId}-search-label`}
              value={query}
              placeholder={
                tab === "users"
                  ? "İsim, e-posta veya çalışma alanı ara"
                  : tab === "audit"
                    ? "İşlemi yapan kişiyi veya kayıt numarasını ara"
                    : "Çalışma alanı veya sahibini ara"
              }
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
            />
            {query && (
              <button
                type="button"
                aria-label="Aramayı temizle"
                onClick={() => {
                  setQuery("");
                  setPage(1);
                }}
              >
                <X size={15} />
              </button>
            )}
          </label>
          <div className="system-admin-toolbar-actions">
            {tab !== "audit" && (
              <label className="system-admin-filter">
                <span>Durum</span>
                <select
                  aria-label="Duruma göre filtrele"
                  value={status}
                  onChange={(event) => {
                    setStatus(event.target.value as StatusFilter);
                    setPage(1);
                  }}
                >
                  <option value="all">Tümü</option>
                  <option value="active">Etkin</option>
                  <option value="suspended">Askıda</option>
                </select>
              </label>
            )}
            <button
              type="button"
              className="system-admin-button system-admin-refresh"
              aria-label="Sistem bilgilerini yenile"
              disabled={refreshing || saving}
              onClick={() => void refresh()}
            >
              <RefreshCw
                size={16}
                className={loading ? "system-admin-spin" : ""}
              />
              <span>Yenile</span>
            </button>
          </div>
        </div>
        {loadError && (
          <div className="system-admin-load-error" role="alert">
            <span>
              {loadError}
              {snapshot && " Aşağıda son alınan bilgiler gösteriliyor."}
            </span>
            <button
              type="button"
              className="system-admin-button"
              disabled={loading}
              onClick={() => void refresh()}
            >
              Yeniden dene
            </button>
          </div>
        )}
        {loading && !snapshot ? (
          <div className="system-admin-empty" role="status">
            <LoaderCircle size={25} className="system-admin-spin" />
            <h3>Sistem bilgileri yükleniyor</h3>
            <p>Çalışma alanları ve kullanıcılar hazırlanıyor.</p>
          </div>
        ) : !snapshot ? (
          <div className="system-admin-empty">
            <ShieldCheck size={29} />
            <h3>Bilgiler henüz görüntülenemiyor</h3>
            <p>
              Bağlantınızı ve sistem yönetimi yetkinizi kontrol edip yeniden
              deneyin.
            </p>
          </div>
        ) : total === 0 ? (
          <div className="system-admin-empty">
            <Search size={27} />
            <h3>
              {query || status !== "all"
                ? "Bu aramaya uygun kayıt yok"
                : tab === "audit"
                  ? "Henüz bir yönetim işlemi yok"
                  : "Henüz kayıt yok"}
            </h3>
            <p>
              {query || status !== "all"
                ? "Farklı bir isim deneyin veya filtreleri temizleyin."
                : tab === "audit"
                  ? "Yaptığınız yönetim işlemleri burada görünür."
                  : "Yeni kayıtlar oluşturulduğunda bu listede görünür."}
            </p>
            {(query || status !== "all") && (
              <button
                type="button"
                className="system-admin-button"
                onClick={() => {
                  setQuery("");
                  setStatus("all");
                  setPage(1);
                }}
              >
                Filtreleri temizle
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="system-admin-table-wrap" aria-busy={refreshing}>
              {tab === "workspaces" && (
                <table className="system-admin-table system-admin-workspaces">
                  <caption className="system-admin-sr-only">
                    Çalışma alanları ve erişim durumları
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Çalışma alanı</th>
                      <th scope="col">Üye</th>
                      <th scope="col">Mesaj</th>
                      <th scope="col">Dosyalar</th>
                      <th scope="col">Durum</th>
                      <th scope="col">
                        <span className="system-admin-sr-only">İşlemler</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {workspaceRows.map((item) => (
                      <tr key={item.id}>
                        <td data-label="Çalışma alanı">
                          <div className="system-admin-identity">
                            <span className="system-admin-workspace-icon">
                              <Building2 size={19} />
                            </span>
                            <span>
                              <strong>
                                {item.name}
                                {item.isDemo && (
                                  <small className="system-admin-demo">
                                    Demo
                                  </small>
                                )}
                              </strong>
                              <span className="system-admin-secondary">
                                {item.ownerName || "Sahip bilgisi yok"}
                              </span>
                            </span>
                          </div>
                        </td>
                        <td data-label="Üye" className="system-admin-number">
                          {number.format(item.memberCount)}
                        </td>
                        <td data-label="Mesaj" className="system-admin-number">
                          {number.format(item.messageCount)}
                        </td>
                        <td
                          data-label="Dosyalar"
                          className="system-admin-number"
                        >
                          {storage(item.storageBytes)}
                        </td>
                        <td data-label="Durum">
                          <Status suspended={item.suspended} />
                        </td>
                        <td className="system-admin-row-actions">
                          <button
                            type="button"
                            className={`system-admin-row-action ${item.suspended ? "" : "system-admin-row-action-pause"}`}
                            disabled={saving || refreshing}
                            aria-label={`${item.name}: ${item.suspended ? "etkinleştir" : "askıya al"}`}
                            onClick={() =>
                              requestChange({
                                kind: "workspace",
                                id: item.id,
                                name: item.name,
                                suspended: !item.suspended,
                                memberCount: item.memberCount,
                              })
                            }
                          >
                            {item.suspended ? "Etkinleştir" : "Askıya al"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {tab === "users" && (
                <table className="system-admin-table system-admin-users">
                  <caption className="system-admin-sr-only">
                    Kullanıcılar ve erişim durumları
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Kullanıcı</th>
                      <th scope="col">Yetki</th>
                      <th scope="col">Katılım</th>
                      <th scope="col">Durum</th>
                      <th scope="col">
                        <span className="system-admin-sr-only">İşlemler</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {userRows.map((item) => (
                      <tr key={item.id}>
                        <td data-label="Kullanıcı">
                          <div className="system-admin-identity">
                            <span
                              className="system-admin-user-avatar"
                              aria-hidden="true"
                            >
                              {item.name
                                .split(" ")
                                .filter(Boolean)
                                .slice(0, 2)
                                .map((part) => part[0])
                                .join("")
                                .toLocaleUpperCase("tr")}
                            </span>
                            <span>
                              <strong>
                                {item.name}
                                {item.id === currentUser.id && (
                                  <small className="system-admin-self">
                                    Siz
                                  </small>
                                )}
                              </strong>
                              <span className="system-admin-secondary">
                                {item.email}
                              </span>
                              <span className="system-admin-user-workspace">
                                {item.workspaceName || "Çalışma alanı yok"}
                              </span>
                            </span>
                          </div>
                        </td>
                        <td data-label="Yetki">
                          <span
                            className={
                              item.siteAdmin ? "system-admin-site-role" : ""
                            }
                          >
                            {item.siteAdmin && <ShieldCheck size={14} />}
                            {item.siteAdmin
                              ? "Sistem yöneticisi"
                              : !item.workspaceId
                                ? "Hesap"
                                : item.role === "owner"
                                  ? "Alan sahibi"
                                  : "Üye"}
                          </span>
                        </td>
                        <td data-label="Katılım">
                          <time dateTime={item.joinedAt}>
                            {date(item.joinedAt)}
                          </time>
                        </td>
                        <td data-label="Durum">
                          <Status suspended={item.suspended} />
                        </td>
                        <td className="system-admin-row-actions">
                          <button
                            type="button"
                            className={`system-admin-row-action ${item.suspended ? "" : "system-admin-row-action-pause"}`}
                            disabled={
                              item.id === currentUser.id ||
                              (!item.suspended &&
                                (item.siteAdmin || item.role === "owner")) ||
                              saving ||
                              refreshing
                            }
                            title={
                              item.id === currentUser.id
                                ? "Kendi hesabınızı askıya alamazsınız."
                                : !item.suspended && item.siteAdmin
                                  ? "Sistem yöneticileri bu panelden askıya alınamaz."
                                  : !item.suspended && item.role === "owner"
                                    ? "Çalışma alanının sahipliği devredildikten sonra askıya alınabilir."
                                    : undefined
                            }
                            aria-label={`${item.name}: ${item.suspended ? "etkinleştir" : "askıya al"}`}
                            onClick={() =>
                              requestChange({
                                kind: "user",
                                id: item.id,
                                name: item.name,
                                suspended: !item.suspended,
                              })
                            }
                          >
                            {item.suspended ? "Etkinleştir" : "Askıya al"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {tab === "audit" && (
                <table className="system-admin-table system-admin-audit">
                  <caption className="system-admin-sr-only">
                    Yönetim işlemleri geçmişi
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">İşlem</th>
                      <th scope="col">İşlemi yapan</th>
                      <th scope="col">Zaman</th>
                      <th scope="col">
                        <span className="system-admin-sr-only">Ayrıntılar</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditRows.map((item) => (
                      <Fragment key={item.id}>
                        <tr>
                          <td data-label="İşlem">
                            <strong>{actionName(item.action)}</strong>
                            <span className="system-admin-secondary">
                              {targetNames[item.targetType] || "Kayıt"}
                            </span>
                          </td>
                          <td data-label="İşlemi yapan">
                            {item.actorName || "Sistem"}
                          </td>
                          <td data-label="Zaman">
                            <time dateTime={item.createdAt}>
                              {date(item.createdAt, true)}
                            </time>
                          </td>
                          <td className="system-admin-row-actions">
                            <button
                              type="button"
                              className="system-admin-row-action"
                              aria-expanded={expandedAudit === item.id}
                              aria-controls={`${sectionId}-audit-${item.id}`}
                              onClick={() =>
                                setExpandedAudit(
                                  expandedAudit === item.id ? null : item.id,
                                )
                              }
                            >
                              {expandedAudit === item.id
                                ? "Kapat"
                                : "Ayrıntılar"}
                              <ChevronDown
                                size={15}
                                className={
                                  expandedAudit === item.id
                                    ? "system-admin-chevron-open"
                                    : ""
                                }
                              />
                            </button>
                          </td>
                        </tr>
                        {expandedAudit === item.id && (
                          <tr
                            className="system-admin-audit-details-row"
                            id={`${sectionId}-audit-${item.id}`}
                          >
                            <td colSpan={4}>
                              <dl className="system-admin-audit-details">
                                <div>
                                  <dt>Kayıt</dt>
                                  <dd>{item.targetId}</dd>
                                </div>
                                <div>
                                  <dt>İşlem türü</dt>
                                  <dd>
                                    {actionNames[item.action]
                                      ? actionName(item.action)
                                      : item.action}
                                  </dd>
                                </div>
                                <div>
                                  <dt>Ayrıntı</dt>
                                  <dd>
                                    {item.details || "Ek ayrıntı kaydedilmedi."}
                                  </dd>
                                </div>
                              </dl>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <footer className="system-admin-pagination">
              <span role="status">
                {number.format(slice + 1)}–
                {number.format(Math.min(slice + pageSize, total))} /{" "}
                {number.format(total)} kayıt
              </span>
              <div>
                <button
                  type="button"
                  aria-label="Önceki sayfa"
                  disabled={visiblePage === 1 || refreshing}
                  onClick={() => setPage(visiblePage - 1)}
                >
                  <ChevronLeft size={18} />
                </button>
                <span>
                  {visiblePage} / {pages}
                </span>
                <button
                  type="button"
                  aria-label="Sonraki sayfa"
                  disabled={visiblePage >= pages || refreshing}
                  onClick={() => setPage(visiblePage + 1)}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </footer>
            {tab === "users" && (
              <p className="system-admin-self-note">
                Sistem yöneticileri bu panelden askıya alınamaz. Alan sahipleri
                için önce sahiplik devri gerekir.
              </p>
            )}
          </>
        )}
      </div>
      {pending && (
        <Confirmation
          change={pending}
          busy={saving}
          error={saveError}
          onCancel={() => {
            if (!saving) setPending(null);
          }}
          onConfirm={() => void confirm()}
        />
      )}
    </section>
  );
}
