import { runPowerShell } from "./xiaomi-remote-hid-health.mjs";
import { quotePowerShellSingle } from "./xiaomi-remote-runtime.mjs";

// Reads the Xiaomi remote's model name and battery level over BLE GATT
// (Device Information Service 0x180A and Battery Service 0x180F). The remote's
// Bluetooth address is recovered from the HID-over-GATT child PnP id, e.g.
// `BTHLEDEVICE\{00001812-...}_DEV_VID&012717_PID&32B8_REV&4981_D4B8FFBF804D\...`.
// The Windows Bluetooth stack owns the connection, so these reads do not
// interfere with the passive USBPcap audio capture.
const DEFAULT_REMOTE_MATCH = "VID&012717_PID&32B8";
const QUERY_TIMEOUT_MS = 45_000;

export function buildRemoteInfoScript(remoteMatch = DEFAULT_REMOTE_MATCH) {
  return `
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$result = [ordered]@{
  connected = $false
  batteryLevel = $null
  model = $null
  manufacturer = $null
  name = $null
  error = $null
}
function Emit($r) { [Console]::Out.WriteLine(($r | ConvertTo-Json -Compress)); exit 0 }

$match = ${quotePowerShellSingle(remoteMatch)}
$addrHex = $null
try {
  $hidDevices = @(Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object {
    $_.InstanceId -like 'BTHLEDEVICE*' -and
    $_.InstanceId -ilike '*{00001812-*' -and
    $_.InstanceId -ilike "*$match*"
  })
  foreach ($d in $hidDevices) {
    if ($d.InstanceId -match '_([0-9A-Fa-f]{12})\\\\') {
      $addrHex = $Matches[1].ToUpper()
      break
    }
  }
} catch {}
if (-not $addrHex) { $result.error = 'no_hid_node'; Emit $result }

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  [void][Windows.Devices.Bluetooth.BluetoothLEDevice, Windows.Devices.Bluetooth, ContentType=WindowsRuntime]
  [void][Windows.Devices.Bluetooth.BluetoothConnectionStatus, Windows.Devices.Bluetooth, ContentType=WindowsRuntime]
  [void][Windows.Devices.Bluetooth.BluetoothCacheMode, Windows.Devices.Bluetooth, ContentType=WindowsRuntime]
  [void][Windows.Devices.Bluetooth.GenericAttributeProfile.GattDeviceServicesResult, Windows.Devices.Bluetooth.GenericAttributeProfile, ContentType=WindowsRuntime]
  [void][Windows.Devices.Bluetooth.GenericAttributeProfile.GattCharacteristicsResult, Windows.Devices.Bluetooth.GenericAttributeProfile, ContentType=WindowsRuntime]
  [void][Windows.Devices.Bluetooth.GenericAttributeProfile.GattReadResult, Windows.Devices.Bluetooth.GenericAttributeProfile, ContentType=WindowsRuntime]
  [void][Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType=WindowsRuntime]
  [void][Windows.Storage.Streams.UnicodeEncoding, Windows.Storage.Streams, ContentType=WindowsRuntime]
} catch { $result.error = 'winrt_load_failed'; Emit $result }

# PowerShell cannot bind WinRT async results directly (they arrive as raw
# __ComObject), so every await goes through AsTask via reflection and
# DataReader.FromBuffer is invoked through reflection as well.
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
} | Select-Object -First 1)
$fromBuffer = [Windows.Storage.Streams.DataReader].GetMethod('FromBuffer')

function Await-Op($op, $type, $timeoutMs = 15000) {
  try {
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
    if (-not $task.Wait($timeoutMs)) { return $null }
    if ("$($task.Status)" -ne 'RanToCompletion') { return $null }
    return $task.Result
  } catch { return $null }
}

function Read-GattChar($device, [guid]$serviceGuid, [guid]$charGuid) {
  $uncached = [Windows.Devices.Bluetooth.BluetoothCacheMode]::Uncached
  $svcResult = Await-Op ($device.GetGattServicesForUuidAsync($serviceGuid, $uncached)) ([Windows.Devices.Bluetooth.GenericAttributeProfile.GattDeviceServicesResult])
  if (-not $svcResult -or "$($svcResult.Status)" -ne 'Success' -or $svcResult.Services.Count -lt 1) { return $null }
  $svc = $svcResult.Services[0]
  try {
    $chrResult = Await-Op ($svc.GetCharacteristicsForUuidAsync($charGuid, $uncached)) ([Windows.Devices.Bluetooth.GenericAttributeProfile.GattCharacteristicsResult])
    if (-not $chrResult -or "$($chrResult.Status)" -ne 'Success' -or $chrResult.Characteristics.Count -lt 1) { return $null }
    $read = Await-Op ($chrResult.Characteristics[0].ReadValueAsync($uncached)) ([Windows.Devices.Bluetooth.GenericAttributeProfile.GattReadResult])
    if (-not $read -or "$($read.Status)" -ne 'Success') { return $null }
    return $read.Value
  } finally {
    try { $svc.Dispose() } catch {}
  }
}

function Read-GattByte($device, [guid]$s, [guid]$c) {
  $buf = Read-GattChar $device $s $c
  if (-not $buf) { return $null }
  $reader = $fromBuffer.Invoke($null, @($buf))
  try { return [int]$reader.ReadByte() } finally { try { $reader.Dispose() } catch {} }
}

function Read-GattString($device, [guid]$s, [guid]$c) {
  $buf = Read-GattChar $device $s $c
  if (-not $buf) { return $null }
  $reader = $fromBuffer.Invoke($null, @($buf))
  try {
    $reader.UnicodeEncoding = [Windows.Storage.Streams.UnicodeEncoding]::Utf8
    $len = $reader.UnconsumedBufferLength
    if ($len -lt 1) { return $null }
    return $reader.ReadString([uint32]$len)
  } finally { try { $reader.Dispose() } catch {} }
}

$addr = [Convert]::ToUInt64($addrHex, 16)
$ble = Await-Op ([Windows.Devices.Bluetooth.BluetoothLEDevice]::FromBluetoothAddressAsync($addr)) ([Windows.Devices.Bluetooth.BluetoothLEDevice])
if (-not $ble) { $result.error = 'device_not_found'; Emit $result }

try {
  $result.name = $ble.Name
  if ($ble.ConnectionStatus -ne [Windows.Devices.Bluetooth.BluetoothConnectionStatus]::Connected) { Emit $result }
  $result.connected = $true
  $result.batteryLevel = Read-GattByte $ble ([guid]'0000180f-0000-1000-8000-00805f9b34fb') ([guid]'00002a19-0000-1000-8000-00805f9b34fb')
  $result.model = Read-GattString $ble ([guid]'0000180a-0000-1000-8000-00805f9b34fb') ([guid]'00002a24-0000-1000-8000-00805f9b34fb')
  $result.manufacturer = Read-GattString $ble ([guid]'0000180a-0000-1000-8000-00805f9b34fb') ([guid]'00002a29-0000-1000-8000-00805f9b34fb')
} catch {
  $result.error = 'gatt_read_failed'
}
try { $ble.Dispose() } catch {}
Emit $result
`;
}

export function parseRemoteInfoOutput(output) {
  const lines = String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const lastLine = lines[lines.length - 1];
  if (!lastLine) {
    return null;
  }
  try {
    const parsed = JSON.parse(lastLine);
    const text = (value) => {
      if (typeof value !== "string") {
        return null;
      }
      const cleaned = value.replace(/\0/g, "").trim();
      return cleaned || null;
    };
    return {
      connected: parsed.connected === true,
      batteryLevel: Number.isInteger(parsed.batteryLevel) ? parsed.batteryLevel : null,
      model: text(parsed.model),
      manufacturer: text(parsed.manufacturer),
      name: text(parsed.name),
      error: text(parsed.error)
    };
  } catch {
    return null;
  }
}

/**
 * Queries the remote once. Returns null when the platform is unsupported or
 * the query itself failed; otherwise returns the parsed status object (check
 * `connected`/`error` fields for device-level outcomes).
 */
export async function queryXiaomiRemoteInfo(remoteMatch = DEFAULT_REMOTE_MATCH) {
  if (process.platform !== "win32") {
    return null;
  }
  try {
    const output = await runPowerShell(buildRemoteInfoScript(remoteMatch), {
      timeout: QUERY_TIMEOUT_MS
    });
    return parseRemoteInfoOutput(output);
  } catch {
    return null;
  }
}
