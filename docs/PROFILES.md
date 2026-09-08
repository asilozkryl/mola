# Mola profilleri

## Tasarım

Ekip sohbetinde kişiyi tanımak ve konuşmaya devam etmek öncelikli. Mevcut Manrope yazı ailesi ve kompakt arayüz korunur: ana metin `#20292B`, ikincil metin `#687176`, yüzey `#F5F7F8`, çizgi `#E2E6E8`, ana eylem `#153D36`, etkin durum `#237459`.

Profil kartı 286 px genişliğinde, fotoğrafı 42 px; sayfa fotoğrafı masaüstünde 72 px, mobilde 60 px. Metinler sola hizalı. Büyük kapak fotoğrafı yerine kimlik, durum ve iletişim eylemleri öne çıkar. Bilgiler aynı biçimde tekrarlanan kartlar yerine ince bir ayırıcıyla ayrılır.

```text
Sohbete dön                                  Üye profili

[fotoğraf]  Ad soyad
            Unvan / çevrimiçi durumu / durum metni
Mesaj gönder veya Profili düzenle    Bağlantıyı kopyala
------------------------------------------------------
Hakkında                         | Rol, e-posta
Kısa biyografi                   | Konum, katılma tarihi
```

Mobilde bilgi sütunları alt alta geçer. Hover kartı 300 ms beklemeyle açılır, kartın içine geçince açık kalır; klavye odağı, Tab ve Escape desteklenir. Dokunmada doğrudan profil açılır. Animasyon 100 ms ve azaltılmış hareket tercihinde kapalıdır.

## Davranış

- Profil ayarlarında fotoğraf ekleme, önizleme, vazgeçme, değiştirme ve kaldırma. PNG/JPG/WebP, en fazla 5 MB. Fotoğraf kaydı ile metin kaydı bağımsızdır; fotoğraf güncellemesi kaydedilmemiş metinleri silmez.
- Ad ve durumun yanında unvan (80), biyografi (500) ve konum (80 karakter). Hatalar formda gösterilir ve tekrar denenebilir. Profil bilgileri hesabın tüm çalışma alanlarında güncellenir.
- Mesajdaki ad veya avatar, üye listesi, kanal başlığı, sesli oda katılımcıları ve direkt mesaj listesindeki avatar profil önizlemesini açar. Direkt mesaj satırındaki ad sohbeti açmaya devam eder.
- Ayrıntılı profil `/?workspace=…&profile=…` adresiyle paylaşılabilir ve yenilenebilir. Sayfa bilgileri yetkili API yanıtından sonra gösterilir; kendi profilinde düzenleme, uygun üyelerde mesaj gönderme eylemi bulunur.
- Paylaşılan profil bağlantısı giriş gerektirir. Oturum yoksa otomatik örnek çalışma alanı oluşturulmaz. Üyeliği olmayan veya etkinliği sona ermiş kişilerin profilleri açılmaz.
- Fotoğraflar 512 px sınırında WebP olarak yeniden kodlanır; kamera yönü uygulanır, metadata temizlenir, 25 megapiksel sınırı kullanılır. Eski sürümler kapatılır, değiştirilmiş/kaldırılmış dosyalar temizlenir. Resim sunumu da etkin çalışma alanı üyeliğini kontrol eder.

## Teknik notlar

Veritabanı şeması v6, kullanıcıya `job_title`, `bio`, `location`, `avatar_version` alanlarını ekler. Fotoğraflar mevcut kalıcı veri dizini altındaki `uploads/avatars` klasöründe tutulur. `sharp` üretim bağımlılığıdır; kilit dosyası Linux ikililerini içerir.

Yeni sunucu testleri profil doğrulamasını, erişimi, fotoğraf sınırlarını, eşzamanlı oturum/alan değişikliklerini, canlı güncelleme kapsamını ve dosya temizliğini kapsar. Tarayıcı testleri kaydetme/tekrar deneme, fotoğraf işlemleri, profil kartı, klavye, bağlantı ve mobil görünümü kontrol eder. Test görüntüleri git dışında `artifacts/` altında tutulur.

Yedekleme ve geri yükleme, referans verilen avatarları da içerir. Dosyalar checksum ile doğrulanır; eski v5 yedekleri kaynak veritabanını değiştirmeden geri yüklenebilir. Canlı fotoğraf değiştirilse bile alınmış snapshot eski fotoğrafı tutar.

## Doğrulama — 8 Eylül 2026

- 129 farklı sunucu testi geçti: 126 testlik tam koşu, ardından yeni 3 yedekleme testi ve etkilenen profil/yedekleme testlerinin tekrarı.
- 51 farklı tarayıcı senaryosu geçti: yeni profil akışları, canlı güncelleme ve erişim kaybı; mevcut sohbet, sesli oda, çalışma alanı, hesap güvenliği, taslak, mobil ve erişilebilirlik akışları.
- Üretim derlemesi başarılı. Mevcut büyük JavaScript parçası uyarısı devam ediyor (yaklaşık 549 kB, gzip 161 kB).
- Coolify kontrolünün yapılandırma ve izolasyon adımları geçti; Docker motoruna erişilemediğinden konteyner oluşturma ve smoke testi çalışmadı. Yerel tarayıcı/API testleri konteyner dışında çalıştırıldı.
