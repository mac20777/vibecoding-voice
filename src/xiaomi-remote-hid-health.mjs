import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

import {
  encodePowerShellCommand,
  quotePowerShellSingle
} from "./xiaomi-remote-runtime.mjs";

// Matches the tested Xiaomi remote's PnP id (VID 0x2717, PID 0x32B8). BLE PnP ids
// carry the vendor prefix, e.g. `DEV_VID&012717_PID&32B8_REV&4981_...`.
const DEFAULT_REMOTE_MATCH = "VID&012717_PID&32B8";
const HID_OVER_GATT_GUID = "{00001812-";

function runPowerShell(script, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      encodePowerShellCommand(script)
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      ...options
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf8"));
        return;
      }
      reject(new Error(
        `powershell exited with code ${code}${signal ? ` (${signal})` : ""}: ` +
          Buffer.concat(stderr).toString("utf8").trim()
      ));
    });
  });
}

export function parseHidChildReport(output) {
  const entries = [];
  for (const line of String(output || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const [status = "", problem = "", ...idParts] = trimmed.split("|");
    const instanceId = idParts.join("|").trim();
    if (!instanceId) {
      continue;
    }
    entries.push({
      status: status.trim(),
      problem: Number(problem),
      instanceId
    });
  }
  return entries;
}

/**
 * Reports the problem code of the remote's HID-over-GATT child device. Returns
 * an empty array when the remote is not enumerated (for example not paired or
 * currently disconnected without leftover nodes).
 */
export async function checkXiaomiRemoteHidHealth(remoteMatch = DEFAULT_REMOTE_MATCH) {
  const script = [
    "$ErrorActionPreference='Stop';",
    "$devices = Get-PnpDevice | Where-Object {",
    "  $_.InstanceId -like 'BTHLEDEVICE*' -and",
    `  $_.InstanceId -ilike '*${HID_OVER_GATT_GUID}*' -and`,
    `  $_.InstanceId -ilike ${quotePowerShellSingle(`*${remoteMatch}*`)}`,
    "};",
    "foreach ($device in $devices) {",
    "  $problem = (Get-PnpDeviceProperty -InstanceId $device.InstanceId -KeyName 'DEVPKEY_Device_ProblemCode' -ErrorAction SilentlyContinue).Data;",
    "  [Console]::Out.Write(($device.Status + '|' + $problem + '|' + $device.InstanceId + \"`n\"));",
    "}"
  ].join(" ");
  return parseHidChildReport(await runPowerShell(script));
}

export function buildHidRestartScript(instanceId, logPath) {
  const inner = [
    "$ErrorActionPreference='Stop';",
    `pnputil /restart-device ${quotePowerShellSingle(instanceId)}`,
    `  | Out-File -FilePath ${quotePowerShellSingle(logPath)} -Encoding utf8;`,
    "exit $LASTEXITCODE"
  ].join(" ");
  return [
    "$ErrorActionPreference='Stop';",
    "$ProgressPreference='SilentlyContinue';",
    "$process = Start-Process powershell.exe",
    `-ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand','${encodePowerShellCommand(inner)}')`,
    "-Verb RunAs -WindowStyle Hidden -Wait -PassThru;",
    "[Console]::Out.Write($process.ExitCode)"
  ].join(" ");
}

/**
 * Restarts the remote's HID-over-GATT child device through an elevated
 * `pnputil /restart-device` (one UAC prompt) and re-checks the problem code.
 */
export async function restartXiaomiRemoteHidChild(instanceId, remoteMatch = DEFAULT_REMOTE_MATCH) {
  const logPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "vibe-hid-restart-")),
    "pnputil.log"
  );
  const stdout = await runPowerShell(buildHidRestartScript(instanceId, logPath));
  const exitCode = Number(String(stdout).trim());
  const output = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8").trim() : "";
  const after = await checkXiaomiRemoteHidHealth(remoteMatch);
  return {
    exitCode: Number.isInteger(exitCode) ? exitCode : null,
    output,
    healthy: after.some((entry) => entry.problem === 0),
    after
  };
}
