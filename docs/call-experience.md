# Görüşme ve ekran paylaşımı

Sesli kanal veya **Bir araya gel** düğmesi görüşme hazırlığını açar. Mikrofon testi isteğe bağlıdır; ekran açıldığında cihaz erişimi istenmez. **Mikrofonu test et** ses seviyesini gösterir. Test sesi kaydedilmez ve ağ üzerinden gönderilmez. Test durdurulunca, hazırlık kapanınca veya görüşmeye katılınca testin cihazları bırakılır. Bekleyen izin daha sonra verilse de iptal edilen testin cihazları kapatılır.

**Mikrofonum kapalı katıl** görüşmeye sessiz katılmayı sağlar. Mikrofon erişimi yine gerekir; ses gönderimi kapalı başlar. Görüşmedeki **Ses ayarları** giriş cihazını açık bağlantıları koruyarak değiştirir. Cihaz seçimi başarısız olursa çalışan mikrofon korunur. Mikrofon ve hoparlör tercihi açık uygulamadaki sonraki görüşmelerde kullanılır.

Hoparlör seçimi tarayıcının `setSinkId` desteğini ve cihaz izinlerini kullanır. Destek olmadığında arayüz sistem ses ayarlarına yönlendirir. Bazı tarayıcılarda **Başka bir hoparlör seç** ayrıca cihaz izni açar. Seçim hataları kullanıcıya gösterilir; farklı bir çıkışa geçildiği varsayılmaz. [MDN: ses çıkışı seçimi](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/setSinkId)

Katılımcının çerçevesi yalnız alınan veya yerel mikrofon sesinin ölçülmüş seviyesiyle vurgulanır. Sessiz mikrofon konuşuyor olarak gösterilmez. Analiz tarayıcıda yapılır; ses seviyesi verisi sunucuya gönderilmez.

Bağlantı göstergesi bağlı her katılımcı için gerçek WebRTC istatistiklerini 2,5 saniyede bir okur. Gecikme, ses paketlerinin zamanlama dalgalanması ve son ölçüm aralığındaki paket kaybı üzerine gelindiğinde görünür. Ölçüm bulunmadığında **Ölçülüyor** gösterilir. **Orta** eşikleri 200 ms gecikme, 30 ms dalgalanma veya %2 kayıp; **Zayıf** eşikleri 500 ms, 50 ms veya %5 kayıptır. Bu eşikler tanılama amacıyla kullanılır, ses kalitesi garantisi değildir. [MDN: WebRTC istatistikleri](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/getStats)

Ekran paylaşımının üstündeki düğmeler görüntüyü tam ekrana veya ayrı pencereye taşır. Tam ekran desteği yoksa uygulama içinde büyütme kullanılır. Destekleyen tarayıcılarda ayrı pencere Document Picture-in-Picture ile açılır; diğerlerinde aynı paylaşım akışı açılır pencerede gösterilir. Yeni ekran yakalama izni istenmez. Paylaşım bittiğinde ya da görüşmeden ayrılınca pencere kapanır. **Sohbete dön** görüşmeyi küçük kontrol çubuğuna indirir; ses ve paylaşım devam eder. [MDN: Document Picture-in-Picture](https://developer.mozilla.org/en-US/docs/Web/API/Document_Picture-in-Picture_API)

Sesli kanal katılımcı listeleri her bağlantının güncel kanal erişimine göre gönderilir. Özel kanalların katılımcıları yetkisi olmayan üyelere yayınlanmaz. Yetki kaldırıldığında katılımcı listesi yenilenir ve devam eden görüşme erişimi kapatılır.

Doğrulama: `node --import tsx --test tests/call-quality.test.ts tests/voice-presence.test.ts` ve `npx playwright test tests/calls.e2e.spec.ts`. Tarayıcı testleri gerçek WebRTC bağlantılarıyla ses, kamera ve ayrı ekran video izinin RTP aktarımını; cihaz temizliğini, izin iptalini, mikrofon değişimini, büyütmeyi ve ayrı pencere yaşam döngüsünü kontrol eder. Otomasyonda sistem ekran seçicisi yerine hareketli bir canvas video izi kullanılır.
