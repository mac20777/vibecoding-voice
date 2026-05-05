import fs from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

import { WebSocketServer, WebSocket } from "ws";

import { createCliView, formatCodexEvent, pushLogLine, summarizeAssistantText } from "./cli-projector.mjs";
import { readLatestRateLimits } from "./codex-rate-limits.mjs";
import { readLatestClaudeRateLimits } from "./claude-rate-limits.mjs";
import { loadConfig, writeUserConfigValues } from "./config.mjs";
import { runDoctor } from "./doctor.mjs";
import { startDiscoveryServer } from "./discovery-server.mjs";
import { isFreshTimestamp, signHelloPayload, signaturesMatch } from "./lan-auth.mjs";
import { getUserTodoListPath } from "./paths.mjs";
import { createRuntimeLogger } from "./runtime-log.mjs";
import { ClaudeSessionManager } from "./claude-session.mjs";
import { CodexSessionManager } from "./codex-session.mjs";
import { transcribePcm16Mono } from "./stt.mjs";
import { createTodoAssistant } from "./todo-assistant.mjs";
import { createTodoService, VALID_VOICE_MODES } from "./todo-service.mjs";
import { createVoiceTranslationService } from "./translation-service.mjs";
import { injectText } from "./text-injector.mjs";

const config = loadConfig();

if (process.argv.includes("--doctor")) {
  await runDoctor(config);
}

const codexSession = new CodexSessionManager(config);
const claudeSession = new ClaudeSessionManager(config);
const cliView = createCliView(config);
const todoService = createTodoService({ storagePath: getUserTodoListPath() });
const todoAssistant = createTodoAssistant(config);
let voiceTranslation = createVoiceTranslationService(config);
const recentHelloNonces = new Map();
applyRateLimitSnapshot(readLatestRateLimits());

const MIN_PLAUSIBLE_EPOCH_MS = Date.UTC(2020, 0, 1);
const VALID_SEND_TARGETS = new Set(["text_injector", "codex_exec", "claude_code"]);
const { log, logPath: runtimeLogPath } = createRuntimeLogger();

function getVoiceMode(state) {
  const mode = String(state?.voiceMode || "").trim().toLowerCase();
  return VALID_VOICE_MODES.has(mode) ? mode : "normal";
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
  console.log(`  todo       ${todoAssistant.label()}`);
  console.log(`  translate  ${voiceTranslation.label()}`);
  console.log(`  auth       ${authLabel}`);
  console.log(`  ws         ws://${config.bindHost}:${config.port}`);
  if (config.discoveryEnabled) {
    console.log(`  discovery  udp://${config.bindHost}:${config.discoveryPort}`);
  }
  console.log(`  log        ${runtimeLogPath}`);
  process.stderr.write(`  cwd        ${config.claudeCwd || process.cwd()} (VIBE_INVOKE_CWD=${process.env.VIBE_INVOKE_CWD || "(not set)"})\n`);
  console.log(`\nRun with --doctor to check your environment.\n`);
}

function getTargetLabel(sendTarget) {
  if (sendTarget === "claude_code") {
    return "Claude";
  }
  if (sendTarget === "codex_exec") {
    return "Codex";
  }
  return "";
}

function getTargetCwd(sendTarget) {
  return sendTarget === "claude_code" ? config.claudeCwd : config.codexCwd;
}

function emitServerReady(ws) {
  sendJson(ws, {
    type: "server_ready",
    textInjectionMode: config.textInjectionMode,
    transcriptDeliveryMode: config.transcriptDeliveryMode,
    sendTarget: config.sendTarget,
    voiceTranslationEnabled: voiceTranslation.isEnabled(),
    mode: getVoiceMode(ws.clientState),
    authRequired: Boolean(config.lanSharedSecret)
  });
}

function broadcastServerReady() {
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && client.clientState?.authenticated) {
      emitServerReady(client);
    }
  }
}

function applySendTarget(nextTarget) {
  if (!VALID_SEND_TARGETS.has(nextTarget)) {
    throw new Error(`unsupported send target: ${nextTarget}`);
  }

  config.sendTarget = nextTarget;
  config.sendTargetAuto = false;

  const label = getTargetLabel(nextTarget);
  const cwd = getTargetCwd(nextTarget);
  cliView.cwd = cwd;
  cliView.repoName = path.basename(cwd);
  if (!cliView.latestAssistantText) {
    cliView.statusLine = label ? `${label} idle` : "Idle";
  }

  broadcastCliState();
  broadcastCliSummary();
  broadcastServerReady();
}

function applyCliCwd(target, nextCwd) {
  const resolvedCwd = path.resolve(String(nextCwd || "").trim());
  if (!resolvedCwd || !fs.existsSync(resolvedCwd)) {
    throw new Error(`invalid_cli_cwd:${nextCwd}`);
  }

  if (target === "codex_exec") {
    config.codexCwd = resolvedCwd;
  } else if (target === "claude_code") {
    config.claudeCwd = resolvedCwd;
  } else {
    throw new Error(`unsupported_cli_cwd_target:${target}`);
  }

  if (config.sendTarget === target) {
    cliView.cwd = resolvedCwd;
    cliView.repoName = path.basename(resolvedCwd);
    if (cliView.phase === "idle") {
      const label = getTargetLabel(target);
      cliView.statusLine = label ? `${label} idle` : "Idle";
    }
    broadcastCliState();
    broadcastCliSummary();
    broadcastServerReady();
  }

  return resolvedCwd;
}

function getTodoSnapshotPayload() {
  const snapshot = todoService.getSnapshot();
  return {
    type: "todo_state",
    items: snapshot.items,
    selectedIndex: snapshot.selectedIndex,
    lastActionText: snapshot.lastActionText
  };
}

function emitModeState(ws) {
  sendJson(ws, {
    type: "mode_state",
    mode: getVoiceMode(ws.clientState)
  });
}

function emitTodoState(ws) {
  sendJson(ws, getTodoSnapshotPayload());
}

function broadcastTodoState() {
  broadcastJson(getTodoSnapshotPayload());
}

function applyVoiceMode(ws, state, nextMode) {
  if (!VALID_VOICE_MODES.has(nextMode)) {
    throw new Error(`unsupported_voice_mode:${nextMode}`);
  }
  state.voiceMode = nextMode;
  emitModeState(ws);
}

function formatTodoErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  switch (message) {
    case "todo_title_required":
      return "计划内容不能为空";
    case "todo_empty":
      return "暂无计划";
    case "todo_index_required":
      return "请先选择计划";
    case "todo_index_invalid":
      return "计划序号无效";
    case "todo_index_out_of_range":
      return "计划序号超出范围";
    case "todo_item_not_found":
      return "计划已不存在";
    default:
      return "待办操作失败";
  }
}

function sendTodoResult(ws, payload) {
  sendJson(ws, {
    type: "todo_result",
    ok: Boolean(payload?.ok),
    action: String(payload?.action || "unknown"),
    message: String(payload?.message || "")
  });
}

function clearPendingTodoIntent(state) {
  if (state?.pendingTodoTimer) {
    clearTimeout(state.pendingTodoTimer);
    state.pendingTodoTimer = null;
  }
  if (state) {
    state.pendingTodoIntent = null;
    state.pendingTodoIntentExpiresAt = 0;
  }
}

function setPendingTodoIntent(ws, state, pendingIntent) {
  if (!state) {
    return;
  }

  clearPendingTodoIntent(state);
  if (!pendingIntent) {
    return;
  }

  state.pendingTodoIntent = pendingIntent;
  state.pendingTodoIntentExpiresAt = Date.now() + config.todoFollowupTimeoutMs;
  state.pendingTodoTimer = setTimeout(() => {
    if (ws.readyState !== WebSocket.OPEN || state.pendingTodoIntent !== pendingIntent) {
      return;
    }
    clearPendingTodoIntent(state);
    sendTodoResult(ws, {
      ok: true,
      action: "cancel",
      message: "已取消待办追问"
    });
  }, config.todoFollowupTimeoutMs);
  state.pendingTodoTimer.unref?.();
}

function runTodoCommand(command, { ws = null } = {}) {
  try {
    const result = todoService.runCommand(command);
    broadcastTodoState();
    if (ws) {
      sendTodoResult(ws, result);
    }
    return result;
  } catch (error) {
    const result = {
      ok: false,
      action: String(command?.action || "unknown"),
      message: formatTodoErrorMessage(error)
    };
    if (ws) {
      sendTodoResult(ws, result);
    }
    return result;
  }
}

async function dispatchTodoPrompt(ws, prompt, state) {
  if (state?.pendingTodoIntent && state.pendingTodoIntentExpiresAt <= Date.now()) {
    clearPendingTodoIntent(state);
  }
  const outcome = await todoAssistant.interpret(prompt, {
    pendingIntent: state?.pendingTodoIntent,
    snapshot: todoService.getSnapshot()
  });
  if (state) {
    setPendingTodoIntent(ws, state, outcome.pendingIntent || null);
  }

  if (!outcome.command) {
    sendTodoResult(ws, {
      ok: outcome.ok,
      action: outcome.action || "parse",
      message: outcome.message
    });
    return;
  }
  runTodoCommand(outcome.command, { ws });
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
    voiceMode: "normal",
    segmentActive: false,
    chunks: [],
    pendingSegments: [],
    pendingOriginalSegments: [],
    pendingTranscript: "",
    pendingOriginalTranscript: "",
    pendingTransform: "none",
    pendingTodoIntent: null,
    pendingTodoIntentExpiresAt: 0,
    pendingTodoTimer: null
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
  state.pendingOriginalTranscript = joinPendingSegments(state.pendingOriginalSegments);
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
  emitModeState(ws);
  emitTodoState(ws);
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
  const voiceMode = getVoiceMode(state);

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
      text: state.pendingTranscript,
      originalText: state.pendingOriginalTranscript,
      transform: state.pendingTransform
    });
    return;
  }

  if (voiceMode === "todo") {
    sendJson(ws, {
      type: "transcript_final",
      text: transcript,
      latencyMs: Date.now() - startedAt,
      requiresAction: false
    });
    state.pendingTranscript = "";
    state.pendingSegments = [];
    state.pendingOriginalTranscript = "";
    state.pendingOriginalSegments = [];
    state.pendingTransform = "none";
    await dispatchTodoPrompt(ws, transcript, state);
    return;
  }

  const translationResult = await translateVoiceTranscript(ws, transcript);
  const translatedTranscript = translationResult.text;
  const transcriptTransform = translationResult.transform;

  if (config.transcriptDeliveryMode === "confirm_on_device") {
    state.pendingSegments.push(translatedTranscript);
    state.pendingOriginalSegments.push(transcript);
    state.pendingTransform = transcriptTransform;
    const pendingTranscript = updatePendingTranscript(state);
    sendJson(ws, {
      type: "transcript_final",
      text: pendingTranscript,
      originalText: state.pendingOriginalTranscript,
      transform: state.pendingTransform,
      latencyMs: Date.now() - startedAt,
      requiresAction: true
    });
    sendJson(ws, {
      type: "status",
      status: "awaiting_action",
      text: pendingTranscript,
      originalText: state.pendingOriginalTranscript,
      transform: state.pendingTransform
    });
    return;
  }

  sendJson(ws, {
    type: "transcript_final",
    text: translatedTranscript,
    originalText: transcript,
    transform: transcriptTransform,
    latencyMs: Date.now() - startedAt,
    requiresAction: false
  });

  if (config.sendTarget === "codex_exec") {
    if (codexSession.isRunning()) {
      throw new Error("Codex session is busy");
    }
    state.pendingTranscript = "";
    sendJson(ws, {
      type: "status",
      status: "typed",
      text: translatedTranscript,
      originalText: transcript,
      transform: transcriptTransform
    });
    launchCodexPrompt(translatedTranscript);
    return;
  }

  if (config.sendTarget === "claude_code") {
    if (claudeSession.isRunning()) {
      throw new Error("Claude session is busy");
    }
    state.pendingTranscript = "";
    sendJson(ws, {
      type: "status",
      status: "typed",
      text: translatedTranscript,
      originalText: transcript,
      transform: transcriptTransform
    });
    launchClaudePrompt(translatedTranscript);
    return;
  }

  await dispatchPrompt(translatedTranscript);
  state.pendingTranscript = "";
  sendJson(ws, {
    type: "status",
    status: "typed",
    text: translatedTranscript,
    originalText: transcript,
    transform: transcriptTransform
  });
}

function emitVoiceTranslationState(ws) {
  sendJson(ws, {
    type: "voice_translation_state",
    enabled: voiceTranslation.isEnabled()
  });
}

function applyVoiceTranslationEnabled(enabled, { persist = false } = {}) {
  if (enabled && !config.voiceTranslationApiKey) {
    throw new Error("voice_translation_api_key_missing");
  }

  config.voiceTranslationEnabled = Boolean(enabled);
  voiceTranslation = createVoiceTranslationService(config);

  if (persist) {
    writeUserConfigValues({
      VOICE_TRANSLATION_ENABLED: config.voiceTranslationEnabled ? "1" : null
    });
  }

  broadcastServerReady();
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && client.clientState?.authenticated) {
      emitVoiceTranslationState(client);
    }
  }
}

async function translateVoiceTranscript(ws, transcript) {
  if (!voiceTranslation.isEnabled()) {
    return { text: transcript, transform: "none" };
  }

  sendJson(ws, { type: "status", status: "translating", text: transcript });
  try {
    const translated = await voiceTranslation.translate(transcript);
    log("voice translation", {
      from: transcript.slice(0, 80),
      to: translated.slice(0, 80)
    });
    return { text: translated, transform: "translation" };
  } catch (error) {
    const warning = error instanceof Error ? error.message : String(error);
    log("voice translation error", warning);
    sendJson(ws, { type: "warning", warning: `Translation failed: ${warning}` });
    return { text: transcript, transform: "none" };
  }
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

async function dispatchUserPrompt(ws, prompt, state) {
  if (getVoiceMode(state) === "todo") {
    await dispatchTodoPrompt(ws, prompt, state);
    return "todo";
  }

  await dispatchPrompt(prompt);
  return "normal";
}

async function sendPendingTranscript(ws, state) {
  const transcript = String(state.pendingTranscript || "").trim();
  const voiceMode = getVoiceMode(state);
  if (!transcript) {
    sendJson(ws, { type: "status", status: "no_pending" });
    return;
  }

  if (voiceMode !== "todo" && config.sendTarget === "codex_exec" && codexSession.isRunning()) {
    sendJson(ws, { type: "status", status: "cli_busy" });
    return;
  }

  if (voiceMode !== "todo" && config.sendTarget === "claude_code" && claudeSession.isRunning()) {
    sendJson(ws, { type: "status", status: "cli_busy" });
    return;
  }

  state.pendingTranscript = "";
  state.pendingSegments = [];
  const originalTranscript = String(state.pendingOriginalTranscript || "").trim();
  const transform = String(state.pendingTransform || "none").trim() || "none";
  state.pendingOriginalTranscript = "";
  state.pendingOriginalSegments = [];
  state.pendingTransform = "none";
  if (voiceMode === "todo") {
    await dispatchTodoPrompt(ws, transcript, state);
    return;
  }

  sendJson(ws, {
    type: "status",
    status: "typed",
    text: transcript,
    originalText: originalTranscript,
    transform
  });
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
  state.pendingOriginalSegments.pop();
  const transcript = updatePendingTranscript(state);
  if (transcript) {
    sendJson(ws, {
      type: "status",
      status: "awaiting_action",
      text: transcript,
      originalText: state.pendingOriginalTranscript,
      transform: state.pendingTransform
    });
    return;
  }

  state.pendingOriginalTranscript = "";
  state.pendingTransform = "none";
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
          emitServerReady(ws);
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
        case "set_target": {
          if (!state.authenticated) {
            closeWithAuthError(ws, state, "auth_required");
            break;
          }
          const nextTarget = String(message.sendTarget || "").trim();
          if (!VALID_SEND_TARGETS.has(nextTarget)) {
            sendJson(ws, { type: "warning", warning: "invalid_send_target" });
            break;
          }
          if (codexSession.isRunning() || claudeSession.isRunning()) {
            sendJson(ws, { type: "status", status: "cli_busy" });
            break;
          }
          if (config.sendTarget !== nextTarget) {
            log("set_target", state.deviceId, nextTarget);
            applySendTarget(nextTarget);
          } else {
            emitServerReady(ws);
          }
          break;
        }
        case "set_voice_translation": {
          if (!state.authenticated) {
            closeWithAuthError(ws, state, "auth_required");
            break;
          }
          const requested = message.enabled;
          const nextEnabled =
            requested === "toggle" ? !voiceTranslation.isEnabled() : requested === true;
          try {
            applyVoiceTranslationEnabled(nextEnabled, { persist: true });
            log("set_voice_translation", state.deviceId, nextEnabled);
          } catch (error) {
            const warning = error instanceof Error ? error.message : String(error);
            sendJson(ws, { type: "warning", warning });
            emitVoiceTranslationState(ws);
          }
          break;
        }
        case "set_cli_cwd": {
          if (!state.authenticated) {
            closeWithAuthError(ws, state, "auth_required");
            break;
          }
          const target = String(message.sendTarget || "").trim();
          const nextCwd = String(message.cwd || "").trim();
          if (!(target === "codex_exec" || target === "claude_code")) {
            sendJson(ws, { type: "warning", warning: "invalid_cli_cwd_target" });
            break;
          }
          if (!nextCwd) {
            sendJson(ws, { type: "warning", warning: "cli_cwd_empty" });
            break;
          }
          try {
            const resolvedCwd = applyCliCwd(target, nextCwd);
            log("set_cli_cwd", state.deviceId, target, resolvedCwd);
            sendJson(ws, {
              type: "cli_cwd_updated",
              sendTarget: target,
              cwd: resolvedCwd
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            sendJson(ws, { type: "warning", warning: message });
          }
          break;
        }
        case "set_mode": {
          if (!state.authenticated) {
            closeWithAuthError(ws, state, "auth_required");
            break;
          }
          const nextMode = String(message.mode || "").trim().toLowerCase();
          if (!VALID_VOICE_MODES.has(nextMode)) {
            sendJson(ws, { type: "warning", warning: "invalid_voice_mode" });
            break;
          }
          if (getVoiceMode(state) !== nextMode) {
            log("set_mode", state.deviceId, nextMode);
            if (nextMode !== "todo") {
              clearPendingTodoIntent(state);
            }
            applyVoiceMode(ws, state, nextMode);
          } else {
            emitModeState(ws);
          }
          break;
        }
        case "todo_command": {
          if (!state.authenticated) {
            closeWithAuthError(ws, state, "auth_required");
            break;
          }
          const action = String(message.action || "").trim().toLowerCase();
          if (!action) {
            sendTodoResult(ws, {
              ok: false,
              action: "unknown",
              message: "缺少待办操作"
            });
            break;
          }
          log("todo_command", state.deviceId, action);
          clearPendingTodoIntent(state);
          runTodoCommand(
            {
              action,
              id: message.id,
              index: message.index,
              text: message.text,
              completed: message.completed
            },
            { ws }
          );
          break;
        }
        case "prompt": {
          if (!state.authenticated) { closeWithAuthError(ws, state, "auth_required"); break; }
          const promptText = String(message.text || "").trim();
          if (!promptText) { sendJson(ws, { type: "warning", warning: "prompt_empty" }); break; }
          log("prompt (console)", state.deviceId, promptText.slice(0, 80));
          if (getVoiceMode(state) === "normal") {
            if (config.sendTarget === "claude_code" && claudeSession.isRunning()) {
              sendJson(ws, { type: "status", status: "cli_busy" });
              break;
            }
            if (config.sendTarget === "codex_exec" && codexSession.isRunning()) {
              sendJson(ws, { type: "status", status: "cli_busy" });
              break;
            }
          }
          void dispatchUserPrompt(ws, promptText, state).then((route) => {
            if (route === "normal") {
              sendJson(ws, { type: "status", status: "typed", text: promptText });
            }
          }).catch((e) => {
            const msg = e instanceof Error ? e.message : String(e);
            appendCliLog(`error: ${msg}`);
            setCliState({ phase: "error", statusLine: msg });
          });
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
    clearPendingTodoIntent(state);
    log("client disconnected", state.deviceId);
  });

  ws.on("error", (error) => {
    log("ws error", state.deviceId, error.message);
  });
});

server.listen(config.port, config.bindHost, () => {
  printBanner();
  log("runtime log", runtimeLogPath);
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
