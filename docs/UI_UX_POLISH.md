# Mola UI/UX düzenlemesi

8 Eylül 2026

## Tasarım yönü

Mola, ekibin gün boyunca açık tuttuğu bir sohbet alanı. Tasarımın önceliği mesajı okumak, doğru kişiye ulaşmak ve paylaşım yapmak. Var olan orman yeşili kimliği ve yerel Manrope yazı tipi korundu; büyük süslemelerin kapladığı alan azaltıldı. Metinler sola hizalı; mesajların satır uzunluğu 78 karakter birimiyle sınırlı.

| Rol | Değer |
| --- | --- |
| Marka / ana işlem | `#153D36` |
| İkincil yeşil | `#2D6650` |
| Vurgu | `#C0E1AD` |
| Ana metin | `#293730` |
| Yardımcı metin | `#66716B` |
| Sakin yüzey | `#F5F7F4` |

Masaüstünde sol alanlar sabit, sohbet esnek; kanal bilgisi kullanıcı açtığında görünür. 800 px ve altında gezinme bir menü olarak açılır. Dekorasyonu küçültürken metinleri küçültmek yerine mesajları 14 px, sık kullanılan gezinme öğelerini 12–13 px tutuyoruz. Dokunmatik ekranlarda düğme hedefleri ayrıca ele alınıyor.

## Bulunan sorunlar ve uygulanan çözümler

| Bulgu | Yeni davranış |
| --- | --- |
| Üst alan ve kanal açılışı sohbetten fazla yer alıyordu. | 1440 px masaüstünde üst alan + kanal başlığı + sekmeler 199 px yerine 160 px. Karşılama simgesi yaklaşık 64 px yerine 38 px. |
| Sağ panel ilk açılışta sohbeti daraltıyordu. | Başlangıçta kapalı; kullanıcının açma/kapama tercihi bu tarayıcıda hatırlanıyor. |
| Davet ve sesli görüşme süslemeleri gereğinden büyüktü. | Davet tek düğmeye, görüşme kartı kısa açıklama ve eyleme dönüştürüldü. Giriş ekranı görselleri de küçültüldü. |
| Bölüm başlıklarındaki oklar bir işlem yapmıyordu. | Kanallar, sesli odalar ve direkt mesaj bölümleri açılıp kapanabiliyor. |
| Mobilde kanal bilgisi ve kullanım rehberi gizleniyordu. | Kanal bilgisi başlıkta, rehber gezinme menüsünde erişilebilir. Kanal üye listesi bilgi penceresinden de açılıyor. |
| Mobil menüde klavye odağı arka ekrana kaçabiliyordu. | Kapalı menü `inert`; açık menü odağı içeride tutuyor. Escape ve kapatma sonrası odak açıcıya dönüyor. |
| Sekmelerin klavye davranışı eksikti. | Yön tuşları, Home/End, tek etkin Tab durağı ve doğru adlandırılmış içerik paneli. |
| Özel kanal bilgilerinde tüm çalışma alanının üye sayısı gösteriliyordu. | Üye sayısı ve gizlilik etiketi sohbetin gerçek kapsamını kullanıyor. Kişi listesi kanal ve çalışma alanı kapsamını ayırıyor. |
| Uzun kişi listeleri taranması zordu; ilk beş kişinin devamı belirgin değildi. | Türkçe büyük/küçük harfe uygun isim araması, sonuç bulunamadı açıklaması ve tüm kişilere erişim. Direkt mesaj okunmamış sayıları görünür. |
| Geçmişte gezinirken son mesajlara dönüş zorlaşıyordu. | Sohbetin sonundan uzaklaşınca “Son mesajlara git” düğmesi görünüyor. |
| Dosya ekleme tekliydi, hatalar yalnızca geçici bildirimde görünüyordu. | Çoklu seçim, sürükleme, panodan dosya yapıştırma, yükleme durumu ve mesaj alanında kalıcı hata açıklaması. Dört dosya / dosya başına 10 MB sınırı korunuyor. |
| Mesaj alanı sabit yükseklikteydi. | Yazdıkça büyüyor, 160 px sonrasında kendi içinde kayıyor. Gönder düğmesinde görünür etiket var. |
| Mesaj işlemleri fareyle üzerine gelmeye dayanıyordu. | Dokunmatik ekranlarda görünür işlem menüsü; menüde kopyalama, tepki, yanıtlama ve kaydetme. Menüler ekranın ve sohbet alanının dışına taşmıyor. |
| Görsel ekler ayırt edilemiyordu. | İndirilebilir dosya satırında 40×40 px önizleme; mesajı kaplayan büyük görseller yok. |
| Düzenleme hatası ve açılır menü kullanımı yeterince açıklayıcı değildi. | Hata sırasında düzenleme taslağı korunuyor; Ctrl/⌘+Enter ile kaydetme, Escape, dışarı tıklama ve yön tuşları destekleniyor. |
| Dosya ve sabitlenen mesaj boş ekranlarında sonraki adım dolaylıydı. | “Dosya paylaş” ve “Sohbete dön” düğmeleri eklendi. Arama sıfırlanınca eski hata temizleniyor. |
| Kanal ve mesajlarda sağ tık işlemleri eksikti. | Ekrana sığan sağ tık menüleri; klavye için Shift+F10, yön tuşları, Home/End ve Escape. Bağlantı, metin seçimi ve yazı alanlarında tarayıcının yerel menüsü korunuyor. |
| Kanal adını değiştirmek yönetim panelinde saklıydı. | Kanal satırında, sesli odalarda ve sohbet başlığında ⋯; ad/açıklama düzenleme, erişim/üyeler, okundu işaretleme ve ad kopyalama. Sağ tık başka kanala geçirmiyor veya sesli odaya katılmıyor. |
| Kalıcı kanal silme yoktu. | Rol kontrolü ve güncel kanal adını aynen yazma onayıyla silme; yanlışlıkla kaybı önlemek için arşivleme açıklaması. Mesajlar, ekler, taslaklar, bildirimler ve entegrasyonlar temizleniyor; diğer sohbetler korunuyor. |
| Arşivlenmiş geçmiş ve kaydedilen mesajlar erişim yenilemesinde kaybolabiliyordu. | Arşivlenmiş kanallar dizini, geçmişi açma ve geri yükleme. Seçili arşivli sohbet ve kaydedilen mesajlar erişim sürdükçe korunuyor. |
| Başka kanala ait kayıtlı mesajdan açılan dizi, kanal silinince ekranda kalabiliyordu. | Açık dizinin kendi kanalı ayrıca kontrol ediliyor; kanal silinir veya erişim kalkarsa önizleme, yanıtlar ve yazma alanı kapanıyor. |

## Doğrulama

- `npm run build`: TypeScript denetimi ve üretim derlemesi başarılı.
- Toplam 38 farklı tarayıcı senaryosu başarılı olarak doğrulandı. Mobil odak hataları düzeltildikten sonra ilgili yedi arayüz testi yeniden çalıştırıldı ve tamamı geçti. Yeni dokunmatik mesaj menüsü ve düzenleme testleri de 2/2 geçti.
- Mevcut mesajlaşma, dosya indirme, kayıt/giriş, özel kanal, taslak senkronizasyonu, çalışma alanı değişimi ve sesli oda görünürlüğü akışları tarayıcı testleriyle kontrol edildi.
- Kalıcı yeni testler: `tests/ui-polish.e2e.spec.ts`, `tests/composer-ux.e2e.spec.ts`, `tests/message-ux.e2e.spec.ts`.
- 320, 390, 768, 1024, 1440 ve 1920 px genişliklerinde yatay sayfa taşması kontrol edildi.
- Masaüstü, mobil, giriş, kanal oluşturma ve görüşme ekranları için mevcut axe denetimleri; dokunmatik mobil gezinme menüsü için ayrıca axe denetimi uygulandı.
- Ekran görüntüleri yerel `artifacts/ui-before-*.png` ve `artifacts/ui-after-*.png` dosyalarında. Örnek veriler ayrı geçici yerel veri dizininde çalıştırıldı.

### Sağ tık ve kanal yönetimi ek kontrolü

- 45 farklı tarayıcı senaryosu başarılı: 43 senaryolu toplu çalışma ve inceleme sırasında bulunan iki sorun için ek regresyon testi. İsim/açıklama değişimi, hata sonrası tekrar deneme, tam adla silme onayı, iptal, diğer sekmeye yansıma, arşiv geçmişi/kaydedilenler, rol sınırları, sesli odaya yanlışlıkla katılmama, dokunmatik menü ve klavye odağı doğrulandı.
- Kanal silme, yönetim yarışları, izinler ve entegrasyonlar için 26 sunucu testi başarılı. Gerçek dosya temizliği, veritabanı ilişkileri, aktif görüşmenin kapanması ve botun ilgili ekip üyeliğinin sonlandırılması kontrol edildi.
- Yeni kalıcı testler: `tests/channel-actions.e2e.spec.ts` (8), `tests/context-menu.e2e.spec.ts` (4), `tests/channel-deletion.test.ts` (5).
- 320, 390, 768, 1024 ve 1440 px ekranlarda kanal menüsü, düzenleme ve silme pencereleri axe WCAG A/AA denetiminden hatasız geçti; yatay taşma yok. Masaüstü ve mobil görüntüler ayrıca görsel olarak incelendi.
- Ekran görüntüleri yerel `artifacts/channel-actions-desktop.png`, `artifacts/channel-edit-desktop.png`, `artifacts/channel-delete-mobile.png` ve `artifacts/channel-edit-320.png` dosyalarında.

## Açık kalan bulgular

Üretim derlemesinin ana JavaScript dosyası Vite'ın 500 kB uyarı eşiğinin biraz üzerinde. Yönetim ve seyrek kullanılan ayar ekranlarını ihtiyaç anında yüklemek, ilk açılış yükünü azaltmak için somut bir sonraki iş. Bu düzenlemede ağ hızı ölçümü veya gerçek cihazda performans iddiası yapılmadı.
