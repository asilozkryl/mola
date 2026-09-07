# Hesap doğrulama ve kurtarma

## İki aşamalı doğrulama ve cihaz oturumları

Hesap ayarlarının güvenlik bölümünde **İki aşamalı doğrulamayı kur** seçeneğini açın. Mevcut parolanızı doğruladıktan sonra QR kodu doğrulama uygulamanıza ekleyin veya verilen kurulum anahtarını elle girin. Uygulamanın ürettiği altı haneli kodla kurulumu tamamlayın. İki aşamalı doğrulama açılınca diğer cihazlardaki oturumlar kapanır; açık olan kurulum oturumu devam eder.

Kurulum onayından sonra gösterilen **10 kurtarma kodunu** indirin veya kopyalayıp güvenli bir yerde saklayın. Kodlar yalnız o ekranda gösterilir ve her biri bir kez kullanılabilir. Doğrulama uygulamasına erişemediğinizde giriş ekranında kurtarma kodu kullanılabilir. **Kurtarma kodlarını yenile** yeni bir takım oluşturur ve önceki kodları geçersiz kılar. Yenileme ve iki aşamalı doğrulamayı kapatma işlemleri mevcut parola ile bir doğrulama/kurtarma kodu ister.

Girişte önce parola, sonra ikinci aşama istenir. İkinci aşama tamamlanmadan oturum veya çalışma alanı erişimi açılmaz. Parola sıfırlamak iki aşamalı doğrulamayı kaldırmaz. Kapatma işlemi diğer oturumları da iptal eder.

**Açık oturumlar** bölümünde hesapla açılmış cihazlar, görülebilen oturum zamanları ve kullanılan oturum işareti gösterilir. Cihaz adı tarayıcı bilgisinden türetilen bir etikettir; donanım kimliği değildir. **Oturumu kapat** ilgili cihazın API/WebSocket erişimini ve görüşmesini sonlandırır. Geçişten önce açılmış oturumların bilinmeyen zamanları uydurulmaz. Bu liste parola, çerez veya oturum anahtarlarını göstermez.

Teknik kapsam: TOTP, RFC 6238 SHA-1 ile altı hane ve 30 saniyelik adım kullanır; yakın zaman adımları için ±1 tolerans vardır. Başarılı kullanılan sayaç tekrar kabul edilmez. Giriş sınaması beş dakika geçerli HttpOnly çereze bağlıdır; beş başarısız denemeden sonra hesap için 15 dakikalık sınır uygulanır. Kurtarma kodlarının veritabanında yalnız özeti tutulur. Kurulum/giriş kuralları sunucuda uygulanır.

Doğrulama komutları:

```sh
node --import tsx --test tests/account-security.test.ts
npx playwright test tests/account-security.e2e.spec.ts
```

## Güvenlik anahtarını yedekleme

İki aşamalı doğrulama sırları AES-256-GCM ile şifrelenir. Yapılandırılmış `MAIL_ENCRYPTION_KEY` varsa anahtar bu kalıcı değerden amaç ayrımıyla türetilir. Yoksa `DATA_DIR/.account-security-key` oluşturulur ve yeniden başlatmada aynı dosya kullanılır. GitHub/entegrasyon sırları ve Web Push anahtarları da kendi amaçlarına ayrılmış anahtar materyalini kullanır.

Üretim ortamındaki `MAIL_ENCRYPTION_KEY` dağıtımlarda korunmalıdır. Yerel `.account-security-key` dosyası yedek/geri yükleme paketine dahildir. Veritabanı yedeğini yanlış anahtarla başlatmak mevcut doğrulama hesaplarını kurtarmaz; eşleşen anahtar korunmalı ve geri yüklenmelidir. Ayrıntılar: [OPERATIONS.md](OPERATIONS.md).

## E-posta doğrulaması

Gerçek hesaplar için üretimde e-posta doğrulama zorunludur. Doğrulanmamış hesap giriş yapabilir ve doğrulama ekranını görür; kanal, üye listesi, mesaj, dosya, arama ve WebSocket erişimi verilmez. Yerelde aynı davranış `REQUIRE_EMAIL_VERIFICATION=true` ile etkinleşir. Örnek çalışma alanları bu kapıdan muaftır.

## Kullanıcı akışları

- Kayıt sonrası e-postadaki bağlantı açılır ve **E-posta adresimi doğrula** düğmesine basılır. Bağlantıyı GET ile açmak hesabı doğrulamaz; e-posta güvenlik tarayıcıları bağlantıyı tüketmez. Sonra **Devam et** veya ilk sekmede **Doğrulamayı tamamladım** kullanılır.
- Giriş ekranında **Parolamı unuttum** ile bağlantı istenir. Kayıtlı ve bilinmeyen adreslerde aynı yanıt gösterilir.
- Parola kurtarma bağlantısında yeni parola iki kez girilir. Başarıyla değiştiğinde tüm oturumlar, WebSocket bağlantıları ve diğer kurtarma bağlantıları iptal edilir. Kullanıcı yeni parolasıyla giriş yapar.
- Süresi dolmuş veya kullanılmış bağlantı için yeni bağlantı istenir. Yeniden gönderim en az 60 saniye aralıklıdır; doğrulama için hesap başına günde 10, kurtarma için saatte 5 bağlantı sınırı vardır. HTTP istek sınırları ayrıca uygulanır.

## Belirteçler ve teslimat

Belirteçler kriptografik rastgele 32 bayttır. Veritabanında yalnızca SHA-256 özetleri tutulur; kullanıcı, e-posta adresi, amaç, son kullanma ve tüketim tarihiyle bağlanır. Doğrulama 24 saat, kurtarma 15 dakika geçerlidir. Parola türetme sonrasında belirteç geçerliliği işlem içinde tekrar kontrol edilir; eşzamanlı isteklerde tek tüketim sağlanır.

E-posta bağlantıları güvenilen `APP_ORIGIN` ile üretilir; istemciden gelen Host veya yönlendirme adresi kullanılmaz. Belirteç URL fragment'inde (`#action=…&token=…`) bulunur, HTTP istek adresine ve referrer'a dahil olmaz. Kullanıcı onayında POST gövdesinde gönderilir. Başarılı işlemden sonra adres çubuğundan kaldırılır. Belirteçler uygulama günlüklerine yazılmaz.

Kayıt ve e-posta kuyruğu aynı veritabanı işlemiyle kaydedilir. SMTP hatası hesabın kaydedilmiş olmasını değiştirmez; kuyruk artan beklemeyle tekrar dener ve yeniden başlatmada devam eder. Kuyruk gövdesi AES-256-GCM ile şifrelenir. Teslim edilmiş veya geçersizleşmiş işlerin gövdesi silinir. Üretim `MAIL_ENCRYPTION_KEY` anahtarı yedeklerden ayrı ve güvenli saklanmalıdır.

Üretimde SMTP için doğrulanan TLS zorunludur: 465 üzerinde doğrudan TLS veya STARTTLS gerektiren 587 yapılandırılabilir. Güvensiz SMTP seçeneği üretimde etkisizdir. Sağlayıcı parolaları sohbete veya Git'e yazılmaz; dağıtım ortamında yapılandırılır.

Yerel Docker Mailpit ile dışarıya gerçek e-posta göndermeden akışlar denenir. SMTP tanımlanmamış geliştirme/test sunucusu `DATA_DIR/mail` içine yerel JSON e-posta dosyası yazar. Bu klasör gerçek bağlantıları içerir; yalnızca geliştirme içindir ve Git'e alınmaz.

## Doğrulama

`npm test` içindeki hesap güvenliği testleri izin kapısını, süre/açık oturum/tek kullanım kontrollerini, yarış durumlarını, eski veritabanı geçişini, yeniden başlatma sonrası kuyruk devamlılığını ve üretimde düz SMTP reddini doğrular. `npm run test:auth` gerçek API ve yerel e-posta çıktısıyla kayıt → doğrulama → kurtarma → tekrar giriş akışını tarayıcıda çalıştırır; mobil erişilebilirliği de denetler.

Güvenlik yaklaşımının kaynakları: [OWASP parola kurtarma rehberi](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), [Nodemailer SMTP/TLS belgeleri](https://nodemailer.com/smtp).
