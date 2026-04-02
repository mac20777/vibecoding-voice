#!/usr/bin/env node
/**
 * vibe — unified launcher for vibecoding-voice.
 *
 * Usage:
 *   vibe              # inject mode (default)
 *   vibe inject
 *   vibe codex
 *   vibe claude
 *   vibe config       # interactive first-run / repair wizard
 *   vibe doctor       # inspect current config and environment
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const INVOKE_CWD = process.cwd();

if (!process.env.VIBE_INVOKE_CWD) {
  process.env.VIBE_INVOKE_CWD = INVOKE_CWD;
}

const TARGET_MAP = {
  claude: "claude_code",
  codex: "codex_exec",
  inject: "text_injector"
};

function printUsage() {
  process.stderr.write("Usage: vibe [claude|codex|inject|config|doctor]\n");
}

const arg = (process.argv[2] || "inject").toLowerCase().replace(/^--/, "");

if (arg === "help" || arg === "h") {
  printUsage();
  process.exit(0);
}

if (arg === "config") {
  try {
    const { runConfigWizard } = await import("../src/config-wizard.mjs");
    const result = await runConfigWizard();
    process.exit(result.saved ? 0 : 1);
  } catch (error) {
    process.stderr.write(`${error.message || String(error)}\n`);
    process.exit(1);
  }
}

if (arg === "doctor") {
  const { loadConfig } = await import("../src/config.mjs");
  const { runDoctor } = await import("../src/doctor.mjs");
  await runDoctor(loadConfig());
}

if (!TARGET_MAP[arg]) {
  printUsage();
  process.exit(1);
}

const sendTarget = TARGET_MAP[arg];
const PORT = process.env.LAN_VOICE_PORT || 8765;

function probeServer() {
  return new Promise((resolve) => {
    const probe = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const timer = setTimeout(() => {
      probe.terminate();
      resolve(false);
    }, 1000);

    probe.on("open", () => {
      clearTimeout(timer);
      probe.close();
      resolve(true);
    });
    probe.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

async function waitForServer(maxMs = 6000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (await probeServer()) {
      return true;
    }
    await delay(400);
  }
  return false;
}

let serverProc = null;
let stopping = false;

const alreadyRunning = await probeServer();

if (alreadyRunning) {
  process.stdout.write(`Server already running — connecting as [${arg}]\n`);
} else {
  try {
    const { ensureConfigReadyInteractive } = await import("../src/config-wizard.mjs");
    await ensureConfigReadyInteractive();
  } catch (error) {
    process.stderr.write(`${error.message || String(error)}\n`);
    process.exit(1);
  }

  process.stdout.write(`Starting server (${arg})…\n`);

  serverProc = spawn("node", [join(ROOT, "src/server.mjs")], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SEND_TARGET: sendTarget,
      CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS: "1",
      VIBE_INVOKE_CWD: INVOKE_CWD
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  serverProc.stderr.on("data", (chunk) => process.stderr.write(chunk));
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

process.on("SIGINT", () => {
  stopping = true;
  serverProc?.kill();
});

const { startConsole, startMonitor } = await import("./console.mjs");
if (arg === "inject") {
  startMonitor();
} else {
  startConsole(arg);
}
