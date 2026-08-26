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
  assert.equal(findUsbDeviceAddress(tree, "Xiaomi voice remote"), "3");
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
  }, "vibecoding-test-pipe");
  assert.match(command, /Start-Process/);
  assert.match(command, /-Verb RunAs/);
  assert.match(command, /-WindowStyle Hidden/);
  const encodedInner = command.match(/'([A-Za-z0-9+/=]+)'\) -Verb RunAs/)?.[1];
  assert.ok(encodedInner);
  const inner = Buffer.from(encodedInner, "base64").toString("utf16le");
  assert.match(inner, /xiaomi|helper\.ps1/);
  assert.match(inner, /vibecoding-test-pipe/);
  assert.match(inner, /\\\\\.\\USBPcap1/);
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
