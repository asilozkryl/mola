# Mola — iOS ve Android

Mobil uygulamalar mevcut HTTPS Mola sunucusunu açar: Android'de Kotlin/WebView,
iOS'ta UIKit/WKWebView. Aynı React arayüzü, HttpOnly oturumları, API ve Socket.IO
bağlantısı kullanılır. Sunucu adresi ilk açılışta girilir; yerel bir sunucu,
veritabanı veya JavaScript üzerinden native yetki köprüsü çalıştırılmaz.

## Mobil arayüz

- Telefon ve dokunmatik tabletlerde Enter yeni satır açar. Gönder düğmesi veya
  harici klavyede Ctrl/⌘+Enter mesajı gönderir. Masaüstü Enter davranışı korunur.
- Klavye açılınca görünür ekran yüksekliği izlenir; yazma alanı ve gönder düğmesi
  klavyenin üstünde kalır. Yakınlaştırma hareketleri arayüzü yeniden boyutlandırmaz.
- Ekran çentiği, alt hareket alanı, dikey/yatay kullanım ve 16 px yazma alanları
  desteklenir. Mevcut kanal çekmecesi ve dokunmatik mesaj işlemleri korunur.
- Mobil arayüz güncellemeleri sunucuya web uygulaması dağıtıldığında istemcilere
  ulaşır. Native davranış değişiklikleri için uygulama paketi yeniden kurulmalıdır.

## Android

Android 8.0+ (API 26); hedef SDK 36. JDK 17 ve Android SDK platform 36 /
build-tools 35.0.0 gerekir. `ANDROID_HOME` SDK kurulum dizinini göstermelidir.

```sh
npm run mobile:android:check
# APK: mobile/android/app/build/outputs/apk/debug/app-debug.apk
adb install -r mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

Telefona APK'yı kopyalayıp açarak da kurabilirsiniz. Bu bir debug/test paketidir;
Play Store için kalıcı yükleme anahtarıyla imzalanmış release AAB gerekir.
Native izinler, indirmeler, geliştirme adresleri ve release adımları:
[Android rehberi](MOBILE_ANDROID.md).

## iOS

iOS/iPadOS 17+; derleme için macOS, Xcode ve XcodeGen gerekir.

```sh
npm run mobile:ios:generate
open mobile/ios/Mola.xcodeproj
```

Xcode'da `Mola` şemasını ve bir iPhone simülatörünü seçip çalıştırın. Fiziksel
iPhone veya TestFlight dağıtımı için Apple geliştirici hesabı/team seçimi,
imzalama ve uygun provisioning gerekir. Linux'ta iOS paketi derlenemez.
Komut satırı ve cihaz kontrolleri: [iOS rehberi](MOBILE_IOS.md).

## Doğrulama ve CI

```sh
npm ci
npm run build
npm test
npx playwright install --with-deps chromium webkit
npm run test:mobile
npm run mobile:android:check
```

Mobil tarayıcı paketi iPhone/WebKit ve Android/Chromium emülasyonlarında mesaj
gönderme/yenileme, dokunmatik gezinme/yanıt, yatay yerleşim, simüle edilmiş
klavye yüksekliği, güvenli ekran boşlukları ve yakınlaştırmayı kontrol eder.
Masaüstü projesi normal Enter gönderimini kontrol eder. Emülasyon testleri
fiziksel iPhone, Android klavyesi veya native WebView testi yerine geçmez.

`Build Mola Mobile` GitHub Actions iş akışı Android testleri/lint/APK, macOS'ta
iOS simülatör derlemesi/testleri ve iki tarayıcı motorundaki mobil kontrolleri
çalıştırır. Artifacts bölümüne debug APK ve yalnızca simülatörde kullanılabilen
iOS uygulaması eklenir. Mağazaya yayın veya imzalı iPhone IPA üretmez.

## Mevcut sınırlar

- Ön plandaki kamera/mikrofon için işletim sistemi ve WebView izin akışları
  vardır; gerçek cihazda görüşme, Bluetooth ve ses yönlendirmesi doğrulanmalıdır.
- APNs/FCM arka plan bildirimi, CallKit/Android Telecom, arka planda kesintisiz
  görüşme ve ReplayKit/MediaProjection ekran yayını bu sürümde uygulanmadı.
  Web arayüzündeki bildirim/ekran paylaşımı kullanılabilirliği WebView'e bağlıdır.
- Android'de kimlik doğrulamalı sohbet eki indirmeleri native belge kaydetme
  ekranını kullanır. `blob:` kurtarma kodu dosyaları native köprü olmadan
  indirilemez; güvenlik ekranındaki kodları kopyalama kullanılabilir.
- İnternet bağlantısı gerekir. Harici bağlantılar sistem tarayıcısında açılır;
  sunucu oturum çerezleri o tarayıcıya aktarılmaz.
- Mağaza açıklamaları, gizlilik beyanları, imzalama ve gerçek cihaz kabul
  kontrolleri dağıtılacak uygulamaya ve işletmeciye göre tamamlanmalıdır.
