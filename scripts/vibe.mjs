#!/usr/bin/env node
/**
 * vibe — unified launcher for vibecoding-voice.
 *
 * Usage:
 *   vibe              # inject mode (default)
 *   vibe --claude     # Claude Code mode
 *   vibe --codex      # Codex mode
 *
 * If the server is not already running, starts it with the specified SEND_TARGET.
 * Then opens the interactive terminal console.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const INVOKE_CWD = process.cwd();

const TARGET_MAP = {
  claude: "claude_code",
  codex:  "codex_exec",
  inject: "text_injector",
};

const arg = (process.argv[2] || "inject").toLowerCase().replace(/^--/, "");
if (!TARGET_MAP[arg]) {
  process.stderr.write(`Usage: happy [claude|codex|inject]\n`);
  process.exit(1);
}
const sendTarget = TARGET_MAP[arg];
const PORT = process.env.LAN_VOICE_PORT || 8765;

// ── Check if server is already running ──────────────────────────────────────
function probeServer() {
  return new Promise((resolve) => {
    const probe = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const timer = setTimeout(() => { probe.terminate(); resolve(false); }, 1000);
    probe.on("open",  () => { clearTimeout(timer); probe.close(); resolve(true); });
    probe.on("error", () => { clearTimeout(timer); resolve(false); });
  });
}

async function waitForServer(maxMs = 6000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (await probeServer()) return true;
    await delay(400);
  }
  return false;
}

// ── Spawn server if not running ──────────────────────────────────────────────
let serverProc = null;

const alreadyRunning = await probeServer();

if (alreadyRunning) {
  process.stdout.write(`Server already running — connecting as [${arg}]\n`);
} else {
  process.stdout.write(`Starting server (${arg})…\n`);

  serverProc = spawn("node", [join(ROOT, "src/server.mjs")], {
    cwd: process.cwd(),
    env: { ...process.env, SEND_TARGET: sendTarget, CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS: "1", VIBE_INVOKE_CWD: INVOKE_CWD },
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Forward server stderr (startup errors, fatal crashes)
  serverProc.stderr.on("data", (chunk) => process.stderr.write(chunk));

  // Silently ignore stdout (all status is visible via WebSocket in console)
  serverProc.stdout.resume();

  serverProc.on("exit", (code) => {
    if (!stopping) {
      process.stderr.write(`\nserver exited (code ${code ?? "?"})\n`);
      process.exit(code ?? 1);
    }
  });

  const ready = await waitForServer(6000);
  if (!ready) {
    process.stderr.write("Server did not become ready in 6s — check for errors above.\n");
    serverProc.kill();
    process.exit(1);
  }
}

// ── Start console UI ─────────────────────────────────────────────────────────
let stopping = false;

process.on("SIGINT", () => {
  stopping = true;
  serverProc?.kill();
  // console's readline "close" handler calls process.exit(0)
});

const { startConsole, startMonitor } = await import("./console.mjs");
if (arg === "inject") {
  startMonitor();
} else {
  startConsole(arg);
}
