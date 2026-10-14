param(
  [string]$SdkPath = 'C:\Users\himes\AppData\Local\Android\Sdk',
  [string]$JavaPath = 'C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot',
  [string]$Origin = '',
  [switch]$Release,
  [int]$VersionCode = 4,
  [string]$VersionName = '0.4.1'
)
$ErrorActionPreference = 'Stop'
$nativeRoot = $PSScriptRoot
$nativeBuild = Join-Path $nativeRoot 'build'
$toolsPath = Join-Path $SdkPath 'build-tools\34.0.0'
$androidJar = Join-Path $SdkPath 'platforms\android-34\android.jar'
$webAssets = Join-Path $nativeRoot '..\client\dist'
if (!(Test-Path -LiteralPath (Join-Path $webAssets 'index.html'))) { throw 'First run npm.cmd run build in client. The complete mobile frontend is bundled in the APK.' }
$env:JAVA_HOME = $JavaPath
function Run-Native([string]$Exe, [string[]]$Arguments) { & $Exe @Arguments; if ($LASTEXITCODE -ne 0) { throw "Build command failed: $Exe" } }
if (!(Test-Path -LiteralPath $androidJar)) { throw 'Install Android SDK platform 34 and build-tools 34.0.0, then pass -SdkPath.' }
if ($Release) {
  $releaseUrl = [uri]$Origin
  if ($releaseUrl.Scheme -ne 'https' -or $releaseUrl.AbsolutePath -ne '/' -or $releaseUrl.Query -or $releaseUrl.Fragment -or $releaseUrl.UserInfo -or $Origin.EndsWith('/')) { throw 'Release requires -Origin https://your-domain with no trailing slash or path.' }
  foreach ($required in @('FARMCONNECT_KEYSTORE','FARMCONNECT_KEY_ALIAS','FARMCONNECT_STORE_PASS','FARMCONNECT_KEY_PASS')) { if (![Environment]::GetEnvironmentVariable($required)) { throw "Set $required privately before creating a release APK." } }
  # Do not issue another disconnected APK: verify the exact fixed service first.
  Run-Native 'node' @((Join-Path $nativeRoot '..\deploy\verify-public.mjs'), $Origin)
}
if ($VersionCode -lt 1 -or $VersionName -notmatch '^\d+\.\d+\.\d+$') { throw 'Use a positive version code and a numeric x.y.z version name.' }
foreach ($dir in @('res','gen','classes','dex','private')) { New-Item -ItemType Directory -Force -Path (Join-Path $nativeBuild $dir) | Out-Null }
Copy-Item -Path (Join-Path $nativeRoot 'app\src\main\res\*') -Destination (Join-Path $nativeBuild 'res') -Recurse -Force
if (!$Release) {
  '<network-security-config><base-config cleartextTrafficPermitted="false"><trust-anchors><certificates src="system"/></trust-anchors></base-config><domain-config cleartextTrafficPermitted="true"><domain>localhost</domain><domain>127.0.0.1</domain><domain>10.0.2.2</domain></domain-config></network-security-config>' | Set-Content -LiteralPath (Join-Path $nativeBuild 'res\xml\network_security_config.xml')
}
$manifest = Get-Content -LiteralPath (Join-Path $nativeRoot 'app\src\main\AndroidManifest.xml') -Raw
$packageId = if ($Release) { 'app.farmconnect.mobile' } else { 'app.farmconnect.preview' }
$manifest = $manifest.Replace('package="app.farmconnect.mobile"', "package=`"$packageId`" android:versionCode=`"$VersionCode`" android:versionName=`"$VersionName`"")
$manifest | Set-Content -LiteralPath (Join-Path $nativeBuild 'AndroidManifest.xml')
$debugLiteral = if ($Release) { 'false' } else { 'true' }
if ($Origin -match '["\\\r\n]') { throw 'Invalid origin characters.' }
"package app.farmconnect.mobile; public final class BuildConfig { public static final boolean DEBUG=$debugLiteral; public static final String ORIGIN=`"$Origin`"; }" | Set-Content -LiteralPath (Join-Path $nativeBuild 'gen\BuildConfig.java')
Run-Native (Join-Path $toolsPath 'aapt2.exe') @('compile','--dir',(Join-Path $nativeBuild 'res'),'-o',(Join-Path $nativeBuild 'resources.zip'))
Run-Native (Join-Path $toolsPath 'aapt2.exe') @('link','-I',$androidJar,'-A',$webAssets,'--manifest',(Join-Path $nativeBuild 'AndroidManifest.xml'),'--java',(Join-Path $nativeBuild 'gen'),'--auto-add-overlay','-o',(Join-Path $nativeBuild 'unsigned.apk'),(Join-Path $nativeBuild 'resources.zip'))
$javaSources = @((Get-ChildItem -LiteralPath (Join-Path $nativeRoot 'app\src\main\java') -Filter '*.java' -Recurse).FullName) + @((Get-ChildItem -LiteralPath (Join-Path $nativeBuild 'gen') -Filter '*.java' -Recurse).FullName)
Run-Native (Join-Path $JavaPath 'bin\javac.exe') (@('-encoding','UTF-8','-source','8','-target','8','-bootclasspath',((Join-Path $toolsPath 'core-lambda-stubs.jar')+';'+$androidJar),'-d',(Join-Path $nativeBuild 'classes')) + $javaSources)
Run-Native (Join-Path $JavaPath 'bin\jar.exe') @(('-J-Djava.io.tmpdir='+(Join-Path $nativeBuild 'private')),'cf',(Join-Path $nativeBuild 'classes.jar'),'-C',(Join-Path $nativeBuild 'classes'),'.')
Run-Native (Join-Path $toolsPath 'd8.bat') @('--lib',$androidJar,'--min-api','26','--output',(Join-Path $nativeBuild 'dex'),(Join-Path $nativeBuild 'classes.jar'))
Add-Type -AssemblyName System.IO.Compression.FileSystem
$apkArchive = [System.IO.Compression.ZipFile]::Open((Join-Path $nativeBuild 'unsigned.apk'),[System.IO.Compression.ZipArchiveMode]::Update)
try {
  # Windows aapt2 may emit backslashes under assets. Android AssetManager requires slash paths.
  foreach ($assetEntry in @($apkArchive.Entries | Where-Object { $_.FullName.StartsWith('assets/') -and $_.FullName.Contains('\') })) {
    $normalizedName=$assetEntry.FullName.Replace('\','/')
    $assetMemory=[IO.MemoryStream]::new(); $assetRead=$assetEntry.Open()
    try { $assetRead.CopyTo($assetMemory) } finally { $assetRead.Dispose() }
    $assetEntry.Delete(); $normalizedEntry=$apkArchive.CreateEntry($normalizedName)
    $assetWrite=$normalizedEntry.Open()
    try { $assetMemory.Position=0; $assetMemory.CopyTo($assetWrite) } finally { $assetWrite.Dispose(); $assetMemory.Dispose() }
  }
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($apkArchive,(Join-Path $nativeBuild 'dex\classes.dex'),'classes.dex') | Out-Null
} finally { $apkArchive.Dispose() }
Run-Native (Join-Path $toolsPath 'zipalign.exe') @('-f','-p','4',(Join-Path $nativeBuild 'unsigned.apk'),(Join-Path $nativeBuild 'aligned.apk'))
if ($Release) { $signingKey=$env:FARMCONNECT_KEYSTORE; $signingAlias=$env:FARMCONNECT_KEY_ALIAS; $storePass='env:FARMCONNECT_STORE_PASS'; $keyPass='env:FARMCONNECT_KEY_PASS'; $outputName='Farmconnect-release.apk' }
else {
  $signingKey=Join-Path $nativeBuild 'private\debug.keystore'; $signingAlias='androiddebugkey'; $storePass='pass:android'; $keyPass='pass:android'; $outputName='Farmconnect-preview.apk'
  if (!(Test-Path -LiteralPath $signingKey)) { Run-Native (Join-Path $JavaPath 'bin\keytool.exe') @('-genkeypair','-keystore',$signingKey,'-alias',$signingAlias,'-storepass','android','-keypass','android','-dname','CN=Farmconnect Local Test','-keyalg','RSA','-keysize','2048','-validity','3650') }
}
$apkOutput = Join-Path $nativeRoot $outputName
Run-Native (Join-Path $toolsPath 'apksigner.bat') @('sign','--ks',$signingKey,'--ks-key-alias',$signingAlias,'--ks-pass',$storePass,'--key-pass',$keyPass,'--out',$apkOutput,(Join-Path $nativeBuild 'aligned.apk'))
Run-Native (Join-Path $toolsPath 'apksigner.bat') @('verify','--verbose',$apkOutput)
Get-FileHash -Algorithm SHA256 -LiteralPath $apkOutput
