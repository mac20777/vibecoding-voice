import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";
import { createServer as createHttpServer } from "node:http";

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

test("desktop mic injects text immediately and submit action presses Enter", async (t) => {
  const port = await getFreePort();
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-desktop-mic-submit-"));
  const server = spawn(process.execPath, ["src/server.mjs"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      APPDATA: appDataRoot,
      LAN_SHARED_SECRET: "",
      LAN_DISCOVERY_ENABLED: "0",
      LAN_VOICE_BIND: "127.0.0.1",
      LAN_VOICE_PORT: String(port),
      MOCK_TRANSCRIPT: "hello desktop",
      SEND_TARGET: "text_injector",
      DRY_RUN_TEXT_INJECTION: "1",
      TRANSCRIPT_DELIVERY_MODE: "confirm_on_device",
      TEXT_INJECTION_MODE: "type_and_enter"
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

  ws.send(JSON.stringify({ type: "hello", deviceId: "desktop-window", boardType: "desktop-window" }));
  await messages.waitFor((message) => message.type === "hello_ack");
  await messages.waitFor((message) => message.type === "server_ready");
  await messages.waitFor((message) => message.type === "mode_state" && message.mode === "normal");

  ws.send(JSON.stringify({ type: "ptt_start", source: "desktop_mic", ts: Date.now() }));
  ws.send(Buffer.from([0x00, 0x00]), { binary: true });
  ws.send(JSON.stringify({ type: "ptt_stop", source: "desktop_mic", ts: Date.now() }));

  const finalMessage = await messages.waitFor((message) => message.type === "transcript_final");
  assert.equal(finalMessage.text, "hello desktop");
  assert.equal(finalMessage.requiresAction, false);

  const typed = await messages.waitFor((message) => message.type === "status" && message.status === "typed");
  assert.equal(typed.text, "hello desktop");
  assert.match(serverOutput.join(""), /mode: 'type_only'/);
  assert.equal(messages.take((message) => message.type === "status" && message.status === "awaiting_action"), null);

  ws.send(JSON.stringify({ type: "action_submit", source: "desktop_mic" }));
  await messages.waitFor((message) => message.type === "status" && message.status === "submitted");
  assert.match(serverOutput.join(""), /mode: 'enter_only'/);
});

test("Xiaomi remote with confirm_on_device previews in the overlay; OK injects and sends", async (t) => {
  const port = await getFreePort();
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-xiaomi-remote-"));
  const server = spawn(process.execPath, ["src/server.mjs"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      APPDATA: appDataRoot,
      LAN_SHARED_SECRET: "",
      LAN_DISCOVERY_ENABLED: "0",
      LAN_VOICE_BIND: "127.0.0.1",
      LAN_VOICE_PORT: String(port),
      MOCK_TRANSCRIPT: "测试小米遥控器",
      SEND_TARGET: "text_injector",
      DRY_RUN_TEXT_INJECTION: "1",
      TRANSCRIPT_DELIVERY_MODE: "confirm_on_device",
      TEXT_INJECTION_MODE: "type_and_enter"
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
  await messages.waitFor((message) => message.type === "mode_state" && message.mode === "normal");

  ws.send(JSON.stringify({ type: "ptt_start", source: "xiaomi_remote", ts: Date.now() }));
  ws.send(Buffer.from([0x00, 0x00]), { binary: true });
  ws.send(JSON.stringify({ type: "ptt_stop", source: "xiaomi_remote", ts: Date.now() }));

  // Preview phase: transcript is shown (overlay) but nothing is injected yet.
  const finalMessage = await messages.waitFor((message) => message.type === "transcript_final");
  assert.equal(finalMessage.text, "测试小米遥控器");
  assert.equal(finalMessage.requiresAction, true);
  await messages.waitFor((message) => message.type === "status" && message.status === "awaiting_action");
  assert.equal(
    messages.take((message) => message.type === "status" && message.status === "typed"),
    null,
    "nothing is typed before confirmation"
  );
  assert.equal(serverOutput.join("").includes("[inject] dry-run"), false, "no injection before OK");

  // The remote's OK click injects the previewed text and sends it in one step.
  ws.send(JSON.stringify({ type: "remote_button", button: "ok", code: 0x28, pressed: true, ts: Date.now() }));
  ws.send(JSON.stringify({ type: "remote_button", button: "ok", code: 0x28, pressed: false, ts: Date.now() }));
  await messages.waitFor((message) => message.type === "status" && message.status === "typed");
  assert.match(serverOutput.join(""), /mode: 'type_and_enter'/);
});

test("Xiaomi remote preview: Back discards the pending transcript", async (t) => {
  const port = await getFreePort();
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-xiaomi-preview-cancel-"));
  const server = spawn(process.execPath, ["src/server.mjs"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      APPDATA: appDataRoot,
      LAN_SHARED_SECRET: "",
      LAN_DISCOVERY_ENABLED: "0",
      LAN_VOICE_BIND: "127.0.0.1",
      LAN_VOICE_PORT: String(port),
      MOCK_TRANSCRIPT: "将被丢弃",
      SEND_TARGET: "text_injector",
      DRY_RUN_TEXT_INJECTION: "1",
      TRANSCRIPT_DELIVERY_MODE: "confirm_on_device"
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

  ws.send(JSON.stringify({ type: "ptt_start", source: "xiaomi_remote", ts: Date.now() }));
  ws.send(Buffer.from([0x00, 0x00]), { binary: true });
  ws.send(JSON.stringify({ type: "ptt_stop", source: "xiaomi_remote", ts: Date.now() }));
  await messages.waitFor((message) => message.type === "status" && message.status === "awaiting_action");

  ws.send(JSON.stringify({ type: "remote_button", button: "back", code: 0xf1, pressed: true, ts: Date.now() }));
  ws.send(JSON.stringify({ type: "remote_button", button: "back", code: 0xf1, pressed: false, ts: Date.now() }));
  await messages.waitFor((message) => message.type === "status" && message.status === "cancelled");

  // The transcript is gone: a later OK falls back to its normal Enter mapping
  // and must not inject the discarded text.
  ws.send(JSON.stringify({ type: "remote_button", button: "ok", code: 0x28, pressed: true, ts: Date.now() }));
  ws.send(JSON.stringify({ type: "remote_button", button: "ok", code: 0x28, pressed: false, ts: Date.now() }));
  await sleep(400);
  assert.equal(serverOutput.join("").includes("将被丢弃"), false, "discarded preview must never inject");
});

test("server translates live voice transcript before device confirmation", async (t) => {
  const port = await getFreePort();
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-translation-"));
  let translationRequest = null;
  const translationServer = createHttpServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      translationRequest = {
        url: req.url,
        authorization: req.headers.authorization,
        body: JSON.parse(body)
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        choices: [
          {
            message: {
              content: "Make this feature more robust."
            }
          }
        ]
      }));
    });
  });

  await new Promise((resolve, reject) => {
    translationServer.once("error", reject);
    translationServer.listen(0, "127.0.0.1", resolve);
  });
  const translationPort = translationServer.address().port;

  const server = spawn(process.execPath, ["src/server.mjs"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      APPDATA: appDataRoot,
      LAN_SHARED_SECRET: "",
      LAN_DISCOVERY_ENABLED: "0",
      LAN_VOICE_BIND: "127.0.0.1",
      LAN_VOICE_PORT: String(port),
      MOCK_TRANSCRIPT: "帮我把这个功能做得更稳一点",
      SEND_TARGET: "text_injector",
      DRY_RUN_TEXT_INJECTION: "1",
      TRANSCRIPT_DELIVERY_MODE: "confirm_on_device",
      VOICE_TRANSLATION_ENABLED: "1",
      VOICE_TRANSLATION_API_KEY: "translation-key",
      VOICE_TRANSLATION_BASE_URL: `http://127.0.0.1:${translationPort}`,
      VOICE_TRANSLATION_MODEL: "deepseek-chat"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const serverOutput = [];
  server.stdout.on("data", (chunk) => serverOutput.push(String(chunk)));
  server.stderr.on("data", (chunk) => serverOutput.push(String(chunk)));

  t.after(async () => {
    await stopServer(server);
    await new Promise((resolve) => translationServer.close(resolve));
    fs.rmSync(appDataRoot, { recursive: true, force: true });
  });

  const ws = await connectWebSocket(`ws://127.0.0.1:${port}`);
  const messages = createMessageCollector(ws);
  t.after(() => closeWebSocket(ws));

  ws.send(JSON.stringify({ type: "hello", deviceId: "translation-board" }));
  await messages.waitFor((message) => message.type === "hello_ack");
  await messages.waitFor(
    (message) => message.type === "server_ready" && message.voiceTranslationEnabled === true
  );
  await messages.waitFor((message) => message.type === "mode_state" && message.mode === "normal");

  ws.send(JSON.stringify({ type: "set_voice_translation", enabled: false }));
  await messages.waitFor((message) => message.type === "voice_translation_state" && message.enabled === false);
  ws.send(JSON.stringify({ type: "set_voice_translation", enabled: true }));
  await messages.waitFor((message) => message.type === "voice_translation_state" && message.enabled === true);

  ws.send(JSON.stringify({ type: "ptt_start", ts: Date.now() }));
  ws.send(Buffer.from([0x00, 0x00]), { binary: true });
  ws.send(JSON.stringify({ type: "ptt_stop", ts: Date.now() }));

  await messages.waitFor(
    (message) => message.type === "status" && message.status === "translating" && /功能做得更稳/.test(message.text)
  );
  const finalMessage = await messages.waitFor((message) => message.type === "transcript_final");
  assert.equal(finalMessage.text, "Make this feature more robust.");
  assert.equal(finalMessage.originalText, "帮我把这个功能做得更稳一点");
  assert.equal(finalMessage.transform, "translation");
  assert.equal(finalMessage.requiresAction, true);

  const awaitingAction = await messages.waitFor(
    (message) => message.type === "status" && message.status === "awaiting_action"
  );
  assert.equal(awaitingAction.text, "Make this feature more robust.");

  ws.send(JSON.stringify({ type: "action_send" }));
  const typed = await messages.waitFor((message) => message.type === "status" && message.status === "typed");
  assert.equal(typed.text, "Make this feature more robust.");

  assert.equal(translationRequest.url, "/chat/completions", serverOutput.join(""));
  assert.equal(translationRequest.authorization, "Bearer translation-key");
  assert.equal(translationRequest.body.messages[1].content, "帮我把这个功能做得更稳一点");
});

test("server can send bilingual Chinese and English translation text", async (t) => {
  const port = await getFreePort();
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-translation-bilingual-"));
  const translationServer = createHttpServer((req, res) => {
    req.resume();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      choices: [
        {
          message: {
            content: "Make this feature more robust."
          }
        }
      ]
    }));
  });

  await new Promise((resolve, reject) => {
    translationServer.once("error", reject);
    translationServer.listen(0, "127.0.0.1", resolve);
  });
  const translationPort = translationServer.address().port;

  const server = spawn(process.execPath, ["src/server.mjs"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      APPDATA: appDataRoot,
      LAN_SHARED_SECRET: "",
      LAN_DISCOVERY_ENABLED: "0",
      LAN_VOICE_BIND: "127.0.0.1",
      LAN_VOICE_PORT: String(port),
      MOCK_TRANSCRIPT: "帮我把这个功能做得更稳一点",
      SEND_TARGET: "text_injector",
      DRY_RUN_TEXT_INJECTION: "1",
      TRANSCRIPT_DELIVERY_MODE: "confirm_on_device",
      VOICE_TRANSLATION_ENABLED: "1",
      VOICE_TRANSLATION_SEND_BILINGUAL: "1",
      VOICE_TRANSLATION_API_KEY: "translation-key",
      VOICE_TRANSLATION_BASE_URL: `http://127.0.0.1:${translationPort}`,
      VOICE_TRANSLATION_MODEL: "deepseek-chat"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  t.after(async () => {
    await stopServer(server);
    await new Promise((resolve) => translationServer.close(resolve));
    fs.rmSync(appDataRoot, { recursive: true, force: true });
  });

  const ws = await connectWebSocket(`ws://127.0.0.1:${port}`);
  const messages = createMessageCollector(ws);
  t.after(() => closeWebSocket(ws));

  ws.send(JSON.stringify({ type: "hello", deviceId: "translation-bilingual-board" }));
  await messages.waitFor((message) => message.type === "hello_ack");
  await messages.waitFor(
    (message) =>
      message.type === "server_ready" &&
      message.voiceTranslationEnabled === true &&
      message.voiceTranslationSendBilingual === true
  );

  ws.send(JSON.stringify({ type: "ptt_start", ts: Date.now() }));
  ws.send(Buffer.from([0x00, 0x00]), { binary: true });
  ws.send(JSON.stringify({ type: "ptt_stop", ts: Date.now() }));

  const expected = "帮我把这个功能做得更稳一点\nMake this feature more robust.";
  const finalMessage = await messages.waitFor((message) => message.type === "transcript_final");
  assert.equal(finalMessage.text, expected);
  assert.equal(finalMessage.translatedText, "Make this feature more robust.");
  assert.equal(finalMessage.originalText, "帮我把这个功能做得更稳一点");
  assert.equal(finalMessage.transform, "translation");

  ws.send(JSON.stringify({ type: "action_send" }));
  const typed = await messages.waitFor((message) => message.type === "status" && message.status === "typed");
  assert.equal(typed.text, expected);
  assert.equal(typed.translatedText, "Make this feature more robust.");
});

test("server can send Chinese, English, Korean, and Japanese together", async (t) => {
  const port = await getFreePort();
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-translation-all-"));
  const translationRequests = [];
  const translations = {
    English: "Make this feature more robust.",
    Korean: "이 기능을 더 안정적으로 만들어 주세요.",
    Japanese: "この機能をもっと安定させてください。"
  };
  const translationServer = createHttpServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const parsed = JSON.parse(body);
      const prompt = parsed.messages[0].content;
      const language = Object.keys(translations).find((candidate) =>
        prompt.includes(`Target language: ${candidate}`)
      );
      translationRequests.push(language);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        choices: [
          {
            message: {
              content: translations[language]
            }
          }
        ]
      }));
    });
  });

  await new Promise((resolve, reject) => {
    translationServer.once("error", reject);
    translationServer.listen(0, "127.0.0.1", resolve);
  });
  const translationPort = translationServer.address().port;

  const server = spawn(process.execPath, ["src/server.mjs"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      APPDATA: appDataRoot,
      LAN_SHARED_SECRET: "",
      LAN_DISCOVERY_ENABLED: "0",
      LAN_VOICE_BIND: "127.0.0.1",
      LAN_VOICE_PORT: String(port),
      MOCK_TRANSCRIPT: "帮我把这个功能做得更稳一点",
      SEND_TARGET: "text_injector",
      DRY_RUN_TEXT_INJECTION: "1",
      TRANSCRIPT_DELIVERY_MODE: "confirm_on_device",
      VOICE_TRANSLATION_ENABLED: "1",
      VOICE_TRANSLATION_TARGET_LANGUAGE: "korean",
      VOICE_TRANSLATION_SEND_MODE: "all",
      VOICE_TRANSLATION_API_KEY: "translation-key",
      VOICE_TRANSLATION_BASE_URL: `http://127.0.0.1:${translationPort}`,
      VOICE_TRANSLATION_MODEL: "deepseek-chat"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  t.after(async () => {
    await stopServer(server);
    await new Promise((resolve) => translationServer.close(resolve));
    fs.rmSync(appDataRoot, { recursive: true, force: true });
  });

  const ws = await connectWebSocket(`ws://127.0.0.1:${port}`);
  const messages = createMessageCollector(ws);
  t.after(() => closeWebSocket(ws));

  ws.send(JSON.stringify({ type: "hello", deviceId: "translation-all-board" }));
  await messages.waitFor((message) => message.type === "hello_ack");
  await messages.waitFor(
    (message) =>
      message.type === "server_ready" &&
      message.voiceTranslationEnabled === true &&
      message.voiceTranslationTargetLanguage === "korean" &&
      message.voiceTranslationSendMode === "all" &&
      message.voiceTranslationSendBilingual === true
  );

  ws.send(JSON.stringify({ type: "ptt_start", ts: Date.now() }));
  ws.send(Buffer.from([0x00, 0x00]), { binary: true });
  ws.send(JSON.stringify({ type: "ptt_stop", ts: Date.now() }));

  const expected = [
    "帮我把这个功能做得更稳一点",
    "Make this feature more robust.",
    "이 기능을 더 안정적으로 만들어 주세요.",
    "この機能をもっと安定させてください。"
  ].join("\n");
  const finalMessage = await messages.waitFor((message) => message.type === "transcript_final");
  assert.equal(finalMessage.text, expected);
  assert.equal(finalMessage.translatedText, "이 기능을 더 안정적으로 만들어 주세요.");
  assert.equal(finalMessage.originalText, "帮我把这个功能做得更稳一点");
  assert.equal(finalMessage.transform, "translation");
  assert.deepEqual(new Set(translationRequests), new Set(["English", "Korean", "Japanese"]));

  ws.send(JSON.stringify({ type: "action_send" }));
  const typed = await messages.waitFor((message) => message.type === "status" && message.status === "typed");
  assert.equal(typed.text, expected);
  assert.equal(typed.translatedText, "이 기능을 더 안정적으로 만들어 주세요.");
});

test("server falls back to original transcript when voice translation fails", async (t) => {
  const port = await getFreePort();
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-translation-fallback-"));
  const translationServer = createHttpServer((req, res) => {
    req.resume();
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "temporary outage" }));
  });

  await new Promise((resolve, reject) => {
    translationServer.once("error", reject);
    translationServer.listen(0, "127.0.0.1", resolve);
  });
  const translationPort = translationServer.address().port;

  const server = spawn(process.execPath, ["src/server.mjs"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      APPDATA: appDataRoot,
      LAN_SHARED_SECRET: "",
      LAN_DISCOVERY_ENABLED: "0",
      LAN_VOICE_BIND: "127.0.0.1",
      LAN_VOICE_PORT: String(port),
      MOCK_TRANSCRIPT: "继续测试这个功能",
      SEND_TARGET: "text_injector",
      DRY_RUN_TEXT_INJECTION: "1",
      TRANSCRIPT_DELIVERY_MODE: "confirm_on_device",
      VOICE_TRANSLATION_ENABLED: "1",
      VOICE_TRANSLATION_API_KEY: "translation-key",
      VOICE_TRANSLATION_BASE_URL: `http://127.0.0.1:${translationPort}`,
      VOICE_TRANSLATION_MODEL: "deepseek-chat"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  t.after(async () => {
    await stopServer(server);
    await new Promise((resolve) => translationServer.close(resolve));
    fs.rmSync(appDataRoot, { recursive: true, force: true });
  });

  const ws = await connectWebSocket(`ws://127.0.0.1:${port}`);
  const messages = createMessageCollector(ws);
  t.after(() => closeWebSocket(ws));

  ws.send(JSON.stringify({ type: "hello", deviceId: "translation-fallback-board" }));
  await messages.waitFor((message) => message.type === "hello_ack");
  await messages.waitFor(
    (message) => message.type === "server_ready" && message.voiceTranslationEnabled === true
  );

  ws.send(JSON.stringify({ type: "ptt_start", ts: Date.now() }));
  ws.send(Buffer.from([0x00, 0x00]), { binary: true });
  ws.send(JSON.stringify({ type: "ptt_stop", ts: Date.now() }));

  await messages.waitFor(
    (message) => message.type === "status" && message.status === "translating" && /继续测试/.test(message.text)
  );
  const warning = await messages.waitFor(
    (message) => message.type === "warning" && /Translation failed/.test(message.warning)
  );
  assert.match(warning.warning, /voice_translation_http_500/);

  const finalMessage = await messages.waitFor((message) => message.type === "transcript_final");
  assert.equal(finalMessage.text, "继续测试这个功能");
  assert.equal(finalMessage.originalText, "继续测试这个功能");
  assert.equal(finalMessage.transform, "none");
  assert.equal(finalMessage.requiresAction, true);
});

test("Xiaomi remote preview: segments append, undo pops last, double-click discards all", async (t) => {
  const port = await getFreePort();
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-xiaomi-preview-append-"));
  const server = spawn(process.execPath, ["src/server.mjs"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      APPDATA: appDataRoot,
      LAN_SHARED_SECRET: "",
      LAN_DISCOVERY_ENABLED: "0",
      LAN_VOICE_BIND: "127.0.0.1",
      LAN_VOICE_PORT: String(port),
      MOCK_TRANSCRIPT: "第一句",
      SEND_TARGET: "text_injector",
      DRY_RUN_TEXT_INJECTION: "1",
      TRANSCRIPT_DELIVERY_MODE: "confirm_on_device"
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

  const press = (button, code) => {
    ws.send(JSON.stringify({ type: "remote_button", button, code, pressed: true, ts: Date.now() }));
    ws.send(JSON.stringify({ type: "remote_button", button, code, pressed: false, ts: Date.now() }));
  };
  const dictate = async () => {
    ws.send(JSON.stringify({ type: "ptt_start", source: "xiaomi_remote", ts: Date.now() }));
    ws.send(Buffer.from([0x00, 0x00]), { binary: true });
    ws.send(JSON.stringify({ type: "ptt_stop", source: "xiaomi_remote", ts: Date.now() }));
    await messages.waitFor((message) => message.type === "status" && message.status === "awaiting_action");
  };

  ws.send(JSON.stringify({ type: "hello", deviceId: "xiaomi-test", boardType: "xiaomi-remote-msbc" }));
  await messages.waitFor((message) => message.type === "hello_ack");

  // Two dictations accumulate into one preview.
  await dictate();
  const firstSegment = await messages.waitFor(
    (message) => message.type === "transcript_final" && message.text === "第一句"
  );
  assert.equal(firstSegment.requiresAction, true);
  await dictate();
  const appended = await messages.waitFor(
    (message) => message.type === "transcript_final" && message.text === "第一句 第一句"
  );
  assert.equal(appended.requiresAction, true);

  // Single Back click pops only the last segment (waits out the double window).
  press("back", 0xf1);
  const afterUndo = await messages.waitFor(
    (message) => message.type === "transcript_final" && message.text === "第一句"
  );
  assert.equal(afterUndo.requiresAction, true);
  assert.equal(serverOutput.join("").includes("[inject] dry-run"), false, "undo must not inject");

  // Double-click Back discards the whole preview.
  press("back", 0xf1);
  await sleep(60);
  press("back", 0xf1);
  await messages.waitFor((message) => message.type === "status" && message.status === "cancelled");

  // Everything is gone: OK now falls back to its normal Enter mapping.
  press("ok", 0x28);
  await sleep(400);
  assert.equal(serverOutput.join("").includes("第一句"), false, "discarded segments must never inject");
});
