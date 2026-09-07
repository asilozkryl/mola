# Mola dağıtımı

**Coolify için:** [COOLIFY.md](COOLIFY.md) ve `compose.coolify.yaml` ayrı dağıtım yoludur. Aşağıdaki `compose.yaml` komutları bağımsız Caddy kurulumuna aittir.

Mola tek Node.js süreci, yerel SQLite ve en fazla 6 katılımcılı WebRTC mesh görüşmeleri için hazırlanmıştır. Yapılan kontroller [VERIFICATION.md](VERIFICATION.md), sürekli yedekleme/restore/izleme komutları [OPERATIONS.md](OPERATIONS.md) içindedir. Yerel testler gerçek sağlayıcı, alan adı veya fiziksel cihaz doğrulaması anlamına gelmez.

## Yerel kullanım

Node.js 24 gerekir. Kaynak üzerinden `npm ci` ve `npm run dev`: arayüz `http://localhost:5173`, API `http://localhost:3001`. Geliştirmede `APP_ORIGIN=http://localhost:5173`, `TRUST_PROXY=0` kullanılır. Çalışan SQLite verisini OneDrive veya ağ dosya sisteminde tutmayın; `DATA_DIR` ayrı bir yerel dizin olmalıdır. [SQLite WAL koşulları](https://www.sqlite.org/wal.html).

```sh
docker compose -f compose.local.yaml config --quiet
docker compose -f compose.local.yaml up --build -d
docker compose -f compose.local.yaml ps
```

Yerel Docker uygulama `http://localhost:3000`, Mailpit `http://localhost:8025`, Prometheus `http://localhost:9090`, Alertmanager `http://localhost:9093` adreslerindedir. Host portları yalnızca loopback'e bağlıdır. Gerçek yeni hesap e-posta doğrulaması ister; bağlantı Mailpit'e gelir. Demo bu kontrolden muaftır. SMTP `localhost:1025` üzerinden yerel testlere açıktır. Mailpit internete ileti göndermez; konteyner yeniden oluşturulunca kutu temizlenir. Veri `mola-local_mola_local_data` volume'unda, yedekler ayrı volume'da korunur. Güncellemede `down -v` kullanılmaz.

Yerel Docker `SERVE_STATIC=true` ile derlenmiş arayüzü sunar. `NODE_ENV=development` yalnızca localhost içindir; internete production dosyasıyla çıkılır.

## Production dış gereksinimleri

- Linux sunucusu, yerel kalıcı disk, alan adının A/AAAA kayıtları.
- Caddy için TCP80/443, HTTP/3 istenirse UDP443.
- TLS doğrulaması yapılabilen SMTP hesabı, doğrulanmış gönderen ve SPF/DKIM/DMARC.
- TURN alan adı, public IP, TLS sertifikası ve ortak sır.
- Alertmanager JSON kabul eden harici HTTPS alarm alıcısı.
- Ayrı sağlayıcı/hesapta restic deposu, parola ve erişim anahtarları; bağımsız uptime ve host/disk izleme.

`.env.example` dosyasını `.env` olarak kopyalayıp gerçek değerleri doldurun. `MAIL_ENCRYPTION_KEY` için 32 rastgele byte hex, TURN için en az32 karakter base64url üretin. Kuyruktaki e-postalar için mail anahtarını yedeklerle birlikte sır kasasında koruyun. Sırları kaynak kontrolüne eklemeyin. `APP_DOMAIN` hostname'dir; Compose origin'i `https://APP_DOMAIN` olarak belirler.

```sh
docker compose config --quiet
docker compose build --pull
docker compose up -d
docker compose ps
docker compose logs --tail=100 app caddy backups
```

Uygulama portu host'a yayınlanmaz. Caddy HTTPS sertifikasını alır, WebSocket yükseltmesini destekler ve `/internal` yolunu 404 ile engeller. Uygulama UID1000, salt okunur kök dosya sistemi, capability kaldırma ve kalıcı veri volume'u ile çalışır. `TRUST_PROXY=1` bu tek vekilli topolojiye özeldir; CDN/ek vekil eklenirse IP denetimini yeniden doğrulayın. [Caddy ters vekil](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).

Production başlangıcı HTTPS origin, TURN ve SMTP/mail anahtarı eksikse hata verir. Demo kapalıdır; doğrulanmamış gerçek hesap çalışma alanına erişemez. SMTP TLS sertifika doğrulaması production'da kapatılamaz. Oturumlar HttpOnly/SameSite=Lax/Secure çerezde ve SQLite'ta özet olarak tutulur; ayrıca `SESSION_SECRET` gerekmez. Mutasyon ve Socket.IO origin kontrolü etkindir.

Çoklu uygulama replikası çalıştırmayın: görüşmeler, Socket.IO odaları ve snapshot tutarlılığı tek sürece bağlıdır. Büyük görüşmeler SFU ve dağıtık koordinasyon gerektirir; TURN mesh'in 6 kişi sınırını artırmaz.

## Paketlenmiş TURN

`.env` içinde `TURN_REALM`, public IPv4 `TURN_PUBLIC_IP`, `TURN_SECRET`, `TURN_CERTS_PATH` ayarlayın:

```sh
docker compose --profile turn up -d
docker compose logs --tail=100 turn
```

Sertifika dizini `fullchain.pem` ve `privkey.pem` içermeli; coturn'un `nobody` kullanıcısı okuyabilmelidir. Dosyaları gerekli kullanıcı/grupla sınırlandırın. Sertifika yenilemesini sağlayıcıda kurun; yenileme sonrası `docker compose restart turn` yeni sertifikayı yükler. Caddy uygulama sertifikası TURN alan adını otomatik yönetmez.

Paket TCP/UDP3478, TLS TCP5349 ve UDP49160–49259 kullanır. Güvenlik duvarı/NAT'ta portları bire bir eşleyin. `TURN_URLS` aynı relay'i `turn:...:3478?transport=udp`, `turn:...:3478?transport=tcp`, `turns:...:5349?transport=tcp` olarak belirtir. Private/loopback/multicast hedefler engellenir. İmaj binary file capability nedeniyle yalnızca `NET_BIND_SERVICE` eklenir. Özel NAT topolojisinde coturn `external-ip=PUBLIC/PRIVATE` eşlemesini uyarlayın. [coturn seçenekleri](https://github.com/coturn/coturn/blob/master/examples/etc/turnserver.conf).

Paketlenmiş 4.17.2 sürümünde TLS en az 1.2, yönetim CLI'si ve DTLS varsayılan kapalıdır. Paylaşılan betik relay oturumu başına `max-bps=2500000` byte/s (20 Mbit/s), toplam `bps-capacity=100000000` byte/s sınırı uygular. Bunlar kapasite garantisi değildir; hedef görüntü kalitesi ve eşzamanlı görüşmelere göre ölçün. Önceki betikte toplam kapasiteyle birlikte zorunlu olan oturum sınırı eksikti; güncel betik gerçek konteyner başlangıcında doğrulandı.

Yalnızca TCP443 çıkışı olan ağlarda ayrı IP üzerinde TURN/TLS443 gerekebilir; aynı IP/port Caddy ile paylaşılamaz. Relay bandwidth, kota ve sertifika süresini izleyin. Yerel test relay'inin loopback izinleri production'da kullanılmaz.

## Dağıtım kabulü

HTTPS health başarılı olmalı. Gerçek hesap/e-posta doğrulaması/davet ve parola sıfırlamayı tamamlayın; sıfırlama sonrası eski parola/oturumların reddini kontrol edin. Mesaj/dosya ekleyip restart sonrası doğrulayın. Scheduler tam yedeğini ayrı veri volume'una restore edin. Prometheus hedefleri UP ve gerçek harici alarm teslimatı doğrulanmış olmalı.

İki fiziksel cihazı farklı ağlarda, biri mobil veri olacak şekilde görüşmeye alın. İki yönlü ses, kamera, ekran paylaşımı, izin reddi, tarayıcıdan paylaşımı durdurma, ağ kopması ve çıkışta donanımın bırakılmasını kontrol edin. `chrome://webrtc-internals` veya `about:webrtc` üzerinden seçili relay adayını doğrulayın. 6 katılımcı ve hedef eşzamanlı oda sayısında CPU/uplink/TURN kapasitesini ölçün. Sanal medya testleri gerçek donanım/ağ kabulünün yerine geçmez.

Ekran yakalama HTTPS/localhost ve tarayıcı kullanıcı seçimi ister; mobil destek farklıdır. Kurumsal SSO, çok bölgeli yüksek erişilebilirlik ve yasal saklama/moderasyon politikaları ayrıca değerlendirilmelidir.
