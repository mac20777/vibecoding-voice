import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPairingStatusScript,
  parsePairingStatusOutput
} from "../src/xiaomi-remote-pairing.mjs";

test("parsePairingStatusOutput parses a full status", () => {
  const output = '\r\n{"adapterPresent":true,"paired":true,"problem":0}\r\n';
  assert.deepEqual(parsePairingStatusOutput(output), {
    adapterPresent: true,
    paired: true,
    problem: 0
  });
});

test("parsePairingStatusOutput handles unpaired states", () => {
  assert.deepEqual(parsePairingStatusOutput('{"adapterPresent":true,"paired":false,"problem":null}'), {
    adapterPresent: true,
    paired: false,
    problem: null
  });
  assert.deepEqual(parsePairingStatusOutput('{"adapterPresent":false,"paired":false,"problem":null}'), {
    adapterPresent: false,
    paired: false,
    problem: null
  });
});

test("parsePairingStatusOutput keeps a non-zero problem code", () => {
  const status = parsePairingStatusOutput('{"adapterPresent":true,"paired":true,"problem":10}');
  assert.equal(status.problem, 10);
});

test("parsePairingStatusOutput reads the last non-empty line", () => {
  const output = 'some powershell noise\r\n{"adapterPresent":true,"paired":false,"problem":null}\r\n';
  assert.equal(parsePairingStatusOutput(output).adapterPresent, true);
});

test("parsePairingStatusOutput rejects bad output", () => {
  assert.equal(parsePairingStatusOutput(""), null);
  assert.equal(parsePairingStatusOutput(null), null);
  assert.equal(parsePairingStatusOutput("not json"), null);
  assert.equal(parsePairingStatusOutput("[1,2,3]"), null);
});

test("parsePairingStatusOutput coerces wrong-typed fields to safe defaults", () => {
  assert.deepEqual(parsePairingStatusOutput('{"adapterPresent":1,"paired":"yes","problem":"10"}'), {
    adapterPresent: false,
    paired: false,
    problem: 10
  });
});

test("buildPairingStatusScript queries the BTHUSB adapter and the remote HID node", () => {
  const script = buildPairingStatusScript();
  assert.match(script, /PNPClass='Bluetooth'/);
  assert.match(script, /BTHUSB/);
  assert.match(script, /BTHLEDEVICE/);
  assert.match(script, /VID&012717_PID&32B8/);
  assert.match(script, /DEVPKEY_Device_ProblemCode/);
});

test("buildPairingStatusScript embeds a custom remote match safely quoted", () => {
  const script = buildPairingStatusScript("VID&012717_PID&FFFF");
  assert.match(script, /\*VID&012717_PID&FFFF\*/);
});
