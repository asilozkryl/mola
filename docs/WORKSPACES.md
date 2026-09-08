# Çalışma alanları ve sesli oda katılımcıları

## Kullanım

Sol üstteki çalışma alanı adı **Çalışma alanların** penceresini açar. Sol şeritte üye olduğunuz alanların simgeleri bulunur; bir simgeye tıklayarak geçebilirsiniz. Telefonda gezinme menüsünü açıp üstteki alan adına dokunun.

- **Yeni çalışma alanı:** adını yazıp oluşturun; mevcut hesabınız yeni alanın sahibi olur.
- **Davetle katıl:** alan sahibinin gönderdiği Mola bağlantısını veya davet kodunu yapıştırın. Mevcut hesabınızla üye olursunuz. Oturum kapalıyken davet bağlantısından giriş yaparsanız davet katılma ekranına taşınır.
- **Görüşme sırasında geçiş:** uygulama görüşmeden ayrılacağınızı gösterir. Vazgeçebilirsiniz; devam ettiğinizde cihaz ve bağlantı kaynakları kapatılır. Kanal taslakları korunur.

Bir hesabın farklı alanlarda farklı rolleri olabilir. Alan sahibinin bir üyeliği askıya alması diğer ekiplerdeki üyelikleri veya geçmiş mesajları silmez. Erişilemeyen bir alandan diğer ekiplerinize geçebilir, yeni bir alan açabilir veya başka bir davete katılabilirsiniz. Askıya alınmış üyelik davetle yeniden etkinleştirilmez; ilgili yöneticinin erişimi açması gerekir. Demo hesapları başka ekip kuramaz veya gerçek ekiplere katılamaz.

Aktif alan oturuma bağlıdır: aynı oturum çerezini paylaşan sekmeler birlikte değişir. Bağımsız giriş yapılmış başka tarayıcı veya cihaz kendi aktif alanında kalır. Kaydedilen mesajlar bu tarayıcıda hesap ve alan bazında tutulur; cihazlar arası eşitlenmez. Mesaj taslakları da kullanıcı, kanal ve yanıt dizisine göre ayrılır. Eski sürümde sahibi kaydedilmeyen taslaklar başka hesaba gösterilmemesi için otomatik taşınmaz; eski tarayıcı kayıtları silinmez.

Sesli odanın altındaki liste, o an bağlı kişileri ve mikrofon/kamera/ekran paylaşımı durumlarını gösterir. Odanın yanındaki kişi simgesi, katılmadan ayrıntılı listeyi açar. Bağlantı kesildiğinde liste gizlenir ve yeniden bağlanınca güncellenir. Özel mesajlardaki veya metin kanallarındaki görüşmeler sesli oda listesine dahil edilmez.

## Çalışma alanına davet ve kanala üye ekleme

**Çalışma alanına davet et** yalnızca alan üyeliği sağlar. Yeni üyeler açık kanallara erişebilir; özel yazılı ve sesli kanallara otomatik eklenmez. **Kanal hakkında → Kanala üye ekle** veya kanalın üye listesindeki aynı düğme, o kanalın erişim ekranını açar. Çalışma alanı daveti üretmez. Kanal üyeliğini kaldırmak kişinin çalışma alanı üyeliğini sonlandırmaz.

Özel kanalda **Bu kanalda** ve **Çalışma alanından ekle** listeleri ayrıdır. İsim/e-posta araması, eklenecek ve kaldırılacak kişiler ile kaydedilmemiş değişiklik özeti gösterilir. Açık kanallarda alan üyelerinin erişimi otomatik olduğundan kutuları salt okunurdur; misafirler ayrıca seçilir. Erişimi yalnızca seçilen kişilerle sınırlamak için kanal özel olmalıdır. Kendi özel kanal üyeliğini kaldırmak ve özel kanalı herkese açmak sonuçları açıklanan ikinci kaydetme adımıyla tamamlanır.

Bu arayüz güncellemesi erişim yetkilerini değiştirmez: kanal üyelerini alan sahibi/yöneticiler yönetir, özel kanal içeriği yönetici için de açık kanal üyeliği gerektirir. Yeni hesap ve mevcut hesapla davet, özel mesaj/dosya/arama/sesli oda erişimi, üyelik ekleme-kaldırma için sunucu regresyonları eklendi. 11 ilgili tarayıcı senaryosu, 18 sunucu testi ve üretim derlemesi geçti; 320 px ekran ve axe denetimi de doğrulandı.

## Veri geçişi ve dağıtım

Çalışma alanı üyelikleri şema **v4** ile ayrılmıştır; güncel şema **v6**'dır. v5 kanal gizliliği/rolleri, v6 profil alanlarını ekler. Uygulama ilk açılışta eski veriyi otomatik yükseltir. Hesap kimlikleri, mesajlar, dosyalar, oturumlar, davetler ve mevcut roller korunur; ilk üyelik eski çalışma alanından oluşturulur. Kimlik artık eski ana alanın silinmesine bağlı değildir.

Dağıtımdan önce [tam yedek](DEPLOYMENT.md) alın: SQLite, yüklenen dosyalar ve gerekli şifreleme anahtarları birlikte korunmalıdır. Migration transaction içinde çalışır ve yabancı anahtar tutarlılığını doğrular. Geri dönüş gerekirse yeni şemayı eski uygulama imajıyla açmayın; önceki sürüme uygun yedeği ayrı bir volume'a geri yükleyip doğrulayın. Şema numarasını elle düşürmeyin.

Yeni ortam değişkeni veya OAuth ayarı gerekmez. Google ile giriş bu sürümün kapsamı dışındadır. Tek uygulama kopyası şartı devam eder; görüşme ve çevrimiçi durumları süreç belleğindedir.

## API ve gerçek zamanlı kapsam

- `GET /api/workspaces`: üyelikler ve aktif alan.
- `POST /api/workspaces {name}`: oluştur ve bu oturumda geç.
- `POST /api/workspaces/join {inviteToken}`: davetle katıl ve geç.
- `POST /api/workspaces/:id/switch`: mevcut üyeliğe geç.

İstemci istekleri `X-Workspace-Id` taşır. Oturum başka alana geçtiyse eski alanın istekleri `409 WORKSPACE_CHANGED` alır; istemci bootstrap verisini yeniler. Aktif alan `/api/auth/me` üzerinden tekrar okunabilir. Sunucu HTTP, dosya, özel mesaj ve Socket.IO erişiminde aktif üyeliği doğrular; gecikmiş yazma işlemleri de alanı yeniden kontrol eder.

`workspace:changed` sadece değiştirilen oturuma bildirilir. `voice:roster` yalnızca ilgili çalışma alanının sesli odalarını içeren tam snapshot gönderir; `voice:roster:request` yeniden bağlanmada güncel listeyi ister.
