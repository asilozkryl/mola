# Mola masaüstü

Masaüstü istemcisi Linux, macOS ve Windows üzerinde mevcut Mola sunucunuza bağlanır. Mesajlar, üyelikler, dosyalar ve görüşmeler aynı sunucuyu kullanır. Masaüstü paketine Express sunucusu, SQLite veritabanı veya sunucu sırları dahil edilmez. Kullanıcıların uygulamayı açmak için Node.js kurması gerekmez.

## İlk açılış

1. İşletim sisteminize uygun paketi kurun ve Mola'yı açın.
2. Ekip sunucunuzun kök HTTPS adresini girin ve bağlanın; sayfa yolu veya davet bağlantısı eklemeyin.
3. Mevcut hesabınızla giriş yapın. Tarayıcıdaki oturumunuz masaüstüne otomatik aktarılmaz.

Sunucu adresi bu bilgisayarda saklanır. Sonradan uygulama menüsündeki **Mola → Sunucu adresini değiştir…** seçeneğiyle değiştirilebilir. Oturum verileri Electron'un kullanıcı profili dizininde tutulur. Sunucuya erişilemiyorsa bağlantı ekranından yeniden deneyebilir veya adresi değiştirebilirsiniz.

## Uygulama içinden indirme

Sunucunuzdaki `/download` sayfası oturum açmadan kullanılabilir. Giriş ekranındaki **Masaüstü uygulamasını indir** bağlantısından veya Mola'nın yardım bölümünden açılır. Sayfa Windows, macOS ve Linux'u algılar; diğer işletim sistemlerinin paketleri de elle seçilebilir. macOS tarayıcıları Apple Silicon cihazlarda bile Intel bilgisi verebildiği için işlemci seçimi kullanıcıya bırakılır. Android, iPhone ve iPad bilgisayar olarak önerilmez; sayfa bu cihazlarda masaüstü paketlerinin bilgisayarlar için olduğunu açıklar.

Kurulum bağlantıları `GET /api/desktop/releases` üzerinden GitHub'daki gerçek, yayımlanmış `desktop-vMAJOR.MINOR.PATCH` sürümlerinden alınır. Katalog yalnızca bu deponun doğru sürümüne ait yedi kurulum dosyası ve `SHA256SUMS` eksiksiz bulunduğunda bağlantı gösterir. Taslaklar, ön sürümler, Actions artifacts ve yalnızca Git etiketleri indirme olarak sunulmaz. Henüz sürüm yayımlanmadıysa sayfa bunu belirtir; tahmini bir indirme adresi üretmez. GitHub'ın genel `/releases/latest` adresi masaüstü sürümünün kaynağı değildir.

Katalog başarılı yanıtları on dakika, boş veya geçici hata yanıtlarını bir dakika sunucuda önbelleğe alır ve eşzamanlı ziyaretçilerin isteklerini birleştirir. Geçici GitHub kesintisinde en fazla 24 saat önce doğrulanmış bağlantılar açıklama eşliğinde gösterilebilir; silinmiş bir sürüm başarılı bir sorguda görüldükten sonra yeniden sunulmaz. İlk sürümün yayımlanmasından sonra bağlantıların görünmesi boş katalog önbelleği nedeniyle yaklaşık bir dakika sürebilir. GitHub erişimi için sunucuya kişisel erişim anahtarı koymak gerekmez.

İndirme sayfasındaki **Sunucu adresini kopyala** düğmesi, sayfanın açıldığı Mola sunucusunun kök adresini kopyalar. Kullanıcı indirilen dosyayı işletim sisteminin normal kurulum akışıyla açar, ardından bu adresi Mola'ya girer. Tarayıcıdan sessiz kurulum veya işletim sistemi izinlerini atlama uygulanmaz.

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

Mac'te imzalama sertifikası olmayan yerel denemeler için uygulama paketini ad-hoc imzayla mühürleyin. Bu imza Apple yayıncı doğrulaması değildir. Bu yerel derlemede, farklı kimlikli Electron kitaplıklarının yüklenebilmesi için hardened runtime kapatılır:

```sh
npm run desktop:mac -- -c.mac.identity=- -c.mac.hardenedRuntime=false
```

Ubuntu 24.04 ve üzeri için `.deb` paketini paket yöneticisiyle kurun. Paketin bulunduğu dizinde, dosya adını indirdiğiniz sürüme göre değiştirerek:

```sh
sudo apt install ./Mola-1.0.2-linux-amd64.deb
```

Kurulum uygulamayı `/opt/Mola/mola` konumuna yerleştirir ve Chromium sandbox'ının kullanıcı namespace erişimi için Mola'ya özel AppArmor profilini yükler. `linux-unpacked` klasörünü veya `.deb` içeriğini `~/.local/opt` gibi başka bir konuma kopyalamak bu kurulumu gerçekleştirmez; Ubuntu'da menüden açılış `chrome-sandbox` / SUID helper hatasıyla durabilir. Bu durumda `.deb` paketini yukarıdaki komutla kurun.

Daha önce elle oluşturulmuş `~/.local/share/applications/app.mola.desktop.desktop` dosyası varsa `Exec` satırını kontrol edin. `.deb` kurulumu tamamlandıktan sonra, eski kullanıcı dizinine işaret eden bu dosyayı yedeklemek için `applications` dizininin dışına taşıyın; kullanıcıya özel kısayol, paketin `/usr/share/applications` altındaki aynı adlı kısayolunun önüne geçer. Sonraki açılışı uygulama menüsünden doğrulayın.

Linux AppImage dosyası çalıştırılabilir izin ve FUSE 2 uyumluluk kitaplığı gerektirir; yalnızca FUSE 3 kurulmuş olması yeterli değildir. FUSE veya sandbox sorunu yaşarsanız Ubuntu'da `.deb` kurulumunu kullanın; AppImage içeriğini başka bir dizine çıkarmak AppArmor kurulumunun yerini tutmaz. Chromium sandbox'ını kapatan başlatma bayrakları eklemeyin.

Paket tanımı `desktop/electron-builder.yml` içindedir. Uygulama kimliği `app.mola.desktop`, görünür adı `Mola` ve sürümü `desktop/package.json` içinden gelir. Debian paketinin bakımcı adı `Mola`, proje bağlantısı mevcut GitHub deposudur; genel dağıtımdan önce bakımcı iletişim bilgilerini kendi bilgilerinizle güncelleyin.

## GitHub Actions

**Build Mola Desktop** iş akışı Actions ekranından elle başlatılabilir. `desktop-v*` etiketi gönderildiğinde de çalışır; etiket sürümü `desktop/package.json` sürümüyle eşleşmelidir (örneğin `1.0.2` için `desktop-v1.0.2`). Sürümü değiştirirken `desktop/package-lock.json` dosyasını da güncelleyin.

İş akışı önce masaüstü birim ve gerçek Electron açılış testlerini Linux'ta çalıştırır. Ayrıca web uygulamasını derleyip gerçek Mola sunucusu üzerinde Electron'dan mesaj gönderme ve kalıcılık akışını doğrular. Ardından Linux, Windows, Intel macOS ve Apple Silicon macOS paketlerini ilgili işletim sistemlerinin ayrı çalıştırıcılarında üretir. [GitHub çalıştırıcı mimarileri](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

Üretilen dosyalar ve bütünlük kontrolü için `SHA256SUMS` dosyası iş akışının **Artifacts** bölümünde 14 gün saklanır. Elle başlatılan çalıştırmalar yalnızca bu inceleme çıktılarını üretir. `desktop-v*` etiketiyle başlayan çalıştırmalarda, tüm test ve platform derlemeleri başarılı olduktan sonra ayrı yayın işi dört çalıştırıcının çıktılarını toplar. Yedi beklenen kurulum dosyasını ve her birinin SHA256 değerini doğrular; birleşik `SHA256SUMS` dosyası üretir. Dosyalar önce taslak GitHub Release'e yüklenir, ardından sürüm yayımlanır. Yayımlanmış bir sürümün üzerine yazılmaz; değişiklik için masaüstü sürümünü artırıp yeni etiket gönderin. Mağazaya gönderim yapılmaz.

İlk gerçek indirme bağlantılarının oluşması için bu iş akışının bir sürüm etiketi üzerinde başarıyla tamamlanması gerekir; kodun ana uygulamayla dağıtılması tek başına paket yayımlamaz. Release, depodaki web sürümlerinin `latest` işaretini değiştirmez. İndirme kataloğu yayımlanmış masaüstü sürümlerini ayrıca bulur.

Windows CI paketleri yayıncı sertifikasıyla imzalanmamıştır. macOS paketleri 1.0.3'ten itibaren Mola kimliğiyle ad-hoc imzalanır; uygulama ve yardımcı bileşenlerin bütünlüğü mühürlenir. Bu, Developer ID veya Apple noter onayı sağlamaz. Hardened runtime bu sertifikasız derlemelerde kapalıdır; Electron renderer sandbox'ı açık kalır.

Her Mac çalıştırıcısı, ZIP'ten çıkarılan ve DMG'den geçici kurulum dizinine kopyalanan gerçek uygulamada kaynak mührünü, `app.mola.desktop` imza kimliğini, mimariyi ve `codesign --verify --deep --strict` sonucunu kontrol eder. Paketlenmiş uygulama geçici kullanıcı profiliyle açılır; ilk sunucu seçimi ve sandbox içindeki web sayfasının çalıştığı doğrulanır. Bu kontroller geçmeden paketler yayımlanmaz. Test, Apple noter onayı veya kullanıcı Mac'indeki Gatekeeper izni yerine geçmez.

## macOS'ta hasarlı / damaged uyarısı

M serisi Mac'lerde `mac-arm64.dmg`, Intel Mac'lerde `mac-x64.dmg` kullanın. 1.0.2 paketinde uygulama imzalama adımı atlandığı için Mola kaynak mührü oluşturulmamıştı; 1.0.3 bu paketleme sorununu düzeltir. Güncel DMG içindeki Mola'yı Uygulamalar klasörüne taşıyıp eski uygulamayı değiştirin. Kullanıcı profilini silmeyin; sunucu adresi ve oturum bilgileri burada saklanır.

Henüz Developer ID ve noter onayı olmadığından macOS ilk açılışı engelleyebilir. Uygulamayı bu deponun sürüm sayfasından indirdiyseniz ve kaynağına güveniyorsanız, açmayı denedikten sonra **Sistem Ayarları → Gizlilik ve Güvenlik → Yine de Aç** seçeneğini kullanın. [Apple'ın açılış yönergeleri](https://support.apple.com/tr-tr/102445).

“Hasarlı / damaged” uyarısı devam ediyorsa indirdiğiniz dosyanın SHA-256 değerini aynı sürümün `SHA256SUMS` dosyasıyla karşılaştırın. Uygulamalar klasöründeki yeni paketin bütünlük imzasını Terminal'de doğrulayın:

```sh
codesign --verify --deep --strict --verbose=2 /Applications/Mola.app
codesign --display --verbose=4 /Applications/Mola.app
```

İlk komut hatasız tamamlanmalı; ikinci komutta `Identifier=app.mola.desktop` ve bu sertifikasız sürüm için `Signature=adhoc` görünmelidir. Doğrulama başarısızsa uygulamayı açmaya zorlamayın; resmi sürüm dosyasını yeniden indirin. Dosya özeti ve uygulama mührü doğrulandıktan sonra, yalnızca kendi güvendiğiniz Mola kopyasının indirme karantinasını kaldırmak için:

```sh
codesign --verify --deep --strict /Applications/Mola.app &&
xattr -dr com.apple.quarantine /Applications/Mola.app &&
open /Applications/Mola.app
```

Bu işlem yalnızca `/Applications/Mola.app` için geçerlidir; Apple noter onayı sağlamaz. Sistem genelinde Gatekeeper'ı kapatmayın. Açılış yine engellenirse komut çıktısını ve macOS sürümünü inceleyin; bu sırada web uygulaması kullanılabilir. Uyarısız genel dağıtım için aşağıdaki Developer ID ve noter onayı kurulumu gerekir.

## İmzalama ve dağıtım

Windows ve macOS'ta kullanıcılara genel dağıtım için kendi yayıncı sertifikalarınız gerekir. İmzasız Windows paketlerinde SmartScreen uyarıları görülebilir; macOS'ta Gatekeeper uygulamanın açılmasını engelleyebilir. CI'ın imzasız paketleri imzalı dağıtımın tamamlandığı anlamına gelmez.

macOS'ta Developer ID Application sertifikasını güvenli ortamdan `CSC_LINK` ve `CSC_KEY_PASSWORD` ile sağlayın. Noter onayı için `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` veya `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` ortam değişkenleri kullanılır. İmzalı derlemeyi macOS üzerinde varsayılan yapılandırmayla (`hardenedRuntime: true`) çalıştırın; `identity=-` / `hardenedRuntime=false` CI geçersiz kılmalarını kaldırın ve gerekli sırları yalnızca Mac paketleme işlerine bağlayın. Noter onayını ve stapled bileti ayrıca doğrulayın. [electron-builder 26 macOS imzalama](https://www.electron.build/v26/docs/features/code-signing/code-signing-mac/) ve [noter onayı seçenekleri](https://www.electron.build/v26/docs/mac/#notarize).

Windows'ta kendi kod imzalama sağlayıcınızı electron-builder'ın Windows imzalama seçenekleriyle yapılandırın. Dosya tabanlı sertifikanız varsa `CSC_LINK` ve `CSC_KEY_PASSWORD` kullanılabilir; donanım veya bulut tabanlı sertifikalar sağlayıcının entegrasyonunu gerektirir. Sertifika ve parolaları depoya eklemeyin. İmzalı CI dağıtımı için ayrıca güvenli secrets bağlantısı ve imzalı paketlerin hedef cihazlarda doğrulanması gerekir.

## Görüşmeler ve masaüstü davranışı

- Mikrofon ve kamera erişimi kullanıcı izniyle açılır; macOS ayrıca işletim sistemi izni ister. Paket mikrofon/kamera kullanım açıklamalarını içerir. İzin tercihi uygulama açık kaldığı sürece hatırlanır. Reddedilen iznin yeniden sorulması için Mola'yı tamamen kapatıp uygulamayı yeniden başlatın; işletim sistemi izni de reddedildiyse gizlilik ayarlarından düzeltin.
- Ekran paylaşımı her başlatıldığında Mola'nın izin penceresi gösterilir. İzin verdikten sonra mevcutsa işletim sisteminin kaynak seçicisi, diğer durumlarda Mola'nın ekran/pencere seçicisi açılır. macOS'ta ekran kaydı izni, Linux Wayland'de uygun masaüstü portalı gerekir. Ekran paylaşımı sistem sesini içermez.
- Görüşmeyi küçük pencereye alma mevcut web özelliğini kullanır. Destek cihaz ve Electron sürümüyle doğrulanmalıdır.
- Harici bağlantılar sistem tarayıcısında açılır. Uzak Mola sayfasının Node.js erişimi yoktur; kurulum arayüzü ayrı tutulur.
- Güncelleme kontrolü ve kullanıcı tarafından başlatılan indirme/kurulum 1.0.7 ile sunulur. Sistem tepsisi bulunmaz. Bildirimler aşağıdaki masaüstü akışını kullanır; Mola penceresi kapatıldığında veya uygulamadan çıkıldığında mesajları dinleyen bağlantı da kapanır.

## Masaüstü bildirimleri ve Mola sesi

**1.0.5 ve üzeri** masaüstü istemcisinde **Bildirimler ve uygulama → Masaüstü bildirimleri → Bu cihazda bildirimleri aç** yolunu kullanın. Mola'nın izin penceresinde onay verin; işletim sistemi ayrıca izin istiyorsa onu da onaylayın. **Test bildirimi gönder** ile teslimi kontrol edin. macOS'ta gerekirse **Sistem Ayarları → Bildirimler → Mola** bölümünü açın; Odak / Rahatsız Etme modu ve sistem ses ayarları bildirimin görünmesini veya duyulmasını etkileyebilir.

Electron'da Web Push aboneliği desteklenmediği için masaüstü, `PushManager` varlığını yeterli saymaz ve tarayıcı Push aboneliği oluşturmaya çalışmaz. Sunucunun mevcut Socket.IO `notifications:attention` olayları, yerel Web Notification API'siyle sistem bildirimine dönüşür. Çalışma alanı ve kanal modları, sessiz saatler ve uygulamanın sessize alma tercihi korunur. Ön planda okumakta olduğunuz sohbet için tekrar uyarı verilmez; pencere arka plandayken aynı sohbetten gelen mesaj da uyarı oluşturabilir. Mesaj içeriği sistem bildiriminde gösterilmez. Bildirime tıklamak ilgili mesaja gider ve uygulamayı öne getirir; açık görüşmeyi kapatan bir sayfa yenilemesi yapılmaz.

Test bildirimi mesaj filtrelerini ve sessiz modu atlar. Uygulamanın sessiz modu açıksa masaüstü ayarları **Bildirimler bu cihazda duraklatıldı** durumunu gösterir; **Bildirimleri sürdür** yalnızca bu cihazdaki sessiz modu kaldırır. Çalışma alanı ve kanal tercihleri ile sessiz saatler değişmez. Varsayılan **Bahsetmeler ve yanıtlar** modu özel mesajları, sana gelen yanıtları ve etiketlemeleri kapsar; normal kanal mesajları için **Varsayılan bildirimler → Tüm mesajlar** seçilmelidir. Mevcut masaüstü bağlantısı yalnızca açık çalışma alanının bildirimlerini dinler.

Yeni bir özel konuşma ve ilk mesajı aynı anda geldiğinde, konuşma kimliği React çizimini beklemeden bildirim dinleyicisine aktarılır. Böylece ilk mesajın bildirimi kaybolmaz; farklı hesap veya çalışma alanından kalmış olaylar yine uygulanmaz. `desktop/tests/mola.integration.mjs` bu sıralamayı ayrı hesaplardan gerçek HTTP mesajları ve gerçek Socket.IO kareleriyle doğrular; işletim sistemi bildirim gösterimi ayrı mevcut izin/teslim testiyle sınanır.

16 Eylül 2026 canlı bildirim düzeltmesi doğrulaması: 3 gerçek Electron entegrasyon testi, 5 masaüstü bildirim arayüzü senaryosu, 15 bildirim politikası/bağlam/tarayıcı ayarı senaryosu ve 22 bildirim birim testi geçti. `npm run build` başarılı. İlk DM yarışı önce hata vererek yeniden üretildi, düzeltmeden sonra aynı test geçti. Native entegrasyon Linux üzerinde çalıştırıldı; fiziksel M3/macOS bildirim merkezi bu koşuda kullanılmadı.

Bildirim izni tam sunucu adresine özel olarak `notification-permissions.json` dosyasına kaydedilir ve uygulama yeniden açıldığında korunur. Mikrofon, kamera ve ekran izinleri bu dosyaya taşınmaz. Açma/kapatma ve ses tercihi ise bu sunucudaki bu hesap ve bilgisayar için saklanır; tarayıcı bildirimleri veya diğer bilgisayarların tercihleri değiştirilmez. Reddedilen masaüstü bildirim izni Aç düğmesiyle yeniden istenebilir.

**Mola bildirim sesi** özgün, 0,74 saniyelik iki tondan oluşur. **Sesi dinle** yalnızca önizleme yapar; yanındaki kutu gelen bildirimlerin sesini kapatır. Sistem bildirim sesi ayrıca kapatılarak çift ses önlenir. Hızlı mesajlar tek uyarıda birleştirilir; okunmamış sayıları güncellenmeye devam eder. Ses susturma veya çıkış sırasında bekleyen sesler iptal edilir. Ses kaynağı ve yeniden üretim komutu [ses açıklamasında](../public/sounds/README.md) bulunur.

Pencere açık veya küçültülmüş ve sunucu bağlantısı etkin olmalıdır. Uygulamadan çıkınca, pencereyi kapatınca, bilgisayar uyurken veya çevrimdışıyken bu masaüstü akışı bildirim göndermez; arka planda APNs/FCM servisi ya da sistem tepsisi çalıştırılmaz. Testin sisteme gönderilmiş olması, işletim sisteminin onu mutlaka ekranda gösterdiği anlamına gelmez.

Sunucu güncellemeleri istemci içindeki web arayüzüne yansır. Electron veya masaüstü kabuğu güncellemeleri için aşağıdaki uygulama içi akışı kullanın. Sunucu bağlantısı olmadan ekip verileriyle çevrimdışı çalışma desteklenmez.

### Uygulama içinden güncelleme

1.0.7 ve üzeri sürümlerde **Mola → Güncellemeleri kontrol et** menüsünü veya **Bildirimler ve uygulama → Uygulama güncellemeleri** bölümünü açın. Uygulama açılıştan yaklaşık bir dakika sonra ve altı saatte bir kararlı sürümleri kontrol eder; yeni sürüm menüde görünür, sistem izin veriyorsa sessiz bir bildirim gösterilir. Kontrol ve indirme görüşmeyi kesmez. **Güncellemeyi indir** ile ilerlemeyi izleyin; indirmeyi iptal edip tekrar başlatabilirsiniz. Tamamlanan dosyalar tekrar kullanılırken de doğrulanır. İptal edilen yarım indirme baştan başlar.

**Kurulumu başlat** (Mac'te **DMG’yi aç**) ayrı bir onay ister ve kurulum penceresi açılınca Mola kapanır. Açık görüşmenizi bitirip gönderilmemiş mesajınızı kontrol edin. Kullanıcı profili ve sunucu adresi silinmez.

- **macOS:** DMG açılınca Mola'yı Uygulamalar klasörüne sürükleyip mevcut kopyayı değiştirin. Developer ID/noter onayı bulunmadığından otomatik uygulama değiştirme kullanılmaz. Gatekeeper ve indirme quarantine bilgisi korunur; gerekirse yukarıdaki macOS kurulum rehberini izleyin.
- **Windows:** NSIS kurulum penceresini tamamlayın. İndirilen dosyanın Internet-zone bilgisi korunur; yayıncı imzası durumu değişmez.
- **Debian/Ubuntu:** Sistem paket yükleyicisinde kurulumu tamamlayın. Sistem yönetici parolası isteyebilir. Paket yükleyicisi yoksa `.deb` kurulumunu işletim sisteminizin standart yöntemiyle yapın; Mola yetkili kabuk komutu çalıştırmaz.
- **Linux AppImage:** Mevcut AppImage ve klasörü yazılabilir olmalı. Dosya aynı dosya sisteminde doğrulanarak atomik değiştirilir, yeniden açılma planlanır. Önceki kopya AppImage yanındaki `.mola-update-…/previous.AppImage` dosyasında korunur; başlatma planlanamazsa eski dosya geri yüklenir. Yeniden açılıştaki bir işletim sistemi hatasında bu yedek elle kullanılabilir.

Güncelleme kaynağı, çalışma alanı sunucusundan bağımsız olarak sabit `asilozkryl/mola` GitHub deposudur. Yalnızca `desktop-vX.Y.Z` kararlı etiketleri, tam yedi kurulum dosyası ve `SHA256SUMS` kabul edilir. Yerel işletim sistemi ve mimari seçilir; daha eski sürüme geçilmez. HTTPS indirmesi boyut ve zamanla sınırlıdır, özet kurulumdan hemen önce tekrar denetlenir. Bu bütünlük kontrolü Apple/Windows yayıncı imzası yerine geçmez. İndirme önbelleği özel kullanıcı dizinindedir; mevcut ve bir önceki sürüm dışındaki eski kurucular temizlenir.

**İlk geçiş:** 1.0.5 ve öncesi için 1.0.7 kurulum dosyasını bir kez elle indirip kurun. Geliştirme ortamındaki paketlenmemiş Electron çalıştırmaları ve desteklenmeyen mimariler güncellenmez.

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
