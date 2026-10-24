# Build the Android app on Windows: TWCommute-<version>.apk at the repository root.
#
#   powershell -ExecutionPolicy Bypass -File apps\mobile\scripts\build-apk.ps1
#
# Needs the Android SDK (ANDROID_HOME, or the default %LOCALAPPDATA%\Android\Sdk) with NDK
# 27.1.12297006, JDK 17 or 21 on PATH, and the packages installed (pnpm install). The first build
# takes 10-20 minutes; later ones a few.
#
# Windows limits paths to 260 characters and React Native's native build nests deep below the
# repository, so the build runs from a spare drive letter mapped to the repository (subst). The
# workspace package links are junctions to absolute paths; they point at that drive during the build
# (the JavaScript bundler does not follow them out of it) and are put back afterwards.
#
# Signing: by default the APK carries the debug key, which is fine for installing directly. To sign
# with your own release key (needed for a store, and to keep updating installs signed with it),
# create the key once and keep the file and its password safe; they are never committed:
#   keytool -genkeypair -v -keystore C:\keys\twcommute-release.jks -alias twcommute -keyalg RSA -keysize 2048 -validity 10000
# then, before running this script:
#   $env:TWC_KEYSTORE = "C:\keys\twcommute-release.jks"; $env:TWC_KEY_ALIAS = "twcommute"; $env:TWC_KEYSTORE_PASS = "<password>"
# Android refuses to update an app signed with another key: uninstall a debug-signed TWCommute first.
$ErrorActionPreference = "Stop"
$root = (Resolve-Path "$PSScriptRoot\..\..\..").Path
$mobile = "$root\apps\mobile"
$version = (Get-Content "$mobile\app.json" -Raw | ConvertFrom-Json).expo.version
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "$env:LOCALAPPDATA\Android\Sdk" }
if (-not (Test-Path $sdk)) { throw "Android SDK not found at $sdk; set ANDROID_HOME." }

if (-not (Test-Path "$mobile\android")) {
  Write-Host "== Generating the Android project (expo prebuild)"
  Push-Location $mobile
  try { npx expo prebuild -p android --no-install; if ($LASTEXITCODE) { throw "expo prebuild failed" } } finally { Pop-Location }
}

$used = (Get-PSDrive -PSProvider FileSystem).Name
$letter = "TUVWXYZ".ToCharArray() | Where-Object { $used -notcontains [string]$_ } | Select-Object -First 1
if (-not $letter) { throw "No free drive letter between T: and Z: for the short build path." }
$drive = "${letter}:"
$links = Get-ChildItem "$root\apps\*\node_modules\@twc\*", "$root\packages\*\node_modules\@twc\*" -Force -ErrorAction SilentlyContinue |
  Where-Object { $_.LinkType -eq "Junction" }
if (-not $links) { throw "No workspace package links under node_modules\@twc: run pnpm install first." }

function Set-Links($from, $to) {
  foreach ($l in $links) {
    $target = ([string](Get-Item $l.FullName -Force).Target).Replace($from, $to)
    cmd /c rmdir "$($l.FullName)" | Out-Null
    cmd /c mklink /J "$($l.FullName)" "$target" | Out-Null
  }
}

subst $drive $root
try {
  Set-Links $root $drive
  Write-Host "== Building the release APK from $drive (arm64-v8a)"
  Push-Location "$drive\apps\mobile\android"
  try {
    $env:ANDROID_HOME = $sdk
    $env:NODE_ENV = "production"
    .\gradlew.bat assembleRelease "-PreactNativeArchitectures=arm64-v8a" --console=plain
    if ($LASTEXITCODE) { throw "Gradle build failed" }
  } finally { Pop-Location }
} finally {
  Set-Links $drive $root
  subst $drive /D
}

$built = "$mobile\android\app\build\outputs\apk\release\app-release.apk"
$out = "$root\TWCommute-$version.apk"
if ($env:TWC_KEYSTORE) {
  if (-not $env:TWC_KEY_ALIAS -or -not $env:TWC_KEYSTORE_PASS) { throw "Set TWC_KEY_ALIAS and TWC_KEYSTORE_PASS too." }
  $tools = Get-ChildItem "$sdk\build-tools" | Sort-Object { [version]($_.Name -replace "-.*$", "") } | Select-Object -Last 1
  Write-Host "== Signing with $env:TWC_KEYSTORE ($env:TWC_KEY_ALIAS)"
  & "$($tools.FullName)\apksigner.bat" sign --ks $env:TWC_KEYSTORE --ks-key-alias $env:TWC_KEY_ALIAS `
    --ks-pass env:TWC_KEYSTORE_PASS --out $out $built
  if ($LASTEXITCODE) { throw "apksigner failed" }
  & "$($tools.FullName)\apksigner.bat" verify $out
  if ($LASTEXITCODE) { throw "The signed APK does not verify" }
} else {
  Copy-Item $built $out -Force
}
Write-Host "== $out ($([math]::Round((Get-Item $out).Length / 1MB, 1)) MB)"
