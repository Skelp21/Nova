# Builds Nota.exe on Windows. Installs Node.js, Rust and the C++ build tools
# through winget when they are missing, then runs the Tauri release build.
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Step($t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }
function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [Environment]::GetEnvironmentVariable("Path", "User") + ";" +
                "$env:USERPROFILE\.cargo\bin"
}

if (-not (Has "winget")) {
    Write-Host "winget не найден. Установите 'App Installer' из Microsoft Store и запустите скрипт снова." -ForegroundColor Red
    exit 1
}

Step "1/5 Node.js"
if (-not (Has "node")) {
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    Refresh-Path
}
node -v

Step "2/5 Visual Studio Build Tools (C++)"
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$hasVc = $false
if (Test-Path $vswhere) {
    # Look for the MSVC linker itself, not just a VS install.
    $link = & $vswhere -products * -prerelease -find "VC\Tools\MSVC\**\bin\Hostx64\x64\link.exe" 2>$null
    $hasVc = [bool]$link
}
if (-not $hasVc) {
    Write-Host "Ставлю C++ Build Tools (около 2-4 ГБ, 5-15 минут). Подтвердите запрос Windows на установку." -ForegroundColor Yellow
    $components = "--add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.Windows11SDK.26100 --includeRecommended"
    $existing = $null
    if (Test-Path $vswhere) {
        $existing = & $vswhere -products * -prerelease -property installationPath | Select-Object -First 1
    }
    $vsInstaller = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\setup.exe"
    if ($existing -and (Test-Path $vsInstaller)) {
        # Visual Studio is there but without C++: add the workload to it.
        (Start-Process -FilePath $vsInstaller -Verb RunAs -PassThru -ArgumentList "modify --installPath `"$existing`" $components --passive --norestart").WaitForExit()
    } else {
    winget install -e --id Microsoft.VisualStudio.2022.BuildTools --accept-source-agreements --accept-package-agreements `
        --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.Windows11SDK.26100 --includeRecommended"
    }
    $link = & $vswhere -products * -prerelease -find "VC\Tools\MSVC\**\bin\Hostx64\x64\link.exe" 2>$null
    if (-not $link) {
        Write-Host "Build Tools установились без компонента C++. Откройте Visual Studio Installer -> Изменить -> отметьте 'Разработка классических приложений на C++' и запустите скрипт снова." -ForegroundColor Red
        exit 1
    }
}
Write-Host "MSVC: OK"
# Windows SDK (kernel32.lib etc.) — VS can have MSVC without it.
$sdkLib = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\Lib\*\um\x64\kernel32.lib" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $sdkLib) {
    Write-Host "Нет Windows SDK. Ставлю его через Visual Studio Installer (около 1-2 ГБ). Подтвердите запрос Windows." -ForegroundColor Yellow
    $vsPath = & $vswhere -products * -prerelease -property installationPath | Select-Object -First 1
    $vsInstaller = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\setup.exe"
    (Start-Process -FilePath $vsInstaller -Verb RunAs -PassThru -ArgumentList "modify --installPath `"$vsPath`" --add Microsoft.VisualStudio.Component.Windows11SDK.26100 --passive --norestart").WaitForExit()
    $sdkLib = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\Lib\*\um\x64\kernel32.lib" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $sdkLib) {
        Write-Host "Windows SDK не установился. Visual Studio Installer -> Изменить -> Отдельные компоненты -> 'Windows 11 SDK' и запустите скрипт снова." -ForegroundColor Red
        exit 1
    }
}
Write-Host "Windows SDK: OK ($($sdkLib.FullName))"
& $vswhere -products * -prerelease -format json | Out-File -Encoding utf8 (Join-Path $PSScriptRoot "vs-info.json")

# Load the MSVC environment (PATH, LIB, INCLUDE) so cargo finds link.exe
# even for preview / non-standard Visual Studio installs.
$vcvars = & $vswhere -products * -prerelease -find "VC\Auxiliary\Build\vcvars64.bat" | Select-Object -First 1
if ($vcvars) {
    Write-Host "Загружаю окружение MSVC: $vcvars"
    cmd /c "`"$vcvars`" >nul 2>&1 && set" | ForEach-Object {
        if ($_ -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process") }
    }
}
Get-Command link.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source | Out-File -Encoding utf8 (Join-Path $PSScriptRoot "vs-info-link.txt")

Step "3/5 Rust"
if (-not (Has "cargo")) {
    winget install -e --id Rustlang.Rustup --accept-source-agreements --accept-package-agreements
    Refresh-Path
}
rustup default stable-msvc
cargo -V

Step "4/5 npm install"
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install завершился с ошибкой" }

Step "5/5 Сборка (первый раз 3-8 минут)"
npm run tauri build
if ($LASTEXITCODE -ne 0) { throw "Сборка завершилась с ошибкой — пришлите текст ошибки выше" }

$out = Join-Path $PSScriptRoot "output"
New-Item -ItemType Directory -Force -Path $out | Out-Null
Copy-Item "src-tauri\target\release\nota.exe" (Join-Path $out "Nota.exe") -Force
Get-ChildItem "src-tauri\target\release\bundle" -Recurse -Include *.msi, *-setup.exe | Copy-Item -Destination $out -Force

Write-Host "`nГотово! Файлы в папке: $out" -ForegroundColor Green
Write-Host "  Nota.exe          - запускается сразу, без установки"
Write-Host "  *.msi / *-setup.exe - установщики"
explorer $out
