# Tarayıcı bildirimleri

Bildirim ayarları, tarayıcının verdiği izin ile cihazın Mola hesabına bağlı olmasını ayrı gösterir. Kullanıcı **Bildirimler ve uygulama** ekranında tarayıcı iznini, bu cihazın bağlantısını ve hesabının bildirim tercihini görebilir.

## Durumlar ve eylemler

- İzin bekleniyor, izin engelli, hesap tercihi kapalı ve cihazın yeniden bağlanması gerekiyor durumları ayrı açıklanır.
- Güvensiz bağlantıda HTTPS adresine, desteklenmeyen tarayıcıda uygun bir tarayıcıya, iPhone/iPad'de gerektiğinde Ana Ekrana Ekle akışına yönlendirilir.
- Bildirim ayarları alınamadığında veya sunucudan kullanılabilir bildirim anahtarı gelmediğinde açma işlemi sunulmaz. **Durumu yenile** ile yeniden kontrol edilir.
- Pencereye dönüldüğünde, bağlantı geri geldiğinde ve sayfa yeniden görünür olduğunda izin ve mevcut abonelik kontrol edilir. Eski istekler iptal edilir; başka hesaba ait gecikmiş sonuçlar uygulanmaz.
- **Bu cihazda bildirimleri aç**, izni yalnız kullanıcının tıklamasıyla ister. Önceden izin verilmişse yeni izin penceresi açmadan mevcut aboneliği kullanır. Otomatik kontroller yeni abonelik oluşturmaz.
- **Tüm cihazlarda kapat**, hesabın tarayıcı bildirimlerini kapatır. Tarayıcının site izni korunur; bu işlem çalışma alanındaki okunmamış işaretlerini kapatmaz.

Abonelikler kullanıcı ve oturum bağlamıyla kaydedilir. Mevcut tarayıcı kaydı farklı bir sunucu anahtarıyla oluşturulmuşsa bağlı gibi gösterilmez. Kullanıcıya site bildirim iznini sıfırlayıp tekrar açması anlatılır; başka sekmenin kullanabileceği ortak tarayıcı aboneliği otomatik silinmez.

## Test bildirimi

**Test bildirimi gönder**, sunucunun gerçek push kuyruğundan kullanıcının mevcut oturumuna bağlı bu cihaza genel içerikli bir bildirim gönderir. Kullanıcı tıklamadan çalışmaz. Önce hesap için push izni ve mevcut cihaz bağlantısı gerekir. Bu açık teşhis eylemi sessizlik tercihlerini yalnız test için aşar.

Ekranda **kuyruğa alındı**, **bildirim sağlayıcısı kabul etti** ve **gönderilemedi** durumları ayrılır. Sağlayıcı kabulü, işletim sisteminin gerçekten gösterdiği kanıtı değildir. Geçici sağlayıcı hataları ve zaman aşımı sınırlı olarak yeniden denenir; kuyruk beklerken pencere kapatılabilir. Sonuç alınamadığında yeniden kontrol edilir. Test başına en çok beş deneme/beş dakika, cihaz oturumu başına bir dakika aralık uygulanır; bekleyen test tekrar kullanılır. Terminal teşhis kayıtları yedi gün tutulur. Başka kullanıcı, oturum veya çalışma alanından test sonucu okunamaz.

## Kişisel tercihler

Çalışma alanının varsayılanı **Tüm mesajlar**, **Bahsetmeler ve yanıtlar** veya **Kapalı** olabilir. Bahsetme seçeneği özel mesajları ve kanal çağrılarını da kapsar. Her kanal bu varsayılanı kullanabilir veya ayrı bir tercih seçebilir; sağ tık menüsündeki **Bildirim tercihleri** aynı ayarı doğrudan açar.

Çalışma alanı veya kanal 30 dakika, bir saat ya da seçili saat diliminde gün sonuna kadar susturulabilir. Sessiz saatlerin başlangıç/bitişi ve IANA saat dilimi ayrıca kaydedilir; gece yarısını aşan aralıklar desteklenir. Bu tercihler uygulama içi uyarılar ve tarayıcı push bildirimleri içindir. Aktivite kayıtları, okunmamış sayıları ve mesajların kendisi korunur. Üst çubuktaki uygulama içi sessize alma yalnız o tarayıcı için ek bir susturmadır. Hesabın **Tüm cihazlarda kapat** tercihi tüm çalışma alanlarında push'u kapatmaya devam eder.

Tercihler sunucuda kullanıcıya özel saklanır; diğer cihazlarda güncellenir. İşçi gönderim öncesi erişim, geçerli oturum, hesap push izni ve kanal/saat tercihini tekrar denetler. Susturulan bekleyen mesajlar daha sonra topluca gönderilmez.

## İşletim teşhisi

Yetkili `/internal/metrics` uç noktası `mola_push_queued`, `mola_push_oldest_queue_age_seconds`, sabit kategori başına `mola_push_delivery_total`, `mola_push_last_failure_timestamp_seconds` ve `mola_push_last_failure` değerlerini verir. Sağlayıcı 5xx, zaman aşımı, hız sınırı, bağlantı hatası ve süresi dolmuş abonelik ayrı kategorilerdir. Bu metriklerde kullanıcı/mesaj kimliği, endpoint, anahtar veya ham sağlayıcı yanıtı bulunmaz.

## Bildirime tıklama

Gerçek bildirim, varsa odaktaki Mola sekmesini kullanarak ilgili mesajı açar. Aynı adresteki yönetim sayfası hedef olarak seçilmez. Sekme kapanmışsa uygulamanın güvenli adresi yeni pencerede açılır. Dış adresler ve doğrulanmamış bağlantı parametreleri elenir. Test bildirimi, açık Mola sekmesine yalnız odaklanır ve mevcut konuşmayı değiştirmez.

## Doğrulama

8 Eylül 2026 ilk sürüm doğrulamasında bildirimlerle ilgili 15 tarayıcı senaryosu ve 9 istemci/worker birim testi geçti. Yeni tercih, gerçek test kuyruğu ve v10 veri geçişi sonuçları [beşinci paket kaydında](FIFTH_IMPROVEMENT_PACKAGE.md) izlenir.

- `tests/notification-settings.e2e.spec.ts`: yükleme hatası ve yeniden deneme, engelli/yenilenmiş izin, izin penceresini kapatma, eksik sunucu anahtarı, güvensiz/desteksiz/iOS ortamı, açık test isteği ve kuyruk/sağlayıcı ayrımı, izin iptali ve tekrar bağlama. Tarayıcı API'leri ve test gönderim uçları yalnız otomasyonda taklit edilir; backend testleri gerçek kuyruğa kontrollü transport bağlar.
- `tests/pwa.e2e.spec.ts` ve `tests/push-rebind.e2e.spec.ts`: mevcut izin, abonelik, çıkış/giriş, hesap değiştirme, çevrimdışı içerik ve uygulama yükleme regresyonları.
- `tests/notification-worker.test.ts`, `tests/push-client-state.test.ts` ve `tests/pwa.test.ts`: güvenli tıklama hedefi, test bildiriminin konuşmayı koruması, bildirim anahtarı uyumu ve özel içeriklerin çevrimdışı önbelleğe alınmaması.

Masaüstü ve 390 px mobil ekran görüntüleri görsel olarak incelendi; yatay taşma kontrol edildi. Canlı uygulamada gerçek push teslimatı, gerçek iOS cihazı ve işletim sistemi bildirim/odak ayarları bu çalışmada değiştirilmedi veya sınanmadı.

API davranışı için birincil kaynaklar: [MDN — showNotification](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification), [MDN — bildirim izni](https://developer.mozilla.org/docs/Web/API/Notification/requestPermission_static), [WebKit — iOS ve iPadOS Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).
