import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  ListOrdered,
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
import { WorkspaceAvatar } from "./WorkspaceAvatar";
import "./workspace-rail-order.css";
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
  initialOrderEditing = false,
  order,
  onRefresh,
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
  initialOrderEditing?: boolean;
  onRefresh?: () => void;
  order?: {
    canReorder: boolean;
    saving: boolean;
    error: string;
    onReorder: (ids: string[]) => Promise<boolean>;
    onRetry: () => void;
  };
  busy: boolean;
  onAction: (action: WorkspaceAction) => Promise<void>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<WorkspaceMode>(initialMode);
  const [items, setItems] = useState(workspaces);
  const [orderEditing, setOrderEditing] = useState(initialOrderEditing);
  const listRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const displayed = order ? workspaces : items;
  const managedOrder = Boolean(order);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [invite, setInvite] = useState(initialInvite);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<WorkspaceAction | null>(
    initialTarget && inCall ? { kind: "switch", id: initialTarget } : null,
  );
  useEffect(() => {
    if (managedOrder) {
      onRefresh?.();
      return;
    }
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
  }, [managedOrder]);
  useEffect(() => {
    if (!orderEditing || mode !== "list") {
      pendingFocus.current = null;
      return;
    }
    if (order?.saving || !pendingFocus.current) return;
    const control = listRef.current?.querySelector<HTMLElement>(
      `[data-workspace-choice-id="${CSS.escape(pendingFocus.current)}"] .workspace-order-controls button:not(:disabled)`,
    );
    if (control) {
      control.focus({ preventScroll: true });
      pendingFocus.current = null;
    }
  }, [order?.saving, orderEditing, mode, workspaces]);
  async function move(id: string, direction: number) {
    if (!order?.canReorder || busy || query) return;
    const ids = displayed.map((item) => item.id),
      from = ids.indexOf(id),
      to = from + direction;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    pendingFocus.current = id;
    await order.onReorder(ids);
  }
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
              <Button
                variant="outline"
                size="unset"
                type="submit"
                className="secondary-button"
                disabled={busy}
                onClick={() => setPending(null)}
              >
                Vazgeç
              </Button>
              <Button
                variant="default"
                size="unset"
                type="submit"
                className="primary-button"
                disabled={busy}
                onClick={() => void run(pending, true)}
              >
                {busy ? (
                  <Spinner label="Alan açılıyor" />
                ) : (
                  "Görüşmeden ayrıl ve devam et"
                )}
              </Button>
            </div>
          </div>
        ) : mode === "list" ? (
          <>
            <div className="workspace-order-toolbar">
              <p className="workspace-switcher-intro">
                {orderEditing
                  ? "Sıralaman hesabına özel; tüm cihazlarında aynı kalır."
                  : "Farklı ekiplerin, tek hesabında. Kaldığın yerden devam et."}
              </p>
              {order && displayed.length > 1 && (
                <Button
                  variant="unstyled"
                  size="unset"
                  type="button"
                  className="workspace-order-toggle"
                  aria-pressed={orderEditing}
                  disabled={busy || order.saving}
                  onClick={() => {
                    setOrderEditing((value) => !value);
                    setQuery("");
                  }}
                >
                  {orderEditing ? (
                    <Check size={15} />
                  ) : (
                    <ListOrdered size={15} />
                  )}
                  {orderEditing ? "Tamam" : "Sırayı düzenle"}
                </Button>
              )}
            </div>
            {order?.error && (
              <div className="workspace-order-error" role="alert">
                <span>{order.error}</span>
                <Button
                  variant="unstyled"
                  size="unset"
                  type="button"
                  onClick={order.onRetry}
                >
                  Tekrar dene
                </Button>
              </div>
            )}
            {displayed.length > 4 && !orderEditing && (
              <label className="workspace-filter">
                <Search size={17} />
                <Input
                  unstyled
                  aria-label="Çalışma alanlarında ara"
                  placeholder="Bir alan bul…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
            )}
            <div
              className="workspace-list"
              ref={listRef}
              aria-busy={order?.saving}
              aria-label="Üye olduğun çalışma alanları"
            >
              {displayed
                .filter((item) =>
                  item.name
                    .toLocaleLowerCase("tr-TR")
                    .includes(query.toLocaleLowerCase("tr-TR")),
                )
                .map((item, index) => {
                  const selected = item.id === currentId;
                  const blocked = Boolean(
                    item.membershipSuspended || item.suspended,
                  );
                  return (
                    <div
                      key={item.id}
                      className="workspace-choice-row"
                      data-workspace-choice-id={item.id}
                      data-editing={orderEditing || undefined}
                    >
                      <Button
                        variant="unstyled"
                        size="unset"
                        type="submit"
                        key={item.id}
                        className={`workspace-choice ${selected ? "is-current" : ""}`}
                        aria-label={
                          orderEditing
                            ? `${item.name}, ${index + 1}. sırada`
                            : `${item.name} alanına geç`
                        }
                        aria-current={selected ? "true" : undefined}
                        disabled={busy || blocked || orderEditing}
                        onClick={() =>
                          selected
                            ? onClose()
                            : void run({ kind: "switch", id: item.id })
                        }
                      >
                        <WorkspaceAvatar
                          workspace={item}
                          size="medium"
                          className="workspace-monogram"
                        />
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
                        ) : !orderEditing ? (
                          <ArrowRight size={17} />
                        ) : null}
                      </Button>
                      {orderEditing && order && (
                        <div className="workspace-order-controls">
                          <Button
                            variant="unstyled"
                            size="unset"
                            type="button"
                            aria-label={`${item.name} alanını yukarı taşı`}
                            disabled={busy || !order.canReorder || index === 0}
                            onClick={() => void move(item.id, -1)}
                          >
                            <ArrowUp size={16} />
                          </Button>
                          <Button
                            variant="unstyled"
                            size="unset"
                            type="button"
                            aria-label={`${item.name} alanını aşağı taşı`}
                            disabled={
                              busy ||
                              !order.canReorder ||
                              index === displayed.length - 1
                            }
                            onClick={() => void move(item.id, 1)}
                          >
                            <ArrowDown size={16} />
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              {!displayed.some((item) =>
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
              <Button
                variant="unstyled"
                size="unset"
                type="submit"
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
              </Button>
              <Button
                variant="unstyled"
                size="unset"
                type="submit"
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
              </Button>
            </div>
          </>
        ) : (
          <>
            <Button
              variant="unstyled"
              size="unset"
              type="submit"
              className="workspace-back"
              disabled={busy}
              onClick={() => show("list")}
            >
              <ArrowLeft size={16} /> Alanlarıma dön
            </Button>
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
                  <Input
                    unstyled
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
                  <Input
                    unstyled
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
              <Button
                variant="default"
                size="unset"
                type="submit"
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
              </Button>
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
