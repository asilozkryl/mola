# İlk iyileştirme paketi — 9 Eylül 2026

Başlangıç: `c3c5b91e21927be4f003493ab02fd8a1a9cf9b4e`. Kapsam, [proje planının](PROJECT_ROADMAP_2026-09-09.md) sonunda önerilen ilk uygulama turudur.

## Uygulanan kapsam

| Madde                     | Değişiklik                                                                                                                                                                                                                                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R01                       | Menü testi gerçek kaydırmayı ve öğe konumunu ölçer; ilgisiz sidebar kaydırmasında açık kalma korunur. Profil testi, StrictMode'un tekrarladığı ilk istekleri aynı eski yanıt arkasında bekleterek canlı profil güncellemesini deterministik doğrular. Ürün davranışı testlere uydurulmadı.                                   |
| R02                       | Kişi seçici kimlik, avatar, ad, unvan ve e-posta kullanır. Arama ve klavye seçimi eklendi. Mesaj, taslak, düzenleme, arama ve merkez önizlemeleri sabit kişi kimliğini okunabilir adla gösterir. Composer ve mesaj düzenlemede geri al/yeniden yap hedef kimliğini korur. Mevcut sunucu yetki ve bildirim kuralları korunur. |
| R04 — hata/yeniden deneme | Dosyalar ve Sabitlenenler için kalıcı hata alanı eklendi. Başarısız istek boş liste gibi görünmez; yeniden deneme aynı alanda yapılır. Eski kapsamın geç yanıtı yeni görünümü değiştirmez. Yanıt, başka bir kontrolü kullanan kişiden odağı almaz.                                                                           |
| R05                       | Arama filtresi, sonuç ve Kaydedilenler'de DM kaynağı karşı tarafın güncel adını gösterir. Profilin kaydedilmemiş metin/fotoğrafı kapatma, çıkış ve yönetim geçişinde korunur. Üst çubuktaki sessize alma yalnız uygulama içi uyarılar olarak adlandırılır.                                                                   |

Şema veya sunucu API geçişi yoktur. Yeni bağımlılık eklenmedi. R03 sunucu tarafında Kaydedilenler, R04 sayfalama/dosya araması, R06 rota modeli ve diğer plan maddeleri sonraki turlarda kalır. R01'in uzun vadeli bağımsız CI işleri önerisi bu paketin kod kapsamına alınmadı.

Uçtan uca kontrol, canlı profil olayından önce başlamış `/auth/me` yanıtının yeni adı geri alabildiğini de yakaladı. Erişim snapshot'ı artık hemen uygulanırken yalnız istekten sonra gelen profil görünüm alanları korunur; ardından güncel snapshot alınır. Roller, askı, hesap doğrulaması ve üye/kanal listeleri erişim yanıtından gelir. İkinci isteğin başarısızlığı, ilk yanıttaki erişim kısıtını düşürmez. Ayrı gecikmeli yanıt testi, eski adın geçici olarak bile geri görünmediğini doğrular.

## Doğrulama

- Üretim derlemesi ve TypeScript kontrolü geçti.
- Birim/API testleri: **177/177** başarılı.
- Ayrı hesap kurtarma paketi: **3/3**; genel yönetim paketi: **3/3** başarılı.
- Odaklı testlerde dosya/pin hatası ve retry, yazma odağı, özel konuşma kimliği, yerel bildirim kapsamı, aynı adlı kişiler, Undo/redo, profil korunması ve canlı yanıt yarışı doğrulandı.
- Ana tarayıcı paketindeki **181 senaryo** çalıştırıldı: 180 başarılı; tek başarısızlık önceki testlerin ortak localhost yükleme kotasını tüketmesiydi. Test ortamına özel kota sonrasında ilgili **6 koleksiyon/Composer senaryosu birlikte geçti**. Üretim 12/dakika sınırı korunur; yeni API testi üretimde 13. isteğin reddini ve override sınırlarını denetler.
- GitHub, her kod gönderiminde tam tarayıcı paketini, hesap/yönetim, TURN, bağımlılık, izleme ve Docker/Coolify kontrollerini yeniden çalıştırır. Commit bazında sonuçlar [Validate Mola iş akışında](https://github.com/asilozkryl/mola/actions/workflows/ci.yml) izlenebilir.

Tarayıcı senaryoları gerçek API ve ayrı geçici veri kullanır; hata ve gecikme durumları istek düzeyinde kontrollü olarak oluşturulur. İlk yeni test koşularında sayaçlı Kaydedilenler düğmesi ve hover ile açılan mesaj araçları için kullanıcı davranışını izleyen seçiciler düzeltildi; son odaklı koşular başarılıdır.

Görsel kanıtlar Git dışında `artifacts/collection-error-{mobile,desktop}.png`, `artifacts/profile-unsaved-mobile.png` ve `artifacts/search-direct-source.png` konumlarına yazılır. Bu kontrol fiziksel cihaz veya canlı dağıtım kabulü değildir.
