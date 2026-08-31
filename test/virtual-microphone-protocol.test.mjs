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
  BufferedWechatVirtualMicrophoneSession,
  buildVirtualMicrophonePublisherArgs,
  classifyVirtualMicrophoneEndpoint,
  resolveVirtualMicrophonePublisherPath,
  resolveVirtualMicrophoneRouteStatePath,
  selectVirtualMicrophonePair
} from "../src/windows-virtual-microphone.mjs";

function createFakePublisher(events) {
  return {
    ensureReady: async () => events.push("ready"),
    prepare: async () => events.push("prepare"),
    start: async () => events.push("start"),
    write: async (pcm) => events.push(`pcm:${Buffer.from(pcm).toString("hex")}`),
    stop: async () => events.push("stop"),
    cancel: async () => events.push("cancel")
  };
}

test("virtual microphone protocol frames control and PCM messages", () => {
  const payload = Buffer.from([1, 2, 3, 4]);
  const frame = encodeVirtualMicrophoneMessage(VIRTUAL_MIC_MESSAGE.PCM16, payload);

  assert.equal(frame.length, VIRTUAL_MIC_HEADER_BYTES + payload.length);
  assert.equal(frame.readUInt32LE(0), VIRTUAL_MIC_MAGIC);
  assert.equal(frame.readUInt16LE(4), VIRTUAL_MIC_MESSAGE.PCM16);
  assert.equal(frame.readUInt16LE(6), 0);
  assert.equal(frame.readUInt32LE(8), payload.length);
  assert.deepEqual(frame.subarray(VIRTUAL_MIC_HEADER_BYTES), payload);

  const prepareFrame = encodeVirtualMicrophoneMessage(VIRTUAL_MIC_MESSAGE.PREPARE);
  assert.equal(prepareFrame.readUInt16LE(4), 6);
  assert.equal(prepareFrame.readUInt32LE(8), 0);
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

test("buffered WeChat playback prepares on press and waits for release before the shortcut", async () => {
  const events = [];
  const delays = [];
  const session = new BufferedWechatVirtualMicrophoneSession({
    publisher: createFakePublisher(events),
    keyReleaseSettleMs: 40,
    replayLeadMs: 10_000,
    sleep: async (ms) => delays.push(ms)
  });

  await session.start();
  await session.write(Buffer.from([1, 2, 3, 4]));
  assert.deepEqual(
    events,
    ["ready", "prepare"],
    "the route should be ready but the WeChat start toggle must wait for PTT release"
  );

  await session.stop();
  assert.deepEqual(delays, [40]);
  assert.deepEqual(events, ["ready", "prepare", "start", "pcm:01020304", "stop"]);
});

test("buffered WeChat playback is cancelled without starting recognition", async () => {
  const events = [];
  const session = new BufferedWechatVirtualMicrophoneSession({
    publisher: createFakePublisher(events),
    keyReleaseSettleMs: 0
  });

  await session.start();
  await session.write(Buffer.from([5, 6]));
  await session.cancel();

  assert.deepEqual(events, ["ready", "prepare", "cancel"]);
});

test("buffered WeChat playback does not finish until the native session is idle", async () => {
  const events = [];
  let releaseStop;
  const stopGate = new Promise((resolve) => {
    releaseStop = resolve;
  });
  const publisher = createFakePublisher(events);
  publisher.stop = async () => {
    events.push("stop-begin");
    await stopGate;
    events.push("stop-end");
  };
  const session = new BufferedWechatVirtualMicrophoneSession({
    publisher,
    keyReleaseSettleMs: 0,
    replayLeadMs: 10_000
  });

  await session.start();
  await session.write(Buffer.from([7, 8]));
  let finished = false;
  const stopping = session.stop().then(() => {
    finished = true;
  });
  for (let attempt = 0; attempt < 20 && !events.includes("stop-begin"); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.equal(finished, false);
  assert.deepEqual(events, ["ready", "prepare", "start", "pcm:0708", "stop-begin"]);

  releaseStop();
  await stopping;
  assert.equal(finished, true);
  assert.deepEqual(events.at(-1), "stop-end");
});
