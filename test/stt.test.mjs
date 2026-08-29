import test from "node:test";
import assert from "node:assert/strict";

import { STT_ERROR_CODES, transcribePcm16Mono } from "../src/stt.mjs";

const PCM = Buffer.from([0x01, 0x00, 0x02, 0x00]);

function mockConfig(overrides = {}) {
  return {
    mockTranscript: "测试识别结果",
    mockTranscriptDelayMs: 0,
    saveDebugWav: false,
    sttTimeoutMs: 15_000,
    ...overrides
  };
}

test("STT hard timeout aborts a recognition request", async () => {
  await assert.rejects(
    transcribePcm16Mono({
      pcmBuffer: PCM,
      config: mockConfig({ mockTranscriptDelayMs: 1_000, sttTimeoutMs: 40 })
    }),
    (error) => error?.code === STT_ERROR_CODES.TIMEOUT
  );
});

test("STT accepts a caller cancellation signal", async () => {
  const controller = new AbortController();
  const request = transcribePcm16Mono({
    pcmBuffer: PCM,
    config: mockConfig({ mockTranscriptDelayMs: 1_000 }),
    signal: controller.signal
  });
  controller.abort();
  await assert.rejects(request, (error) => error?.code === STT_ERROR_CODES.CANCELLED);
});

test("Volcengine fetch receives the hard-timeout abort signal", async (t) => {
  const originalFetch = globalThis.fetch;
  let observedAbort = false;
  globalThis.fetch = (_url, options = {}) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => {
      observedAbort = true;
      reject(options.signal.reason || new Error("aborted"));
    }, { once: true });
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await assert.rejects(
    transcribePcm16Mono({
      pcmBuffer: PCM,
      config: {
        sttProvider: "volcengine",
        sttTimeoutMs: 40,
        saveDebugWav: false,
        mockTranscript: "",
        volcengineAppKey: "app-key",
        volcengineAccessKey: "access-key",
        volcengineResourceId: "volc.bigasr.auc_turbo",
        volcengineLanguage: "zh-CN"
      }
    }),
    (error) => error?.code === STT_ERROR_CODES.TIMEOUT
  );
  assert.equal(observedAbort, true);
});
