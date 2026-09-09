# mola.

**Birlikte, aynı yerde.** Türkçe ekip mesajlaşması, sesli odalar ve ekran paylaşımı. Slack'in kanal düzenini Discord'un ses odalarıyla bir araya getirir.

## Çalıştır

Node.js **24+** kullanın:

```sh
npm ci
npm run dev
```

[Mola'yı aç](http://localhost:5173). Yerel geliştirmede ilk ziyaret size özel, örnek içerikli bir çalışma alanı açar. Demo üyeleri kurgusaldır; çevrimiçi durumları gerçek bağlantılardan gelir. Gerçek ekip kurmak için **Profil → Çıkış yap → Hesap oluştur** akışını kullanın. İkinci kullanıcı, alan sahibinin ürettiği davet bağlantısıyla katılır.

Üretim derlemesi ve kontroller:

Son UI iyileştirmeleri ve kontrolleri: [ilk iyileştirme paketi](docs/FIRST_IMPROVEMENT_PACKAGE.md). Önceki kontroller: [doğrulama raporu](docs/VERIFICATION.md).

```sh
npm run build
npm test
npx playwright install chromium
npm run test:e2e
npm run test:auth
npm run test:admin
npm run test:load
```

## Kullanım

- **Kanallar ve özel mesajlar:** kalıcı mesajlar, yanıt dizileri, düzenleme/silme, emoji tepkileri, kanala sabitleme, tüm geçmişte arama.
- **Hızlı işlemler:** kanala veya mesaja sağ tıklayın; telefonda **⋯** düğmesini kullanın. Kanal menüsünden ad/açıklama düzenleme, erişim yönetimi, arşivleme ve kalıcı silme açılır. Kalıcı silme için kanalın güncel adını aynen yazmak gerekir. **Arşivlenmiş kanallar** bölümünden geçmişi okuyabilir veya yetkiniz varsa kanalı geri açabilirsiniz.
- **Dosyalar:** PNG, JPEG, GIF, WebP, PDF, TXT ve CSV; dosya başına 10 MB, mesaj başına 4 dosya. İndirme erişimi ait olduğu sohbetle sınırlıdır.
- **Görüşmeler:** sesli oda veya kanal başlığından başlatın. Sesli odaların altında katılımcılar ve mikrofon/kamera/ekran paylaşımı durumları anlık görünür; kişi simgesi odaya girmeden katılımcıları gösterir. Mikrofon, kamera, ayrı ekran paylaşımı ve görüşmeyi küçültme desteklenir. Odalar en fazla **6 katılımcı** alır. Ekran paylaşımı görüntüyü taşır; sistem sesi dahil değildir.
- **Birden fazla çalışma alanı:** sol üstteki alan adına veya soldaki **+** düğmesine tıklayın. Aynı hesapla alan oluşturabilir, davet bağlantısıyla başka ekibe katılabilir ve soldaki simgelerden geçiş yapabilirsiniz. Sahip/üye rolü her alanda ayrıdır. Görüşme sırasında alan değiştirirken ayrılmanız onaylanır; taslaklar korunur. Aynı tarayıcı oturumunun sekmeleri birlikte geçiş yapar; ayrı giriş yapılan cihazların aktif alanları bağımsızdır. [Üyelik ve geçiş ayrıntıları](docs/WORKSPACES.md).
- **Ekip:** sahip/üye rolleri, süreli davet, profil ve durum düzenleme, parola değiştirme ve diğer oturumları kapatma.
- **Yönetim paneli:** üye erişimi, kanal düzenleme/arşivleme/silme, davet iptali, ekip adı, parolayla sahiplik devri ve işlem geçmişi. Ayrı yetkilendirilen uygulama yöneticileri tüm çalışma alanlarının ve hesapların erişimini yönetir. [İlk yönetici ataması ve kullanım](docs/ADMIN.md).
- **Hesap güvenliği:** e-posta doğrulama, tek kullanımlık parola kurtarma bağlantıları, süreli ve şifreli e-posta kuyruğu. Parola kurtarma tüm açık oturumları kapatır.
- **Klavye:** `Ctrl/⌘ K` arama; `Enter` gönder; `Shift Enter` yeni satır; `Ctrl/⌘ B` kalın yazı; kanal veya mesaj odaktayken `Shift F10` işlem menüsü; menü içinde yön tuşları ve `Home/End`; `Esc` menü/pencereyi kapat.
- **Taslaklar ve tercihler:** metin taslakları sunucuya eşitlenir; eşzamanlı değişikliklerde hangi taslağın korunacağı seçilir. Dosya ekleri taslak eşitlemesine dahil değildir. Kaydedilen mesajlar ve odak modu bu tarayıcıda tutulur; Kaydedilenler cihazlar arası eşitlenmez.
- **Canlı geri bildirim:** gönderim onayı, yeni mesaj sayacı, çevrimiçi üyeler ve yazıyor bilgisi gerçek olaylardan güncellenir. Geçmişi okurken yeni mesajlar konumunuzu değiştirmez. Sisteminizin hareket azaltma tercihi desteklenir. [Arayüz kararları ve doğrulama](docs/DYNAMIC_UI.md).

## Docker ile dağıtım

**Coolify kullanıyorsanız:** [Coolify kurulum rehberi](docs/COOLIFY.md) ve `compose.coolify.yaml` dosyasını kullanın. HTTPS'i Coolify yönetir; uygulama alan adı yalnızca 3001 portuna yönlendirilir. `.env.coolify.example` gerekli ayarları listeler. İlk dağıtım SMTP/TURN olmadan açılabilir: yeni hesap kaydı e-posta servisi hazır olana kadar kapalıdır, mevcut doğrulanmış hesaplar kullanılabilir; doğrudan görüşmeler bazı ağlarda bağlanamayabilir. Sağlayıcılar sonradan ortam değişkenleriyle etkinleştirilir. Yerel paket provası: `npm run check:coolify`; sağlayıcısız prova: `npm run check:coolify -- --deferred`.

Alan adı ve TURN servisi gerektirmeyen, yalnızca bilgisayarınıza açılan yerel Docker sürümü:

```sh
docker compose -f compose.local.yaml up -d --build
```

[Yerel Docker uygulaması](http://localhost:3000). Yerel Compose HTTP kullanır ve yalnızca `127.0.0.1` adresine bağlanır; internete açmak için aşağıdaki üretim kurulumunu kullanın. Geliştirme sürümü aynı anda 5173 portunda çalışabilir.

Yerel Compose ayrıca [e-posta kutusunu](http://localhost:8025), [metrikleri](http://localhost:9090) ve [alarmları](http://localhost:9093) başlatır. Kayıt/doğrulama/kurtarma e-postaları bu kutuya düşer; dışarıya gönderilmez. Gerçek hesaplar e-posta doğrulamasını tamamlar, örnek alan doğrudan açılır. Günlük doğrulanmış yedekler ayrı volume'da tutulur. Hesap akışlarının ayrıntıları: [hesap güvenliği](docs/ACCOUNT_SECURITY.md).

Depoda çok aşamalı Dockerfile, sağlık denetimi, kalıcı veri volume'u, Caddy HTTPS ters vekili ve CI iş akışı bulunur.

1. `.env.example` dosyasını `.env` olarak kopyalayın.
2. Alan adını, TURN, SMTP ve e-posta şifreleme anahtarını yapılandırın.
3. `docker compose up -d --build` çalıştırın.

Dağıtım, TURN, yedekleme ve geri yükleme adımları: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Üretim modu HTTPS origin ister; TURN ve güvenli SMTP de varsayılan olarak zorunludur. Coolify ilk kurulum modu bunları açıkça erteler; e-posta doğrulamasını atlamaz. Yerelde `localhost` üzerinden kamera/mikrofon kullanılabilir. Fiziksel cihaz izni tarayıcıdan verilir. Telefon tarayıcılarında ekran yakalama desteği değişebilir.

## Yapı

```text
src/                 React + TypeScript arayüz
src/lib/useCall.ts    WebRTC medya ve bağlantı yaşam döngüsü
server/app.ts        HTTP API, kimlik doğrulama ve Socket.IO
server/db.ts         SQLite şeması ve veri erişimi
server/calls.ts      Oda izinleri, signaling, geçici TURN kimlikleri
shared/types.ts      İstemci/sunucu veri sözleşmesi
tests/               Entegrasyon, güvenlik, tarayıcı ve medya testleri
server/mail.ts       Şifreli kalıcı e-posta kuyruğu
server/observability.ts Özel metrikler ve tutarlı anlık yedek
scripts/             Zamanlanmış yedek, geri yükleme ve yük testi
docs/                Tasarım ve işletim belgeleri
```

React 19, Vite, Express 5, Socket.IO ve Node.js'in SQLite API'si kullanılır. Fontlar yerel sunulur. Parolalar scrypt ile türetilir; oturum belirteçlerinin yalnızca özetleri veritabanında saklanır. HTTP ve socket erişim kontrolleri her çalışma alanı/sohbet sınırında uygulanır. Mesaj metni HTML olarak çalıştırılmaz.

## Ölçek ve kapsam

Bu sürüm tek sunucu ve küçük ekip görüşmeleri içindir. SQLite yerel diskte, uygulama tek replika olarak çalışır. Büyük toplantılar için SFU ve çoklu sunucu için dağıtık koordinasyon gerekir. Kurumsal SSO bu sürümün kapsamında değildir.

Otomatik medya testleri bağımsız tarayıcılarda gerçek WebRTC paket aktarımını, sanal kamera/mikrofon ve kontrollü ekran akışıyla doğrular. Fiziksel cihazlar ve farklı ağlar için kendi canlı ortamınızda test gerekir. Ölçülmüş kapasite: [performans raporu](docs/PERFORMANCE.md). Zamanlanmış yedek, izleme ve uyarı kurulumu: [işletim rehberi](docs/OPERATIONS.md).
