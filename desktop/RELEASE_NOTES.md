Mola masaüstü istemcisi mevcut Mola sunucunuza bağlanır. Bilgisayarınıza ayrı bir sunucu veya veritabanı kurmaz.

## İndirme ve kurulum

- **Linux (x64):** Ubuntu/Debian için `.deb`; diğer uyumlu dağıtımlar için `.AppImage` paketini seçin. Ubuntu'da `.deb` kurulumu Mola'nın AppArmor profilini de yükler. AppImage için çalıştırma izni ve FUSE 2 uyumluluk kitaplığı gerekir.
- **Windows (x64):** `.exe` kurucusunu açın ve kurulum adımlarını izleyin.
- **macOS 13+:** Apple Silicon (M serisi) için `mac-arm64.dmg`, Intel için `mac-x64.dmg` seçin. DMG içindeki Mola'yı Uygulamalar klasörüne sürükleyin. Aynı mimarilerin ZIP sürümleri de sunulur.

İlk açılışta ekibinizin Mola sunucu adresini (`https://…`) girin ve mevcut hesabınızla giriş yapın. Sunucu adresi bu bilgisayarda saklanır; tarayıcı oturumu otomatik aktarılmaz.

Bu sürümde Windows ve macOS paketleri **imzasızdır**; macOS paketleri noter onaylı değildir. İşletim sisteminin yayıncı doğrulaması SmartScreen/Gatekeeper uyarısı gösterebilir veya açılışı engelleyebilir. Bu paketler imzalı dağıtım olarak sunulmaz.

`SHA256SUMS` dosyası bütün yedi kurulum dosyasının SHA-256 özetlerini içerir. Yerleşik otomatik güncelleme bulunmaz; masaüstü kabuğunun yeni sürümleri tekrar kurulur. Sunucudaki arayüz güncellemeleri uygulamaya doğrudan yansır.
