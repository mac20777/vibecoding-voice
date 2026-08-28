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
import { resolveVirtualMicrophonePublisherPath } from "../src/windows-virtual-microphone.mjs";

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

