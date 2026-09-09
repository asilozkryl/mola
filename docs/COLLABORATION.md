# Ekip çalışması, kanallar ve bildirimler

Mola aynı hesapla birden fazla çalışma alanına katılmayı destekler. Üyelik ve rol her çalışma alanında ayrıdır; bir alanın sahibi olmak diğer alanda yönetici yetkisi vermez. Alan değiştirme ve davet akışları: [WORKSPACES.md](WORKSPACES.md).

## Roller

Alan sahibi veya yönetici **Yönetim paneli → Üyeler** bölümünden rol değiştirir. Yönetici atama ve yöneticinin rolünü değiştirme alan sahibine aittir. Sahiplik, ayrı parola onaylı devir akışıyla değiştirilir. Kişi kendi rolünü bu açılır listeden değiştiremez.

| İşlem | Alan sahibi | Yönetici | Moderatör | Üye | Misafir |
| --- | --- | --- | --- | --- | --- |
| Herkese açık kanalları görme | Evet | Evet | Evet | Evet | Yalnız atandıkları |
| Özel kanala girme | Kanal üyesiyse | Kanal üyesiyse | Kanal üyesiyse | Kanal üyesiyse | Kanal üyesiyse |
| Eriştiği aktif kanala mesaj yazma / görüşmeye katılma | Evet | Evet | Evet | Evet | Evet |
| Kanal oluşturma | Evet | Evet | Evet | Evet | Hayır |
| Davet oluşturma | Evet | Evet | Hayır | Hayır | Hayır |
| Kanal görünürlüğü ve üyelerini değiştirme | Evet | Evet | Hayır | Hayır | Hayır |
| Başkasının mesajını silme | Eriştiği kanallarda | Eriştiği kanallarda | Eriştiği kanallarda | Hayır | Hayır |
| Kanal adı/açıklaması/arşiv yönetimi | Evet | Evet | Eriştiği herkese açık kanallarda | Hayır | Hayır |
| Standart üyeleri yönetme | Evet | Evet | Hayır | Hayır | Hayır |
| Yöneticileri yönetme / sahiplik devri | Evet | Hayır | Hayır | Hayır | Hayır |
| Entegrasyon oluşturma | Evet | Evet | Hayır | Hayır | Hayır |

Uygulama yöneticisi, çalışma alanı rolünden ayrı sunucu genelindeki yönetim yetkisidir. Bu yetki özel kanal mesajlarını üyelik olmadan okuma hakkı vermez. Bot hesapları **Ekip botu** olarak işaretlenir, misafir rolünde kendi bildirim kanalına atanır ve insan kullanıcı gibi yöneticiye yükseltilemez.

## Özel kanal ve misafir ataması

Kanal oluştururken görünürlüğü seçin. Yeni özel kanal ilk olarak oluşturan kişiye açılır. Alan sahibi/yönetici, **Yönetim paneli → Kanallar → Erişim** veya kanal bilgileri içindeki **Kanal erişimi ve üyeler** üzerinden kullanıcıları seçip **Erişimi kaydet** düğmesine basar. Diğer üyeler erişim ayarını okuyabilir; özel kanalına ekip arkadaşlarını eklemek isteyen standart üye alan yöneticisinden atama ister.

Özel kanallar seçilmeyen kullanıcıların kanal listesinde, aramasında ve sesli oda katılımcı listesinde görünmez. Alan sahibi veya yönetici yönetim panelinde kanal bilgilerini düzenleyebilir; sohbeti, dosyaları veya görüşmeyi açmak için kendisini de üye listesine eklemesi gerekir. Bu erişim değişikliği işlem geçmişine kaydedilir.

**Herkese açık** kanalda normal ekip üyeleri için ayrıca atama gerekmez. Misafirler için üye listesindeki işaret zorunludur. Bir kullanıcıyı misafire çevirmeden önce ihtiyaç duyduğu kanallara atayın; atanmadığı kanallar ve mevcut bağlantıları rol değişiminde kapatılır. Misafir kendi başına yeni kanal veya yeni direkt mesaj oluşturamaz; önceden atanmış sohbetleri kullanabilir.

Özel kanalı herkese açmak geçmiş mesaj ve dosyaları da ekip üyelerine açar. Arayüz kaydetmeden önce bu sonucu ayrıca belirtir. Kanalı arşivlemek geçmişi korur, yeni mesajları durdurur ve görüşmesini kapatır.

## Kaydedilenler ve ekran adresleri

Mesaj menüsünden **Mesajı kaydet** seçeneğini kullanın. Kaydedilenler kişisel ve çalışma alanına özeldir; hesabınıza giriş yaptığınız diğer cihazlarda aynı liste açılır. Arama mesaj metni, gönderen, kanal/özel konuşma adı ve dosya adını kapsar. **Daha fazla göster** ile sonraki kayıtları yükleyin. Kanal/konuşma adına basınca kaydın kaynak mesajı açılır. Erişiminiz kaldırılan mesajlar listede gösterilmez.

Önceki tarayıcı kayıtları açılışta otomatik aktarılır. Aktarma veya liste yükleme başarısız olursa Kaydedilenler ekranındaki **Yeniden dene** düğmesini kullanın; aktarım tamamlanmadan yerel kayıtlar kaldırılmaz. Kaldırma işlemi başarısızsa mesajın kayıt işareti korunur.

Kanal ve özel konuşmalar, merkezler, Dosyalar/Sabitlenenler sekmeleri ve mesaj dizileri adres çubuğunda yer alır. Sayfayı yenilemek aynı ekranı açar; tarayıcı geri/ileri düğmeleri önceki ekranlara döner. Profil sayfasından dönüş konuşma taslağını ve kaydırmasını korur. Bağlantı başka bir çalışma alanını açacaksa devam eden görüşmeden ayrılma onayı gösterilir.

## Bildirimler ve okunmamışlar

Kanallardaki okunmamış sayıları sunucuda hesaba kaydedilir. Bir kanalı okuduğunuzda aynı hesabın o çalışma alanını açık tuttuğu diğer oturumlar da güncellenir. Yeni şema kurulurken eski mesaj geçmişi okunmuş kabul edilir; sonraki mesajlar sayılmaya devam eder.

Gelen kutusunda şu bildirimler toplanır:

- `@` düğmesiyle bir kişiden söz edilmesi.
- `@kanal` ile kanala seslenilmesi. Misafirlerin `@kanal` metni toplu bildirim oluşturmaz.
- Katıldığınız bir mesaj dizisine yanıt gelmesi.
- Size direkt mesaj gönderilmesi.

Bildirim yalnızca o kanala erişebilen kişilere oluşturulur. Kendi mesajınız size bildirim göndermez. Kanal erişimi kaldırılmışsa eski bildirim üzerinden içerik açılamaz. Gelen kutusundan tek bildirimi veya eriştiğiniz bildirimleri topluca okundu olarak işaretleyebilirsiniz.

`@` düğmesindeki kişi seçicisinde ad, unvan veya e-posta ile arama yapabilirsiniz. Aynı adlı kişiler avatar, unvan ve e-posta ile ayrılır. Aşağı/Yukarı oklarıyla kişiye geçip Enter ile seçin; Escape seçiciyi kapatır. Seçilen kişi mesajda okunabilir adıyla görünür, taslak ve mesajda kimliği korunur. Kişi adını değiştirdiğinde bahsetmenin hedefi değişmez. Bahsetme adının içini elle değiştirmek onu normal metne dönüştürür; yeni bir hedef için seçiciyi kullanın. Önceden yazılmış metin bahsetmeleri okunabilir kalır.

Üst çubuktaki **Uygulama içi uyarıları sustur** yalnız bu tarayıcıdaki uygulama içi yeni mesaj uyarılarını susturur. Okunmamış işaretlerini veya hesabın tarayıcı bildirimi tercihini kapatmaz.

Tarayıcı bildirimlerini açmak için sol menüden **Bildirimler ve uygulama → Bu cihazda bildirimleri aç** seçeneğini kullanın ve tarayıcı iznini verin. Her cihaz ayrıca izin ve abonelik ister. **Tüm cihazlarda kapat**, hesabın push tercihini kapatır; uygulama içindeki okunmamış işaretleri devam eder. Oturum kapatıldığında o oturuma bağlı bildirim aboneliği de sunucuda silinir.

Aynı cihazda yeniden giriş yaptığınızda hesabın bildirim tercihi açık, tarayıcı izni verilmiş ve mevcut cihaz aboneliği duruyorsa abonelik yeni oturuma otomatik bağlanır. Ayar ekranını tekrar açmanız gerekmez. Bu işlem yeni bir tarayıcı izni istemez veya cihaz aboneliği oluşturmaz; bunlar yine **Bu cihazda bildirimleri aç** düğmesiyle yapılır. Hesap/oturum değişimi veya bildirimleri kapatma sırasında geciken bir bağlama isteği geçersiz sayılır.

Push bildirimi mesaj metnini taşımaz; yalnız yeni bildirim olduğunu söyler. Bildirime basınca hedef çalışma alanı ve mesaj açılır; uygulama erişimi yeniden kontrol eder. HTTPS ve tarayıcının Web Push desteği gerekir. Engellenmiş izin tarayıcının site ayarlarından yeniden açılır.

## Taslaklar

Ana sohbet ve mesaj yanıtı taslakları kullanıcı, çalışma alanı, kanal ve yanıt dizisine göre ayrı tutulur. Metin ve yüklemesi tamamlanmış dosya seçimleri birlikte sunucuya eşitlenir; aynı hesaptaki başka cihaz taslağı açabilir. Kanal veya profile gidip geri dönmek ve sayfayı yenilemek ekli taslağı korur. Durum yazısı eşitlemenin tamamlanıp tamamlanmadığını gösterir. Kanal değişirken henüz tamamlanmamış yükleme iptal edilir; dosya yeni konuşmaya eklenmez.

İki cihaz aynı taslağı değiştirirse sürüm seçimi hem metne hem dosyalara uygulanır. Kullanılamayan bir ek kendi yerinde işaretlenir; göndermeden önce kaldırıp yeniden ekleyin.

Gönderimin sonucu alınamazsa mesaj **Yeniden dene** için korunur. Düğme aynı gönderimi tekrar kontrol eder; yanıt kaybolmadan önce kaydedilmiş mesajdan ikinci bir kopya oluşturmaz. Bekleyen mesaj bu konuşmaya ve hesaba bağlıdır; aynı sekmede kanal/profil değişimi veya yenilemeden sonra da elle yeniden denenebilir. Sonuç çözülene kadar mesaj metni ve ekleri sabit kalır. Uygulama bağlantı geri geldiğinde kendi kendine göndermez. Sunucunun kesin olarak reddettiği düzeltilebilir hatalarda **Taslağa dön** ile düzenlemeye devam edin.

İki cihaz aynı taslağı değiştirmişse sürümler sessizce birbirinin üstüne yazılmaz. **Diğer cihazdaki taslağı göster** ile karşılaştırıp **Diğer taslağı kullan** veya **Buradaki taslağı kullan** seçeneklerinden birini seçin. Ağ sorunu sırasında açık sekmedeki metin korunur; **Yeniden dene** ile eşitleme başlatılır. Dosya ekleri bu metin taslağı eşitlemesinin parçası değildir.

Tarayıcı verilerini temizlemek yerel, henüz eşitlenmemiş taslağı silebilir. Hesap veya alan değiştirmek başka kullanıcının taslağını göstermez.

## Arama ve mesaja bağlantı

Arama penceresinde en az iki karakter yazabilir veya doğrudan filtre seçebilirsiniz. Kanal, gönderen, başlangıç/bitiş tarihi ve yalnız dosya içeren mesajlar birlikte kullanılabilir. Tarih alanları tarayıcınızın yerel takvim günlerini temsil eder; bitiş tarihi seçilen günün tamamını kapsar. Sunucuya başlangıç dahil, bitiş hariç kesin zaman aralığı gönderilir. Mesaj metniyle birlikte dosya adları da aranır. Sonraki sayfalar kararlı bir devam anahtarıyla yüklenir. Sonuçlar yalnız eriştiğiniz kanallardan ve özel sohbetlerden gelir.

Mesaj işlemlerindeki bağlantı kopyalama seçeneği çalışma alanını ve mesajı belirleyen bir adres üretir. Alıcı üyeyse ilgili alana geçip mesaja ulaşabilir; bağlantı erişim yetkisi vermez.

Arama filtresi, sonuçlar ve Kaydedilenler'deki özel konuşma kaynağı karşı tarafın güncel adıyla gösterilir. Dosyalar veya Sabitlenenler yüklenemediğinde liste hata açıklaması ve **Yeniden dene** sunar; bağlantı hatası boş liste olarak gösterilmez.

## Profil düzenlemelerini koruma

Profilde kaydedilmemiş metin veya uygulanmamış fotoğraf varsa pencereyi kapatmak, çıkış yapmak ya da yönetim paneline geçmek önce bir seçim açar. **Düzenlemeye devam et** taslağı korur; **Değişiklikleri bırak** bekleyen geçişi tamamlar. Değişiklik yoksa ek soru çıkmaz. Metni kaydetmek, ayrıca seçilmiş fotoğrafı uygulamaz; fotoğraf işlemi kendi düğmesiyle tamamlanır.

## Mobil kullanım ve görüşme

**Bildirimler ve uygulama** bölümünde destekleyen tarayıcılar için **Mola'yı yükle** seçeneği bulunur. Safari’de ana ekrana ekleme adımları aynı bölümde gösterilir. Uygulama bağlantı kesildiğinde genel bir çevrimdışı ekranı açar; özel sohbet/API yanıtları service worker önbelleğine alınmaz. Açık sekmedeki metin taslağı ayrı olarak korunabilir.

Mikrofon testi, ses cihazları, konuşan kişi, bağlantı göstergesi ve ekran paylaşımını büyütme adımları: [Görüşme ve ekran paylaşımı](call-experience.md). GitHub ve diğer araçlar: [Entegrasyonlar](INTEGRATIONS.md). İki aşamalı doğrulama ve oturum yönetimi: [Hesap güvenliği](ACCOUNT_SECURITY.md).

Google ile giriş kullanıcı isteğiyle ertelenmiştir; mevcut hesap girişi kullanılmaya devam eder.

## Sürüm ve veri

Bu özellikler şema v5 ile gelir. Güncelleme mevcut kullanıcı kimliğini, çalışma alanı üyeliklerini, oturumları, mesajları ve DM üyeliklerini koruyarak rol/görünürlük, bildirim, taslak, hesap güvenliği ve entegrasyon tablolarını ekler. Geçiş tek transaction içinde doğrulanır. Yedek ve eşleşen sürüme geri dönüş: [OPERATIONS.md](OPERATIONS.md). Doğrulama kapsamı: [VERIFICATION.md](VERIFICATION.md).
