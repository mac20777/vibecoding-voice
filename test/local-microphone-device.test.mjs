import test from "node:test";
import assert from "node:assert/strict";

import {
  isVirtualMicrophoneLabel,
  selectPreferredLocalMicrophone
} from "../src/local-microphone-device.mjs";

test("desktop F8 microphone selection rejects virtual cable capture endpoints", () => {
  assert.equal(isVirtualMicrophoneLabel("CABLE Output (VB-Audio Virtual Cable)"), true);
  assert.equal(isVirtualMicrophoneLabel("VibeCoding Remote Microphone"), true);
  assert.equal(isVirtualMicrophoneLabel("麦克风 (UAC Audio Device)"), false);
});

test("desktop F8 microphone selection prefers a physical USB microphone", () => {
  const selected = selectPreferredLocalMicrophone([
    { kind: "audioinput", deviceId: "default", label: "Default - CABLE Output (VB-Audio Virtual Cable)" },
    { kind: "audioinput", deviceId: "headset", label: "麦克风 (YUKUI-780)" },
    { kind: "audioinput", deviceId: "usb", label: "麦克风 (UAC Audio Device)" }
  ]);
  assert.equal(selected?.deviceId, "usb");
});

test("desktop F8 microphone selection falls back to another physical microphone", () => {
  const selected = selectPreferredLocalMicrophone([
    { kind: "audioinput", deviceId: "cable", label: "CABLE Output (VB-Audio Virtual Cable)" },
    { kind: "audioinput", deviceId: "headset", label: "Microphone (Bluetooth Headset)" }
  ]);
  assert.equal(selected?.deviceId, "headset");
});

test("desktop F8 microphone selection waits for labels instead of choosing an unknown device", () => {
  const selected = selectPreferredLocalMicrophone([
    { kind: "audioinput", deviceId: "unknown", label: "" },
    { kind: "audioinput", deviceId: "cable", label: "CABLE Output (VB-Audio Virtual Cable)" }
  ]);
  assert.equal(selected, null);
});
