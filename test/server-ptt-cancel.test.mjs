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
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
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
        const cleanup = () => {
          ws.removeListener("open", onOpen);
          ws.removeListener("error", onError);
        };
        const onOpen = () => {
          cleanup();
          resolve(ws);
        };
        const onError = (error) => {
          cleanup();
          ws.terminate();
          reject(error);
        };
        ws.once("open", onOpen);
        ws.once("error", onError);
      });
    } catch (error) {
      lastError = error;
      await sleep(100);
    }
  }

  throw lastError || new Error(`failed to connect to ${url}`);
}

function createMessageCollector(ws) {
  const queue = [];
  const waiters = [];

  const flush = (message) => {
    const index = waiters.findIndex((waiter) => waiter.predicate(message));
    if (index >= 0) {
      const [waiter] = waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
      return true;
    }
    return false;
  };

  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      return;
    }
    const message = JSON.parse(Buffer.from(data).toString("utf8"));
    if (!flush(message)) {
      queue.push(message);
    }
  });

  ws.once("close", () => {
    while (waiters.length > 0) {
      const waiter = waiters.shift();
      clearTimeout(waiter.timer);
      waiter.reject(new Error("websocket_closed"));
    }
  });

  return {
    waitFor(predicate, timeoutMs = 5000) {
      const index = queue.findIndex(predicate);
      if (index >= 0) {
        return Promise.resolve(queue.splice(index, 1)[0]);
      }

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const waiterIndex = waiters.findIndex((waiter) => waiter.resolve === resolve);
          if (waiterIndex >= 0) {
            waiters.splice(waiterIndex, 1);
          }
          reject(new Error("message_timeout"));
        }, timeoutMs);

        waiters.push({ predicate, resolve, reject, timer });
      });
    }
  };
}

async function closeWebSocket(ws) {
  if (!ws || ws.readyState === WebSocket.CLOSED) {
    return;
  }

  await new Promise((resolve) => {
    ws.once("close", resolve);
    ws.close();
  });
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

test("ptt_cancel clears the recording segment and the next session still works", async (t) => {
  const port = await getFreePort();
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-ptt-cancel-"));
  const server = spawn(process.execPath, ["src/server.mjs"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      APPDATA: appDataRoot,
      LAN_SHARED_SECRET: "",
      LAN_DISCOVERY_ENABLED: "0",
      LAN_VOICE_BIND: "127.0.0.1",
      LAN_VOICE_PORT: String(port),
      MOCK_TRANSCRIPT: "取消之后还能用",
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
  const messages = createMessageCollector(ws);
  t.after(() => closeWebSocket(ws));

  ws.send(JSON.stringify({ type: "hello", deviceId: "xiaomi-test", boardType: "xiaomi-remote-msbc" }));
  await messages.waitFor((message) => message.type === "hello_ack");
  await messages.waitFor((message) => message.type === "server_ready");

  // A session that starts but is cancelled (for example a Xiaomi remote key
  // press that produced no audio) must reset the recording state.
  ws.send(JSON.stringify({ type: "ptt_start", source: "xiaomi_remote", ts: Date.now() }));
  await messages.waitFor((message) => message.type === "status" && message.status === "recording");
  ws.send(JSON.stringify({ type: "ptt_cancel", source: "xiaomi_remote", ts: Date.now() }));
  await messages.waitFor((message) => message.type === "status" && message.status === "cancelled");

  // The next session must still transcribe normally.
  ws.send(JSON.stringify({ type: "ptt_start", source: "xiaomi_remote", ts: Date.now() }));
  ws.send(Buffer.from([0x00, 0x00]), { binary: true });
  ws.send(JSON.stringify({ type: "ptt_stop", source: "xiaomi_remote", ts: Date.now() }));

  const finalMessage = await messages.waitFor((message) => message.type === "transcript_final");
  assert.equal(finalMessage.text, "取消之后还能用");
  assert.equal(
    serverOutput.join("").includes("unknown_message_type:ptt_cancel"),
    false,
    `server should handle ptt_cancel natively\n${serverOutput.join("")}`
  );
});
