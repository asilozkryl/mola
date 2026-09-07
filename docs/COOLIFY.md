# Mola — Coolify kurulumu

Bu paket, tek Linux sunucusunda **bir uygulama süreci** için hazırlanmıştır. Uygulama, günlük tam yedek, Prometheus, Alertmanager ve isteğe bağlı restic aynı kaynakta çalışır. Coolify HTTPS'i yönetir; bu pakette ayrıca 80/443 portlarını açan Caddy yoktur.

## 1. Kaynağı hazırlayın

GitHub kaynağı: [asilozkryl/mola](https://github.com/asilozkryl/mola), dal: `codex/initial-release`. Özel depoya Coolify GitHub App veya deploy key üzerinden okuma erişimi verin. `.env`, `data`, `backups`, `secrets` ve `artifacts` kaynak kontrolüne dahil edilmez. `.env.coolify.example` yalnızca adres ve boş sağlayıcı ayarlarını içerir. Yerel hesaplarınız ve mesajlarınız Git üzerinden taşınmaz; bunları korumak için aşağıdaki veri taşıma bölümünü izleyin.

Coolify'de Git kaynağından bir **Application** oluşturun:

| Alan | Değer |
| --- | --- |
| Build Pack | Docker Compose |
| Branch | `codex/initial-release` |
| Base Directory | `/` |
| Docker Compose Location | `/compose.coolify.yaml` |
| Raw Compose Deployment | Kapalı |
| Connect to Predefined Network | Kapalı; kaynak kendi ağını kullanır |
| Preserve Repository During Deployment | Açık; izleme yapılandırmaları ve restic betiği depodan bağlanır |
| Domains — app | `https://mola.psychodry.cloud:3001` |
| Diğer servislerin Domains alanları | Boş |

Bu kurulumun alan adı **`mola.psychodry.cloud`**. Domains alanındaki `:3001` konteynerin iç portudur; kullanıcı adresi `https://mola.psychodry.cloud` olur. Ortam değişkeni `APP_ORIGIN` da **`https://mola.psychodry.cloud`** olmalıdır. DNS kaydını sunucuya yönlendirin ve Coolify proxy'sinin 80/443 erişimini sağlayın. Kaynak: [Coolify Compose kurulumu](https://coolify.io/docs/applications/build-packs/docker-compose), [alan adı, özel servis ve değişken kuralları](https://coolify.io/docs/knowledge-base/docker/compose), [depo dosyalarının korunması](https://next.coolify.io/docs/applications/builds/docker-compose#storage).

Compose servisleri host portu yayınlamaz. `app` için yalnızca **3001** yönlendirilir. **9100** operations portunu, yedekleme, Prometheus, Alertmanager veya restic servisini internete açmayın. `app` ve `backups` aynı Dockerfile'dan kendi kaynaklarına ait imajları oluşturur; başka Coolify kaynaklarıyla paylaşılan `mola:local` etiketi kullanılmaz.

## 2. Ortam değişkenleri

`.env.coolify.example` alanlarını Coolify'nin **Environment Variables** ekranına aktarın. Tek değişken düzenleyicisinde **Name** alanına `APP_ORIGIN`, **Value** alanına yalnızca `https://mola.psychodry.cloud` yazın; `APP_ORIGIN=` önekini değere eklemeyin. Toplu Developer view ise `ANAHTAR=değer` satırlarını kabul eder. Gerçek sırları burada saklayın; uygulama derlemesinde `VITE_` değişkenlerine veya Dockerfile'a eklemeyin. Uygulama sırları çalışma zamanı içindir. Coolify'nin [ortam değişkeni belgesi](https://coolify.io/docs/knowledge-base/environment-variables) build/runtime ayrımını açıklar.

### Sağlayıcılar hazır olmadan ilk dağıtım

Coolify Compose varsayılanları `EMAIL_DELIVERY_ENABLED=false` ve `REQUIRE_TURN=false` değerleridir. İlk dağıtım için `APP_ORIGIN` zorunludur; `TURN_URLS`, `TURN_SECRET`, SMTP alanları, `MAIL_ENCRYPTION_KEY` ve `ALERT_WEBHOOK_URL` boş kalabilir. Coolify'nin daha önce oluşturduğu `Set ... in .env` örnek metinlerini **boş değerle değiştirin**; bunlar geçerli sağlayıcı bilgileri değildir.

- Uygulama ve günlük yedekleme açılır. Mevcut doğrulanmış hesaplar giriş yapabilir; mesajlaşma ve ekip yönetimi kullanılabilir.
- E-posta servisi kapalıyken production'da yeni hesap oluşturma ve doğrulama/parola yenileme e-postası isteme kapalıdır. E-posta doğrulaması atlanmaz, hesaplar otomatik doğrulanmaz. Boş veritabanında kullanabileceğiniz bir hesap için SMTP'yi bağlayın veya aşağıdaki doğrulanmış yerel hesabı taşıma akışını kullanın.
- TURN olmadan görüşmeler doğrudan WebRTC bağlantısını dener. Bazı mobil/kurumsal ağlarda görüşme veya ekran paylaşımı bağlanamayabilir; bu durum görüşme panelinde belirtilir.
- Prometheus ve Alertmanager çalışır. `ALERT_WEBHOOK_URL` boşken alarmlar dahili olarak görülebilir fakat dışarı bildirim gönderilmez. Harici yedekleme de `OFFSITE_ENABLED=false` iken bekler.

### Sağlayıcıları sonradan etkinleştirme

SMTP ve sabit `MAIL_ENCRYPTION_KEY` değerlerini tamamlayıp `EMAIL_DELIVERY_ENABLED=true` yapın. TURN adresi ve eşleşen en az 32 karakter sırrı ekleyip `REQUIRE_TURN=true` yapın. `ALERT_WEBHOOK_URL` hazırsa ekleyin. Aynı kaynağı yeniden dağıtın; kod değişikliği gerekmez. Geçersiz veya kısmen doldurulmuş TURN ayarları, isteğe bağlı modda da başlangıç hatası verir. SMTP yeniden etkinleştirildiğinde eksik/geçersiz SMTP ve şifreleme anahtarı ayarları da reddedilir. Sağlayıcılar bağlandıktan sonra gerçek e-posta ve farklı ağlarda görüşme kabulünü tamamlayın.

`compose.yaml` ile bağımsız dağıtımın varsayılanı değişmez: uygulama, bu iki seçenek açıkça kapatılmadıkça production'da SMTP ve TURN ister.

| Değişken | Gereken değer |
| --- | --- |
| `APP_ORIGIN` | Tek, HTTPS uygulama adresi; yol veya dahili port eklenmez |
| `EMAIL_DELIVERY_ENABLED` | İlk dağıtımda `false`; SMTP ve anahtar hazırken `true` |
| `REQUIRE_TURN` | İlk dağıtımda `false`; doğrulanmış relay hazırken `true` |
| `TURN_URLS`, `TURN_SECRET` | Birlikte boş bırakın veya erişilebilir relay adresleri ve eşleşen en az 32 karakter sır girin |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | E-posta etkinleştirildiğinde gerçek posta sağlayıcısı, giriş bilgileri ve doğrulanmış gönderen |
| `SMTP_PORT`, `SMTP_SECURE` | STARTTLS için `587` / `false`; doğrudan TLS için `465` / `true` |
| `MAIL_ENCRYPTION_KEY` | E-posta etkinleştirildiğinde 32 rastgele byte; hex biçiminde 64 karakter. Güncellemelerde sabit tutulur |
| `ALERT_WEBHOOK_URL` | İsteğe bağlı Alertmanager JSON kabul eden harici HTTPS alıcısı; genel Slack webhook'u aynı gövdeyi kabul etmez |
| `BACKUP_INTERVAL_SECONDS`, `BACKUP_KEEP` | Varsayılan günlük yedek / son 14 başarılı kopya |
| `OFFSITE_ENABLED` | Başlangıçta `false`; harici depo hazır olduğunda `true` |

Yeni kurulum anahtarlarını kendi terminalinizde üretin ve doğrudan Coolify ile sır kasanıza aktarın:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

İlk çıktı `MAIL_ENCRYPTION_KEY`, ikincisi kendi coturn'unuz için `TURN_SECRET` olabilir. Yönetilen relay kullanıyorsanız sağlayıcının **paylaşılan sır ile süreli kimlik üretimini** desteklemesi gerekir; statik kullanıcı/parola bu uygulamanın yapılandırmasıyla aynı değildir. SMTP gönderen alanının SPF/DKIM/DMARC ayarlarını sağlayıcıda tamamlayın.

`NODE_ENV=production`, doğrulama gerekliliği, demo kapatma, `PORT=3001`, `OPS_PORT=9100` ve `TRUST_PROXY=1` Compose içinde sabittir. Topoloji tarayıcı → Coolify proxy → app şeklindedir. CDN veya başka proxy eklerseniz IP aktarımı ve istek sınırlarını yeniden doğrulayın. Aynı SQLite volume'una ikinci uygulama replikası ya da önizleme ortamı bağlamayın.

## 3. TURN

Hazır bir relay kullanabilir veya **ayrı bir Coolify kaynağı** olarak `/compose.coolify-turn.yaml` dosyasını çalıştırabilirsiniz. Bu kaynak HTTP alan adı yönlendirmesi kullanmaz; TURN portları doğrudan sunucuya açılır.

Kendi relay'iniz için `TURN_REALM`, `TURN_PUBLIC_IP`, `TURN_SECRET` ve sunucudaki mutlak sertifika dizini `TURN_CERTS_PATH` gerekir. Dizin `fullchain.pem` ve `privkey.pem` içermeli; coturn kullanıcısı okuyabilmelidir. Ana uygulamayla aynı TURN sırrını kullanın. DNS, NAT/güvenlik duvarı ve sertifika yenilemesini sağlayıcıda ayarlayın. Portlar TCP/UDP **3478**, TCP **5349**, UDP **49160–49259**. Sertifika yenilendiğinde TURN servisini yeniden başlatın.

Coolify'nin uygulama HTTPS sertifikası TURN sertifikası yerine geçmez. Yalnızca TCP443 çıkışına izin veren ağlar için ayrı IP üzerinde TURN/TLS443 gerekebilir. Ayrıntılar [DEPLOYMENT.md](DEPLOYMENT.md#paketlenmiş-turn) içindedir.

Hostinger VPS ve Cloudflare DNS kullanan bu kurulum için [SMTP, DNS-01 sertifikası ve otomatik TURN yenileme rehberi](HOSTINGER.md) hazırdır. `ops/turn-cert-deploy.sh` yalnız belirlenmiş TURN kaynağının doğrulanmış sertifika çiftini yayınlar; Coolify proxy'sini değiştirmez.

## 4. İlk açılış ve yönetici

Deploy sonrasında uygulama ve yedek servisi sağlıklı olmalı. Tarayıcıda `/api/health` için `{"status":"ok"}`, `/internal/metrics` için **404** beklenir. Prometheus dahili `app:9100` adresinden yetkili veri toplar. Normal ağda operations portuna yetkisiz istek **401** döner.

Yeni boş veritabanında, SMTP etkinleştirildikten sonra hesabınızı oluşturup e-postanızı doğrulayın. Coolify'nin **app konteyner terminalinde** çalıştırın:

```sh
npm run admin -- grant --email KENDI_EPOSTANIZ
```

Yetki ataması açık oturumları kapatır. Yeniden girişten sonra **Profil ayarları → Yönetim panelini aç → Genel yönetim** açılır. Yerel veritabanını taşıdıysanız mevcut yönetici yetkisi de yedekte korunur; yeniden atama gerekmez. Hiçbir e-posta dağıtım dosyasına otomatik yönetici olarak eklenmez.

## 5. Yedekleme, veri taşıma ve güncelleme

`mola_data`, `mola_backups`, `mola_backup_status`, `mola_ops_secrets`, `mola_prometheus` ve `mola_alertmanager` kalıcı named volume'lardır. Coolify bunları kaynağına bağlar. Aynı kaynağı yeniden dağıtın; yeni kaynak oluşturmanın veya storage silmenin mevcut veriyi taşıyacağını varsaymayın. `down -v` ve volume silme işlemlerini canlı kaynakta kullanmayın.

Coolify'nin **backups konteyner terminalinde** anlık tam yedek:

```sh
node scripts/backup-runner.mjs --once
node -e "console.log(require('node:fs').readdirSync('/backups').join('\n'))"
node scripts/backup-runner.mjs --verify /backups/BACKUP_ADI
```

Yereldeki hesabı ve mesajları taşımak için yerel tam yedeği alın, doğrulayın ve özel bir konuma kopyalayın:

```sh
docker compose -f compose.local.yaml exec backups node scripts/backup-runner.mjs --once
docker compose -f compose.local.yaml exec backups node scripts/backup-runner.mjs --verify /backups/BACKUP_ADI
docker compose -f compose.local.yaml cp backups:/backups/BACKUP_ADI ./backups/BACKUP_ADI
```

Yedeği güvenli kanalla hedef sunucuya aktarın. Uygulamayı ve scheduler'ı durdurun, mevcut veriyi koruyun; geri yüklemeyi **yeni boş bir hedefe** `node scripts/restore-backup.mjs BACKUP_DIZINI YENI_VERI_DIZINI` ile yapın. Geri yükleyici hedefin yanında geçici dizin oluşturup atomik taşıma yapar; bir volume'un kök mount noktasını doğrudan hedef seçmeyin. Gerekirse volume'u üst dizine bağlayıp altındaki boş `data` dizinine geri yükleyin, sonra uygulamanın `/app/data` bağlantısını bu dizine yöneltin. UID/GID `1000:1000` olmalı. Doğrulanmış yeni veriye geçmeden önce kaynak/volume eşleşmesini denetleyin.

**Uygulama ve yedek servisi aynı geri yüklenen dizini görmelidir.** Örneğin yeni volume'un içindeki `data` alt dizinini kullanıyorsanız volume'u uygulamada `/app/data`, yedek servisinde `/source:ro` konumuna bağlayıp `app.DATA_DIR=/app/data/data` ve `backups.SOURCE_DATA_DIR=/source/data` olarak Compose içinde birlikte ayarlayın. Alternatif olarak aynı alt dizini iki servise de mount edin. Yalnızca uygulamanın yolunu değiştirmek sonraki yedeklemeleri bozar. Yeni kurulumda dosyadaki varsayılan kök yolları kullanılır; bu değişiklik yalnızca alt dizine restore yaklaşımına aittir.

Yerel yedekteki `.mail-key` 32 byte ikili anahtardır. Taşıma sırasında bu **aynı anahtarın hex karşılığını** production `MAIL_ENCRYPTION_KEY` sırrı olarak kullanın; içeriğini sohbete veya loglara yazmayın. Yerel doğrulama/kurtarma bağlantıları eski localhost adresine aittir; canlıya geçince bekleyen hesaplar yeni bağlantı istemelidir. Giriş, yönetici erişimi, eski mesajlar ve dosya indirmeyi doğrulayın. Ayrıntılı restore ve geri dönüş işlemleri [OPERATIONS.md](OPERATIONS.md) içindedir.

Harici kopya için `RESTIC_REPOSITORY`, `RESTIC_PASSWORD` ve sağlayıcı erişimini girip `OFFSITE_ENABLED=true` yapın. S3 için `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, gerektiğinde `AWS_DEFAULT_REGION` kullanılır. Bu parolayı yedeklerle birlikte ayrı sır kasasında saklayın. Yeniden dağıtım sonrasında **restic konteyner terminalinde**:

```sh
restic snapshots
restic check --read-data
```

Ayrı bir staging ortamında harici kopyadan geri dönüşü de deneyin. Yerel volume yedeği, sunucu kaybına karşı harici yedek sayılmaz. `OFFSITE_ENABLED=false` iken restic beklemede ve sağlıklı görünür; bu durumda harici aktarım yapılmaz. Alarmlar bu ayrımı bilir.

Güncelleme öncesi tam yedek alın, sonra aynı Coolify kaynağını yeniden dağıtın. Şema değişmişse yalnızca eski imajı seçmek yeterli olmayabilir; uygun sürümün veri yedeği gerekir. Tek süreçli mimari nedeniyle dağıtım sırasında kısa kesinti planlayın. [Coolify güncelleme davranışı](https://coolify.io/docs/knowledge-base/rolling-updates).

## 6. Canlı kabulü

- Gerçek e-posta doğrulaması ve parola sıfırlama; eski oturumun kapanması.
- İki fiziksel cihazda, biri mobil veri kullanırken iki yönlü ses, kamera, ekran paylaşımı ve ağ kesintisinden geri dönüş.
- Yeni mesaj/dosyanın yeniden dağıtım sonrası korunması; ayrı staging ortamına tam yedekten geri dönüş.
- Prometheus'ta üç hedefin UP olması; gerçek harici alarmın ulaşması; bağımsız HTTPS uptime kontrolü.
- Hedef sunucuda en fazla 6 katılımcı ve beklenen eşzamanlı oda sayısıyla CPU, bellek ve relay bant genişliği ölçümü.

Yerel paket provası için `npm run check:coolify` kullanılır. Sağlayıcısız ilk kurulum provası `npm run check:coolify -- --deferred` ile çalışır. Bu komutlar ayrı QA Compose projeleri oluşturur; gerçek sağlayıcılara bağlanmaz. Canlı Coolify arayüzü, gerçek SMTP/TURN sağlayıcısı ve fiziksel cihaz kabulü bu prova tarafından yapılmış sayılmaz.
