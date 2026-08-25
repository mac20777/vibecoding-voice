import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHidRestartScript,
  parseHidChildReport
} from "../src/xiaomi-remote-hid-health.mjs";

const SAMPLE_ID = String.raw`BTHLEDEVICE\{00001812-0000-1000-8000-00805F9B34FB}_DEV_VID&012717_PID&32B8_REV&4981_D4B8FFBF804D\9&880E412&F&0008`;

test("parseHidChildReport parses status, problem code, and instance id", () => {
  const entries = parseHidChildReport(`OK|0|${SAMPLE_ID}\r\nError|10|${SAMPLE_ID}2\n`);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], { status: "OK", problem: 0, instanceId: SAMPLE_ID });
  assert.deepEqual(entries[1], { status: "Error", problem: 10, instanceId: `${SAMPLE_ID}2` });
});

test("parseHidChildReport skips empty and malformed lines", () => {
  assert.deepEqual(parseHidChildReport(""), []);
  assert.deepEqual(parseHidChildReport("\r\n\n"), []);
  assert.deepEqual(parseHidChildReport("OK|0|\r\n   \n"), []);
});

test("buildHidRestartScript elevates, waits, and quotes the instance id and log path", () => {
  const script = buildHidRestartScript(SAMPLE_ID, String.raw`C:\Temp\it's here\pnputil.log`);
  assert.match(script, /-Verb RunAs/);
  assert.match(script, /-Wait/);
  assert.ok(!script.includes("\n"), "script must be single-line for EncodedCommand");
  // The pnputil command is embedded as a base64 inner command; decode and verify.
  const encoded = script.match(/-EncodedCommand','([A-Za-z0-9+/=]+)'\)/)?.[1];
  assert.ok(encoded);
  const inner = Buffer.from(encoded, "base64").toString("utf16le");
  assert.ok(inner.includes(`pnputil /restart-device '${SAMPLE_ID}'`));
  // Single quotes in paths are doubled for PowerShell single-quoted strings.
  assert.ok(inner.includes(String.raw`'C:\Temp\it''s here\pnputil.log'`));
  assert.match(inner, /exit \$LASTEXITCODE/);
});
