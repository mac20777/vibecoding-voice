import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";

import WebSocket from "ws";

import { VIRTUAL_MIC_MESSAGE } from "../src/virtual-microphone-protocol.mjs";

const FAKE_PUBLISHER = path.resolve("test/fixtures/fake-virtual-mic-publisher.mjs");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await sleep(40);
  }
  throw new Error("condition_timeout");
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

function startServer(port, root, extraEnv = {}) {
  return spawn(process.execPath, ["src/server.mjs"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      APPDATA: root,
      LOCALAPPDATA: root,
      LAN_SHARED_SECRET: "",
      LAN_DISCOVERY_ENABLED: "0",
      LAN_VOICE_BIND: "127.0.0.1",
      LAN_VOICE_PORT: String(port),
      MOCK_TRANSCRIPT: "STT不应被调用",
      SEND_TARGET: "text_injector",
      DRY_RUN_TEXT_INJECTION: "1",
      XIAOMI_REMOTE_VOICE_MODE: "wechat",
      ...extraEnv
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
}

test("desktop_mic in wechat mode streams into the virtual microphone instead of STT", async (t) => {
  const port = await getFreePort();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-wechat-mic-"));
  const publisherLog = path.join(root, "publisher.jsonl");
  const server = startServer(port, root, {
    VIBE_VIRTUAL_MIC_PUBLISHER_PATH: FAKE_PUBLISHER,
    VIBE_VIRTUAL_MIC_ROUTE_STATE_PATH: path.join(root, "route-state.txt"),
    FAKE_PUBLISHER_LOG: publisherLog
  });
  t.after(async () => {
    await stopServer(server);
    fs.rmSync(root, { recursive: true, force: true });
  });

  const mic = await connectWebSocket(`ws://127.0.0.1:${port}`);
  const messages = collect(mic);
  t.after(() => mic.close());
  mic.send(JSON.stringify({ type: "hello", deviceId: "desktop-app", boardType: "desktop-window" }));
  await sleep(400);

  const pcm = Buffer.alloc(3200, 0x05);
  mic.send(JSON.stringify({ type: "ptt_start", source: "desktop_mic" }));
  await waitUntil(() => messages.some((m) => m.type === "status" && m.status === "recording"));
  mic.send(pcm, { binary: true });
  mic.send(JSON.stringify({ type: "ptt_stop", source: "desktop_mic" }));
  await waitUntil(() => messages.some((m) => m.type === "status" && m.status === "wechat_sent"));
  await waitUntil(() => {
    if (!fs.existsSync(publisherLog)) {
      return false;
    }
    const log = fs.readFileSync(publisherLog, "utf8");
    return log.includes(`"type":${VIRTUAL_MIC_MESSAGE.PCM16}`) &&
      log.includes(`"type":${VIRTUAL_MIC_MESSAGE.STOP}`);
  });

  assert.ok(
    messages.some((m) => m.type === "status" && m.status === "recording"),
    "client should see the recording status"
  );
  assert.ok(
    messages.some((m) => m.type === "status" && m.status === "wechat_sent"),
    "client should see wechat_sent after ptt_stop"
  );
  assert.equal(
    messages.filter((m) => m.type === "transcript_final").length,
    0,
    "STT must not run for desktop_mic in wechat mode"
  );

  const frames = fs.readFileSync(publisherLog, "utf8").trim().split("\n").map(JSON.parse);
  const types = frames.map((frame) => frame.type);
  assert.ok(types.includes(VIRTUAL_MIC_MESSAGE.START), "publisher should receive START");
  assert.ok(types.includes(VIRTUAL_MIC_MESSAGE.PCM16), "publisher should receive PCM16");
  assert.ok(types.includes(VIRTUAL_MIC_MESSAGE.STOP), "publisher should receive STOP");
  assert.ok(
    types.indexOf(VIRTUAL_MIC_MESSAGE.START) < types.indexOf(VIRTUAL_MIC_MESSAGE.PCM16) &&
      types.indexOf(VIRTUAL_MIC_MESSAGE.PCM16) < types.indexOf(VIRTUAL_MIC_MESSAGE.STOP),
    "frames must stay ordered START → PCM16 → STOP"
  );
  const pcmFrame = frames.find((frame) => frame.type === VIRTUAL_MIC_MESSAGE.PCM16);
  assert.equal(pcmFrame.payloadHex, pcm.toString("hex"), "PCM bytes arrive unchanged");
});

test("desktop_mic in wechat mode reports wechat_error when the publisher is missing", async (t) => {
  const port = await getFreePort();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-wechat-missing-"));
  const server = startServer(port, root, {
    VIBE_VIRTUAL_MIC_PUBLISHER_PATH: path.join(root, "no-such-publisher.exe"),
    VIBE_VIRTUAL_MIC_ROUTE_STATE_PATH: path.join(root, "route-state.txt")
  });
  t.after(async () => {
    await stopServer(server);
    fs.rmSync(root, { recursive: true, force: true });
  });

  const mic = await connectWebSocket(`ws://127.0.0.1:${port}`);
  const messages = collect(mic);
  t.after(() => mic.close());
  mic.send(JSON.stringify({ type: "hello", deviceId: "desktop-app", boardType: "desktop-window" }));
  await sleep(400);

  mic.send(JSON.stringify({ type: "ptt_start", source: "desktop_mic" }));
  await sleep(600);

  assert.ok(
    messages.some((m) => m.type === "status" && m.status === "wechat_error"),
    "client should see wechat_error"
  );
  assert.equal(
    messages.filter((m) => m.type === "transcript_final").length,
    0,
    "no transcript without a publisher"
  );

  // The segment must not latch: a later builtin-style segment still works.
  mic.send(JSON.stringify({ type: "ptt_start", source: "desktop_mic" }));
  mic.send(Buffer.from([0x01, 0x00, 0x02, 0x00]), { binary: true });
  mic.send(JSON.stringify({ type: "ptt_stop", source: "desktop_mic" }));
  await sleep(600);
  assert.ok(
    messages.filter((m) => m.type === "status" && m.status === "wechat_error").length >= 2,
    "each wechat attempt fails cleanly without sticking"
  );
});

test("desktop_mic in wechat mode cancels the virtual microphone when the client disconnects", async (t) => {
  const port = await getFreePort();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-wechat-disconnect-"));
  const publisherLog = path.join(root, "publisher.jsonl");
  const server = startServer(port, root, {
    VIBE_VIRTUAL_MIC_PUBLISHER_PATH: FAKE_PUBLISHER,
    VIBE_VIRTUAL_MIC_ROUTE_STATE_PATH: path.join(root, "route-state.txt"),
    FAKE_PUBLISHER_LOG: publisherLog
  });
  t.after(async () => {
    await stopServer(server);
    fs.rmSync(root, { recursive: true, force: true });
  });

  const mic = await connectWebSocket(`ws://127.0.0.1:${port}`);
  mic.send(JSON.stringify({ type: "hello", deviceId: "desktop-app", boardType: "desktop-window" }));
  await sleep(400);
  mic.send(JSON.stringify({ type: "ptt_start", source: "desktop_mic" }));
  await sleep(600);
  mic.send(Buffer.alloc(640, 0x07), { binary: true });
  await sleep(100);
  mic.close();
  await sleep(600);

  const frames = fs.readFileSync(publisherLog, "utf8").trim().split("\n").map(JSON.parse);
  const types = frames.map((frame) => frame.type);
  assert.ok(types.includes(VIRTUAL_MIC_MESSAGE.START), "publisher should receive START");
  assert.ok(types.includes(VIRTUAL_MIC_MESSAGE.CANCEL), "disconnect should release the WeChat route");
  assert.ok(
    types.indexOf(VIRTUAL_MIC_MESSAGE.START) < types.indexOf(VIRTUAL_MIC_MESSAGE.CANCEL),
    "CANCEL must follow START"
  );
});

test("desktop_mic in builtin_stt mode still uses STT and ignores the publisher", async (t) => {
  const port = await getFreePort();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-builtin-mic-"));
  const publisherLog = path.join(root, "publisher.jsonl");
  const server = startServer(port, root, {
    XIAOMI_REMOTE_VOICE_MODE: "builtin_stt",
    VIBE_VIRTUAL_MIC_PUBLISHER_PATH: FAKE_PUBLISHER,
    VIBE_VIRTUAL_MIC_ROUTE_STATE_PATH: path.join(root, "route-state.txt"),
    FAKE_PUBLISHER_LOG: publisherLog
  });
  t.after(async () => {
    await stopServer(server);
    fs.rmSync(root, { recursive: true, force: true });
  });

  const mic = await connectWebSocket(`ws://127.0.0.1:${port}`);
  const messages = collect(mic);
  t.after(() => mic.close());
  mic.send(JSON.stringify({ type: "hello", deviceId: "desktop-app", boardType: "desktop-window" }));
  await sleep(400);

  mic.send(JSON.stringify({ type: "ptt_start", source: "desktop_mic" }));
  await sleep(200);
  mic.send(Buffer.from([0x01, 0x00, 0x02, 0x00]), { binary: true });
  mic.send(JSON.stringify({ type: "ptt_stop", source: "desktop_mic" }));
  await sleep(800);

  const finals = messages.filter((m) => m.type === "transcript_final");
  assert.equal(finals.length, 1, "builtin mode still transcribes");
  assert.equal(finals[0].text, "STT不应被调用", "mock transcript is returned");
  assert.ok(!fs.existsSync(publisherLog), "publisher is never spawned in builtin mode");
});

test("wechat_transcript accumulates segments and action_send injects the joined preview", async (t) => {
  const port = await getFreePort();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-wechat-transcript-"));
  const server = startServer(port, root, {});
  t.after(async () => {
    await stopServer(server);
    fs.rmSync(root, { recursive: true, force: true });
  });

  const mic = await connectWebSocket(`ws://127.0.0.1:${port}`);
  const messages = collect(mic);
  t.after(() => mic.close());
  mic.send(JSON.stringify({ type: "hello", deviceId: "desktop-app", boardType: "desktop-window" }));
  await sleep(400);

  mic.send(JSON.stringify({ type: "wechat_transcript", source: "desktop_mic", text: "第一段" }));
  await waitUntil(() => messages.some((m) => m.type === "status" && m.status === "awaiting_action"));

  const firstFinal = messages.find((m) => m.type === "transcript_final");
  assert.ok(firstFinal, "preview transcript_final is emitted");
  assert.equal(firstFinal.requiresAction, true, "wechat transcripts always wait for confirmation");
  assert.equal(firstFinal.text, "第一段");

  // A second dictated segment appends to the pending preview.
  mic.send(JSON.stringify({ type: "wechat_transcript", source: "desktop_mic", text: "第二段" }));
  await waitUntil(() =>
    messages.some((m) => m.type === "status" && m.status === "awaiting_action" && m.text === "第一段 第二段"));

  // Undo pops the last segment, the preview stays open with what remains.
  mic.send(JSON.stringify({ type: "action_undo" }));
  await waitUntil(() =>
    messages.filter((m) => m.type === "status" && m.status === "awaiting_action")
      .some((m) => m.text === "第一段"));

  // Confirm injects the joined preview text in one shot (dry-run injection).
  mic.send(JSON.stringify({ type: "action_send" }));
  await waitUntil(() => messages.some((m) => m.type === "status" && m.status === "typed"));
  const typed = messages.find((m) => m.type === "status" && m.status === "typed");
  assert.equal(typed.text, "第一段");
});

test("wechat_transcript: undo to empty cancels, empty text and bad sources are rejected", async (t) => {
  const port = await getFreePort();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-wechat-reject-"));
  const server = startServer(port, root, {});
  t.after(async () => {
    await stopServer(server);
    fs.rmSync(root, { recursive: true, force: true });
  });

  const mic = await connectWebSocket(`ws://127.0.0.1:${port}`);
  const messages = collect(mic);
  t.after(() => mic.close());
  mic.send(JSON.stringify({ type: "hello", deviceId: "desktop-app", boardType: "desktop-window" }));
  await sleep(400);

  // Empty recognized text never enters the preview.
  mic.send(JSON.stringify({ type: "wechat_transcript", source: "desktop_mic", text: "   " }));
  await waitUntil(() => messages.some((m) => m.type === "status" && m.status === "transcript_empty"));
  assert.equal(messages.filter((m) => m.type === "transcript_final").length, 0);

  // Unknown sources are dropped silently.
  mic.send(JSON.stringify({ type: "wechat_transcript", source: "hacker", text: "不该进入预览" }));
  await sleep(400);
  assert.equal(messages.filter((m) => m.type === "transcript_final").length, 0);

  // Undoing the only segment cancels the whole preview.
  mic.send(JSON.stringify({ type: "wechat_transcript", source: "xiaomi_remote", text: "你好" }));
  await waitUntil(() => messages.some((m) => m.type === "status" && m.status === "awaiting_action"));
  mic.send(JSON.stringify({ type: "action_undo" }));
  await waitUntil(() => messages.some((m) => m.type === "status" && m.status === "cancelled"));
});
