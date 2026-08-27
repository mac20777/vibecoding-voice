import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PREVIEW_KEYS,
  DEFAULT_REMOTE_ACTIONS,
  REMOTE_BUTTONS,
  applyPromptTemplate,
  cloneDefaultRemoteActions,
  normalizeAction,
  parsePreviewKeys,
  parsePromptTemplates,
  parseRemoteActionMap,
  serializeAction,
  serializePreviewKeys,
  serializeRemoteActionMap
} from "../src/remote-buttons.mjs";

test("parseRemoteActionMap fills defaults for every button", () => {
  const map = parseRemoteActionMap("");
  for (const button of REMOTE_BUTTONS) {
    assert.deepEqual(map[button], { ...DEFAULT_REMOTE_ACTIONS[button] });
  }
  assert.equal(map.ok.click.key, "enter");
  assert.equal(map.ok.double, undefined);
});

test("power button is a regular mapping that defaults to click-to-shutdown", () => {
  const map = parseRemoteActionMap("");
  assert.deepEqual(map.power.click, { type: "system", command: "shutdown" });
  assert.equal(map.power.hold, undefined);
});

test("menu defaults to disabled so Windows native HID is not injected twice", () => {
  const map = parseRemoteActionMap("");
  assert.deepEqual(map.menu.click, { type: "none" });
  assert.equal(map.menu.double, undefined);
});

test("system action validates against SYSTEM_COMMANDS", () => {
  assert.equal(normalizeAction({ type: "system", command: "wipe" }), null);
  assert.equal(serializeAction({ type: "system", command: "wipe" }), "");
  // An invalid spec in the override string keeps the default in place.
  const map = parseRemoteActionMap("power.click=system:wipe");
  assert.deepEqual(map.power.click, DEFAULT_REMOTE_ACTIONS.power.click);
  // Valid override wins.
  const locked = parseRemoteActionMap("power.click=system:lock");
  assert.deepEqual(locked.power.click, { type: "system", command: "lock" });
});

test("new gesture format overrides a single gesture only", () => {
  const map = parseRemoteActionMap("ok.double=app:chrome, back.hold=none");
  assert.deepEqual(map.ok.double, { type: "app", command: "chrome" });
  assert.deepEqual(map.ok.click, { type: "key", key: "enter" }, "click default must survive");
  assert.deepEqual(map.back.hold, { type: "none" });
});

test("legacy format still maps to the click gesture", () => {
  const map = parseRemoteActionMap("ok:escape, menu:none");
  assert.deepEqual(map.ok.click, { type: "key", key: "escape" });
  assert.deepEqual(map.menu.click, { type: "none" });
});

test("payloads with commas and colons survive percent-encoding", () => {
  const map = parseRemoteActionMap(`home.click=text:${encodeURIComponent("a,b:c")}`);
  assert.deepEqual(map.home.click, { type: "text", text: "a,b:c" });
});

test("unknown buttons and gestures throw", () => {
  assert.throws(() => parseRemoteActionMap("nope.click=key:enter"), /Unknown Xiaomi remote button/);
  assert.throws(() => parseRemoteActionMap("ok.triple=key:enter"), /Unknown Xiaomi remote gesture/);
  assert.throws(() => parseRemoteActionMap("nope:enter"), /Unknown Xiaomi remote button/);
});

test("serializeAction / parse round-trip for every action type", () => {
  const actions = [
    { type: "none" },
    { type: "key", key: "enter" },
    { type: "combo", combo: "ctrl+shift+p" },
    { type: "app", command: "C:\\Tools\\app.exe --flag" },
    { type: "text", text: "你好, world: 1" },
    { type: "prompt", name: "优化" },
    { type: "system", command: "restart" }
  ];
  for (const action of actions) {
    const spec = serializeAction(action);
    const map = parseRemoteActionMap(`ok.hold=${spec}`);
    assert.deepEqual(map.ok.hold, normalizeAction(action), `round-trip failed for ${spec}`);
  }
  assert.equal(serializeAction({ type: "key", key: "" }), "");
  assert.equal(serializeAction(null), "");
});

test("serializeRemoteActionMap only emits non-default entries", () => {
  const map = cloneDefaultRemoteActions();
  assert.equal(serializeRemoteActionMap(map), "");

  map.ok.double = { type: "app", command: "chrome" };
  map.back.click = { type: "none" };
  map.power.click = { type: "key", key: "escape" };
  const serialized = serializeRemoteActionMap(map);
  assert.ok(serialized.includes("ok.double=app:chrome"));
  assert.ok(serialized.includes("back.click=none"));
  assert.ok(serialized.includes("power.click=key:escape"));
  assert.ok(!serialized.includes("up.click"), "defaults must not be serialized");

  const reparsed = parseRemoteActionMap(serialized);
  assert.deepEqual(reparsed.ok.double, { type: "app", command: "chrome" });
  assert.deepEqual(reparsed.back.click, { type: "none" });
  assert.deepEqual(reparsed.power.click, { type: "key", key: "escape" });
  assert.deepEqual(reparsed.up.click, { type: "key", key: "up" });
});

test("parsePreviewKeys defaults, overrides and junk tolerance", () => {
  assert.deepEqual(parsePreviewKeys(""), {
    confirm: { button: "ok", gesture: "click" },
    undo: { button: "back", gesture: "click" },
    discard: { button: "back", gesture: "double" }
  });

  const overridden = parsePreviewKeys("confirm:home.hold, junk, undo:nope.click, discard:menu.double");
  assert.deepEqual(overridden.confirm, { button: "home", gesture: "hold" });
  assert.deepEqual(overridden.undo, DEFAULT_PREVIEW_KEYS.undo, "unknown button falls back to default");
  assert.deepEqual(overridden.discard, { button: "menu", gesture: "double" });
});

test("serializePreviewKeys only emits non-default bindings", () => {
  assert.equal(serializePreviewKeys(parsePreviewKeys("")), "");
  assert.equal(
    serializePreviewKeys(parsePreviewKeys("discard:menu.double")),
    "discard:menu.double"
  );
});

test("parsePromptTemplates tolerates junk and filters empty entries", () => {
  assert.deepEqual(parsePromptTemplates(""), []);
  assert.deepEqual(parsePromptTemplates("not json"), []);
  assert.deepEqual(parsePromptTemplates("{}"), []);
  assert.deepEqual(
    parsePromptTemplates(JSON.stringify([
      { name: "优化", body: "优化：{text}" },
      { name: "", body: "no name" },
      { name: "空body", body: "  " },
      { body: "no name either" }
    ])),
    [{ name: "优化", body: "优化：{text}" }]
  );
});

test("applyPromptTemplate replaces {text} or appends", () => {
  assert.equal(applyPromptTemplate("优化：{text}。", "你好"), "优化：你好。");
  assert.equal(applyPromptTemplate("没有占位符", "你好"), "没有占位符\n你好");
  assert.equal(applyPromptTemplate("{text}{text}", "哈"), "哈哈");
});
