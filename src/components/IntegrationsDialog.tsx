import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowLeft,
  Bot,
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  GitBranch,
  KeyRound,
  LockKeyhole,
  Plus,
  RefreshCw,
  Webhook,
} from "lucide-react";
import type { Channel } from "../../shared/types";
import { api, post } from "../lib/api";
import { IconButton, Modal, Spinner } from "./ui";
import "./integrations.css";

interface Integration {
  id: string;
  name: string;
  kind: "github" | "webhook";
  repository: string;
  channelId: string;
  channelName: string;
  enabled: boolean;
  createdAt: string;
  lastDeliveryAt: string | null;
  lastStatus: string | null;
  url: string;
}
type Setup = { integration: Integration; secret?: string };
const date = (value: string) =>
  new Date(value).toLocaleString("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
  });

export default function IntegrationsDialog({
  channels,
  isDemo = false,
  onClose,
}: {
  channels: Channel[];
  isDemo?: boolean;
  onClose: () => void;
}) {
  const [storedItems, setItems] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useState<"github" | "webhook">("github");
  const [name, setName] = useState("GitHub");
  const [storedSetup, setSetup] = useState<Setup>();
  const [showSecret, setShowSecret] = useState(false);
  const [storedRotate, setRotate] = useState<Integration>();
  const available = channels.filter(
    (channel) => channel.kind === "text" && !channel.archived,
  );
  const [selectedChannel, setSelectedChannel] = useState(
    available[0]?.id || "",
  );
  const allowed = new Set(
    channels
      .filter((channel) => channel.kind === "text")
      .map((channel) => channel.id),
  );
  const allowedKey = [...allowed].sort().join(",");
  const allowedRef = useRef(allowed);
  allowedRef.current = allowed;
  const alive = useRef(true);
  const loadVersion = useRef(0);
  const items = storedItems.filter((item) => allowed.has(item.channelId));
  const setup =
    storedSetup && allowed.has(storedSetup.integration.channelId)
      ? storedSetup
      : undefined;
  const rotate =
    storedRotate && allowed.has(storedRotate.channelId)
      ? storedRotate
      : undefined;
  const selectedAvailable = available.some(
    (channel) => channel.id === selectedChannel,
  );
  const reload = useCallback(async () => {
    const version = ++loadVersion.current;
    setError("");
    try {
      const next = await api<{ integrations: Integration[] }>("/integrations");
      if (alive.current && loadVersion.current === version)
        setItems(
          next.integrations.filter((item) =>
            allowedRef.current.has(item.channelId),
          ),
        );
    } catch (e) {
      if (alive.current && loadVersion.current === version)
        setError((e as Error).message);
    } finally {
      if (alive.current && loadVersion.current === version) setLoading(false);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    setItems((previous) =>
      previous.filter((item) => allowedRef.current.has(item.channelId)),
    );
    setSetup((previous) =>
      previous && allowedRef.current.has(previous.integration.channelId)
        ? previous
        : undefined,
    );
    setRotate((previous) =>
      previous && allowedRef.current.has(previous.channelId)
        ? previous
        : undefined,
    );
    void reload();
    return () => {
      alive.current = false;
      loadVersion.current += 1;
    };
  }, [reload, allowedKey]);
  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label} kopyalandı.`);
    } catch {
      setError("Panoya kopyalanamadı. Alanı seçerek elle kopyalayabilirsin.");
    }
  }
  function accept(result: Integration & { secret?: string }) {
    const { secret, ...integration } = result;
    if (!alive.current || !allowedRef.current.has(integration.channelId))
      return false;
    loadVersion.current += 1;
    setLoading(false);
    setItems((previous) => [
      integration,
      ...previous.filter((item) => item.id !== integration.id),
    ]);
    if (secret) {
      setSetup({ integration, secret });
      setShowSecret(false);
    }
    setCreating(false);
    setRotate(undefined);
    return true;
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || isDemo || !selectedAvailable) return;
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      accept(
        await post<Integration & { secret: string }>("/integrations", {
          name,
          kind,
          channelId: values.get("channelId"),
          ...(kind === "github"
            ? { repository: String(values.get("repository") || "").trim() }
            : {}),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function update(item: Integration, action: "toggle" | "rotate") {
    if (busy || !allowedRef.current.has(item.channelId)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const accepted = accept(
        await api<Integration & { secret?: string }>(
          `/integrations/${item.id}`,
          {
            method: "PATCH",
            body: JSON.stringify(
              action === "rotate"
                ? { rotateSecret: true }
                : { enabled: !item.enabled },
            ),
          },
        ),
      );
      if (accepted && action === "toggle")
        setNotice(`${item.name} ${item.enabled ? "kapatıldı" : "açıldı"}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function back() {
    setSetup(undefined);
    setCreating(false);
    setRotate(undefined);
    setShowSecret(false);
    setNotice("");
    setError("");
  }
  return (
    <Modal
      title="Entegrasyonlar"
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <div className="integrations-dialog">
        {(creating || setup) && (
          <Button
            variant="unstyled"
            size="unset"
            type="button"
            className="integration-back"
            disabled={busy}
            onClick={back}
          >
            <ArrowLeft size={16} /> Entegrasyonlara dön
          </Button>
        )}
        {!creating && !setup && (
          <>
            <div className="integration-intro">
              <span className="integration-emblem">
                <Bot size={29} />
              </span>
              <div>
                <h3>Ekibinin araçları, sohbetin içinde.</h3>
                <p>
                  GitHub gelişmelerini veya kendi uygulamalarının bildirimlerini
                  seçtiğin kanala getir.
                </p>
              </div>
            </div>
            <div className="integration-toolbar">
              <strong>{items.length} entegrasyon</strong>
              <IconButton
                label="Entegrasyonları yenile"
                disabled={loading || busy}
                onClick={() => void reload()}
              >
                <RefreshCw size={17} />
              </IconButton>
              <Button
                variant="default"
                size="unset"
                type="button"
                className="primary-button"
                disabled={isDemo || busy || !available.length}
                onClick={() => {
                  setCreating(true);
                  setError("");
                  setNotice("");
                }}
              >
                <Plus size={16} /> Entegrasyon ekle
              </Button>
            </div>
            {isDemo && (
              <p className="integration-note">
                Entegrasyonları bağlamak için gerçek hesabınla bir çalışma alanı
                oluştur.
              </p>
            )}
            {!available.length && !isDemo && (
              <p className="integration-note">
                Entegrasyon eklemek için önce yazabildiğin bir metin kanalı
                oluştur.
              </p>
            )}
            {loading ? (
              <Spinner label="Entegrasyonlar yükleniyor" />
            ) : (
              <div className="integration-list">
                {items.map((item) => (
                  <article key={item.id} className="integration-row">
                    <span className="integration-kind-icon">
                      {item.kind === "github" ? (
                        <GitBranch size={22} />
                      ) : (
                        <Webhook size={22} />
                      )}
                    </span>
                    <div className="integration-row-copy">
                      <h4>
                        {item.name}
                        <span
                          className={`integration-status ${item.enabled ? "enabled" : ""}`}
                        >
                          {item.enabled ? "Açık" : "Kapalı"}
                        </span>
                      </h4>
                      <p>
                        #{item.channelName}
                        {item.repository && ` · ${item.repository}`}
                      </p>
                      <small>
                        {item.lastDeliveryAt
                          ? `Son başarılı bildirim: ${date(item.lastDeliveryAt)}`
                          : "İlk bildirimi bekliyor"}
                      </small>
                      <div className="integration-row-actions">
                        <Button
                          variant="unstyled"
                          size="unset"
                          type="button"
                          onClick={() => {
                            setSetup({ integration: item });
                            setNotice("");
                            setError("");
                          }}
                        >
                          Kurulum bilgileri
                        </Button>
                        <Button
                          variant="unstyled"
                          size="unset"
                          type="button"
                          disabled={busy}
                          onClick={() => void update(item, "toggle")}
                        >
                          {item.enabled ? "Kapat" : "Aç"}
                        </Button>
                        <Button
                          variant="unstyled"
                          size="unset"
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setRotate(item);
                            setError("");
                          }}
                        >
                          <KeyRound size={13} /> Anahtarı yenile
                        </Button>
                      </div>
                    </div>
                  </article>
                ))}
                {!items.length && (
                  <div className="integration-empty">
                    <Webhook size={28} />
                    <h4>Henüz bir araç bağlı değil.</h4>
                    <p>
                      GitHub deposu veya gelen webhook eklediğinde bildirimleri
                      ayrı bir ekip botu paylaşacak.
                    </p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
        {creating && (
          <form className="integration-create" onSubmit={create}>
            <fieldset className="integration-options" disabled={busy}>
              <legend>Ne bağlamak istiyorsun?</legend>
              {(["github", "webhook"] as const).map((option) => (
                <label
                  key={option}
                  className={kind === option ? "selected" : ""}
                >
                  <input
                    type="radio"
                    name="kind"
                    value={option}
                    checked={kind === option}
                    onChange={() => {
                      setKind(option);
                      setName(option === "github" ? "GitHub" : "Ekip botu");
                    }}
                  />
                  {option === "github" ? (
                    <GitBranch size={24} />
                  ) : (
                    <Webhook size={24} />
                  )}
                  <span>
                    <strong>
                      {option === "github" ? "GitHub" : "Gelen webhook"}
                    </strong>
                    <small>
                      {option === "github"
                        ? "Commit, PR, issue ve sürüm haberleri."
                        : "Kendi uygulamandan kanala mesaj gönder."}
                    </small>
                  </span>
                </label>
              ))}
            </fieldset>
            <label>
              Botun adı
              <Input
                unstyled
                name="name"
                aria-label="Botun adı"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2}
                maxLength={50}
                disabled={busy}
              />
              <small>Kanaldaki mesajlar bu adla görünür.</small>
            </label>
            <label>
              Bildirim kanalı
              <NativeSelect
                unstyled
                name="channelId"
                aria-label="Bildirim kanalı"
                value={selectedAvailable ? selectedChannel : ""}
                onChange={(event) => setSelectedChannel(event.target.value)}
                required
                disabled={busy}
              >
                <option value="" disabled>
                  Bir kanal seç
                </option>
                {available.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.visibility === "private" ? "🔒 " : "#"}
                    {channel.name}
                  </option>
                ))}
              </NativeSelect>
            </label>
            {kind === "github" && (
              <label>
                GitHub deposu
                <Input
                  unstyled
                  name="repository"
                  aria-label="GitHub deposu"
                  placeholder="ekibim/proje"
                  pattern="[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+"
                  maxLength={200}
                  required
                  disabled={busy}
                />
                <small>Depo sahibi ve depo adını araya / koyarak yaz.</small>
              </label>
            )}
            <p className="integration-note">
              <LockKeyhole size={14} /> Bot yalnızca seçtiğin kanala erişir.
              Bağlantı adresi ve anahtarı sonraki adımda hazırlanır.
            </p>
            <div className="integration-footer">
              <Button
                variant="outline"
                size="unset"
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={back}
              >
                Vazgeç
              </Button>
              <Button
                variant="default"
                size="unset"
                type="submit"
                className="primary-button"
                disabled={busy || !selectedAvailable}
              >
                {busy ? (
                  <Spinner label="Oluşturuluyor" />
                ) : (
                  "Entegrasyonu oluştur"
                )}
              </Button>
            </div>
          </form>
        )}
        {setup && (
          <div className="integration-setup">
            <div className="integration-setup-title">
              <span className="integration-kind-icon">
                {setup.integration.kind === "github" ? (
                  <GitBranch size={24} />
                ) : (
                  <Webhook size={24} />
                )}
              </span>
              <div>
                <h3>{setup.integration.name}</h3>
                <p>
                  Bildirimler #{setup.integration.channelName} kanalında
                  paylaşılacak.
                </p>
              </div>
            </div>
            {setup.secret && (
              <p className="integration-secret-note">
                <KeyRound size={17} /> Anahtar yalnızca bu ekranda gösterilir.
                Bağlayacağın hizmete kaydet; daha sonra yeniden görmek için
                yenilemen gerekir.
              </p>
            )}
            <label className="integration-copy-label">
              Webhook adresi
              <div className="integration-copy">
                <Input
                  unstyled
                  aria-label="Webhook adresi"
                  readOnly
                  value={setup.integration.url}
                  onFocus={(event) => event.target.select()}
                />
                <IconButton
                  label="Webhook adresini kopyala"
                  onClick={() =>
                    void copy(setup.integration.url, "Webhook adresi")
                  }
                >
                  <Copy size={17} />
                </IconButton>
              </div>
            </label>
            {setup.secret ? (
              <label className="integration-copy-label">
                {setup.integration.kind === "github"
                  ? "GitHub Secret"
                  : "Entegrasyon anahtarı"}
                <div className="integration-copy">
                  <Input
                    unstyled
                    aria-label="Entegrasyon anahtarı"
                    type={showSecret ? "text" : "password"}
                    readOnly
                    autoComplete="off"
                    value={setup.secret}
                    onFocus={(event) => event.target.select()}
                  />
                  <IconButton
                    label={showSecret ? "Anahtarı gizle" : "Anahtarı göster"}
                    onClick={() => setShowSecret((value) => !value)}
                  >
                    {showSecret ? <EyeOff size={17} /> : <Eye size={17} />}
                  </IconButton>
                  <IconButton
                    label="Entegrasyon anahtarını kopyala"
                    onClick={() =>
                      void copy(setup.secret!, "Entegrasyon anahtarı")
                    }
                  >
                    <Copy size={17} />
                  </IconButton>
                </div>
              </label>
            ) : (
              <p className="integration-note">
                Anahtar yeniden gösterilmez. Kaybettiysen{" "}
                <Button
                  variant="unstyled"
                  size="unset"
                  type="button"
                  className="integration-inline"
                  onClick={() => setRotate(setup.integration)}
                >
                  yeni anahtar oluşturabilirsin
                </Button>
                .
              </p>
            )}
            {setup.integration.kind === "github" ? (
              <div className="integration-instructions">
                <h4>GitHub’da bağlantıyı tamamla</h4>
                <ol>
                  <li>
                    Deponun <strong>Settings → Webhooks → Add webhook</strong>{" "}
                    ekranını aç.
                  </li>
                  <li>
                    Adresi <strong>Payload URL</strong> alanına, anahtarı{" "}
                    <strong>Secret</strong> alanına yapıştır.{" "}
                    <strong>Content type</strong> olarak{" "}
                    <code>application/json</code> seç.
                  </li>
                  <li>
                    İstediğin olayları seç: push, pull request, issues, workflow
                    runs ve releases desteklenir. <strong>Active</strong>{" "}
                    açıkken kaydet.
                  </li>
                </ol>
                <p>
                  GitHub’ın gönderdiği ilk ping başarılı olduğunda listede son
                  bildirim zamanı görünür.
                </p>
                <a
                  href={`https://github.com/${setup.integration.repository}/settings/hooks/new`}
                  target="_blank"
                  rel="noreferrer"
                >
                  GitHub webhook ayarlarını aç <ExternalLink size={14} />
                </a>
                <a
                  className="integration-documentation"
                  href="https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks"
                  target="_blank"
                  rel="noreferrer"
                >
                  GitHub kurulum rehberi
                </a>
              </div>
            ) : (
              <div className="integration-instructions">
                <h4>Uygulamandan mesaj gönder</h4>
                <p>
                  Adrese JSON içeren bir POST isteği gönder. Anahtarı{" "}
                  <code>Authorization: Bearer</code> başlığına ekle.
                </p>
                <pre aria-label="Webhook istek örneği">{`POST ${setup.integration.url}\nContent-Type: application/json\nAuthorization: Bearer MOLA_ANAHTARI\n\n${JSON.stringify({ content: "Yeni sürüm yayına alındı.", eventId: "release-001" }, null, 2)}`}</pre>
                <p>
                  Aynı <code>eventId</code> ile tekrar gönderilen bildirimler
                  ikinci bir mesaj oluşturmaz. Her yeni olay için farklı bir
                  kimlik kullan.
                </p>
              </div>
            )}
            <div className="integration-footer">
              <Button
                variant="default"
                size="unset"
                type="button"
                className="primary-button"
                onClick={back}
              >
                <Check size={16} />{" "}
                {setup.secret
                  ? "Anahtarı kaydettim, tamam"
                  : "Entegrasyonlara dön"}
              </Button>
            </div>
          </div>
        )}
        {rotate && (
          <div className="integration-rotate" role="alert">
            <h4>{rotate.name} anahtarı yenilensin mi?</h4>
            <p>
              Mevcut anahtar hemen geçersiz olacak. Bildirimlerin devam etmesi
              için yeni anahtarı bağlı hizmette de güncelle.
            </p>
            <div>
              <Button
                variant="outline"
                size="unset"
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => setRotate(undefined)}
              >
                Vazgeç
              </Button>
              <Button
                variant="default"
                size="unset"
                type="button"
                className="primary-button"
                disabled={busy}
                onClick={() => void update(rotate, "rotate")}
              >
                {busy ? "Yenileniyor…" : "Anahtarı yenile ve göster"}
              </Button>
            </div>
          </div>
        )}
        {notice && (
          <p className="integration-feedback" role="status">
            <Check size={15} /> {notice}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
