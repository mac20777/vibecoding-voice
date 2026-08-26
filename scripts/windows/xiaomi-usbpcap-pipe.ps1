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
  [string]$HidDeviceMatch = ""
)

$ErrorActionPreference = "Stop"

function Test-OwnerGone {
  if ($OwnerPid -le 0) {
    return $false
  }
  return $null -eq (Get-Process -Id $OwnerPid -ErrorAction SilentlyContinue)
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
    pnputil /restart-device $broken.DeviceID |
      Out-File -FilePath (Join-Path $env:TEMP "xiaomi-hid-repair.log") -Encoding utf8 -Append
  } catch {
    # Never let the watchdog kill the capture.
  }
}
$pipe = $null
$capture = $null

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

  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $UsbPcapPath
  $startInfo.Arguments = '-d "' + $InterfaceName + '" --devices "' + $DeviceAddress + '" --inject-descriptors -o -'
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.CreateNoWindow = $true

  $capture = [System.Diagnostics.Process]::new()
  $capture.StartInfo = $startInfo
  if (-not $capture.Start()) {
    throw "USBPcapCMD.exe did not start"
  }
  $stderrTask = $capture.StandardError.ReadToEndAsync()

  # Stream capture output into the pipe. Do not use CopyTo here: it blocks
  # inside the read, so an idle capture (no USB traffic) would never notice a
  # broken pipe and both helper and USBPcapCMD would be orphaned, keeping the
  # capture driver busy forever. Poll with a timeout and bail out as soon as
  # the listener side is gone. $pipe.IsConnected only flips after a failed
  # write, so an idle pipe (remote asleep or unpaired) looks alive forever;
  # the OwnerPid watchdog covers that gap.
  $stream = $capture.StandardOutput.BaseStream
  $buffer = [byte[]]::new(65536)
  $bytesWritten = 0
  while ($pipe.IsConnected -and -not $capture.HasExited -and -not (Test-OwnerGone)) {
    Watch-HidChild
    $readTask = $stream.ReadAsync($buffer, 0, $buffer.Length)
    while (-not $readTask.Wait(500)) {
      if (-not $pipe.IsConnected -or $capture.HasExited -or (Test-OwnerGone)) {
        break
      }
      Watch-HidChild
    }
    if (-not $pipe.IsConnected -or $capture.HasExited -or (Test-OwnerGone)) {
      break
    }
    $count = $readTask.Result
    if ($count -le 0) {
      break
    }
    $pipe.Write($buffer, 0, $count)
    $bytesWritten += $count
  }
  $pipe.Flush()
  if ($bytesWritten -eq 0 -and $capture.HasExited) {
    # USBPcapCMD died before producing any data (for example a stale capture
    # still held the driver, or the device address vanished). Persist its
    # stderr so the next failure is diagnosable after the fact.
    $stderr = $stderrTask.Result
    [System.IO.File]::WriteAllText(
      (Join-Path $env:TEMP "xiaomi-usbpcap-helper.log"),
      "USBPcapCMD exited with code $($capture.ExitCode) before producing any data.`n$stderr"
    )
  }
}
finally {
  if ($capture -and -not $capture.HasExited) {
    $capture.Kill()
    $capture.WaitForExit(3000) | Out-Null
  }
  if ($capture) {
    $capture.Dispose()
  }
  if ($pipe) {
    $pipe.Dispose()
  }
}
