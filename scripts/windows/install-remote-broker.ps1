param(
  [Parameter(Mandatory = $true)]
  [string]$InstallRoot
)

$ErrorActionPreference = "Stop"
$serviceName = "VibeCodingVoiceRemoteBroker"
$serviceDisplayName = "VibeCoding Voice Remote Broker"
$brokerPath = Join-Path $InstallRoot "resources\remote-broker\VibeCodingVoiceRemoteBroker.exe"
$logDirectory = Join-Path $env:ProgramData "VibeCoding Voice\logs"
$installLog = Join-Path $logDirectory "remote-broker-install.log"

[System.IO.Directory]::CreateDirectory($logDirectory) | Out-Null

function Write-InstallLog([string]$message) {
  "$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ss') $message" |
    Out-File -LiteralPath $installLog -Encoding utf8 -Append
}

function Invoke-ServiceControl([string[]]$arguments, [switch]$AllowFailure) {
  $output = & "$env:SystemRoot\System32\sc.exe" @arguments 2>&1
  $exitCode = $LASTEXITCODE
  if ($output) {
    $output | Out-File -LiteralPath $installLog -Encoding utf8 -Append
  }
  if ($exitCode -ne 0 -and -not $AllowFailure) {
    throw "sc.exe $($arguments[0]) failed with exit code $exitCode"
  }
  return $exitCode
}

try {
  if (-not [System.IO.Path]::IsPathRooted($InstallRoot) -or -not (Test-Path -LiteralPath $brokerPath)) {
    throw "Remote broker executable is missing from the installation directory"
  }

  & $brokerPath --self-test
  if ($LASTEXITCODE -ne 0) {
    throw "Remote broker installation self-test failed with exit code $LASTEXITCODE"
  }

  $existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
  if ($existing) {
    if ($existing.Status -ne "Stopped") {
      Stop-Service -Name $serviceName -Force
      $existing.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(15))
    }
    Invoke-ServiceControl -arguments @(
      "config",
      $serviceName,
      "start=",
      "auto",
      "obj=",
      "LocalSystem",
      "DisplayName=",
      $serviceDisplayName
    ) | Out-Null
  } else {
    Invoke-ServiceControl -arguments @(
      "create",
      $serviceName,
      "binPath=",
      "`"$brokerPath`"",
      "start=",
      "auto",
      "obj=",
      "LocalSystem",
      "DisplayName=",
      $serviceDisplayName
    ) | Out-Null
  }

  # Windows PowerShell's native-command quoting can strip the quotes that must
  # be stored around a service executable path containing spaces. Set PathName
  # through the Win32_Service API instead of relying on sc.exe parsing.
  $serviceInstance = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
  $change = Invoke-CimMethod -InputObject $serviceInstance -MethodName Change -Arguments @{
    PathName = "`"$brokerPath`""
  }
  if ($change.ReturnValue -ne 0) {
    throw "Win32_Service.Change failed with return value $($change.ReturnValue)"
  }
  $storedImagePath = (Get-ItemProperty -LiteralPath "HKLM:\SYSTEM\CurrentControlSet\Services\$serviceName").ImagePath
  if ($storedImagePath -ne "`"$brokerPath`"") {
    throw "Remote broker ImagePath was not stored with safe quoting"
  }

  Invoke-ServiceControl -arguments @(
    "description",
    $serviceName,
    "Provides restricted USB capture and HID repair for the VibeCoding Voice remote."
  ) | Out-Null
  Invoke-ServiceControl -arguments @(
    "failure",
    $serviceName,
    "reset=",
    "86400",
    "actions=",
    "restart/5000/restart/15000/restart/30000"
  ) | Out-Null
  Invoke-ServiceControl -arguments @("failureflag", $serviceName, "1") | Out-Null
  Invoke-ServiceControl -arguments @("sidtype", $serviceName, "unrestricted") | Out-Null

  Start-Service -Name $serviceName
  (Get-Service -Name $serviceName).WaitForStatus("Running", [TimeSpan]::FromSeconds(15))
  Write-InstallLog "remote broker installed and running from $brokerPath"
  exit 0
} catch {
  Write-InstallLog "installation failed: $($_.Exception.Message)"
  Write-Error $_
  exit 1
}
