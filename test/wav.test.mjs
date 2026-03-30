import test from "node:test";
import assert from "node:assert/strict";

import { pcm16MonoToWav } from "../src/wav.mjs";

test("pcm16MonoToWav writes a valid RIFF/WAVE header", () => {
  const pcm = Buffer.alloc(320 * 2);
  const wav = pcm16MonoToWav(pcm, 16000);

  assert.equal(wav.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(wav.subarray(8, 12).toString("ascii"), "WAVE");
  assert.equal(wav.subarray(12, 16).toString("ascii"), "fmt ");
  assert.equal(wav.subarray(36, 40).toString("ascii"), "data");
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.length, 44 + pcm.length);
});
