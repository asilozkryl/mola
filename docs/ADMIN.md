# Yönetim paneli

Mola'da çalışma alanı sahipliği ile uygulama yöneticiliği ayrı yetkilerdir. Sahip hesapla **Yönetim paneli** düğmesini açın. Mobilde düğme gezinme menüsündedir. Normal üyeler yönetim girişini görmez; API de yönetim isteklerini reddeder.

| Yetki | Yapabilecekleri |
| --- | --- |
| Üye | Eriştiği kanallarda ve özel sohbetlerde mesajlaşma/görüşme. |
| Çalışma alanı sahibi | Kendi ekibinin üyelerini askıya alma/etkinleştirme, kanal düzenleme/arşivleme, davet oluşturma/iptal, ekip adı ve sahiplik devri, yönetim işlem geçmişi. |
| Uygulama yöneticisi | Ekip yönetimine ek olarak **Genel yönetim** ekranında çalışma alanı/kullanıcı özetleri, erişimi askıya alma/yeniden açma ve genel işlem geçmişi. |

Kullanıcı kaydında gönderilen `siteAdmin` veya `role` alanları uygulama yöneticiliği vermez. İlk kayıt olan kişi otomatik genel yönetici olmaz. Genel yetkiyi HTTP üzerinden veren bir uç bulunmaz; atama sunucu terminalindeki CLI ile yapılır.

## İlk uygulama yöneticisini atama

1. Kullanıcı gerçek bir hesap oluşturur ve e-posta adresini doğrular. Yerel Docker'da doğrulama bağlantısı `http://localhost:8025` Mailpit kutusundadır. Demo hesapları, askıdaki hesaplar ve parola sahibi olmayan örnek üyeler atanamaz.
2. Sunucuya yetkili erişimi olan işletim sorumlusu, hedef hesabın e-posta adresiyle aşağıdaki komutu çalıştırır.

Yerel Docker için:

```sh
docker compose -f compose.local.yaml exec app npm run admin -- grant --email yonetici@example.com
```

Production Compose için:

```sh
docker compose exec app npm run admin -- grant --email yonetici@example.com
```

Kaynak üzerinden çalışıyorsanız uygulamayla **aynı `DATA_DIR`** ayarını kullanın. `.env` dosyası CLI tarafından okunur:

```sh
npm run admin -- grant --email yonetici@example.com
```

Komut mevcut hesabın yetkisini değiştirir; yeni kullanıcı veya parola oluşturmaz. Doğru çalışma alanını kullandığınızdan emin olun: host üzerindeki `./data`, Docker named volume'undaki veriyle aynı yer değildir. Docker kurulumu için komutu uygulama konteynerinde çalıştırın. CLI için SMTP/TURN bağlantısı gerekmez; uygulamanın production gereksinimleri değişmez.

Atama tüm hedef oturumları iptal eder; açık bağlantılar en geç beş saniye içinde kapanır. Kullanıcı yeniden giriş yaptığında **Yönetim paneli → Genel yönetim** görünür. Atama işlemi yönetim geçmişine kaydedilir.

## Genel yönetici yetkisini kaldırma

```sh
docker compose -f compose.local.yaml exec app npm run admin -- revoke --email yonetici@example.com
```

Bu işlem genel yönetici bayrağını kaldırır ve hedef oturumları iptal eder. Hesap, mesajlar ve mevcut çalışma alanı rolü korunur. Hedef hesabı ayrıca askıya almak gerekiyorsa yetki kaldırıldıktan sonra uygun yönetim ekranını kullanın. Uygulama yöneticileri HTTP üzerinden askıya alınamaz; önce bu CLI adımı gerekir. Terminal erişimi olan sorumlu gerektiğinde yetkiyi tekrar verebilir.

Son aktif uygulama yöneticisinin yetkisi doğrudan kaldırılamaz. Önce başka doğrulanmış, aktif ve gerçek parolası olan hesaba `grant` uygulayın; ardından eski yöneticiyi `revoke` edin. Bu kontrol uygulamanın yöneticisiz kalmasını önler.

## Günlük ekip yönetimi

**Üyeler:** İsim veya e-posta ile bulun, **Askıya al** seçeneğini onaylayın. Kullanıcının oturumları/görüşmeleri kapanır; mesajlar ve dosyalar silinmez. **Etkinleştir** sonrası kullanıcı yeniden giriş yapar; eski oturum canlanmaz. Sahip ve kendi hesabınız için askıya alma düğmesi sunulmaz.

**Kanallar:** Kanal oluşturun veya **Düzenle** ile isim/açıklamayı değiştirin. Bu işlemler sohbet ekranında kanala sağ tıklayarak ya da kanal satırındaki/başlığındaki **⋯** düğmesinden de açılır. Sahipler, yöneticiler ve uygulama yöneticileri kanalları yönetir; moderatörler erişebildikleri herkese açık kanalları düzenleyebilir, arşivleyebilir ve silebilir. Normal üyeler ve misafirler bu yönetim seçeneklerini görmez.

**Arşivle**, kanalı aktif listeden çıkarır ve yazma/görüşme erişimini kapatır; geçmiş korunur. Sol menüdeki **Arşivlenmiş kanallar** bölümünden geçmişi okuyabilir veya yetkiniz varsa **Arşivden çıkar** ile geri açabilirsiniz. Kaydedilen mesajlar ve bu mesajların geçmiş bağlantıları arşivleme sonrasında kullanılabilir. Kanalın gizlilik ve üyelik sınırları devam eder.

**Kanalı sil**, güncel kanal adının aynen yazılmasıyla onaylanır. Mesajlar, yanıtlar, ekler, sunucudaki taslaklar, ilişkili bildirimler ve kanal entegrasyonları kalıcı olarak kaldırılır; devam eden görüşme kapanır. Entegrasyon botunun ilgili ekip üyeliği kapatılır, diğer alanlardaki tarihsel kayıtları korunur. Silme işlemi yönetim geçmişine kaydedilir. Geçmişi saklamak için arşivlemeyi kullanın. Özel mesaj sohbetleri bu kanal silme işleminin kapsamına girmez.

**Davetler:** Bağlantılar üç gün, en fazla 20 yeni katılım için geçerlidir. Oluşturulan bağlantı o anda kopyalanabilir; sonradan eski bağlantının açık metni gösterilmez. Listede kullanım, süre ve durum görünür. **İptal et** gelecekteki katılımları engeller; daha önce katılan kullanıcıları çıkarmaz. Sızan bir bağlantıyı iptal edip yeni bağlantı oluşturun.

**Ekip ayarları:** Ekip adını değiştirin. Sahiplik devrinde aktif, doğrulanmış ve gerçek parolası olan ekip arkadaşını seçip mevcut parolanızı girin. Devirden sonra eski sahip üye olur; yeni sahip yönetimi devralır. Örnek ekiplerde devir kapalıdır.

**İşlem geçmişi:** Kim, neyi, ne zaman değiştirdi bilgisi gösterilir. Mesaj içerikleri ve parolalar yönetim kayıtlarına dahil edilmez. Genel yönetim özetleri özel sohbet içeriklerini göstermez.

## Erişim sorunları

- Düğme yoksa hesabın çalışma alanı sahibi veya CLI ile atanmış uygulama yöneticisi olduğunu kontrol edin; atama sonrası tekrar giriş yapın.
- Atama kullanıcıyı bulamıyorsa doğru e-posta ve `DATA_DIR`/konteyneri doğrulayın; yeni boş veritabanıyla devam etmeyin.
- Doğrulanmamış veya askıdaki hesapları önce normal hesap/erişim akışıyla düzeltin. Genel yönetici ataması bu kontrolleri atlamaz.
- Çalışma alanı askıya alındığında normal kullanıcı oturumları kapanır. Uygulama yöneticisi genel panelden alanı tekrar etkinleştirebilir; yönetici kendi bulunduğu alan askıdayken de genel yönetime erişimini korur.

Yetkiler ve veri koruma `tests/admin.test.ts`, temel panel akışları `tests/admin.e2e.spec.ts` ile kontrol edilir. İşletim/yedekleme komutları [OPERATIONS.md](OPERATIONS.md) içindedir.
