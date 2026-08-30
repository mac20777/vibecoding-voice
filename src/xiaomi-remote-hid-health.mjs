import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

import { quotePowerShellSingle } from "./xiaomi-remote-runtime.mjs";
import {
  isInstalledDesktopRuntime,
  restartRemoteHidViaBroker
} from "./windows-remote-broker-client.mjs";

// Matches the tested Xiaomi remote's PnP id (VID 0x2717, PID 0x32B8). BLE PnP ids
// carry the vendor prefix, e.g. `DEV_VID&012717_PID&32B8_REV&4981_...`.
const DEFAULT_REMOTE_MATCH = "VID&012717_PID&32B8";
const HID_OVER_GATT_GUID = "{00001812-";

export function runPowerShell(script, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script
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

/**
 * Restarts the remote's HID-over-GATT child through the installed broker and
 * re-checks the problem code. Source/CLI development keeps a RunAs fallback.
 */
export async function restartXiaomiRemoteHidChild(instanceId, remoteMatch = DEFAULT_REMOTE_MATCH) {
  let exitCode = null;
  let output = "";
  try {
    const broker = await restartRemoteHidViaBroker(instanceId);
    exitCode = Number.isInteger(broker.exitCode) ? broker.exitCode : null;
    output = String(broker.output || "").trim();
  } catch (brokerError) {
    if (isInstalledDesktopRuntime()) {
      throw new Error(
        "VibeCoding Voice Remote Broker is unavailable. Repair or reinstall VibeCoding Voice. " +
          `(${brokerError.message || brokerError})`
      );
    }

    // Developer/CLI fallback only. Packaged builds never request elevation at
    // runtime, which keeps login startup free of UAC prompts.
    const logPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "vibe-hid-restart-")),
      "pnputil.log"
    );
    const { buildHidRestartScript, runEncodedPowerShell } = await import(
      "./xiaomi-remote-dev-elevation.mjs"
    );
    const stdout = await runEncodedPowerShell(buildHidRestartScript(instanceId, logPath));
    exitCode = Number(String(stdout).trim());
    output = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8").trim() : "";
  }
  const after = await checkXiaomiRemoteHidHealth(remoteMatch);
  return {
    exitCode: Number.isInteger(exitCode) ? exitCode : null,
    output,
    healthy: after.some((entry) => entry.problem === 0),
    after
  };
}
