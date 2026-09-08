# Mola: daha dinamik çalışma alanı

## Tasarım kararı

Kullanıcının seçtiği yön: Linear gibi keskin, modern ve hızlı hissettiren bir arayüz. Mola, gün boyu kullanılan Türkçe ekip sohbeti; öncelik yeni mesajı fark etmek ve konuşmaya hızla devam etmek. Büyük görseller veya sürekli hareket yerine net seçimler ve yapılan işe karşılık veren kısa geri bildirimler.

| Renk rolü | Değer |
| --- | --- |
| Marka ve ana eylem | `#153D36` |
| Etkin durum | `#237459` |
| Etkin yüzey | `#EAF4EF` |
| Ana metin | `#20292B` |
| İkincil metin | `#687176` |
| Gezinti yüzeyi | `#F5F7F8` |

Manrope korunuyor: mesajlar 14 px, gezinti 13 px, kanal başlığı 17 px. Metinler sola hizalı, sohbet en fazla yaklaşık 78 karakter genişliğinde. Yüzey sınırları `#E2E6E8`; küçük kontroller 5–7 px köşe yarıçapına sahip.

```text
alanlar | ekip + kanallar | arama / profil
        |                | kanal adı       üyeler / görüşme
        | seçili kanal   | sohbet / dosyalar / sabitlenenler
        |                | mesaj geçmişi
        | gerçek durum   | yeni mesajlar / yazıyor / mesaj yaz
```

İlk taslakta her paneli ayrı bir kart olarak yükseltmek yerine, konuşmayı tek kesintisiz yüzey olarak bıraktık. Ayırt edici öğe, ince yeşil seçim işareti ve gerçek olaylara bağlı kısa geri bildirimler. Animasyonlar geçmiş yüklenince tekrar oynamaz; azaltılmış hareket tercihi hem CSS'te hem programlı kaydırmada uygulanır. Çevrimdışıyken eski çevrimiçi sayıları canlıymış gibi gösterilmez.

## Uygulanan davranışlar

- Masaüstünde üst gezinme, kanal başlığı ve sekmeler toplam 160 px yerine 139 px. Mobilde kontrol hedefleri korunarak 153 px. Önceki sohbetin başlangıcı kısa bir satıra dönüştü; boş kanalda ilk mesaj yönlendirmesi devam ediyor.
- Seçili kanalın ince yeşil işareti, okunmamış kanalların belirgin yazısı, nötr gezinti yüzeyleri ve daha keskin kontroller.
- API gönderimi onayladığında 1,6 saniyelik “Gönderildi” geri bildirimi. Düğmenin genişliği değişmiyor; yeni taslağa başlanınca normal gönderme durumuna dönüyor. Başarısız mesaj onaylanmış gibi görünmüyor.
- Yalnız yeni gelen/gönderilen mesajlarda 900 ms renk vurgusu, gerçek tepki değişiminde 260 ms geri bildirim. Menü, pencere ve mesaj dizisi açılışında kısa solma. Hareket azaltma tercihi animasyonları kapatıyor.
- Eski mesajları okurken gelen yeni kök mesajlar sayılıyor; konum korunuyor. “Son mesajlara git” ile aşağıya dönülünce sayaç temizleniyor. Kanal değiştirmek ve sayılan mesajın silinmesi de sayacı güncelliyor.
- Çevrimiçi üyeler başlıkta öncelikli; kişi kapsamı özel kanal ve direkt mesaj üyeliğine uyuyor. Bağlantı kopunca canlı noktalar ve yazıyor göstergesi kapanıyor, durumun güncellenemediği belirtiliyor.
- Geciken gönderim cevabı ve programlı kaydırma, çağrıldıkları hesap/çalışma alanı/kanal bağlamından çıkınca yeni ekranı etkilemiyor.

## Doğrulama

55 farklı tarayıcı senaryosu geçti: 35 mevcut gezinme, kanal yönetimi, mesajlaşma ve erişilebilirlik senaryosu; 9 gönderim/taslak; 8 mesaj/sağ tık; 3 gerçek zamanlı çalışma alanı senaryosu. Son bağlam kontrolü değişikliklerinden sonra ilgili 10 senaryo tekrar başarılı olarak çalıştırıldı. TypeScript, Prettier ve üretim derlemesi başarılı.

320, 390, 768, 1024 ve 1440 px genişliklerinde yatay sayfa taşması yok; WCAG A/AA axe kontrolleri temiz. Masaüstü, mobil gezinme, 320 px dokunmatik sohbet ve formlar görsel olarak incelendi. Ekran görüntüleri yerel `artifacts/dynamic-final-1440.png`, `artifacts/dynamic-final-390.png`, `artifacts/dynamic-final-320.png` dosyalarında.

Bu tur etkileşim ve görsel hiyerarşiyi geliştirir; ağ veya sunucu hızlanması iddiası içermez. Yeni animasyon kütüphanesi eklenmedi. Ana JavaScript dosyası yaklaşık 526 kB (gzip 155 kB); mevcut Vite 500 kB paket boyutu uyarısı devam ediyor. Seyrek kullanılan ekranları ayrı yüklemek sonraki performans işi olarak kayıtlı.
