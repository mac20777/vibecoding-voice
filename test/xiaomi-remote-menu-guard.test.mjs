import test from "node:test";
import assert from "node:assert/strict";

import { XiaomiRemoteMenuGuard } from "../src/xiaomi-remote-menu-guard.mjs";

function menuCycle(guard) {
  guard.handle({ button: "menu", pressed: true });
  return guard.handle({ button: "menu", pressed: false });
}

test("three completed menu cycles in the window trip the anomaly guard once", () => {
  let now = 1_000;
  const trips = [];
  const guard = new XiaomiRemoteMenuGuard({
    now: () => now,
    onTrip: (details) => trips.push(details)
  });

  assert.equal(menuCycle(guard), false);
  now += 500;
  assert.equal(menuCycle(guard), false);
  now += 500;
  assert.equal(menuCycle(guard), true);
  assert.equal(trips.length, 1);

  now += 500;
  assert.equal(menuCycle(guard), false, "cooldown prevents a repair loop");
  assert.equal(trips.length, 1);
});

test("a held key or key-up without a matching key-down never trips", () => {
  let now = 1_000;
  const trips = [];
  const guard = new XiaomiRemoteMenuGuard({
    threshold: 2,
    now: () => now,
    onTrip: (details) => trips.push(details)
  });

  guard.handle({ button: "menu", pressed: true });
  guard.handle({ button: "menu", pressed: true });
  now += 100;
  guard.handle({ button: "menu", pressed: false });
  now += 100;
  guard.handle({ button: "menu", pressed: false });
  assert.equal(trips.length, 0);
});

test("Home+Menu pairing hold is excluded from anomaly repair", () => {
  let now = 1_000;
  const trips = [];
  const guard = new XiaomiRemoteMenuGuard({
    threshold: 2,
    now: () => now,
    onTrip: (details) => trips.push(details)
  });

  for (let index = 0; index < 4; index += 1) {
    guard.handle({ button: "home", pressed: true });
    menuCycle(guard);
    guard.handle({ button: "home", pressed: false });
    now += 100;
  }
  assert.equal(trips.length, 0);
});

test("old menu cycles outside the detection window are discarded", () => {
  let now = 1_000;
  const trips = [];
  const guard = new XiaomiRemoteMenuGuard({
    threshold: 3,
    windowMs: 1_000,
    now: () => now,
    onTrip: (details) => trips.push(details)
  });

  menuCycle(guard);
  now += 1_500;
  menuCycle(guard);
  now += 1_500;
  menuCycle(guard);
  assert.equal(trips.length, 0);
});
