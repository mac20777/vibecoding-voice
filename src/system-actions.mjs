// Runs Windows power/session commands for remote-button "system" actions.
// Kept separate from server.mjs so the command table is unit-testable with a
// stubbed spawn.

import { spawn } from "node:child_process";

import { SYSTEM_COMMANDS } from "./remote-buttons.mjs";

export { SYSTEM_COMMANDS };

// shutdown/restart use shutdown.exe; lock is instantaneous via user32; sleep
// goes through the .NET API because rundll32 powrprof misbehaves when
// hibernation is enabled (it hibernates instead of sleeping).
const WINDOWS_COMMANDS = Object.freeze({
  shutdown: Object.freeze({ file: "shutdown.exe", args: Object.freeze(["/s", "/t", "0"]) }),
  restart: Object.freeze({ file: "shutdown.exe", args: Object.freeze(["/r", "/t", "0"]) }),
  lock: Object.freeze({ file: "rundll32.exe", args: Object.freeze(["user32.dll,LockWorkStation"]) }),
  sleep: Object.freeze({
    file: "powershell.exe",
    args: Object.freeze([
      "-NoProfile", "-Command",
      "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)"
    ])
  })
});

/**
 * Executes a system command. Returns true when a process was launched.
 * Dry-run and non-Windows platforms only log (returns false) so mappings can
 * be tested safely on any machine.
 */
export function runSystemCommand(command, { dryRun = false, platform = process.platform, spawnImpl = spawn, log = () => {} } = {}) {
  const spec = WINDOWS_COMMANDS[String(command || "").trim().toLowerCase()];
  if (!spec) {
    throw new Error(`Unknown system command: ${command}`);
  }
  if (dryRun) {
    log("[dry-run] system command", command);
    return false;
  }
  if (platform !== "win32") {
    log("system command unsupported on this platform, skipped:", command);
    return false;
  }
  const child = spawnImpl(spec.file, [...spec.args], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref?.();
  log("system command launched:", command);
  return true;
}
