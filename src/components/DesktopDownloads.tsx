import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Laptop,
  LoaderCircle,
  Monitor,
  RefreshCw,
  Smartphone,
  Terminal,
} from "lucide-react";
import type {
  DesktopArchitecture,
  DesktopFormat,
  DesktopPlatform,
  DesktopReleaseCatalog,
} from "../../shared/desktop-downloads";
import {
  detectDownloadDevice,
  formatDownloadSize,
} from "../lib/desktop-platform";
import { Logo } from "./ui";
import "./desktop-downloads.css";

const platforms = [
  {
    id: "windows",
    name: "Windows",
    detail: "64 bit · Kurulum dosyası",
    icon: Monitor,
  },
  {
    id: "macos",
    name: "macOS",
    detail: "Apple Silicon veya Intel · macOS 13+",
    icon: Laptop,
  },
  {
    id: "linux",
    name: "Linux",
    detail: "64 bit · DEB veya AppImage",
    icon: Terminal,
  },
] as const;
const external = { target: "_blank", rel: "noopener noreferrer" } as const;

export function DesktopDownloads({
  serverUrl = location.origin,
}: {
  serverUrl?: string;
}) {
  const [device] = useState(() => detectDownloadDevice(navigator));
  const [selectedPlatform, setSelectedPlatform] =
    useState<DesktopPlatform | null>(() =>
      platforms.some((item) => item.id === device.platform)
        ? (device.platform as DesktopPlatform)
        : null,
    );
  const [architecture, setArchitecture] = useState<DesktopArchitecture | null>(
    null,
  );
  const [format, setFormat] = useState<DesktopFormat>("deb");
  const [catalog, setCatalog] = useState<DesktopReleaseCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState(0);
  const [copyStatus, setCopyStatus] = useState("");
  const serverInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void fetch("/api/desktop/releases", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Download catalog unavailable");
        return response.json() as Promise<DesktopReleaseCatalog>;
      })
      .then((value) => {
        if (!controller.signal.aborted) setCatalog(value);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setCatalog({
            status: "unavailable",
            assets: [],
            version: null,
            releaseUrl: null,
            publishedAt: null,
            checksumsUrl: null,
            stale: false,
          });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [request]);

  const selected = platforms.find((item) => item.id === selectedPlatform);
  const selectedArchitecture =
    selectedPlatform === "macos" ? architecture : "x64";
  const selectedFormat =
    selectedPlatform === "windows"
      ? "exe"
      : selectedPlatform === "macos"
        ? "dmg"
        : format;
  const asset = catalog?.assets.find(
    (item) =>
      item.platform === selectedPlatform &&
      item.architecture === selectedArchitecture &&
      item.format === selectedFormat,
  );
  const zip =
    selectedPlatform === "macos" &&
    catalog?.assets.find(
      (item) =>
        item.platform === "macos" &&
        item.architecture === architecture &&
        item.format === "zip",
    );
  const isMobile = device.platform === "android" || device.platform === "ios";
  const architectureMismatch =
    selectedPlatform === device.platform &&
    (device.architecture === "arm64" ||
      device.architecture === "unsupported") &&
    selectedPlatform !== "macos";

  async function copyServer() {
    try {
      await navigator.clipboard.writeText(serverUrl);
      setCopyStatus("Sunucu adresi kopyalandı.");
    } catch {
      serverInput.current?.focus();
      serverInput.current?.select();
      setCopyStatus(
        "Adres seçildi. Kopyalayıp uygulamaya yapıştırabilirsiniz.",
      );
    }
  }

  return (
    <main className="desktop-download-page">
      <div className="desktop-download-wrap">
        <header className="desktop-download-nav">
          <a href="/" aria-label="Mola ana sayfa">
            <Logo />
          </a>
          <a className="desktop-download-back" href="/">
            <ArrowLeft size={16} /> Mola'ya dön
          </a>
        </header>

        <section
          className="desktop-download-intro"
          aria-labelledby="download-heading"
        >
          <span className="desktop-download-eyebrow">
            <Laptop size={16} /> MASAÜSTÜ UYGULAMASI
          </span>
          <h1 id="download-heading">Ekibin, masaüstünde.</h1>
          <p>
            Mesajların, görüşmelerin ve çalışma alanların tek bir uygulamada.
            Mola'yı indir, mevcut sunucuna bağlan ve kaldığın yerden devam et.
          </p>
        </section>

        {(device.nativeDesktop ||
          isMobile ||
          device.platform === "chromeos") && (
          <div className="desktop-download-device-note">
            {isMobile ? <Smartphone size={22} /> : <CheckCircle2 size={22} />}
            <div>
              <strong>
                {device.nativeDesktop
                  ? "Mola masaüstü uygulamasındasın"
                  : isMobile
                    ? "Şu anda mobil cihazdasın"
                    : "ChromeOS kullanıyorsun"}
              </strong>
              <p>
                {device.nativeDesktop
                  ? "Yeni bir sürüm kurmak veya başka bir bilgisayar için paket indirmek istersen aşağıdan seçebilirsin."
                  : isMobile
                    ? "Bu kurulum dosyaları bilgisayarlar içindir. Telefonda Mola'yı kullanmaya devam edebilir, bilgisayarın için aşağıdan paket seçebilirsin."
                    : "ChromeOS için yerel masaüstü paketi bulunmuyor. Mola'yı tarayıcıda kullanmaya devam edebilirsin."}
              </p>
            </div>
          </div>
        )}

        <section
          className="desktop-download-picker"
          aria-labelledby="download-platform-heading"
        >
          <div className="desktop-download-section-title">
            <h2 id="download-platform-heading">Bilgisayarın için Mola</h2>
            {catalog?.status === "ready" && (
              <span className="desktop-download-version">
                Sürüm {catalog.version}
              </span>
            )}
          </div>
          <div
            className="desktop-download-platforms"
            aria-label="İşletim sistemi"
          >
            {platforms.map(({ id, name, detail, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={`desktop-download-platform${selectedPlatform === id ? " is-selected" : ""}`}
                aria-pressed={selectedPlatform === id}
                onClick={() => setSelectedPlatform(id)}
              >
                <span className="desktop-download-platform-top">
                  <Icon size={26} />
                  {selectedPlatform === id && <Check size={17} />}
                </span>
                <strong>{name}</strong>
                <span>{detail}</span>
                {device.platform === id && !architectureMismatch && (
                  <small>Bu cihazda algılandı</small>
                )}
              </button>
            ))}
          </div>

          <div className="desktop-download-selection">
            {selected ? (
              <>
                <h3>{selected.name} için kurulum</h3>
                {selectedPlatform === "macos" && (
                  <fieldset className="desktop-download-options">
                    <legend>Mac işlemcin</legend>
                    <div>
                      <button
                        type="button"
                        aria-pressed={architecture === "arm64"}
                        onClick={() => setArchitecture("arm64")}
                      >
                        Apple Silicon <span>M1, M2, M3 ve sonrası</span>
                      </button>
                      <button
                        type="button"
                        aria-pressed={architecture === "x64"}
                        onClick={() => setArchitecture("x64")}
                      >
                        Intel <span>Intel işlemcili Mac</span>
                      </button>
                    </div>
                    <p>
                      İşlemcini Apple menüsü → Bu Mac Hakkında bölümünden
                      görebilirsin. Tarayıcı bunu her zaman doğru bildirmez.
                    </p>
                  </fieldset>
                )}
                {selectedPlatform === "linux" && (
                  <fieldset className="desktop-download-options">
                    <legend>Paket biçimi</legend>
                    <div>
                      <button
                        type="button"
                        aria-pressed={format === "deb"}
                        onClick={() => setFormat("deb")}
                      >
                        DEB <span>Ubuntu ve Debian için</span>
                      </button>
                      <button
                        type="button"
                        aria-pressed={format === "AppImage"}
                        onClick={() => setFormat("AppImage")}
                      >
                        AppImage <span>Diğer uyumlu dağıtımlar</span>
                      </button>
                    </div>
                  </fieldset>
                )}
                {architectureMismatch && (
                  <p className="desktop-download-compatibility">
                    Bu cihazın işlemcisi x64 olarak algılanmadı.{" "}
                    {selectedPlatform === "linux"
                      ? "Linux paketi yalnızca Intel / AMD 64 bit bilgisayarlar içindir; ARM cihazlara uygun değildir."
                      : "Windows paketi x64 içindir. ARM bilgisayarında işletim sisteminin x64 uygulama desteğini kontrol et."}
                  </p>
                )}
                {loading ? (
                  <div className="desktop-download-status" role="status">
                    <LoaderCircle
                      className="desktop-download-spinner"
                      size={19}
                    />{" "}
                    Güncel kurulum dosyaları kontrol ediliyor…
                  </div>
                ) : catalog?.status === "ready" ? (
                  asset ? (
                    <div className="desktop-download-action">
                      <a
                        className="desktop-download-primary"
                        href={asset.url}
                        {...external}
                      >
                        <Download size={19} /> {selected.name} için indir{" "}
                        <span>.{asset.format}</span>
                      </a>
                      <span className="desktop-download-file-info">
                        {formatDownloadSize(asset.size)} ·{" "}
                        {selectedArchitecture === "arm64"
                          ? "Apple Silicon"
                          : selectedPlatform === "macos"
                            ? "Intel"
                            : "x64"}
                      </span>
                      {zip && (
                        <a
                          className="desktop-download-secondary-link"
                          href={zip.url}
                          {...external}
                        >
                          ZIP olarak indir <ArrowUpRight size={14} />
                        </a>
                      )}
                    </div>
                  ) : (
                    <p className="desktop-download-status" role="status">
                      İndirme bağlantısı için yukarıdan Mac işlemcini seç.
                    </p>
                  )
                ) : (
                  <div className="desktop-download-status-block" role="status">
                    <strong>
                      {catalog?.status === "unpublished"
                        ? "Kurulum paketleri henüz yayımlanmadı"
                        : "İndirme bilgilerine şu anda ulaşılamıyor"}
                    </strong>
                    <p>
                      {catalog?.status === "unpublished"
                        ? "İlk masaüstü sürümü yayımlandığında indirme bağlantıları burada görünecek. Bu sırada Mola'yı tarayıcıda kullanabilirsin."
                        : "Biraz sonra yeniden dene. Mola'yı tarayıcıda kullanmaya devam edebilirsin."}
                    </p>
                    <button
                      type="button"
                      onClick={() => setRequest((value) => value + 1)}
                    >
                      <RefreshCw size={15} /> Yeniden kontrol et
                    </button>
                  </div>
                )}
              </>
            ) : (
              <p className="desktop-download-choose">
                İndirmek istediğin bilgisayarın işletim sistemini seç.
              </p>
            )}
          </div>
          {catalog?.stale && (
            <p className="desktop-download-stale" role="status">
              Sürüm bilgisi şu anda yenilenemedi. Son doğrulanan indirme
              bağlantıları gösteriliyor.
            </p>
          )}
        </section>

        <section
          className="desktop-download-install"
          aria-labelledby="download-install-heading"
        >
          <h2 id="download-install-heading">Üç adımda hazır</h2>
          <ol>
            <li>
              <span className="desktop-download-step">1</span>
              <div>
                <h3>Uygulamayı kur</h3>
                <p>
                  {selectedPlatform === "windows"
                    ? "İndirdiğin EXE dosyasını aç ve kurulum adımlarını tamamla. Mola, Başlat menüsüne eklenir."
                    : selectedPlatform === "macos"
                      ? "DMG dosyasını aç, Mola'yı Uygulamalar klasörüne taşı. macOS 13 veya üzeri gerekir."
                      : selectedPlatform === "linux" && format === "AppImage"
                        ? "Dosya özelliklerinden çalıştırma iznini aç. AppImage, FUSE 2 desteği gerektirir. Ubuntu ve Debian'da DEB paketi daha kolay kurulur."
                        : selectedPlatform === "linux"
                          ? "DEB dosyasını sisteminin paket yöneticisiyle kur. Kurulum tamamlanınca uygulama menüsünden Mola'yı aç."
                          : "İşletim sistemine uygun paketi indir ve bilgisayarının kurulum adımlarını tamamla."}
                </p>
              </div>
            </li>
            <li>
              <span className="desktop-download-step">2</span>
              <div>
                <h3>Ekibinin sunucusuna bağlan</h3>
                <p>Mola ilk açıldığında aşağıdaki sunucu adresini gir.</p>
                <div className="desktop-download-server">
                  <label className="sr-only" htmlFor="download-server">
                    Ekip sunucusu adresi
                  </label>
                  <input
                    ref={serverInput}
                    id="download-server"
                    readOnly
                    value={serverUrl}
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={() => void copyServer()}
                    aria-label="Sunucu adresini kopyala"
                  >
                    <Copy size={17} />
                  </button>
                </div>
                <span className="desktop-download-copy-status" role="status">
                  {copyStatus}
                </span>
              </div>
            </li>
            <li>
              <span className="desktop-download-step">3</span>
              <div>
                <h3>Hesabınla giriş yap</h3>
                <p>
                  Mevcut e-posta adresini ve şifreni kullan. Tüm çalışma
                  alanların seni bekliyor; tarayıcı oturumun uygulamaya otomatik
                  aktarılmaz.
                </p>
              </div>
            </li>
          </ol>
          {(selectedPlatform === "windows" || selectedPlatform === "macos") && (
            <p className="desktop-download-signing">
              {selectedPlatform === "macos"
                ? "Bu macOS paketi henüz Developer ID ile imzalanmış ve Apple tarafından noter onaylı değildir. macOS ilk açılışı engelleyebilir."
                : "Bu Windows paketi henüz yayıncı sertifikasıyla imzalanmamıştır. Windows SmartScreen bir yayıncı uyarısı gösterebilir. Kurulum engellenirse Mola'yı tarayıcıda kullanabilirsin."}
            </p>
          )}
          {selectedPlatform === "macos" && (
            <details className="desktop-download-mac-help">
              <summary>Mac'te Mola açılmıyorsa</summary>
              <p>
                M serisi işlemcilerde Apple Silicon paketini seç. Güncel DMG
                içindeki Mola'yı Uygulamalar klasörüne taşı ve eski uygulamayı
                değiştir. Hesap ve sunucu ayarların korunur.
              </p>
              <p>
                Geliştirici doğrulanamadığı için engellenirse ve bu sayfadan
                indirdiğin uygulamaya güveniyorsan, açmayı denedikten sonra
                Sistem Ayarları → Gizlilik ve Güvenlik → Yine de Aç seçeneğini
                kullanabilirsin.
              </p>
              <p>
                “Hasarlı / damaged” uyarısı devam ederse açmaya zorlamadan önce
                paket bütünlüğünü kontrol et.{" "}
                <a
                  href="https://github.com/asilozkryl/mola/blob/codex/initial-release/docs/DESKTOP.md#macosta-hasarlı--damaged-uyarısı"
                  {...external}
                >
                  Mola kurulum rehberi
                </a>{" "}
                ve{" "}
                <a href="https://support.apple.com/tr-tr/102445" {...external}>
                  Apple'ın açılış yönergeleri
                </a>
                . Bu sırada Mola'yı tarayıcıda kullanabilirsin.
              </p>
            </details>
          )}
        </section>

        <footer className="desktop-download-footer">
          <span>Mola · Birlikte, aynı yerde.</span>
          {catalog?.releaseUrl && (
            <a href={catalog.releaseUrl} {...external}>
              Sürüm notları <ArrowUpRight size={14} />
            </a>
          )}
          {catalog?.checksumsUrl && (
            <a href={catalog.checksumsUrl} {...external}>
              Dosya bütünlüğü (SHA256) <ArrowUpRight size={14} />
            </a>
          )}
        </footer>
      </div>
    </main>
  );
}
