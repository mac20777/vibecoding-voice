import test from "node:test";
import assert from "node:assert/strict";

import { createCliView, formatCodexEvent, pushLogLine, summarizeAssistantText } from "../src/cli-projector.mjs";

test("createCliView derives repo name from cwd", () => {
  const view = createCliView({ codexCwd: "D:/github/vibecoding-voice" });
  assert.equal(view.repoName, "vibecoding-voice");
  assert.equal(view.phase, "idle");
});

test("formatCodexEvent formats assistant messages", () => {
  const line = formatCodexEvent({
    type: "item.completed",
    item: {
      type: "agent_message",
      text: "Hello from Codex"
    }
  });
  assert.equal(line, "assistant: Hello from Codex");
});

test("pushLogLine keeps only the latest lines", () => {
  let lines = [];
  for (let index = 0; index < 10; index += 1) {
    lines = pushLogLine(lines, `line-${index}`);
  }
  assert.deepEqual(lines, [
    "line-2",
    "line-3",
    "line-4",
    "line-5",
    "line-6",
    "line-7",
    "line-8",
    "line-9"
  ]);
});

test("summarizeAssistantText collapses whitespace", () => {
  assert.equal(summarizeAssistantText("hello\n\nworld"), "hello world");
});
