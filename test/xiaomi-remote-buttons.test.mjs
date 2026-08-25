import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";

import WebSocket from "ws";

import { UsbPcapAttLineParser } from "../src/usbpcap-att-parser.mjs";
import { XiaomiRemoteProtocolParser } from "../src/xiaomi-remote-protocol.mjs";
import { DEFAULT_REMOTE_BUTTON_KEYS, parseRemoteButtonMap } from "../src/remote-buttons.mjs";

const BUTTONS_FIXTURE = path.resolve("test/fixtures/xiaomi-buttons.pcap");

test("fixture replay emits press/release events for every remote button", () => {
  const pcapParser = new UsbPcapAttLineParser();
  const protocol = new XiaomiRemoteProtocolParser();
  const presses = new Map();
  const releases = new Map();
  const unknown = [];

  for (const line of pcapParser.push(fs.readFileSync(BUTTONS_FIXTURE))) {
    for (const event of protocol.pushLine(line)) {
      if (event.type !== "button") {
        continue;
      }
      if (event.button === "unknown") {
        unknown.push(event.code);
        continue;
      }
      const target = event.pressed ? presses : releases;
      target.set(event.button, (target.get(event.button) || 0) + 1);
    }
  }

  const expected = [
    "up",
    "down",
    "left",
    "right",
    "ok",
    "back",
    "home",
    "volume_up",
    "volume_down"
  ];
  for (const button of expected) {
    assert.ok(presses.get(button) >= 1, `missing press for ${button}`);
    assert.ok(releases.get(button) >= 1, `missing release for ${button}`);
  }
  assert.deepEqual(unknown, [], "fixture should contain no unknown button codes");
});

test("parseRemoteButtonMap defaults, overrides and validation", () => {
  assert.deepEqual(parseRemoteButtonMap(""), { ...DEFAULT_REMOTE_BUTTON_KEYS });
  assert.deepEqual(parseRemoteButtonMap("  "), { ...DEFAULT_REMOTE_BUTTON_KEYS });

  const overridden = parseRemoteButtonMap("ok:enter, back: none ,home:volume_up");
  assert.equal(overridden.ok, "enter");
  assert.equal(overridden.back, "none");
  assert.equal(overridden.home, "volume_up");
  assert.equal(overridden.up, "up");

  assert.throws(() => parseRemoteButtonMap("nope:enter"), /Unknown Xiaomi remote button/);
  assert.throws(() => parseRemoteButtonMap("ok:"), /Missing key/);
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function connectWebSocket(url, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        ws.once("open", () => resolve(ws));
        ws.once("error", (error) => {
          ws.terminate();
          reject(error);
        });
      });
    } catch (error) {
      lastError = error;
      await sleep(100);
    }
  }
  throw lastError || new Error(`failed to connect to ${url}`);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) {
    return;
  }
  await new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill();
    setTimeout(resolve, 3000).unref?.();
  });
}

test("server handles remote_button messages and dry-run injects the mapped key", async (t) => {
  const port = await getFreePort();
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-remote-button-"));
  const server = spawn(process.execPath, ["src/server.mjs"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      APPDATA: appDataRoot,
      LAN_SHARED_SECRET: "",
      LAN_DISCOVERY_ENABLED: "0",
      LAN_VOICE_BIND: "127.0.0.1",
      LAN_VOICE_PORT: String(port),
      MOCK_TRANSCRIPT: "ok",
      SEND_TARGET: "text_injector",
      DRY_RUN_TEXT_INJECTION: "1",
      TRANSCRIPT_DELIVERY_MODE: "immediate"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const serverOutput = [];
  server.stdout.on("data", (chunk) => serverOutput.push(String(chunk)));
  server.stderr.on("data", (chunk) => serverOutput.push(String(chunk)));

  t.after(async () => {
    await stopServer(server);
    fs.rmSync(appDataRoot, { recursive: true, force: true });
  });

  const ws = await connectWebSocket(`ws://127.0.0.1:${port}`);
  t.after(() => {
    if (ws.readyState !== WebSocket.CLOSED) {
      ws.close();
    }
  });

  ws.send(JSON.stringify({ type: "hello", deviceId: "xiaomi-test", boardType: "xiaomi-remote-msbc" }));
  await sleep(500);

  ws.send(JSON.stringify({ type: "remote_button", button: "ok", code: 0x28, pressed: true, ts: Date.now() }));
  ws.send(JSON.stringify({ type: "remote_button", button: "ok", code: 0x28, pressed: false, ts: Date.now() }));
  ws.send(JSON.stringify({ type: "remote_button", button: "unknown", code: 0xab, pressed: true, ts: Date.now() }));
  await sleep(500);

  const output = serverOutput.join("");
  assert.ok(output.includes("remote_button"), `server should log the button\n${output}`);
  assert.ok(output.includes("[inject] dry-run"), `dry-run injection should be logged\n${output}`);
  assert.ok(output.includes("remote_button unknown code 0xab"), `unknown codes should be logged\n${output}`);
  assert.equal(
    output.includes("unknown_message_type:remote_button"),
    false,
    `server should handle remote_button natively\n${output}`
  );
});
