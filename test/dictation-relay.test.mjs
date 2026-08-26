import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";

import WebSocket from "ws";

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

function collect(ws) {
  const messages = [];
  ws.on("message", (data) => {
    try {
      messages.push(JSON.parse(String(data)));
    } catch {
      // ignore binary / malformed
    }
  });
  return messages;
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

test("dictation events are relayed to desktop-window observers with source", async (t) => {
  const port = await getFreePort();
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-relay-"));
  const server = spawn(process.execPath, ["src/server.mjs"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      APPDATA: appDataRoot,
      LAN_SHARED_SECRET: "",
      LAN_DISCOVERY_ENABLED: "0",
      LAN_VOICE_BIND: "127.0.0.1",
      LAN_VOICE_PORT: String(port),
      MOCK_TRANSCRIPT: "转发测试",
      SEND_TARGET: "text_injector",
      DRY_RUN_TEXT_INJECTION: "1",
      TRANSCRIPT_DELIVERY_MODE: "immediate"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(async () => {
    await stopServer(server);
    fs.rmSync(appDataRoot, { recursive: true, force: true });
  });

  const desktop = await connectWebSocket(`ws://127.0.0.1:${port}`);
  const remote = await connectWebSocket(`ws://127.0.0.1:${port}`);
  const desktopMessages = collect(desktop);
  const remoteMessages = collect(remote);
  t.after(() => {
    desktop.close();
    remote.close();
  });

  desktop.send(JSON.stringify({ type: "hello", deviceId: "desktop-window", boardType: "desktop-window" }));
  remote.send(JSON.stringify({ type: "hello", deviceId: "xiaomi-test", boardType: "xiaomi-remote-msbc" }));
  await sleep(400);

  remote.send(JSON.stringify({ type: "ptt_start", source: "xiaomi_remote", ts: Date.now() }));
  remote.send(Buffer.from([0x00, 0x00]), { binary: true });
  remote.send(JSON.stringify({ type: "ptt_stop", source: "xiaomi_remote", ts: Date.now() }));
  await sleep(600);

  const desktopRecording = desktopMessages.find((m) => m.type === "status" && m.status === "recording");
  assert.ok(desktopRecording, "desktop should observe recording status");
  assert.equal(desktopRecording.source, "xiaomi_remote");

  const desktopFinals = desktopMessages.filter((m) => m.type === "transcript_final");
  assert.equal(desktopFinals.length, 1, "desktop should record exactly one transcript");
  assert.equal(desktopFinals[0].text, "转发测试");
  assert.equal(desktopFinals[0].source, "xiaomi_remote");

  const remoteFinals = remoteMessages.filter((m) => m.type === "transcript_final");
  assert.equal(remoteFinals.length, 1, "origin gets its own copy only");
  assert.equal(remoteFinals[0].source, undefined, "origin payload stays unchanged");
});

test("desktop-window origin is not relayed back to itself", async (t) => {
  const port = await getFreePort();
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-relay-self-"));
  const server = spawn(process.execPath, ["src/server.mjs"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      APPDATA: appDataRoot,
      LAN_SHARED_SECRET: "",
      LAN_DISCOVERY_ENABLED: "0",
      LAN_VOICE_BIND: "127.0.0.1",
      LAN_VOICE_PORT: String(port),
      MOCK_TRANSCRIPT: "本机测试",
      SEND_TARGET: "text_injector",
      DRY_RUN_TEXT_INJECTION: "1",
      TRANSCRIPT_DELIVERY_MODE: "immediate"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(async () => {
    await stopServer(server);
    fs.rmSync(appDataRoot, { recursive: true, force: true });
  });

  const desktop = await connectWebSocket(`ws://127.0.0.1:${port}`);
  const messages = collect(desktop);
  t.after(() => desktop.close());

  desktop.send(JSON.stringify({ type: "hello", deviceId: "desktop-window", boardType: "desktop-window" }));
  await sleep(400);

  desktop.send(JSON.stringify({ type: "ptt_start", source: "desktop_mic", ts: Date.now() }));
  desktop.send(Buffer.from([0x00, 0x00]), { binary: true });
  desktop.send(JSON.stringify({ type: "ptt_stop", source: "desktop_mic", ts: Date.now() }));
  await sleep(600);

  const finals = messages.filter((m) => m.type === "transcript_final");
  assert.equal(finals.length, 1, "no relay echo for the desktop origin");
});
