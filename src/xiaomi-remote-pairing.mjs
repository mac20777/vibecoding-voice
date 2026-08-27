import { runPowerShell } from "./xiaomi-remote-hid-health.mjs";
import { quotePowerShellSingle } from "./xiaomi-remote-runtime.mjs";

// Matches the tested Xiaomi remote's PnP id (same default as
// xiaomi-remote-hid-health.mjs).
const DEFAULT_REMOTE_MATCH = "VID&012717_PID&32B8";
const HID_OVER_GATT_GUID = "{00001812-";

// One PowerShell round-trip that reports everything the Remote page pairing
// guide needs: whether a USB Bluetooth adapter is present (mirrors
// Test-AdapterPresent in scripts/windows/xiaomi-usbpcap-pipe.ps1), whether the
// remote is paired (its HID-over-GATT node is enumerated), and the HID child's
// PnP problem code when present.
export function buildPairingStatusScript(remoteMatch = DEFAULT_REMOTE_MATCH) {
  return [
    "$ErrorActionPreference='SilentlyContinue';",
    "$adapter = Get-CimInstance Win32_PnPEntity -Filter \"PNPClass='Bluetooth'\" |",
    "  Where-Object { $_.Service -eq 'BTHUSB' } | Select-Object -First 1;",
    "$hid = Get-PnpDevice | Where-Object {",
    "  $_.InstanceId -like 'BTHLEDEVICE*' -and",
    `  $_.InstanceId -ilike '*${HID_OVER_GATT_GUID}*' -and`,
    `  $_.InstanceId -ilike ${quotePowerShellSingle(`*${remoteMatch}*`)}`,
    "} | Select-Object -First 1;",
    "$problem = $null;",
    "if ($hid) {",
    "  $problem = (Get-PnpDeviceProperty -InstanceId $hid.InstanceId -KeyName 'DEVPKEY_Device_ProblemCode').Data;",
    "}",
    "$result = [ordered]@{",
    "  adapterPresent = ($null -ne $adapter);",
    "  paired = ($null -ne $hid);",
    "  problem = $problem",
    "};",
    "[Console]::Out.WriteLine(($result | ConvertTo-Json -Compress));"
  ].join(" ");
}

export function parsePairingStatusOutput(output) {
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
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const problem = parsed.problem === null || parsed.problem === undefined
      ? null
      : Number(parsed.problem);
    return {
      adapterPresent: parsed.adapterPresent === true,
      paired: parsed.paired === true,
      problem: Number.isInteger(problem) ? problem : null
    };
  } catch {
    return null;
  }
}

/**
 * Returns the pairing guide status, or null on non-Windows platforms and when
 * the query itself fails (flaky WMI must never break the page).
 */
export async function checkRemotePairingStatus(remoteMatch = DEFAULT_REMOTE_MATCH) {
  if (process.platform !== "win32") {
    return null;
  }
  try {
    const output = await runPowerShell(buildPairingStatusScript(remoteMatch), {
      timeout: 15_000
    });
    return parsePairingStatusOutput(output);
  } catch {
    return null;
  }
}
