# Görüşmeyi başka cihaza aktarma

Aynı hesap bir anda yalnızca bir cihaz veya sekmede görüşmede olabilir. Başka cihazda **Görüşmeye katıl** dediğinde, mikrofon erişimi ve görüşmeye katılım denetimleri tamamlanınca görüşme otomatik olarak o cihaza geçer. Önceki cihazın mikrofonu, kamerası, ekran paylaşımı ve WebRTC bağlantıları kapanır; mesajlaşma oturumu açık kalır. Bu kural farklı çalışma alanları ve görüşmeler arasında da geçerlidir. Sadece hesabına giriş yapmak görüşmeyi taşımaz.

İstersen görüşme ekranındaki **Cihaza aktar** düğmesine basıp çevrimiçi cihazını seçebilirsin. Diğer cihazda **Bu cihazda devam et** diyerek mikrofon erişimini ver. Hedef cihaz hazır olduğunda aynı tek oturum kuralıyla önceki cihaz görüşmeden ayrılır.

İki cihazda da aynı hesapla giriş yapılmış ve aynı çalışma alanı açık olmalıdır. Cihaz listesi yalnızca bu görüşmeye erişebilen, başka görüşmede olmayan oturumları gösterir. Aynı oturumun sekmeleri tek cihaz sayılır. Telefon uygulamasını ekranda açık tut; arka plandaki veya kapalı uygulamayı uyandırma desteği yoktur.

Aktarım isteği 60 saniye geçerlidir. Kabul edilmezse, mikrofon izni reddedilirse veya katılım denetimleri başarısız olursa mevcut görüşme devam eder. Aynı görüşmeye geçerken mikrofonun açık/kapalı durumu aktarılır. Kamera ve ekran paylaşımı yeni cihazda kapalı başlar; gerektiğinde yeniden açılır. Katılım onayından sonra yeni cihazın diğer katılımcılarla medya bağlantısını kurması sırasında kısa bir ses aralığı olabilir; eski oturum otomatik yeniden katılmaz.

## Uygulama davranışı

- Cihaz kimlikleri oturum kayıtlarındaki herkese açık kimliklerden gelir; oturum anahtarları istemciye gönderilmez. Sunucu hesap, çalışma alanı ve kanal erişimini yeniden denetler.
- Hedef önce mikrofonu sessiz olarak hazırlar. Sunucu yetkiyi ve diğer hesaplara göre oda kapasitesini doğrulamadan eski cihazı çıkarmaz.
- Başarılı katılım aynı hesabın önceki oturumunu ve bekleyen eski katılım işlemlerini sonlandırır, ardından yeni oturumu ekler. Katılımcı listesinde geçici ikinci hesap kopyası oluşturulmaz.
- Elle aktarım da hedefin katılımıyla sonuçlanır; katılım yanıtı mikrofon durumu ve aktarımın tamamlandığını içerir. Kullanıcının iptal işlemi de aynı sunucu kararıyla sonuçlanır; geç gelen tamamlanma mesajı görüşmeyi yanlışlıkla kapatmaz.
- Altı kişilik dolu odada mevcut hesabın cihazını değiştirmek yeni katılımcı sayılmaz. Hem oda önizlemesi hem hazırlık ekranı buna izin verir; farklı yedinci hesap katılamaz.
- Önceki cihaza genel bir aktarım bilgisi gönderilir; yeni çalışma alanının veya özel görüşmenin adı paylaşılmaz. Geç gelen katılım ve medya izin yanıtları eski cihazı yeniden görüşmeye sokmaz.
- Erişimin kaldırılması, kanalın arşivlenmesi, cihazın bağlantısının kesilmesi ve sürenin dolması bekleyen aktarımı temizler.

`tests/call-single-session.test.ts` hesap sahipliği, kapasite, geciken yetki ve Socket.IO katılım yanıtlarını; `tests/call-transfer.test.ts` sunucu yetkilerini ve aktarım yaşam döngüsünü; `tests/call-transfer.e2e.spec.ts` gerçek Chromium medya bağlantılarıyla aktarımı, izin reddini, geç izinleri ve iptal/tamamlanma yarışlarını doğrular.

16 Eylül 2026 doğrulaması: `npm test` ile 330 test; aktarım tarayıcı dosyasında 11 senaryo; `calls`, `voice-runtime-ux`, `voice-room-ux`, `voice-setup-ux` ve `call-panel-layout` tarayıcı dosyalarında 26 senaryo geçti. `npm run build` başarılı. Medya testleri Chromium'un yapay mikrofon/kamera aygıtları ve canvas ekran kaynağıyla gerçek WebRTC/RTP kullanır; fiziksel cihazlar arası ağ testi değildir. Aynı hesabın çerezlerini farklı katılımcı gibi kullanan eski test kurulumları ayrı davetli hesaplarla düzeltildi.
