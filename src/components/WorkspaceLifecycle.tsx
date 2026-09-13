import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Link2,
  LogOut,
  Settings2,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type {
  AccountBootstrap,
  Bootstrap,
  SessionBootstrap,
} from "../../shared/types";
import { api } from "../lib/api";
import { Avatar, Logo, Modal, Spinner, fileSize } from "./ui";
import {
  WorkspaceSwitcher,
  type WorkspaceAction,
  type WorkspaceMode,
} from "./WorkspaceSwitcher";
import { SecuritySettings } from "./SecuritySettings";
import SystemAdmin from "./SystemAdmin";
import "./workspace-lifecycle.css";

export function AccountOnlyHome({
  data,
  onAction,
  onLogout,
  onRefresh,
}: {
  data: AccountBootstrap;
  onAction: (action: WorkspaceAction) => Promise<void>;
  onLogout: () => Promise<void>;
  onRefresh: () => void;
}) {
  const [mode, setMode] = useState<WorkspaceMode | null>(() =>
    new URLSearchParams(location.search).has("invite") ? "join" : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [security, setSecurity] = useState(false);
  const [systemOpen, setSystemOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const available = data.workspaces.filter(
    (w) => !w.suspended && !w.membershipSuspended,
  );
  async function run(action: WorkspaceAction) {
    setBusy(true);
    try {
      await onAction(action);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="account-workspaces">
      <header>
        <Logo />
        <div>
          <Avatar user={data.user} size="small" />
          <span>{data.user.name}</span>
          {data.user.siteAdmin && (
            <Button
              variant="unstyled"
              size="unset"
              type="submit"
              className="icon-button"
              aria-label="Uygulama yönetimi"
              onClick={() => setSystemOpen(true)}
            >
              <Settings2 size={19} />
            </Button>
          )}
          <Button
            variant="unstyled"
            size="unset"
            type="submit"
            className="icon-button"
            aria-label="Hesap güvenliği"
            onClick={() => setSecurity(true)}
          >
            <ShieldCheck size={19} />
          </Button>
          <Button
            variant="unstyled"
            size="unset"
            type="submit"
            className="icon-button"
            aria-label="Çıkış yap"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onLogout()
                .catch((e) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            <LogOut size={19} />
          </Button>
        </div>
      </header>
      <section className="account-workspaces-content">
        <span className="workspace-empty-symbol">
          <Plus size={28} />
        </span>
        <h1>Birlikte çalışmaya başla.</h1>
        <p>
          Hesabın ve profilin burada. Ekibin için bir çalışma alanı oluştur veya
          bir davetle katıl.
        </p>
        {available.length > 0 && (
          <div className="account-workspace-list">
            {available.map((w) => (
              <Button
                variant="outline"
                size="unset"
                type="submit"
                className="secondary-button"
                key={w.id}
                disabled={busy}
                onClick={() =>
                  void run({ kind: "switch", id: w.id }).catch((e) =>
                    setError(e.message),
                  )
                }
              >
                {w.name}
                <ArrowRight size={17} />
              </Button>
            ))}
          </div>
        )}
        <div className="account-workspace-actions">
          <Button
            variant="default"
            size="unset"
            type="submit"
            className="primary-button"
            disabled={busy}
            onClick={() => setMode("create")}
          >
            <Plus size={17} />
            Çalışma alanı oluştur
          </Button>
          <Button
            variant="outline"
            size="unset"
            type="submit"
            className="secondary-button"
            disabled={busy}
            onClick={() => setMode("join")}
          >
            <Link2 size={17} />
            Davet ile katıl
          </Button>
        </div>
        {data.workspaces.some((w) => w.suspended || w.membershipSuspended) && (
          <p className="workspace-access-note">
            Askıya alınmış alanlarına şu anda erişilemiyor. Alan yöneticinle
            iletişime geçebilirsin.
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <small>{data.user.email}</small>
      </section>
      {mode && (
        <WorkspaceSwitcher
          workspaces={data.workspaces}
          currentId=""
          isDemo={false}
          inCall={false}
          initialMode={mode}
          initialInvite={
            new URLSearchParams(location.search).get("invite") || ""
          }
          busy={busy}
          onAction={run}
          onClose={() => setMode(null)}
        />
      )}
      {security && (
        <Modal title="Hesap güvenliği" onClose={() => setSecurity(false)}>
          <SecuritySettings />
        </Modal>
      )}
      {systemOpen && data.user.siteAdmin && (
        <Modal
          title="Uygulama yönetimi"
          wide
          onClose={() => setSystemOpen(false)}
        >
          {notice && <p role="status">{notice}</p>}
          <SystemAdmin
            currentUser={data.user}
            onNotice={setNotice}
            onChanged={onRefresh}
          />
        </Modal>
      )}
    </main>
  );
}

type DeletionPreview = {
  workspaceName: string;
  members: number;
  channels: number;
  messages: number;
  files: number;
  storageBytes: number;
};
export function WorkspaceLifecycleDialog({
  data,
  mode,
  inCall,
  onClose,
  onComplete,
}: {
  data: Bootstrap;
  mode: "delete" | "leave";
  inCall: boolean;
  onClose: () => void;
  onComplete: (next: SessionBootstrap) => void;
}) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [loading, setLoading] = useState(mode === "delete");
  const [revision, setRevision] = useState(0);
  const mounted = useRef(false);
  const processing = useRef(false);
  const deleting = mode === "delete";
  const headers = {
    "X-Workspace-Id": data.workspace.id,
    "X-User-Id": data.user.id,
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!deleting) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setPreview(null);
    api<{
      workspaceName: string;
      counts: Omit<DeletionPreview, "workspaceName">;
    }>(
      `/workspaces/${encodeURIComponent(data.workspace.id)}/deletion-preview`,
      { headers },
    )
      .then((result) => {
        if (!cancelled)
          setPreview({ workspaceName: result.workspaceName, ...result.counts });
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [data.workspace.id, data.user.id, deleting, revision]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      processing.current ||
      loading ||
      (deleting && (!preview || name !== preview.workspaceName || !password))
    )
      return;
    processing.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await api<SessionBootstrap>(
        `/workspaces/${encodeURIComponent(data.workspace.id)}${deleting ? "" : "/leave"}`,
        {
          method: deleting ? "DELETE" : "POST",
          headers,
          body: JSON.stringify(deleting ? { confirmName: name, password } : {}),
        },
      );
      if (mounted.current) onComplete(next);
    } catch (failure) {
      if (mounted.current) {
        setError((failure as Error).message);
        setPassword("");
      }
    } finally {
      processing.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <Modal
      title={deleting ? "Çalışma alanını sil" : "Çalışma alanından ayrıl"}
      onClose={() => {
        if (!processing.current) onClose();
      }}
    >
      <form
        className="workspace-lifecycle-form"
        onSubmit={submit}
        aria-busy={busy || loading}
      >
        <div className="workspace-lifecycle-heading">
          <span>{deleting ? <Trash2 size={22} /> : <LogOut size={22} />}</span>
          <div>
            <h3>{data.workspace.name}</h3>
            <p>
              {deleting
                ? "Bu işlem tüm ekip için kalıcıdır."
                : "Bu alandaki kanallara erişimin sona erer."}
            </p>
          </div>
        </div>
        <p>
          {deleting
            ? "Bu çalışma alanının kanalları, mesajları, dosyaları ve davetleri silinir. Hesabın ve diğer çalışma alanlarındaki içerik korunur."
            : "Mesajların ekipte kalır, hesabın korunur. Geçerli bir çalışma alanı davetiyle yeniden katılabilirsin."}
        </p>
        {loading && <Spinner label="Silinecek içerik hesaplanıyor" />}
        {deleting && preview && (
          <dl className="workspace-deletion-counts">
            <div>
              <dt>Üye</dt>
              <dd>{preview.members}</dd>
            </div>
            <div>
              <dt>Kanal / oda</dt>
              <dd>{preview.channels}</dd>
            </div>
            <div>
              <dt>Mesaj</dt>
              <dd>{preview.messages}</dd>
            </div>
            <div>
              <dt>Dosya</dt>
              <dd>
                {preview.files}{" "}
                <small>({fileSize(preview.storageBytes)})</small>
              </dd>
            </div>
          </dl>
        )}
        {inCall && (
          <p className="workspace-access-note">
            Bu çalışma alanındaki görüşmeden de ayrılacaksın.
          </p>
        )}
        <p className="workspace-access-note">
          Başka çalışma alanın varsa ona geçersin. Yoksa yeni alan oluşturma
          veya davetle katılma ekranı açılır.
        </p>
        {deleting && preview && (
          <>
            <label>
              Onaylamak için <strong>{preview.workspaceName}</strong> yaz
              <Input
                unstyled
                autoComplete="off"
                spellCheck={false}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
                required
                aria-label="Silinecek çalışma alanının adı"
              />
            </label>
            <label>
              Mevcut parolan
              <Input
                unstyled
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                required
              />
            </label>
          </>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
            {deleting && !preview && !loading && (
              <Button
                variant="outline"
                size="unset"
                type="button"
                className="secondary-button"
                onClick={() => setRevision((n) => n + 1)}
              >
                Tekrar dene
              </Button>
            )}
          </div>
        )}
        <footer>
          <Button
            variant="outline"
            size="unset"
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={onClose}
          >
            Vazgeç
          </Button>
          <Button
            variant="unstyled"
            size="unset"
            type="submit"
            className="danger-button"
            disabled={
              busy ||
              loading ||
              (deleting &&
                (!preview || name !== preview.workspaceName || !password))
            }
          >
            {busy ? (
              <Spinner label={deleting ? "Siliniyor" : "Ayrılınıyor"} />
            ) : deleting ? (
              "Çalışma alanını kalıcı olarak sil"
            ) : (
              "Çalışma alanından ayrıl"
            )}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
