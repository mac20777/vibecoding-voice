[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$InstallRoot,
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$driverDirectory = Join-Path $InstallRoot "resources\virtual-microphone-driver"
$logDirectory = Join-Path $env:ProgramData "VibeCoding Voice\logs"
$installLog = Join-Path $logDirectory "virtual-microphone-install.log"
$deviceName = "VibeCoding Remote Microphone"
[System.IO.Directory]::CreateDirectory($logDirectory) | Out-Null

function Write-InstallLog([string]$message) {
  "$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ss') $message" |
    Out-File -LiteralPath $installLog -Encoding utf8 -Append
}

function Invoke-PnpUtil([string[]]$arguments) {
  $output = & "$env:SystemRoot\System32\pnputil.exe" @arguments 2>&1
  $exitCode = $LASTEXITCODE
  if ($output) {
    $output | Out-File -LiteralPath $installLog -Encoding utf8 -Append
  }
  if ($exitCode -ne 0) {
    throw "pnputil.exe $($arguments[0]) failed with exit code $exitCode"
  }
  return $output
}

function Assert-ProductionSignature([string]$path) {
  $signature = Get-AuthenticodeSignature -LiteralPath $path
  if ($signature.Status -ne "Valid") {
    throw "Production-signed virtual microphone file is required: $path ($($signature.Status))"
  }
  $signerSubject = [string]$signature.SignerCertificate.Subject
  if ($signerSubject -notmatch '(?i)Microsoft Windows Hardware Compatibility Publisher') {
    throw "Microsoft hardware-signed virtual microphone catalog is required: $path ($signerSubject)"
  }
}

try {
  if (-not [System.IO.Path]::IsPathRooted($InstallRoot)) {
    throw "InstallRoot must be an absolute path"
  }

  if ($Uninstall) {
    $drivers = Get-CimInstance Win32_PnPSignedDriver -ErrorAction SilentlyContinue |
      Where-Object { $_.DeviceName -like "$deviceName*" -and $_.InfName -match '^oem\d+\.inf$' }
    foreach ($driver in $drivers) {
      Invoke-PnpUtil -arguments @("/delete-driver", $driver.InfName, "/uninstall", "/force") | Out-Null
      Write-InstallLog "removed virtual microphone driver $($driver.InfName)"
    }
    exit 0
  }

  $inf = Join-Path $driverDirectory "VibeCodingRemoteMic.inf"
  $cat = Join-Path $driverDirectory "VibeCodingRemoteMic.cat"
  $sys = Join-Path $driverDirectory "VibeCodingRemoteMic.sys"
  foreach ($path in @($inf, $cat, $sys)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      throw "Virtual microphone package is incomplete: $path"
    }
  }

  # Normal releases must never enable Windows test-signing. Refuse unsigned
  # packages here so a development artifact cannot accidentally ship.
  Assert-ProductionSignature $cat
  # pnputil validates that the INF and SYS bytes are covered by this catalog.
  # A catalog-signed driver does not need a second embedded signature in SYS.
  Invoke-PnpUtil -arguments @("/add-driver", $inf, "/install") | Out-Null
  Write-InstallLog "production-signed virtual microphone driver installed from $inf"
  exit 0
} catch {
  Write-InstallLog "virtual microphone operation failed: $($_.Exception.Message)"
  Write-Error $_
  exit 1
}
