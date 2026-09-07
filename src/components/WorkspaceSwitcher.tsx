import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Link2,
  Plus,
  Search,
  ShieldCheck,
} from "lucide-react";
import type { WorkspaceMembership } from "../../shared/types";
import { api } from "../lib/api";
import { Modal, Spinner } from "./ui";
import { roleNames } from "./ChannelAccessDialog";
import "./workspace-switcher.css";

export type WorkspaceAction =
  | { kind: "switch"; id: string }
  | { kind: "create"; name: string }
  | { kind: "join"; inviteToken: string };
export type WorkspaceMode = "list" | "create" | "join";
export function workspaceInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
    .toLocaleUpperCase("tr-TR");
}

function inviteCode(input: string) {
  const value = input.trim();
  if (!value.includes("://")) return value;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.searchParams.get("invite") || "";
  } catch {
    return "";
  }
}

export function WorkspaceSwitcher({
  workspaces,
  currentId,
  isDemo,
  inCall,
  initialMode = "list",
  initialInvite = "",
  initialTarget,
  busy,
  onAction,
  onClose,
}: {
  workspaces: WorkspaceMembership[];
  currentId: string;
  isDemo: boolean;
  inCall: boolean;
  initialMode?: WorkspaceMode;
  initialInvite?: string;
  initialTarget?: string;
  busy: boolean;
  onAction: (action: WorkspaceAction) => Promise<void>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<WorkspaceMode>(initialMode);
  const [items, setItems] = useState(workspaces);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [invite, setInvite] = useState(initialInvite);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<WorkspaceAction | null>(
    initialTarget && inCall ? { kind: "switch", id: initialTarget } : null,
  );
  useEffect(() => {
    let cancelled = false;
    api<{ workspaces: WorkspaceMembership[] }>("/workspaces")
      .then((result) => {
        if (!cancelled) setItems(result.workspaces);
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "Alan listesi yenilenemedi. Bağlantını kontrol edip tekrar açabilirsin.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, []);
  async function run(action: WorkspaceAction, confirmed = false) {
    setError("");
    if (inCall && !confirmed) {
      setPending(action);
      return;
    }
    try {
      await onAction(action);
    } catch (failure) {
      setError((failure as Error).message);
      setPending(null);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || isDemo) return;
    if (mode === "create") void run({ kind: "create", name: name.trim() });
    else {
      const token = inviteCode(invite);
      if (!token || !/^[A-Za-z0-9_-]{20,256}$/.test(token)) {
        setError("Geçerli bir Mola davet bağlantısı veya davet kodu gir.");
        return;
      }
      void run({ kind: "join", inviteToken: token });
    }
  }
  function show(next: WorkspaceMode) {
    setMode(next);
    setError("");
    setPending(null);
  }
  return (
    <Modal
      title="Çalışma alanların"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="workspace-switcher" aria-busy={busy}>
        {pending ? (
          <div className="workspace-switch-confirm">
            <h3>Görüşmeden ayrılıp devam et</h3>
            <p>
              Çalışma alanı değişince bu görüşmeden ayrılacaksın. Mesaj
              taslakların alanında saklanır.
            </p>
            <div className="workspace-form-actions">
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => setPending(null)}
              >
                Vazgeç
              </button>
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void run(pending, true)}
              >
                {busy ? (
                  <Spinner label="Alan açılıyor" />
                ) : (
                  "Görüşmeden ayrıl ve devam et"
                )}
              </button>
            </div>
          </div>
        ) : mode === "list" ? (
          <>
            <p className="workspace-switcher-intro">
              Farklı ekiplerin, tek hesabında. Kaldığın yerden devam et.
            </p>
            {items.length > 4 && (
              <label className="workspace-filter">
                <Search size={17} />
                <input
                  aria-label="Çalışma alanlarında ara"
                  placeholder="Bir alan bul…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
            )}
            <div
              className="workspace-list"
              aria-label="Üye olduğun çalışma alanları"
            >
              {items
                .filter((item) =>
                  item.name
                    .toLocaleLowerCase("tr-TR")
                    .includes(query.toLocaleLowerCase("tr-TR")),
                )
                .map((item) => {
                  const selected = item.id === currentId;
                  const blocked = Boolean(
                    item.membershipSuspended || item.suspended,
                  );
                  return (
                    <button
                      key={item.id}
                      className={`workspace-choice ${selected ? "is-current" : ""}`}
                      aria-label={`${item.name} alanına geç`}
                      aria-current={selected ? "true" : undefined}
                      disabled={busy || blocked}
                      onClick={() =>
                        selected
                          ? onClose()
                          : void run({ kind: "switch", id: item.id })
                      }
                    >
                      <span className="workspace-monogram" aria-hidden="true">
                        {workspaceInitials(item.name)}
                      </span>
                      <span className="workspace-choice-copy">
                        <strong>{item.name}</strong>
                        <small>
                          {blocked
                            ? "Erişim askıya alındı"
                            : item.isDemo
                              ? "Örnek çalışma alanı"
                              : roleNames[item.role]}
                        </small>
                      </span>
                      {selected ? (
                        <span className="workspace-current">
                          <Check size={15} />
                          <span>Buradasın</span>
                        </span>
                      ) : (
                        <ArrowRight size={17} />
                      )}
                    </button>
                  );
                })}
              {!items.some((item) =>
                item.name
                  .toLocaleLowerCase("tr-TR")
                  .includes(query.toLocaleLowerCase("tr-TR")),
              ) && (
                <p className="workspace-empty">
                  Bu isimde bir alan bulunamadı.
                </p>
              )}
            </div>
            <div className="workspace-add-actions">
              <button
                aria-label="Yeni çalışma alanı"
                disabled={busy || isDemo}
                onClick={() => show("create")}
              >
                <Plus size={20} />
                <span>
                  <strong>Yeni çalışma alanı</strong>
                  <small>Kendi ekibine bir yer aç</small>
                </span>
                <ArrowRight size={16} />
              </button>
              <button
                aria-label="Davetle katıl"
                disabled={busy || isDemo}
                onClick={() => show("join")}
              >
                <Link2 size={20} />
                <span>
                  <strong>Davetle katıl</strong>
                  <small>Başka bir ekibe hesabınla bağlan</small>
                </span>
                <ArrowRight size={16} />
              </button>
            </div>
          </>
        ) : (
          <>
            <button
              className="workspace-back"
              disabled={busy}
              onClick={() => show("list")}
            >
              <ArrowLeft size={16} /> Alanlarıma dön
            </button>
            <h3>
              {mode === "create" ? "Ekibine yeni bir alan aç" : "Ekibine katıl"}
            </h3>
            <p className="workspace-switcher-intro">
              {mode === "create"
                ? "Her alanın kanalları, üyeleri ve sohbetleri ayrı tutulur."
                : "Davet bağlantısını buraya yapıştır. Yeni hesap oluşturmana gerek yok."}
            </p>
            <form onSubmit={submit}>
              <label>
                {mode === "create"
                  ? "Çalışma alanı adı"
                  : "Davet bağlantısı veya kodu"}
                {mode === "create" ? (
                  <input
                    autoFocus
                    required
                    minLength={2}
                    maxLength={60}
                    autoComplete="off"
                    placeholder="Örn. Ürün Ekibi"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    disabled={busy || isDemo}
                  />
                ) : (
                  <input
                    autoFocus
                    required
                    maxLength={2048}
                    autoComplete="off"
                    placeholder="https://mola.psychodry.cloud/?invite=…"
                    value={invite}
                    onChange={(event) => setInvite(event.target.value)}
                    disabled={busy || isDemo}
                  />
                )}
              </label>
              {mode === "create" && (
                <p className="workspace-owner-note">
                  <ShieldCheck size={16} /> Yeni alanın sahibi sen olacaksın.
                </p>
              )}
              <button
                className="primary-button full-width"
                disabled={busy || isDemo}
              >
                {busy ? (
                  <Spinner label="Alan hazırlanıyor" />
                ) : mode === "create" ? (
                  "Alanı oluştur"
                ) : (
                  "Çalışma alanına katıl"
                )}
                {!busy && <ArrowRight size={17} />}
              </button>
            </form>
          </>
        )}
        {isDemo && (
          <p className="workspace-demo-note">
            Yeni alan oluşturmak veya başka bir ekibe katılmak için gerçek
            hesabınla giriş yap.
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {busy && mode === "list" && !pending && (
          <Spinner label="Çalışma alanı açılıyor" />
        )}
      </div>
    </Modal>
  );
}
