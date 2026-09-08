# Çalışma alanları ve sesli oda katılımcıları

## Kullanım

Sol üstteki çalışma alanı adı alan menüsünü açar. **Çalışma alanlarını değiştir** mevcut alanları listeler; oluşturma, davetler ve ayarlar aynı menüden erişilir. Sol şeritte üye olduğunuz alanların simgeleri bulunur; bir simgeye tıklayarak geçebilirsiniz. Telefonda gezinme menüsünü açıp üstteki alan adına dokunun.

- **Yeni çalışma alanı:** adını yazıp oluşturun; mevcut hesabınız yeni alanın sahibi olur.
- **Davetle katıl:** alan sahibinin gönderdiği Mola bağlantısını veya davet kodunu yapıştırın. Mevcut hesabınızla üye olursunuz. Oturum kapalıyken davet bağlantısından giriş yaparsanız davet katılma ekranına taşınır.
- **Görüşme sırasında geçiş:** uygulama görüşmeden ayrılacağınızı gösterir. Vazgeçebilirsiniz; devam ettiğinizde cihaz ve bağlantı kaynakları kapatılır. Kanal taslakları korunur.

Bir hesabın farklı alanlarda farklı rolleri olabilir. Alan sahibinin bir üyeliği askıya alması diğer ekiplerdeki üyelikleri veya geçmiş mesajları silmez. Erişilemeyen bir alandan diğer ekiplerinize geçebilir, yeni bir alan açabilir veya başka bir davete katılabilirsiniz. Askıya alınmış üyelik davetle yeniden etkinleştirilmez; ilgili yöneticinin erişimi açması gerekir. Demo hesapları başka ekip kuramaz veya gerçek ekiplere katılamaz.

Aktif alan oturuma bağlıdır: aynı oturum çerezini paylaşan sekmeler birlikte değişir. Bağımsız giriş yapılmış başka tarayıcı veya cihaz kendi aktif alanında kalır. Kaydedilen mesajlar bu tarayıcıda hesap ve alan bazında tutulur; cihazlar arası eşitlenmez. Mesaj taslakları da kullanıcı, kanal ve yanıt dizisine göre ayrılır. Eski sürümde sahibi kaydedilmeyen taslaklar başka hesaba gösterilmemesi için otomatik taşınmaz; eski tarayıcı kayıtları silinmez.

Sesli odanın altındaki küçük avatarlar ve kişi sayısı o an bağlı katılımcıları gösterir. Katılımcı sayısı veya “Katılımcılar” eylemi, odaya katılmadan ayrıntılı listeyi açar; mikrofon, kamera ve ekran paylaşımı durumları burada görünür. Bağlantı kesildiğinde liste gizlenir ve yeniden bağlanınca güncellenir. Özel mesajlardaki veya metin kanallarındaki görüşmeler sesli oda listesine dahil edilmez.

## Çalışma alanına davet ve kanala üye ekleme

**Çalışma alanına davet et** yalnızca alan üyeliği sağlar. Yeni üyeler açık kanallara erişebilir; özel yazılı ve sesli kanallara otomatik eklenmez. **Kanal hakkında → Kanala üye ekle** veya kanalın üye listesindeki aynı düğme, o kanalın erişim ekranını açar. Çalışma alanı daveti üretmez. Kanal üyeliğini kaldırmak kişinin çalışma alanı üyeliğini sonlandırmaz.

Özel kanalda **Bu kanalda** ve **Çalışma alanından ekle** listeleri ayrıdır. İsim/e-posta araması, eklenecek ve kaldırılacak kişiler ile kaydedilmemiş değişiklik özeti gösterilir. Açık kanallarda alan üyelerinin erişimi otomatik olduğundan kutuları salt okunurdur; misafirler ayrıca seçilir. Erişimi yalnızca seçilen kişilerle sınırlamak için kanal özel olmalıdır. Kendi özel kanal üyeliğini kaldırmak ve özel kanalı herkese açmak sonuçları açıklanan ikinci kaydetme adımıyla tamamlanır.

Bu arayüz güncellemesi erişim yetkilerini değiştirmez: kanal üyelerini alan sahibi/yöneticiler yönetir, özel kanal içeriği yönetici için de açık kanal üyeliği gerektirir. Yeni hesap ve mevcut hesapla davet, özel mesaj/dosya/arama/sesli oda erişimi, üyelik ekleme-kaldırma için sunucu regresyonları eklendi. 11 ilgili tarayıcı senaryosu, 18 sunucu testi ve üretim derlemesi geçti; 320 px ekran ve axe denetimi de doğrulandı.

## Veri geçişi ve dağıtım

Çalışma alanı üyelikleri şema **v4** ile ayrılmıştır; güncel şema **v7**'dir. v5 kanal gizliliği/rollerini, v6 profil alanlarını, v7 alansız oturumları, gönüllü ayrılma bilgisini ve kişisel kenar çubuğu tercihlerini ekler. Uygulama ilk açılışta eski veriyi otomatik yükseltir. Hesap kimlikleri, mesajlar, dosyalar, oturumlar, davetler ve mevcut roller korunur; ilk üyelik eski çalışma alanından oluşturulur. Kimlik artık eski ana alanın silinmesine bağlı değildir. v6 → v7 geçişinde cihaz ve bildirim aboneliklerinin oturum ilişkileri korunur.

Dağıtımdan önce [tam yedek](DEPLOYMENT.md) alın: SQLite, yüklenen dosyalar ve gerekli şifreleme anahtarları birlikte korunmalıdır. Migration transaction içinde çalışır ve yabancı anahtar tutarlılığını doğrular. Geri dönüş gerekirse yeni şemayı eski uygulama imajıyla açmayın; önceki sürüme uygun yedeği ayrı bir volume'a geri yükleyip doğrulayın. Şema numarasını elle düşürmeyin.

Yeni ortam değişkeni veya OAuth ayarı gerekmez. Google ile giriş bu sürümün kapsamı dışındadır. Tek uygulama kopyası şartı devam eder; görüşme ve çevrimiçi durumları süreç belleğindedir.

## API ve gerçek zamanlı kapsam

- `GET /api/workspaces`: üyelikler ve aktif alan.
- `POST /api/workspaces {name}`: oluştur ve bu oturumda geç.
- `POST /api/workspaces/join {inviteToken}`: davetle katıl ve geç.
- `POST /api/workspaces/:id/switch`: mevcut üyeliğe geç.
- `GET /api/workspaces/:id/deletion-preview`: yalnız mevcut sahibine güncel alan adı ve üye, kanal/oda, mesaj, dosya, depolama miktarlarını verir.
- `DELETE /api/workspaces/:id {confirmName,password}`: mevcut sahibin güncel ad ve parola doğrulamasıyla alanı siler.
- `POST /api/workspaces/:id/leave {}`: sahibi dışındaki aktif üyenin gönüllü ayrılması.

İstemci istekleri `X-Workspace-Id` taşır. Oturum başka alana geçtiyse eski alanın istekleri `409 WORKSPACE_CHANGED` alır; istemci bootstrap verisini yeniler. Aktif alan `/api/auth/me` üzerinden tekrar okunabilir. Sunucu HTTP, dosya, özel mesaj ve Socket.IO erişiminde aktif üyeliği doğrular; gecikmiş yazma işlemleri de alanı yeniden kontrol eder.

Normal alan değiştirmede `workspace:changed` yalnız değiştirilen oturuma bildirilir. Silme veya ayrılmada etkilenen hesabın diğer oturumları da alan listesini yeniler; yalnız artık erişilemeyen alana bağlı oturumların bağlamı değiştirilir ve görüşmeleri kapatılır. Başka çalışma alanındaki görüşmeler devam eder. `voice:roster` yalnızca ilgili çalışma alanının sesli odalarını içeren tam snapshot gönderir; `voice:roster:request` yeniden bağlanmada güncel listeyi ister.

## Silme, ayrılma ve son çalışma alanı

Alan sahibi **Çalışma alanı ayarları → Çalışma alanını sil** yolunu kullanır. Pencere, silinecek içerik miktarlarını gösterir. Güncel alan adı eksiksiz yazılıp mevcut parola girilir; sunucu sahipliği, oturumu, adı ve parolayı işlem sırasında tekrar doğrular. Yönetici veya sistem yöneticisi rolü tek başına silme yetkisi vermez. Örnek alanlarda bu işlem kapalıdır.

Silme tüm ekip için kalıcıdır: alanın kanalları, mesajları, dosyaları, davetleri ve ilgili entegrasyonları kaldırılır. Kullanıcı hesapları, profil fotoğrafları, güvenlik ayarları ve diğer alanlardaki içerik korunur. Veritabanı işlemi tamamlanmadan fiziksel dosyalar silinmez; kilitli/yetim dosyalar mevcut bakım döngüsünde tekrar temizlenir. İşlemin denetim kaydı alan silinse de kalır.

Üyeler alan menüsündeki **Çalışma alanından ayrıl** ile yalnız kendi üyeliklerini sonlandırır; mesaj geçmişi ekipte kalır. Alan sahibi ayrılmadan önce mevcut sahiplik devri akışını kullanmalıdır. Gönüllü ayrılan kişi geçerli davetle yeniden katılabilir; eski özel kanal ve özel mesaj üyelikleri otomatik geri gelmez. Yönetici tarafından çıkarılan veya askıya alınmış üyelik davetle açılamaz.

Silme/ayrılmadan sonra erişilebilir başka bir alan varsa ona geçilir. Son alan sona ermişse hesap açık kalır: **Çalışma alanı oluştur**, **Davet ile katıl**, hesap güvenliği ve çıkış eylemleri sunulur. Yenileme veya yeniden giriş de bu ekrana döner. Boş alan durumundaki hesap bir çalışma alanı rolü taşımaz; kanal ve görüşme API'lerine erişemez.

Kimlik doğrulama ve alan işlemleri `SessionBootstrap` yanıtı verir: alanlı durumda mevcut `Bootstrap`, alansız durumda `accountOnly: true`, `workspace: null`, rolsüz hesap profili ve boş kanal/üye listeleri vardır. Hesap güvenliği, oturum listesi, parola/profil işlemleri ve iki aşamalı giriş alan üyeliğinden bağımsız çalışır.

Doğrulama: dokuz yeni sunucu senaryosu silme yetkisi, son alan, yeniden giriş/katılım, iki aşamalı giriş, özel erişimin geri gelmemesi, eşzamanlı değişimler, dosya rollback'i ve v7 göçünü kapsar. Sunucu paketinin tamamı 158/158 geçti. Üç yeni yaşam döngüsü tarayıcı senaryosu; son alanın silinmesi, yeniden giriş/oluşturma, iki sekmeli alan geçişi, ayrılma ve özel kanal erişimi geri gelmeden yeniden katılmayı doğruladı. Mevcut çalışma alanı ve sesli görüşme tarayıcı kontrolleri de geçti.

Çalışma alanı kalmayan doğrulanmış sistem yöneticisi hesap ekranından **Uygulama yönetimi** açabilir; global API ve CLI yetkisi alan üyeliğinden bağımsızdır. Bu durum herhangi bir çalışma alanı yetkisi üretmez. Gerçek alansız hesaplar global kullanıcı listesinde yönetilebilir; demo/bot sınırları ve son sistem yöneticisi koruması sürer. Bu sınırlar beş sunucu/CLI ve bir tarayıcı regresyonuyla doğrulandı.
