# Bire bir sohbet — 9 Eylül 2026

## Yön

Kullanıcının paylaştığı ekran, iki kişinin konuşmasını kanal başlığı ve çok geniş mesaj satırlarıyla sunuyor. Önceki Linear tercihi korunarak kişi, konuşma ve yazma eylemi aynı görsel eksene alınır. Özel mesajlar merkezi ayrı kalır; bu çalışma tek bir DM'nin iç ekranını geliştirir.

| Token   | Değer     | Kullanım                   |
| ------- | --------- | -------------------------- |
| Beyaz   | `#ffffff` | Ana yüzey                  |
| Sis     | `#f4f7f6` | Gelen mesaj                |
| Yaprak  | `#eaf4ef` | Kendi mesajın, etkin durum |
| Orman   | `#153d36` | Başlık ve gönderme         |
| İkincil | `#586568` | Zaman ve yardımcı metin    |
| Çizgi   | `#dce5e0` | Sınırlar                   |

Manrope: başlık 17 px/700, mesaj 14 px/1.6, yardımcı metin 11–12 px. Mesajlar ve yazma alanı en fazla 960 px genişliğinde aynı ekseni paylaşır. Mesaj metni daha dar okunabilir bir ölçüde kalır. Mobilde sabit yan boşluklar azalır; dokunma hedefleri ve metin sarma korunur.

```text
(profil) Selin Kaya                           [Bir araya gel] [Bilgi]
         Çevrimiçi
[Sohbet] [Dosyalar] [Sabitlenenler]

                 Selin ile konuşmanın başlangıcı
                             Bugün
(SK) Selin 12:42
     [Son taslağı birlikte inceleyelim mi?]
                                      Sen 12:43 (AY)
                         [Olur, birazdan bakıyorum.]
                         [Önce akışı tamamlayayım.]
     ••• Selin yazıyor…
     [Selin Kaya kişisine mesaj yaz…                 ]
     [Dosya · biçim · emoji              Gönder ↗    ]
```

Konuşmanın iki tarafı hizalama ve hafif yüzey rengiyle ayrılır. Yakın zamanda art arda gelen aynı kişiye ait mesajlar sıkı gruplar oluşturur; saat ve yazar erişilebilir kalır. Kısa konuşmalar yazma alanına yakın başlar. Kişi başlığı profil önizlemesini ve profil sayfasına geçişi kullanır; DM'de iki üyeyi tekrar tekrar göstermeye gerek kalmaz.

## Brief ile kontrol

Büyük profil kartı, dekoratif gradient ve sürekli hareket elendi; kullanıcı daha küçük görseller ve hızlı bir arayüz istemişti. Görsel vurgu karşılıklı mesaj düzeninde toplanır. Hareket yalnız gerçek yazıyor, gönderiliyor/gönderildi ve yeni mesaj durumlarına yanıt verir; okundu veya son görülme bilgisi uydurulmaz. Kanal ve yanıt ekranları kendi düzenini korur.

## Kabul ölçütleri

Profil açma/geri dönme, mesaj gönderme ve taslak koruma, yanıt ve dosya/sabitlenen sekmeleri, yeni mesaj takibi, sağ tık/dokunmatik işlemler, 320 px taşma, uzun mesaj/dosya adları, klavye ve azaltılmış hareket kontrol edilir.

## Doğrulama

Uygulama tamamlandı. 29 mevcut tarayıcı senaryosu ve 3 yeni DM senaryosu geçti. Yeni senaryolar profil önizlemesini ve taslağa dönüşü, iki göndericinin hizalamasını, ardışık mesaj gruplarını, yanıt/dosya/sabitleme akışlarını ve gerçek dokunmatik 320 px görünümü kapsıyor. Çevrimiçi/çevrimdışı/yeniden bağlantı ve yazıyor durumları mevcut canlılık senaryosuyla doğrulandı. Axe kontrollerinde ciddi veya kritik bulgu yok; azaltılmış hareket tercihi korundu.

Masaüstü ve mobil ekran görüntüleri incelendi. Mobilde saat bilgisinin işlem düğmesinin odak halkasıyla çakışmaması için boşluk artırıldı ve mobil senaryo yeniden geçti. `npm run build` başarılı.
