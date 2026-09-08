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

**Test bildirimi göster**, bu cihazın service worker kaydı üzerinden genel içerikli yerel bir bildirim gösterir. Kullanıcı tıklamadan çalışmaz. Gösterim hatasında yeniden denenebilir; işletim sisteminin bildirim veya odak ayarları nedeniyle görünmeme ihtimali ekranda açıklanır.

Bu eylem, sunucunun push kuyruğundan FCM, Apple veya Mozilla üzerinden uçtan uca teslimatı sınamaz. Ekrandaki başarı mesajı bildirimin tarayıcıya gönderildiğini bildirir; işletim sisteminde gerçekten görüntülendiğini iddia etmez.

## Bildirime tıklama

Gerçek bildirim, varsa odaktaki Mola sekmesini kullanarak ilgili mesajı açar. Aynı adresteki yönetim sayfası hedef olarak seçilmez. Sekme kapanmışsa uygulamanın güvenli adresi yeni pencerede açılır. Dış adresler ve doğrulanmamış bağlantı parametreleri elenir. Test bildirimi, açık Mola sekmesine yalnız odaklanır ve mevcut konuşmayı değiştirmez.

## Doğrulama

8 Eylül 2026 doğrulamasında bildirimlerle ilgili 15 tarayıcı senaryosu ve 9 istemci/worker birim testi geçti. TypeScript kontrolü de geçti.

- `tests/notification-settings.e2e.spec.ts`: yükleme hatası ve yeniden deneme, engelli/yenilenmiş izin, izin penceresini kapatma, eksik sunucu anahtarı, güvensiz/desteksiz/iOS ortamı, yerel test bildirimi, izin iptali ve tekrar bağlama. Tarayıcı API'leri yalnız test ortamında taklit edilir.
- `tests/pwa.e2e.spec.ts` ve `tests/push-rebind.e2e.spec.ts`: mevcut izin, abonelik, çıkış/giriş, hesap değiştirme, çevrimdışı içerik ve uygulama yükleme regresyonları.
- `tests/notification-worker.test.ts`, `tests/push-client-state.test.ts` ve `tests/pwa.test.ts`: güvenli tıklama hedefi, test bildiriminin konuşmayı koruması, bildirim anahtarı uyumu ve özel içeriklerin çevrimdışı önbelleğe alınmaması.

Masaüstü ve 390 px mobil ekran görüntüleri görsel olarak incelendi; yatay taşma kontrol edildi. Canlı uygulamada gerçek push teslimatı, gerçek iOS cihazı ve işletim sistemi bildirim/odak ayarları bu çalışmada değiştirilmedi veya sınanmadı.

API davranışı için birincil kaynaklar: [MDN — showNotification](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification), [MDN — bildirim izni](https://developer.mozilla.org/docs/Web/API/Notification/requestPermission_static), [WebKit — iOS ve iPadOS Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).
