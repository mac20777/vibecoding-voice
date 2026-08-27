import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRemoteBrokerCaptureRequest,
  parseRemoteBrokerResponse
} from "../src/windows-remote-broker-client.mjs";

test("remote broker capture request contains only the fixed capture contract", () => {
  assert.deepEqual(buildRemoteBrokerCaptureRequest({
    interfaceName: String.raw`\\.\USBPcap2`,
    deviceAddress: "7",
    hidDeviceMatch: "VID&012717_PID&32B8",
    usbAdapterMatch: "BARROT Bluetooth"
  }, "vibecoding-xiaomi-4242-1234-abcd", 4242), {
    version: 1,
    action: "start_capture",
    pipeName: "vibecoding-xiaomi-4242-1234-abcd",
    ownerPid: 4242,
    interfaceName: String.raw`\\.\USBPcap2`,
    deviceAddress: "7",
    hidDeviceMatch: "VID&012717_PID&32B8",
    adapterMatch: "BARROT Bluetooth",
    allowInterfaceSwitch: false
  });
});

test("remote broker allows automatic cross-interface recovery only when requested", () => {
  const request = buildRemoteBrokerCaptureRequest({
    interfaceName: String.raw`\\.\USBPcap1`,
    deviceAddress: "3",
    usbAdapterMatch: "Bluetooth",
    allowInterfaceSwitch: true
  }, "vibecoding-xiaomi-4242-1234-abcd", 4242);

  assert.equal(request.allowInterfaceSwitch, true);
});

test("remote broker response parser rejects malformed and failed responses", () => {
  assert.deepEqual(parseRemoteBrokerResponse('{"ok":true,"pid":123}'), {
    ok: true,
    pid: 123
  });
  assert.throws(() => parseRemoteBrokerResponse("not json"), /invalid response/);
  assert.throws(
    () => parseRemoteBrokerResponse('{"ok":false,"error":"denied"}'),
    /denied/
  );
});
