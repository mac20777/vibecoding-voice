import fs from "node:fs";
import { createServer } from "node:http";

import { WebSocketServer, WebSocket } from "ws";

import { createCliView, formatCodexEvent, pushLogLine, summarizeAssistantText } from "./cli-projector.mjs";
import { readLatestRateLimits } from "./codex-rate-limits.mjs";
import { readLatestClaudeRateLimits } from "./claude-rate-limits.mjs";
import { loadConfig } from "./config.mjs";
import { runDoctor } from "./doctor.mjs";
import { startDiscoveryServer } from "./discovery-server.mjs";
import { isFreshTimestamp, signHelloPayload, signaturesMatch } from "./lan-auth.mjs";
import { ClaudeSessionManager } from "./claude-session.mjs";
import { CodexSessionManager } from "./codex-session.mjs";
import { transcribePcm16Mono } from "./stt.mjs";
import { injectText } from "./text-injector.mjs";

const config = loadConfig();

if (process.argv.includes("--doctor")) {
  await runDoctor(config);
}

const codexSession = new CodexSessionManager(config);
const claudeSession = new ClaudeSessionManager(config);
const cliView = createCliView(config);
const recentHelloNonces = new Map();
applyRateLimitSnapshot(readLatestRateLimits());

const MIN_PLAUSIBLE_EPOCH_MS = Date.UTC(2020, 0, 1);

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function printBanner() {
  let version = "?";
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    version = pkg.version || version;
  } catch {
    // ignore
  }

  const sttLabel = config.mockTranscript
    ? "mock"
    : config.sttProvider ||
      (config.openaiApiKey ? `openai · ${config.openaiModel}` : "") ||
      (config.volcengineAppKey ? `volcengine · ${config.volcengineLanguage}` : "") ||
      "\x1b[33mnone — set OPENAI_API_KEY or VOLCENGINE_APP_KEY\x1b[0m";

  const targetLabel =
    config.sendTarget + (config.sendTargetAuto ? " \x1b[2m[auto]\x1b[0m" : "");

  const authLabel = config.lanSharedSecret
    ? "\x1b[32mon\x1b[0m"
    : "\x1b[33moff\x1b[0m (set LAN_SHARED_SECRET to enable)";

  console.log(`\nvibecoding-voice v${version}`);
  console.log(`  target     ${targetLabel}`);
  console.log(`  stt        ${sttLabel}`);
  console.log(`  auth       ${authLabel}`);
  console.log(`  ws         ws://${config.bindHost}:${config.port}`);
  if (config.discoveryEnabled) {
    console.log(`  discovery  udp://${config.bindHost}:${config.discoveryPort}`);
  }
  process.stderr.write(`  cwd        ${config.claudeCwd || process.cwd()} (VIBE_INVOKE_CWD=${process.env.VIBE_INVOKE_CWD || "(not set)"})\n`);
  console.log(`\nRun with --doctor to check your environment.\n`);
}

function sendJson(ws, payload) {
  ws.send(JSON.stringify(payload));
}

function broadcastJson(payload) {
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && client.clientState?.authenticated) {
      sendJson(client, payload);
    }
  }
}

function createClientState() {
  return {
    deviceId: "unknown",
    authenticated: !config.lanSharedSecret,
    segmentActive: false,
    chunks: [],
    pendingSegments: [],
    pendingTranscript: ""
  };
}

function joinPendingSegments(segments) {
  const normalized = segments
    .map((segment) => String(segment || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return normalized.reduce((combined, segment) => {
    if (!combined) {
      return segment;
    }

    const endsWithPunctuation = /[。！？!?；;：:，,、.]$/.test(combined);
    const startsWithPunctuation = /^[。！？!?；;：:，,、.]/.test(segment);
    return combined + (endsWithPunctuation || startsWithPunctuation ? "" : " ") + segment;
  }, "");
}

function updatePendingTranscript(state) {
  state.pendingTranscript = joinPendingSegments(state.pendingSegments);
  return state.pendingTranscript;
}

function emitCliSnapshot(ws) {
  sendJson(ws, {
    type: "cli_session_state",
    phase: cliView.phase,
    statusLine: cliView.statusLine,
    threadId: cliView.threadId,
    repoName: cliView.repoName,
    cwd: cliView.cwd,
    quota5hRemainingPct: cliView.quota5hRemainingPct,
    quotaWeekRemainingPct: cliView.quotaWeekRemainingPct,
    quotaPlanType: cliView.quotaPlanType
  });
  sendJson(ws, {
    type: "cli_summary",
    latestUserText: cliView.latestUserText,
    latestAssistantText: cliView.latestAssistantText,
    statusLine: cliView.statusLine,
    threadId: cliView.threadId,
    repoName: cliView.repoName
  });
  sendJson(ws, {
    type: "cli_log_tail",
    lines: cliView.logLines
  });
}

function broadcastCliState() {
  broadcastJson({
    type: "cli_session_state",
    phase: cliView.phase,
    statusLine: cliView.statusLine,
    threadId: cliView.threadId,
    repoName: cliView.repoName,
    cwd: cliView.cwd,
    quota5hRemainingPct: cliView.quota5hRemainingPct,
    quotaWeekRemainingPct: cliView.quotaWeekRemainingPct,
    quotaPlanType: cliView.quotaPlanType
  });
}

function broadcastCliSummary() {
  broadcastJson({
    type: "cli_summary",
    latestUserText: cliView.latestUserText,
    latestAssistantText: cliView.latestAssistantText,
    statusLine: cliView.statusLine,
    threadId: cliView.threadId,
    repoName: cliView.repoName
  });
}

function broadcastCliLogTail() {
  broadcastJson({
    type: "cli_log_tail",
    lines: cliView.logLines
  });
}

function appendCliLog(line) {
  cliView.logLines = pushLogLine(cliView.logLines, line);
  broadcastCliLogTail();
}

function setCliState(patch) {
  Object.assign(cliView, patch);
  broadcastCliState();
}

function setCliSummary(patch) {
  Object.assign(cliView, patch);
  broadcastCliSummary();
}

function applyRateLimitSnapshot(snapshot) {
  if (!snapshot) {
    return;
  }

  cliView.quota5hRemainingPct = snapshot.primaryRemainingPct;
  cliView.quotaWeekRemainingPct = snapshot.secondaryRemainingPct;
  cliView.quotaPlanType = snapshot.planType || cliView.quotaPlanType || "";
}

function refreshRateLimits(threadId = "") {
  const snapshot =
    config.sendTarget === "claude_code"
      ? readLatestClaudeRateLimits()
      : readLatestRateLimits(threadId || cliView.threadId);
  if (!snapshot) {
    return;
  }

  applyRateLimitSnapshot(snapshot);
  broadcastCliState();
}

function pruneRecentHelloNonces(nowMs = Date.now()) {
  const ttlMs = Math.max(1, config.lanAuthWindowSec) * 1000;
  for (const [key, seenAtMs] of recentHelloNonces.entries()) {
    if (nowMs - seenAtMs > ttlMs) {
      recentHelloNonces.delete(key);
    }
  }
}

function markHelloNonce(deviceId, nonce, nowMs = Date.now()) {
  pruneRecentHelloNonces(nowMs);
  const cacheKey = `${deviceId}:${nonce}`;
  if (recentHelloNonces.has(cacheKey)) {
    return false;
  }

  recentHelloNonces.set(cacheKey, nowMs);
  return true;
}

function shouldCheckTimestampFreshness(ts) {
  const numericTs = Number(ts);
  return Number.isFinite(numericTs) && numericTs >= MIN_PLAUSIBLE_EPOCH_MS;
}

function closeWithAuthError(ws, state, error) {
  const message = String(error || "auth_failed");
  state.authenticated = false;
  sendJson(ws, { type: "error", error: message });
  ws.close(4001, message);
}

function validateHello(message, remoteAddress) {
  if (!config.lanSharedSecret) {
    return { ok: true };
  }

  // Localhost connections bypass HMAC — allows terminal/browser console on same machine
  const addr = String(remoteAddress || "");
  if (addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1") {
    return { ok: true };
  }

  const ts = message.authTs;
  const deviceId = message.deviceId || "unknown";
  const nonce = String(message.authNonce || "").trim();
  const actualSig = String(message.authSig || "").trim();
  if (!nonce || !actualSig) {
    return { ok: false, error: "auth_missing" };
  }
  if (shouldCheckTimestampFreshness(ts) && !isFreshTimestamp(ts, config.lanAuthWindowSec)) {
    return { ok: false, error: "auth_stale" };
  }

  const expectedSig = signHelloPayload(
    {
      deviceId,
      boardType: message.boardType || "unknown",
      ts,
      nonce
    },
    config.lanSharedSecret
  );

  if (!signaturesMatch(expectedSig, actualSig)) {
    return { ok: false, error: "auth_invalid" };
  }

  if (!markHelloNonce(deviceId, nonce)) {
    return { ok: false, error: "auth_replayed" };
  }

  return { ok: true };
}

async function runCodexPrompt(prompt) {
  cliView.latestUserText = prompt;
  cliView.latestAssistantText = "";
  setCliState({
    phase: "running",
    statusLine: "Running Codex...",
    threadId: codexSession.getThreadId()
  });
  broadcastCliSummary();
  appendCliLog(`user: ${summarizeAssistantText(prompt)}`);

  await codexSession.sendPrompt(prompt, {
    onState(patch) {
      setCliState(patch);
    },
    onSummary(patch) {
      setCliSummary({
        ...patch,
        latestAssistantText: summarizeAssistantText(patch.latestAssistantText)
      });
    },
    onEvent(event) {
      appendCliLog(formatCodexEvent(event));
      if (event.type === "thread.started" && event.thread_id) {
        cliView.threadId = String(event.thread_id);
        broadcastCliState();
        broadcastCliSummary();
      }
    },
    onLogLine(line) {
      appendCliLog(line);
    }
  });

  refreshRateLimits(codexSession.getThreadId());
}

function launchCodexPrompt(prompt) {
  void runCodexPrompt(prompt).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    log("codex error", message);
    appendCliLog(`error: ${message}`);
    setCliState({
      phase: "error",
      statusLine: message,
      threadId: codexSession.getThreadId()
    });
  });
}

async function runClaudePrompt(prompt) {
  cliView.latestUserText = prompt;
  cliView.latestAssistantText = "";
  setCliState({
    phase: "running",
    statusLine: "Running Claude...",
    threadId: claudeSession.getThreadId()
  });
  broadcastCliSummary();
  appendCliLog(`user: ${summarizeAssistantText(prompt)}`);

  await claudeSession.sendPrompt(prompt, {
    onState(patch) {
      setCliState(patch);
    },
    onSummary(patch) {
      setCliSummary({
        ...patch,
        latestAssistantText: summarizeAssistantText(patch.latestAssistantText)
      });
    },
    onEvent(event) {
      appendCliLog(formatCodexEvent(event));
    },
    onLogLine(line) {
      appendCliLog(line);
    }
  });

  refreshRateLimits();
}

function launchClaudePrompt(prompt) {
  void runClaudePrompt(prompt).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    log("claude error", message);
    appendCliLog(`error: ${message}`);
    setCliState({
      phase: "error",
      statusLine: message,
      threadId: claudeSession.getThreadId()
    });
  });
}

async function finalizeSegment(ws, state) {
  const pcmBuffer = Buffer.concat(state.chunks);
  state.segmentActive = false;
  state.chunks = [];

  if (pcmBuffer.length === 0) {
    sendJson(ws, { type: "status", status: "empty_segment" });
    return;
  }

  sendJson(ws, {
    type: "status",
    status: "transcribing",
    bytes: pcmBuffer.length
  });

  const startedAt = Date.now();
  const transcript = String(await transcribePcm16Mono({ pcmBuffer, config }) || "").trim();
  const hadPendingTranscript = Boolean(String(state.pendingTranscript || "").trim());

  if (!transcript) {
    sendJson(ws, {
      type: "status",
      status: hadPendingTranscript ? "empty_segment" : "transcript_empty",
      text: state.pendingTranscript
    });
    return;
  }

  if (config.transcriptDeliveryMode === "confirm_on_device") {
    state.pendingSegments.push(transcript);
    const pendingTranscript = updatePendingTranscript(state);
    sendJson(ws, {
      type: "transcript_final",
      text: pendingTranscript,
      latencyMs: Date.now() - startedAt,
      requiresAction: true
    });
    sendJson(ws, { type: "status", status: "awaiting_action", text: pendingTranscript });
    return;
  }

  sendJson(ws, {
    type: "transcript_final",
    text: transcript,
    latencyMs: Date.now() - startedAt,
    requiresAction: false
  });

  if (config.sendTarget === "codex_exec") {
    if (codexSession.isRunning()) {
      throw new Error("Codex session is busy");
    }
    state.pendingTranscript = "";
    sendJson(ws, { type: "status", status: "typed", text: transcript });
    launchCodexPrompt(transcript);
    return;
  }

  if (config.sendTarget === "claude_code") {
    if (claudeSession.isRunning()) {
      throw new Error("Claude session is busy");
    }
    state.pendingTranscript = "";
    sendJson(ws, { type: "status", status: "typed", text: transcript });
    launchClaudePrompt(transcript);
    return;
  }

  await dispatchPrompt(transcript);
  state.pendingTranscript = "";
  sendJson(ws, { type: "status", status: "typed", text: transcript });
}

async function dispatchPrompt(prompt) {
  if (config.sendTarget === "codex_exec") {
    if (codexSession.isRunning()) {
      throw new Error("Codex session is busy");
    }
    await runCodexPrompt(prompt);
    return;
  }

  if (config.sendTarget === "claude_code") {
    if (claudeSession.isRunning()) {
      throw new Error("Claude session is busy");
    }
    await runClaudePrompt(prompt);
    return;
  }

  await injectText(prompt, config.textInjectionMode, {
    dryRun: config.dryRunTextInjection
  });
}

async function sendPendingTranscript(ws, state) {
  const transcript = String(state.pendingTranscript || "").trim();
  if (!transcript) {
    sendJson(ws, { type: "status", status: "no_pending" });
    return;
  }

  if (config.sendTarget === "codex_exec" && codexSession.isRunning()) {
    sendJson(ws, { type: "status", status: "cli_busy" });
    return;
  }

  if (config.sendTarget === "claude_code" && claudeSession.isRunning()) {
    sendJson(ws, { type: "status", status: "cli_busy" });
    return;
  }

  state.pendingTranscript = "";
  state.pendingSegments = [];
  sendJson(ws, { type: "status", status: "typed", text: transcript });
  if (config.sendTarget === "codex_exec") {
    launchCodexPrompt(transcript);
    return;
  }

  if (config.sendTarget === "claude_code") {
    launchClaudePrompt(transcript);
    return;
  }

  await dispatchPrompt(transcript);
}

function undoPendingTranscript(ws, state) {
  if (state.pendingSegments.length === 0) {
    sendJson(ws, { type: "status", status: "no_pending" });
    return;
  }

  state.pendingSegments.pop();
  const transcript = updatePendingTranscript(state);
  if (transcript) {
    sendJson(ws, { type: "status", status: "awaiting_action", text: transcript });
    return;
  }

  sendJson(ws, { type: "transcript_cleared" });
  sendJson(ws, { type: "status", status: "undo_ok" });
}

const KEEPALIVE_INTERVAL_MS = 30_000;
const KEEPALIVE_MISS_LIMIT = 2;

const server = createServer();
const wss = new WebSocketServer({ server });
const discoveryServer = startDiscoveryServer(config, { log });

const keepaliveInterval = setInterval(() => {
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) {
      continue;
    }
    if ((client.missedPings || 0) >= KEEPALIVE_MISS_LIMIT) {
      log("keepalive timeout", client.clientState?.deviceId || "unknown");
      client.terminate();
      continue;
    }
    client.missedPings = (client.missedPings || 0) + 1;
    client.ping();
  }
}, KEEPALIVE_INTERVAL_MS);

wss.on("connection", (ws, req) => {
  const state = createClientState();
  ws.clientState = state;
  ws.missedPings = 0;
  ws.on("pong", () => {
    ws.missedPings = 0;
  });
  log("client connected", req.socket.remoteAddress);

  ws.on("message", async (data, isBinary) => {
    try {
      if (!state.authenticated && isBinary) {
        closeWithAuthError(ws, state, "auth_required");
        return;
      }

      if (isBinary) {
        if (state.segmentActive) {
          state.chunks.push(Buffer.from(data));
        }
        return;
      }

      const message = JSON.parse(Buffer.from(data).toString("utf8"));
      switch (message.type) {
        case "hello":
          state.deviceId = message.deviceId || "unknown";
          {
            const authResult = validateHello(message, req.socket.remoteAddress);
            if (!authResult.ok) {
              log("auth rejected", { deviceId: state.deviceId, error: authResult.error });
              closeWithAuthError(ws, state, authResult.error);
              break;
            }
          }
          state.authenticated = true;
          log("hello", { deviceId: state.deviceId, boardType: message.boardType || "unknown" });
          sendJson(ws, { type: "hello_ack", deviceId: state.deviceId });
          sendJson(ws, {
            type: "server_ready",
            textInjectionMode: config.textInjectionMode,
            transcriptDeliveryMode: config.transcriptDeliveryMode,
            sendTarget: config.sendTarget,
            authRequired: Boolean(config.lanSharedSecret)
          });
          emitCliSnapshot(ws);
          break;
        case "ptt_start":
          if (!state.authenticated) {
            closeWithAuthError(ws, state, "auth_required");
            break;
          }
          log("ptt_start", state.deviceId);
          state.segmentActive = true;
          state.chunks = [];
          sendJson(ws, { type: "status", status: "recording" });
          break;
        case "ptt_stop":
          if (!state.authenticated) {
            closeWithAuthError(ws, state, "auth_required");
            break;
          }
          log("ptt_stop", state.deviceId, state.chunks.length);
          await finalizeSegment(ws, state);
          break;
        case "action_send":
          if (!state.authenticated) {
            closeWithAuthError(ws, state, "auth_required");
            break;
          }
          log("action_send", state.deviceId);
          await sendPendingTranscript(ws, state);
          break;
        case "action_undo":
          if (!state.authenticated) {
            closeWithAuthError(ws, state, "auth_required");
            break;
          }
          log("action_undo", state.deviceId);
          undoPendingTranscript(ws, state);
          break;
        case "prompt": {
          if (!state.authenticated) { closeWithAuthError(ws, state, "auth_required"); break; }
          const promptText = String(message.text || "").trim();
          if (!promptText) { sendJson(ws, { type: "warning", warning: "prompt_empty" }); break; }
          log("prompt (console)", state.deviceId, promptText.slice(0, 80));
          if (config.sendTarget === "claude_code") {
            if (claudeSession.isRunning()) { sendJson(ws, { type: "status", status: "cli_busy" }); break; }
            launchClaudePrompt(promptText);
          } else if (config.sendTarget === "codex_exec") {
            if (codexSession.isRunning()) { sendJson(ws, { type: "status", status: "cli_busy" }); break; }
            launchCodexPrompt(promptText);
          } else {
            void dispatchPrompt(promptText).catch((e) => {
              const msg = e instanceof Error ? e.message : String(e);
              appendCliLog(`error: ${msg}`); setCliState({ phase: "error", statusLine: msg });
            });
          }
          sendJson(ws, { type: "status", status: "typed", text: promptText });
          break;
        }
        case "ping":
          sendJson(ws, { type: "pong", nowMs: Date.now() });
          break;
        default:
          sendJson(ws, { type: "warning", warning: `unknown_message_type:${message.type}` });
          break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("message error", message);
      sendJson(ws, { type: "error", error: message });
      const activeSession =
        config.sendTarget === "claude_code" ? claudeSession : codexSession;
      appendCliLog(`error: ${message}`);
      setCliState({
        phase: "error",
        statusLine: message,
        threadId: activeSession.getThreadId()
      });
    }
  });

  ws.on("close", () => {
    log("client disconnected", state.deviceId);
  });

  ws.on("error", (error) => {
    log("ws error", state.deviceId, error.message);
  });
});

server.listen(config.port, config.bindHost, () => {
  printBanner();
  log(`server ready`);
});

function shutdown() {
  log("shutting down");
  clearInterval(keepaliveInterval);
  discoveryServer?.close();
  for (const client of wss.clients) {
    client.terminate();
  }
  wss.close();
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
