import test from "node:test";
import assert from "node:assert/strict";

import {
  XiaomiRemoteProtocolParser,
  parseMsbcHidPacket,
  parseUsbPcapNotificationLine
} from "../src/xiaomi-remote-protocol.mjs";
import {
  buildElevatedUsbPcapCommand,
  encodePowerShellCommand,
  findUsbDeviceAddress,
  parseExtcapInterfaces,
  quotePowerShellSingle,
  resolveAsarUnpackedPath
} from "../src/xiaomi-remote-runtime.mjs";

const CONTROL_START = `0x0025|${"01" + "00".repeat(19)}`;
const CONTROL_STOP = `0x0025|${"00".repeat(20)}`;
const ALTERNATE_CONTROL_START = `0x0035|${"01" + "00".repeat(19)}`;
const ALTERNATE_CONTROL_STOP = `0x0035|${"00".repeat(20)}`;

function audioLine(handle, sequence, fill = 0x55) {
  const packet = Buffer.alloc(60, fill);
  packet[0] = 0x01;
  packet[1] = sequence;
  packet[2] = 0xad;
  packet[59] = 0x00;
  return `${handle}|${packet.toString("hex")}`;
}

test("USBPcap parsers find interfaces and the Bluetooth adapter address", () => {
  assert.deepEqual(
    parseExtcapInterfaces([
      "interface {value=\\\\.\\USBPcap1}{display=USBPcap1}",
      "interface {value=\\\\.\\USBPcap2}{display=USBPcap2}"
    ].join("\n")),
    [String.raw`\\.\USBPcap1`, String.raw`\\.\USBPcap2`]
  );

  const tree = [
    "value {arg=99}{value=1}{display=[1] USB Composite Device}{enabled=true}",
    "value {arg=99}{value=3}{display=[3] BARROT Bluetooth 5.4 Adapter}{enabled=true}",
    "value {arg=99}{value=3_16}{display=Xiaomi voice remote}{enabled=false}{parent=3}"
  ].join("\n");
  assert.equal(findUsbDeviceAddress(tree, "BARROT Bluetooth"), "3");
  // The default needle is brand-agnostic.
  assert.equal(findUsbDeviceAddress(tree), "3");
  assert.equal(
    findUsbDeviceAddress("value {arg=99}{value=7}{display=[7] Realtek Bluetooth 5.3 Radio}{enabled=true}"),
    "7"
  );
  assert.equal(findUsbDeviceAddress(tree, "Xiaomi voice remote"), "3");
  assert.equal(findUsbDeviceAddress([
    "value {arg=99}{value=4}{display=[4] Old Bluetooth Adapter}{enabled=false}",
    "value {arg=99}{value=8}{display=[8] New Bluetooth Adapter}{enabled=true}"
  ].join("\n")), "8");
});

test("elevated USBPcap launcher safely quotes paths and uses the named-pipe helper", () => {
  assert.equal(
    resolveAsarUnpackedPath(String.raw`C:\Program Files\Vibe\resources\app.asar\scripts\helper.ps1`),
    String.raw`C:\Program Files\Vibe\resources\app.asar.unpacked\scripts\helper.ps1`
  );
  assert.equal(quotePowerShellSingle("D:\\it's here\\tool.ps1"), "'D:\\it''s here\\tool.ps1'");
  assert.equal(
    Buffer.from(encodePowerShellCommand("Write-Output '你好'"), "base64").toString("utf16le"),
    "Write-Output '你好'"
  );

  const command = buildElevatedUsbPcapCommand({
    pipeHelperPath: String.raw`D:\repo with space\scripts\helper.ps1`,
    usbPcapPath: String.raw`C:\Program Files\USBPcap\USBPcapCMD.exe`,
    interfaceName: String.raw`\\.\USBPcap1`,
    deviceAddress: "3"
  }, "vibecoding-test-pipe", 4242);
  assert.match(command, /Start-Process/);
  assert.match(command, /-Verb RunAs/);
  assert.match(command, /-WindowStyle Hidden/);
  const encodedInner = command.match(/'([A-Za-z0-9+/=]+)'\) -Verb RunAs/)?.[1];
  assert.ok(encodedInner);
  const inner = Buffer.from(encodedInner, "base64").toString("utf16le");
  assert.match(inner, /xiaomi|helper\.ps1/);
  assert.match(inner, /vibecoding-test-pipe/);
  assert.match(inner, /\\\\\.\\USBPcap1/);
  // The helper gets the listener PID so it can stop the capture when the
  // owner exits instead of orphaning an elevated USBPcapCMD.
  assert.match(inner, /-OwnerPid 4242/);

  const withWatchdog = buildElevatedUsbPcapCommand({
    pipeHelperPath: "helper.ps1",
    usbPcapPath: "USBPcapCMD.exe",
    interfaceName: String.raw`\\.\USBPcap1`,
    deviceAddress: "3",
    hidDeviceMatch: "VID&012717_PID&32B8"
  }, "pipe", 4242);
  const watchdogInner = Buffer.from(
    withWatchdog.match(/'([A-Za-z0-9+/=]+)'\) -Verb RunAs/)?.[1],
    "base64"
  ).toString("utf16le");
  // The device needle goes to the elevated helper so its watchdog can repair a
  // broken HID child ("driver error") in place, sharing the capture's UAC
  // prompt; ampersands must stay quoted.
  assert.match(watchdogInner, /-HidDeviceMatch 'VID&012717_PID&32B8'/);

  const withAdapterMatch = buildElevatedUsbPcapCommand({
    pipeHelperPath: "helper.ps1",
    usbPcapPath: "USBPcapCMD.exe",
    interfaceName: String.raw`\\.\USBPcap1`,
    deviceAddress: "3",
    usbAdapterMatch: "Bluetooth",
    allowInterfaceSwitch: true
  }, "pipe", 4242);
  const adapterInner = Buffer.from(
    withAdapterMatch.match(/'([A-Za-z0-9+/=]+)'\) -Verb RunAs/)?.[1],
    "base64"
  ).toString("utf16le");
  // The adapter needle lets the helper re-resolve the USB address after an
  // unplug/replug and restart the capture on its own.
  assert.match(adapterInner, /-AdapterMatch 'Bluetooth'/);
  assert.match(adapterInner, /-AllowInterfaceSwitch/);

  const noOwner = buildElevatedUsbPcapCommand({
    pipeHelperPath: "helper.ps1",
    usbPcapPath: "USBPcapCMD.exe",
    interfaceName: String.raw`\\.\USBPcap1`,
    deviceAddress: "3"
  }, "pipe");
  const noOwnerInner = Buffer.from(
    noOwner.match(/'([A-Za-z0-9+/=]+)'\) -Verb RunAs/)?.[1],
    "base64"
  ).toString("utf16le");
  assert.ok(!noOwnerInner.includes("-OwnerPid"));
  assert.ok(!noOwnerInner.includes("-HidDeviceMatch"));
  assert.ok(!noOwnerInner.includes("-AdapterMatch"));
});

test("notification and mSBC packet parsers reject malformed input", () => {
  assert.equal(parseUsbPcapNotificationLine("not-a-packet"), null);
  assert.equal(parseMsbcHidPacket(Buffer.alloc(59)), null);
  assert.equal(parseMsbcHidPacket(Buffer.alloc(60)), null);

  const notification = parseUsbPcapNotificationLine(CONTROL_START);
  assert.equal(notification.handle, "0x0025");
  assert.equal(notification.value.length, 20);
});

test("parser surfaces unparsable button reports and unknown handles for key discovery", () => {
  const parser = new XiaomiRemoteProtocolParser();

  // Standard button report with an unmapped code still yields button: "unknown".
  const known = parser.pushLine(`0x0017|0000ab0000000000`);
  assert.deepEqual(known, [{ type: "button", code: 0xab, button: "unknown", pressed: true }]);

  // Non-standard packet on the button handle (e.g. a consumer-control report
  // from the power key) must surface instead of being dropped.
  const odd = parser.pushLine(`0x0017|0130`);
  assert.deepEqual(odd, [{ type: "unknown_report", handle: "0x0017", valueHex: "0130" }]);

  // Notifications on any other handle surface too (battery, consumer control…).
  const other = parser.pushLine(`0x001b|020064`);
  assert.deepEqual(other, [{ type: "unknown_handle", handle: "0x001b", valueHex: "020064" }]);
});

test("physical power key HID code is emitted as a normal mappable button", () => {
  const parser = new XiaomiRemoteProtocolParser();
  assert.deepEqual(
    parser.pushLine("0x0017|0000660000000000"),
    [{ type: "button", code: 0x66, button: "power", pressed: true }]
  );
  assert.deepEqual(
    parser.pushLine("0x0017|0000000000000000"),
    [{ type: "button", code: 0x66, button: "power", pressed: false }]
  );
});

test("physical application/menu HID code is emitted as the configurable menu button", () => {
  const parser = new XiaomiRemoteProtocolParser();
  assert.deepEqual(
    parser.pushLine("0x0017|0000650000000000"),
    [{ type: "button", code: 0x65, button: "menu", pressed: true }]
  );
  assert.deepEqual(
    parser.pushLine("0x0017|0000000000000000"),
    [{ type: "button", code: 0x65, button: "menu", pressed: false }]
  );
});

test("alternate-handle remote emits buttons and preserves simultaneous HID usages", () => {
  const parser = new XiaomiRemoteProtocolParser();
  assert.deepEqual(
    parser.pushLine("0x0027|0000284f00000000"),
    [
      { type: "button", code: 0x28, button: "ok", pressed: true },
      { type: "button", code: 0x4f, button: "right", pressed: true }
    ]
  );
  assert.deepEqual(
    parser.pushLine("0x0027|00004f0000000000"),
    [{ type: "button", code: 0x28, button: "ok", pressed: false }]
  );
  assert.deepEqual(
    parser.pushLine("0x0027|0000000000000000"),
    [{ type: "button", code: 0x4f, button: "right", pressed: false }]
  );

  assert.deepEqual(
    parser.pushLine("0x0027|0000650000000000"),
    [{ type: "button", code: 0x65, button: "menu", pressed: true }]
  );
  assert.deepEqual(
    parser.pushLine("0x0027|0000000000000000"),
    [{ type: "button", code: 0x65, button: "menu", pressed: false }]
  );
});

test("Xiaomi remote parser emits one complete zero-loss voice session", () => {
  const parser = new XiaomiRemoteProtocolParser();
  assert.deepEqual(parser.pushLine(CONTROL_START), [{ type: "start", reason: "control" }]);

  const sequences = [0x38, 0xc8, 0xf8, 0x08, 0x38];
  const frames = sequences.flatMap((sequence, index) =>
    parser.pushLine(audioLine(["0x0029", "0x002d", "0x0031"][index % 3], sequence, 0x40 + index))
  );
  assert.equal(frames.length, 5);
  assert.ok(frames.every((event) => event.type === "audio" && event.frame.length === 57));
  assert.equal(frames.at(-1).sequenceErrors, 0);

  assert.deepEqual(parser.pushLine(CONTROL_STOP), [{
    type: "stop",
    reason: "control",
    frameCount: 5,
    sequenceErrors: 0
  }]);
});

test("alternate-handle remote emits one complete voice session", () => {
  const parser = new XiaomiRemoteProtocolParser();
  assert.deepEqual(parser.pushLine(ALTERNATE_CONTROL_START), [{ type: "start", reason: "control" }]);

  const sequences = [0x08, 0x38, 0xc8, 0xf8];
  const frames = sequences.flatMap((sequence, index) =>
    parser.pushLine(audioLine(["0x0039", "0x003d", "0x0041"][index % 3], sequence, 0x50 + index))
  );
  assert.equal(frames.length, 4);
  assert.ok(frames.every((event) => event.type === "audio" && event.frame.length === 57));
  assert.equal(frames.at(-1).sequenceErrors, 0);

  assert.deepEqual(parser.pushLine(ALTERNATE_CONTROL_STOP), [{
    type: "stop",
    reason: "control",
    frameCount: 4,
    sequenceErrors: 0
  }]);
});

test("Xiaomi remote parser can recover a session from audio and count sequence gaps", () => {
  const parser = new XiaomiRemoteProtocolParser();
  const first = parser.pushLine(audioLine("0x0029", 0x08));
  assert.equal(first[0].type, "start");
  assert.equal(first[0].reason, "audio");
  assert.equal(first[1].type, "audio");

  const second = parser.pushLine(audioLine("0x002d", 0xf8));
  assert.equal(second[0].sequenceErrors, 1);
  assert.deepEqual(parser.stop("inactivity"), [{
    type: "stop",
    reason: "inactivity",
    frameCount: 2,
    sequenceErrors: 1
  }]);
});
