# Mola iOS istemcisi

`mobile/ios` iOS 17 ve üzeri iPhone/iPad cihazları için UIKit ve WKWebView istemcisidir. Mevcut Mola HTTPS sunucusunun mobil arayüzünü açar. Telefonda sunucu çalıştırmaz; giriş, mesajlaşma ve Socket.IO bağlantısı mevcut sunucuda kalır.

## Kullanım

İlk açılışta canlı Mola sunucusu için `https://mola.psychodry.cloud` adresini girip **Bağlan** düğmesine dokun. Kendi Mola sunucunu kullanıyorsan onun HTTPS kök adresini girebilirsin. Sunucu adresi bu cihazda saklanır. Sunucudaki mevcut hesabınla giriş yapabilirsin. Üstteki yenile düğmesi sayfayı yeniden yükler; seçenekler menüsünden **Geri** veya **Sunucuyu değiştir** seçilebilir. iOS geri kaydırma hareketi de açıktır.

Adres HTTPS olmalıdır. Sayfa yolu, sorgu, URL içinde kullanıcı/parola ve özel URL şemaları kabul edilmez. Mola sunucusunun `APP_ORIGIN` değeri girilen adresle eşleşmeli, sertifikası cihaz tarafından geçerli sayılmalıdır. Sertifika doğrulaması kapatılmaz.

Her sunucu kökeni (`https`, ana makine, port) SHA-256 ile türetilen kalıcı bir WKWebsiteDataStore kimliği kullanır. Bu, aynı ana makinenin farklı portlarındaki sunucular arasında bile oturum paylaşımını önler. Sunucu değiştirildiğinde eski görünüm ve indirmeler kapatılır; önceki sunucunun oturumu kendi deposunda kalır. Oturumu sonlandırmak için Mola içindeki çıkış işlemini kullan. İstemci çerezleri JavaScript'e veya harici tarayıcıya aktarmayan bir yapı kullanır; yerel JavaScript köprüsü eklenmemiştir.

## Kendi iPhone'una ücretsiz kurulum

Kendi iPhone'unda denemek için ücretsiz Apple Account ve Xcode'daki **Personal Team** yeterlidir; ücretli Apple Developer Program üyeliği, App Store'a yükleme veya Expo gerekmez. Bu yöntem Xcode'dan kendi cihazına geliştirme kurulumu içindir. Üyelik olmadan başkalarına IPA veya kurulum bağlantısı dağıtımı sağlamaz. Ücretsiz hesabın provisioning profili yedi gün geçerlidir; ardından aynı projeden yeniden kurulum gerekir. [Apple hesap türleri ve Personal Team sınırları](https://developer.apple.com/help/account/basics/about-your-developer-account).

### Mac'i ve projeyi hazırla

1. Mac'e Xcode'u kurup bir kez aç. İlk açılışta istenen bileşenlerin ve iOS desteğinin kurulumunu tamamla. Xcode sürümü iPhone'undaki iOS sürümünü desteklemeli; Mola iOS 17 veya üzerini gerektirir.
2. XcodeGen 2.42 veya üzerini kur. Homebrew kullanıyorsan `brew install xcodegen` komutunu çalıştırabilirsin.
3. [Mola deposunu](https://github.com/asilozkryl/mola/tree/codex/initial-release) Mac'e klonla veya bu dalın **Code → Download ZIP** seçeneğiyle kaynak kodunu indirip aç. Klonlamak için:

   ```sh
   git clone --branch codex/initial-release https://github.com/asilozkryl/mola.git
   cd mola
   ```

4. Terminal'de indirdiğin deponun kök klasöründen projeyi aç:

   ```sh
   bash mobile/ios/open-project.command
   ```

Bu komut ilk kullanımda Xcode projesini üretip açar. `mobile/ios/Mola.xcodeproj` zaten varsa yeniden üretmez; Xcode'da yapacağın kişisel imzalama ayarlarını korur. Kaynak proje `mobile/ios/project.yml` dosyasıdır; oluşturulan `.xcodeproj` Git dışında tutulur. Sonraki kurulumlarda aynı klasörü ve projeyi kullan. `xcodegen generate` komutunu yeniden çalıştırmak, oluşturulan projede elle yaptığın imzalama ayarlarını sıfırlayabilir.

### İmzala ve iPhone'da çalıştır

1. Xcode'da **Settings → Apple Accounts** (eski sürümlerde **Accounts**) bölümünden kendi Apple Account'unu ekle.
2. Soldaki **Mola** projesini, ardından **TARGETS → Mola → Signing & Capabilities** bölümünü seç. **Automatically manage signing** açık olsun. **Team** alanında hesabının **Personal Team** seçeneğini seç.
3. **Bundle Identifier** alanındaki `app.mola.mobile` değerini sana ait benzersiz bir değerle değiştir. Örnek: `app.mola.asilozkirayil.mobile`. `app.mola.<ascii-kullanici>.mobile` düzeninde, kullanıcı kısmında boşluk veya Türkçe karakter olmadan Latin harfleri ve rakamlar kullan. Bu kimliği sonraki kurulumlarda aynı tut.
4. Kilidi açık iPhone'u USB ile Mac'e bağla. Telefonda sorulursa **Bu Bilgisayara Güven** seçeneğini onayla. Mac'te de bağlantıya izin ver.
5. iPhone'da **Ayarlar → Gizlilik ve Güvenlik → Geliştirici Modu** seçeneğini aç; yeniden başlatma ve son onayı tamamla. Bu seçenek görünmüyorsa önce telefonu Xcode ile eşleştirip çalıştırmayı dene. [Apple'ın Geliştirici Modu adımları](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device/).
6. Xcode'un üst çubuğunda **Mola** şemasını ve çalıştırılacak cihaz olarak kendi iPhone'unu seç. **Run** düğmesine bas veya `⌘R` kullan. İlk derleme ve cihaz hazırlığı birkaç dakika sürebilir. Xcode bir imzalama sorunu gösterirse **Signing & Capabilities** bölümündeki hesap, Team ve benzersiz Bundle Identifier değerlerini kontrol et.
7. iPhone geliştiriciye güvenmeni isterse **Ayarlar → Genel → VPN ve Aygıt Yönetimi** bölümünden kendi geliştirici hesabını onayla ve uygulamayı tekrar aç. Mola'nın sunucu ekranına `https://mola.psychodry.cloud` yazıp mevcut hesabınla giriş yap.

Xcode üzerinden fiziksel cihazı seçme ve çalıştırma için [Apple'ın cihazda çalıştırma rehberi](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices) kullanılabilir. Apple Account parolanı, imzalama anahtarlarını, sertifikaları veya provisioning profillerini depoya ekleme.

### Yedi gün sonra yenileme

Ücretsiz imza süresi dolduğunda uygulama açılmayabilir. iPhone'u Mac'e yeniden bağla, aynı depo klasöründen `bash mobile/ios/open-project.command` komutunu çalıştır ve aynı **Personal Team**, **Bundle Identifier** ve cihazla tekrar `⌘R` yap. Uygulamayı önce silmen gerekmez. Yeni bir Bundle Identifier kullanmak ayrı bir uygulama kurulmasına yol açar.

## Simülatör derlemesi ve doğrulama

16 Eylül 2026 tarihli [Build Mola Mobile CI çalışması](https://github.com/asilozkryl/mola/actions/runs/35111530110), `32896317ef53193941ab5e2a0e916e90877f08e5` commit'inde macOS üzerinde iPhone simülatörü derlemesini ve XCTest testlerini başarıyla tamamladı. Üretilen `Mola-simulator.zip` yalnız simülatör içindir; iPhone'a kurulabilir imzalı IPA değildir. Bu sonuç gerçek iPhone kurulumu veya görüşme testi yapıldığı anlamına gelmez. Linux çalışma ortamında Xcode/iOS SDK bulunmadığından yerel iOS derlemesi çalıştırılamaz.

Simülatör testleri için Xcode, XcodeGen 2.42 veya üzeri ve iOS 17+ simülatör çalışma zamanı olan bir Mac gerekir. Aşağıdaki proje üretme komutunu, kişisel imzalama ayarlarını korumak istediğin mevcut projede yeniden çalıştırma; ayrı bir depo kopyası kullan veya üretme satırını atla:

```sh
xcodegen generate --spec mobile/ios/project.yml
xcodebuild -project mobile/ios/Mola.xcodeproj -scheme Mola -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath mobile/ios/build CODE_SIGNING_ALLOWED=NO build-for-testing
xcrun simctl list devices available
```

Listeden kullanılabilir bir iPhone simülatörünün UUID değerini seçip testi çalıştır:

```sh
xcodebuild -project mobile/ios/Mola.xcodeproj -scheme Mola -configuration Debug -destination 'platform=iOS Simulator,id=SIMULATOR_UUID' -derivedDataPath mobile/ios/build CODE_SIGNING_ALLOWED=NO test
```

`MolaTests` URL/köken karşılaştırması, varsayılan port, sunucular arası oturum deposu ayrımı, dış bağlantı/yönlendirme politikası, dosya kaynakları, dosya adı temizleme ve sunucu ayarlarının kalıcılığını sınar. Simülatör testleri gerçek iPhone görüşme ve dosya seçme testlerinin yerini tutmaz.

Mevcut CI iş akışı cihaz imzalama, TestFlight dağıtımı veya App Store yayını yapmaz. Başka cihazlara dağıtılacak sürüm için uygun Apple Developer Program üyeliği, dağıtım yöntemi ve imzalama ayrıca hazırlanmalıdır.

## Dosyalar, görüşmeler ve sınırlar

- Dosya yükleme WebKit'in sistem seçicisini kullanır. Mevcut sunucu PNG, JPG, GIF, WebP, PDF, TXT ve CSV kabul eder; HEIC ve video yükleme eklenmemiştir.
- Oturum gerektiren `/api/files/<uuid>` ekleri aynı WKWebView oturumu üzerinden WKDownload ile indirilir. İndirme yalnızca aynı kökendeki ek adreslerine yönlendirilebilir. Tamamlandığında iOS paylaşım ekranındaki **Dosyalara Kaydet** kullanılabilir. İndirilen geçici kopya paylaşım kapandığında veya bir sonraki uygulama başlangıcında temizlenir.
- Güvenilen sayfanın oluşturduğu `blob:https://…` dosyaları da WKDownload'a yönlendirilir; örneğin kurtarma kodu dışa aktarımı. Bunun gerçek cihazdaki dosya adı ve paylaşım akışı ayrıca sınanmalıdır. `data:` veya yerel `file:` indirmeleri kabul edilmez. Yerel bir pano köprüsü yoktur; WebKit'in standart kopyala/yapıştır davranışı kullanılır.
- Kamera ve mikrofon yalnızca yapılandırılmış sunucunun ana çerçevesinden istenebilir. İstemci iOS/WebKit izin penceresini kullanır ve sayfa içinde video oynatmayı açar. Kullanıcı izni, çalışan HTTPS sunucusu ve WebRTC bağlantısı gerekir.
- Bu ilk istemciye APNs, CallKit, arka planda arama sürdürme veya ekran yayınlama uzantısı eklenmemiştir. Mevcut PWA Web Push desteği yerel iOS bildirim desteği anlamına gelmez. Arka plana geçince sistem web içeriğini askıya alabilir. Gelen ekran paylaşımını izleme ve ön planda ses/video gerçek iPhone üzerinde doğrulanmalıdır.
- Harici HTTPS bağlantıları yalnızca güvenilen ana sayfada kullanıcı bağlantıya dokunduğunda sistem tarayıcısına gönderilir. Harici otomatik yönlendirmeler, alt çerçeve izinleri ve özel URL şemaları engellenir. E-posta giriş/davet bağlantıları için Universal Links yapılandırılmamıştır.
- `PrivacyInfo.xcprivacy`, istemcinin yalnızca kendi sunucu ayarı için UserDefaults kullanımını `CA92.1` gerekçesiyle bildirir. Mağaza veri toplama beyanları, kullanılan Mola sunucusunun gerçek hesap/mesaj/dosya işleme davranışına göre ayrıca doldurulmalıdır.

## Gerçek cihaz kabul kontrolü

Giriş yaptıktan sonra uygulamayı tamamen kapatıp açarak oturumu kontrol et. Kanal ve doğrudan mesaj gönderimini, klavye açıkken en son mesaj/gönder düğmesi görünürlüğünü, portu farklı ikinci sunucuda yeniden giriş gerekliliğini, PDF/görsel ekleme-indirmeyi ve kurtarma kodu dışa aktarımını dene. Mikrofon/kamerayı hem reddederek hem izin vererek görüşmeye katıl; arka plana geçip dönmeyi dene. Bağlantı kesildiğinde tekrar deneme ve yanlış sunucu adresini değiştirme akışlarını kontrol et.

## API kaynakları

- [WKWebsiteDataStore](https://developer.apple.com/documentation/webkit/wkwebsitedatastore)
- [WKDownloadDelegate](https://developer.apple.com/documentation/webkit/wkdownloaddelegate)
- [WebKit medya izinleri](https://developer.apple.com/documentation/webkit/wkuidelegate/webview%28_%3Arequestmediacapturepermissionfor%3Ainitiatedbyframe%3Atype%3Adecisionhandler%3A%29)
- [Home Screen uygulamalarında iOS Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- [XcodeGen proje şeması](https://github.com/yonaskolb/XcodeGen/blob/master/Docs/ProjectSpec.md)
