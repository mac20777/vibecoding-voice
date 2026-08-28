[CmdletBinding()]
param(
  [string]$Destination
)

$ErrorActionPreference = "Stop"
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$lockPath = Join-Path $projectRoot "windows\virtual-microphone\driver\upstream-lock.json"
$lock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
if (-not $Destination) {
  $Destination = Join-Path $projectRoot "windows\virtual-microphone\.reference\windows-driver-samples"
}
$Destination = [System.IO.Path]::GetFullPath($Destination)

if (-not (Test-Path -LiteralPath $Destination)) {
  [System.IO.Directory]::CreateDirectory((Split-Path -Parent $Destination)) | Out-Null
  & git clone --filter=blob:none --no-checkout $lock.repository $Destination
  if ($LASTEXITCODE -ne 0) {
    throw "Could not clone the official Windows driver samples."
  }
}

& git -C $Destination fetch origin $lock.commit --depth 1
if ($LASTEXITCODE -ne 0) {
  throw "Could not fetch the locked Windows driver sample commit."
}
& git -C $Destination sparse-checkout init --cone
& git -C $Destination sparse-checkout set $lock.samplePath
& git -C $Destination checkout --detach $lock.commit
if ($LASTEXITCODE -ne 0) {
  throw "Could not check out the locked Windows driver sample commit."
}

$resolved = (& git -C $Destination rev-parse HEAD).Trim()
if ($resolved -ne $lock.commit) {
  throw "Official sample lock mismatch: expected $($lock.commit), got $resolved"
}
Write-Output (Join-Path $Destination $lock.samplePath)

