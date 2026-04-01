#!/usr/bin/env node
/**
 * Terminal console client for vibecoding-voice.
 * Connects to the local WebSocket server and shows real-time state + accepts typed prompts.
 *
 * Usage: node scripts/console.mjs
 *        npm run console
 */

import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import * as readline from "node:readline";

const PORT = process.env.LAN_VOICE_PORT || 8765;
const WS_URL = `ws://127.0.0.1:${PORT}`;

// ── ANSI helpers ────────────────────────────────────────────────────────────
const C = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  red:    "\x1b[31m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  cyan:   "\x1b[36m",
  gray:   "\x1b[90m",
  clearLine: "\r\x1b[K",
};

function phaseColor(phase) {
  if (phase === "running")     return C.yellow + C.bold;
  if (phase === "error")       return C.red + C.bold;
  if (phase === "idle")        return C.green;
  if (phase === "transcribing" || phase === "awaiting") return C.cyan;
  return C.dim;
}

function quotaColor(pct) {
  if (pct == null) return C.dim;
  if (pct > 50)   return C.green;
  if (pct > 20)   return C.yellow;
  return C.red;
}

function formatQuota(q5h, qwk) {
  const parts = [];
  if (q5h != null) parts.push(`${quotaColor(q5h)}5h:${q5h}%${C.reset}`);
  if (qwk != null) parts.push(`${quotaColor(qwk)}wk:${qwk}%${C.reset}`);
  return parts.join(" ");
}

// ── State ───────────────────────────────────────────────────────────────────
let ws = null;
let reconnectDelay = 2000;
let stopping = false;
let lastLogLines = [];

const state = {
  phase: "",
  statusLine: "",
  quota5h: null,
  quotaWk: null,
  repo: "",
  thread: "",
  latestUserText: "",
  latestAssistantText: "",
};

// ── readline ─────────────────────────────────────────────────────────────────
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,
  prompt: `${C.cyan}>${C.reset} `,
});

/**
 * Print a line without disturbing the current input prompt.
 * Clears the prompt line, prints the content, then redraws the prompt.
 */
function print(line) {
  process.stdout.write(C.clearLine + line + "\n");
  rl.prompt(true);
}

function printSep() {
  print(`${C.gray}${"─".repeat(50)}${C.reset}`);
}

function printHeader() {
  const ph = state.phase || "?";
  const col = phaseColor(ph);
  const quota = formatQuota(state.quota5h, state.quotaWk);
  const repo = state.repo ? `${C.dim}[${state.repo}]${C.reset} ` : "";
  const status = state.statusLine ? ` ${C.dim}${state.statusLine}${C.reset}` : "";
  const quotaStr = quota ? `  ${quota}` : "";
  print(`${repo}${col}[${ph}]${C.reset}${status}${quotaStr}`);
}

// ── WebSocket ────────────────────────────────────────────────────────────────
function connect() {
  if (stopping) return;

  ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    reconnectDelay = 2000;
    ws.send(JSON.stringify({ type: "hello", deviceId: "console", boardType: "console" }));
  });

  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data.toString("utf8")); } catch { return; }

    switch (msg.type) {
      case "hello_ack":
        print(`${C.green}connected${C.reset} to ${WS_URL}`);
        break;

      case "cli_session_state": {
        const prevPhase = state.phase;
        const prevStatus = state.statusLine;
        state.phase       = msg.phase     || state.phase;
        state.statusLine  = msg.statusLine || "";
        state.repo        = msg.repoName  || state.repo;
        state.thread      = msg.threadId  || state.thread;
        state.quota5h     = msg.quota5hRemainingPct  ?? state.quota5h;
        state.quotaWk     = msg.quotaWeekRemainingPct ?? state.quotaWk;
        // Only print header when phase or status changes
        if (state.phase !== prevPhase || state.statusLine !== prevStatus) {
          printHeader();
        }
        break;
      }

      case "cli_summary": {
        const prevUser = state.latestUserText;
        const prevAI   = state.latestAssistantText;
        if (msg.latestUserText !== undefined) state.latestUserText = msg.latestUserText;
        if (msg.latestAssistantText !== undefined) state.latestAssistantText = msg.latestAssistantText;
        if (state.latestUserText && state.latestUserText !== prevUser)
          print(`  ${C.dim}YOU:${C.reset} ${state.latestUserText}`);
        if (state.latestAssistantText && state.latestAssistantText !== prevAI)
          print(`  ${C.cyan}AI: ${C.reset} ${state.latestAssistantText}`);
        break;
      }

      case "cli_log_tail": {
        const lines = msg.lines || [];
        // Only print lines that are new since last update
        const prev = lastLogLines;
        const newLines = lines.length > prev.length
          ? lines.slice(prev.length)
          : lines.filter((l, i) => l !== prev[i]);
        for (const line of newLines) {
          // Skip lines already shown via cli_summary (user:) or internal noise (event:/system:)
          if (/^(user:|event:|system:)/.test(line)) continue;
          print(`  ${C.gray}${line}${C.reset}`);
        }
        lastLogLines = lines;
        break;
      }

      case "transcript_final":
        if (msg.text) print(`  ${C.dim}transcript:${C.reset} ${msg.text}`);
        break;

      case "status":
        if (msg.status === "cli_busy") {
          print(`${C.yellow}[busy]${C.reset} CLI is already running`);
        } else if (msg.status === "typed") {
          // already echoed by readline
        } else if (msg.status && msg.status !== "recording" && msg.status !== "transcribing") {
          print(`${C.dim}status: ${msg.status}${C.reset}`);
        }
        break;

      case "warning":
        print(`${C.yellow}warn: ${msg.warning}${C.reset}`);
        break;

      case "error":
        print(`${C.red}error: ${msg.error}${C.reset}`);
        break;
    }
  });

  ws.on("close", (code) => {
    ws = null;
    if (code === 4001) {
      print(`${C.red}auth failed — stopping${C.reset}`);
      stopping = true;
      rl.close();
      return;
    }
    if (!stopping) {
      print(`${C.dim}disconnected, reconnecting in ${reconnectDelay / 1000}s…${C.reset}`);
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 10000);
    }
  });

  ws.on("error", (err) => {
    // suppress — close event will handle reconnect
    if (err.code !== "ECONNREFUSED" && err.code !== "ECONNRESET") {
      print(`${C.red}ws error: ${err.message}${C.reset}`);
    }
  });
}

// ── Input handling ───────────────────────────────────────────────────────────
rl.on("line", (line) => {
  const text = line.trim();
  if (!text) { rl.prompt(); return; }

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    print(`${C.yellow}not connected — waiting for server${C.reset}`);
    rl.prompt();
    return;
  }

  ws.send(JSON.stringify({ type: "prompt", text }));
  rl.prompt();
});

rl.on("close", () => {
  stopping = true;
  ws?.close();
  process.exit(0);
});

// ── Start ────────────────────────────────────────────────────────────────────
export function startConsole(label = "") {
  const tag = label ? ` [${label}]` : "";
  process.stdout.write(`vibecoding-voice console${tag} — ${WS_URL}\n`);
  process.stdout.write(`Type a prompt and press Enter to send. Ctrl+C to exit.\n\n`);
  rl.prompt();
  connect();
}

// ── Monitor mode (inject) — no readline, status display only ─────────────────
export function startMonitor() {
  let monitorWs = null;
  let monitorStopping = false;
  let monitorDelay = 2000;

  function out(line) {
    process.stdout.write(line + "\n");
  }

  function connectMonitor() {
    if (monitorStopping) return;
    monitorWs = new WebSocket(WS_URL);

    monitorWs.on("open", () => {
      monitorDelay = 2000;
      monitorWs.send(JSON.stringify({ type: "hello", deviceId: "monitor", boardType: "monitor" }));
    });

    monitorWs.on("message", (data) => {
      let msg;
      try { msg = JSON.parse(data.toString("utf8")); } catch { return; }

      switch (msg.type) {
        case "hello_ack":
          out(`${C.green}connected${C.reset} — waiting for board input…`);
          break;
        case "status":
          if (msg.status === "recording")
            out(`${C.yellow}[recording]${C.reset}`);
          else if (msg.status === "transcribing")
            out(`${C.cyan}[transcribing]${C.reset}`);
          else if (msg.status === "typed" && msg.text)
            out(`${C.green}[injected]${C.reset} ${msg.text}`);
          else if (msg.status === "transcript_empty")
            out(`${C.dim}[empty — nothing injected]${C.reset}`);
          break;
        case "transcript_final":
          if (msg.text) out(`${C.dim}  → ${msg.text}${C.reset}`);
          break;
        case "error":
          out(`${C.red}[error]${C.reset} ${msg.error}`);
          break;
      }
    });

    monitorWs.on("close", (code) => {
      monitorWs = null;
      if (code === 4001) { out(`${C.red}auth failed${C.reset}`); monitorStopping = true; return; }
      if (!monitorStopping) {
        out(`${C.dim}disconnected, reconnecting in ${monitorDelay / 1000}s…${C.reset}`);
        setTimeout(connectMonitor, monitorDelay);
        monitorDelay = Math.min(monitorDelay * 2, 10000);
      }
    });

    monitorWs.on("error", (err) => {
      if (err.code !== "ECONNREFUSED" && err.code !== "ECONNRESET")
        out(`${C.red}ws error: ${err.message}${C.reset}`);
    });
  }

  process.on("SIGINT", () => { monitorStopping = true; monitorWs?.close(); process.exit(0); });

  out(`vibe inject — ${WS_URL}`);
  out(`Speak into the board. Text will be injected at cursor position. Ctrl+C to exit.\n`);
  connectMonitor();
}

// Run directly when invoked as main module
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startConsole();
}
