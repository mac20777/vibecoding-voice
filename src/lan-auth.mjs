import { createHmac, timingSafeEqual } from "node:crypto";

function toBuffer(value) {
  return Buffer.from(String(value || ""), "utf8");
}

function createHexHmac(secret, parts) {
  return createHmac("sha256", toBuffer(secret))
    .update(parts.join("|"), "utf8")
    .digest("hex");
}

export function signHelloPayload({ deviceId, boardType, ts, nonce }, secret) {
  return createHexHmac(secret, ["hello", deviceId, boardType, String(ts), nonce]);
}

export function signDiscoveryReply({ hostId, hostName, wsUrl, nonce }, secret) {
  return createHexHmac(secret, ["discover_reply", hostId, hostName, wsUrl, nonce]);
}

export function isFreshTimestamp(timestampMs, windowSec) {
  const ts = Number(timestampMs);
  if (!Number.isFinite(ts) || ts <= 0) {
    return false;
  }

  return Math.abs(Date.now() - ts) <= windowSec * 1000;
}

export function signaturesMatch(expectedHex, actualHex) {
  const expected = String(expectedHex || "").trim().toLowerCase();
  const actual = String(actualHex || "").trim().toLowerCase();
  if (!expected || !actual || expected.length !== actual.length) {
    return false;
  }

  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
  } catch {
    return false;
  }
}
