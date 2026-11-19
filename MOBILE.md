# Nota на iPhone и Android + аккаунт с плейлистами

Один и тот же проект собирается под Windows, Android и iPhone (Tauri 2).
Аккаунт Nota хранит плейлисты, «Мне нравится», дизлайки и историю в облаке Supabase,
поэтому они одинаковые на ПК и телефонах. Загруженные файлы остаются на каждом устройстве своими.

---

## 1. Облако для аккаунтов (один раз, ~5 минут)

1. Зарегистрируйтесь на https://supabase.com → **New project** (бесплатный тариф).
2. **SQL Editor** → вставьте содержимое `supabase/schema.sql` → **Run**.
   Это создаёт таблицу `libraries`, где каждый пользователь видит только свою библиотеку.
3. **Authentication → Sign In / Providers → Email**: если не хотите подтверждать почту письмом,
   выключите **Confirm email**.
4. **Project Settings → API**: скопируйте **Project URL** и ключ **anon public**.
5. В папке проекта скопируйте `.env.example` в `.env` и вставьте эти два значения.

После этого любая сборка (ПК, Android, iPhone) сразу умеет входить в аккаунт.
Без `.env` адрес и ключ можно ввести в приложении: **Настройки → Аккаунт → Настройки облака**.

> Ключ `anon public` можно хранить в приложении — доступ к данным ограничен правилами из `schema.sql`.

---

## 2. Android (собирается на вашем Windows-ПК)

Установить один раз:
1. **Android Studio** — https://developer.android.com/studio
2. В Android Studio → **More Actions → SDK Manager**:
   - вкладка SDK Platforms: **Android 14 (API 34)** или новее;
   - вкладка SDK Tools: **Android SDK Build-Tools**, **NDK (Side by side)**, **Android SDK Command-line Tools**.
3. Переменные среды Windows (Пуск → «Изменение системных переменных среды»):
   - `ANDROID_HOME` = `C:\Users\<вы>\AppData\Local\Android\Sdk`
   - `NDK_HOME` = `%ANDROID_HOME%\ndk\<версия>`
   - `JAVA_HOME` = `C:\Program Files\Android\Android Studio\jbr`
4. Цели Rust:
   ```
   rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
   ```

Собрать:
```
npm install
npm run android:init     # один раз: создаёт проект Android и разрешает локальный аудио-прокси
npm run android:build    # APK: src-tauri/gen/android/app/build/outputs/apk/universal/release/
```
Для проверки на телефоне по кабелю (включите «Отладку по USB»): `npm run android:dev`.

Release-APK нужно подписать, чтобы поставить на телефон:
https://v2.tauri.app/distribute/sign/android/ — или для начала ставьте отладочную сборку
`npx tauri android build --apk --debug`.

---

## 3. iPhone (собирается на вашем Mac)

Установить один раз:
1. **Xcode** из App Store, затем `xcode-select --install`.
2. **Rust**: `curl https://sh.rustup.rs -sSf | sh`, затем
   ```
   rustup target add aarch64-apple-ios aarch64-apple-ios-sim
   ```
3. **Node.js 20+** и **CocoaPods**: `brew install node cocoapods`.
4. Apple ID в Xcode → Settings → Accounts. Бесплатного аккаунта хватает, чтобы поставить
   приложение на свой iPhone на 7 дней; платный (99 $/год) — без ограничения и для TestFlight.

Собрать:
```
npm install
export APPLE_DEVELOPMENT_TEAM=XXXXXXXXXX   # Team ID из Xcode → Accounts
npm run ios:init      # один раз
npm run ios:dev       # запуск на подключённом iPhone или в симуляторе
npm run ios:build     # .ipa для установки/TestFlight
```
На iPhone: Настройки → Основные → VPN и управление устройством → доверять разработчику.

`src-tauri/Info.ios.plist` уже включает фоновое воспроизведение и доступ к локальному аудио-прокси.

---

## Что работает на телефоне иначе, чем на ПК

| | ПК | Телефон |
|---|---|---|
| Аккаунт и синхронизация плейлистов | ✓ | ✓ |
| SoundCloud, ВК, Яндекс Музыка | ✓ | ✓ |
| YouTube Music | ✓ (через yt-dlp) | только если YouTube отдаёт поток мобильным клиентам — yt-dlp на телефоне не запускается |
| Вход в ВК / Яндекс | окно входа | вставка токена (кнопка с ключом) |
| Мини-плеер, Discord, выбор папки | ✓ | — |
| Фоновое воспроизведение | ✓ | iPhone ✓ (Info.ios.plist); Android — зависит от прошивки, отключите для Nota экономию батареи |

## Как устроена синхронизация

- Вход по почте и паролю (Supabase Auth). Сессия обновляется сама.
- При **первом входе** библиотека устройства **объединяется** с облачной — ничего не теряется.
- Дальше любое изменение (лайк, плейлист, порядок треков) отправляется в облако через ~1,5 с,
  история — раз в 30 с. При открытии приложения и раз в минуту Nota забирает изменения с других устройств.
- Если два устройства изменили библиотеку одновременно, изменения объединяются.
