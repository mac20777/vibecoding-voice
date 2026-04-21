import test from "node:test";
import assert from "node:assert/strict";

import { isFreshTimestamp, signDiscoveryReply, signHelloPayload, signaturesMatch } from "../src/lan-auth.mjs";

test("signHelloPayload returns a stable sha256 hex signature", () => {
  const signature = signHelloPayload(
    {
      deviceId: "device-1",
      boardType: "zectrix",
      ts: 1234567890,
      nonce: "abc"
    },
    "secret"
  );

  assert.equal(signature.length, 64);
  assert.match(signature, /^[0-9a-f]+$/);
});

test("signaturesMatch compares signatures in constant time", () => {
  const expected = signDiscoveryReply(
    {
      hostId: "host-a",
      hostName: "pc",
      wsUrl: "ws://192.168.1.10:8765",
      nonce: "xyz"
    },
    "secret"
  );

  assert.equal(signaturesMatch(expected, expected.toUpperCase()), true);
  assert.equal(signaturesMatch(expected, `${expected.slice(0, -1)}0`), false);
});

test("isFreshTimestamp rejects stale timestamps", () => {
  assert.equal(isFreshTimestamp(Date.now(), 300), true);
  assert.equal(isFreshTimestamp(Date.now() - 301_000, 300), false);
});
