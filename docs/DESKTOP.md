# Mola masaüstü

Masaüstü istemcisi Linux, macOS ve Windows üzerinde mevcut Mola sunucunuza bağlanır. Mesajlar, üyelikler, dosyalar ve görüşmeler aynı sunucuyu kullanır. Masaüstü paketine Express sunucusu, SQLite veritabanı veya sunucu sırları dahil edilmez. Kullanıcıların uygulamayı açmak için Node.js kurması gerekmez.

## İlk açılış

1. İşletim sisteminize uygun paketi kurun ve Mola'yı açın.
2. Ekip sunucunuzun kök HTTPS adresini girin ve bağlanın; sayfa yolu veya davet bağlantısı eklemeyin.
3. Mevcut hesabınızla giriş yapın. Tarayıcıdaki oturumunuz masaüstüne otomatik aktarılmaz.

Sunucu adresi bu bilgisayarda saklanır. Sonradan uygulama menüsündeki **Mola → Sunucu adresini değiştir…** seçeneğiyle değiştirilebilir. Oturum verileri Electron'un kullanıcı profili dizininde tutulur. Sunucuya erişilemiyorsa bağlantı ekranından yeniden deneyebilir veya adresi değiştirebilirsiniz.

Üretim sunucusu geçerli bir HTTPS sertifikası kullanmalıdır. HTTP yalnızca `localhost`, `127.0.0.1` ve `[::1]` gibi yerel geliştirme adresleri için kabul edilir. Sertifika hataları atlanmaz. Sunucu adresi pakete gömülü değildir; `MOLA_SERVER_URL` ortam değişkeniyle de verebilirsiniz. Bu değişken tanımlıysa her açılışta kayıtlı adresten önce kullanılır; normal sunucu seçimine dönmek için değişkeni kaldırın.

## Geliştirme

Node.js **24+** ile depo kökünden:

```sh
npm ci
npm --prefix desktop ci
npm run dev
```

İkinci terminalde:

```sh
npm run desktop:dev
```

Geliştirme komutu varsayılan olarak `http://localhost:5173` adresini kullanır. Web ve API geliştirme süreçlerini `npm run dev` başlatır; masaüstü komutu yalnızca Electron'u başlatır. Üretim sunucusuna bağlanan istemciyi yerel web sunucusu olmadan açmak için:

```sh
npm --prefix desktop ci
npm run desktop
```

Sunucu adresi ortam değişkeni örneği, Linux/macOS:

```sh
MOLA_SERVER_URL='https://ekibinizin-sunucusu.example' npm run desktop
```

PowerShell:

```powershell
$env:MOLA_SERVER_URL = 'https://ekibinizin-sunucusu.example'
npm run desktop
```

Örnekteki adresi kendi sunucunuzla değiştirin. Gerçek ekip kullanımı için sunucudaki HTTPS, SMTP ve TURN kurulumu geçerliliğini korur; [dağıtım rehberi](DEPLOYMENT.md) ve [Coolify rehberi](COOLIFY.md) aynı şekilde uygulanır.

## Paket üretme

`desktop/` kendi `package.json` ve kilit dosyasına sahiptir. Yalnızca masaüstü paketi oluşturulacaksa kök projenin bağımlılıklarını yüklemek veya web arayüzünü derlemek gerekmez. Web arayüzünün güncel sürümü sunucudan yüklenir.

```sh
npm --prefix desktop ci
npm run desktop:pack
```

`desktop:pack`, mevcut işletim sistemi için kurulum dosyası olmadan uygulama klasörünü üretir. Dağıtılabilir paketler için komutu ilgili işletim sisteminde çalıştırın:

| Platform | Komut | Çıktı |
| --- | --- | --- |
| Linux x64 | `npm run desktop:linux` | `.AppImage`, `.deb` |
| Windows x64 | `npm run desktop:win` | NSIS `.exe` kurucusu |
| macOS Intel + Apple Silicon | `npm run desktop:mac` | Her mimari için `.dmg`, `.zip` |

Çıktılar `desktop/release/` dizinine yazılır; dosya adında sürüm, işletim sistemi ve mimari bulunur. macOS paketleri Electron 44 nedeniyle **macOS 13 veya üzerini** gerektirir. Linux ve Windows paketleri x64 içindir. [Electron 44 platform değişiklikleri](https://www.electronjs.org/blog/electron-44-0).

Mac'te imzalama sertifikası olmayan yerel denemeler için imzalamayı ve imzalı uygulamalar için kullanılan hardened runtime seçeneğini birlikte kapatın:

```sh
npm run desktop:mac -- -c.mac.identity=null -c.mac.hardenedRuntime=false
```

Ubuntu 24.04 ve üzeri için `.deb` paketini paket yöneticisiyle kurun. Paketin bulunduğu dizinde, dosya adını indirdiğiniz sürüme göre değiştirerek:

```sh
sudo apt install ./Mola-1.0.0-linux-amd64.deb
```

Kurulum uygulamayı `/opt/Mola/mola` konumuna yerleştirir ve Chromium sandbox'ının kullanıcı namespace erişimi için Mola'ya özel AppArmor profilini yükler. `linux-unpacked` klasörünü veya `.deb` içeriğini `~/.local/opt` gibi başka bir konuma kopyalamak bu kurulumu gerçekleştirmez; Ubuntu'da menüden açılış `chrome-sandbox` / SUID helper hatasıyla durabilir. Bu durumda `.deb` paketini yukarıdaki komutla kurun.

Daha önce elle oluşturulmuş `~/.local/share/applications/app.mola.desktop.desktop` dosyası varsa `Exec` satırını kontrol edin. `.deb` kurulumu tamamlandıktan sonra, eski kullanıcı dizinine işaret eden bu dosyayı yedeklemek için `applications` dizininin dışına taşıyın; kullanıcıya özel kısayol, paketin `/usr/share/applications` altındaki aynı adlı kısayolunun önüne geçer. Sonraki açılışı uygulama menüsünden doğrulayın.

Linux AppImage dosyası çalıştırılabilir izin ve FUSE 2 uyumluluk kitaplığı gerektirir; yalnızca FUSE 3 kurulmuş olması yeterli değildir. FUSE veya sandbox sorunu yaşarsanız Ubuntu'da `.deb` kurulumunu kullanın; AppImage içeriğini başka bir dizine çıkarmak AppArmor kurulumunun yerini tutmaz. Chromium sandbox'ını kapatan başlatma bayrakları eklemeyin.

Paket tanımı `desktop/electron-builder.yml` içindedir. Uygulama kimliği `app.mola.desktop`, görünür adı `Mola` ve sürümü `desktop/package.json` içinden gelir. Debian paketinin bakımcı adı `Mola`, proje bağlantısı mevcut GitHub deposudur; genel dağıtımdan önce bakımcı iletişim bilgilerini kendi bilgilerinizle güncelleyin.

## GitHub Actions

**Build Mola Desktop** iş akışı Actions ekranından elle başlatılabilir. `desktop-v*` etiketi gönderildiğinde de çalışır; etiket sürümü `desktop/package.json` sürümüyle eşleşmelidir (örneğin `1.0.0` için `desktop-v1.0.0`). Sürümü değiştirirken `desktop/package-lock.json` dosyasını da güncelleyin.

İş akışı önce masaüstü birim ve gerçek Electron açılış testlerini Linux'ta çalıştırır. Ayrıca web uygulamasını derleyip gerçek Mola sunucusu üzerinde Electron'dan mesaj gönderme ve kalıcılık akışını doğrular. Ardından Linux, Windows, Intel macOS ve Apple Silicon macOS paketlerini ilgili işletim sistemlerinin ayrı çalıştırıcılarında üretir. [GitHub çalıştırıcı mimarileri](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

Üretilen dosyalar ve bütünlük kontrolü için `SHA256SUMS` dosyası iş akışının **Artifacts** bölümünde 14 gün saklanır. İş akışı bir GitHub Release oluşturmaz, mağazaya göndermez ve paketleri kamuya yayımlamaz. CI çıktıları imzasız inceleme paketleridir; macOS'ta imzalama ve hardened runtime birlikte kapatılır. Test işindeki geçici Linux çalıştırıcısında Chromium sandbox'ının ihtiyaç duyduğu kullanıcı namespace desteği etkinleştirilir; Electron sandbox'ı açık kalır.

## İmzalama ve dağıtım

Windows ve macOS'ta kullanıcılara genel dağıtım için kendi yayıncı sertifikalarınız gerekir. İmzasız Windows paketlerinde SmartScreen uyarıları görülebilir; macOS'ta Gatekeeper uygulamanın açılmasını engelleyebilir. CI'ın imzasız paketleri imzalı dağıtımın tamamlandığı anlamına gelmez.

macOS'ta Developer ID Application sertifikasını güvenli ortamdan `CSC_LINK` ve `CSC_KEY_PASSWORD` ile sağlayın. Noter onayı için `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` veya `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` ortam değişkenleri kullanılır. İmzalı derlemeyi macOS üzerinde varsayılan yapılandırmayla (`hardenedRuntime: true`) çalıştırın; `identity=null` / `hardenedRuntime=false` geçersiz kılmalarını kullanmayın. [electron-builder 26 macOS imzalama](https://www.electron.build/v26/docs/features/code-signing/code-signing-mac/) ve [noter onayı seçenekleri](https://www.electron.build/v26/docs/mac/#notarize).

Windows'ta kendi kod imzalama sağlayıcınızı electron-builder'ın Windows imzalama seçenekleriyle yapılandırın. Dosya tabanlı sertifikanız varsa `CSC_LINK` ve `CSC_KEY_PASSWORD` kullanılabilir; donanım veya bulut tabanlı sertifikalar sağlayıcının entegrasyonunu gerektirir. Sertifika ve parolaları depoya eklemeyin. İmzalı CI dağıtımı için ayrıca güvenli secrets bağlantısı ve imzalı paketlerin hedef cihazlarda doğrulanması gerekir.

## Görüşmeler ve masaüstü davranışı

- Mikrofon ve kamera erişimi kullanıcı izniyle açılır; macOS ayrıca işletim sistemi izni ister. Paket mikrofon/kamera kullanım açıklamalarını içerir. İzin tercihi uygulama açık kaldığı sürece hatırlanır. Reddedilen iznin yeniden sorulması için Mola'yı tamamen kapatıp uygulamayı yeniden başlatın; işletim sistemi izni de reddedildiyse gizlilik ayarlarından düzeltin.
- Ekran paylaşımı her başlatıldığında Mola'nın izin penceresi gösterilir. İzin verdikten sonra mevcutsa işletim sisteminin kaynak seçicisi, diğer durumlarda Mola'nın ekran/pencere seçicisi açılır. macOS'ta ekran kaydı izni, Linux Wayland'de uygun masaüstü portalı gerekir. Ekran paylaşımı sistem sesini içermez.
- Görüşmeyi küçük pencereye alma mevcut web özelliğini kullanır. Destek cihaz ve Electron sürümüyle doğrulanmalıdır.
- Harici bağlantılar sistem tarayıcısında açılır. Uzak Mola sayfasının Node.js erişimi yoktur; kurulum arayüzü ayrı tutulur.
- Otomatik güncelleme, sistem tepsisi ve yerel arka plan bildirimi bu sürüme dahil değildir. Uygulama kapalıyken bildirim alma garantisi yoktur. Web uygulamasındaki tarayıcı bildirimi / Web Push özellikleri Electron'da ayrıca doğrulanmalıdır; tarayıcı desteği masaüstü desteği olarak kabul edilmez.

Sunucu güncellemeleri istemci içindeki web arayüzüne yansır. Electron veya masaüstü kabuğu güncellemeleri için yeni paket kurulması gerekir. Sunucu bağlantısı olmadan ekip verileriyle çevrimdışı çalışma desteklenmez.

## Doğrulama

```sh
npm run desktop:test
npm --prefix desktop run test:smoke
npm run desktop:pack
```

Smoke testi grafik oturumu gerektirir. Başsız Linux ortamında `xvfb-run --auto-servernum npm --prefix desktop run test:smoke` kullanılabilir. Electron kendi çalıştırıcısını kullandığı için ayrıca Playwright tarayıcısı indirmek gerekmez.

Gerçek Mola web arayüzü, Express ve Socket.IO ile entegrasyonu da yerelde denemek için kök bağımlılıklarını kurup arayüzü derleyin:

```sh
npm ci
npm run build
npm run desktop:test:app
```

Bu test geçici sunucu ve veritabanı kullanır; Electron içinden mesaj gönderimini ve yeniden açılışta kalıcılığı doğrular. Yalnızca masaüstü kabuğunu paketlemek için gerekli değildir; CI'da paketlemeden önce çalışır.

Dağıtım öncesinde her hedef işletim sisteminde paketi kurup şu akışları gerçek sunucuyla doğrulayın: ilk sunucu seçimi, giriş ve yeniden açılışta oturumun korunması, mesaj/dosya gönderme, harici bağlantı, mikrofon/kamera, ekran seçimi ve paylaşımı, sunucu erişimi kesilip geri geldiğinde yeniden bağlanma. Fiziksel cihaz, işletim sistemi izinleri, Wayland/X11, farklı ağlar ve imzalı kurulum davranışı otomatik Linux testiyle tamamen doğrulanamaz.
