# Doğrulama — 7 Eylül 2026

## İşbirliği, görüşme ve hesap geliştirmeleri — şema v5

Bu sürümde **106 sunucu/birim testi**, **59 farklı ana tarayıcı senaryosu**, **3 hesap kurtarma** ve **2 genel yönetim** senaryosu doğrulandı: toplam **170 uygulama testi**. TypeScript/Vite üretim derlemesi ve üretim bağımlılık denetimi başarılı; bildirilen açık yok. Aşağıdaki v4 ve daha eski sonuçlar tarihsel kayıttır.

İlk 57 senaryolu ana koşuda 53 senaryo geçti. Kalıcı okunmamış sayaçları yüzünden değişen üç eski kanal seçicisi ve cihaz listesinin yüklenmesini beklemeyen bir görüşme testi düzeltildi; ilgili 7 görüşme ve 15 mesaj/kanal/işbirliği senaryosu yeniden geçti. Bu son gruba, ilk sayfadan daha eski bir yanıta verilen bağlantının tam yanıtı göstermesi de eklendi. Dört ek gizlilik testi açık arama ve entegrasyon ekranlarına geciken yanıtların iptal edilen erişimi geri getirmediğini doğrular.

İlk Linux CI koşusu altı kişilik görüşmede düğme etkileşimlerinin geciktiğini yakaladı. Katılımcı güncellemelerinin yerel ses analizini yeniden kurması kaldırıldı; destekleyen tarayıcılarda uzak ses seviyesi WebRTC alıcısından okunur. Chromium zaman damgası farkı ve eski tarayıcılar için Web Audio alternatifi ayrıca doğrulandı. Son odaklı koşuda 8 görüşme, değişmeden kalan altı kişilik medya/dayanıklılık ve gerçek hesap senaryosu birlikte **10/10** geçti; altı kişilik senaryo 21,0 saniyede tamamlandı. İki yeni birim testi eski ses ölçümünün konuşma göstergesini açık bırakmasını denetler. Hesap senaryosunun mesaj seçicisi de gönderilmiş mesajı yazma kutusundan ayıracak şekilde sınırlandırıldı.

30 kullanıcı, 600 mesaj ve 1.320 HTTP isteği içeren 30 saniyelik yerel yük kontrolünde hata, mesaj veya socket teslimatı kaybı görülmedi; veritabanı yeniden açıldığında 600 mesaj korundu. HTTP p95 yazma 41,76 ms, listeleme 38,36 ms, arama 91,24 ms; socket mesaj teslimatı p95 41,04 ms. Bu kısa kontrol kapasite garantisi değildir; ölçüm kapsamı ve donanım `artifacts/collaboration-load.json` içindedir.

Canlı geçişten önce **2026-09-07 18:40:04 UTC** tam yedeği alındı: `backup-20260907T184004Z-6023951e`. Doğrulanan paket ayrıca `/root/mola-verification/pre-collaboration-20260907/` dizinine korumalı olarak kopyalandı. Geçiş öncesi SQLite bütünlüğü `ok`, kayıtlar 1 kullanıcı, 1 çalışma alanı, 4 kanal; mesaj ve dosya yok. Geçiş öncesi/sonrası hash, commit ve dağıtım kanıtları Git dışında `artifacts/collaboration-release-proof.json` içinde tutulur.

İlk canlı v5 dağıtımı **19:01:58 UTC** tamamlandı. Korumalı yedekle salt okunur karşılaştırmada kullanıcılar, çalışma alanları, kanallar, mesajlar, dosyalar, üyelikler ve oturumlardaki eski kayıtların hiçbiri kaybolmadı veya değişmedi; yabancı anahtar hatası yok. Yedek sonrası kullanıcı tarafından oluşturulan `deneme` kanalıyla toplam 5 kanal var. Önceden açılmış kullanıcı oturumu ve sona erme zamanı korundu; güvenlik, bildirim, entegrasyon ve görüşme hazırlık ekranları canlı hesapla açıldı.

Bu Windows turunda Docker motoru yanıt vermediği için yerel Docker kabul paketi tekrarlanmadı. Linux Docker derlemesi ve Coolify kabul paketleri CI iş akışının parçasıdır. Web Push tarayıcı testleri kontrollü push hizmeti, görüşme testleri gerçek WebRTC üzerinde yapay medya kullanır; bu tur fiziksel cihaz veya gerçek push sağlayıcısına teslimat testi değildir.

| Özellik | Kabul kapsamı | İlgili testler |
| --- | --- | --- |
| Özel kanallar ve roller | Alan sahibi/yönetici/moderatör/üye/misafir sınırları; özel içerik için açık üyelik; misafir ataması; erişim iptalinde socket, görüşme, açık arama ve bekleyen entegrasyon sonucu temizliği | `channel-permissions.test.ts`, `channel-permissions.e2e.spec.ts`, `privacy-refresh.e2e.spec.ts` |
| Veri geçişi | v4 üyelik, oturum, mesaj, DM üyeliği korunur; yeni roller ve özellik tabloları tek transaction içinde oluşur; hata halinde rollback | `permissions-migration.test.ts`, `admin-migration.test.ts` |
| Bildirim ve okunmamışlar | Kullanıcı/workspace kapsamı, kalıcı okuma işaretleri, silinen mesaj sırası, erişim iptali ve push kuyruğunun tekrar yetkilendirilmesi | `collaboration-data.test.ts`, `collaboration.e2e.spec.ts` |
| Taslak, arama, bağlantı | Cihazlar arasında taslak sürümü ve çakışma seçimi; filtreli arama; mesaja kalıcı bağlantı | `collaboration-data.test.ts`, `collaboration.e2e.spec.ts`, `draft-isolation.e2e.spec.ts` |
| Görüşme deneyimi | İsteğe bağlı mikrofon testi, cihaz değişimi, konuşma seviyesi, bağlantı ölçümü, ekran büyütme ve ayrı pencere; özel oda roster izolasyonu | `call-quality.test.ts`, `voice-presence.test.ts`, `calls.e2e.spec.ts` |
| PWA ve cihaz bildirimi | Yükleme akışı; özel API/sohbetin service worker önbelleğine girmemesi; bildirimlerde içerik ve dış bağlantı izolasyonu | `pwa.test.ts`, `pwa.e2e.spec.ts` |
| Entegrasyonlar | Kanal kapsamlı ekip botu, GitHub kurulum bilgileri, webhook teslimatı/yineleme/anahtar değişimi/kapatma | `integrations.e2e.spec.ts`, ilgili sunucu testleri |
| Hesap güvenliği | TOTP kurulumu ve tekrar kullanım reddi, kurtarma kodları, oturum listesi ve oturum iptali | `account-security.test.ts`, `account-security.e2e.spec.ts` |

Yerel doğrulama komutları:

```sh
npm run typecheck
npm run build
npm test
npm run test:e2e
npm run test:auth
npm run test:admin
npm audit --omit=dev --audit-level=high
```

Odaklı erişim ve entegrasyon kontrolleri:

```sh
node --import tsx --test tests/channel-permissions.test.ts tests/permissions-migration.test.ts tests/admin-migration.test.ts
npx playwright test tests/channel-permissions.e2e.spec.ts tests/integrations.e2e.spec.ts tests/privacy-refresh.e2e.spec.ts
```

Tarayıcı testleri ayrı geçici veritabanı kullanır. Varsayılan Playwright sunucuları `127.0.0.1:3101` ve `127.0.0.1:5174` portlarını ayırır; aynı yapılandırmayı kullanan test komutlarını eşzamanlı başlatmayın. Ekran kanıtları Git dışında `artifacts/channel-access-{desktop,mobile}.png` ve `artifacts/integration-setup-{desktop,mobile}.png` konumlarına yazılır. Entegrasyon ekranındaki anahtar görüntü kanıtlarında maskelenir.

Üretim kabulünden önce SQLite ve dosyalarla birlikte anahtar materyalinin yedeği alınır. `MAIL_ENCRYPTION_KEY` kullanılıyorsa aynı değer korunur; yerelde oluşturulan `.account-security-key` dosyası yedek paketine dahildir. v5 veritabanına geçtikten sonra eski uygulama imajını tek başına geri açmak desteklenmez; geri dönüş eşleşen uygulama sürümü ve tutarlı yedekle yapılır. Kullanım: [COLLABORATION.md](COLLABORATION.md), [INTEGRATIONS.md](INTEGRATIONS.md), [call-experience.md](call-experience.md).

Google ile giriş bu sürümün kapsamına alınmadı; kullanıcı isteğiyle ertelenmiş durumda.

## Çoklu çalışma alanı ve sesli oda katılımcıları

Yeni sürüm aynı kimlikle birden fazla ekip üyeliği, davetle katılma, oturuma bağlı workspace geçişi ve sesli odalarda canlı katılımcı listesi ekler. Google ile giriş kullanıcı isteğiyle ertelendi. Kullanım ve şema v4 geçişi: [WORKSPACES.md](WORKSPACES.md).

| Kontrol | Sonuç |
| --- | --- |
| Sunucu testleri | **64/64** geçti; migration, üyelik/rol/oturum izolasyonu, özel mesajlar, gecikmiş yönetim istekleri ve canlı roster dahil |
| Ana tarayıcı akışları | **36 senaryo** hedefli koşularda doğrulandı; 5 mevcut görüşme testi, 5 yeni workspace testi, 1 taslak izolasyonu testi ve diğer 25 senaryo |
| Hesap / genel yönetim | **3/3 + 2/2** geçti |
| Veri geçişi | v1/v2/v3 → v4; kimlik, roller, mesaj, dosya, oturum süresi, davet, şifreli e-posta, özel indeks/tetikleyici korunur; yeniden açılış idempotent; eski ana workspace silinse de diğer üyelik/mesaj/oturum korunur |
| Sesli odalar | İki hesapla katılma/mikrofon/ayrılma güncellemeleri; DM ve diğer workspace görüşmeleri gizli; profil/rol güncellemeleri yansır |
| Workspace geçişi | Yeni alan, davet, tekrar giriş/yenileme, role göre yönetim erişimi; ayrı oturum bağımsızlığı; aynı çerezli sekmelerin eşitlenmesi; aktif görüşmede vazgeç/onay ve medya kaynaklarının kapanması |
| Erişilebilirlik ve görünüm | Liste/oluştur/katıl pencerelerinde ciddi/kritik axe ihlali yok; 1440×900 ve 390×844 ekranlar görsel olarak incelendi |
| Bağımlılıklar | `npm audit --omit=dev --audit-level=high`: bildirilen açık yok |

Toplam **105 uygulama testi** doğrulandı. TypeScript/Vite üretim derlemesi başarılı. İlk geniş tarayıcı koşusunda iki eski beklenti güncellendi: üyelik askısı artık global girişi engellemek yerine boş/erişimi kısıtlı bootstrap döndürür; kaydedilenler seçicisi yalnızca gezinmeyi hedefler. Liste rol yazısının kontrastı ve çalışma alanı geri açıldığında genel yönetim panelinin kapanması düzeltildi; ilgili kontroller tekrar geçti. Ana sohbet ve yanıt taslakları kullanıcıya bağlandı; aynı workspace'te farklı hesaba giriş, yazarın geri dönmesi ve workspace değişiminde taslak koruması ayrıca doğrulandı.

Ekran kanıtları (git dışında): `artifacts/workspace-{list,create,join}-{desktop,mobile}.png`, `artifacts/voice-sidebar-{desktop,mobile}.png`. Fiziksel cihazlarda yeni manuel görüşme testi yapılmadı; otomatik testler gerçek WebRTC bağlantısında tarayıcının test medya kaynaklarını kullanır.

Canlı geçiş öncesinde **2026-09-07 15:18:44 UTC** tam yedeği alındı ve SQLite/checksum doğrulamasından geçti. Yedek: `backup-20260907T151844Z-eb582ee1`; günlük saklama döngüsünden ayrı kopyası VPS üzerinde `/root/mola-verification/pre-workspaces-20260907/` altında tutulur. SMTP ve TURN bu değişiklikten önce canlıda doğrulanmıştı; aşağıdaki bölümler daha önceki yerel turların tarihsel kayıtlarıdır.

## Önceki yerel kontrollerin kapsamı

Aşağıdaki kayıtlar bu yeni sürümden önceki yerel Mola, ekip/genel yönetim, Docker, hesap kurtarma/doğrulama, yedekleme, izleme ve görüşme testlerine aittir. O aşamada dış sunucu ve sağlayıcılara henüz bağlanılmamıştı.

## Coolify paketi — son doğrulama

Coolify hazırlığı `compose.coolify.yaml`, ayrı isteğe bağlı `compose.coolify-turn.yaml`, `.env.coolify.example` ve [COOLIFY.md](COOLIFY.md) ile tamamlandı. Gerçek Coolify sunucusuna dağıtım yapılmadı. Mevcut `mola-local` konteynerleri ve kullanıcı verisi korunarak ayrı QA projeleri kullanıldı.

| Kontrol | Sonuç |
| --- | --- |
| Üretim derlemesi | TypeScript ve Vite başarılı |
| Sunucu testleri | **48/48**; yeni özel operasyon dinleyicisi, public yol izolasyonu, geçersiz port ve bind hatasında kapanma dahil |
| Ana tarayıcı akışları | **26 senaryo başarılı**; ilk koşuda 25 geçti, bir testte yazma kutusuyla gönderilmiş mesajı aynı anda eşleyen seçici düzeltildi ve ilgili senaryo yeniden geçti |
| Hesap / genel yönetim tarayıcı testleri | **3/3 + 2/2** başarılı |
| `npm run check:coolify` | **14/14** dağıtım kabul kontrolü başarılı; eksik ayar reddi, volume/ağ izolasyonu, doğrulanan yerel CA ile HTTPS/WSS, gerçek mesaj bildirimi, Secure/HttpOnly oturum, origin reddi |
| Yedek ve restore | Güncel QA imajında mesaj/dosya yedeği, checksum doğrulaması, kaynak silindikten sonra ayrı volume'a restore ve ikinci restart başarılı |
| İzleme ve restic | Üç hedef UP; kapalı restic sağlıklı bekliyor; etkin yerel şifreli depo, `check --read-data` ve dosya geri dönüşü başarılı |
| TURN | Sabit 4.17.2 imajında betik başlangıcı, PID sağlık kontrolü, doğrulanan TLS 1.2, eski TLS reddi, UDP STUN, kapalı CLI/DTLS denetlendi |
| Temizlik | Üç QA denemesinden kalan konteyner, volume ve ağ yok; kullanıcı uygulaması ve yedek servisi sağlıklı |

Toplam **79 uygulama testi**, ayrıca **14 Docker kabul kontrolü** geçti. Dağıtım provası CI iş akışına eklendi; bu yerel turda uzak CI çalıştırılmadı. Ayrı operations dinleyicisi yalnızca `OPS_PORT` tanımlandığında açılır; Coolify'de 9100, uygulamanın genel portu 3001'dir. Genel port geçerli operasyon anahtarıyla bile `/internal` için 404 döndürür. Yerel ve bağımsız Compose davranışı korunur.

TURN betiğinde gerçek başlangıçta ortaya çıkan eksik `max-bps` ve eski sürüme ait seçenekler düzeltildi. `NET_BIND_SERVICE` imaj dosyasının capability gereksinimi nedeniyle ayrı TURN paketine eklendi. TURN çalışma doğrulaması üretim betiğini kullanan eşdeğer izole `docker run` ile yapıldı; Compose dosyası ayrıca ayrıştırıldı. WAN relay ve fiziksel cihaz görüşmesi bu kontrol değildir.

Kanıtlar: `artifacts/coolify-smoke.json` (09:23:50–09:24:47 UTC), `artifacts/coolify-turn-proof.json`. QA uygulama imajı `sha256:5730d9442967ffb0462ccf386ce270182b5febd8e3dfe057a388e41a9d809102`, QA yedek imajı `sha256:9859b835aa518657527c24dafafafd2081125d69334feaeeda37d6f138c1ee58`. Aşağıdaki önceki yerel yönetim sürümünün imajı yeniden başlatılmadı. Harici DNS/HTTPS, SMTP, alarm, offsite sağlayıcısı ve gerçek cihaz kabulü hâlâ canlı kurulum adımlarıdır.

## Önceki yönetim sürümünün test sonuçları

| Kontrol | Sonuç |
| --- | --- |
| Üretim derlemesi | TypeScript ve Vite başarılı |
| npm test | **43/43** sunucu, güvenlik, yönetim, veritabanı ve yedekleme testi başarılı |
| npm run test:e2e | **26/26** Chromium testi başarılı |
| npm run test:auth | **3/3** hesap akışı ve mobil erişilebilirlik testi başarılı |
| npm run test:admin | **2/2** genel yönetim testi; gerçek CLI ataması, 28 alanla sayfalama/arama, erişim işlemleri, kendi alanını askıya alma/yenileme/geri açma |
| Ana kullanıcı akışları | Kayıt/giriş/davet, özel mesaj izolasyonu, kalıcılık, arama/yanıt, sabitleme/kaydetme/düzenleme/silme, dosya ve mobil görünüm |
| Hesap güvenliği | Zorunlu e-posta kapısı, tek kullanımlık/süreli belirteç, eşzamanlı sıfırlama, tüm oturumları kapatma, şifreli kuyruk ve yeniden başlatmada teslimat |
| Veri geçişi | v1/v2 → v3; hesap, oturum, davet, şifreli e-posta kuyruğu korunur; kendiliğinden yönetici atanmaz; daha yeni şema reddedilir |
| Erişilebilirlik | Ana 6 axe senaryosu, mobil kurtarma, ekip yönetimi ve genel yönetim masaüstü/mobil/onay/işlem ayrıntılarında ciddi/kritik ihlal yok |
| Bağımlılıklar | npm audit --omit=dev --audit-level=high: bildirilen açık yok |
| Alarm kuralları | Prometheus 11 kuralı kabul etti; gecikme/başlangıç toleransı ve kapalı harici yedek için 4 senaryo başarılı |
| Alarm yönlendirmesi | Yerel ve production Alertmanager yapılandırmaları amtool ile doğrulandı |
| Compose | Yerel/production ve isteğe bağlı TURN/restic profilleri yapılandırma doğrulamasından geçti; gerçek sağlayıcıya bağlanılmadı |

Tarayıcı hesap testleri gerçek API ve yerel e-posta çıktısıyla kayıt → doğrulama → parola kurtarma → yeniden giriş zincirini yürütür. E-posta bağlantısını açmak tek başına belirteci tüketmez. Belirtecin HTTP adreslerine taşınmadığı, yeniden kullanımın reddedildiği ve süresi dolmuş oturumdan giriş ekranına dönülebildiği kontrol edildi.

Yönetim testleri: sıradan üye/ekip sahibi/genel yönetici sınırları, başka çalışma alanına müdahalenin reddi, oturum ve görüşme iptali, mesaj/dosya koruma, arşivden okuma ve yazma engeli, davet iptali, parolayla sahiplik devri, CLI uygunluk ve son yönetici koruması. Yüklemesi sürerken askıya alınan hesap dosya veya veritabanı kaydı bırakamaz. CLI yetki iptali ile yönetim işleminin aynı anda gerçekleştiği senaryoda yetki transaction içinde yeniden kontrol edilir. Yönetici atama/kullanım rehberi: [ADMIN.md](ADMIN.md).

Toplam **74 test başarılı**. Toplu tarayıcı senaryoları tek IP'de hızlı çalıştığı için yalnızca `NODE_ENV=test` ve production kapalıyken 300–5000 aralığındaki `MOLA_TEST_API_LIMIT` uygulanır. Geçersiz değerler reddedilerek varsayılan kullanılır; production ve normal geliştirmede 301. isteğin 429 alması ayrıca doğrulanır. Üretim sınırı 300/dakika olarak kaldı.

Görüşme regresyonlarında arşivleme sonrası mikrofon/kamera/ekran kaynaklarının durması ve bağlantıların kapanması doğrulandı. Ağ kesintisinde panel yeniden katılma hedefini korur; düğme çevrimdışıyken kapalıdır, bağlantı gelince etkinleşir. Escape yalnızca en üstteki yönetim alt penceresini kapatır.

## Görüşme ve yük

Aşağıdaki 600 saniyelik yük ve yerel TURN ölçümleri yönetim paneli eklenmeden önceki sürüme aittir; bu turda uzun yük koşusu tekrarlanmadı. Güncel görüşme regresyonları ayrıca normal tarayıcı test paketinde çalıştırılır.

| Senaryo | Ölçülen sonuç |
| --- | --- |
| Altı ayrı üye | 15 bağlantı çifti / 30 WebRTC ucu; her üyeye diğer beş üyeden gerçek ses RTP aktarımı |
| Kamera + ekran | Diğer beş alıcıda iki ayrı görüntünün çözümlenmesi |
| Dayanıklılık | Yedinci üyenin reddi, üç ayrılma/katılma döngüsü, ağ kaybı sonrası cihaz temizliği ve yeniden katılma |
| Gerçek yerel TURN | 30 ucun tamamında seçilen yerel ve uzak ICE adayları relay; aynı medya ve dayanıklılık denetimleri başarılı |
| Son yük testi | **600 saniye, 30 kullanıcı, 7.500 mesaj, 16.500 HTTP isteği** |
| Gerçek zamanlı teslimat | **225.000/225.000**, kayıp/yineleme/hata yok |
| Yazma/listeleme/arama p95 | 111,76 / 152,16 / 426,48 ms |
| Bellek | Son koşuda tepe 238,55 MiB; son üç dakikanın ortalamaları 237,04 / 237,05 / 236,68 MiB |
| Ani süreç kapanışı | SQLite açıkken SIGKILL; 4.148.872 byte WAL üzerinden 7.500/7.500 mesaj geri açıldı, integrity_check=ok |

Önceki koşudaki bellek artışı üzerine sorgular için 128 kayıtla sınırlı prepared statement cache eklendi. Son koşuda başka ağır doğrulama işleri durduruldu. Hem kod hem arka plan yükü değiştiği için ölçümler yalnızca cache'in etkisini ayıran deney değildir. Son üç dakikadaki sabit seyir uzun vadeli bellek veya kapasite garantisi sayılmaz. Ayrıntılar ve tekrar üretme komutları: [PERFORMANCE.md](PERFORMANCE.md).

Ölçüm sonrasında yanıt sayımı için `messages(parent_id)` indeksi eklendi. Sorgu planı artık bu indeksi kullanır; 31 sunucu testi tekrar geçti. Tablodaki gecikmeler indeks öncesi ölçümdür.

## Docker ve işletim

- Derlenmiş arayüz, gerçek Mailpit SMTP teslimatı, e-posta doğrulaması ve yenileme sonrası mesaj kalıcılığı tarayıcıda geçti (artifacts/docker-account-smoke.json).
- Tam yedek SQLite ile dosya eklerini birlikte aldı. Canlı mesaj ve özgün ek silindikten sonra yedek yeni QA volume'una geri yüklendi; önceki oturumla mesaj ve 52 byte dosya indirildi. Geri yüklenen konteyner yeniden başlatıldığında veri korundu (artifacts/docker-ops-proof.json).
- Yarım gönderilmiş multipart yükleme sırasında alınan snapshot tutarlı kaldı. Aynı boyutlu bozuk içerik, eksik checksum, istenmeyen dosya ve sembolik bağlantılar reddedildi. Geri yükleme doğrulanmış geçici dizinden atomik yapılır.
- Zamanlayıcı, ayrı test servisinde 60 saniyelik ardışık yedek döngülerini tamamladı. Teslim edilen yerel servisin ayarları **86400 saniye / son 14 başarılı kopya / offsite kapalı**.
- Prometheus uygulama, yedek servisi ve Alertmanager'dan veri aldı; üç hedef UP. Test alarmı Alertmanager'dan Mailpit'e teslim edildi. Son uygulamada DB hazır, bekleyen/başarısız e-posta sıfır; veri diski metrikleri mevcut.
- Ayrı **yerel** restic deposuna şifreli yedekleme, saklama politikası, check --read-data ve geri yükleme başarılı. Bu, harici sağlayıcıya aktarımın doğrulandığı anlamına gelmez.
- Kullanıcının mola-local_mola_local_data volume'u korundu. QA restore/zamanlayıcı/restic/TURN servisleri ve volume'ları temizlendi.

Son yerel imaj `mola:local`, kimliği `sha256:6781c96c7f6d23473b3b5bd265b4813c52476a24c255d8a41e002222e4445710`. Yönetim güncellemesi öncesi `backup-20260907T081921Z-72d529ea` tam yedeği alındı. Aynı veri volume'unda şema 2'den 3'e yükseldi: **21 kullanıcı, 5 çalışma alanı, 65 mesaj** güncellemenin hemen öncesi ve sonrasında aynı kaldı; `integrity_check=ok`, yabancı anahtar hatası yok. Hiçbir hesap otomatik genel yönetici yapılmadı. Sonrasında önizleme için ayrı örnek ekip açıldı.

Uygulama ve yedek servisi sağlıklı; yeni imajla `backup-20260907T083221Z-e878493c` yedeği tamamlandı. Docker üzerinde yeni panel gerçek tarayıcıda açıldı. Önceki kapsamlı restore/yeniden başlatma provası yönetim panelinden önceki imaja aittir; güncel 43 sunucu testinde tam yedek/restore tutarlılığı tekrar geçti. Uygulama http://localhost:3000 adresinde çalışır.

## Açık dış adımlar

Canlı DNS/HTTPS ve gerçek SMTP teslimatı, TURN/TLS sertifikası ve dış ağ erişimi, harici yedek deposu, harici alarm alıcısı ve bağımsız uptime kontrolü için gerçek altyapı bilgileri gerekir. Kurulum dosyaları ve işlemler [DEPLOYMENT.md](DEPLOYMENT.md) ile [OPERATIONS.md](OPERATIONS.md) içinde hazırdır.

Medya denemeleri sanal kamera/mikrofon ve kontrollü canvas ekran kaynağı kullandı. Fiziksel kamera, mikrofon, işletim sistemi ekran seçicisi ve mobil operatör/ev/kurum ağları arasında görüşme henüz doğrulanmadı. Otomatik axe taraması tam manuel ekran okuyucu veya WCAG denetimi değildir. Mimari tek uygulama süreci ve küçük ekipler içindir; çoklu replika veya büyük toplantı kapasitesi iddiası yoktur.
