param(
  [Parameter(Mandatory = $true)]
  [string]$PipeName,

  [Parameter(Mandatory = $true)]
  [string]$UsbPcapPath,

  [Parameter(Mandatory = $true)]
  [string]$InterfaceName,

  [Parameter(Mandatory = $true)]
  [string]$DeviceAddress
)

$ErrorActionPreference = "Stop"
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
  # the listener side is gone.
  $stream = $capture.StandardOutput.BaseStream
  $buffer = [byte[]]::new(65536)
  $bytesWritten = 0
  while ($pipe.IsConnected -and -not $capture.HasExited) {
    $readTask = $stream.ReadAsync($buffer, 0, $buffer.Length)
    while (-not $readTask.Wait(500)) {
      if (-not $pipe.IsConnected -or $capture.HasExited) {
        break
      }
    }
    if (-not $pipe.IsConnected -or $capture.HasExited) {
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
