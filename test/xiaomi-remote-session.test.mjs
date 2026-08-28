import test from "node:test";
import assert from "node:assert/strict";

import { XiaomiRemoteSessionController } from "../src/xiaomi-remote-session.mjs";

const CONTROL_START = `0x0025|${"01" + "00".repeat(19)}`;
const CONTROL_STOP = `0x0025|${"00".repeat(20)}`;
const ALTERNATE_CONTROL_START = `0x0035|${"01" + "00".repeat(19)}`;
const ALTERNATE_CONTROL_STOP = `0x0035|${"00".repeat(20)}`;

function audioLine(sequence, handle = "0x0029") {
  const packet = Buffer.alloc(60, 0x55);
  packet[0] = 0x01;
  packet[1] = sequence;
  packet[2] = 0xad;
  packet[59] = 0x00;
  return `${handle}|${packet.toString("hex")}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createController(overrides = {}) {
  const sent = [];
  const audio = [];
  const logs = [];
  const decoded = [];
  const controller = new XiaomiRemoteSessionController({
    inactivityMs: overrides.inactivityMs ?? 250,
    sendJson: (message) => sent.push(message),
    sendAudio: (pcm) => audio.push(pcm),
    decodeFrames: overrides.decodeFrames || (async (frames) => {
      decoded.push(frames);
      return Buffer.from([1, 2, 3, 4]);
    }),
    log: (message, details) => logs.push(details ? `${message} ${JSON.stringify(details)}` : message)
  });
  return { controller, sent, audio, logs, decoded };
}

function sentTypes(sent) {
  return sent.map((message) => message.type);
}

test("key press without audio is cancelled by inactivity and the next press recovers", async (t) => {
  const { controller, sent, logs } = createController();
  t.after(() => controller.dispose());

  controller.pushLine(CONTROL_START);
  assert.deepEqual(sentTypes(sent), ["ptt_start"]);

  await sleep(400);
  assert.deepEqual(sentTypes(sent), ["ptt_start", "ptt_cancel"]);
  assert.ok(logs.some((entry) => entry.includes("no audio frames")));

  controller.pushLine(CONTROL_START);
  assert.deepEqual(sentTypes(sent), ["ptt_start", "ptt_cancel", "ptt_start"]);
});

test("capture reset cancels a partial session and clears protocol state", async (t) => {
  const { controller, sent } = createController();
  t.after(() => controller.dispose());

  controller.pushLine(CONTROL_START);
  controller.pushLine(audioLine(0x08));
  controller.reset("adapter-missing");
  assert.deepEqual(sentTypes(sent), ["ptt_start", "ptt_cancel"]);

  controller.pushLine(CONTROL_START);
  controller.pushLine(audioLine(0x38));
  controller.pushLine(CONTROL_STOP);
  await sleep(50);
  assert.deepEqual(sentTypes(sent), ["ptt_start", "ptt_cancel", "ptt_start", "ptt_stop"]);
});

test("capture reset drops decoding output from the previous generation", async (t) => {
  let releaseDecode;
  const decodeGate = new Promise((resolve) => {
    releaseDecode = resolve;
  });
  const { controller, sent, audio } = createController({
    decodeFrames: async () => {
      await decodeGate;
      return Buffer.from([1, 2, 3, 4]);
    }
  });
  t.after(() => {
    releaseDecode();
    controller.dispose();
  });

  controller.pushLine(CONTROL_START);
  controller.pushLine(audioLine(0x08));
  controller.pushLine(CONTROL_STOP);
  await sleep(25);
  controller.reset("adapter-missing");
  releaseDecode();
  await sleep(25);

  assert.deepEqual(sentTypes(sent), ["ptt_start", "ptt_cancel"]);
  assert.equal(audio.length, 0);
});

test("complete session decodes frames and sends audio before ptt_stop", async (t) => {
  const { controller, sent, audio, decoded } = createController();
  t.after(() => controller.dispose());

  controller.pushLine(CONTROL_START);
  controller.pushLine(audioLine(0x38));
  controller.pushLine(audioLine(0xc8, "0x002d"));
  controller.pushLine(CONTROL_STOP);
  await sleep(50);

  assert.deepEqual(sentTypes(sent), ["ptt_start", "ptt_stop"]);
  assert.equal(decoded.length, 1);
  assert.equal(decoded[0].length, 2);
  assert.equal(audio.length, 1);
  assert.deepEqual([...audio[0]], [1, 2, 3, 4]);
});

test("streaming mode decodes and publishes each frame before key release", async (t) => {
  const sent = [];
  const events = [];
  const controller = new XiaomiRemoteSessionController({
    inactivityMs: 250,
    sendJson: (message) => sent.push(message),
    streamAudio: {
      start: async () => events.push("start"),
      decodeFrame: async (frame) => Buffer.from([frame[0], frame[1]]),
      write: async (pcm) => events.push(`pcm:${pcm.toString("hex")}`),
      stop: async () => events.push("stop"),
      cancel: async (reason) => events.push(`cancel:${reason}`)
    },
    log: () => {}
  });
  t.after(() => controller.dispose());

  controller.pushLine(CONTROL_START);
  await sleep(10);
  controller.pushLine(audioLine(0x38));
  await sleep(10);
  assert.deepEqual(events, ["start", "pcm:ad55"]);
  assert.deepEqual(sentTypes(sent), ["ptt_start"]);

  controller.pushLine(CONTROL_STOP);
  await sleep(25);
  assert.deepEqual(events, ["start", "pcm:ad55", "stop"]);
  assert.deepEqual(sentTypes(sent), ["ptt_start", "ptt_stop"]);
});

test("streaming mode cancels a key press that produced no audio", async (t) => {
  const sent = [];
  const events = [];
  const controller = new XiaomiRemoteSessionController({
    inactivityMs: 250,
    sendJson: (message) => sent.push(message),
    streamAudio: {
      start: async () => events.push("start"),
      decodeFrame: async () => Buffer.alloc(0),
      write: async () => {},
      stop: async () => events.push("stop"),
      cancel: async (reason) => events.push(`cancel:${reason}`)
    },
    log: () => {}
  });
  t.after(() => controller.dispose());

  controller.pushLine(CONTROL_START);
  await sleep(350);
  assert.deepEqual(events, ["start", "cancel:no_audio"]);
  assert.deepEqual(sentTypes(sent), ["ptt_start", "ptt_cancel"]);
});

test("streaming stop waits for a slow publisher start so control messages stay ordered", async (t) => {
  let releaseStart;
  const startGate = new Promise((resolve) => {
    releaseStart = resolve;
  });
  const events = [];
  const controller = new XiaomiRemoteSessionController({
    inactivityMs: 250,
    sendJson: () => {},
    streamAudio: {
      start: async () => {
        await startGate;
        events.push("start");
      },
      decodeFrame: async () => Buffer.from([1, 2]),
      write: async () => events.push("pcm"),
      stop: async () => events.push("stop"),
      cancel: async () => events.push("cancel")
    },
    log: () => {}
  });
  t.after(() => {
    releaseStart();
    controller.dispose();
  });

  controller.pushLine(CONTROL_START);
  controller.pushLine(audioLine(0x38));
  controller.pushLine(CONTROL_STOP);
  await sleep(20);
  assert.deepEqual(events, []);

  releaseStart();
  await sleep(40);
  assert.deepEqual(events, ["start", "pcm", "stop"]);
});

test("capture reset finishes the old stream cancellation before a new stream starts", async (t) => {
  let releaseCancel;
  const cancelGate = new Promise((resolve) => {
    releaseCancel = resolve;
  });
  const events = [];
  let starts = 0;
  const controller = new XiaomiRemoteSessionController({
    inactivityMs: 250,
    sendJson: () => {},
    streamAudio: {
      start: async () => events.push(`start:${++starts}`),
      decodeFrame: async () => Buffer.from([1, 2]),
      write: async () => {},
      stop: async () => {},
      cancel: async (reason) => {
        events.push(`cancel-begin:${reason}`);
        await cancelGate;
        events.push(`cancel-end:${reason}`);
      }
    },
    log: () => {}
  });
  t.after(async () => {
    releaseCancel();
    await controller.dispose();
  });

  controller.pushLine(CONTROL_START);
  await sleep(15);
  controller.reset("adapter_replug");
  controller.pushLine(CONTROL_START);
  await sleep(15);
  assert.deepEqual(events, ["start:1", "cancel-begin:adapter_replug"]);

  releaseCancel();
  await sleep(25);
  assert.deepEqual(events, [
    "start:1",
    "cancel-begin:adapter_replug",
    "cancel-end:adapter_replug",
    "start:2"
  ]);
});

test("alternate-handle remote starts the overlay path and sends decoded audio", async (t) => {
  const { controller, sent, audio, decoded } = createController();
  t.after(() => controller.dispose());

  controller.pushLine(ALTERNATE_CONTROL_START);
  controller.pushLine(audioLine(0x08, "0x0039"));
  controller.pushLine(audioLine(0x38, "0x003d"));
  controller.pushLine(audioLine(0xc8, "0x0041"));
  controller.pushLine(ALTERNATE_CONTROL_STOP);
  await sleep(50);

  assert.deepEqual(sentTypes(sent), ["ptt_start", "ptt_stop"]);
  assert.equal(decoded[0].length, 3);
  assert.equal(audio.length, 1);
});

test("decode failure cancels the session instead of sending audio", async (t) => {
  const { controller, sent, audio, logs } = createController({
    decodeFrames: async () => {
      throw new Error("decoder exploded");
    }
  });
  t.after(() => controller.dispose());

  controller.pushLine(CONTROL_START);
  controller.pushLine(audioLine(0x38));
  controller.pushLine(CONTROL_STOP);
  await sleep(50);

  assert.deepEqual(sentTypes(sent), ["ptt_start", "ptt_cancel"]);
  assert.equal(audio.length, 0);
  assert.ok(logs.some((entry) => entry.includes("decode failed")));
});

test("missing stop report is flushed by inactivity with the captured audio", async (t) => {
  const { controller, sent, audio, decoded } = createController();
  t.after(() => controller.dispose());

  controller.pushLine(CONTROL_START);
  controller.pushLine(audioLine(0x08));
  controller.pushLine(audioLine(0x38, "0x0031"));
  await sleep(400);

  assert.deepEqual(sentTypes(sent), ["ptt_start", "ptt_stop"]);
  assert.equal(decoded.length, 1);
  assert.equal(decoded[0].length, 2);
  assert.equal(audio.length, 1);
});

test("key press during decoding is ignored without latching the parser", async (t) => {
  let releaseDecode;
  const decodeGate = new Promise((resolve) => {
    releaseDecode = resolve;
  });
  const { controller, sent, logs } = createController({
    decodeFrames: async (frames) => {
      await decodeGate;
      return Buffer.concat(frames);
    }
  });
  t.after(() => {
    releaseDecode();
    controller.dispose();
  });

  controller.pushLine(CONTROL_START);
  controller.pushLine(audioLine(0x08));
  controller.pushLine(CONTROL_STOP);
  await sleep(50);

  // While the first session is decoding, further presses and stray frames
  // are dropped and must not wedge the parser.
  controller.pushLine(CONTROL_START);
  controller.pushLine(audioLine(0x38));
  assert.deepEqual(sentTypes(sent), ["ptt_start"]);
  assert.ok(logs.some((entry) => entry.includes("ignored")));

  releaseDecode();
  await sleep(50);
  assert.deepEqual(sentTypes(sent), ["ptt_start", "ptt_stop"]);

  controller.pushLine(CONTROL_START);
  assert.deepEqual(sentTypes(sent), ["ptt_start", "ptt_stop", "ptt_start"]);
});
