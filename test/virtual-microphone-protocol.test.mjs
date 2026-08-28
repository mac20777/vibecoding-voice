import test from "node:test";
import assert from "node:assert/strict";

import {
  VIRTUAL_MIC_HEADER_BYTES,
  VIRTUAL_MIC_MAGIC,
  VIRTUAL_MIC_MESSAGE,
  XIAOMI_REMOTE_VOICE_MODES,
  encodeVirtualMicrophoneMessage,
  normalizeXiaomiRemoteVoiceMode
} from "../src/virtual-microphone-protocol.mjs";
import {
  buildVirtualMicrophonePublisherArgs,
  classifyVirtualMicrophoneEndpoint,
  resolveVirtualMicrophonePublisherPath,
  resolveVirtualMicrophoneRouteStatePath,
  selectVirtualMicrophonePair
} from "../src/windows-virtual-microphone.mjs";

test("virtual microphone protocol frames control and PCM messages", () => {
  const payload = Buffer.from([1, 2, 3, 4]);
  const frame = encodeVirtualMicrophoneMessage(VIRTUAL_MIC_MESSAGE.PCM16, payload);

  assert.equal(frame.length, VIRTUAL_MIC_HEADER_BYTES + payload.length);
  assert.equal(frame.readUInt32LE(0), VIRTUAL_MIC_MAGIC);
  assert.equal(frame.readUInt16LE(4), VIRTUAL_MIC_MESSAGE.PCM16);
  assert.equal(frame.readUInt16LE(6), 0);
  assert.equal(frame.readUInt32LE(8), payload.length);
  assert.deepEqual(frame.subarray(VIRTUAL_MIC_HEADER_BYTES), payload);
});

test("remote voice mode preserves the built-in path unless WeChat is explicit", () => {
  assert.equal(normalizeXiaomiRemoteVoiceMode("wechat"), XIAOMI_REMOTE_VOICE_MODES.WECHAT);
  assert.equal(normalizeXiaomiRemoteVoiceMode("WECHAT"), XIAOMI_REMOTE_VOICE_MODES.WECHAT);
  assert.equal(normalizeXiaomiRemoteVoiceMode(""), XIAOMI_REMOTE_VOICE_MODES.BUILTIN_STT);
  assert.equal(normalizeXiaomiRemoteVoiceMode("unknown"), XIAOMI_REMOTE_VOICE_MODES.BUILTIN_STT);
});

test("packaged publisher path resolves from the Electron resources directory", () => {
  const resolved = resolveVirtualMicrophonePublisherPath({ VIBE_RESOURCES_PATH: "D:\\App\\resources" });
  assert.equal(
    resolved,
    "D:\\App\\resources\\virtual-microphone\\vibecoding-virtual-mic-publisher.exe"
  );
});

test("WeChat publisher arguments include both VB-CABLE endpoints and crash recovery state", () => {
  assert.deepEqual(
    buildVirtualMicrophonePublisherArgs({
      renderEndpointName: "CABLE Input (VB-Audio Virtual Cable)",
      captureEndpointName: "CABLE Output (VB-Audio Virtual Cable)",
      routeStatePath: "D:\\State\\route.txt",
      wechatShortcut: true
    }),
    [
      "--endpoint",
      "CABLE Input (VB-Audio Virtual Cable)",
      "--wechat-shortcut",
      "--capture-endpoint",
      "CABLE Output (VB-Audio Virtual Cable)",
      "--route-state",
      "D:\\State\\route.txt"
    ]
  );
});

test("route recovery state defaults to the per-user application data directory", () => {
  assert.equal(
    resolveVirtualMicrophoneRouteStatePath({ LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local" }),
    "C:\\Users\\tester\\AppData\\Local\\VibeCoding Voice\\virtual-microphone-route-state.txt"
  );
});

test("VB-CABLE endpoints are recognized as the preferred signed audio bridge", () => {
  assert.equal(
    classifyVirtualMicrophoneEndpoint("render", "CABLE Input (VB-Audio Virtual Cable)"),
    "vb_cable"
  );
  assert.equal(
    classifyVirtualMicrophoneEndpoint("capture", "CABLE Output (VB-Audio Virtual Cable)"),
    "vb_cable"
  );
  assert.equal(classifyVirtualMicrophoneEndpoint("capture", "Microphone Array"), null);
});

test("endpoint selection keeps each render/capture pair on the same provider", () => {
  const pair = selectVirtualMicrophonePair([
    { flow: "render", name: "VibeCoding Remote Microphone Input" },
    { flow: "capture", name: "VibeCoding Remote Microphone" },
    { flow: "capture", name: "CABLE Output (VB-Audio Virtual Cable)" },
    { flow: "render", name: "CABLE Input (VB-Audio Virtual Cable)" }
  ]);
  assert.equal(pair.provider, "vb_cable");
  assert.equal(pair.renderEndpoint.name, "CABLE Input (VB-Audio Virtual Cable)");
  assert.equal(pair.captureEndpoint.name, "CABLE Output (VB-Audio Virtual Cable)");
});
