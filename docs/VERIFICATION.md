# Doğrulama — 7 Eylül 2026

Kapsam: yerelde çalışan Mola, ekip ve genel yönetim panelleri, Docker dağıtım paketi, hesap kurtarma/doğrulama, yedekleme, izleme ve görüşme dayanıklılığı. Gerçek alan adı, dış sunucu, SMTP sağlayıcısı veya harici yedek hesabına bağlantı yapılmadı. Coolify dağıtımı kullanıcı isteğiyle sonraya bırakıldı.

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
