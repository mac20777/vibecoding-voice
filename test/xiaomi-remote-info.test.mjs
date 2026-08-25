import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRemoteInfoScript,
  parseRemoteInfoOutput
} from "../src/xiaomi-remote-info.mjs";

test("parseRemoteInfoOutput parses connected payload", () => {
  const output = `some powershell noise\r\n{"connected":true,"batteryLevel":82,"model":"Model Nbr 0.9\\u0000","manufacturer":null,"name":"MI RC","error":null}`;
  assert.deepEqual(parseRemoteInfoOutput(output), {
    connected: true,
    batteryLevel: 82,
    model: "Model Nbr 0.9",
    manufacturer: null,
    name: "MI RC",
    error: null
  });
});

test("parseRemoteInfoOutput parses disconnected payload", () => {
  const output = `{"connected":false,"batteryLevel":null,"model":null,"manufacturer":null,"name":"MI RC","error":null}`;
  const parsed = parseRemoteInfoOutput(output);
  assert.equal(parsed.connected, false);
  assert.equal(parsed.batteryLevel, null);
  assert.equal(parsed.name, "MI RC");
});

test("parseRemoteInfoOutput returns null on empty or invalid output", () => {
  assert.equal(parseRemoteInfoOutput(""), null);
  assert.equal(parseRemoteInfoOutput("not json"), null);
  assert.equal(parseRemoteInfoOutput(null), null);
});

test("buildRemoteInfoScript embeds the remote match quoted", () => {
  const script = buildRemoteInfoScript("VID&012717_PID&32B8");
  assert.match(script, /\$match = 'VID&012717_PID&32B8'/);
  assert.match(script, /00002a19-0000-1000-8000-00805f9b34fb/);
  assert.match(script, /00002a24-0000-1000-8000-00805f9b34fb/);
});

test("buildRemoteInfoScript escapes single quotes in the match string", () => {
  const script = buildRemoteInfoScript("a'b");
  assert.match(script, /\$match = 'a''b'/);
});
