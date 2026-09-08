# Özel mesajlar ve Aktivite

## Tasarım planı

Kenar çubuğundaki kişisel gezinmeye **Özel mesajlar** ve **Aktivite** eklenir. Mevcut Gelen kutusu, Aktivite adı ve daha kapsamlı filtrelerle devam eder. Kısa DM listesi hızlı erişim için kalır; özel mesajlar merkezi tüm erişilebilir bire bir konuşmaları gösterir. Kapsam her zaman seçili çalışma alanıdır.

| Token    | Değer     | Rol                    |
| -------- | --------- | ---------------------- |
| Orman    | `#153d36` | Başlık, ana eylem      |
| Yeşil    | `#237459` | Seçim, okunmamış durum |
| Mürekkep | `#293730` | Ana metin              |
| İkincil  | `#62716c` | Özet ve zaman          |
| Zemin    | `#f4f7f6` | Filtre ve hover        |
| Çizgi    | `#e2e8e5` | Satır ve bölüm sınırı  |

Manrope korunur. Sayfa başlığı mevcut uygulama başlığında; içerikte başlığı tekrarlayan hero veya büyük kartlar kullanılmaz. Sol hizalı kompakt liste, 36 px profil görseli, ad/özet hiyerarşisi ve sağda zaman/okunmamış sayısı konuşmaların hızlı taranmasını sağlar. Mobilde araçlar alt satıra geçer; mesaj özeti satır içinde kısalır.

```text
Kişisel alan       Özel mesajlar
Özel mesajlar  3   [Konuşmalarda ara…]          [+ Yeni mesaj]
Aktivite       5   [Tümü] [Okunmamış]
Kaydedilenler     (AD) Ayşe Demir                    12:42  2
                      Son mesaj veya Taslak
                  (MY) Mert Yılmaz                    Dün
                      Son mesaj
                  [Daha fazla yükle]

                  Aktivite
                  [Aktivitede ara…] [Bildirim ayarları]
                  [Tümü] [Okunmamış] [Bildirim türü]
                  Bugün                 [Tümünü okundu işaretle]
                  • Ayşe senden bahsetti               12:42
                    #tasarım — Mesaj özeti              [✓]
```

## Davranış

- Özel mesajlar: açılmış tüm erişilebilir DM'ler, en son etkinlik önce; kişi/mesaj araması, okunmamış filtresi, taslak işareti, gerçek çevrimiçi durum ve yeni kişiyle konuşma. Satır mevcut sohbeti açar; taslaklar korunur.
- Aktivite: bahsetme, yanıt, kanal çağrısı ve DM bildirimleri; tür ve okunmamış filtreleri, arama, gün grupları, tekli/toplu okundu eylemi. Bildirime basınca ilgili mesaj veya yanıt açılır.
- Rozetler farklı anlam taşır: özel mesajlarda okunmamış DM mesajları, Aktivite'de okunmamış kişisel bildirimler. Tarayıcı bildirim izni, uygulama içi Aktivite'yi kapatmaz.
- Aktivite'deki **Tümünü okundu işaretle** yalnız bildirimleri okundu yapar. Açılmamış DM ve kanal mesajlarının okunmamış sayısı korunur.
- Sunucu sayfalaması eski konuşma veya bildirimi ilk 50/100 kaydın arkasında gizlemez. Yetki, kanal erişimi, hesap ve çalışma alanı her istekte denetlenir.
- Arama, workspace veya hesap değişiminden sonra geç gelen yanıtlar eski içeriği göstermez. Ağ hatası açıklama ve yeniden deneme sunar; boş arama ile hiç konuşma olmaması farklı anlatılır.

Plan mevcut ürünün liste ağırlıklı çalışma düzeniyle karşılaştırıldı: yeni dekoratif dashboard yerine aynı sohbet dilini kullanan iki odaklı alan seçildi. Büyük görseller yerine okunabilir satırlar ve gerçek duruma karşılık veren etkileşimler kullanılır.

## Kabul kontrolleri

DM başlatma, gönderme, gelen mesaj/rozet ve sıralama; arama ve eski kayıtları yükleme; bildirim filtreleme, tekli/toplu okundu ve ilgili yanıta geçiş; yenileme ve workspace değişimi; erişimi kaldırılmış özel içerik; hatada yeniden deneme; mobil taşma, klavye ve kontrast.

## Kişisel kanal bölümleri

Kullanıcı tercihiyle bölüm yapısı kişiseldir. Kanallar bölümünden adlandırılmış yeni bölümler eklenir; bir yazılı kanal tek bir kişisel bölümde bulunur. Bir bölüme yerleştirilmemiş kanallar varsayılan Kanallar listesinde kalır. Favoriler ve Sesli odalar mevcut işlevlerini korur. Bölüm sırası, adları ve kapalı/açık durumları kullanıcı ve çalışma alanına göre saklanır.

Kanal satırının kendisi sürüklenir; soldaki küçük tutamaç zorunlu değildir. Sürükleme bitince sohbet yanlışlıkla açılmaz. Satır sırası veya hedef bölüm, bırakma çizgisiyle belirtilir; boş veya kapalı bölüme bırakmak mümkündür. Klavye ve mobil kullanıcılar kanal menüsündeki **Bölüme taşı** penceresini kullanır. Bölüm kaldırma kanalları silmez; onları Kanallar listesine döndürür. Değişiklikten sonra geri alma sunulur.

Tercihler mevcut JSON modeline eklenir; yeni veritabanı göçü gerektirmez. Eski istemci yeni bölüm alanını göndermezse sunucu mevcut bölümleri korur. Erişimi kapanan/arşivlenen kanallar kişisel listeden temizlenir, boş bölüm korunur.

## Uygulama ve doğrulama — 9 Eylül 2026

- İki merkez, kişisel bölümler, satırdan sürükleme, bölüm menüleri ve geri alma tamamlandı.
- `npm test`: 169 API/birim testi geçti. Sayfalama, hesap/çalışma alanı/kanal erişimi, kişisel tercihler ve bildirim okundu işleminin konuşma okunmamış sayısını koruması kapsanıyor.
- Hedefli Playwright koşularında 51 farklı tarayıcı senaryosu doğrulandı. Yeni merkezlerin arama, sayfalama ve gecikmiş yanıt izolasyonu; kişisel bölüm oluşturma, taşıma, kalıcılık, geri alma ve kanal geçmişini koruma; 320 px dokunmatik kullanım, klavye odağı ve erişilebilirlik denetlendi.
- `npm run build` başarılı. Masaüstü ve mobil ekran görüntüleri üzerinden liste yoğunluğu, kontrast ve taşma kontrol edildi.
