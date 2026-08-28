[CmdletBinding()]
param(
  [string]$DriverDirectory = "",
  [switch]$AllowMissing
)

$ErrorActionPreference = "Stop"
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
if ([string]::IsNullOrWhiteSpace($DriverDirectory)) {
  $DriverDirectory = Join-Path $projectRoot "build-assets\virtual-microphone-driver"
} elseif (-not [System.IO.Path]::IsPathRooted($DriverDirectory)) {
  $DriverDirectory = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $DriverDirectory))
}

$inf = Join-Path $DriverDirectory "VibeCodingRemoteMic.inf"
$cat = Join-Path $DriverDirectory "VibeCodingRemoteMic.cat"
$sys = Join-Path $DriverDirectory "VibeCodingRemoteMic.sys"
$required = @($inf, $cat, $sys)
$present = @($required | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })

if ($present.Count -eq 0 -and $AllowMissing) {
  Write-Host "Virtual microphone driver is not staged; building a development installer without it."
  exit 0
}
if ($present.Count -ne $required.Count) {
  throw "Virtual microphone driver package is incomplete. Expected VibeCodingRemoteMic.inf, .cat, and .sys together in $DriverDirectory"
}

$infText = Get-Content -LiteralPath $inf -Raw
if ($infText -notmatch '(?im)^\s*CatalogFile(?:\.\w+)?\s*=\s*VibeCodingRemoteMic\.cat\s*$') {
  throw "VibeCodingRemoteMic.inf does not declare VibeCodingRemoteMic.cat"
}
if ($infText -notmatch '(?i)VibeCodingRemoteMic\.sys') {
  throw "VibeCodingRemoteMic.inf does not reference VibeCodingRemoteMic.sys"
}

$catalogSignature = Get-AuthenticodeSignature -LiteralPath $cat
if ($catalogSignature.Status -ne "Valid") {
  throw "Virtual microphone catalog signature is not valid: $($catalogSignature.Status)"
}
$signerSubject = [string]$catalogSignature.SignerCertificate.Subject
if ($signerSubject -notmatch '(?i)Microsoft Windows Hardware Compatibility Publisher') {
  throw "Virtual microphone catalog is not Microsoft hardware-signed: $signerSubject"
}

$signTool = Get-ChildItem -LiteralPath "${env:ProgramFiles(x86)}\Windows Kits\10\bin" `
  -Filter signtool.exe -File -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.Directory.Name -eq "x64" } |
  Sort-Object FullName -Descending |
  Select-Object -First 1 -ExpandProperty FullName
if (-not $signTool) {
  throw "Windows SDK signtool.exe is required to validate the driver package"
}

& $signTool verify /kp /c $cat $sys
if ($LASTEXITCODE -ne 0) {
  throw "signtool could not verify VibeCodingRemoteMic.sys against its Microsoft-signed catalog"
}

Write-Host "Verified production virtual microphone driver package: $DriverDirectory"

