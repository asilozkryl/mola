# Mola Android

Android istemcisi mevcut Mola sunucusuna bağlanır. Kotlin `Activity` ve Android
System WebView kullanır; sunucu veya veritabanı telefonda çalıştırılmaz. Uygulama
kimliği `app.mola.mobile`, minimum sürüm Android 8.0 (API 26), hedef API 36'dır.

## Derleme

Gerekenler:

- JDK 17.
- Android SDK: `platforms;android-36`, `build-tools;35.0.0`, `platform-tools`.
- İlk derlemede bağımlılık indirmek için internet bağlantısı.

```sh
cd mobile/android
export JAVA_HOME=/path/to/jdk-17
export ANDROID_HOME=/path/to/android-sdk
./gradlew testDebugUnitTest lintDebug assembleDebug
```

Windows'ta aynı komutları `gradlew.bat` ile çalıştırın. Android Studio ile
`mobile/android` klasörünü proje olarak açmak da mümkündür. SDK yolu için
`local.properties` içinde `sdk.dir=/path/to/android-sdk` kullanılabilir; bu dosya
Git'e eklenmez.

APK: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`.

```sh
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n app.mola.mobile/.MainActivity
```

Gradle 8.13, Android Gradle Plugin 8.13.2 ve Kotlin 2.3.10 sabitlenmiştir.
[AGP uyumluluk tablosu](https://developer.android.com/build/releases/agp-8-13-0-release-notes)
JDK 17 / Gradle 8.13 gereksinimini;
[Kotlin uyumluluk tablosu](https://kotlinlang.org/docs/gradle-configure-project.html)
seçilen Kotlin sürümünün Gradle ve AGP aralığını belirtir. Wrapper JAR dosyası
resmî Gradle kaynağından alınmış ve SHA-256 değeri doğrulanmıştır;
`mobile/android/gradle/wrapper/PROVENANCE.md` kaynak ve checksum bilgilerini içerir.

## Bağlanma

İlk açılışta `https://mola.sirketiniz.com` gibi **sunucunun kök adresini** girin.
Sunucu geçerli bir HTTPS sertifikası sunmalıdır; sertifika hataları atlanmaz.
Giriş, iki aşamalı doğrulama ve çalışma alanı seçimi mevcut web uygulamasında
aynı şekilde çalışır. Sunucu adresi ve kalıcı oturum çerezleri uygulama açılışları
arasında saklanır. Web arayüzünden çıkış yapılabilir.

Üstteki **Yenile** mevcut sayfayı yeniler. **Sunucu → Değiştir** bağlantı ekranını
açar. Farklı sunucuya bağlanıldığında eski oturum çerezleri ve WebView yerel
verileri (yerel taslaklar dahil) temizlenir. Android geri hareketi WebView
geri geçmişini kullanır; geçmiş yoksa uygulamayı kapatır.

Yalnızca debug derlemesinde `http://localhost`, `http://127.0.0.1`, `http://[::1]`
ve Android emülatöründen bilgisayara ulaşan `http://10.0.2.2` adresleri kabul
edilir. Fiziksel telefon için `adb reverse tcp:3000 tcp:3000` sonrasında
`http://127.0.0.1:3000` kullanılabilir. Sunucu, derlenmiş web arayüzünü de aynı
adreste sunmalıdır. Release derlemesinde HTTP kapalıdır. Kamera/mikrofon testi
ve yerel indirme testi için HTTPS kullanın.

## Desteklenen mobil davranışlar

- Telefonun çentik/sistem çubukları ve ekran klavyesi için pencere boşlukları.
- Sunucuya ulaşılamadığında yeniden deneme ve adres değiştirme ekranı.
- Bağlı sunucudaki normal gezinme; kullanıcının dokunduğu dış HTTPS bağlantısı
  sistem tarayıcısında açılır. Otomatik dış yönlendirmeler, HTTP dış bağlantılar,
  `intent:`, `file:`, `javascript:` gibi özel şemalar engellenir.
- Ses/görüntü görüşmesinde, yalnızca bağlı sunucu için ve web sayfasının istediği
  ses/video kaynakları için Android mikrofon/kamera izni istenir. İzin reddi
  aşılmaz; bekleyen istekler gezinme, iptal ve Activity kapanışında bırakılır.
- PNG, JPEG, GIF, WebP, PDF, TXT ve CSV dosyaları sistem belge seçicisinden
  eklenebilir. Dosya girişi daha dar bir tür listesi istiyorsa buna uyulur.
  Galeri/depolama genel erişim izni istenmez; dosya başına sunucu sınırı 10 MB'dır.
- HTTPS üzerinden aynı sunucudaki `/api/files/<UUID>` dosyaları, oturum çerezi
  kullanılarak indirilir ve sistemin **Farklı kaydet** seçicisinde kaydedilir.
  İndirmeler yönlendirme izlemez; yabancı sunucuya çerez gönderilmez. Yanıt kodu,
  dosya türü ve en fazla 10 MB gövde sınırı doğrulanır. Geçici dosya uygulamanın
  özel önbelleğinde tutulur, kaydetme/iptal sonrası silinir.
- JavaScript ile yerel Android API'leri arasında köprü yoktur. Uzak sayfaya
  dosya sistemi veya uygulama ayrıcalıkları açılmaz.

## Sınırlar ve dağıtım

WebView istemcisi uygulama kapalıyken yerel push bildirimi, arka planda sürekli
ses görüşmesi veya telefon ekranını yayınlama sağlamaz. Bu sürümde bu özellikler
uygulanmamıştır. Web arayüzündeki ön plan davranışı cihazın güncel Android System
WebView sürümüne ve izinlerine bağlıdır. Ekran yayınını masaüstünde kullanın.

JavaScript `blob:` bağlantısı ile üretilen dosyalar (örneğin kurtarma kodlarının
metin indirmesi) yerel indirme yolunda desteklenmez; bunları telefonun
tarayıcısından indirebilir veya web arayüzündeki kopyalama seçeneğini kullanabilirsiniz.

`assembleDebug` geliştirme sertifikalı, kurulabilir APK üretir. `assembleRelease`
ve `bundleRelease` imzalama yapılandırması olmadan mağazaya gönderilemez. Google
Play dağıtımı için geliştirici hesabı, size ait upload keystore, release imzalama
ve mağaza/gizlilik bilgileri ayrıca gerekir. Anahtarları veya parolaları Git'e
koymayın. Bu proje mağazaya yükleme ya da dağıtım yapılmış olduğunu iddia etmez.

Fiziksel cihazda yayın öncesi doğrulama: giriş/çıkış ve 2FA, uygulamayı kapatıp
tekrar açma, klavye açıkken mesaj gönderme, kamera/mikrofon izin kabulü ve reddi,
izin istemi sırasında gezinme, dosya seçme/kaydetme/iptal, bağlantı kaybı ve yeniden
deneme, dış linkler, ekran döndürme ve geri hareketi. JVM testleri URL, gezinme,
indirme yolu ve güvenli dosya adı politikasını doğrular; donanım/cihaz testinin
yerine geçmez.

## Emülatörde bağımsız çalışma kontrolü

Android SDK'ya `emulator` ve `system-images;android-36;google_apis;x86_64`
paketlerini kurun. Kendi verilerinizle karışmaması için ayrı bir AVD ve test
sunucusu kullanın. Aşağıdaki komutlar depo kökünden çalıştırılır:

```sh
export ANDROID_AVD_HOME="$HOME/.cache/mola-mobile-test-avd"
mkdir -p "$ANDROID_AVD_HOME"
printf 'no\n' | "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" create avd \
  --name MolaTest --package 'system-images;android-36;google_apis;x86_64' --device pixel_7
"$ANDROID_HOME/emulator/emulator" -avd MolaTest -port 5562 -no-audio -no-boot-anim -gpu swiftshader
```

Ayrı terminallerde geçici veri diziniyle test sunucusunu ve Vite'ı başlatın:

```sh
mola_test_data=$(mktemp -d)
NODE_ENV=test ENABLE_DEMO=true DATA_DIR="$mola_test_data" \
  APP_ORIGIN=http://localhost:5181 PORT=3181 HOST=127.0.0.1 \
  node --import tsx server/index.ts
```

```sh
API_PROXY_TARGET=http://127.0.0.1:3181 \
  node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5181 --strictPort
```

```sh
"$ANDROID_HOME/platform-tools/adb" -s emulator-5562 install -r mobile/android/app/build/outputs/apk/debug/app-debug.apk
"$ANDROID_HOME/platform-tools/adb" -s emulator-5562 reverse tcp:5181 tcp:5181
"$ANDROID_HOME/platform-tools/adb" -s emulator-5562 shell am start -n app.mola.mobile/.MainActivity
```

Uygulamada `http://localhost:5181` adresine bağlanın. Önce kullanılmayan bir
localhost portuyla bağlantı hatası ve yeniden deneme ekranını; ardından örnek
çalışma alanında mesaj gönderme, klavye açıkken **Gönder** düğmesine erişme,
yatay/dikey dönüş ve uygulamayı kapatıp açınca oturumun korunmasını kontrol edin.
Android 11+ üzerinde klavye açıldığında yerel üst araç çubuğu gizlenir; klavye
kapanınca geri gelir. Böylece yatay kullanımda yazma alanına yer kalır.

İşiniz bitince test sunucularını durdurun ve emülatörü kapatın:

```sh
"$ANDROID_HOME/platform-tools/adb" -s emulator-5562 reverse --remove tcp:5181
"$ANDROID_HOME/platform-tools/adb" -s emulator-5562 emu kill
```

Debug derlemesinde WebView DevTools açıktır. Geliştirme testinde CDP ile DOM ve
viewport boyutları incelenebilir; release derlemesi bu erişimi açmaz. Testte
oturum çerezlerini veya kişisel verileri loglamayın.

13 Eylül 2026 tarihinde API 36 / Pixel 7 x86_64 emülatöründe gerçek APK ile
başlangıç ekranı, bağlantı hatası, sunucu değiştirme, örnek alan yükleme, mesaj
gönderme, dönüş/yeniden açılışta oturum ve gönderilmiş mesajın korunması doğrulandı.
Gerçek ekran klavyesi açıkken dikey 412×527 ve yatay 863×122 WebView alanlarında
mesaj alanı ve **Gönder** düğmesi görünür kaldı; yatay durumda düğmeye dokunarak
mesaj gönderildi. Aynı localhost'un başka portuna form POST gezinmesi, izole
alıcıya hiçbir istek ulaşmadan engellendi (testte CSP ayrıca devre dışı bırakılıp
geri açılarak yerel gezinme koruması tek başına sınandı). Kamera/mikrofon,
belge sağlayıcıları ve gerçek cihaz donanımı bu emülatör kontrolüne dahil değildir.
