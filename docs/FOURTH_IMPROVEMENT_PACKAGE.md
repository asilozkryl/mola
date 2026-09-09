# Dördüncü iyileştirme paketi — 9 Eylül 2026

Başlangıç: `bdc21fc5190e56d9169588c55f5b253b6ff58449`. Kapsam: [proje planındaki](PROJECT_ROADMAP_2026-09-09.md) R04 dosyalar, sabitlenenler, geçmiş ve arama.

## Tasarım

Manrope ve mevcut kompakt Mola düzeni korunur. Renkler: beyaz `#ffffff`, açık yüzey `#f5f7f8`, metin `#293730`, ikincil metin `#62716c`, çizgi `#e2e8e5`, vurgu `#237459`. Dosya adı ve mesaj metni birincil, gönderen ve tarih ikincil bilgidir. Büyük tanıtım kartları yerine arama araçları ve erişilebilir satırlar kullanılır.

```text
Dosyalar / Sabitlenenler                  sonuç sayısı
[Ad veya içerik ara] [Gönderen] [Başlangıç] [Bitiş]
Tür  Dosya adı          Gönderen · Tarih    Önizle / İndir / Mesaja git
─────────────────────────────────────────────────────────────────────
                      Daha fazla göster

Dosya önizlemesi                                      Kapat
Dosya adı · boyut
[              Görsel veya PDF önizlemesi              ]
Mesaja git                                  Dosyayı indir
```

İlk değerlendirme: her işlem için ayrı büyük kart eklemek ekranı gereksiz büyütür. Bunun yerine tek araç satırı, ince ayraçlar ve belirgin odak halkaları kullanılır. Dar ekranda filtreler ve işlemler sarılır; önizleme ekranın kullanılabilir genişliğini alır. Yükleme, hata ve boş sonuç birbirinden ayrılır. Hata sırasında yüklenmiş kayıtlar korunur ve aynı sayfa yeniden denenebilir.

## Listeler ve arama

Dosyalar ve sabitlenen mesajlar 50 kayıtlık sayfalarla yüklenir; 100 kayıtlık toplam sınır kaldırıldı. Dosya adı/mesaj metni, gönderen ve tarih aralığı birlikte kullanılabilir. Dosya satırları tür, ad, boyut, gönderen ve tarih gösterir. Önizleme, indirme ve kaynak mesaja gitme ayrı işlemlerdir. Sabitlenen mesajlar mevcut mesaj işlemlerini korur.

Liste yenilendiğinde kullanıcının açtığı sayfa derinliği yeniden okunur. Geçici hata sırasında önceki kayıtlar korunur; yeniden deneme başarısız sayfadan devam eder. Kesin erişim hatasında içerik temizlenir. Filtre, kanal, hesap veya çalışma alanı değişince eski yanıtlar ve kaynak mesaja gitme istekleri yeni görünümü değiştiremez. Klavyeyle son sayfa yüklenince odak kaybolmaz; yeniden deneme kullanıcının yazma kutusuna taşınmış odağını geri almaz.

Genel arama dosya adlarını da kapsar; yalnız dosyadan oluşan mesajlar bulunur. Sonuçta eşleşen mesajın dosya adları gösterilir. Önceki/sonraki sayfalar kararlı devam anahtarları kullanır. Tarihler kullanıcının yerel gün sınırlarından hesaplanır; bitiş gününün tamamı dahil edilir ve yaz/kış saati geçişleri korunur. Hata, yükleme ve boş sonuç farklı durumlardır.

Kaynak mesaj açılmadan önce güncel erişimle tekrar okunur. Son 50 mesaj dışındaki eski bir kaynak, mevcut derin bağlantı davranışına uygun olarak sağdaki mesaj dizisi panelinde açılır. Geçersiz sayfa anahtarı için yeniden deneme yeni ilk sayfayı alır. Mesaj geçmişi ve yanıtlar da silinebilen sınır mesaj kimliğine bağımlı olmadan devam eder.

## Sunucu sözleşmesi

`shared/collection-types.ts` dosya metadatasını ve sayfa cevaplarını ortaklaştırır. `/channels/:id/files` ve `/pins` yanıtları `nextCursor` ve toplam kayıt sayısını; `/messages` ve `/search` yanıtları `nextCursor` ve `hasMore` alanlarını döndürür. Sayfa boyutu varsayılan 50, en fazla 100'dür. Ortak filtreler `q`, `userId`, `startAt` (dahil), `endBefore` (hariç) alanlarıdır.

HMAC ile imzalanan devam anahtarı kullanıcı, çalışma alanı, liste türü, kanal, yanıt kökü ve normalize edilmiş filtrelere bağlıdır. Tarih/kimlik çifti sabit sıralama sınırı olur. Her sayfada güncel erişim yeniden denetlenir; anahtarın bulunması erişim yetkisi vermez. Dosya aramasında `%` ve `_` normal karakter olarak eşleşir. Unicode sorgular normalize edilir; genişleyen sorgular anahtar boyutunu büyütmez. Eski `before` ve arama `offset/from/until` istemcileri desteklenir; yeni arayüz bunları kullanmaz.

## Önizleme

Ortak panel dosyayı hesap ve çalışma alanı başlıklarıyla yetkili uçtan alır. Görseller ekrana sığdırılır. Geçici dosya URL'leri kapanışta, hesap/alan değişiminde, kanal erişimi kaldırıldığında ve kaynağın silindiği bilindiğinde serbest bırakılır. Dosya uçları `Cache-Control: private, no-store` döndürür. Önizleme tam ekranı kaplayan bir kart oluşturmaz; masaüstünde geniş, telefonda kullanılabilir genişlikte açılır.

PDF dosyaları tarayıcının yerleşik PDF eklentisine bağlı değildir. PDF.js 6.3.289, belge açıldığında ayrı bir modül ve aynı kaynaktan worker olarak yüklenir; sayfayı canvas üzerine çizer. Önceki/sonraki sayfa, sayfa sayısı ve seçilebilir metin alternatifi bulunur. Yeniden boyutlandırma ve belge değişiminde önceki çizim iptal edilir; kapanışta worker, sayfa kaynakları ve geçici URL serbest bırakılır. Parolalı veya bozuk belge için açıklama ve indirme işlemi korunur. CSP'de worker yalnız aynı kaynaktan yüklenir; yetkili dosyadan oluşturulan blob'un PDF.js tarafından okunması için `connect-src blob:` ve Vite'ın gömdüğü fontlar için `font-src data:` tanımlıdır. PDF için iframe, object veya eval izni açılmaz. Üretim derlemesiyle yapılan gerçek tarayıcı kontrolü bu başlıklar altında PDF çizimini ve hatasız yüklemeyi doğrular.

CMap, özel standart font ve ek codec veri dizinleri bu pakette servis edilmez. Bu verilere ihtiyaç duyan bazı CJK/özel font/JPEG2000 belgelerinde çizim desteği sınırlıdır; orijinal dosyayı indirme işlemi korunur. `stopAtErrors` PDF.js'in yükselttiği hataları görünür hale getirir; kütüphanenin yalnız uyarı ürettiği tüm font değişimlerini hataya çevirdiği iddia edilmez.

Teknik referanslar: [Mozilla PDF.js örnekleri](https://mozilla.github.io/pdf.js/examples/), [belge yükleme ve kaynak temizliği](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFDocumentLoadingTask.html), [Vite dosya URL'leri](https://vite.dev/guide/assets.html#explicit-url-imports).

## Veri ve geri dönüş

Veritabanı şeması v9 olarak kalır; veri geçişi veya eski kayıtları değiştiren işlem yoktur. Önceki uygulama sürümü aynı şemayla çalışabilir. Mevcut içerik ve yüklemeler korunur. Canlı ortamda fiziksel cihaz kabulü ve manuel dağıtım bu turun test kapsamı değildir.

## Doğrulama

- Son `npm test`: **225/225** geçti; nihai CSP ve tarih yardımcıları dahil.
- Ayrı auth ve admin paketleri: **3/3 + 3/3** geçti.
- İlk tam tarayıcı koşusu: **214 başarılı, 2 test sözleşmesi uyumsuzluğu** (10,1 dakika). Dosya listesine eklenen kaynak metadatası eski tam eşitlik beklentisini; yeni önizleme/indirme işlemleri genel metin seçicisini etkiledi. Her iki test yeni sözleşmeye göre daraltıldı; kayıt sayısı ve tekillik beklentileri korunur. Bu koşu son PDF çiziminden önce alındı.
- Güncellenen sözleşmelerle 40 odaklı tarayıcı senaryosunun 39'u ilk turda geçti; PDF testi gerçek canvas temizliği yarışını yakaladı. Bu düzeltmeden sonra R04'ün 10 senaryosunun 9'u geçti; PDF sayfasının klavye odağı eksikliği giderildi ve kalan PDF testi de geçti. Böylece bu 40 senaryonun tamamı doğrulandı; son kaynaktan tek bir 40/40 veya 216/216 tam koşu alındığı iddia edilmez.
- PDF kabulü: iki sayfanın gerçekten çizilmiş pikselleri, doğru seçilebilir metin, önceki/sonraki sınırları, 320 px taşmama, ciddi/kritik AXE ihlali olmaması, Tab/Shift+Tab ve Escape sonrası odağın açan düğmeye dönmesi.
- Ayrı `SERVE_STATIC` kontrolü üretim derlemesini gerçek sunucu CSP başlıklarıyla açtı: PDF açılmadan modül/worker isteği yok, açıldıktan sonra iki yerel dosya alındı; sayfa pikselleri ve metni doğrulandı, konsol/uygulama hatası yok. Son CSP değişikliğiyle 9/9 koleksiyon/API testi de yeniden geçti. Kanıt: `artifacts/fourth-package-pdf-built.json` ve `.png`.
- Üretim build'i başarılı. Başlangıç JS **696,64 KB / gzip 202,11 KB**, CSS **267,88 KB / gzip 62,73 KB**. PDF açıldığında ayrıca **430,93 KB / gzip 129,03 KB** modül ve **1.265,41 KB** worker alınır. Mevcut 500 KB ana parça uyarısı devam eder; başlangıç performansının iyileştiği iddia edilmez. Yeni bağımlılıkla npm denetiminde 0 açık bulundu.

API kapsamı 150+ dosya, sabit mesaj, kök/yanıt geçmişi ve arama kaydını içerir. Tarayıcı testleri gerçek API cevaplarıyla sayfalama, geç yanıt, erişim iptali, yerel tarih, kaynak navigasyonu ve 320 px önizleme davranışını denetler. Detaylı günlükler ve ekran görüntüleri Git dışında `artifacts/fourth-package-*` altında tutulur.

Önceki paketin CI koşusunda gönderim sırasında hem mesajı hem yazı kutusunu bulan test seçicisi daraltıldı; ayrıca taslak temizlenmesinin tamamlanması beklenir. Bu düzeltme yalnız teste aittir.


`ede5e71538898a1dcef89b72ebc7dce5e2e386de` için [GitHub CI 34358410646](https://github.com/asilozkryl/mola/actions/runs/34358410646) **başarıyla tamamlandı**: build, birim/API, TURN, bağımlılık denetimi, altı kişilik medya, kalan tarayıcı akışları, auth/admin, izleme kuralları, alarm yönlendirmesi, Docker ve iki ayrı Coolify kabulü geçti. Üstteki ayrıntılı sayılar yerel koşulara aittir; CI özeti `artifacts/fourth-package-ci.json` içinde saklandı. Sonraki plan kapsamı R09/R10 bildirim tercihleri ve gerçek push teşhisi ile R17 ekip kapasitesidir.
