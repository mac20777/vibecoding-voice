import test from "node:test";
import assert from "node:assert/strict";

import { RemoteGestureEngine } from "../src/remote-gestures.mjs";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeEngine({ hasGestureAction = () => false, isRepeatButton = () => false, ...timing } = {}) {
  const events = [];
  const engine = new RemoteGestureEngine({
    onGesture: (button, gesture) => events.push(`${button}:${gesture}`),
    hasGestureAction,
    isRepeatButton,
    doubleMs: 60,
    holdMs: 80,
    repeatMs: 40,
    ...timing
  });
  return { engine, events };
}

test("click fires immediately on release when no double action is configured", async () => {
  const { engine, events } = makeEngine();
  engine.handleButtonEvent({ button: "ok", pressed: true });
  engine.handleButtonEvent({ button: "ok", pressed: false });
  assert.deepEqual(events, ["ok:click"]);
  engine.dispose();
});

test("click waits out the double window when a double action exists", async () => {
  const { engine, events } = makeEngine({
    hasGestureAction: (button, gesture) => button === "ok" && gesture === "double"
  });
  engine.handleButtonEvent({ button: "ok", pressed: true });
  engine.handleButtonEvent({ button: "ok", pressed: false });
  assert.deepEqual(events, [], "click must not fire before the window closes");
  await sleep(100);
  assert.deepEqual(events, ["ok:click"]);
  engine.dispose();
});

test("double click fires on the second press cycle", async () => {
  const { engine, events } = makeEngine({
    hasGestureAction: (button, gesture) => button === "ok" && gesture === "double"
  });
  for (let i = 0; i < 2; i += 1) {
    engine.handleButtonEvent({ button: "ok", pressed: true });
    await sleep(10);
    engine.handleButtonEvent({ button: "ok", pressed: false });
    await sleep(20);
  }
  assert.deepEqual(events, ["ok:double"]);
  engine.dispose();
});

test("hold fires at the threshold without waiting for release", async () => {
  const { engine, events } = makeEngine({
    hasGestureAction: (button, gesture) => button === "ok" && gesture === "hold"
  });
  engine.handleButtonEvent({ button: "ok", pressed: true });
  await sleep(120);
  assert.deepEqual(events, ["ok:hold"]);
  engine.handleButtonEvent({ button: "ok", pressed: false });
  await sleep(100);
  assert.deepEqual(events, ["ok:hold"], "release after hold must not emit click");
  engine.dispose();
});

test("repeat buttons nudge at the threshold then keep repeating until release", async () => {
  const { engine, events } = makeEngine({
    isRepeatButton: (button) => button === "volume_up"
  });
  engine.handleButtonEvent({ button: "volume_up", pressed: true });
  await sleep(210);
  engine.handleButtonEvent({ button: "volume_up", pressed: false });
  const repeats = events.filter((event) => event === "volume_up:repeat").length;
  assert.ok(repeats >= 2, `expected a repeat stream, got ${JSON.stringify(events)}`);
  assert.ok(!events.includes("volume_up:click"), "held repeat must not end with a click");
  const countAfterRelease = events.length;
  await sleep(120);
  assert.equal(events.length, countAfterRelease, "repeat must stop after release");
  engine.dispose();
});

test("quick press of a repeat button is a plain click", async () => {
  const { engine, events } = makeEngine({
    isRepeatButton: (button) => button === "volume_down"
  });
  engine.handleButtonEvent({ button: "volume_down", pressed: true });
  await sleep(10);
  engine.handleButtonEvent({ button: "volume_down", pressed: false });
  assert.deepEqual(events, ["volume_down:click"]);
  engine.dispose();
});

test("dispose cancels pending timers", async () => {
  const { engine, events } = makeEngine({
    hasGestureAction: () => true
  });
  engine.handleButtonEvent({ button: "ok", pressed: true });
  engine.handleButtonEvent({ button: "ok", pressed: false });
  engine.handleButtonEvent({ button: "home", pressed: true });
  engine.dispose();
  await sleep(150);
  assert.deepEqual(events, [], "no gesture may fire after dispose");
});
