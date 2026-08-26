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
  [string]$AdapterMatch = "Bluetooth"
)

$ErrorActionPreference = "Stop"

function Test-OwnerGone {
  if ($OwnerPid -le 0) {
    return $false
  }
  return $null -eq (Get-Process -Id $OwnerPid -ErrorAction SilentlyContinue)
}

function Append-HelperLog([string]$message) {
  try {
    "$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ss') $message" |
      Out-File -FilePath (Join-Path $env:TEMP "xiaomi-usbpcap-helper.log") -Encoding utf8 -Append
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
      Out-File -FilePath (Join-Path $env:TEMP "xiaomi-hid-repair.log") -Encoding utf8 -Append
  } catch {
    # Never let the watchdog kill the capture.
  }
}

# --- Capture supervisor state ---
$script:capture = $null
$script:captureStderrTask = $null
$script:currentDeviceAddress = $DeviceAddress
$script:stripHeaderBytes = 0
$script:bytesWritten = 0
$script:captureStartBytes = 0
$script:captureBackoffSec = 5
$script:lastAdapterCheck = [DateTime]::MinValue
$script:adapterMissingSeen = $false
$script:usbEventsReady = $false

function Test-AdapterPresent {
  # Pure PnP check — never touches the USBPcap driver, so it cannot hang.
  # Service=BTHUSB pins the needle to real USB Bluetooth adapters: enumerator
  # and protocol devices (RFCOMM TDI, BTHENUM, ...) either stay behind or
  # match the needle for the wrong reasons.
  if (-not $AdapterMatch) {
    return $true
  }
  try {
    $escaped = [regex]::Escape($AdapterMatch)
    $dev = Get-CimInstance Win32_PnPEntity -Filter "PNPClass='Bluetooth'" -ErrorAction SilentlyContinue |
      Where-Object { $_.Service -eq "BTHUSB" -and $_.Name -match $escaped } |
      Select-Object -First 1
    return $null -ne $dev
  } catch {
    # A flaky WMI day must not kill a healthy capture.
    return $true
  }
}

function Find-AdapterAddress {
  # Resolves the adapter's USBPcap device address. Call this ONLY while no
  # capture is running: the USBPcapCMD config query can hang for good on a
  # contended/wedged driver (observed in the field), which would block the
  # supervisor loop and the OwnerPid watchdog with it. Hence the hard timeout.
  if (-not $AdapterMatch) {
    return $script:currentDeviceAddress
  }
  if (-not (Test-AdapterPresent)) {
    return $null
  }
  $proc = $null
  try {
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $UsbPcapPath
    $startInfo.Arguments = '--extcap-interface "' + $InterfaceName + '" --extcap-config'
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.CreateNoWindow = $true
    $proc = [System.Diagnostics.Process]::Start($startInfo)
    $stdoutTask = $proc.StandardOutput.ReadToEndAsync()
    if (-not $proc.WaitForExit(5000)) {
      try { $proc.Kill() } catch {}
      Append-HelperLog "USBPcap config query timed out; driver may be wedged"
      return $null
    }
    foreach ($line in ($stdoutTask.Result -split "`r?`n")) {
      if ($line -notmatch [regex]::Escape($AdapterMatch)) {
        continue
      }
      $m = [regex]::Match($line, '\{value=(\d+)(?:_\d+)?\}')
      if ($m.Success) {
        return $m.Groups[1].Value
      }
    }
    Append-HelperLog "USBPcap config query found no adapter matching '$AdapterMatch'"
  } catch {
    Append-HelperLog "USBPcap config query failed: $($_.Exception.Message)"
  } finally {
    if ($proc) {
      try { $proc.Dispose() } catch {}
    }
  }
  return $null
}

function New-CaptureProcess([string]$address) {
  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $UsbPcapPath
  $startInfo.Arguments = '-d "' + $InterfaceName + '" --devices "' + $address + '" --inject-descriptors -o -'
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

function Stop-CaptureProcess {
  if ($null -ne $script:capture -and -not $script:capture.HasExited) {
    try {
      $script:capture.Kill()
      $script:capture.WaitForExit(3000) | Out-Null
    } catch {
      # Best effort; the process is dead or dying anyway.
    }
  }
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

$pipe = $null

try {
  $pipe = [System.IO.Pipes.NamedPipeClientStream]::new(
    ".",
    $PipeName,
    [System.IO.Pipes.PipeDirection]::Out,
    [System.IO.Pipes.PipeOptions]::Asynchronous
  )
  $pipe.Connect(15000)

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

  # Supervisor loop: keep a capture running whenever the Bluetooth adapter is
  # present. USBPcapCMD does not exit when its target device is unplugged — it
  # just goes silent — so a vanished or re-enumerated adapter is detected here
  # and the capture is restarted at the (possibly new) USB address. The pcap
  # parser upstream already consumed one global header, so every capture after
  # the first gets its fresh 24-byte header swallowed.
  $stream = $null
  $buffer = [byte[]]::new(65536)
  while ($pipe.IsConnected -and -not (Test-OwnerGone)) {
    if ($null -eq $script:capture -or $script:capture.HasExited) {
      $stream = $null
      if ($null -ne $script:capture) {
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
      $address = Find-AdapterAddress
      if ($null -eq $address) {
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
      if ($script:adapterMissingSeen) {
        Append-HelperLog "Bluetooth adapter back at USB address $address; restarting capture"
        $script:adapterMissingSeen = $false
      }
      $script:currentDeviceAddress = $address
      $script:capture = New-CaptureProcess -Address $address
      $script:captureStderrTask = $script:capture.StandardError.ReadToEndAsync()
      $script:captureStartBytes = $script:bytesWritten
      if ($script:bytesWritten -gt 0) {
        $script:stripHeaderBytes = 24
      }
      $stream = $script:capture.StandardOutput.BaseStream
    }

    # Adapter watchdog: USB change events (fast path) plus a 15 s poll. The
    # check itself is pure PnP and can never hang on the USBPcap driver.
    $deviceChanged = $false
    if ($script:usbEventsReady) {
      $usbEvents = @(Get-Event -SourceIdentifier "vibe-usb-change" -ErrorAction SilentlyContinue)
      if ($usbEvents.Count -gt 0) {
        $usbEvents | Remove-Event -ErrorAction SilentlyContinue
        $deviceChanged = $true
      }
    }
    $now = Get-Date
    if (($now - $script:lastAdapterCheck).TotalSeconds -ge 15) {
      $script:lastAdapterCheck = $now
      $deviceChanged = $true
    }
    if ($deviceChanged) {
      if (-not (Test-AdapterPresent)) {
        Append-HelperLog "Bluetooth adapter vanished; pausing capture until it returns"
        $script:adapterMissingSeen = $true
        Stop-CaptureProcess
        continue
      }
      if ($script:adapterMissingSeen) {
        Append-HelperLog "Bluetooth adapter returned; restarting capture"
        Stop-CaptureProcess
        continue
      }
    }

    Watch-HidChild

    # Pump one read cycle. The waits time out so the watchdogs above keep
    # running even when the capture is idle; $pipe.IsConnected only flips
    # after a failed write, so the OwnerPid watchdog covers idle pipes.
    $readTask = $stream.ReadAsync($buffer, 0, $buffer.Length)
    while (-not $readTask.Wait(500)) {
      if (-not $pipe.IsConnected -or (Test-OwnerGone)) {
        break
      }
      Watch-HidChild
    }
    if (-not $pipe.IsConnected -or (Test-OwnerGone)) {
      break
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
    $offset = 0
    if ($script:stripHeaderBytes -gt 0) {
      $offset = [Math]::Min($script:stripHeaderBytes, $count)
      $script:stripHeaderBytes -= $offset
    }
    if ($offset -lt $count) {
      $pipe.Write($buffer, $offset, $count - $offset)
      $script:bytesWritten += $count - $offset
      $script:captureBackoffSec = 5
    }
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
      (Join-Path $env:TEMP "xiaomi-usbpcap-helper.log"),
      "USBPcapCMD exited with code $($script:capture.ExitCode) before producing any data.`n$stderr"
    )
  }
}
finally {
  Stop-CaptureProcess
  if ($script:capture) {
    try { $script:capture.Dispose() } catch {}
  }
  if ($script:usbEventsReady) {
    Unregister-Event -SourceIdentifier "vibe-usb-change" -ErrorAction SilentlyContinue
  }
  if ($pipe) {
    $pipe.Dispose()
  }
}
