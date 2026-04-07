import test from "node:test";
import assert from "node:assert/strict";

import { parseTodoVoiceCommand } from "../src/todo-service.mjs";

test("parseTodoVoiceCommand parses create/list/update/delete/toggle commands", () => {
  assert.deepEqual(parseTodoVoiceCommand("查看计划"), {
    ok: true,
    action: "list"
  });

  assert.deepEqual(parseTodoVoiceCommand("添加计划 买牛奶"), {
    ok: true,
    action: "create",
    text: "买牛奶"
  });

  assert.deepEqual(parseTodoVoiceCommand("添加一个计划 买牛奶"), {
    ok: true,
    action: "create",
    text: "买牛奶"
  });

  assert.deepEqual(parseTodoVoiceCommand("删除计划 2"), {
    ok: true,
    action: "delete",
    index: 2
  });

  assert.deepEqual(parseTodoVoiceCommand("修改计划 3 改成 发版本"), {
    ok: true,
    action: "update",
    index: 3,
    text: "发版本"
  });

  assert.deepEqual(parseTodoVoiceCommand("完成计划 4"), {
    ok: true,
    action: "toggle",
    index: 4,
    completed: true
  });

  assert.deepEqual(parseTodoVoiceCommand("取消完成计划 5"), {
    ok: true,
    action: "toggle",
    index: 5,
    completed: false
  });
});

test("parseTodoVoiceCommand returns guidance for incomplete or unknown commands", () => {
  assert.equal(parseTodoVoiceCommand("添加计划").ok, false);
  assert.match(parseTodoVoiceCommand("添加计划").message, /添加计划/);

  assert.equal(parseTodoVoiceCommand("帮我看一下今天的安排").ok, false);
  assert.match(parseTodoVoiceCommand("帮我看一下今天的安排").message, /查看计划/);
});
