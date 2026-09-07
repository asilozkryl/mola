# Hostinger SMTP ve TURN kurulumu

Bu rehber Mola'nın `mola.psychodry.cloud` adresindeki Coolify kurulumu içindir. Hedef VPS Ubuntu 24.04.3, public IPv4 `72.62.234.232` olarak doğrulandı. IP taşınırsa DNS ve TURN ayarlarını birlikte güncelleyin. Aşağıdaki komutlar **VPS host terminalinde** çalışır; uygulama konteynerinde veya yerel Windows terminalinde çalıştırılmaz. Bu dosya bir kurulum rehberidir; canlı SMTP teslimatı veya TURN kabulünün tamamlandığı anlamına gelmez.

## Hostinger e-posta

Ana Mola kaynağının çalışma zamanı değişkenleri:

```dotenv
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=asilo@psychodry.cloud
MAIL_FROM=Mola <admin@psychodry.cloud>
```

Hostinger panelinde `admin@psychodry.cloud`, `asilo@psychodry.cloud` posta kutusunun takma adresi (alias) olarak doğrulandı. SMTP oturumu ana posta kutusu olan `asilo@psychodry.cloud` ve onun parolasıyla açılır; `MAIL_FROM` gönderen adresi `admin@psychodry.cloud` olarak kalır.

`SMTP_PASS`, `asilo@psychodry.cloud` posta kutusunun mevcut parolasıdır; Hostinger panel giriş parolası değildir. Parolayı doğrudan Coolify'nin gizli değişken alanına girin. `MAIL_ENCRYPTION_KEY` yeni kurulumda 32 rastgele byte'ın 64 karakter hex karşılığıdır; sonraki dağıtımlarda değiştirmeyin ve ayrı sır kasasında saklayın. Yerel veriyi taşıyacaksanız [mevcut mail anahtarını koruyun](COOLIFY.md#5-yedekleme-veri-taşıma-ve-güncelleme). Sırları Git'e, Dockerfile'a veya `VITE_` değişkenlerine koymayın; build loglarına aktarılmasını engelleyin.

Tüm değerler hazırken `EMAIL_DELIVERY_ENABLED=true` yapıp aynı kaynağı yeniden dağıtın. Hostinger panelindeki **Domain ayarları** ekranının gösterdiği MX/SPF/DKIM/DMARC kayıtlarını Cloudflare'da doğrulayın. Var olan SPF kaydına ikinci bir SPF eklemeyin; mevcut DMARC politikasını daha zayıf bir örnekle değiştirmeyin. Kullanıcının kendi adresinde kayıt/doğrulama ve parola sıfırlama akışlarını deneyin; `/api/config` içindeki `emailDeliveryAvailable=true` yalnız yapılandırmayı gösterir, gelen kutusuna teslimatı ispatlamaz. [Hostinger'ın resmi SMTP ayarları](https://www.hostinger.com/support/1575756-how-to-get-email-account-configuration-details-for-hostinger-email/).

## TURN DNS ve ağ

Cloudflare'da yalnız aşağıdaki relay kaydını oluşturun/düzeltin:

| Tür | Ad | İçerik | Proxy |
| --- | --- | --- | --- |
| A | `turn` | `72.62.234.232` | **DNS only** (gri bulut) |

`turn.psychodry.cloud` için çakışan CNAME/A veya çalışmayan AAAA kaydı bulunmamalı. `mola`, `coolify` ve diğer uygulamaların mevcut Tunnel yönlendirmeleri korunur. Dış DNS sorgusunda relay adı Cloudflare edge IP'lerini değil VPS IP'sini döndürmelidir. Cloudflare'ın HTTP proxy/Tunnel yolu WebRTC'nin doğrudan TURN trafiğini taşımaz. [Cloudflare port belgesi](https://developers.cloudflare.com/fundamentals/reference/network-ports/).

Hostinger firewall ve VPS firewall üzerinde TCP/UDP **3478**, TCP **5349**, UDP **49160–49259** erişimini sağlayın. Mevcut SSH ve Coolify erişim kurallarını koruyun. Docker yayınlanan portları kendi firewall zincirleriyle yönettiği için yalnız UFW durumuna bakarak erişimin kapalı olduğunu varsaymayın. NAT varsa dış/iç relay portlarını bire bir eşleyin. Bu paket TCP443 ile sınırlı ağların tamamına erişim garantisi vermez; böyle ağlar için ayrı IP üzerinde TURN/TLS443 veya uyumlu yönetilen relay gerekir. [coturn ağ ayarları](https://github.com/coturn/coturn/blob/master/examples/etc/turnserver.conf).

Başlangıç betiği konteynerin kendi IPv4 adresini her açılışta `hostname -i` ile bulur, çekirdeğin `/proc/net/fib_trie` içindeki yerel adresleriyle doğrular ve `relay-ip=KENDI_IP` ile `external-ip=PUBLIC_IP/KENDI_IP` üretir. Coturn bu açık eşlemenin yalnız kendi adresini özel ağ engelinden muaf tutar; aynı sunucudaki iki relay oturumu böylece birbirine erişebilir. Diğer özel ağ, loopback ve metadata adresleri engelli kalır. Birden fazla uygun IPv4 bulunursa betik tahminde bulunmadan durur. Konteyner IP'sini değişkene sabitlemeyin; yeniden dağıtımda değişebilir. [Coturn'un eşleme davranışı](https://github.com/coturn/coturn/blob/4.17.2/src/apps/relay/mainrelay.c).

## DNS-01 ile güvenilir sertifika

Certbot DNS-01, Coolify'nin 80/443 portlarını veya proxy sertifikalarını değiştirmeden `turn.psychodry.cloud` için Let's Encrypt sertifikası alır. Cloudflare Origin CA sertifikası doğrudan tarayıcı TURN bağlantısı için kullanılmaz. [Let's Encrypt doğrulaması](https://letsencrypt.org/docs/challenge-types/), [Origin CA güven sınırı](https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/).

Ubuntu host üzerinde:

```sh
sudo apt-get update
sudo apt-get install -y certbot python3-certbot-dns-cloudflare openssl
sudo install -d -m 0700 /root/.secrets/certbot
sudo install -d -m 0750 /etc/mola-turn
```

Cloudflare'da yalnız `psychodry.cloud` bölgesi için **Zone / DNS / Edit** kapsamlı API token oluşturun. Global API key kullanmayın. Token'ı root terminalinde sessiz girişle dosyaya alın; komut satırına literal değerini yazmayın:

```sh
sudo -i
umask 077
read -rsp 'Cloudflare DNS token: ' mola_cf_token
printf '\n'
printf 'dns_cloudflare_api_token = %s\n' "$mola_cf_token" > /root/.secrets/certbot/cloudflare.ini
unset mola_cf_token
chmod 0600 /root/.secrets/certbot/cloudflare.ini
```

Bu credential dosyası sadece Certbot tarafından okunur; coturn'a veya Mola'ya mount edilmez. Token süresi dolarsa otomatik yenileme başarısız olur; token ömrünü ve yenileme hatalarını izleyin. [Certbot Cloudflare eklentisi](https://certbot-dns-cloudflare.readthedocs.io/en/stable/).

## Sertifika yayını ve ayrı Coolify kaynağı

Coolify'de aynı depodan **ayrı Application / Docker Compose** kaynağı hazırlayın. Compose yolu `/compose.coolify-turn.yaml`, Preserve Repository açık, HTTP Domains alanı boş olsun. Ana uygulamanın Compose yolunu değiştirmeyin.

Host üzerinde güvenilir depo checkout'undan hook'u yükleyin; aşağıdaki göreli kaynak yolu bu checkout içinden çalıştırılır:

```sh
sudo install -o root -g root -m 0755 ops/turn-cert-deploy.sh /usr/local/sbin/mola-turn-cert-deploy
sudoedit /etc/mola-turn/cert-deploy.conf
sudo chmod 0600 /etc/mola-turn/cert-deploy.conf
```

Config dosyası tek satır içerir; değeri **TURN kaynağının tam Compose project adı** ile değiştirin:

```sh
TURN_COMPOSE_PROJECT=COOLIFY_TURN_COMPOSE_PROJECT
```

Bu ad ana Mola kaynağının adı veya görünen kullanıcı dostu başlık değildir. Coolify'nin bu kaynak için ürettiği Compose proje adını kontrol edin; ilk çalışmadan sonra `com.docker.compose.project` etiketiyle eşleştiğini doğrulayın. Hook, bu proje etiketi **ve** `com.docker.compose.service=turn` etiketi eşleşen tek çalışan konteyneri seçer. Belirsiz eşleşmede hiçbir konteyneri yeniden başlatmaz.

İlk sertifikayı alın; Certbot'un hesap e-posta/TOS sorularını terminalde tamamlayın:

```sh
sudo certbot certonly --dns-cloudflare \
  --dns-cloudflare-credentials /root/.secrets/certbot/cloudflare.ini \
  --dns-cloudflare-propagation-seconds 60 \
  --cert-name turn.psychodry.cloud -d turn.psychodry.cloud \
  --deploy-hook /usr/local/sbin/mola-turn-cert-deploy
```

Hook yalnız `/etc/letsencrypt/live/turn.psychodry.cloud` lineage'ını kabul eder. Sertifika zinciri, hostname, geçerlilik ve private key eşleşmesini doğrular. Dosyaları `/data/mola-turn/certs/versions/<digest>` altında root:65534, dizinleri0750 ve dosyaları0640 olarak oluşturur. `fullchain.pem` ve `privkey.pem` aynı atomik değişen `current` bağlantısı üzerinden okunur. Eski sürümler geri dönüş için korunur. Certbot'un `live/` dizinini tek başına coturn'a mount etmeyin; içindeki bağlantıların hedefleri `archive/` dizinindedir. Önceden elle yerleştirilmiş dosyalar varsa hook onları değiştirmez; önce güvenli yedek alıp ayrı boş hedef hazırlayın.

İlk kurulumda çalışan TURN konteyneri bulunmaması normaldir: hook sertifikayı hazırlar. Sonraki etkin yenilemede kayıp/çoklu konteyner, geçersiz sertifika veya başarısız Docker erişimi hata verir. Coolify TURN kaynağındaki değişkenler:

```dotenv
TURN_REALM=turn.psychodry.cloud
TURN_PUBLIC_IP=72.62.234.232
TURN_SECRET=<ana Mola kaynağıyla aynı güçlü sır>
```

Sertifika bind kaynağı Compose dosyasında `/data/mola-turn/certs` olarak sabittir ve hook'un hedefiyle aynıdır. Coolify 4.3.17 bu kaynakta `${...}` değişken ifadesini reddettiği için `TURN_CERTS_PATH` tanımlamayın. Dizin hook tarafından dağıtımdan önce hazırlanmış olmalıdır.

Sırrı örneğin 48 rastgele byte base64url veya 32 rastgele byte hex olarak üretin ve doğrudan iki kaynağın sır alanlarına aktarın. TURN kaynağını dağıtın. Host terminalinde yalnız bu kaynağın konteynerini belirleyip proje etiketini config ile karşılaştırın:

```sh
docker ps --filter label=com.docker.compose.service=turn --format '{{.ID}} {{.Names}}'
docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' TURN_KONTEYNER_ID
sudo env RENEWED_LINEAGE=/etc/letsencrypt/live/turn.psychodry.cloud /usr/local/sbin/mola-turn-cert-deploy
```

Son komut ilk etkinleştirme kaydını oluşturur. Hook yeni sertifikada yalnız seçilmiş TURN konteynerini yeniden başlatır ve sağlığını bekler; başarısızlıkta önceki sertifika bağlantısına döner ve eski sürümle yeniden başlatmayı dener. Etkinleştirme kaydı sertifika özetiyle birlikte konteynerin tam ID'sini içerir. Aynı sertifika ve aynı sağlıklı konteyner tekrar geldiğinde yeniden başlatmaz; kayıp veya sağlıksız konteynerde hata verir. Konteyner değişmişse yeni konteyneri yeniden başlatıp sağlığını doğrular. Yenileme kısa görüşme kesintisine yol açabilir; SIGUSR2 ile sıcak yenileme bu hook'ta etkin değildir. PID sağlık kontrolü dış ağ TLS/medya kabulünün yerine geçmez.

Otomatik yenilemeyi ve deploy hook'u test edin:

```sh
sudo systemctl enable --now certbot.timer
systemctl list-timers certbot.timer
sudo certbot renew --cert-name turn.psychodry.cloud --dry-run --run-deploy-hooks
```

`--run-deploy-hooks` başarılı dry-run sonrasında mevcut güvenilir sertifika ile hook'u çalıştırır; geçici staging sertifikasını yayına koymaz. Timer/Certbot hatalarını host izleme sisteminize dahil edin. Hook başarısızlığı Certbot'un sertifika dosyalarını geri almaz: düzeltmeden sonra yukarıdaki `RENEWED_LINEAGE=...` komutuyla yayını tekrar deneyin. Eski sertifika sürümlerini otomatik silmez; disk temizliğinde `current` hedefini ve geri dönüş sürümünü koruyun. [Certbot yenileme ve deploy hook davranışı](https://eff-certbot.readthedocs.io/en/stable/using.html).

## Uygulamaya bağlama ve kabul

Relay hazır olduğunda ana Mola kaynağına aşağıdaki adresleri ve eşleşen sırrı ekleyip yeniden dağıtın:

```dotenv
TURN_URLS=turn:turn.psychodry.cloud:3478?transport=udp,turn:turn.psychodry.cloud:3478?transport=tcp,turns:turn.psychodry.cloud:5349?transport=tcp
TURN_SECRET=<TURN kaynağıyla aynı sır>
REQUIRE_TURN=true
```

Dış ağdaki bir terminalden sertifika zinciri ve hostname doğrulaması:

```sh
openssl s_client -connect turn.psychodry.cloud:5349 \
  -servername turn.psychodry.cloud -verify_hostname turn.psychodry.cloud \
  -verify_return_error </dev/null
```

Uygulamanın kısa süreli TURN kimliklerini kullanarak üç URL'yi ayrı ayrı sınayın; tarayıcıya ortak `TURN_SECRET` verilmez. Bir relay adayı oluşması yalnız allocation adımını gösterir. İki farklı ağdaki fiziksel cihaz arasında zorunlu relay kullanarak iki yönlü ses, kamera ve ekran paylaşımını deneyin; seçilmiş ICE adayının `relay` olduğunu ve medya byte sayaçlarının arttığını doğrulayın. Mobil veri, paylaşımı tarayıcıdan durdurma ve ağ değişimini de deneyin. [WebRTC Trickle ICE örneği](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/).
