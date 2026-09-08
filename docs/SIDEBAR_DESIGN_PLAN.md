# Kenar çubuğu ve çalışma alanı tasarım planı

**Durum: uygulandı ve yerel doğrulama tamamlandı.** Plan, 8 Eylül 2026 tarihli kod incelemesine ve paylaşılan kenar çubuğu görüntüsüne dayanır. Çalışma alanı silme/ayrılma, alansız hesap, yeni kenar çubuğu, kişisel sıra/favoriler, bölüm tercihleri, son konuşmalar, filtreler ve genişlik ayarı kodda yer alır. Aşağıdaki bölümler tasarım kararlarını ve kabul ölçütlerini kaydeder. [Etkileşimli taslak](./prototypes/sidebar-plan.html) ilk önerinin tarihli örnek veri önizlemesi olarak korunur; gerçek uygulama veya çalışma alanı verilerine bağlı değildir. Güncel kullanım ve v7 geçişi [Çalışma alanları](./WORKSPACES.md) belgesindedir. Bu çalışma sırasında gerçek bir çalışma alanı silinmedi.

## Amaç ve sınırlar

Kenar çubuğu daha hızlı okunmalı, kişinin kendi düzenine uyarlanabilmeli ve ekipte olanları gerçek verilerle gösterebilmeli. Mola'nın orman yeşili kimliği ve Manrope yazı ailesi korunacak. Daha canlı his; belirgin seçim, iyi yerleştirilmiş durum bilgileri, hızlı etkileşim geri bildirimi ve anlaşılır yönetim akışlarıyla sağlanacak.

Bu planın üç teslim aşaması vardır: önce çalışma alanını silme/ayrılma ve alansız hesap akışı; ardından kenar çubuğunun görünümü, kişisel sıralama ve favoriler; son olarak gerçek son konuşmalar, genişlik ayarı ve filtreler. Ürün arayüzünde kullanıcıya kısa eylemler ve sonuçları anlatılacak; aşağıdaki veri modeli ve oturum ayrıntıları geliştirme ekibi içindir.

## Plan öncesindeki durum

| Alan                      | Kodda mevcut                                                                                | Bu plandaki değişiklik                                       |
| ------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Kanal yönetimi            | Sağ tık, üç nokta, Shift+F10; düzenleme, erişim/üyeler, arşivleme, silme, okundu işaretleme | Eylemleri daha bulunabilir ve tutarlı yerleştirme            |
| Çalışma alanları          | Oluşturma, davetle katılma, alan değiştirme, üye yönetimi ve sahiplik devri                 | Çalışma alanını silme ve kişinin kendi üyeliğinden ayrılması |
| Kanal sırası              | Oluşturulma zamanına ve kayıt sırasına bağlı                                                | Kullanıcıya özel sürükleme ve kalıcı sıra                    |
| Bölümler                  | Açılıp kapanabiliyor; durum component state'inde                                            | Kullanıcı ve çalışma alanına göre kalıcı açık/kapalı tercih  |
| Favoriler                 | Kanal favorisi yok; kaydedilen mesajlar ayrı mevcut                                         | Kanala hızlı erişim sağlayan kişisel favoriler               |
| Canlı bilgi               | Okunmamış rozetleri, çevrimiçi profiller, sesli oda katılımcıları, aktif görüşme durumu     | Aynı gerçek verilerin daha okunabilir sunumu                 |
| Sesli oda satırı          | Oda adı, durum, katılımcı ve işlem kontrolleri aynı dar satırda                             | Oda adına öncelik; katılımcılar için ikinci satır            |
| Direkt mesajlar           | Çalışma alanı üyelerinden ilk beş kişi gösteriliyor                                         | Gerçek DM konuşmaları ve son etkinliğe göre sıralama         |
| Hesabın son çalışma alanı | Giriş ve bootstrap çalışma alanı varsayıyor                                                 | Hesabı koruyan, oluştur/katıl ekranına ulaşan alansız oturum |

Özel kanal erişimi sunucuda kanal üyeliğiyle denetleniyor. Önceki görünürlük bildiriminin yanlış alarm olduğu doğrulandı; bu plan yeni bir erişim açığı varmış gibi davranmaz. Yeni kişiselleştirme özellikleri mevcut erişim sınırlarını korumak zorundadır.

## Görsel sistem ve yerleşim

| Token     | Değer     | Kullanım                                    |
| --------- | --------- | ------------------------------------------- |
| `forest`  | `#153D36` | Sol çalışma alanı şeridi, temel eylem       |
| `live`    | `#237459` | Gerçek çevrimiçi/aktif durum, seçim vurgusu |
| `ink`     | `#20292B` | Ana metin                                   |
| `muted`   | `#687176` | Yardımcı bilgi                              |
| `surface` | `#F5F7F8` | Kenar çubuğu yüzeyi                         |
| `line`    | `#E2E6E8` | Ayırıcılar ve sınırlar                      |

- Sol çalışma alanı şeridi 56 px; kenar çubuğu başlangıçta 272 px. Üçüncü aşamada 240–340 px aralığında ayarlanabilir.
- Masaüstünde tek satır kanal yüksekliği 36 px; dokunmatik hedefler en az 44 px. İkinci satırlı sesli oda öğeleri içerik kadar büyür.
- Ana adlar 13–14 px, bölüm ve yardımcı metinler 12 px. Uzun isimler önce gereksiz ikonlardan alan kazanır; kalan taşma için tam adı sunan erişilebilir açıklama bulunur.
- Sol şeritte etkin çalışma alanı tek ve belirgin seçim işareti taşır. Çalışma alanı adı üstte yönetim menüsünün ana girişidir.
- Seçili kanal için hafif yeşil yüzey ve ince sol işaret kullanılır. Hover, seçili, okunmamış ve klavye odağı birbirinden ayırt edilir; bilgi yalnız renkle verilmez.
- Eyleme bağlı geri bildirim 120–180 ms sürer. Sürekli yanıp sönme veya örnek bir aktiviteyi gerçekmiş gibi gösterme yoktur. `prefers-reduced-motion` altında hareket kaldırılır, durum metni korunur.
- Alt bölüm hesap/profil, bildirimler ve bağlantı durumunu toplar. Büyük boşlukları dekoratif kartlarla doldurmak yerine liste için esnek alan bırakılır.

```text
56 px       272 px; ileride 240–340 px
┌────┬────────────────────────────────┐
│ m  │ Asil-O                       ▾ │
│ A  │ Ara…                    Ctrl K │
│ +  │ Gelen kutusu                 3 │
│    │ Kaydedilenler                  │
│    │ ▾ Favoriler                  ⋯ │
│    │   # genel                    2 │
│    │ ▾ Kanallar                 + ⋯ │
│    │   # duyurular                  │
│    │   🔒 tasarım                   │
│    │ ▾ Sesli odalar             + ⋯ │
│    │   ◖ Tasarım odası              │
│    │     küçük avatarlar · 2 kişi   │
│    │ ▾ Son konuşmalar             + │
│    │   avatar · kişi · okunmamış    │
│    │                                │
│ AY │ Bildirimler · bağlantı durumu  │
└────┴────────────────────────────────┘
```

Taslakta gösterilen kişiler, sayılar ve mesaj durumları örnek veridir. Uygulamada yalnız ilgili kullanıcının erişebildiği ve güncelliği doğrulanmış bilgiler gösterilecek.

## Çalışma alanı menüsü ve yaşam döngüsü

### Menü ve yetkiler

Çalışma alanı adındaki menü; alan değiştirme, oluşturma/katılma, davet, ayarlar ve ayrılma girişlerini toplar. Çalışma alanına davet ile kanala üye ekleme mevcut ayrı akışlarını korur. “Çalışma alanını sil” yalnız sahibin ayarlarındaki tehlikeli işlemler bölümünde bulunur; sık kullanılan kanal eylemleriyle yan yana durmaz.

| Eylem                   | Hedef davranış                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------- |
| Sahipliği devret        | Mevcut, parola doğrulamalı akış korunur                                            |
| Çalışma alanından ayrıl | Sahibin dışındaki aktif üye kendi üyeliğini sonlandırır                            |
| Sahip olarak ayrıl      | Önce sahiplik devrine yönlendirilir; sahipsiz alan oluşturulmaz                    |
| Çalışma alanını sil     | Yalnız mevcut sahibi; yönetici rolü tek başına yeterli değildir                    |
| Sistem yöneticisi       | Ürün içindeki sahip olma şartını otomatik aşmaz; mevcut sistem yönetimi ayrı kalır |

### Silme akışı

1. Sahip ayarlardan silme penceresini açar. Güncel alan adı ve işlem kapsamı gösterilir: bu alanın kanalları, mesajları, dosyaları ve davetleri kaldırılır; hesap ve diğer alanlar korunur.
2. Kullanıcı güncel çalışma alanı adını yazar ve mevcut parolasını girer. Doğrulama tamamlanmadan silme eylemi etkinleşmez. İptal her zaman açıktır.
3. Gönderimde güncel oturum, alan bağlamı, sahiplik, ad ve parola yeniden kontrol edilir. Pencere açıkken ad/sahiplik değişmişse işlem durur ve güncel bilgiyle yeniden açılır. Parola doğrulaması sırasında oturum veya parola değişirse eski doğrulama kullanılamaz.
4. İşlem sırasında yinelenen gönderim engellenir. Hata durumunda alan silinmiş gibi kaybolmaz; doğrulanmış sunucu sonucu gösterilir. Belirsiz ağ sonucunda silme isteği körlemesine tekrarlanmaz; güncel alan listesi alınır.
5. Başarılı silmeden sonra kalan erişilebilir alan varsa geçilir. Yoksa hesap açık kalır ve “Çalışma alanı oluştur / Davetle katıl” ekranı açılır. Hesap ayarları ve çıkış erişilebilir kalır; silinmiş alanın sohbeti gösterilmez.

Parolasız örnek hesaplar için gerçek alan silme akışı etkinleştirilmez; örnek alanın mevcut yaşam döngüsü korunur. Bu plan geliştirme sırasında herhangi bir gerçek çalışma alanının silinmesini gerektirmez.

### Ayrılma ve davetle geri dönme

Ayrılma, alanı herkes için silmez. Kullanıcı hangi alandan ayrıldığını ve erişimini kaybedeceğini görür; onaydan sonra yalnız kendi üyeliği kapanır. Mesaj geçmişi ve hesabı korunur. Aktif görüşme varsa o alandaki medya durdurulur. Başka alan varsa oraya geçilir; son alansa aynı oluştur/katıl ekranı kullanılır.

Gönüllü ayrılma bir yasaklama değildir. `removed_at` durumunun bugün davetle katılmayı da engellemesi ayrıştırılmalıdır: gönüllü ayrılan kişi geçerli davetle yeniden katılabilir; askıya alınmış/yasaklanmış üyelik bu yolla aşılmaz. Üyelikten çıkarma, gönüllü ayrılma ve yasaklama için açık durum/neden modeli tanımlanır. Eski özel kanal üyelikleri davet nedeniyle otomatik geri gelmez; kanal bazlı yeniden yetkilendirme gerekir.

### Önce çözülmesi gereken oturum modeli

Silme düğmesi tek başına yeterli değildir. Mevcut `startSession` üyelik bulamazsa 403 döndürüyor; `Bootstrap.workspace` zorunlu; `Repository.session` aktif alan üyeliğine `JOIN` yapıyor. `sessions.workspace_id` alan silinince oturumu da kaldıran yabancı anahtara sahip. `initial_session_workspace` tetikleyicisi boş alanı eski kullanıcı alanıyla dolduruyor. Bu noktalar birlikte ele alınmalıdır.

Hedef, hesap kimliğini çalışma alanındaki yetkiden ayırmaktır:

- Oturumun aktif çalışma alanı boş olabilir. Hesabı doğrulanmış, alanı olmayan kullanıcı yeniden parola girmeden oluşturma/katılma ekranına ulaşır; sonradan normal giriş yapınca da kilitlenmez.
- Bootstrap yanıtı açık bir ayrımla `workspace` veya `account-only` durumunu bildirir. Alan rolü hesap düzeyinde varmış gibi üretilmez. Kanal/üye verileri yalnız alan bağlamında vardır.
- Hesap işlemleri ve alan oluşturma/davetle katılma hesap kimliğiyle çalışır. Kanal, mesaj, dosya, yönetim ve görüşme işlemleri ayrıca etkin alan üyeliği ister.
- Alan silinmesinde etkilenen oturumlar güvenli kalan bağlama geçirilir veya alansız yapılır. Diğer alanlardaki oturumlar ve hesabın güvenlik bilgileri korunur.
- E-posta doğrulaması, çok faktörlü giriş, oturum listeleme, parola yenileme ve yeniden bağlanma kodları boş alanı destekler; mevcut askıya alma kuralları korunur.
- Eski ana alanı tutan `users.workspace_id` göç metaverisidir; yetki veya otomatik geri dönüş kaynağı olarak kullanılmaz. Yeni şema/göç alansız oturumu gerçekten saklayabilmelidir.

### Sunucu, dosya ve canlı görüşme işlemleri

Uygulanan uçlar: `DELETE /api/workspaces/:id` (`{confirmName,password}`) ve `POST /api/workspaces/:id/leave` (`{}`). Sahibin silme penceresi için `GET /api/workspaces/:id/deletion-preview` güncel ad ve içerik sayılarını verir.

Silme işlemi tek veritabanı transaction'ında güncel yetkiyi doğrular, hedef alanın ilişkili kayıtlarını kaldırır, hesapları korur, etkilenen oturumların bağlamını günceller ve denetim kaydı üretir. Alan adı ve kimliği denetim kaydında kalır; mevcut `audit_events.workspace_id` silinmede `NULL` olabildiğinden kayıt alanın kendisine bağımlı bırakılmaz. Parola, davet sırrı ve mesaj içerikleri denetim ayrıntısına yazılmaz.

Commit sonrasında yalnız o alana bağlı açık görüşmeler sonlandırılır, ilgili socket odaları boşaltılır ve etkilenen sekmelere alanın silindiği/üyeliğin sonlandığı bildirilir. İstemci mikrofon, kamera ve ekran paylaşımını bırakır; bekleyen eski veri yanıtlarını yok sayar. Başka alandaki görüşme ve oturumlar kapanmaz.

Dosya adları transaction içinde toplanır; fiziksel temizlik başarılı commit sonrasında yapılır. Yalnız sunucunun oluşturduğu dosya adları, doğru depolama kökü ve artık referansı olmayan dosyalar silinir. Temizlik başarısızlığı için yeniden denenebilir kayıt/iş gerekir. Hesap profil fotoğrafları ve diğer alanların dosyaları korunur. Çalışma alanına ait davetler, entegrasyon teslimleri ve bekleyen bildirimler artık erişilebilir veri taşımamalıdır.

## Kişisel düzen: sürükleme, favoriler ve bölümler

### Etkileşim

- Sıra kişiseldir; ekibin veya kanal üyeliğinin ayarını değiştirmez. Metin kanalları kendi bölümünde, sesli odalar kendi bölümünde sürüklenir. Favori sırası da bağımsızdır.
- Hover ve klavye odağında görünen tutamak sürüklemeyi başlatır. Kanal adına tıklama sohbeti açmayı sürdürür. İşlem menüsüne basma sürüklemeyi tetiklemez.
- Sürüklenen öğenin yeri korunur, hedefe ince bırakma çizgisi gelir. Bırakma sonrası odak aynı kanalda kalır. Escape eski sırayı geri getirir. Uzun listede kenara yaklaşınca kontrollü kaydırma yapılır.
- Menüde “Favorilere ekle/çıkar” ile “Yukarı taşı / Aşağı taşı” bulunur. Favori mevcut kanala kısayoldur; asıl bölümde kalabilir. Okunmamış toplamları kopya satır nedeniyle iki kez sayılmaz.
- Boş “Favoriler” bölümü varsayılan olarak yer kaplamaz. Daraltılmış bölüm başlığında okunmamış toplamı gösterilir. Arşivler bölüm menüsünden erişilir; mevcut arşiv ekranı korunur.
- Mobilde görünür düzenleme modu ve yukarı/aşağı eylemleri sunulur. Kaydırma veya uzun basma tek kullanım yolu değildir. Klavyede menü eylemleri aynı sonucu verir; sıra değişikliği kısa ekran okuyucu duyurusuyla açıklanır.
- Gelen mesaj veya yeni sesli katılımcı kanalların kişisel sırasını değiştirmez. Drag devam ederken alan değiştirme ya da erişim kaybı işlemi iptal eder.

### Kalıcı tercih ve çakışma modeli

Yeni `sidebar_preferences` tablosu önerilir: `(user_id, workspace_id)` anahtarı; `revision`, `state_json`, `updated_at`. İlk sürümün durumu:

```ts
type SidebarPreferences = {
  textOrder: string[];
  voiceOrder: string[];
  favoriteIds: string[];
  collapsedSections: ("favorites" | "channels" | "voice" | "dms")[];
};
```

Önerilen `GET/PATCH /api/sidebar-preferences` yalnız doğrulanmış kullanıcının aktif çalışma alanına hizmet eder. İstekteki kullanıcı kimliği yetki kaynağı değildir. PATCH beklenen revision'ı gönderir; sunucu tek transaction içinde kontrol edip artırır. Çakışmada güncel durum alınır ve kullanıcıya anlaşılır geri bildirim verilir. İyimser sıralama başarısız kayıtta önceki doğrulanmış sıraya döner; eski hesaba/alana ait geç yanıtlar uygulanmaz.

Kimlik listeleri tekilleştirilir ve boyutları sınırlanır. Her kanalın çalışma alanı, türü ve erişimi doğrulanır; başka alan veya özel kanal kimliği tercihe yazılarak erişim kazanılamaz. Okumada tercihler sunucunun erişilebilir kanal listesiyle kesiştirilir. Silinmiş, arşivlenmiş veya erişimi kaybedilmiş kanal görünmez; yeni kanallar varsayılan sırayla sona eklenir. Güncelleme yalnız ilgili `workspace-user` socket odasına gönderilir. Yenileme ve ikinci cihaz aynı düzeni alır.

## Canlı bilgi, sesli odalar ve son konuşmalar

Okunmamış rozetleri mevcut bildirim verisinden beslenir. Kanal birden fazla yerde görünüyorsa aynı unread değerini paylaşır. Bağlantı kopunca çevrimiçi kişi veya dolu oda sayısı kesin güncelmiş gibi gösterilmez; mevcut bağlanılıyor durumu korunur.

Sesli odada ilk satır tam oda adına ayrılır; ikinci satır küçük profil fotoğrafları, kişi sayısı ve kısa durum taşır. Katılımcı önizlemesi ve mevcut sağ tık eylemleri korunur. Boş odalar tek satır kalır; katılımcı bilgisi yalnız oda doluyken gösterilir. Gerçek ölçülen ses olmadan hareketli ses dalgası üretilmez; profil kartı, görüşme hazırlığı, oda değiştirme ve görüşmeyi küçültme davranışları değiştirilmez.

Üçüncü aşamada “Son konuşmalar”, `kind=dm` kanalları ve sunucudan gelen son etkinlik bilgisine göre sıralanır. Şu anki üye listesinin ilk beşi kullanılmaz. Henüz mesajı olmayan kişiler “Yeni mesaj” aramasından bulunur. Kullanıcının kendi taslağı varsa görünür kalması için açık bir kural tanımlanır; gelen sıralama değişikliği mevcut klavye odağını kaybettirmez. Yalnız erişilebilir DM'lerin özeti döner.

Kanal filtreleri “Tümü / Okunmamış” ile başlar. Filtre aktifliği açıkça görünür, boş sonuç ekranında temizleme eylemi vardır. Geçici filtre liste sırasını veya kanal üyeliğini değiştirmez. Sidebar genişliği üçüncü aşamada sürüklenebilir sınır, klavye ayarı ve varsayılana dönme eylemiyle gelir; dar ekranda mobil çekmece mevcut odak yönetimini korur.

## Uygulama sırası ve kabul ölçütleri

| Aşama | Teslim                      | Tamamlanma koşulu                                                                   |
| ----- | --------------------------- | ----------------------------------------------------------------------------------- |
| 1     | Çalışma alanı yaşam döngüsü | Alansız oturum, silme, ayrılma ve yeniden katılma birlikte çalışır                  |
| 2     | Görünüm ve kişisel düzen    | Yeni ölçüler, okunabilir oda satırları, sürükleme, favoriler ve kalıcı bölüm durumu |
| 3     | Gezinme verimliliği         | Gerçek son DM'ler, 240–340 px genişlik ayarı ve filtreler                           |

### Aşama 1 kontrolleri

- Sahip siler; admin/member/guest ve başka alan kullanıcısı aynı API'yi kullanarak silemez. Yanlış ad/parola, değişen sahiplik, sona eren oturum ve yinelenen gönderim veri kaybına yol açmaz.
- İki alanlı hesabın bir alanı silinince hesabı, diğer alanı, dosyaları ve geçmişi korunur. Son alan silinince hesap oturumu sürer; sayfa yenileme, çıkış/giriş, oluşturma ve davetle katılma çalışır.
- Son alanda bulunan diğer üyeler de aynı boş alan akışına ulaşır. Başka alanı olanlar erişilebilir bağlama geçer. Askıya alınmış hesap/üyelik yeni akıştan yetki kazanamaz.
- Sahip önce devretmeden ayrılamaz. Normal üye ayrılır, geçerli davetle dönebilir; yasaklı/askıda kişi dönemez. Özel kanallara üyelik davetten ayrı kalır.
- Transaction başarısızlığında hiçbir dosya silinmez. Başarılı silmede yetim dosyalar yeniden denenebilir biçimde temizlenir; audit kaydı kalır.
- İki sekmede ve farklı üyelerde eski kanal verisi kapanır; hedef alandaki ses/kamera/paylaşım sona erer. Diğer alanlardaki canlı oturumlar korunur.
- Mevcut veritabanından göç sonrası hesaplar, üyelikler ve oturum ilişkileri doğrulanır; çok faktörlü giriş ve hesap kurtarma regresyonları geçer.

### Aşama 2 kontrolleri

- Kişisel sıra ve açık bölümler yenilemede/ikinci cihazda kalır; başka kullanıcıya veya çalışma alanına taşınmaz.
- İki sekmede revision çakışması, ağ hatası ve alan değişiminden sonra gelen geç yanıtlar başka bağlamdaki sırayı bozmaz.
- Favoriye alma/çıkarma, kanal oluşturma, arşivleme/silme ve private erişim kaybı doğru listeyi üretir. Unread toplamı tekrar sayılmaz.
- Mouse ile sürükleme, klavye menüsü ve 320 px dokunmatik alternatifleri aynı sonucu verir. Escape, Tab ve odak geri dönüşü çalışır; ekran okuyucu sıra değişikliğini öğrenir.
- Aktif sesli görüşmede oda satırı taşınırken görüşme/medya kesilmez. Uzun oda adları ana eylemlerle çakışmaz.
- Mevcut sağ tık, kanal hakkında popup, üyelik akışları ve profil kartları çalışmaya devam eder. Azaltılmış hareket ve metin kontrastı görsel olarak kontrol edilir.

### Aşama 3 kontrolleri

- Son konuşma sırası gerçek son etkinlikten gelir; ilk beş workspace üyesine bağlı değildir. Private/DM erişim kaybı özetleri kaldırır.
- Daraltma/genişletme içeriği taşırmaz; sınır ve klavye kontrolü 240–340 px aralığına uyar. Mobilde yatay taşma oluşmaz.
- Okunmamış filtre boş sonuçta açıkça anlaşılır ve tek eylemle temizlenir; aktif filtre kanal silinmiş izlenimi yaratmaz.

## Kod haritası

| Dosya/alan                                                                                   | İnceleme veya geliştirme rolü                                                   |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/App.tsx`                                                                                | Sidebar bölümleri, kanal/DM listesi, bağlam değişimi, bootstrap, menüler        |
| `src/workspace-polish.css` ve `src/styles.css`                                               | Mevcut marka token'ları ve ana yerleşim; tutarlı katmanlama                     |
| `src/components/channel-navigation.css`                                                      | Kanal satırı ve işlem düğmeleri                                                 |
| `src/components/WorkspaceSwitcher.tsx`                                                       | Alan menüsü, oluştur/katıl ve boş alan akışına bağlanma                         |
| `src/components/AdminPanel.tsx`                                                              | Mevcut sahiplik devri; sahibin tehlikeli işlemler bölümü                        |
| `src/components/ContextMenu.tsx`                                                             | Mevcut klavye/focus desteğiyle taşıma ve favori eylemleri                       |
| `src/components/VoiceParticipants.tsx` ve `voice-room-polish.css`                            | Oda adı, ikinci satır ve mevcut katılımcı önizlemesi                            |
| `src/lib/useMobileNavigation.ts`                                                             | Mobil çekmece, odak kapanı ve geri dönüşün korunması                            |
| `src/lib/useCall.ts` ve `server/calls.ts`                                                    | Yalnız etkilenen alanın görüşmelerini kapatma                                   |
| `shared/types.ts`                                                                            | Alanlı/alansız bootstrap ayrımı ve yeni tercih veri tipi                        |
| `server/db.ts`                                                                               | Oturum/üyelik göçü, null bağlam, yeni tercih tablosu, erişilebilir kanal sırası |
| `server/app.ts`                                                                              | Giriş, bootstrap, oluştur/katıl/geçiş ve yeni yaşam döngüsü uçları              |
| `server/admin.ts` ve `server/permissions.ts`                                                 | Mevcut sahiplik/yetki, audit ve güvenli kanal silme örüntüleri                  |
| `server/account-security.ts`                                                                 | Hesap güvenliği akışlarının alansız oturumla uyumu                              |
| `server/collaboration-data.ts`                                                               | Mevcut unread verisi ve kullanıcı/alan bazlı socket yayın örüntüsü              |
| `tests/workspaces.test.ts`, `tests/workspaces.e2e.spec.ts`                                   | Mevcut alan davranışları; yeni yaşam döngüsü regresyonlarının temeli            |
| `tests/workspace-channel-isolation.test.ts`, `tests/channel-permissions.test.ts`             | Kullanıcı/alan/özel kanal sınırları                                             |
| `tests/channel-actions.e2e.spec.ts`, `tests/ui-polish.e2e.spec.ts`, `tests/a11y.e2e.spec.ts` | Mevcut menü, popup, mobil ve erişilebilirlik davranışları                       |

Uygulama, tercih yönetimini `useSidebarPreferences`, listeyi `WorkspaceNavigation`, yaşam döngüsü pencerelerini `WorkspaceLifecycle` ve sunucu işlemlerini `workspace-lifecycle` / `sidebar-preferences` modüllerine ayırır. Yeni uçlar ve v7 göçü uygulanmıştır. İlk etkileşimli taslak ürün davranışının testi yerine geçmez.


## Uygulama doğrulaması — 8 Eylül 2026

- `npm test`: 158 sunucu/birim testi geçti.
- 65 kanal, profil, çalışma alanı, yaşam döngüsü, tercih hook'u, erişim ve mevcut arayüz senaryosu geçti; yeni menü yolları ve kompakt sesli katılımcı gösterimi için eski beklentiler güncellendi.
- Kenar çubuğunun 6 tarayıcı senaryosu sürükleme/geri alma, favoriler, dar bölümler, filtreler, kalıcı genişlik ve gerçek son konuşmaları doğruladı.
- 15 bildirim tarayıcı senaryosu ve 3 genel yönetim senaryosu geçti. Workspace'siz yönetici hesabı genel yönetime erişir; normal hesap bu yetkiyi kazanmaz.
- TypeScript ve üretim build'i geçti. Mevcut ana paket için 500 kB uyarısı sürüyor.
- Güncel 1440 px masaüstü ve 390 px mobil görünümler incelendi; yatay taşma, JavaScript hatası ve ciddi/kritik axe ihlali bulunmadı. 320/390/768 px gezinme ve klavye kontrolleri de geçti.

Boş sesli odanın katılımcı önizlemesi satır yüksekliğini oynatmadan açılır; dolu odanın kompakt avatarları mikrofonun kapalı durumunu gösterir. Yeni direkt mesaj araması seçilen kişiyle doğrudan sohbet başlatır. Bildirimlerin kapsamı ve gerçek cihazda sınanmayan noktalar [Tarayıcı bildirimleri](./BROWSER_NOTIFICATIONS.md) belgesindedir.
