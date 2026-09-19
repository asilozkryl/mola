#!/bin/bash
set -euo pipefail

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  fail "Bu komut Mac üzerinde çalışır. Xcode ile iPhone'a kurulum: docs/MOBILE_IOS.md"
fi

ios_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_path="$ios_dir/Mola.xcodeproj"

if ! xcodebuild -version >/dev/null 2>&1; then
  fail "Önce Xcode'u kurup bir kez açın ve ilk kurulumunu tamamlayın. Xcode > Settings > Locations > Command Line Tools bölümünde Xcode'u seçin."
fi

if ! xcrun --sdk iphoneos --show-sdk-path >/dev/null 2>&1; then
  fail "Xcode > Settings > Components bölümünden iOS desteğini kurun."
fi

# Reuse the generated project so a second launch preserves Personal Team signing.
if [[ ! -f "$project_path/project.pbxproj" ]]; then
  if ! command -v xcodegen >/dev/null 2>&1; then
    fail "XcodeGen gerekli. Homebrew kuruluysa: brew install xcodegen. Ardından bu komutu tekrar çalıştırın."
  fi
  xcodegen generate --spec "$ios_dir/project.yml" --project "$ios_dir"
fi

cat <<'GUIDE'
Mola Xcode projesi açılıyor.

1. Xcode > Settings > Apple Accounts bölümünde Apple hesabınızla giriş yapın.
2. Mola hedefinde Signing & Capabilities > Automatically manage signing açık olsun.
3. Team olarak Personal Team hesabınızı seçin. Gerekirse Bundle Identifier'ı
   size özel bir değerle değiştirin (örnek: app.mola.adiniz.mobile).
4. iPhone'u bağlayıp güven iznini ve Geliştirici Modu'nu açın.
5. Mola şeması ve iPhone'unuzu seçip Run (Cmd+R) düğmesine basın.
6. Uygulamadaki sunucu adresi: https://mola.psychodry.cloud

Ücretsiz hesapla imza 7 gün geçerlidir. Yenilemek için aynı projeyi açıp,
aynı Bundle Identifier ile iPhone'da yeniden Run yapın.
GUIDE

open "$project_path"
