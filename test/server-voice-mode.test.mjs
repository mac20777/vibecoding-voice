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

  const onMessage = (data, isBinary) => {
    if (isBinary) {
      return;
    }
    const message = JSON.parse(Buffer.from(data).toString("utf8"));
    if (!flush(message)) {
      queue.push(message);
    }
  };

  const onClose = () => {
    while (waiters.length > 0) {
      const waiter = waiters.shift();
      clearTimeout(waiter.timer);
      waiter.reject(new Error("websocket_closed"));
    }
  };

  ws.on("message", onMessage);
  ws.once("close", onClose);

  return {
    take(predicate) {
      const index = queue.findIndex(predicate);
      if (index < 0) {
        return null;
      }
      return queue.splice(index, 1)[0];
    },
    waitFor(predicate, timeoutMs = 5000) {
      const existing = this.take(predicate);
      if (existing) {
        return Promise.resolve(existing);
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

test("server routes transcripts using each client's own voice mode", async (t) => {
  const port = await getFreePort();
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-server-mode-"));
  const server = spawn(process.execPath, ["src/server.mjs"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      APPDATA: appDataRoot,
      LAN_DISCOVERY_ENABLED: "0",
      LAN_VOICE_BIND: "127.0.0.1",
      LAN_VOICE_PORT: String(port),
      MOCK_TRANSCRIPT: "添加计划 买牛奶",
      SEND_TARGET: "text_injector",
      DRY_RUN_TEXT_INJECTION: "1",
      TODO_INTENT_PROVIDER: "rules",
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

  const url = `ws://127.0.0.1:${port}`;
  const todoWs = await connectWebSocket(url);
  const todoMessages = createMessageCollector(todoWs);
  t.after(() => closeWebSocket(todoWs));

  todoWs.send(JSON.stringify({ type: "hello", deviceId: "todo-board" }));
  await todoMessages.waitFor((message) => message.type === "hello_ack");
  await todoMessages.waitFor((message) => message.type === "server_ready");
  await todoMessages.waitFor((message) => message.type === "mode_state" && message.mode === "normal");

  todoWs.send(JSON.stringify({ type: "set_mode", mode: "todo" }));
  await todoMessages.waitFor((message) => message.type === "mode_state" && message.mode === "todo");

  const liveWs = await connectWebSocket(url);
  const liveMessages = createMessageCollector(liveWs);
  t.after(() => closeWebSocket(liveWs));

  liveWs.send(JSON.stringify({ type: "hello", deviceId: "live-console" }));
  await liveMessages.waitFor((message) => message.type === "hello_ack");
  await liveMessages.waitFor((message) => message.type === "server_ready");
  await liveMessages.waitFor((message) => message.type === "mode_state" && message.mode === "normal");

  liveWs.send(JSON.stringify({ type: "set_mode", mode: "normal" }));
  await liveMessages.waitFor((message) => message.type === "mode_state" && message.mode === "normal");

  await sleep(200);
  assert.equal(
    todoMessages.take((message) => message.type === "mode_state" && message.mode === "normal"),
    null,
    `todo client should not be forced back to normal\n${serverOutput.join("")}`
  );

  const todoStatePromise = todoMessages.waitFor(
    (message) =>
      message.type === "todo_state" &&
      Array.isArray(message.items) &&
      message.items.some((item) => item.title === "买牛奶")
  );
  const todoResultPromise = todoMessages.waitFor(
    (message) => message.type === "todo_result" && message.ok === true && /已添加计划/.test(message.message)
  );

  todoWs.send(JSON.stringify({ type: "ptt_start", ts: Date.now() }));
  todoWs.send(Buffer.from([0x00, 0x00]), { binary: true });
  todoWs.send(JSON.stringify({ type: "ptt_stop", ts: Date.now() }));

  await todoStatePromise;
  await todoResultPromise;

  assert.equal(
    todoMessages.take((message) => message.type === "status" && message.status === "typed"),
    null,
    `todo mode should not dispatch as live inject\n${serverOutput.join("")}`
  );
});
