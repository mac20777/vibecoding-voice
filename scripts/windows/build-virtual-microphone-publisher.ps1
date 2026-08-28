[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$projectPath = Join-Path $projectRoot "windows\virtual-microphone\publisher\vibecoding-virtual-mic-publisher.vcxproj"
$msbuildCandidates = @(
  "C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\MSBuild.exe",
  "C:\Program Files\Microsoft Visual Studio\2022\Professional\MSBuild\Current\Bin\MSBuild.exe",
  "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\MSBuild\Current\Bin\MSBuild.exe",
  "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\MSBuild\Current\Bin\MSBuild.exe"
)
$msbuild = $msbuildCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $msbuild) {
  throw "Visual Studio C++ Build Tools were not found. Install Visual Studio Build Tools with Desktop development with C++."
}

& $msbuild $projectPath /nologo /m /p:Configuration=Release /p:Platform=x64 /v:minimal
if ($LASTEXITCODE -ne 0) {
  throw "Virtual microphone publisher build failed with exit code $LASTEXITCODE."
}

$outputPath = Join-Path $projectRoot "build-assets\virtual-microphone\vibecoding-virtual-mic-publisher.exe"
if (-not (Test-Path -LiteralPath $outputPath)) {
  throw "The virtual microphone publisher build completed without producing $outputPath."
}
Write-Output $outputPath

