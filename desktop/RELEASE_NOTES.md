Mola masaüstü istemcisi mevcut Mola sunucunuza bağlanır. Bilgisayarınıza ayrı bir sunucu veya veritabanı kurmaz.

## İndirme ve kurulum

- **Linux (x64):** Ubuntu/Debian için `.deb`; diğer uyumlu dağıtımlar için `.AppImage` paketini seçin. Ubuntu'da `.deb` kurulumu Mola'nın AppArmor profilini de yükler. AppImage için çalıştırma izni ve FUSE 2 uyumluluk kitaplığı gerekir.
- **Windows (x64):** `.exe` kurucusunu açın ve kurulum adımlarını izleyin.
- **macOS 13+:** Apple Silicon (M serisi) için `mac-arm64.dmg`, Intel için `mac-x64.dmg` seçin. DMG içindeki Mola'yı Uygulamalar klasörüne sürükleyin. Aynı mimarilerin ZIP sürümleri de sunulur.

İlk açılışta ekibinizin Mola sunucu adresini (`https://…`) girin ve mevcut hesabınızla giriş yapın. Sunucu adresi bu bilgisayarda saklanır; tarayıcı oturumu otomatik aktarılmaz.

## 1.0.5 bildirimler ve Mola sesi

- Masaüstünde bildirim açılmasını engelleyen tarayıcı Push aboneliği kaldırıldı; yerel sistem bildirimleri kullanılır.
- İlk izin ve reddettikten sonra yeniden deneme düzeltildi. Sunucuya özel bildirim izni uygulama yeniden açıldığında korunur.
- Özgün Mola sesi, ses önizlemesi ve bu bilgisayardaki hesaba özel sessize alma seçeneği eklendi.
- Kanal ve sessiz saat tercihleri korunur. Pencere arka plandayken gelen mesajlar bildirim oluşturabilir; bildirime tıklamak uygulamayı öne getirip ilgili mesaja gider.

Kurulumdan sonra **Bildirimler ve uygulama → Bu cihazda bildirimleri aç** seçeneğini kullanın. Bildirimler için pencere açık veya küçültülmüş olmalı; uygulamadan çıkınca bildirim gelmez. Sistem bildirim izni ve Odak / Rahatsız Etme tercihleri geçerlidir.

## macOS paket bütünlüğü

macOS uygulama paketi artık Mola kimliğiyle ad-hoc imzalanır ve kaynak bütünlüğü mühürlenir. Önceki sürümde bu adım atlanıyordu. Her iki Mac mimarisinde ZIP ve DMG içindeki gerçek uygulamanın imzası, mimarisi ve ilk açılışı yayımlanmadan önce kontrol edilir. Önceki Mola uygulamasını Uygulamalar klasöründe yenisiyle değiştirin; kullanıcı profilinizi silmeniz gerekmez.

Windows paketi yayıncı sertifikasıyla imzalanmamıştır. macOS'taki ad-hoc imza **Developer ID veya Apple noter onayı değildir**. SmartScreen/Gatekeeper uyarısı veya ilk açılış engeli devam edebilir. Kaynağına güvendiğiniz Mola'yı açmayı denedikten sonra macOS'ta **Sistem Ayarları → Gizlilik ve Güvenlik → Yine de Aç** seçeneğini kullanabilirsiniz. “Hasarlı / damaged” uyarısı sürerse [Mola kurulum rehberindeki bütünlük kontrolünü](https://github.com/asilozkryl/mola/blob/codex/initial-release/docs/DESKTOP.md#macosta-hasarlı--damaged-uyarısı) uygulayın.

`SHA256SUMS` dosyası bütün yedi kurulum dosyasının SHA-256 özetlerini içerir. Yerleşik otomatik güncelleme bulunmaz; masaüstü kabuğunun yeni sürümleri tekrar kurulur. Sunucudaki arayüz güncellemeleri uygulamaya doğrudan yansır.
