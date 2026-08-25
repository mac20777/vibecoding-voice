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

  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $UsbPcapPath
  $startInfo.Arguments = '-d "' + $InterfaceName + '" --devices "' + $DeviceAddress + '" --inject-descriptors -o -'
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $false
  $startInfo.CreateNoWindow = $true

  $capture = [System.Diagnostics.Process]::new()
  $capture.StartInfo = $startInfo
  if (-not $capture.Start()) {
    throw "USBPcapCMD.exe did not start"
  }

  $capture.StandardOutput.BaseStream.CopyTo($pipe)
  $pipe.Flush()
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
