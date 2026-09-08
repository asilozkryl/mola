# Daha geniş görüşme ekranı — 9 Eylül 2026

Kullanıcı görüşme penceresinin daha büyük ve kolay kullanılabilir olmasını istiyor. Mevcut sesli mod 780 px genişliğe iniyor; katılımcı alanı içerik kadar küçülüyor, metin ve kontroller de dar kalıyor.

## Tasarım yönü

| Token   | Değer     | Rol                           |
| ------- | --------- | ----------------------------- |
| Beyaz   | `#ffffff` | Kontroller ve kartlar         |
| Sis     | `#f4f7f6` | Katılımcı sahnesi             |
| Orman   | `#153d36` | Başlık ve açık kontroller     |
| Yeşil   | `#237459` | Gerçek konuşma ve etkin durum |
| İkincil | `#586568` | Açıklama ve durum             |
| Kırmızı | `#b84439` | Görüşmeden ayrılma            |

Manrope korunur: başlık 18 px, katılımcı adı 14 px, açıklama/kontrol 12–13 px. Profil görselleri 48 px kalır. Pencere masaüstünde en fazla 1160 px genişler ve yaklaşık 76dvh yüksekliği kullanır; kısa ekranlarda kullanılabilir yüksekliği aşmaz. Ses ve kamera aynı dış ölçüyü paylaşır. Katılımcı sayısına göre iki veya üç sütun; paylaşımda geniş görüntü ve dar katılımcı listesi kullanılır. Alt kontroller görünür kalırken orta alan gerektiğinde kayar.

```text
[Oda] Tasarım odası                 [Genişlet] [Sohbete dön]
      Katılımcılar bekleniyor  00:05
┌──────────────────────────────────────────────────────┐
│                                                      │
│     (AÖ) Asil          Görüşmedeki ilk kişisiniz       │
│     Mikrofon açık      Ekibiniz bu odadan katılabilir. │
│                        [Sohbette bekle]               │
│                                                      │
└──────────────────────────────────────────────────────┘
Sohbet      [Mikrofon] [Kamera] [Paylaş] [Ses] [Ayar] [Ayrıl]
devam eder     Açık     Kapalı                    1/6 kişi
```

Genişletme yalnız pencere yerleşimini değiştirir; mikrofon/kamera/paylaşım yeniden başlatılmaz. Escape önce açık paylaşımı, sonra ayarları, sonra geniş görünümü kapatır; son aşamada görüşmeyi küçültür. Küçültme ile ayrılma açıkça farklı eylemlerdir. Geniş ekran seçeneği mobilde gereksizdir; mobil görüşme ekranı zaten tüm kullanılabilir alanı kullanır.

## Brief ile kontrol

Amaç yalnız avatarları büyütmek değil; konuşma ve paylaşım için daha fazla alan, daha büyük metin ve güvenilir kontroller. Dekoratif hareket, büyük illüstrasyon veya sahte ses animasyonu eklenmez. Mevcut gerçek konuşma vurgusu korunur. Mikrofon izni, WebRTC, ekran seçimi ve cihaz değiştirme davranışları korunur.

## Kabul ölçütleri

Masaüstü ölçüler ve genişlet/geri dön; mikrofonun işlem boyunca açık kalması; kamera ve ekran paylaşımı; paylaşım büyütme/Escape önceliği; 320 px ve kısa yatay ekranlarda kontrol erişimi; ses ayarları; klavye odağı, erişilebilirlik ve görüşmeden ayrılınca cihaz temizliği.

## Doğrulama

`npm run build` geçti. `call-panel-layout`, `voice-panel-ux`, `voice-runtime-ux` ve `calls` Playwright dosyalarındaki 19 senaryonun tamamı geçti. Chromium'un test medya aygıtlarıyla genişletme sırasında mikrofon izinin ve yakalama sayısının değişmediği, kamera açılınca dış çerçevenin sabit kaldığı ve ayrılınca cihazların bırakıldığı doğrulandı. İki tarayıcı arasında gerçek WebRTC üzerinden ses, kamera ve ekran video aktarımı da geçti.

1440×1000 masaüstü, geniş görünüm, 320×720 dokunmatik ve 844×390 yatay ekran görüntüleri incelendi. Mobilde altı kontrol ekranda; klavye odağı görüşme içinde ve ciddi/kritik axe ihlali yok. Görseller `artifacts/call-panel-{desktop,expanded,mobile,landscape}.png` altında tutulur.
