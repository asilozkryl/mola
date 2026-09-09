# Mola — Proje incelemesi ve geliştirme planı

İnceleme: 9 Eylül 2026 · Kod tabanı: `c3c5b91e21927be4f003493ab02fd8a1a9cf9b4e`.

Önerim, önce sürüm doğrulamasını düzeltmek; ardından mesaj, dosya ve gezinme güvenilirliğini tamamlayıp arama, ayarlar ve ilk kullanım deneyimini aynı tasarım dilinde birleştirmek. Ürün artık yalnız kanal ve mesaj ekranından ibaret değil. Yeni özelliklerin yanında, kullanıcıların mevcut özellikleri bulması ve yaptıkları işin kaybolmaması öncelikli.

Bu belge ilk incelemenin bulgularını ve uygulama sırasını korur. Aşağıdaki kanıtlar belirtilen başlangıç commit'ine aittir; ilk uygulama turunun güncel kapsamı ve doğrulaması [ilk paket kaydında](FIRST_IMPROVEMENT_PACKAGE.md) izlenir. İnceleme kaynak kod, testler, CI sonuçları, mevcut tasarım/işletim belgeleri ve yerel arayüz üzerinden yapıldı. Canlı altyapı, gerçek kullanıcı verileri ve fiziksel cihazlar bu tur denetlenmedi. Bu çalışma tam bir güvenlik testi değildir.

## 1. Mevcut durum ve kanıt

| Alan                     | Mevcut olanlar                                                                                        | Sonraki ihtiyaç                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Çalışma alanları         | Çoklu alan, davet, ayrı roller, sahiplik devri, ayrılma ve silme                                      | İlk kullanım yönlendirmesi, ayarların daha kolay bulunması                     |
| Kanallar                 | Özel üyelik, erişim yönetimi, arşiv/silme, sağ tık, sürükleme, kişisel bölümler                       | Büyük listelerde hızlı gezinme ve tutarlı adres modeli                         |
| Mesajlar                 | Yanıt, düzenleme/silme, tepki, sabitleme, bağlantı, taslak eşitleme/çakışma çözümü                    | Kimlikli bahsetme, güvenli tekrar gönderim, ekli taslak                        |
| Özel mesajlar / Aktivite | Ayrı merkezler, arama, filtreler, sayfalama, okunmamış sayıları                                       | Arama ve Kaydedilenler dahil tüm yüzeylerde doğru konuşma kimliği              |
| Profil                   | Fotoğraf, durum, unvan, hakkında, küçük profil kartı ve profil sayfası                                | Kaydedilmemiş düzenlemeyi koruma                                               |
| Dosyalar / Kaydedilenler | Dosya yükleme/indirme, kanal kapsamlı erişim, yerel kayıt listesi                                     | Liste sınırları, dosya adıyla arama, cihazlar arası kayıt eşitleme             |
| Ses / video              | Cihaz hazırlığı, mikrofon/hoparlör seçimi, kamera, ekran paylaşımı, küçük çubuk, geniş görüşme ekranı | Kamera seçimi ve gerçek cihaz/ağ kabulü                                        |
| Bildirim / PWA           | Push aboneliği, yeniden bağlama, kuyruk, test gösterimi, uygulama yükleme, genel çevrimdışı ekran     | Bildirim kapsamını netleştirme, gerçek teslimat teşhisi, kanal/saat tercihleri |
| Güvenlik                 | E-posta doğrulama/kurtarma, TOTP, kurtarma kodları, oturum iptali, çalışma alanı/kanal izinleri       | Mevcut korumaları yeni akışlara taşımak; ortak ofis kotasını ölçmek            |
| İşletim                  | Yedek, checksum, restore, restic seçeneği, metrikler, alarmlar, Docker/Coolify                        | Harici kabul kanıtı, restore süresi, push/entegrasyon görünürlüğü              |

Özel kanal üyeliği ayrımı mevcut ve ilgili testler başarılı. Önceki yanlış alarmı yeni bir güvenlik bulgusu olarak değerlendirmiyorum. Aynı şekilde 2FA, yedekleme, taslak eşitleme, DM ve Aktivite merkezleri yeniden yapılması gereken eksikler değil.

### Bu tur doğrulananlar

- `npm test`: **169/169 API ve birim testi geçti**.
- Ana Playwright envanteri: **40 dosyada 163 senaryo**. Bu tur tam paket yeniden çalıştırılmadı.
- Aynı commit için son [GitHub CI çalışması](https://github.com/asilozkryl/mola/actions/runs/34282602957): build, birim/API testleri, üretim bağımlılık denetimi ve altı kişilik medya testi geçti. Kalan tarayıcı adımı **160 başarılı, 1 başarısız, 1 yeniden denemede başarılı** sonuç verdi. Sonraki auth/admin, Docker ve dağıtım kabul adımları bu koşuda çalışmadı.
- CI'daki iki sorunlu senaryo yerelde odaklı tekrarlandı; ikisi de aynı beklentilerde başarısız oldu. Bunlar gerçek kullanıcı hatası ile test beklentisi/zamanlama farkı ayrıştırılmadan kapatılmamalı.
- Son görüşme düzenlemesinin **19 odaklı testi ve üretim build'i** önceki turda aynı commit için geçti; bu, tüm projenin sorunsuz olduğu anlamına gelmez.
- Yerel 1280×720 arayüzde kanal, Kaydedilenler, ayarlar, genel arama ve Aktivite incelendi. **Aktivite → sayfayı yenile → varsayılan tasarım kanalı** davranışı gözlendi.
- Mevcut üretim çıktısı: yaklaşık **630 KB JavaScript / 251 KB CSS** sıkıştırılmamış. Önceki build raporu gzip için yaklaşık **183 KB / 60 KB** gösteriyor. Bunlar ağ yükü ölçüsüdür; kullanıcı etkileşim gecikmesi ölçümü değildir.

## 2. İlk tamamlanması gereken işler

Öncelikler: **P0** sürüm doğrulamasını açar; **P1** günlük işin doğruluğu/kalıcılığı; **P2** kullanım kalitesi ve ürün gelişimi; **P3** ölçüm veya talep sonrası büyüme.

Efor: **Küçük** yaklaşık 0,5–2; **Orta** 2–5; **Büyük** 5–10+ odaklı geliştirici günü. Bunlar analiz tahminidir; donanım/sağlayıcı bekleme süresi dahil değildir ve takvim taahhüdü oluşturmaz. Birlikte yapılan işlerin eforları doğrudan toplanmamalı.

### R01 — CI ve tarayıcı beklentilerini yeniden güvenilir hale getir · P0 · Küçük–Orta

**Bulgu:** Menü testi gerçek kaydırma yerine `scroll` olayı gönderiyor; uygulama menünün bağlı olduğu öğe yer değiştirmediyse menüyü açık tutuyor. Profil testi ise geçici “Profil yükleniyor” durumuna takılıyor. CI'da menü testi iki denemede de başarısız; profil testi ikinci denemede geçmiş. Yerel tekrar ikisini de yakaladı.

**İş:** Gerçek kaydırma/öğe konumu davranışını test etmek; profil yükleme, eşzamanlı bootstrap ve socket yenilemesini kontrollü sırayla doğrulamak. Bir ürün hatası varsa düzeltmek, testi sırf geçmesi için gevşetmemek. Daha sonra tüm iş akışını tamamlamak. Uzun vadede birim, tarayıcı, medya ve dağıtım kabulünü bağımsız CI işlerine ayırmak; bir UI hatası dağıtım paketinin doğrulanmasını tamamen engellemesin.

**Kabul:** Gerçek konuşma kaydırılınca menü kapanır; ilgisiz panelin kayması menüyü bozmaz. Profilin iki sekmede güncellenmesi yükleme zamanından bağımsız doğru çalışır. Tam CI, sonraki auth/admin ve Docker kabulü dahil geçer.

Kanıt: [menü testi](../tests/context-menu.e2e.spec.ts#L159), [menü davranışı](../src/components/ContextMenu.tsx#L82), [profil testi](../tests/profile-live.e2e.spec.ts#L50), [CI akışı](../.github/workflows/ci.yml#L11).

### R02 — Bahsetme seçimini kişi kimliğine bağla · P1 · Orta

**Bulgu:** Composer üyeleri yalnız adlarıyla alıp `@AdSoyad` yazıyor. Sunucu aynı adlı üyeleri ad eşleşmesinden dışlıyor; `@[kullanıcı-id]` desteği zaten var. Aynı adlı iki kişiden biri seçilse bile bahsetme bildirimi oluşmayabilir. Bu koddan doğrulandı; bu tur iki aynı adlı kullanıcıyla uçtan uca yeniden üretilmedi.

**İş:** Kimlik/ad/avatar/unvan taşıyan kişi seçicisi; klavyeyle arama ve seçim; metinde okunabilir ad, veride sabit kimlik. Mesaj gösterimi, düzenleme, alıntı ve arama da aynı sözleşmeyi kullanmalı.

**Kabul:** Aynı adlı iki kişiden yalnız seçilen bildirim alır. Sonradan ad değişmesi hedefi değiştirmez. Yetkisiz üyeye bildirim gönderilmez. Eski metin bahsetmeleri okunabilir kalır.

Kanıt: [Composer](../src/components/Composer.tsx#L531), [üyelerin aktarımı](../src/App.tsx#L3030), [sunucu eşlemesi](../server/collaboration-data.ts#L585).

### R03 — Kaydedilenler'i kalıcı kişisel listeye dönüştür · P1 · Orta

**Bulgu:** Liste yalnız `localStorage` içinde tutuluyor. Açılışta son 200 kayıt alınıp tekrar saklanıyor; 201. kayıt ve sonrası kullanıldığında en eski kayıtlar sonraki yüklemede sessizce listeden çıkıyor. Bu mesajın sunucudan silinmesi değil, yer iminin kaybolmasıdır.

**İş:** Kullanıcı + çalışma alanı + mesaj kimliğiyle sunucu kaydı, sayfalama, mevcut yerel kayıtları tekrarsız taşıma. Kayıtlı mesaj içeriği güncel erişimle okunmalı; eski yerel içerik kopyası doğruluk kaynağı olmamalı. Listeye arama ve “mesaja git” akışı eklenmeli.

**Kabul:** 250 kayıt yenileme ve ikinci cihazda korunur. Taşıma tekrar çalışınca kayıt çoğalmaz. Silinen/erişimi kapanan mesaj güvenli şekilde ayıklanır. Ağ hatası kayıt silmiş gibi görünmez.

Kanıt: [yükleme ve 200 sınırı](../src/App.tsx#L687), [yerel saklama](../src/App.tsx#L991), [kayıt ekleme](../src/App.tsx#L1847).

### R04 — Dosya, sabitlenen ve geçmiş listelerini tamamla · P1 · Orta

**Bulgu:** Dosya ve sabit mesaj uçları en fazla 100 kayıt döndürüyor; devam sayfası yok. Yükleme hatası yalnız toast gösterip ardından boş liste durumuna dönüşebiliyor. Genel arama mesaj içeriğini arıyor; dosya adı ayrı aranmıyor. Mesaj geçmişinde silinmiş sınır kaydı sonraki sayfayı bozabilir; arama OFFSET nedeniyle yeni sonuç eklenirken tekrar gösterebilir.

**İş:** Hub'larda kullanılan kararlı tarih/kimlik cursor yaklaşımını bu listelere yaymak. Kalıcı hata + “Yeniden dene”; dosya adı, gönderen ve tarih filtresi; dosyadan kaynak mesaja gitme. Görsel/PDF önizlemesini aynı erişim denetimi altında ortak bir panelde sunmak.

**Kabul:** 150+ dosya/sabit mesajın tamamına erişilir. Silinen sayfa sınırı veya yeni mesaj eklenmesi tekrar/atlama üretmez. 503 durumunda “dosya yok” denmez. Yalnız dosya içeren mesaj dosya adıyla bulunur.

Kanıt: [liste uçları](../server/app.ts#L423), [geçmiş cursor'u](../server/app.ts#L439), [arama](../server/app.ts#L533), [koleksiyon yükleme](../src/App.tsx#L1011), [dosya görünümü](../src/App.tsx#L2812).

### R05 — Küçük ama sık yaşanan UI tutarsızlıklarını temizle · P1 · Küçük

**İşler:** Arama/filtre/Kaydedilenler'de DM için karşı tarafın güncel adı ve kişi simgesi; profil düzenlemesinde kaydedilmemiş alan/fotoğraf kontrolü; üst çubuktaki “Bildirimleri sessize al” metninin uygulama içi uyarılarla sınırlı olduğunu açıklamak.

**Kabul:** DM'nin iki tarafı da karşı tarafın doğru adını görür; profil adı değişince eski isim kalmaz. Kaydedilmemiş profil yanlışlıkla kapanmaz; değişiklik yoksa ek onay çıkmaz. Yerel sessize alma, push da kapanmış gibi sunulmaz.

Kanıt: [DM arama etiketi](../src/App.tsx#L4255), [Kaydedilenler etiketi](../src/App.tsx#L2720), [profil kapanışı](../src/components/SettingsDialog.tsx#L258), [sessize alma](../src/App.tsx#L2394).

### R06 — Gezinmeyi adres, geri/ileri ve yenilemeyle bütünleştir · P1 · Büyük

**Bulgu:** Profil ve mesaj bağlantıları var; normal kanal/DM/merkez seçimi çoğunlukla React state'inde. Aktivite'den yenilemeyle varsayılan kanala dönüldüğü tarayıcıda doğrulandı.

**İş:** Çalışma alanı, kanal/DM, Özel mesajlar, Aktivite, Kaydedilenler, dosya/sabitlenen sekmesi ve açık yanıt için ortak rota sözleşmesi. Eski profil/mesaj/davet bağlantılarını korumak. Önce rota modelini uygulama durumundan ayırmak; tüm App bileşenini aynı anda yeniden yazmamak.

**Kabul:** Yenileme aynı sayfayı/sekmesini açar. Geri/İleri beklenen sırayı izler. Profile gidip dönünce sohbet kaydırması ve taslak korunur. Erişimi kaldırılmış adreste eski içerik gösterilmeden anlaşılır bir alternatif sunulur. Alan değiştirirken görüşme onayı korunur.

Kanıt: [ilk kanal seçimi](../src/App.tsx#L432), [kanal seçimi](../src/App.tsx#L1708), [görünüm seçimi](../src/App.tsx#L1767).

### R07 — Ağ kesintisinde tekrar gönderimi güvenli yap · P1 · Orta

**Bulgu:** Her mesaj POST'u yeni UUID oluşturuyor; istemci işlem kimliği yok. Mesaj ve bildirim ayrı transaction'larda yazılıyor. Sunucu mesajı kaydetmişken yanıt kaybolursa kullanıcı tekrar gönderdiğinde metin çoğalabilir; iki transaction arasında süreç kesilirse mesaj bildirimsiz kalabilir. Bu tur süreç çökertme/yanıt kaybı deneyi yapılmadı; risk koddan çıkarıldı.

**İş:** Kullanıcı/alan kapsamlı benzersiz `clientMessageId`; aynı işlem/farklı içerik için açık çakışma; mesaj ile bildirim/outbox'ın atomik yazılması. Composer'da gönderiliyor/başarısız/yeniden dene durumunu bu işlemle eşlemek. İlk aşama açık sekmede güvenli tekrar olmalı; kalıcı çevrimdışı gönderim ayrı karar.

**Kabul:** Commit sonrası yanıt kaybı ve tekrar gönderim tek mesaj/tek bildirim üretir. Aynı işlem kimliği başka kullanıcı/alan adına kullanılamaz. Eski taslak/gönderim yeni kanala taşınmaz. Ekli mesaj yeniden denemede yeni bir kopya üretmez.

Kanıt: [mesaj oluşturma](../server/app.ts#L449), [bildirim transaction'ı](../server/collaboration-data.ts#L593), [mevcut tekrar testi](../tests/composer-feedback.e2e.spec.ts#L73).

### R08 — Taslakların seçili eklerini de koru · P2 · Orta

**Bulgu:** Metin taslağı eşitleniyor; seçili ekler Composer state'inde. Kanal/profil değişiminde bileşen yeniden kurulduğunda ek seçimi kaybolabiliyor. Yüklenmiş fiziksel dosyanın silindiği iddia edilmiyor.

**İş:** Yüklenmiş ek kimliklerini kullanıcı/alan/kanal/yanıt taslağına bağlama; kaldırılan/süresi dolan ekler için açık durum; gönderimden sonra temizlik. Hesaplar arasında yerel File nesnesini paylaşmamak.

**Kabul:** Kanal veya profile gidip dönünce metin ve ekler geri gelir. Geç dönen yükleme başka taslağa eklenmez. Silinmiş/süresi dolmuş dosya sessizce gönderilmez. R07 ile aynı gönderim yaşam döngüsünü kullanır.

Kanıt: [Composer ek state'i](../src/components/Composer.tsx#L61), [Composer anahtarı](../src/App.tsx#L3024), [taslak sözleşmesi](../shared/collaboration-types.ts#L19).

## 3. Ürünü daha kolay ve akıcı hale getirecek sonraki işler

| İş                                        | Öncelik / efor  | Önerilen kapsam ve kabul                                                                                                                                                                                                                                               | Kanıt / bağımlılık                                                                                                                                                                                                                   |
| ----------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **R09 — Bildirim kontrolü**               | P2 / Orta       | Kanal için tümü/bahsetmeler/kapalı; 30 dk/1 saat/gün sonuna kadar susturma; saat dilimli sessiz saatler. Uygulama içi ve push kapsamı açık; Aktivite geçmişi korunur.                                                                                                  | [Tek hesap tercihi](../shared/collaboration-types.ts#L24), [yerel odak ayarı](../src/components/SettingsDialog.tsx#L503). Tercih migration'ı gerekir.                                                                                |
| **R10 — Gerçek push teşhisi**             | P1 / Orta       | Kullanıcının isteğiyle sunucu kuyruğundan kendi cihazına test; kuyrukta/sağlayıcı kabul etti/başarısız ayrımı. Kuyruk yaşı, 410/5xx/timeout ve son başarısızlık ölçülür. Sağlayıcı kabulü, OS'de gösterildi diye sunulmaz.                                             | [Mevcut yerel test](../src/components/NotificationSettings.tsx#L455), [retry sonu](../server/collaboration-data.ts#L539), [metrikler](../server/observability.ts#L116). Gerçek test cihazı gerekir.                                  |
| **R11 — Arama ve hızlı işlemler**         | P2 / Orta       | Ctrl/⌘ K içinde kanal/kişi/mesaj ve yetkiye uygun işlemler; klavyeyle seçim. Gelişmiş filtreler gerektiğinde açılır. Tarihler kullanıcının saat diliminde seçilip sunucuda doğru UTC aralığına çevrilir. Dosya adı araması R04 ile gelir.                              | [Mevcut mesaj araması](../src/App.tsx#L4044). Bugün filtreli arama ve ayrı kanal/kişi bulma zaten var; amaç birleştirmek. R06 ile rota uyumu.                                                                                        |
| **R12 — İlk kullanım ve ayar yapısı**     | P2 / Orta       | Kapatılabilir, role göre kısa başlangıç listesi; profilini tamamla/ilk mesaj/davet. Ayarlarda Profil, Görünüm, Bildirimler, Güvenlik, Çalışma alanı ayrımı; yetkisiz görevler görünmez. Adım tamamlanması gerçek olaydan, ilerleme kalıcı.                             | [Alan oluşturma sonrası akış](../src/App.tsx#L1689), [ayar formu](../src/components/SettingsDialog.tsx#L258). Şu anda oluşturma, davet ve yardım zaten mevcut.                                                                       |
| **R13 — Ortak tasarım sistemi**           | P2 / Orta       | Renk/boşluk/yazı/odak/modal/menü/liste durumlarını ortak token ve bileşenlere toplamak. Önce arama, dosyalar, ayarlar ve yönetim ekranları. Rahat/sıkışık yoğunluk; ardından açık/koyu/sistem teması. Tekrarlanan CSS üzerine yeni override ekleme döngüsünü azaltmak. | [Temel token'lar](../src/styles.css#L1), [genel polish](../src/workspace-polish.css), bileşen CSS'leri. Yeni DM/sidebar/call dili temel alınır. 320 px, klavye, kontrast ve azaltılmış hareket kontrolü.                             |
| **R14 — Hız ve arayüz kodunun bölünmesi** | P2 / Orta–Büyük | App'ten gezinme, mesaj koleksiyonları ve socket olaylarını kademeli ayırmak; yönetim/ayar/görüşme gibi ağır alanları gerektiğinde yüklemek. Uzun mesaj listesinde ölçüme göre sanallaştırma. Kritik alanlara yerel hata sınırı eklemek.                                | [App statik importları](../src/App.tsx#L111), [tek kök hata sınırı](../src/main.tsx#L15). App yaklaşık 4,4 bin dolu satır; başlangıçta tek ana JS paketi. R06 sözleşmesiyle koordine edilir.                                         |
| **R15 — Görüşmede cihaz ve ağ deneyimi**  | P2 / Orta       | Kamera seçimi/ön-arka kamera; başarısız değişimde eski görüntüyü koruma. Kopuş sonrası anlaşılır yeniden katılma. Farklı ağlarda zorunlu relay, Wi-Fi→mobil geçiş, 60 dk görüşme kabulü.                                                                               | [Varsayılan kamera](../src/lib/useCall.ts#L723), [kopuş yaşam döngüsü](../src/lib/useCall.ts#L397), [relay yapılandırması](../server/calls.ts#L103). Mikrofon/hoparlör seçimi ve ICE retry zaten var. Cihaz ve staging TURN gerekir. |
| **R16 — Tarayıcı ve dokunmatik kabulü**   | P1 / Orta       | Firefox/WebKit temel hesap, mesaj, arama ve modal testleri; gerçek Android/iOS-PWA'da izin, kamera, push, arka plana alma ve geri dönüş. Dokunmatik hedefler en az 44 px, klavye odağı görünür.                                                                        | [Yalnız Chromium projesi](../playwright.config.ts#L25), [cihaz kabul sınırı](../docs/VOICE_UI.md#L44). Desteklenen platform listesi belirlenmeli; desteklenmeyen özellik anlaşılır alternatif sunmalı.                               |
| **R17 — Aynı ofis IP'sinde kapasite**     | P1 / Orta       | Anonim auth için IP sınırını koruyup oturumlu API'ye kullanıcı bazlı kota ve ek genel IP koruması. Tek IP'deki 30 normal oturumun birbirini 429'a düşürmediğini ölçmek.                                                                                                | [Global 300/dk limit](../server/app.ts#L130), [301. istek testi](../tests/backend.test.ts#L204), [yük testi IP modeli](../docs/PERFORMANCE.md#L73). Auth/proxy sırası ve kötüye kullanım regresyonu kontrol edilir.                  |
| **R18 — Büyük veri sorguları**            | P3 / Orta–Büyük | 100 bin mesaj/500 DM gibi ayrı fixture ile sorgu sayısı/p95 ölçümü; mesaj eki/tepki/yanıt sayısını toplu çekmek; ölçümle indeks seçmek. 50 mesajın serileştirme sorguları mesaj adediyle artmamalı.                                                                    | [Mesaj serileştirme](../server/db.ts#L220), [DM sorgusu](../server/conversation-hubs.ts#L190). Mevcut performans arızası iddiası yok; önce benchmark. FTS/ayrı DB ancak ölçüm gerektirirse.                                          |
| **R19 — Operasyon kabulü**                | P1 / Orta       | Harici alarm alıcısına test, bağımsız uptime kontrolü, harici yedekten ayrı ortamda restore. Son başarı tarihi ve ölçülen kurtarma süresi/veri kaybı aralığı raporlanır. Büyük snapshot sırasında mesaj gecikmesi ölçülür.                                             | [Mevcut offsite/alarmlar](../docs/OPERATIONS.md#L58), [senkron snapshot](../server/observability.ts#L81). Canlıda eksik olduğu doğrulanmadı; staging ve yetkili harici kaynak gerekir.                                               |
| **R20 — Entegrasyon teslimat geçmişi**    | P2 / Orta       | Son teslimatlarda başarılı/tekrar/yok sayılan/başarısız ayrımı, güvenli hata nedeni ve kurulum kontrolü. Token/ham payload/özel mesaj günlüklenmez; saklama süresi sınırlı.                                                                                            | [GitHub doğrulaması](../server/integrations.ts#L297), [mevcut UI](../src/components/IntegrationsDialog.tsx#L97). İmza, tekrar engeli, anahtar yenileme ve kapatma zaten var.                                                         |
| **R21 — Tipli izin ve veri bağlamı**      | P3 / Orta       | Hesap bağlamı ile aktif alan bağlamını ayıran ortak yardımcılar; tenant kapsamı zorunlu repository yöntemleri. Owner/admin/moderatör/üye/misafir/askı/ayrılmış test matrisi korunur.                                                                                   | [Genel DB Row tipi](../server/db.ts#L11), [izin bağlamı](../server/permissions.ts#L49), [hub bağlamı](../server/conversation-hubs.ts#L53). Bu bakım önerisi, keşfedilmiş yetki açığı değil.                                          |
| **R22 — Güncel ürün ve sürüm kaydı**      | P2 / Küçük      | README kullanım terimleri, taslak kalıcılığı ve doğrulama indeksini güncellemek; geçmiş sonuçları tarihsel tutup son commit/kapsam/başarısızlık için kısa güncel kayıt oluşturmak.                                                                                     | [README taslak tanımı](../README.md#L41), [tarihsel doğrulama](../docs/VERIFICATION.md#L1), [yeni hub doğrulaması](../docs/CONVERSATION_HUBS.md). README yerel taslak ifadesi, mevcut sunucu eşitlemesini tam anlatmıyor.            |

## 4. Tasarım yönü

Yeni sidebar, DM ve görüşme ekranındaki Manrope, orman yeşili, ince çizgi ve kontrollü yoğunluk korunmalı. “Daha live” hedefini; tıklamaya anında tepki, net yükleme/başarı/hata durumları, gerçek zamanlı veri, yerinde açılan kontroller ve konumu koruyan geçişler olarak uygulamalıyız.

Arama, Dosyalar ve Ayarlar bu dilin bir sonraki adayları. Ana eylem ilk bakışta seçilmeli; gelişmiş seçenekler gerektiğinde açılmalı. Boş ekranlar ilgili tek sonraki adımı göstermeli. Aynı işlemin adı ve simgesi tüm yüzeylerde aynı olmalı. Profil/avatarlar kompakt kalmalı; kullanılabilir alanı içerik ve kontrollere ayırmalıyız.

Görsel öncelik sırası: **Arama/Dosyalar → Ayarlar → İlk kullanım → Yönetim → tema/yoğunluk seçenekleri**. Yeni bir genel dashboard şu aşamada gerekli görünmüyor; mevcut merkezlerin akışlarını tamamlamak daha yüksek değer taşıyor.

## 5. Uygulama sırası

| Paket                                  | Kapsam                                         | Kullanıcının göreceği sonuç                                                  | Çıkış şartı                                                         |
| -------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **0 — Sürüm doğruluğu**                | R01                                            | Güvenilir sürüm temeli                                                       | Tüm CI adımları çalışmış ve başarılı; test/ürün farkı açıklanmış    |
| **1 — Günlük kullanım pürüzleri**      | R02, R03, R04 hata/sayfalama kısmı, R05, R22   | Doğru bahsetme, kaybolmayan kayıtlar, erişilen eski dosyalar, tutarlı adlar  | 250 kayıt, 150 dosya, aynı adlı kişiler, hata/yeniden deneme kabulü |
| **2 — Akıcı çalışma**                  | R06, R07, R08; R11 ve R13'ün arama/dosya kısmı | Yenilemede yerini koruyan gezinme, kaybolmayan ek seçimi, daha hızlı arama   | Geri/İleri/yenileme; yanıt kaybında tek mesaj; taslak/ek izolasyonu |
| **3 — Güvenilir teslimat ve bildirim** | R09, R10, R17                                  | Anlaşılır sessize alma, teşhis edilebilir bildirim ve ekip kapasitesi        | Tek ofis IP'si ve gerçek push kabulü                                |
| **4 — Cihaz ve ekip kabulü**           | R12, R15, R16, R19; R20 ihtiyaca göre          | Yeni üyenin hızlı başlaması, gerçek cihaz/ağda görüşme, doğrulanmış kurtarma | Fiziksel cihaz matrisi, uzun görüşme, harici restore/alarm kanıtı   |
| **5 — Ölçülen büyüme**                 | R14, R18, R21; R13 tema/yoğunluk               | Daha düşük başlangıç yükü, büyük geçmişte akıcılık, sürdürülebilir kod       | Önce/sonra ölçüm, izin ve medya regresyonlarının geçmesi            |

Paket 2 içinde önce R07 güvenli gönderim çekirdeği tamamlanmalı; R08 ekli taslakların gönderim entegrasyonu bu sözleşme üzerine kurulmalı. R14'ün küçük App ayrıştırmaları R06 sırasında yapılabilir; toplu yeniden yazım gerekmiyor. R16 temel tarayıcı kontrolleri ilk paketlerden itibaren eklenmeli. Gerçek ekip kullanımı büyütülmeden önce R17/R19 kabulü tamamlanmalı.

**İlk uygulama turu için önerim:** R01'i kapatıp R02, R04'ün hata durumu ve R05'i birlikte ele almak. Bunlar kısa sürede doğruluğu ve günlük kullanım hissini iyileştirir. Ardından R03 ve R06 ile kalıcılığı tamamlamak. Sunucu sözleşmesini etkileyen R07'yi tasarım aşamasında geciktirmemek.

## 6. Sonraya bırakılacak ürün seçenekleri

| Seçenek                                   | Ne zaman değerli olur?                                        | Ön koşul                                                                   |
| ----------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Grup özel konuşmaları                     | Küçük alt ekipler kanal açmadan görüşmek istediğinde          | Katılımcı ekleme/çıkarma, geçmiş görünürlüğü ve bildirim sözleşmesi        |
| Mesaj hatırlatma / zamanlama              | Kullanıcı görüşmelerinde tekrar eden ihtiyaç çıkarsa          | R07 güvenli gönderim, sunucu zamanlayıcısı, saat dilimi ve iptal davranışı |
| Daha büyük toplantı / SFU                 | Mevcut 6 kişilik sınır gerçek kullanımı engelliyorsa          | Kapasite ve işletim bütçesi, bağımsız medya mimarisi değerlendirmesi       |
| Kalıcı çevrimdışı geçmiş/gönderim         | Mobil saha kullanımında doğrulanmış ihtiyaç varsa             | R07; cihazda özel veri saklama, çıkışta temizlik ve erişim iptali tasarımı |
| Kurumsal SSO, kapsamlı dış entegrasyonlar | Belirli ekip/müşteri gereksinimi varsa                        | Kimlik/rol/provisioning sözleşmesi ve sağlayıcı kabulü                     |
| AI özetleri, kayıt/transkript             | Kullanıcı ihtiyacı ve veri işleme tercihi açıkça belirlenirse | İçerik/medya işleme sınırları, saklama ve yetki modeli                     |

Bu seçenekler ilk paketleri engellememeli. Mevcut kapsam tek sunuculu küçük ekip ürünü; yalnız daha modern görünmek için yeni altyapı veya büyük özellik eklemek gerekmiyor.

## 7. Başarıyı nasıl ölçeceğiz?

İlk uygulama turunun başında aşağıdaki işlerin mevcut süresi ve hata sayısı ölçülmeli; aşağıdaki eşikler başlangıç kabul önerisidir, mevcut ölçüm sonucu değildir.

- Beş kişiyle kısa görev denemesi: kanal bulma, birine DM, eski dosya bulma, bahsetme, bildirim susturma, görüşmeye katılma. En az dördü yardım almadan tamamlayabilmeli. Görüşmeye/davete ilişkin denemeler test çalışma alanında yapılmalı.
- Mesaj, kayıt, taslak ve eklerde yeniden deneme/yenileme sırasında kayıp veya yinelenme olmamalı.
- Ağ hatası ile boş sonuç tüm listelerde ayrı görünmeli; yeniden deneme yerinde olmalı.
- Geri/İleri, yenileme ve profile gidip dönüş aynı sohbet bağlamını korumalı.
- 320 px genişlikte temel işlemler taşmamalı; klavye ile ulaşılmalı; ciddi/kritik otomatik erişilebilirlik ihlali olmamalı. Otomatik tarama, gerçek klavye/dokunmatik kabulünün yerine geçmez.
- Başlangıç JS yükü ve uzun liste etkileşimi için sabit cihaz/ağda önce/sonra ölçüm alınmalı; iyileşme yalnız bundle küçülmesine dayanarak ilan edilmemeli.
- Her paket; kapsamındaki testler, ekran görüntüleri, migration/rollback etkisi ve tamamlanmış CI sonucu ile kapanmalı. Güvenlik sınırları ve görüşme cihaz temizliği ortak kabul koşulu olarak kalmalı.
