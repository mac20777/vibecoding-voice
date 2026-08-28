[CmdletBinding()]
param(
  [ValidateSet("Debug", "Release")]
  [string]$Configuration = "Release",
  [string]$VisualStudioRoot = "D:\toolchains\vs2026-buildtools",
  [string]$WdkX86Root = "D:\toolchains\wdk-nuget\Microsoft.Windows.WDK.x86.10.0.28000.2526",
  [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$sourceRoot = Join-Path $projectRoot "windows\virtual-microphone\driver\sysvad"
$msbuild = Join-Path $VisualStudioRoot "MSBuild\Current\Bin\amd64\MSBuild.exe"
$wdkX86Bin = Join-Path $WdkX86Root "c\bin\10.0.28000.0\x86"
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $projectRoot "out\virtual-microphone-driver-$($Configuration.ToLowerInvariant())"
} elseif (-not [System.IO.Path]::IsPathRooted($OutputDirectory)) {
  $OutputDirectory = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $OutputDirectory))
}

foreach ($required in @($msbuild, (Join-Path $wdkX86Bin "stampinf.exe"))) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw "Virtual microphone driver toolchain file is missing: $required"
  }
}

$env:Path = "$wdkX86Bin;$env:Path"
$commonProject = Join-Path $sourceRoot "EndpointsCommon\EndpointsCommon.vcxproj"
$driverProject = Join-Path $sourceRoot "TabletAudioSample\TabletAudioSample.vcxproj"
$commonArgs = @(
  $commonProject, "/m:1", "/nr:false", "/restore", "/t:Rebuild",
  "/p:Configuration=$Configuration", "/p:Platform=x64", "/v:minimal"
)
& $msbuild @commonArgs
if ($LASTEXITCODE -ne 0) {
  throw "EndpointsCommon build failed with exit code $LASTEXITCODE"
}

$driverArgs = @(
  $driverProject, "/m:1", "/nr:false", "/restore", "/t:Rebuild",
  "/p:Configuration=$Configuration", "/p:Platform=x64",
  "/p:WDKBinRoot_x86=$wdkX86Bin", "/p:Inf2CatToolPath=$wdkX86Bin\", "/v:minimal"
)
& $msbuild @driverArgs
if ($LASTEXITCODE -ne 0) {
  throw "VibeCoding virtual microphone driver build failed with exit code $LASTEXITCODE"
}

$buildDirectory = Join-Path $sourceRoot "TabletAudioSample\x64\$Configuration"
$builtSys = Join-Path $buildDirectory "VibeCodingRemoteMic.sys"
$builtInf = Join-Path $buildDirectory "ComponentizedAudioSample.inf"
foreach ($required in @($builtSys, $builtInf)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw "Driver build output is missing: $required"
  }
}

[System.IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
Copy-Item -LiteralPath $builtSys -Destination (Join-Path $OutputDirectory "VibeCodingRemoteMic.sys") -Force
Copy-Item -LiteralPath $builtInf -Destination (Join-Path $OutputDirectory "VibeCodingRemoteMic.inf") -Force
$inf2Cat = Join-Path $wdkX86Bin "Inf2Cat.exe"
& $inf2Cat "/driver:$OutputDirectory" "/os:10_X64" "/uselocaltime"
if ($LASTEXITCODE -ne 0) {
  throw "Inf2Cat validation failed with exit code $LASTEXITCODE"
}
$catalog = Join-Path $OutputDirectory "VibeCodingRemoteMic.cat"
if (-not (Test-Path -LiteralPath $catalog -PathType Leaf)) {
  throw "Inf2Cat did not produce the expected catalog: $catalog"
}
Write-Output $OutputDirectory
