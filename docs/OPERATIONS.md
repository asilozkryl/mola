# Mola işletim rehberi

Coolify dağıtımında [COOLIFY.md](COOLIFY.md) içindeki konteyner terminali komutlarını kullanın. Bu pakette `OPS_PORT=9100` operations uçlarını ayrı HTTP dinleyicisine taşır: uygulamanın 3001 portunda `/internal` istekleri 404, özel portta anahtarsız istekler 401 döner. Yedek servisi ve Prometheus `app:9100` kullanır. `OPS_PORT` tanımlanmadığında mevcut yerel/bağımsız Caddy kurulumu aynı şekilde çalışır.

Yerel Docker kurulumu uygulama, Mailpit, periyodik tam yedekleme, Prometheus ve Alertmanager servislerini birlikte çalıştırır. Yerel arayüzler yalnızca loopback adreslerine bağlıdır: uygulama `http://localhost:3000`, e-posta kutusu `http://localhost:8025`, metrikler `http://localhost:9090`, alarmlar `http://localhost:9093`. Mailpit gerçek SMTP kabul eder; iletiler internete gönderilmez ve konteyner yeniden oluşturulunca silinir. Üretim SMTP ve harici alarm alıcısı `.env` üzerinden ayrıca sağlanır.

```sh
docker compose -f compose.local.yaml up --build -d
docker compose -f compose.local.yaml ps
docker compose -f compose.local.yaml logs --tail=100 backups
```

## Zamanlanmış tam yedek

`backups` servisi başlangıçta ve varsayılan olarak her 86.400 saniyede bir çalışır. `BACKUP_INTERVAL_SECONDS` 60–604800, `BACKUP_KEEP` 1–3650 aralığındadır; varsayılan son 14 başarılı tam yedektir. Başarısız denemeler 5 dakika içinde tekrar edilir ve konteyner sağlıksız olur. Başarı zamanı ve hata sayısı kalıcı status volume'unda tutulur. `.partial-*` dizinleri tamamlanmış yedek sayılmaz. Güncelleme sırasında volume silinmez; `down -v` kullanılmaz.

Zamanlanmış ve elle başlatılan işler aynı atomik `.backup-lock` dizinini kullanır; retention başka bir aktif işin yeni yedeğini silemez. Süreç zorla öldürülürse kilit otomatik eskimiş sayılmaz. Aktif yedek işi olmadığını doğrulayın, `owner.json` başlangıç bilgisini inceleyin ve yalnızca bu kilidi kaldırıp servisi tekrar başlatın. Kilit kaynaklı başarısızlık health ve alarm kurallarına yansır.

Çökmüş worker kilidini kurtarmak için scheduler'ı durdurun; ayrıca elle başlatılmış `--once` komutlarının tamamlandığını/sonlandığını doğrulayın. `docker compose ps --all` ile tek seferlik konteynerleri de inceleyin. Sonra sadece sabit kilit yolunu kaldırıp yeniden başlatın:

```sh
docker compose -f compose.local.yaml stop backups
docker compose -f compose.local.yaml ps --all
docker compose -f compose.local.yaml run --rm --no-deps backups node -e "console.log(require('node:fs').readFileSync('/backups/.backup-lock/owner.json','utf8'))"
# Yukarıdaki aktif iş kontrolü tamamlandıktan sonra:
docker compose -f compose.local.yaml run --rm --no-deps backups node -e "require('node:fs').rmSync('/backups/.backup-lock',{recursive:true,force:true})"
docker compose -f compose.local.yaml start backups
```

Uygulama, sadece operations anahtarıyla erişilen `/internal/snapshots` üzerinden tutarlı bir SQLite `VACUUM INTO` kopyası oluşturur. Aynı senkron işlem sırasında veritabanındaki tüm immutable yüklemelere hardlink alır. Node event loop bu işlem boyunca kısa süre durur; diğer mesaj yazmaları ve dosya silmeleri araya giremez. Sonraki silmeler yalnızca özgün dosya adını kaldırır. Hardlink desteklenmiyorsa dosyalar aynı kritik bölümde kopyalanır. Bu garanti **tek uygulama süreci, yerel dosya sistemi ve dosyalara yalnızca uygulamanın yazması** koşuluna bağlıdır. Büyük veri kümelerinde `mola_snapshot_last_duration_seconds` ölçülmeli; yedek anındaki gecikme hedefe uymuyorsa bakım aralığı veya farklı depolama mimarisi kullanılmalıdır. [SQLite VACUUM INTO](https://www.sqlite.org/lang_vacuum.html).

Yedek servisi veri volume'unu salt okunur bağlar, hazır snapshot'ı ayrı yedek volume'una kopyalar, SQLite integrity/foreign key kontrolü ve tüm dosyaların SHA-256 doğrulamasını yapar. Tamamlanan dosyaları diske flush eder ve geçici klasörü atomik olarak hazır adına taşır. Uygulama içindeki snapshot serbest bırakılır; kesinti sonrası kalanlar 24 saatte temizlenir. Üçten fazla bekleyen snapshot yeni işi reddeder. Yedek servisinin Docker socket veya host kök dizini erişimi yoktur; UID 1000 ile çalışır.

Anında tam yedek ve listeleme:

```sh
docker compose -f compose.local.yaml exec backups node scripts/backup-runner.mjs --once
docker compose -f compose.local.yaml exec backups node -e "console.log(require('node:fs').readdirSync('/backups').join('\n'))"
```

`backup-YYYYMMDDTHHMMSSZ-xxxxxxxx` klasörü SQLite, yüklemeler, manifest, checksum ve varsa yerel `.mail-key` dosyasını içerir. Üretim `MAIL_ENCRYPTION_KEY` ortam sırrı ayrıca güvenli sır kasasında tutulmalıdır. Operations anahtarı ve TURN sırrı yedeğe eklenmez. Tam yedekler hesaplar, oturumlar ve özel mesajlar içerir; yedek volume'u host disk şifrelemesi ve erişim denetimi ile korunmalıdır. `scripts/backup.mjs` eski, yalnızca SQLite alan yardımcı komuttur; tam yedek için scheduler kullanılır.

## Doğrulanmış geri yükleme

Önce yedeği ayrı bir staging ortamında açın. Üretim geçişinde uygulamayı durdurun, mevcut veriyi koruyun ve **yeni boş veri dizini/volume'u** kullanın. Eski WAL/SHM dosyalarını başka tarihe ait SQLite dosyasıyla birleştirmeyin.

```sh
# BACKUP_ADI değerini yukarıdaki listeden seçin.
docker compose -f compose.local.yaml exec backups node scripts/backup-runner.mjs --verify /backups/BACKUP_ADI
docker compose -f compose.local.yaml cp backups:/backups/BACKUP_ADI ./backups/BACKUP_ADI
node scripts/restore-backup.mjs ./backups/BACKUP_ADI ./restored-data
```

Geri yükleyici checksum dosyasını zorunlu tutar; eksik/ek dosya, sembolik bağlantı, boyut/hash uyumsuzluğu, bozuk SQLite veya dolu hedefi reddeder. Önce hedefin yanındaki özel geçici dizine yazar, tekrar doğrular ve flush sonrası atomik taşıma yapar. Başarısız kopya canlı hedef olarak görünmez. Çöken bir geri yüklemeden kalan `.mola-restore-*` dizini manuel inceleme için kalabilir.

Restore için kullanılan Mola imajı yedeğin şema sürümünü desteklemelidir. Yeni volume'a kopyalanan verinin UID/GID'si `1000:1000` olmalıdır. Aynı `MAIL_ENCRYPTION_KEY` ile başlatın. Sağlık, giriş, geçmiş mesaj, dosya indirme ve e-posta gönderimini doğrulayıp sonra trafik geçişi yapın. `tests/ops.test.ts` canlı dosya silmesinden sonra snapshot geri yüklemesini, oturumla dosya indirmesini, retention ve checksum reddini doğrular.

## Şifreli harici yedek

`offsite` profili restic ile hazır yedek volume'unu şifreli bir depoya taşır; günlük 7, haftalık 4, aylık 6 kopya saklar ve her turda repository metadata kontrolü çalıştırır. Depo parolasını kaybetmek yedekleri kullanılamaz yapar. Yerel Docker volume'u tek başına harici yedek değildir.

1. Ayrı sağlayıcı/hesapta bir depo, sınırlı erişim anahtarı ve güçlü parola oluşturun. Parolayı `secrets/restic-password` içine yazın; UID 1000 okuyabilmelidir, kaynak kontrolüne eklenmez.
2. `.env` içindeki `RESTIC_REPOSITORY`, `RESTIC_PASSWORD_PATH` ve sağlayıcı erişimini doldurun; `OFFSITE_ENABLED=true` yapın. Docker'ın bu dosyayı okuyabildiğini kontrol edin. S3 dışı depolarda restic'in desteklediği bağlantı ve kimlik doğrulama ayarlarını uyarlayın.
3. Profili başlatın ve ilk aktarımın tamamlandığını doğrulayın:

```sh
docker compose -f compose.local.yaml --profile offsite up -d
docker compose -f compose.local.yaml logs --tail=100 restic
docker compose -f compose.local.yaml exec restic restic snapshots
docker compose -f compose.local.yaml exec restic restic check --read-data
```

Harici depodan ayrı bir staging dizinine `restic restore latest --target /tmp/restore-proof` ile geri getirin ve Mola geri yükleyicisini çalıştırın. Büyük depolarda tam `--read-data` maliyetli olabilir; düzenli prova sıklığını veriye göre belirleyin. Ayrı sağlayıcıya aktarım için gerçek repository/kimlik bilgileri gerekir; bunlar olmadan harici yedek aktif sayılmaz. [Restic yedekleme](https://restic.readthedocs.io/en/stable/040_backup.html), [geri yükleme](https://restic.readthedocs.io/en/stable/050_restore.html).

## Metrikler ve alarmlar

Uygulama HTTP adet/gecikme, 5xx, bellek, socket sayısı, SQLite erişimi, snapshot süreleri ve e-posta kuyruk durumunu sunar. Yedek servisi son başarı/deneme, hata sayısı ve harici başarı zamanını sunar. Kullanıcı, kanal, URL, query, e-posta veya token etiketleri yoktur. Caddy `/internal` yolunu 404 ile engeller; doğrudan erişim için 48 byte rastgele operations anahtarı gerekir. Anahtar ayrı volume'da `0640`, dizin `0750` tutulur. Prometheus yalnızca grup 1000 üzerinden okur. Uygulama portunu production host'a yayınlamayın.

Prometheus 15 saniyede bir scrape eder ve veriyi 30 gün saklar. Kurallar: servis/DB kaybı, yüksek hata oranı/p95, başarısız veya bayat yedek, etkin harici yedeğin eskimesi, gecikmiş/başarısız e-posta, alarm teslimat hatası. Yerel alarm e-postaları Mailpit'e gider. Üretim Alertmanager, `ALERT_WEBHOOK_URL` ile verilen **Alertmanager JSON kabul eden HTTPS alıcısına doğrudan** gönderir; uygulama veya yedek servisine bağımlı bir bildirim köprüsü yoktur. Genel Slack webhook gövdesi farklıdır; uyumlu bir alıcı/entegrasyon kullanın. Webhook adresi ve varsa URL sırrı loglanmaz.

```sh
docker compose -f compose.local.yaml exec prometheus promtool check config /etc/prometheus/prometheus.yml
docker compose -f compose.local.yaml exec alertmanager amtool check-config /etc/alertmanager/alertmanager.yml
```

Host disk/CPU, Docker daemon, host tamamen kapanması ve dış ağ erişimi bu aynı host üzerindeki yığın tarafından güvenilir biçimde alarm verilemeyen hata alanlarıdır. Canlı kurulumda ayrı sağlayıcıdan HTTPS uptime kontrolü ve host disk kapasite alarmı da bağlayın. Aynı host üzerinde çalışan izleme yüksek erişilebilirlik sağlamaz. Caddy access log varsayılan kapalıdır; hesap bağlantısı sırlarını loglamayın.

## Güncelleme

Önce tam yedek ve staging testi, sonra `docker compose ... build --pull` ve `up -d`. İmaj sürümleri/digestleri sabittir; güvenlik güncellemesinde ikisini birlikte değiştirin ve build, birim/tarayıcı testleri, relay, e-posta ve restore provasını tekrarlayın. Şema yükselmesinde eski imaja dönüş için o sürüme uygun veri yedeği gerekebilir.
