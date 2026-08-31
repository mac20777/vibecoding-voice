import test from "node:test";
import assert from "node:assert/strict";

import { createTodoAssistant } from "../src/todo-assistant.mjs";

test("TodoAssistant asks for missing create title and uses follow-up as title", async () => {
  const assistant = createTodoAssistant({ todoIntentProvider: "rules" });

  const first = await assistant.interpret("添加计划");
  assert.equal(first.ok, true);
  assert.equal(first.action, "ask");
  assert.match(first.message, /计划内容/);
  assert.deepEqual(first.pendingIntent, { action: "create", missing: "text" });

  const second = await assistant.interpret("买牛奶", { pendingIntent: first.pendingIntent });
  assert.deepEqual(second.command, {
    action: "create",
    index: undefined,
    text: "买牛奶",
    completed: undefined
  });
  assert.equal(second.pendingIntent, null);
});

test("TodoAssistant asks for missing update title after index follow-up", async () => {
  const assistant = createTodoAssistant({ todoIntentProvider: "rules" });

  const first = await assistant.interpret("修改计划");
  assert.deepEqual(first.pendingIntent, { action: "update", missing: "index" });

  const second = await assistant.interpret("第二个", { pendingIntent: first.pendingIntent });
  assert.deepEqual(second.pendingIntent, { action: "update", missing: "text", index: 2 });
  assert.match(second.message, /新的计划内容/);

  const third = await assistant.interpret("发版本", { pendingIntent: second.pendingIntent });
  assert.deepEqual(third.command, {
    action: "update",
    index: 2,
    text: "发版本",
    completed: undefined
  });
});

test("TodoAssistant uses DeepSeek fallback for natural create phrasing", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.deepseek.com/chat/completions");
    assert.equal(options.method, "POST");
    const body = JSON.parse(options.body);
    assert.equal(body.model, "deepseek-v4-flash");
    assert.match(body.messages[1].content, /帮我记一下明天买牛奶/);
    return new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              type: "command",
              action: "create",
              text: "明天买牛奶"
            })
          }
        }
      ]
    }));
  };

  const assistant = createTodoAssistant({
    todoIntentProvider: "deepseek",
    todoIntentApiKey: "test-key",
    todoIntentModel: "deepseek-v4-flash",
    todoIntentBaseUrl: "https://api.deepseek.com",
    todoIntentTimeoutMs: 1000
  });

  const result = await assistant.interpret("帮我记一下明天买牛奶");
  assert.deepEqual(result.command, {
    action: "create",
    text: "明天买牛奶"
  });
  assert.equal(result.source, "deepseek");
});

test("TodoAssistant accepts DeepSeek clear commands", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [
      {
        message: {
          content: JSON.stringify({
            type: "command",
            action: "clear"
          })
        }
      }
    ]
  }));

  const assistant = createTodoAssistant({
    todoIntentProvider: "deepseek",
    todoIntentApiKey: "test-key"
  });

  const result = await assistant.interpret("把所有待办都删掉");
  assert.deepEqual(result.command, { action: "clear" });
  assert.equal(result.source, "deepseek");
});
