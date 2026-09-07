# Hesap doğrulama ve kurtarma

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
