import test from "node:test";
import assert from "node:assert/strict";

import { XiaomiRemoteSessionController } from "../src/xiaomi-remote-session.mjs";

const CONTROL_START = `0x0025|${"01" + "00".repeat(19)}`;
const CONTROL_STOP = `0x0025|${"00".repeat(20)}`;

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
