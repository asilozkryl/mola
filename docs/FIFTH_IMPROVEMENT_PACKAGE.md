# Beşinci geliştirme paketi

9 Eylül 2026. Yol haritası R09 (kişisel bildirim tercihleri), R10 (gerçek push teşhisi) ve R17 (ortak ofis bağlantısında istek kapasitesi).

## Kapsam ve tasarım

Mola'nın Manrope yazı karakteri ve kompakt, sola hizalı ayar düzeni devam eder. Ana metin/eylem `#153d36`, odak `#237459`, seçim `#eaf4ef`, zemin `#ffffff`, ayırıcı `#e2e6e8`, ikincil metin `#687176`. Başlıklar 16–20px, gövde 13–14px; dokunma hedefleri en az 44px. Büyük tanıtım kartları yerine gerçek kararlar ve durumlar öne çıkar.

```text
Bildirimler ve uygulama                          Kapat
Çalışma alanı adı
[Varsayılan bildirimler: Bahsetmeler ve yanıtlar  v]
Geçici sessizlik   [30 dk] [1 saat] [Bugün]   [Bitir]
Sessiz saatler >   başlangıç / bitiş / saat dilimi
Kanallar          ara…
# genel                          [Varsayılanı kullan]
# tasarım                        [Yalnız bahsetmeler]
Bu cihaz          izin + abonelik durumu
[Bu cihazda aç] [Test bildirimi gönder] [Durumu yenile]
Test durumu       Kuyruk → Sağlayıcı kabulü / Hata
```

Plan incelemesi: Varsayılan SaaS kart dizisi ayarları gereksiz uzatır. Mola'da aynı çalışma alanındaki çok sayıda kanalın hızlı düzenlenmesi öncelikli; arama ve hizalı satırlar kullanılır. Sessiz saatler ayrıntıları isteğe bağlı açılır. Kanalın sağ tık menüsünden tek konuşmanın bildirim tercihlerine doğrudan erişilir. Dar ekranda kontrol sırası korunur, satırlar alt alta geçer.

## Davranış sözleşmesi

- Varsayılan tercih mevcut kişisel bildirim davranışını korur: bahsetme, kanal çağrısı, katılınan konu yanıtı ve özel mesaj. Kanalın `all`, `mentions`, `off` seçimi çalışma alanı varsayılanını geçersiz kılar; `inherit` geri döner.
- Tercihler kullanıcıya ve çalışma alanına özeldir. Geçici sessizlik ve IANA saat dilimindeki sessiz saatler yeni uygulama içi uyarıları ve push bildirimlerini durdurur. Okunmamış mesaj sayıları ile Aktivite geçmişi korunur. Üst çubuktaki cihaz içi sessize alma ayrıca yalnız o tarayıcıdaki uyarıyı durdurur.
- Mesaj oluşturma işlemi server tarafında tercihi değerlendirip kişisel `notifications:attention` olayı yollar. Normal kanal mesajlarının tamamını bildirim kuyruğuna alabilmek Aktivite'yi normal mesajlarla doldurmaz. Push işçisi gönderim öncesi erişim, oturum, izin ve tercihleri yeniden kontrol eder; sessizlikte bekleyen mesajlar sonradan topluca gönderilmez.
- Gerçek test yalnız açık düğme eylemiyle mevcut kullanıcının mevcut oturumuna bağlı bu cihaza gönderilir. Genel push izni gereklidir. Test, açık teşhis isteği olduğu için sessiz saatleri aşar. Kuyruğa alınma ve sağlayıcı kabulü ayrı gösterilir; kabul, işletim sisteminin bildirimi gösterdiği kanıtı değildir.
- Teşhis sonuçları içerik, endpoint, anahtar veya sağlayıcının ham yanıtını dışarı vermez. Geçici hatalar sınırlı yeniden denemeye girer; geçersiz abonelik kaldırılır. Tekrarlanan testlere cihaz başına sınır ve terminal kayıtlara saklama süresi uygulanır.
- Kimliği doğrulanmış API istekleri güvenilir oturumdan kullanıcı başına 300/dakika sayılır. Anonim IP kotası 300/dakika ve giriş kotası 20/15 dakika korunur. Ağın toplam kotası 6000/dakikadır; istemci kimlik başlıkları kota kimliği olamaz.

## Şema ve işletim

Bildirim politikaları ve gerçek push teşhisi şema v10 ile eklenir. Eski kuyruk kayıtları işlemsel taşınır; bir kuyruk kaydı tam bir kaynak taşır (kişisel bildirim, normal mesaj veya teşhis). Dağıtımdan önce veritabanı, yüklemeler ve anahtarların tutarlı yedeği alınmalıdır. Geri dönüş, önceki uygulama sürümü ve onunla eşleşen v9 yedeğini birlikte geri yüklemelidir; yalnız imajı düşürmek v10 veritabanını geri çevirmez.

## Doğrulama

- `npm test`: **248/248** geçti. Yeni 12 politika/teşhis/migration testi; kullanıcı başına kota, ortak IP ve sahte kimlik/proxy senaryoları; mevcut erişim, hesap, dosya ve mesaj regresyonları dahil.
- Ayrı auth ve admin tarayıcı paketleri **3/3 + 3/3** geçti.
- Tam tarayıcı koşusu **221/221** geçti (9,3 dakika); altı katılımcılı gerçek RTP medya alışverişi ve bağlantı kesintisinden dönüş dahil. Son incelemede kanal ayarı penceresinin çalışma alanı değişip geri dönüldüğünde yeniden açılması ayrıca üretildi. Hesap/alan değişiminde pencere durumu sıfırlandı; bu düzeltmeden sonra yeni regresyon, dört bildirim politikası ve üç çalışma alanı yaşam döngüsü senaryosu birlikte **8/8** geçti. Son kaynak için 222/222 tek tam koşu alındığı iddia edilmez.
- Yeni tercihler için dört tarayıcı senaryosu doğrulandı: canlı uyarı kararı, susturmada Aktivite ve rozetlerin korunması, ayrı hesap/cihaz eşitlemesi, geçici yükleme hatasından dönüş, 320px klavye ve erişilebilirlik. İlk koşulardaki başlangıç socket olayı, select etiket çözümlemesi ve açık mobil menü varsayımları gerçek uygulama sözleşmesine göre düzeltildi; politika ve veri beklentileri korunur.
- Mevcut bildirim/PWA/abonelik akışları **16/16** geçti. Yeni gerçek test isteği kullanıcı eylemiyle başlar, sunucu hatasından sonra yeniden denenir, kuyruk ile sağlayıcı kabulü ayrılır ve pencere kapanınca sorgulama durur. Son ek 320px teşhis kontrolü ve mobil/masaüstü ciddi-kritik AXE kontrolü de geçti.
- Ortak ofis ölçümü: **30 gerçek oturum, tek IP, 120 saniye, 3.300 HTTP isteği, 1.500 mesaj**. HTTP/429 hatası yok; **45.000/45.000** Socket.IO teslimi, tekrarsız ve kayıpsız. Yeniden açmada 1.500 mesaj ve SQLite bütünlüğü doğrulandı. Yazma/liste/arama p95 **67,12 / 74,29 / 114,45 ms**, tepe sunucu RSS **143,88 MiB**. Bu yerel ölçüm dış ağ gecikmesi veya daha büyük ekip kapasitesi iddiası değildir. Ayrıntı: [PERFORMANCE.md](PERFORMANCE.md), `artifacts/load-office-30.json`.
- Son üretim build'i başarılı. Ana JS **715,22 KB / gzip 206,68 KB**, CSS **274,13 KB / gzip 63,76 KB**. PDF modülü ve worker ayrı yüklenmeye devam eder. Mevcut 500KB ana parça uyarısı sürer; bu paket başlangıç performansı iyileştirmesi iddiası taşımaz.

Tam koşuda Vite'ın zorlanan bağlantı kesintileri sırasında `ECONNABORTED` kayıtları ve önceki dördüncü paketin günlüğünde de bulunan bir `ResizeObserver loop` uyarısı görüldü. Senaryolar geçti; bütün tarayıcı konsolunun hatasız olduğu iddia edilmez.

Gerçek harici push sağlayıcısı/işletim sistemi gösterimi yerel otomasyonla kanıtlanmış sayılmaz; testlerde kontrollü transport kullanılır. Kişisel veriler veya fiziksel cihaz bildirim izinleri canlı ortamda değiştirilmedi.

Günlükler ve ekran görüntüleri Git dışında `artifacts/fifth-package-*` altında tutulur. Yerel önizleme geliştirme sırasında ara v10 şemasını açtığı için eksik son teşhis sütunları, önce tutarlı SQLite kopyası alınıp yalnız o yerel veritabanında işlemsel olarak tamamlandı. Yayınlanan geçiş v9'dan eksiksiz v10'a tek işlemdir; eski mesajlar veya ayarlar silinmedi.
