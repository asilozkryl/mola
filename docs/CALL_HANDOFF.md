# Görüşmeyi başka cihaza aktarma

Görüşme ekranındaki **Cihaza aktar** düğmesine basıp çevrimiçi cihazını seç. Diğer cihazda **Bu cihazda devam et** diyerek mikrofon erişimini ver. Yeni bağlantı hazır olduğunda eski cihaz görüşmeden ayrılır; mikrofon, kamera ve ekran paylaşımı kaynakları serbest bırakılır.

İki cihazda da aynı hesapla giriş yapılmış ve aynı çalışma alanı açık olmalıdır. Cihaz listesi yalnızca bu görüşmeye erişebilen, başka görüşmede olmayan oturumları gösterir. Aynı oturumun sekmeleri tek cihaz sayılır. Telefon uygulamasını ekranda açık tut; arka plandaki veya kapalı uygulamayı uyandırma desteği yoktur.

Aktarım isteği 60 saniye geçerlidir. Kabul edilmezse, mikrofon izni reddedilirse veya yeni bağlantı kurulamazsa mevcut görüşme devam eder. Mikrofonun açık/kapalı durumu aktarılır. Kamera ve ekran paylaşımı yeni cihazda kapalı başlar; gerektiğinde yeniden açılır.

## Uygulama davranışı

- Cihaz kimlikleri oturum kayıtlarındaki herkese açık kimliklerden gelir; oturum anahtarları istemciye gönderilmez. Sunucu hesap, çalışma alanı ve kanal erişimini yeniden denetler.
- Hedef önce mikrofonu sessiz olarak açar ve odaya geçici katılır. Ses çalma da aktarım tamamlanana kadar kapalıdır.
- Odaya katılım onayı tek başına yeterli değildir. Hedef, kaynak cihaz dışındaki mevcut katılımcılarla WebRTC bağlantısı kurulduğunda hazır olduğunu bildirir.
- Sunucu aktarımı sonuçlandırır ve kaynak cihazı çıkarır. Kullanıcının iptal işlemi de aynı sunucu kararıyla sonuçlanır; geç gelen tamamlanma mesajı görüşmeyi yanlışlıkla kapatmaz.
- Altı kişilik dolu odada yalnızca doğrulanmış aktarım için geçici yedinci bağlantı açılır. Bir odada aynı anda bir aktarım hazırlanır; normal katılım sınırı altıdır.
- Erişimin kaldırılması, kanalın arşivlenmesi, cihazın bağlantısının kesilmesi ve sürenin dolması bekleyen aktarımı temizler.

`tests/call-transfer.test.ts` sunucu yetkilerini ve yaşam döngüsünü; `tests/call-transfer.e2e.spec.ts` gerçek Chromium medya bağlantılarıyla aktarımı, izin reddini, geç izinleri ve iptal/tamamlanma yarışlarını doğrular.
