import assert from "node:assert/strict";
import test from "node:test";

import { createVoiceTranslationService } from "../src/translation-service.mjs";

test("VoiceTranslationService sends Chinese transcript to DeepSeek-compatible chat completions", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.deepseek.com/chat/completions");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, "Bearer test-key");
    const body = JSON.parse(options.body);
    assert.equal(body.model, "deepseek-chat");
    assert.equal(body.messages[0].role, "system");
    assert.match(body.messages[0].content, /idiomatic English/);
    assert.deepEqual(body.messages[1], {
      role: "user",
      content: "帮我把这个功能做得更稳一点"
    });

    return new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: "Make this feature more robust."
          }
        }
      ]
    }));
  };

  const service = createVoiceTranslationService({
    voiceTranslationEnabled: true,
    voiceTranslationApiKey: "test-key",
    voiceTranslationModel: "deepseek-chat",
    voiceTranslationBaseUrl: "https://api.deepseek.com",
    voiceTranslationTimeoutMs: 1000
  });

  assert.equal(
    await service.translate("帮我把这个功能做得更稳一点"),
    "Make this feature more robust."
  );
});

test("VoiceTranslationService is a no-op when disabled", async () => {
  const service = createVoiceTranslationService({
    voiceTranslationEnabled: false
  });

  assert.equal(await service.translate("你好"), "你好");
  assert.equal(service.label(), "off");
});
