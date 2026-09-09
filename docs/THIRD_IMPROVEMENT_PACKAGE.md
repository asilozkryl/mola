# Üçüncü iyileştirme paketi — 9 Eylül 2026

Başlangıç: `6b163d8c580589aa9e41cda93914aa82f3239b5a`. Kapsam: [proje planındaki](PROJECT_ROADMAP_2026-09-09.md) R07 güvenli tekrar gönderim ve R08 ekli taslaklar.

## Tasarım ve davranış

Mola'nın kompakt sohbet düzeni korunur. Manrope ile mesaj metni ve dosya adı öne çıkar; durum bilgisi daha küçük yazılır. Renkler mevcut arayüzden gelir: beyaz `#ffffff`, açık yüzey `#f5f7f8`, metin `#20292b`, ikincil metin `#687176`, yeşil `#237459`, hata metni `#8c452c`.

Yazma kutusunun içinde soldan hizalı dosya şeridi, metin alanı ve araçlar bulunur. Gönderim sorunu, kullanıcının mesajıyla birlikte aynı yerde kalır; kısa açıklama ve açık yeniden deneme işlemi sunar. Kullanılamayan bir dosya sessizce kaybolmaz: kendi satırında durumu ve kaldırma işlemi görünür. Başarı bildirimi geçicidir; başarısızlık kullanıcı çözene kadar görünür.

```text
[ dosya adı / boyut / kaldır ] [ kullanılamayan dosya / kaldır ]
Mesaj metni…
[ Gönderim durumu ve gerektiğinde yeniden deneme ]
Ekle  Biçim  Emoji  Bahset                         Gönder
Taslağın eşitlenme durumu
```

Görsel değerlendirme: ayrı büyük uyarı kartı yerine yazma alanındaki mevcut hiyerarşi kullanılır. Dosya ve gönderim durumları renk yanında metin ve simgeyle ayrılır. Küçük ekranda uzun dosya adları sarılır; düğmeler klavyeyle ve dokunarak kullanılabilir. Hareket yalnız yüklenme ve kullanıcının başlattığı gönderim geri bildiriminde yer alır.

## Güvenli gönderim

Her yeni arayüz gönderimi `clientMessageId` alır. Sunucu anahtarı kullanıcı ve çalışma alanına bağlar; kanal, yanıt, metin ve ekler aynıysa yeniden deneme önceki mesajı döndürür. İlk yanıt 201, tekrar yanıtı 200'dür. Aynı anahtar farklı bir içerikle kullanılırsa 409; daha önce gönderilip silinmiş mesaj için 410 alınır. Silinmiş mesaj yeniden oluşturulmaz. Erişim ve aktif üyelik, önceki gönderimi okurken de denetlenir. Kimlik göndermeyen eski istemcilerin mevcut API kullanımı desteklenir.

Mesaj, dosya bağlantıları, bildirimler, push kuyruğu ve eşleşen taslağın temizlenmesi tek veritabanı işlemi içinde yapılır. Socket bildirimleri ve push denemesi işlem tamamlandıktan sonra başlar. Başka cihazda değişmiş bir taslak gönderim sonrasında silinmez.

Tarayıcı gönderilecek metni ve ek kimliklerini aynı sekmenin `sessionStorage` alanında kullanıcı/çalışma alanı/kanal/yanıt kapsamıyla saklar. Belirsiz gönderim sonuçlanmadan yeni kimlik üretilmez. Kanal/profil değişimi ve sayfayı yenileme sonrasında kullanıcı aynı mesajı elle yeniden deneyebilir; otomatik çevrimdışı gönderim yoktur. Dosyanın kendisi bu kayda kopyalanmaz. Depolama yazılamıyorsa yeni gönderim başlatılmaz; önceki belirsiz gönderim için de yeni kimlik üretilmez.

Kesin, düzeltilebilir hata için **Taslağa dön** metni ve ekleri geri getirir; başka cihazda farklı bir sürüm varsa normal taslak seçimi açılır. Geri dönüş tamamlanmadan konuşmadan ayrılmak bekleyen gönderim kaydını silmez. Silinmiş bir mesajın gönderim kaydı ise taslak olarak yeniden oluşturulmaz.

## Ekli taslaklar

Taslak sürümü artık metinle birlikte en fazla dört yüklenmiş dosya kimliğini içerir. Dosya seçimi kullanıcıya ve konuşmaya bağlı olarak sunucuda saklanır. Metin aynı olsa bile farklı dosya seçimleri çakışma olarak değerlendirilir. Eski, yazarı belirli tarayıcı taslakları çalışma alanını da içeren anahtara taşınır; yazarı belirsiz eski anahtarlar alınmaz.

Dosya yüklemesi tamamlanmadan kanal/profil değişirse istek iptal edilir. Taslak çakışmasında sürüm seçmek de devam eden eski yüklemeyi iptal eder; geç yanıt seçilen sürüme dosya eklemez. Eksik dosya listede işaretlenir ve kaldırılana kadar gönderimi engeller. Dosya kaldırılınca klavye odağı yazma alanına döner. Dosyadan oluşan özel konuşma taslakları Özel mesajlar merkezinde de taslak olarak görünür.

Taslağa bağlı yüklemeler 24 saatlik sahipsiz dosya temizliğinden korunur. Taslaktan çıkarılan, bir mesaja bağlı olmayan ve 24 saatten eski yüklemeler mevcut periyodik temizlikte kaldırılır. Taslakta bir kimlik bulunması başka kullanıcının dosyasına veya yetkisiz kanala erişim vermez.

Kaydedilenler içinde açık bir mesaj dizisine gönderilen yanıtlar, arka planda başka kanal seçili olsa da doğru dizide görünür. Aynı kapsam denetimi hem socket olayına hem yeniden gönderimin HTTP yanıtına uygulanır.

## Veri geçişi

SQLite şeması **v9** olur: `message_requests`, `draft_attachments` ve silinen mesaj dizisinin taslağını temizleyen tetikleyici eklenir. Eski metin taslakları korunur. Geçiş tek işlemde yapılır ve dış anahtarlar doğrulanır; başarısız geçiş şema sürümünü ilerletmez. Eski uygulama sürümüne dönmek için v9 öncesindeki tutarlı veritabanı/dosya yedeği ile eşleşen uygulama sürümü kullanılmalıdır; yalnız eski imajı açmak desteklenmez.

## Doğrulama

- Üretim derlemesi ve TypeScript kontrolü geçti; yeni bağımlılık eklenmedi.
- **213/213 birim/API testi** başarılı. Yeni kontroller eşzamanlı sekiz tekrar, tek mesaj/ek/bildirim/push kaydı, üç hata noktasında işlem geri alma ve socket sessizliği, silinmiş mesaj, kapsam/erişim, ekli taslak çakışması ve v9 geçişini içerir.
- Önceki gönderme, taslak, hesap ve alan geçişlerine ait **13/13 tarayıcı senaryosu** geçti.
- Yeni davranışların **8/8 tarayıcı senaryosu** odaklı koşularda geçti: gerçek sunucu kaydından sonra yanıt kaybı, aynı kimlikle yeniden deneme, depolama hatası, kanal/profil/yenileme, iki cihaz, dosya çakışması, geç yükleme ve Kaydedilenler içindeki dizi. Son senaryo, başarısız mesajın taslağa dönüşü gecikirken gezinmeyi ve çakışma seçimi yapılmadan yenilemeyi doğrular; uzak sürüm kullanıcı seçimine kadar korunur.
- 320 px dokunmatik görünümde eksik dosya, klavyeyle kaldırma, odak dönüşü ve yatay taşma kontrol edildi; ilgili AXE taraması geçti. Masaüstü ve mobil ekran görüntüleri incelendi.
- Ayrı hesap kurtarma ve genel yönetim paketleri: **3/3 + 3/3** başarılı.
- Nihai tam tarayıcı koşusu **206/206** başarılı (9,8 dakika). Böylece son sürüm yerelde toplam **425 uygulama testiyle** doğrulandı; görüşme, erişim, profil, Kaydedilenler ve gezinme regresyonları da geçti.

[GitHub koşusu 34352518812](https://github.com/asilozkryl/mola/actions/runs/34352518812), `bdc21fc` commit'i için **başarısız** tamamlandı. Derleme, birim/API, TURN, bağımlılık ve altı kişilik medya adımları geçti; kalan tarayıcı adımı **204 başarılı, 1 başarısız** sonuçlandı. Çalışma alanı silme senaryosundaki genel metin seçicisi, gönderilen mesajı ve gönderim tamamlanana kadar aynı metni tutan yazı kutusunu birlikte buldu; iki deneme de bu seçici çakışmasında durdu. İz kaydı mesaj isteğinin `201`, ardından boş taslak okumasının `200` döndüğünü doğruluyor. Auth/admin, izleme, Docker ve Coolify adımları bu koşuda atlandı. Dördüncü pakette ilgili üç doğrulama yalnız `.message-text` öğelerini hedefleyecek biçimde düzeltildi; ilk gönderimden sonra yazı kutusunun boşalıp etkinleşmesi de bekleniyor. Bu test düzeltmesinin yeniden doğrulaması dördüncü paket koşusunda izlenir.

Yerel günlük ve ekran görüntüleri Git dışında `artifacts/third-package-*` konumundadır. GitHub doğrulaması [Validate Mola](https://github.com/asilozkryl/mola/actions/workflows/ci.yml) üzerinden izlenir. Canlı ortamda fiziksel cihaz veya manuel dağıtım kabulü bu tur yapılmadı. R04 sayfalama/dosya araması ve sonraki ürün maddeleri proje planında kalır.
