#!/bin/bash
# Builds Yarvi for iPhone on a Mac. Double-click in Finder.
# Installs Homebrew / Node / CocoaPods / Rust if missing, then builds a
# development-signed .ipa you can install on your own iPhone.
set -e
cd "$(dirname "$0")"

step() { printf "\n\033[36m=== %s ===\033[0m\n" "$1"; }

step "1/6 Xcode"
if ! xcode-select -p >/dev/null 2>&1 || ! command -v xcodebuild >/dev/null; then
  echo "Установите Xcode из App Store, откройте его один раз и запустите скрипт снова."
  open "macappstore://apps.apple.com/app/xcode/id497799835"
  exit 1
fi
sudo xcodebuild -license accept 2>/dev/null || true

step "2/6 Homebrew, Node, CocoaPods"
if ! command -v brew >/dev/null; then
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"
command -v node >/dev/null || brew install node
command -v pod >/dev/null || brew install cocoapods

step "3/6 Rust"
if ! command -v cargo >/dev/null && [ ! -f "$HOME/.cargo/env" ]; then
  curl https://sh.rustup.rs -sSf | sh -s -- -y
fi
source "$HOME/.cargo/env"
rustup target add aarch64-apple-ios aarch64-apple-ios-sim

step "4/6 Apple Team ID"
if [ -z "$APPLE_DEVELOPMENT_TEAM" ] && [ -f .apple-team ]; then
  APPLE_DEVELOPMENT_TEAM="$(cat .apple-team)"
fi
if [ -z "$APPLE_DEVELOPMENT_TEAM" ]; then
  echo "Xcode → Settings → Accounts → ваш Apple ID → Team (Personal Team подходит)."
  echo "Team ID — 10 символов, видно в Keychain/сертификате или на developer.apple.com → Membership."
  read -r -p "Введите Team ID: " APPLE_DEVELOPMENT_TEAM
  echo "$APPLE_DEVELOPMENT_TEAM" > .apple-team
fi
export APPLE_DEVELOPMENT_TEAM

step "5/6 Проект iOS"
npm install
[ -d src-tauri/gen/apple ] || npx tauri ios init --ci

step "6/6 Сборка (первый раз 10-20 минут)"
echo "Подключите iPhone кабелем и разблокируйте его — Xcode зарегистрирует его для подписи."
npx tauri ios build --export-method debugging

IPA="$(find src-tauri/gen/apple/build -name '*.ipa' | head -n 1)"
mkdir -p output
cp "$IPA" output/Yarvi.ipa
printf "\n\033[32mГотово: output/Yarvi.ipa\033[0m\n"
echo "Установка: Xcode → Window → Devices and Simulators → ваш iPhone → «+» → выберите Yarvi.ipa."
echo "На iPhone: Настройки → Основные → VPN и управление устройством → доверять разработчику."
open output
open -a Xcode
