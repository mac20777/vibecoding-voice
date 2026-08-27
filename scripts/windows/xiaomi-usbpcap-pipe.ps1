param(
  [Parameter(Mandatory = $true)]
  [string]$PipeName,

  [Parameter(Mandatory = $true)]
  [string]$UsbPcapPath,

  [Parameter(Mandatory = $true)]
  [string]$InterfaceName,

  [Parameter(Mandatory = $true)]
  [string]$DeviceAddress,

  # PID of the listener process that owns the named pipe. When it exits (app
  # quit, crash, kill) this helper stops the capture instead of orphaning an
  # elevated USBPcapCMD that keeps the Bluetooth controller captured forever.
  [int]$OwnerPid = 0,

  # When set (PnP id needle like "VID&012717_PID&32B8"), the helper watches the
  # remote's HID-over-GATT child device for the whole capture lifetime and
  # restarts it with pnputil when Windows reports a problem (the "driver
  # error" after a re-pair). Already elevated, so repairs need no extra UAC
  # prompt and work no matter when the remote was paired.
  [string]$HidDeviceMatch = "",

  # Needle used to re-find the Bluetooth adapter after an unplug/replug
  # (matched against the PnP friendly name; same needle as
  # findUsbDeviceAddress in src/xiaomi-remote-runtime.mjs). Empty disables
  # the adapter watchdog.
  [string]$AdapterMatch = "Bluetooth",

  # When the interface was not explicitly pinned by the user, a replacement
  # Bluetooth radio may be enumerated below another USB root controller. Let
  # the supervisor re-enumerate every USBPcap interface in that case.
  [switch]$AllowInterfaceSwitch,

  # Installed broker passes a shared ProgramData log directory because a
  # LocalSystem service has a different TEMP directory from the desktop user.
  [string]$LogDirectory = ""
)

$ErrorActionPreference = "Stop"

if (-not $LogDirectory) {
  $LogDirectory = $env:TEMP
}
[System.IO.Directory]::CreateDirectory($LogDirectory) | Out-Null

function Test-OwnerGone {
  if ($OwnerPid -le 0) {
    return $false
  }
  return $null -eq (Get-Process -Id $OwnerPid -ErrorAction SilentlyContinue)
}

function Append-HelperLog([string]$message) {
  try {
    "$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ss') $message" |
      Out-File -FilePath (Join-Path $LogDirectory "xiaomi-usbpcap-helper.log") -Encoding utf8 -Append
  } catch {
    # Logging must never kill the capture.
  }
}

# HID child watchdog. One WMI check costs ~0.4 s on a typical machine, so it
# self-throttles: every 5 s for the first two minutes after the helper starts
# (re-pairing and the resulting "driver error" happen in that window), then
# settles to one check a minute. A check can delay pipe forwarding by ~0.4 s;
# the OS pipe buffers absorb it, so no audio is lost. Repairs: at most one a
# minute, and it gives up after 3 repairs per run (a Windows restart is the
# documented fallback then).
$script:watchdogStartedAt = Get-Date
$script:lastHidCheck = [DateTime]::MinValue
$script:lastHidRepair = [DateTime]::MinValue
$script:hidRepairCount = 0

function Watch-HidChild {
  if (-not $HidDeviceMatch -or $script:hidRepairCount -ge 3) {
    return
  }
  $now = Get-Date
  $intervalSec = 60
  if (($now - $script:watchdogStartedAt).TotalSeconds -lt 120) {
    $intervalSec = 5
  }
  if (($now - $script:lastHidCheck).TotalSeconds -lt $intervalSec) {
    return
  }
  $script:lastHidCheck = $now
  try {
    # Same needle as checkXiaomiRemoteHidHealth (src/xiaomi-remote-hid-health.mjs):
    # the remote's HID-over-GATT child under BTHLEDEVICE with a problem code.
    $broken = Get-CimInstance Win32_PnPEntity -Filter "DeviceID like 'BTHLEDEVICE%'" -ErrorAction SilentlyContinue |
      Where-Object {
        $_.DeviceID -ilike "*$HidDeviceMatch*" -and
        $_.DeviceID -like '*{00001812-*' -and
        $_.ConfigManagerErrorCode -ne 0
      } |
      Select-Object -First 1
    if (-not $broken -or ($now - $script:lastHidRepair).TotalSeconds -lt 60) {
      return
    }
    $script:lastHidRepair = $now
    $script:hidRepairCount += 1
    Append-HelperLog "HID child broken (code $($broken.ConfigManagerErrorCode)); restarting it"
    pnputil /restart-device $broken.DeviceID |
      Out-File -FilePath (Join-Path $LogDirectory "xiaomi-hid-repair.log") -Encoding utf8 -Append
  } catch {
    # Never let the watchdog kill the capture.
  }
}

# --- Capture supervisor state ---
$script:capture = $null
$script:captureStderrTask = $null
$script:currentInterfaceName = $InterfaceName
$script:currentDeviceAddress = $DeviceAddress
$script:bytesWritten = 0
$script:captureStartBytes = 0
$script:captureBackoffSec = 5
$script:lastAdapterCheck = [DateTime]::MinValue
$script:adapterMissingSeen = $false
$script:usbEventsReady = $false
$script:lastKnownAdapterFingerprint = ""
$script:lastCaptureEndReason = "startup"
$script:pipe = $null
$script:captureGeneration = 0
$script:captureGenerationOpen = $false

# Named-pipe framing keeps capture generations separate. Without this boundary,
# a pcap record truncated by an adapter removal can be joined to the next
# capture and permanently desynchronize the Node parser.
$script:frameCaptureStart = [byte]1
$script:frameData = [byte]2
$script:frameCaptureEnd = [byte]3

function Write-PipeFrame(
  [byte]$type,
  [byte[]]$payload = [byte[]]::new(0),
  [int]$offset = 0,
  [int]$count = -1
) {
  if ($null -eq $script:pipe -or -not $script:pipe.IsConnected) {
    throw "USBPcap named pipe is disconnected"
  }
  if ($count -lt 0) {
    $count = $payload.Length - $offset
  }
  if ($offset -lt 0 -or $count -lt 0 -or $offset + $count -gt $payload.Length) {
    throw "Invalid USBPcap pipe frame slice"
  }
  $header = [byte[]]::new(5)
  $header[0] = $type
  [BitConverter]::GetBytes([uint32]$count).CopyTo($header, 1)
  $script:pipe.Write($header, 0, $header.Length)
  if ($count -gt 0) {
    $script:pipe.Write($payload, $offset, $count)
  }
}

function Start-CaptureGeneration(
  [string]$interfaceName,
  [string]$address,
  [string]$recoveredFrom = "startup",
  [bool]$adapterChanged = $false
) {
  $script:captureGeneration += 1
  $metadata = [Text.Encoding]::UTF8.GetBytes((@{
    generation = $script:captureGeneration
    interfaceName = $interfaceName
    address = $address
    recoveredFrom = $recoveredFrom
    adapterChanged = $adapterChanged
  } | ConvertTo-Json -Compress))
  Write-PipeFrame -Type $script:frameCaptureStart -Payload $metadata
  $script:captureGenerationOpen = $true
  Append-HelperLog "capture generation $($script:captureGeneration) started on $interfaceName at USB address $address (recovered from $recoveredFrom)"
}

function Stop-CaptureGeneration([string]$reason) {
  if (-not $script:captureGenerationOpen) {
    return
  }
  $metadata = [Text.Encoding]::UTF8.GetBytes((@{
    generation = $script:captureGeneration
    reason = $reason
  } | ConvertTo-Json -Compress))
  try {
    Write-PipeFrame -Type $script:frameCaptureEnd -Payload $metadata
  } catch {
    # The owner may already have closed the pipe. Cleanup must still continue.
  }
  $script:captureGenerationOpen = $false
  Append-HelperLog "capture generation $($script:captureGeneration) ended: $reason"
}

function Get-MatchingAdapterFingerprint {
  # Pure PnP check — never touches the USBPcap driver, so it cannot hang.
  # Service=BTHUSB pins the needle to real USB Bluetooth adapters: enumerator
  # and protocol devices (RFCOMM TDI, BTHENUM, ...) either stay behind or
  # match the needle for the wrong reasons.
  if (-not $AdapterMatch) {
    return "capture-target-without-watchdog"
  }
  try {
    $escaped = [regex]::Escape($AdapterMatch)
    $ids = @(Get-CimInstance Win32_PnPEntity -Filter "PNPClass='Bluetooth'" -ErrorAction SilentlyContinue |
      Where-Object {
        $_.Service -eq "BTHUSB" -and
        $_.Name -match $escaped -and
        $_.ConfigManagerErrorCode -eq 0
      } |
      ForEach-Object { $_.DeviceID } |
      Sort-Object -Unique)
    return $ids -join "|"
  } catch {
    # Null means the check itself failed; an empty string means no healthy
    # matching adapter is currently present.
    return $null
  }
}

function Test-AdapterPresent {
  $fingerprint = Get-MatchingAdapterFingerprint
  # A flaky WMI day must not kill a healthy capture.
  return $null -eq $fingerprint -or [bool]$fingerprint
}

function Invoke-UsbPcapQuery([string]$arguments, [string]$description) {
  $proc = $null
  try {
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $UsbPcapPath
    $startInfo.Arguments = $arguments
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.CreateNoWindow = $true
    $proc = [System.Diagnostics.Process]::Start($startInfo)
    $stdoutTask = $proc.StandardOutput.ReadToEndAsync()
    if (-not $proc.WaitForExit(5000)) {
      try { $proc.Kill() } catch {}
      Append-HelperLog "$description timed out; USBPcap driver may be wedged"
      return $null
    }
    return $stdoutTask.Result
  } catch {
    Append-HelperLog "$description failed: $($_.Exception.Message)"
    return $null
  } finally {
    if ($proc) {
      try { $proc.Dispose() } catch {}
    }
  }
}

function Get-UsbPcapInterfaces {
  $interfaces = [System.Collections.Generic.List[string]]::new()
  if (-not $AllowInterfaceSwitch) {
    [void]$interfaces.Add($script:currentInterfaceName)
    return $interfaces.ToArray()
  }

  $output = Invoke-UsbPcapQuery -Arguments "--extcap-interfaces" -Description "USBPcap interface query"
  if ($null -eq $output) {
    [void]$interfaces.Add($script:currentInterfaceName)
    return $interfaces.ToArray()
  }
  $discovered = [System.Collections.Generic.List[string]]::new()
  foreach ($line in ($output -split "`r?`n")) {
    $match = [regex]::Match($line, '^interface \{value=([^}]+)\}')
    if ($match.Success -and -not $discovered.Contains($match.Groups[1].Value)) {
      [void]$discovered.Add($match.Groups[1].Value)
    }
  }
  # Prefer the current interface when it still exists, while deliberately not
  # querying it when USBPcap no longer enumerates that root controller.
  if ($discovered.Contains($script:currentInterfaceName)) {
    [void]$interfaces.Add($script:currentInterfaceName)
  }
  foreach ($interfaceName in $discovered) {
    if (-not $interfaces.Contains($interfaceName)) {
      [void]$interfaces.Add($interfaceName)
    }
  }
  return $interfaces.ToArray()
}

function Find-CaptureTarget {
  # Resolves both the USBPcap interface and device address. Call this ONLY while no
  # capture is running: the USBPcapCMD config query can hang for good on a
  # contended/wedged driver (observed in the field), which would block the
  # supervisor loop and the OwnerPid watchdog with it. Hence the hard timeout.
  if (-not $AdapterMatch) {
    return [pscustomobject]@{
      InterfaceName = $script:currentInterfaceName
      DeviceAddress = $script:currentDeviceAddress
      AdapterFingerprint = "capture-target-without-watchdog"
    }
  }
  if (-not (Test-AdapterPresent)) {
    return $null
  }

  $fallbackTarget = $null
  foreach ($interfaceName in (Get-UsbPcapInterfaces)) {
    $arguments = '--extcap-interface "' + $interfaceName + '" --extcap-config'
    $output = Invoke-UsbPcapQuery -Arguments $arguments -Description "USBPcap config query for $interfaceName"
    if ($null -eq $output) {
      continue
    }
    foreach ($line in ($output -split "`r?`n")) {
      if ($line -notmatch [regex]::Escape($AdapterMatch)) {
        continue
      }
      $m = [regex]::Match($line, '\{value=(\d+)(?:_\d+)?\}')
      if ($m.Success) {
        $target = [pscustomobject]@{
          InterfaceName = $interfaceName
          DeviceAddress = $m.Groups[1].Value
          AdapterFingerprint = (Get-MatchingAdapterFingerprint)
        }
        if ($line -match '\{enabled=true\}') {
          return $target
        }
        if ($null -eq $fallbackTarget) {
          $fallbackTarget = $target
        }
      }
    }
  }
  if ($null -ne $fallbackTarget) {
    Append-HelperLog "USBPcap exposed only a disabled match for '$AdapterMatch'; using it as a compatibility fallback"
    return $fallbackTarget
  }
  Append-HelperLog "USBPcap queries found no adapter matching '$AdapterMatch'"
  return $null
}

function New-CaptureProcess([string]$interfaceName, [string]$address) {
  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $UsbPcapPath
  $startInfo.Arguments = '-d "' + $interfaceName + '" --devices "' + $address + '" --inject-descriptors -o -'
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.CreateNoWindow = $true

  $proc = [System.Diagnostics.Process]::new()
  $proc.StartInfo = $startInfo
  if (-not $proc.Start()) {
    throw "USBPcapCMD.exe did not start"
  }
  return $proc
}

function Stop-CaptureProcess([string]$reason = "stopped") {
  if ($null -ne $script:capture -and -not $script:capture.HasExited) {
    try {
      $script:capture.Kill()
      $script:capture.WaitForExit(3000) | Out-Null
    } catch {
      # Best effort; the process is dead or dying anyway.
    }
  }
  $script:lastCaptureEndReason = $reason
  Stop-CaptureGeneration -Reason $reason
}

# Interruptible sleep: wakes early when the owner dies or a USB device change
# event arrives. Drains the event queue when it wakes for an event so the
# caller's next wait does not spin on stale events.
function Wait-OrWakeup([int]$seconds) {
  for ($i = 0; $i -lt $seconds * 2; $i++) {
    if (Test-OwnerGone) {
      return $true
    }
    if ($script:usbEventsReady) {
      $pending = @(Get-Event -SourceIdentifier "vibe-usb-change" -ErrorAction SilentlyContinue)
      if ($pending.Count -gt 0) {
        $pending | Remove-Event -ErrorAction SilentlyContinue
        return $false
      }
    }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Get-CaptureAdapterChangeReason {
  $shouldCheck = $false
  if ($script:usbEventsReady) {
    $pending = @(Get-Event -SourceIdentifier "vibe-usb-change" -ErrorAction SilentlyContinue)
    if ($pending.Count -gt 0) {
      $pending | Remove-Event -ErrorAction SilentlyContinue
      $shouldCheck = $true
    }
  }
  $now = Get-Date
  if (($now - $script:lastAdapterCheck).TotalSeconds -ge 15) {
    $script:lastAdapterCheck = $now
    $shouldCheck = $true
  }
  if (-not $shouldCheck) {
    return $null
  }
  $fingerprint = Get-MatchingAdapterFingerprint
  if ($null -eq $fingerprint) {
    return $null
  }
  if ($fingerprint) {
    if ($script:lastKnownAdapterFingerprint -and
        $fingerprint -ne $script:lastKnownAdapterFingerprint) {
      Append-HelperLog "Bluetooth adapter identity changed; re-enumerating every USBPcap interface"
      return "adapter-changed"
    }
    return $null
  }
  if (-not $script:adapterMissingSeen) {
    Append-HelperLog "Bluetooth adapter vanished; pausing capture until it returns"
  }
  $script:adapterMissingSeen = $true
  return "adapter-missing"
}

try {
  $script:pipe = [System.IO.Pipes.NamedPipeClientStream]::new(
    ".",
    $PipeName,
    [System.IO.Pipes.PipeDirection]::Out,
    [System.IO.Pipes.PipeOptions]::Asynchronous
  )
  $script:pipe.Connect(15000)

  # A leftover capture still holds the USBPcap driver and makes any new
  # USBPcapCMD exit immediately (seen as tshark exiting with code 0 right
  # after the pipe connects). This helper is already elevated, so clear them.
  Get-Process -Name USBPcapCMD -ErrorAction SilentlyContinue | Stop-Process -Force

  # USB device arrival/removal events let the adapter watchdog react within a
  # second of an unplug/replug; a slow poll below is the fallback in case
  # events get dropped.
  try {
    Register-CimIndicationEvent -Query "SELECT * FROM Win32_DeviceChangeEvent" -SourceIdentifier "vibe-usb-change"
    $script:usbEventsReady = $true
  } catch {
    Append-HelperLog "USB change event subscription failed; falling back to polling only"
  }

  $initialFingerprint = Get-MatchingAdapterFingerprint
  if ($initialFingerprint) {
    $script:lastKnownAdapterFingerprint = $initialFingerprint
  }

  # Supervisor loop: keep a capture running whenever the Bluetooth adapter is
  # present. USBPcapCMD does not exit when its target device is unplugged — it
  # just goes silent — so a vanished or re-enumerated adapter is detected here
  # and the capture is restarted at the (possibly new) USB address. Every new
  # process becomes a framed capture generation with a fresh pcap parser.
  $stream = $null
  $buffer = [byte[]]::new(65536)
  while ($script:pipe.IsConnected -and -not (Test-OwnerGone)) {
    if ($null -eq $script:capture -or $script:capture.HasExited) {
      $stream = $null
      if ($null -ne $script:capture) {
        Stop-CaptureGeneration -Reason "process-exit"
        $script:lastCaptureEndReason = "process-exit"
        if ($script:bytesWritten -eq $script:captureStartBytes) {
          # Died without producing data (stale driver, wedged driver, ...).
          # Keep the stderr diagnosable and back off so we never spam the
          # driver with new capture processes.
          $stderr = ""
          if ($script:captureStderrTask) {
            try { $stderr = $script:captureStderrTask.Result } catch {}
          }
          Append-HelperLog "USBPcapCMD exited with code $($script:capture.ExitCode) before producing data. $stderr"
          $script:captureBackoffSec = [Math]::Min(30, $script:captureBackoffSec * 2)
        }
        try { $script:capture.Dispose() } catch {}
        $script:capture = $null
      }
      $target = Find-CaptureTarget
      if ($null -eq $target) {
        if (-not $script:adapterMissingSeen) {
          $script:adapterMissingSeen = $true
          Append-HelperLog "Bluetooth adapter not found; waiting for it to return"
        }
        if (Wait-OrWakeup $script:captureBackoffSec) {
          break
        }
        $script:captureBackoffSec = [Math]::Min(30, $script:captureBackoffSec * 2)
        continue
      }
      $previousInterface = $script:currentInterfaceName
      $previousFingerprint = $script:lastKnownAdapterFingerprint
      $nextFingerprint = [string]$target.AdapterFingerprint
      $adapterChanged = [bool](
        ($previousFingerprint -and $nextFingerprint -and $previousFingerprint -ne $nextFingerprint) -or
        ($previousInterface -ne [string]$target.InterfaceName)
      )
      $recoveredFrom = $script:lastCaptureEndReason
      if ($adapterChanged) {
        $recoveredFrom = "adapter-changed"
        Append-HelperLog "Bluetooth capture target changed from $previousInterface to $($target.InterfaceName)"
      }
      if ($script:adapterMissingSeen) {
        Append-HelperLog "Bluetooth adapter back on $($target.InterfaceName) at USB address $($target.DeviceAddress); restarting capture"
        $script:adapterMissingSeen = $false
      }
      $script:currentInterfaceName = [string]$target.InterfaceName
      $script:currentDeviceAddress = [string]$target.DeviceAddress
      if ($nextFingerprint) {
        $script:lastKnownAdapterFingerprint = $nextFingerprint
      }
      $script:capture = New-CaptureProcess -InterfaceName $script:currentInterfaceName -Address $script:currentDeviceAddress
      $script:captureStderrTask = $script:capture.StandardError.ReadToEndAsync()
      $script:captureStartBytes = $script:bytesWritten
      Start-CaptureGeneration `
        -InterfaceName $script:currentInterfaceName `
        -Address $script:currentDeviceAddress `
        -RecoveredFrom $recoveredFrom `
        -AdapterChanged $adapterChanged
      $script:lastCaptureEndReason = "steady"
      $stream = $script:capture.StandardOutput.BaseStream
    }

    # Adapter watchdog: USB change events (fast path) plus a 15 s poll. The
    # same check also runs while ReadAsync is pending, so a silent USBPcapCMD
    # cannot trap the supervisor forever after the adapter disappears.
    $adapterChangeReason = Get-CaptureAdapterChangeReason
    if ($adapterChangeReason) {
      Stop-CaptureProcess -Reason $adapterChangeReason
      continue
    }

    Watch-HidChild

    # Pump one read cycle. The waits time out so the watchdogs above keep
    # running even when the capture is idle; the pipe's IsConnected only flips
    # after a failed write, so the OwnerPid watchdog covers idle pipes.
    $readTask = $stream.ReadAsync($buffer, 0, $buffer.Length)
    $adapterLost = $false
    while (-not $readTask.Wait(500)) {
      if (-not $script:pipe.IsConnected -or (Test-OwnerGone)) {
        break
      }
      $adapterChangeReason = Get-CaptureAdapterChangeReason
      if ($adapterChangeReason) {
        Stop-CaptureProcess -Reason $adapterChangeReason
        $adapterLost = $true
        break
      }
      Watch-HidChild
    }
    if (-not $script:pipe.IsConnected -or (Test-OwnerGone)) {
      break
    }
    if ($adapterLost) {
      continue
    }
    if (-not $readTask.IsCompleted -or $readTask.IsFaulted -or $readTask.IsCanceled -or $script:capture.HasExited) {
      continue
    }
    $count = 0
    try {
      $count = $readTask.Result
    } catch {
      continue
    }
    if ($count -le 0) {
      continue
    }
    Write-PipeFrame -Type $script:frameData -Payload $buffer -Count $count
    $script:bytesWritten += $count
    $script:captureBackoffSec = 5
  }

  if ($script:bytesWritten -eq 0 -and $script:capture -and $script:capture.HasExited) {
    # USBPcapCMD died before producing any data (for example a stale capture
    # still held the driver). Persist its stderr so the failure is diagnosable
    # after the fact.
    $stderr = ""
    if ($script:captureStderrTask) {
      try { $stderr = $script:captureStderrTask.Result } catch {}
    }
    [System.IO.File]::WriteAllText(
      (Join-Path $LogDirectory "xiaomi-usbpcap-helper.log"),
      "USBPcapCMD exited with code $($script:capture.ExitCode) before producing any data.`n$stderr"
    )
  }
}
finally {
  Stop-CaptureProcess -Reason "helper-exit"
  if ($script:capture) {
    try { $script:capture.Dispose() } catch {}
  }
  if ($script:usbEventsReady) {
    Unregister-Event -SourceIdentifier "vibe-usb-change" -ErrorAction SilentlyContinue
  }
  if ($script:pipe) {
    $script:pipe.Dispose()
  }
}
