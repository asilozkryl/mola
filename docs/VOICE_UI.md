# Sesli oda deneyimi

## Tasarım yönü

Mola'da sesli oda, ekip arkadaşına hızla katılmanın bir yolu. Linear yönündeki kompakt arayüzle aynı Manrope ailesi ve sola hizalanmış oda/kişi bilgileri kullanılır. Genel arayüz metinleri 12–14 px, görüşme araç çubuğundaki kısa etiketler masaüstünde 11 px ve mobilde 10 px'tir. Büyük kişi görselleri yerine ses, bağlantı ve katılım durumu öne çıkar.

| Rol            | Renk      |
| -------------- | --------- |
| Ana eylem      | `#153D36` |
| Canlı durum    | `#237459` |
| Metin          | `#20292B` |
| Yardımcı metin | `#687176` |
| Yüzey          | `#F5F7F8` |
| Ayırıcı        | `#E2E6E8` |

```text
Sesli odalar                 +
  Oda adı      kişi sayısı / katılımcılar / işlemler
    küçük avatar + ad + mikrofon durumu

Oda önizlemesi                 Görüşme
  oda durumu / kapasite         oda adı / süre / küçült
  katılımcı listesi              kompakt kişi satırları
  katıl                         mikrofon / ses / kamera / ekran / ayrıl
```

İlk taslakta kamera ve ses için aynı büyük kutuları kullanmak yerine ses odaklı düzen seçildi. Kamera veya ekran paylaşımı açıldığında gerçek görüntüye yer verilir. Konuşma vurgusu yalnız ölçülen sese bağlıdır. Düğme durumları, klavye odağı ve 320 px'de erişilebilirlik dekorasyondan önce gelir.

## Ele alınan bulgular

- Sesli odaların yanına oda türü seçili açılan oluşturma kısayolu eklendi; mevcut yönetim yetkileri ve sağ tık işlemleri korunur.
- Oda önizlemesi boş/dolu, bağlantı, gizlilik, altı kişilik kapasite ve aktif görüşme durumunu gösterir. Bağlantı yokken eski katılımcı listesi güncelmiş gibi sunulmaz. Başarısız katılım odanın etkin görünmesine neden olmaz.
- Başka odaya geçişte mevcut görüşmenin biteceği açıklanır. **Burada kal** görüşmeyi korur; **Ayrıl ve devam et** cihazları kapatıp yeni odanın hazırlığını açar. Yeni görüşmeye ayrıca katılınır.
- Sesli katılımcılar 48 px (mobilde 40 px) profil fotoğrafları ve okunabilir mikrofon/bağlantı durumlarıyla gösterilir. Üzerine gelince profil kartı açılır; profile gitmek görüşmeyi küçültür, sesi kesmez.
- Mikrofon, kamera ve hoparlör durumları metinle de gösterilir. Küçültülen çubukta hoparlör kontrolü, kamera durumu, paylaşımı bitirme ve dikkat gerektiren hata bildirimi bulunur.
- Hazırlık ekranı cihaz erişimi istemeden açılır. **Ses ayarları** isteğe bağlıdır; mikrofon testinin iptali, izin hatası ve yeniden deneme durumları açıklanır. Sessiz katılımın yine mikrofon izni istediği belirtilir.
- Bekleyen kamera/ekran/mikrofon işlemi sırasında ayrılmak sonraki görüşmeyi kilitlemez. Eski izin penceresinin geç yanıtı yeni görüşmenin cihaz işlemini etkilemez. Mikrofon değiştirilirken sessize alma korunur; kopan mikrofonun yerine çalışan cihaz seçildiğinde ilgili hata temizlenir.
- Escape önce profil kartını, büyütülen paylaşımı veya ses ayarlarını kapatır; ardından görüşmeyi küçültür. Büyütülen paylaşımda Tab odağı görünür kontrollerde kalır, ses ayarlarını açma/kapatma ve küçültme odağı uygun kontrole taşır.

## Doğrulama

16 yeni tarayıcı senaryosu; profil ve medya sürekliliği, 320 px yerleşim, klavye odağı, oda oluşturma/geçiş, izin iptali, cihaz seçimi ve gecikmiş medya yanıtlarını kapsar. Bunlarla birlikte görüşme, altı kişilik kapasite, çalışma alanları ve erişilebilirlik regresyonlarında toplam 44 farklı tarayıcı testi geçti. Görüşme kalitesi, ses seviyesi, sesli oda görünürlüğü ve kanal silme için 19 birim/sunucu testi geçti. Son odak ve yazı boyutu düzenlemesinden sonra ilgili panel ve görüşme senaryoları tekrar çalıştırıldı.

Testler gerçek WebRTC bağlantıları ve RTP akışı kullanır; cihazlar Chromium'un sentetik kamera/mikrofonlarıdır, ekran seçicisi yerine canvas video izi verilir. Fiziksel cihazlar ve farklı ağlar bu otomasyonun kapsamı dışındadır. Bağlantı, TURN ve paylaşım davranışları için [görüşme deneyimi](./call-experience.md) belgesine bakın.
