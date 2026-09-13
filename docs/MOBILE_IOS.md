# Mola iOS istemcisi

`mobile/ios` iOS 17 ve üzeri iPhone/iPad cihazları için UIKit ve WKWebView istemcisidir. Mevcut Mola HTTPS sunucusunun mobil arayüzünü açar. Telefonda sunucu çalıştırmaz; giriş, mesajlaşma ve Socket.IO bağlantısı mevcut sunucuda kalır.

## Kullanım

İlk açılışta `https://mola.ornek.com` gibi sunucunun kök adresini girip **Bağlan** düğmesine dokun. Sunucu adresi bu cihazda saklanır. Sunucudaki mevcut hesabınla giriş yapabilirsin. Üstteki yenile düğmesi sayfayı yeniden yükler; seçenekler menüsünden **Geri** veya **Sunucuyu değiştir** seçilebilir. iOS geri kaydırma hareketi de açıktır.

Adres HTTPS olmalıdır. Sayfa yolu, sorgu, URL içinde kullanıcı/parola ve özel URL şemaları kabul edilmez. Mola sunucusunun `APP_ORIGIN` değeri girilen adresle eşleşmeli, sertifikası cihaz tarafından geçerli sayılmalıdır. Sertifika doğrulaması kapatılmaz.

Her sunucu kökeni (`https`, ana makine, port) SHA-256 ile türetilen kalıcı bir WKWebsiteDataStore kimliği kullanır. Bu, aynı ana makinenin farklı portlarındaki sunucular arasında bile oturum paylaşımını önler. Sunucu değiştirildiğinde eski görünüm ve indirmeler kapatılır; önceki sunucunun oturumu kendi deposunda kalır. Oturumu sonlandırmak için Mola içindeki çıkış işlemini kullan. İstemci çerezleri JavaScript'e veya harici tarayıcıya aktarmayan bir yapı kullanır; yerel JavaScript köprüsü eklenmemiştir.

## Derleme

Linux üzerinde Xcode bulunmadığı için bu istemci burada iOS SDK ile derlenmedi ve iPhone üzerinde çalıştırılmadı. Derleme ve XCTest doğrulaması için Xcode ve iOS 17+ simülatör çalışma zamanı olan bir Mac gerekir. Kaynak proje `project.yml` dosyasıdır; oluşturulan `Mola.xcodeproj` Git dışında tutulur. XcodeGen 2.42 veya üzerini kurduktan sonra depo kökünde:

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

Xcode'da `mobile/ios/Mola.xcodeproj` açılıp **Mola** şeması seçilebilir. Varsayılan bundle ID `app.mola.mobile` değeridir. Gerçek iPhone kurulumu ve TestFlight/App Store paketi için **Signing & Capabilities** bölümünden kendi geliştirici takımını seç; gerekirse sana ait benzersiz bundle ID kullan. Kod imzalama anahtarlarını, sertifikaları ve provisioning profillerini depoya ekleme. Bu değişiklikler App Store'a yükleme veya mağaza onayı içermez.

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
