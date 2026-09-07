# Performans ve görüşme dayanıklılığı

Son ölçümden sonra yanıt sayımı için `messages(parent_id)` indeksi eklendi. `EXPLAIN QUERY PLAN`, tam tablo taraması yerine bu indeksi kullandığını doğruladı; 31 sunucu testi tekrar geçti. Aşağıdaki zaman/bellek ölçümleri bu indeks eklenmeden önce alınmıştır; indeks için ayrıca hızlanma oranı iddia edilmez.

Bu belge yerel olarak çalıştırılmış ölçümleri, tekrar üretme komutlarını ve henüz aynı koşullarda doğrulanmamış sınırları ayırır. Sonuçlar bir kapasite veya hizmet seviyesi garantisi değildir.

## HTTP ve Socket.IO yük ölçümü

### Güncel on dakikalık sonuç

Hazırlanmış SQL ifadeleri önbelleği eklendikten sonra **600 saniye, 30 eşzamanlı oturum, 7.500 mesaj** ile tekrar ölçüldü. Bu koşu boyunca diğer ajanlar Docker derlemelerini ve tarayıcı testlerini durdurdu; mevcut yerel uygulama konteynerleri çalışmaya devam etti. Ham sonuç: [`artifacts/load-10m-cached.json`](../artifacts/load-10m-cached.json).

| Ölçüm | Sonuç |
|---|---:|
| HTTP isteği / başarısız istek | 16.500 / 0 |
| Kalıcı mesaj | 7.500 |
| Beklenen / alınan Socket.IO bildirimi | 225.000 / 225.000 |
| Eksik / yinelenen bildirim | 0 / 0 |
| Mesaj yazma p50 / p95 / p99 | 16,52 / 111,76 / 248,20 ms |
| Mesaj listeleme p50 / p95 / p99 | 22,47 / 152,16 / 320,67 ms |
| Arama p50 / p95 / p99 | 114,52 / 426,48 / 554,36 ms |
| POST başlangıcından bildirime p95 | 111,20 ms |
| Sunucu olay döngüsü gecikmesi p95 / p99 / en yüksek | 32,13 / 59,11 / 606,08 ms |
| Sunucu CPU ortalaması, tek çekirdek oranı | %10,94 |
| Sunucu RSS başlangıç / bitiş / gözlenen en yüksek | 98,70 / 237,34 / 238,55 MiB |
| Ani kapanış sonrası bulunan mesaj | 7.500 |
| SQLite `integrity_check` | `ok` |

Sunucu RSS ortalaması 420–479 / 480–539 / 540–599 saniye aralıklarında sırasıyla **237,04 / 237,05 / 236,68 MiB** oldu. Böylece bu koşunun son üç dakikasında bellek sabit seyretti; bu sonuç günler süren kullanımın veya 30 dakikalık bir koşunun kanıtı değildir. Bildirim sayıları tam olarak doğrulanır; 225.000 teslimin gecikme yüzdelikleri 200.000 örneklik reservoir örneklemesinden hesaplanır.

SQLite hâlâ açıkken yalnızca testin oluşturduğu sunucu süreci `SIGKILL` ile sonlandırıldı. Sonlandırmadan önce WAL boyutu 4.148.872 bayttı; yeniden açılışta tüm mesajlar bulundu. İlk on dakikalık koşuda en yüksek RSS 374,35 MiB idi. Hem sorgu önbelleği hem de arka plan iş yükü değiştiğinden bellek ve gecikme farklarının tamamı tek bir değişikliğe atfedilemez.

Tekrar üretmek için:

```powershell
node --import tsx scripts/load-test.mjs --duration 600 --users 30 --messages 7500 --crash --output artifacts/load-10m-cached.json
```

### İlk iki dakikalık koşu

7 Eylül 2026 tarihli ilk koşu: **120 saniye, 30 eşzamanlı oturum, 1.500 mesaj**. Ham sonuç: [`artifacts/load-latest.json`](../artifacts/load-latest.json).

| Ölçüm | Sonuç |
|---|---:|
| HTTP isteği | 3.300 |
| Başarısız HTTP isteği | 0 |
| Ortalama istek hızı | 27,5/s |
| Kalıcı mesaj | 1.500 |
| Beklenen / alınan Socket.IO bildirimi | 45.000 / 45.000 |
| Eksik / yinelenen bildirim | 0 / 0 |
| Mesaj yazma gecikmesi p50 / p95 | 14,96 / 61,89 ms |
| Mesaj listeleme gecikmesi p50 / p95 | 17,45 / 62,65 ms |
| Arama gecikmesi p50 / p95 | 51,22 / 103,56 ms |
| POST başlangıcından bildirime p50 / p95 | 14,59 / 61,80 ms |
| Sunucu olay döngüsü gecikmesi p95 / p99 | 32,18 / 42,60 ms |
| Sunucu CPU ortalaması, tek çekirdek oranı | %7,79 |
| Sunucu RSS başlangıç / gözlenen en yüksek | 95,65 / 301,83 MiB |
| Veritabanı yeniden açıldığında mesaj | 1.500 |
| SQLite `integrity_check` | `ok` |

Makine: Windows 11, Intel Core Ultra 7 268V, 8 mantıksal işlemci; Node.js 24.19.0. Sunucu ve yük istemcisi ayrı Node süreçlerindedir. Gecikmeler aynı makinede HTTP ve WebSocket üzerinden ölçülür. CPU ve bellek tabloda yalnızca sunucu sürecine aittir. RSS beş saniyede bir ve bitişte örneklenir; aradaki çok kısa bellek zirvelerini yakalamayabilir. Olay döngüsü ölçerinin çözünürlüğü 20 ms'dir; Windows zamanlayıcı çözünürlüğü ölçüme etki eder.

### Nasıl çalışır?

```powershell
node --import tsx scripts/load-test.mjs --duration 120 --users 30 --messages 1500
```

- Yeni bir geçici dizin, SQLite veritabanı ve rastgele boş yerel port kullanır. Açık uygulamaya veya kullanıcının veritabanına bağlanmaz.
- Kurulumda kullanıcılar ve özetlenmiş oturum anahtarları eklenir. Ölçüm sırasında tüm yazma/listeleme/arama istekleri gerçek kimlik doğrulama, çalışma alanı erişimi ve Origin denetimlerinden geçer.
- Her kullanıcı bir Socket.IO bağlantısı açar. Mesajlar 30 kullanıcıya dağıtılır; her bildirim alıcı bazında sayılır, kayıp ve yineleme denetlenir.
- Her mesajın ardından listeleme, her beş mesajda bir arama yapılır. Kullanıcı başına tek HTTP işlem zinciri vardır; trafik süre boyunca dağıtılır.
- Üretimdeki hız sınırları değiştirilmez. Yalnızca izole sunucuda tek yerel proxy adımı yapılandırılır; her oturum `198.18.0.0/15` ölçüm aralığından ayrı bir kaynak IP başlığı kullanır. Böylece 30 kişi tek bilgisayarın IP kotası olarak sayılmaz. Bu, 30 gerçek dış ağı temsil eden bir ağ testi değildir.
- Sonunda bağlantılar kapatılır, SQLite kapatılıp tekrar açılır ve mesaj sayısı ile bütünlüğü doğrulanır. Geçici veriler temizlenir; rapor saklanır.

Sınırlar: 2–200 kullanıcı, 10–1.800 saniye, kullanıcı sayısı kadar en az ve toplam 20.000'e kadar mesaj. Yetkisiz veya başarısız istek, eksik/yinelenen bildirim, mesaj sayısı uyuşmazlığı, bütünlük hatası veya kesinti koşuyu başarısız yapar. Gecikme değerleri ayrıca raporlanır; `passed` tek başına bir gecikme SLO'su anlamına gelmez.

Parola türetme kapasitesi, TLS, gerçek ters proxy, internet gecikmesi, e-posta teslimi ve WebRTC medya trafiği bu HTTP senaryosunda ölçülmez. Oturumlar kurulumda eklenir; giriş yük testi olarak yorumlanmamalıdır.

### Daha uzun koşu

On dakikalık koşu ve sonunda ani süreç sonlandırması:

```powershell
node --import tsx scripts/load-test.mjs --duration 600 --users 30 --messages 7500 --crash --output artifacts/load-10m.json
```

Otuz dakikalık koşu:

```powershell
node --import tsx scripts/load-test.mjs --duration 1800 --users 30 --messages 20000 --output artifacts/load-30m.json
```

Bu komut 30 dakikalık bellek ve gecikme eğilimini ölçer. İlk iki dakikada çöp toplama görülse de RSS başlangıca göre arttı; **iki dakikalık koşu bellek kullanımının uzun vadede sabitlendiğini kanıtlamaz**. Yukarıdaki ilk ölçüm 30 dakikalık bir koşu olarak sunulamaz. Hedef sunucuda başka ağır testler çalışmazken aynı senaryoyu tekrar çalıştırın; donanım, sürüm ve ham JSON dosyasını birlikte saklayın.

### İlk on dakikalık koşu

[`artifacts/load-10m.json`](../artifacts/load-10m.json) 30 kullanıcıyla 7.500 mesaj, 16.500 HTTP isteği ve 225.000 bildirimi doğruladı. Hata, eksik veya yinelenen bildirim yoktu. Ani süreç sonlandırması sonrasında 4.144.752 baytlık WAL bulunan veritabanı açıldı; 7.500 mesajın tamamı bulundu ve bütünlük sonucu `ok` idi.

Bu koşu sırasında aynı bilgisayarda Docker işleri ve medya tarayıcı testleri de çalıştı. Yazma/listeleme/arama p95 değerleri sırasıyla 183,47 / 272,06 / 663,57 ms; olay döngüsü p95 33,44 ms, p99 94,63 ms ve en yüksek tek gecikme 3.575,64 ms idi. Başlangıç RSS 99,78 MiB, bitiş RSS 374,35 MiB oldu. Ortalama RSS 4–6. dakikalarda yaklaşık 308 MiB iken 9. dakikada 360 MiB'ye çıktı. Bu artış sorgu hazırlama nesnelerinin kullanımını incelemeyi gerektirdi; sonuç tek başına bir bellek sızıntısı tanısı değildir.

İnceleme sonrasında veritabanı katmanına en fazla 128 hazırlanmış SQL ifadesi tutan bir LRU önbelleği eklendi. Aynı SQL için yerel nesne tekrar kullanılır, her çağrıda parametreler yeniden bağlanır; uygulama kapandığında bağlantı ve tutulan nesneler serbest bırakılır. Ayrı bir regresyon testi tekrar kullanımı, sınırı, işlem geri almayı ve kapanışı doğrular. İlk koşuyla karşılaştırmada arka plan yükü de değiştiğinden gecikme farkının tamamı yalnızca önbelleğe atfedilemez.

## Altı katılımcılı medya dayanıklılığı

```powershell
npx playwright test resilience.e2e.spec.ts
```

İlk doğrudan bağlantı koşusu **21,3 saniyede geçti**. Yedi bağımsız tarayıcı bağlamında yedi ayrı hesap oluşturulur; aynı çalışma alanının altı üyesi görüşmeye katılır. Altı üye, **15 çift yönlü bağlantı / 30 RTCPeerConnection ucu** oluşturur. Yedinci kişinin katılımı reddedilir ve aldığı mikrofon hemen kapanır.

Doğrulanan davranışlar:

- Altı üyenin her biri diğer beş üyeden gerçek ses RTP paketleri alır.
- Bir üyenin kamera ve ayrı ekran akışı diğer beş üyede aynı anda çözümlenir (`framesDecoded > 0`).
- Tarayıcının ekran paylaşımını bitirmesi kamerayı kapatmaz.
- Bir üye üç kez ayrılıp tekrar katılır; her seferinde bağlantı sayısı ve cihaz temizliği doğrulanır.
- Bir bağlam çevrimdışı yapılır ve uygulamanın WebSocket taşıması kapatılır. Mikrofon/kamera/bağlantılar temizlenir; çevrimiçi dönüşten sonra yeniden katılım başarılı olur.
- Son ayrılmada tüm yakalanan medya izleri sonlanmış, tüm eş bağlantıları kapanmış olur.

Test başarılı olduğunda seçilmiş ICE aday türleri, gecikme ve bayt sayaçları `artifacts/media-mesh-direct.json` dosyasına yazılır. İlgili uçların taşıdığı ses ve çözümlenen video ayrıca test içinde denetlenir.

Tarayıcılar Chromium'un yapay mikrofon/kamera aygıtlarını ve hareketli bir canvas ekran kaynağını kullanır. Paketleme, WebRTC bağlantısı, kodlama, aktarım ve çözümleme gerçektir; fiziksel mikrofon, kamera ve işletim sistemi ekran seçicisi otomasyonu değildir.

GitHub CI'da yedi tarayıcı aynı makineyi paylaştığı için güncel altı kişilik senaryonun yapay kamera ve ekran kaynakları **640×360 / 10 fps** ile sınırlıdır. Tüm bağlantı, ses/video aktarımı ve yeniden katılma kontrolleri korunur; test bir görüntü kalitesi veya sunucu kapasitesi ölçümü değildir. İki tarayıcılı görüşme testi uygulamanın normal 720p kamera isteğini kullanmaya devam eder. Sonuç JSON'unda `syntheticVideoProfile` bulunur. Yukarıdaki ilk koşu süreleri bu profil değişikliğinden önceki ölçümlerdir.

## TURN üzerinden zorunlu aktarım

Test ortamında TURN sunucusu ve en az 30 eşzamanlı ayırmaya yetecek relay port aralığı gerekir. Gerçek uygulamanın `/api/rtc/config` uç noktası normal kimlik doğrulamasıyla kısa süreli TURN kimlik bilgilerini üretir.

```powershell
$env:TURN_URLS = 'turn:127.0.0.1:3478?transport=tcp'
$env:TURN_SECRET = '<yerel test TURN sunucusuyla aynı paylaşılan sır>'
$env:MOLA_TEST_FORCE_RELAY = 'true'
npx playwright test resilience.e2e.spec.ts
Remove-Item Env:MOLA_TEST_FORCE_RELAY
Remove-Item Env:TURN_SECRET
Remove-Item Env:TURN_URLS
```

`MOLA_TEST_FORCE_RELAY` sadece Playwright'ın başlatma betiğinde `iceTransportPolicy: relay` uygular; üretim uygulamasına test anahtarı eklemez. Test her seçilmiş çiftin hem yerel hem uzak aday türünün `relay` olduğunu zorunlu kılar. Sonuç dosyası `artifacts/media-mesh-relay.json` olur. TURN_URLS ve TURN_SECRET mevcut ortamda önceden tanımlıysa komut sonrasında eski değerlerini geri yükleyin.

**Yerel zorunlu relay koşusu geçti:** coturn 4.17.2-r0 üzerinde altı üyeli senaryonun tamamı 24,5 saniyede tamamlandı. Otuz bağlantı ucunun seçilmiş yerel ve uzak adayları `relay` olarak doğrulandı; ses, kamera, ekran çözümleme, ayrılma/katılma ve ağ kesintisi denetimleri de geçti. Ham kanıt: [`artifacts/media-mesh-relay.json`](../artifacts/media-mesh-relay.json).

Yerel test için Chromium'a `--allow-loopback-in-peer-connection` eklenir; bu anahtar yalnızca zorunlu relay testinde kullanılır. Chromium varsayılan olarak loopback arayüzünü eş bağlantılarının ağ listesine dahil etmez ([Chromium kaynak kodu](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/public/common/content_switches.cc)). Yerel coturn da loopback eşlerine izin verir. Bu iki ayar dış ağdaki üretim dağıtımının parçası değildir.

Yerel TURN aktarımı aynı makinedeki Docker/NAT düzenini doğrular. Kurumsal güvenlik duvarı, mobil operatör, ev interneti ve fiziksel cihazlar arasındaki davranışı ispatlamaz. Bu ağlarda gerçek ses duyulması, doğru ekranın paylaşılması, tarayıcı izinleri, cihaz değişimi ve uzun görüşme sırasında ağ değişimi ayrıca doğrulanmalıdır.

## Kalıcılık ve ani sonlandırma

Varsayılan yük koşusu kontrollü kapanış sonrasını kapsar. `--crash` eklendiğinde bütün HTTP yanıtları ve bildirimler alındıktan sonra sunucu kaynak ölçümünü bildirir; SQLite bağlantısını kapatmaz ve WAL checkpoint çağrısı yapmaz. Ana süreç yalnızca kendi oluşturduğu sunucu alt sürecini `SIGKILL` ile sonlandırır, sürecin çıktığını bekler ve veritabanını yeniden açar. Raporda sonlandırma sonucu, kapanmadan önceki WAL dosya boyutu, yeniden bulunan mesaj sayısı ve bütünlük sonucu saklanır.

Bu senaryo onaylanmış işlemlerin ani uygulama kapanışından sonra geri gelmesini sınar. Makine elektriğinin kesilmesini veya depolama aygıtının yazma önbelleğini temsil etmez. Yazma sırasında gerçekleşen güç kaybı ve yedekten geri yükleme farklı testlerdir; bunlar başarılı WAL açılışıyla aynı şey olarak raporlanmamalıdır.
