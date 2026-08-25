import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  decodeMsbcFrame,
  decodeMsbcFrames,
  MsbcDecoder,
  MSBC_FRAME_LENGTH,
  MSBC_SAMPLES_PER_FRAME
} from "../src/msbc-decoder.mjs";

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const FRAMES_PATH = path.join(FIXTURE_DIR, "xiaomi-voice-frames.bin");
const REFERENCE_PCM_PATH = path.join(FIXTURE_DIR, "xiaomi-voice-ref.raw");

function readSamplesLE(buffer) {
  const samples = new Int16Array(buffer.length / 2);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = buffer.readInt16LE(i * 2);
  }
  return samples;
}

// Pearson correlation between two equal-length sample arrays.
function correlation(a, b) {
  assert.equal(a.length, b.length);
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < a.length; i++) {
    sumA += a[i];
    sumB += b[i];
  }
  const meanA = sumA / a.length;
  const meanB = sumB / b.length;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < a.length; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    sxy += da * db;
    sxx += da * da;
    syy += db * db;
  }
  return sxy / Math.sqrt(sxx * syy);
}

test("decodes the fixture stream matching the ffmpeg reference", () => {
  const frames = fs.readFileSync(FRAMES_PATH);
  const reference = fs.readFileSync(REFERENCE_PCM_PATH);

  const pcm = decodeMsbcFrames(frames);

  // 909 frames * 120 samples * 2 bytes.
  assert.equal(pcm.length, reference.length);

  const actual = readSamplesLE(pcm);
  const expected = readSamplesLE(reference);

  // This decoder uses float64 arithmetic while ffmpeg's sbc decoder uses
  // fixed-point arithmetic with quantized filter constants, so the outputs
  // are not bit-exact. Measured on this fixture: max |diff| = 3 LSB
  // (55342/109080 samples identical, diff RMS 0.76 vs signal RMS ~1973).
  // The threshold below keeps 1 LSB of headroom over the measured value.
  let maxAbsDiff = 0;
  for (let i = 0; i < actual.length; i++) {
    maxAbsDiff = Math.max(maxAbsDiff, Math.abs(actual[i] - expected[i]));
  }
  assert.ok(maxAbsDiff <= 4, `max abs diff ${maxAbsDiff} exceeds 4 LSB`);

  // Measured correlation on this fixture: 0.99999993.
  const corr = correlation(actual, expected);
  assert.ok(corr >= 0.9999, `correlation ${corr} below 0.9999`);
});

test("decodeMsbcFrame decodes a single 57-byte frame to 120 samples", () => {
  const frames = fs.readFileSync(FRAMES_PATH);
  const samples = decodeMsbcFrame(frames.subarray(0, MSBC_FRAME_LENGTH));

  assert.ok(samples instanceof Int16Array);
  assert.equal(samples.length, MSBC_SAMPLES_PER_FRAME);

  // A single standalone frame is decoded with a fresh filter history, so it
  // must match the first frame of a stream decode exactly.
  const streamPcm = decodeMsbcFrames(frames);
  const streamFirstFrame = readSamplesLE(streamPcm.subarray(0, MSBC_SAMPLES_PER_FRAME * 2));
  assert.deepEqual([...samples], [...streamFirstFrame]);
});

test("MsbcDecoder keeps synthesis history across frames", () => {
  const frames = fs.readFileSync(FRAMES_PATH);
  const decoder = new MsbcDecoder();
  const parts = [];
  for (let offset = 0; offset + MSBC_FRAME_LENGTH <= frames.length; offset += MSBC_FRAME_LENGTH) {
    parts.push(decoder.decodeFrame(frames.subarray(offset, offset + MSBC_FRAME_LENGTH)));
  }
  const streamed = Buffer.concat(parts.map((part) => Buffer.from(part.buffer, part.byteOffset, part.byteLength)));
  const oneShot = decodeMsbcFrames(frames);
  assert.ok(streamed.equals(oneShot), "per-frame streaming decode must equal decodeMsbcFrames");
});

test("decodeMsbcFrames ignores a trailing partial frame", () => {
  const frames = fs.readFileSync(FRAMES_PATH);
  const full = decodeMsbcFrames(frames);

  const withTail = Buffer.concat([frames, Buffer.from([0xad, 0x00, 0x00])]);
  const decoded = decodeMsbcFrames(withTail);
  assert.equal(decoded.length, full.length);
  assert.ok(decoded.equals(full));

  assert.equal(decodeMsbcFrames(Buffer.alloc(0)).length, 0);
  assert.equal(decodeMsbcFrames(Buffer.alloc(MSBC_FRAME_LENGTH - 1)).length, 0);
});

test("rejects frames with a bad syncword", () => {
  const frames = fs.readFileSync(FRAMES_PATH);
  const frame = Buffer.from(frames.subarray(0, MSBC_FRAME_LENGTH));
  frame[0] = 0x9c; // standard SBC syncword, not mSBC
  assert.throws(() => decodeMsbcFrame(frame), /syncword/);

  assert.throws(() => decodeMsbcFrames(Buffer.concat([frame])), /frame 0/);
});

test("rejects frames with bad reserved header bytes", () => {
  const frames = fs.readFileSync(FRAMES_PATH);
  const frame = Buffer.from(frames.subarray(0, MSBC_FRAME_LENGTH));
  frame[1] = 0x01;
  assert.throws(() => decodeMsbcFrame(frame), /reserved/);
});

test("rejects frames failing the CRC-8 check", () => {
  const frames = fs.readFileSync(FRAMES_PATH);
  // Corrupt a scale factor nibble; the CRC byte is left untouched.
  const corrupted = Buffer.from(frames.subarray(0, MSBC_FRAME_LENGTH));
  corrupted[4] ^= 0x10;
  assert.throws(() => decodeMsbcFrame(corrupted), /CRC/);

  // The CRC covers only the header and scale factors, so corrupted audio
  // payload bits still decode without an error.
  const audioCorrupted = Buffer.from(frames.subarray(0, MSBC_FRAME_LENGTH));
  audioCorrupted[10] ^= 0x01;
  assert.equal(decodeMsbcFrame(audioCorrupted).length, MSBC_SAMPLES_PER_FRAME);
});

test("rejects frames with the wrong length", () => {
  const frames = fs.readFileSync(FRAMES_PATH);
  assert.throws(() => decodeMsbcFrame(frames.subarray(0, MSBC_FRAME_LENGTH - 1)), /57 bytes/);
  assert.throws(() => decodeMsbcFrame(Buffer.alloc(0)), /57 bytes/);
});
