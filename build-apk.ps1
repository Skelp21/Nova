# Builds Yarvi.apk for Android phones on Windows.
# Downloads a portable JDK and Android SDK/NDK into %LOCALAPPDATA%\YarviAndroid
# (no admin rights, no Android Studio needed), then runs the Tauri Android build.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # makes Invoke-WebRequest much faster
Set-Location -Path $PSScriptRoot

function Step($t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }
function Download($url, $file) {
    Write-Host "Скачиваю $url"
    Invoke-WebRequest -Uri $url -OutFile $file -UseBasicParsing
}

$root = Join-Path $env:LOCALAPPDATA "YarviAndroid"
New-Item -ItemType Directory -Force -Path $root | Out-Null
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") + ";$env:USERPROFILE\.cargo\bin"

Step "1/7 Java (JDK 17)"
$jdk = Get-ChildItem $root -Directory -Filter "jdk-17*" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $jdk) {
    $zip = Join-Path $root "jdk.zip"
    Download "https://aka.ms/download-jdk/microsoft-jdk-17-windows-x64.zip" $zip
    Expand-Archive $zip -DestinationPath $root -Force
    Remove-Item $zip
    $jdk = Get-ChildItem $root -Directory -Filter "jdk-17*" | Select-Object -First 1
}
$env:JAVA_HOME = $jdk.FullName
$env:Path = "$($jdk.FullName)\bin;$env:Path"
Write-Host "JAVA_HOME = $env:JAVA_HOME"

Step "2/7 Android SDK"
$sdk = Join-Path $root "sdk"
$sdkmanager = Join-Path $sdk "cmdline-tools\latest\bin\sdkmanager.bat"
if (-not (Test-Path $sdkmanager)) {
    $zip = Join-Path $root "cmdline-tools.zip"
    Download "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip" $zip
    $tmp = Join-Path $root "cmdline-tmp"
    Expand-Archive $zip -DestinationPath $tmp -Force
    New-Item -ItemType Directory -Force -Path (Join-Path $sdk "cmdline-tools") | Out-Null
    Move-Item (Join-Path $tmp "cmdline-tools") (Join-Path $sdk "cmdline-tools\latest") -Force
    Remove-Item $zip, $tmp -Recurse -Force
}
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk

Step "3/7 Пакеты SDK и NDK (первый раз ~1 ГБ)"
$ndkVersion = "27.2.12479018"
$env:NDK_HOME = Join-Path $sdk "ndk\$ndkVersion"
if (-not (Test-Path $env:NDK_HOME) -or -not (Test-Path (Join-Path $sdk "platforms\android-34"))) {
    # Accept the SDK licenses up front (same hashes sdkmanager writes on "y").
    $lic = Join-Path $sdk "licenses"
    New-Item -ItemType Directory -Force -Path $lic | Out-Null
    Set-Content -Path (Join-Path $lic "android-sdk-license") -Value "`n24333f8a63b6825ea9c5514f83c2829b004d1fee`n8933bad161af4178b1185d1a37fbf41ea5269c55`nd56f5187479451eabf01fb78af6dfcb131a6481e" -NoNewline
    Set-Content -Path (Join-Path $lic "android-sdk-preview-license") -Value "`n84831b9409646a918e30573bab4c9c91346d8abd" -NoNewline
    ("y`n" * 30) | & $sdkmanager --sdk_root=$sdk --licenses | Out-Null
    ("y`n" * 30) | & $sdkmanager --sdk_root=$sdk "platform-tools" "platforms;android-34" "build-tools;34.0.0" "ndk;$ndkVersion"
    if ($LASTEXITCODE -ne 0) { throw "sdkmanager завершился с ошибкой" }
}
Write-Host "NDK_HOME = $env:NDK_HOME"

Step "4/7 Rust для Android"
rustup target add aarch64-linux-android
if ($LASTEXITCODE -ne 0) { throw "rustup не смог добавить цель Android" }

Step "5/7 Окружение MSVC (для сборочных скриптов)"
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vcvars = & $vswhere -products * -prerelease -find "VC\Auxiliary\Build\vcvars64.bat" | Select-Object -First 1
if ($vcvars) {
    cmd /c "`"$vcvars`" >nul 2>&1 && set" | ForEach-Object {
        if ($_ -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process") }
    }
    # vcvars resets PATH: put Java back first.
    $env:Path = "$($jdk.FullName)\bin;$env:Path;$env:USERPROFILE\.cargo\bin"
    Write-Host "MSVC: OK"
} else {
    Write-Host "MSVC не найден — сначала запустите СОБРАТЬ EXE.bat" -ForegroundColor Red
    exit 1
}

Step "6/7 Проект Android"
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install завершился с ошибкой" }
if (-not (Test-Path "src-tauri\gen\android")) {
    npx tauri android init --ci
    if ($LASTEXITCODE -ne 0) { throw "tauri android init завершился с ошибкой" }
}
node scripts/patch-android.mjs

Step "7/7 Сборка APK (первый раз 10-20 минут)"
npx tauri android build --apk --debug --target aarch64
if ($LASTEXITCODE -ne 0) { throw "Сборка APK завершилась с ошибкой — пришлите текст ошибки выше" }

$apk = Get-ChildItem "src-tauri\gen\android\app\build\outputs\apk" -Recurse -Filter *.apk |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
$out = Join-Path $PSScriptRoot "output"
New-Item -ItemType Directory -Force -Path $out | Out-Null
Copy-Item $apk.FullName (Join-Path $out "Yarvi.apk") -Force

Write-Host "`nГотово! $out\Yarvi.apk" -ForegroundColor Green
Write-Host "Скиньте файл на телефон и откройте его. Android попросит разрешить установку из этого источника - разрешите."
explorer $out
