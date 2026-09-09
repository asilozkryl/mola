# İkinci iyileştirme paketi — 9 Eylül 2026

Başlangıç: `29462b1379f7f06f2a4697d6fa8f262d0310f34f`. Kapsam: [proje planındaki](PROJECT_ROADMAP_2026-09-09.md) R03 ve R06.

## Kaydedilenler

Mesaj yer imleri kullanıcı ve çalışma alanına bağlı olarak sunucuda saklanır. Mesajın eski bir içerik kopyası tutulmaz; liste güncel mesajı ve güncel kanal erişimini kullanır. Başka cihazdaki ekleme/kaldırma açık oturumlara yansır. Liste 50 kayıtlık sayfalarla açılır; arama mesaj metni, gönderen, kanal/özel konuşma adı ve ek dosya adını kapsar. Kaynak düğmesi ilgili mesajı veya yanıt dizisini açar.

Önceki tarayıcı kayıtları yalnız kimlikleriyle, tekrarsız aktarılır. 200 kayıt kesintisi kaldırıldı. Başarısız aktarım yerel veriyi silmez. Eski hesap geneli anahtar, başka çalışma alanlarına ait kayıtları kaybetmemek için korunur; başarıyla aktarılan kimlikler alan bazında işaretlenir. Yarım kalan aktarım doğrulanana kadar kayıt değişiklikleri bekletilir; böylece kullanıcının kaldırdığı kayıt sonraki aktarımda yeniden oluşmaz. Kayıt ekleme/kaldırma sunucu yanıtına kadar bekler; hata halinde önceki işaret korunur ve yeniden deneme sunulur.

SQLite şeması **v8** olur. Yeni tablo mesaj, kullanıcı ve çalışma alanı silindiğinde ilişkili yer imlerini temizler. Kayıtlı bir mesaja sahip olmak özel kanal erişimi vermez. Liste ve kimlik uçları mevcut üyelik, misafir rolü, askı ve çalışma alanı kapsamını denetler. Sayfa imleçleri kullanıcı/alan/arama kapsamına bağlı ve imzalıdır. Kaynak mesaja giderken alınan 403/404, erişim yenilemesi bekletilse bile eski içeriği hemen görünümden kaldırır; sunucudaki yer imi silinmez. Geçici 503 hatası ise mevcut kaydı korur.

## Gezinme

Kanal/özel konuşma, Dosyalar/Sabitlenenler sekmesi, mesaj dizisi, Özel mesajlar, Aktivite ve Kaydedilenler adres çubuğunda temsil edilir. Yenileme ve tarayıcının geri/ileri düğmeleri bu ekranları geri açar. Kaydedilenler içinden yanıt açıldığında liste yerinde kalır; açık dizi `view=saved&thread=<mesaj>` adresiyle yenilenebilir. İlgisiz bir kanalın silinmesi erişilebilir diziyi kapatmaz. Profil dönüşü konuşma taslağını ve kaydırmasını korur. Var olan profil, mesaj, davet ve hesap kurtarma bağlantıları desteklenir.

Adres örnekleri:

- `?workspace=<alan>&channel=<kanal>`
- `?workspace=<alan>&channel=<kanal>&tab=files`
- `?workspace=<alan>&channel=<kanal>&thread=<mesaj>`
- `?workspace=<alan>&view=messages`, `view=inbox`, `view=saved`
- Mevcut `?workspace=<alan>&profile=<kişi>` ve `?workspace=<alan>&message=<mesaj>`

Erişimi kapanan veya silinen kanal bağlantısı açık bir açıklamayla erişilebilir kanala döner. Geç gelen mesaj yanıtı daha yeni gezinmeyi değiştirmez. Çalışma alanı değişimi açık görüşmeden ayrılma onayını korur; aynı oturumdaki harici alan geçişi eski adrese geri sıçramaz.

## Doğrulama

- Üretim derlemesi ve TypeScript kontrolü geçti; yeni bağımlılık eklenmedi.
- Birim/API paketi: **198/198** başarılı. Yeni testler 250 kayıt, cihaz/hesap/alan ayrımı, cursor ve arama, güncel özel/misafir erişimi, silme zincirleri ve v8 veri geçişini kapsar.
- Yerel aktarımın 6 testi; 751 kaydın sırası, tekrarlanan/kısmi aktarım, başka alanın kayıtları ve doğrulama hatasını kapsar.
- İlk tam tarayıcı koşusu: **195 senaryo, 189 başarılı, 6 başarısız**. İki eski ekran beklentisi yeni tasarıma göre düzeltildi; üç API kurulumunun eski alan URL’sini yeniden açması yerine hedef alanı açıkça seçmesi sağlandı. Giriş sonrası davet penceresini kapatan gerçek gezinme hatası düzeltildi.
- Son değişiklikler; önceki altı başarısız senaryo, yeni erişim ve görüşme sırasında iptal kontrolleri dahil **43/43 odaklı tarayıcı senaryosunda geçti**. Nihai ana tarayıcı envanteri 198 senaryodur; ilk tam koşudan sonra etkilenen akışlar bu ortak koşuda tekrar doğrulandı.
- Ayrı hesap kurtarma ve genel yönetim paketleri: **3/3 + 3/3** başarılı.
- 1280×720 yerel görünümde boş ve dolu Kaydedilenler incelendi; yinelenen başlık kaldırıldı. 320 px dokunmatik testinde arama, yükleme hatası, yeniden deneme ve yatay taşma kontrol edildi.

Tarayıcı testleri gerçek API ve ayrı geçici veri kullanır; gecikme ve hata durumları kontrollü isteklerle üretilir. Güncel GitHub doğrulaması [Validate Mola](https://github.com/asilozkryl/mola/actions/workflows/ci.yml) üzerinden izlenebilir. Yerel test günlükleri Git dışında `artifacts/second-package-*.log` altındadır.

Bu paket R04 dosya/pin sayfalamasını, R07 güvenli tekrar gönderimi veya R08 ekli taslakları içermez. Bu tur canlı ortamda manuel kabul testi yapılmadı.
