import test from "node:test";
import assert from "node:assert/strict";

import { runSystemCommand, SYSTEM_COMMANDS } from "../src/system-actions.mjs";

function recordingSpawn(calls) {
  return (file, args, options) => {
    calls.push({ file, args, options });
    return { unref() {} };
  };
}

test("SYSTEM_COMMANDS exposes the four power/session commands", () => {
  assert.deepEqual([...SYSTEM_COMMANDS], ["shutdown", "restart", "sleep", "lock"]);
});

test("runSystemCommand spawns the right Windows command per action", () => {
  const calls = [];
  for (const command of SYSTEM_COMMANDS) {
    assert.equal(runSystemCommand(command, { spawnImpl: recordingSpawn(calls) }), true);
  }
  assert.deepEqual(calls.map((c) => c.file), ["shutdown.exe", "shutdown.exe", "powershell.exe", "rundll32.exe"]);
  assert.deepEqual(calls[0].args, ["/s", "/t", "0"]);
  assert.deepEqual(calls[1].args, ["/r", "/t", "0"]);
  assert.ok(calls[2].args.join(" ").includes("SetSuspendState"));
  assert.deepEqual(calls[3].args, ["user32.dll,LockWorkStation"]);
  for (const call of calls) {
    assert.equal(call.options.windowsHide, true);
    assert.equal(call.options.detached, true);
  }
});

test("runSystemCommand honours dry-run and non-Windows guards", () => {
  const calls = [];
  const spawnImpl = recordingSpawn(calls);
  assert.equal(runSystemCommand("shutdown", { dryRun: true, spawnImpl }), false);
  assert.equal(runSystemCommand("shutdown", { platform: "linux", spawnImpl }), false);
  assert.equal(calls.length, 0);
});

test("runSystemCommand rejects unknown commands before touching the OS", () => {
  const calls = [];
  assert.throws(
    () => runSystemCommand("wipe", { spawnImpl: recordingSpawn(calls) }),
    /Unknown system command/
  );
  assert.equal(calls.length, 0);
});
