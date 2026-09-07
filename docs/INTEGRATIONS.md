# GitHub, gelen webhook ve ekip botları

Alan sahibi veya yönetici sol menüdeki **Entegrasyonlar** bölümünden araç ekler. Gerçek bir çalışma alanı ve erişebildiğiniz aktif bir metin kanalı gerekir. Örnek çalışma alanlarında dış entegrasyon açılmaz. Her entegrasyonun ayrı botu, anahtarı ve teslimat geçmişi vardır; bot yalnız seçilen kanala atanır.

## GitHub deposunu bağlama

1. **Entegrasyon ekle → GitHub** seçin.
2. Botun adını, bildirim kanalını ve GitHub deposunu `sahip/depo` biçiminde yazın. **Entegrasyonu oluştur** düğmesine basın.
3. Oluşan webhook adresini ve yalnız bu ekranda gösterilen anahtarı alın. **GitHub webhook ayarlarını aç** bağlantısı belirtilen deponun ayarlarına gider. GitHub’da depo sahibi veya webhook yönetimi yetkisine sahip olmanız gerekir.
4. **Settings → Webhooks → Add webhook** ekranında **Payload URL** alanına Mola adresini, **Secret** alanına anahtarı yapıştırın. **Content type** değerini `application/json` seçin.
5. İhtiyacınız olan olayları seçin, **Active** seçeneğini açık bırakıp kaydedin. GitHub ilk bağlantı için bir `ping` gönderir. Mola entegrasyon listesini yenilediğinizde başarılı teslimat zamanı görünür.

Desteklenen olaylar:

| GitHub olayı | Kanalda gösterilen bilgi |
| --- | --- |
| `push` | Depo, gönderen, dal, commit sayısı ve ilk beş commit özeti |
| `pull_request` | İşlem, PR numarası, başlık ve bağlantı |
| `issues` | İşlem, issue numarası, başlık ve bağlantı |
| `workflow_run` | İş akışı adı ve çalışma/sonuç durumu |
| `release` | Sürüm etiketi, adı ve sürüm sayfası |

Mola istek gövdesini GitHub’ın `X-Hub-Signature-256` imzasıyla doğrular ve payload deposunun tanımlanan depoyla eşleşmesini ister. Aynı teslimat kimliği iki mesaj üretmez. Desteklenmeyen olaylar sohbet mesajına dönüştürülmez. GitHub’da **Recent Deliveries** bölümünden yanıtı inceleyebilirsiniz. Kurulum adımlarının kaynağı: [GitHub webhook oluşturma](https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks), [GitHub imza doğrulama](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).

Mola, deponuza kendiliğinden webhook eklemez. Sihirbaz bağlantı bilgilerini hazırlar; GitHub tarafındaki kayıt depo yetkisiyle tamamlanır. Testler yerel uygulama uçlarına gider ve kullanıcı adına dış depoya kayıt oluşturmaz.

## Kendi uygulamanızdan mesaj gönderme

**Entegrasyon ekle → Gelen webhook** seçin. Bot adı ve kanalı belirleyip oluşturun. Ekrandaki adresi uygulamanızın ayarlarına, anahtarı sunucunuzun gizli ayar deposuna kaydedin. Anahtarı istemci JavaScript’ine, Git deposuna veya URL sorgusuna koymayın.

İstek biçimi:

```http
POST /api/hooks/ENTEGRASYON_KIMLIGI HTTP/1.1
Host: mola.psychodry.cloud
Content-Type: application/json
Authorization: Bearer ENTEGRASYON_ANAHTARI

{
  "content": "Yeni sürüm yayına alındı.",
  "eventId": "release-2026-09-07-001"
}
```

Gerçek adresi uygulamadaki **Webhook adresi** alanından kopyalayın. Örnekteki kimlik ve anahtar yer tutucudur.

- `content`: boş olmayan, en fazla 10.000 karakterlik mesaj.
- `eventId`: isteğe bağlı, 1–100 karakter; harf, sayı, `_`, `-` ve `.` kullanılabilir. Aynı entegrasyonda tekrar gönderilen aynı kimlik önceki mesaj sonucunu döndürür. Her yeni olay için yeni kimlik kullanın. Ağ hatasından sonra güvenli tekrar için kimliği gönderen uygulamada koruyun.

Yeni mesaj `201` ve `messageId` döndürür. Aynı olay tekrarında `200` ve `duplicate: true` döner. Bozuk istek `400`, geçersiz anahtar `401`, kapalı veya artık erişimi olmayan entegrasyon `404`, yanlış içerik türü `415`, istek sınırı `429` döndürebilir. Mola tarafındaki sınır aynı kaynak IP için dakikada 120 webhook isteğidir.

## Anahtar ve erişim yönetimi

Anahtar oluşturma veya yenileme yanıtında bir kez gösterilir; listede veya **Kurulum bilgileri** ekranını tekrar açınca geri verilmez. **Anahtarı yenile** onaylandıktan sonra eski anahtar hemen geçersiz olur. Yeni değeri GitHub’da **Secret** alanına veya gönderen uygulamanın gizli ayarına da yazın.

**Kapat** yeni teslimatları durdurur. **Aç** yapılandırmayı yeniden etkinleştirir; teslimat sırasında oluşturucu hesabın yönetim ve kanal yazma yetkisi, botun kanal erişimi ve çalışma alanının durumu yeniden kontrol edilir. Kanal arşivlenmişse, bot/oluşturucu askıya alınmışsa veya erişim kaldırılmışsa mesaj gönderilmez. Listede **Açık** yapılandırma tercihini, son başarılı bildirim zamanı son kabul edilen teslimatı gösterir.

Entegrasyonlar en fazla 25 kayıtla sınırlıdır. Kanalı değiştirmek veya farklı depoya bağlamak için doğru hedefle yeni bir entegrasyon oluşturun; eski bağlantıyı kapatın. Mevcut akış ad/kanal/depo değiştirme veya kalıcı kayıt silme işlemi sunmaz.

## Dağıtım ve yedek

`APP_ORIGIN` canlı HTTPS adresi olmalıdır; Mola kopyalanabilir bağlantıyı bu güvenilen değerden üretir. Coolify/proxy genel `/api/hooks/…` yolunu uygulamaya ulaştırmalıdır. GitHub istekleri tarayıcı oturumu kullanmaz; imza, gelen webhook istekleri ise Bearer anahtarı ile doğrulanır.

Anahtarlar veritabanında şifreli tutulur. Şifreleme, hesap güvenliği için kullanılan kalıcı anahtar materyalinden bu özelliğe ayrı olarak türetilir. `MAIL_ENCRYPTION_KEY` yapılandırılmışsa dağıtımlarda aynı değer korunmalıdır. Yerel anahtar kullanılıyorsa `DATA_DIR/.account-security-key` veritabanı ve dosyalarla birlikte yedeklenir. Anahtar değişimini uygulama arayüzündeki entegrasyon anahtarı yenileme işlemiyle karıştırmayın; sunucu şifreleme anahtarını rastgele değiştirmek mevcut kayıtların açılamamasına yol açar.

Doğrulama: `npx playwright test tests/integrations.e2e.spec.ts` gelen webhook kurulumunu, bot kimliğini, yinelenen olayları, anahtar yenilemeyi, kapatmayı ve GitHub kurulum bilgilerini denetler. Sunucu testleri ve dağıtım kabulü için [VERIFICATION.md](VERIFICATION.md) bölümünü izleyin.
