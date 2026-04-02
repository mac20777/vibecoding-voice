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
const LOCAL_WS_URL = `ws://127.0.0.1:${PORT}`;

function probeServer() {
  return new Promise((resolve) => {
    const probe = new WebSocket(LOCAL_WS_URL);
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

function connectControlSocket() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(LOCAL_WS_URL);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error("Timed out while connecting to local vibe server."));
    }, 2000);

    ws.on("open", () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function queryRunningServer() {
  const ws = await connectControlSocket();
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error("Timed out while waiting for server metadata."));
      }, 2000);

      ws.on("message", (data) => {
        try {
          const message = JSON.parse(data.toString("utf8"));
          if (message.type === "server_ready") {
            clearTimeout(timer);
            resolve(message);
            ws.close();
          } else if (message.type === "error") {
            clearTimeout(timer);
            reject(new Error(message.error || "Unknown server error"));
            ws.close();
          }
        } catch (error) {
          clearTimeout(timer);
          reject(error);
          ws.close();
        }
      });

      ws.send(JSON.stringify({ type: "hello", deviceId: "vibe-cli", boardType: "cli" }));
    });
  } finally {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  }
}

async function ensureRunningServerTarget(expectedTarget) {
  const ws = await connectControlSocket();
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error("Timed out while checking local vibe server state."));
      }, 3000);

      let sawHello = false;

      ws.on("message", (data) => {
        try {
          const message = JSON.parse(data.toString("utf8"));
          if (message.type === "hello_ack") {
            sawHello = true;
            return;
          }
          if (message.type === "server_ready") {
            if (message.sendTarget === expectedTarget) {
              clearTimeout(timer);
              resolve(message);
              ws.close();
              return;
            }
            if (!sawHello) {
              return;
            }
            ws.send(JSON.stringify({ type: "set_target", sendTarget: expectedTarget }));
            sawHello = false;
            return;
          }
          if (message.type === "status" && message.status === "cli_busy") {
            clearTimeout(timer);
            reject(new Error("Local vibe server is busy running a CLI session. Wait for it to finish, then retry."));
            ws.close();
            return;
          }
          if (message.type === "warning" && message.warning === "invalid_send_target") {
            clearTimeout(timer);
            reject(new Error(`Local vibe server rejected target ${expectedTarget}.`));
            ws.close();
            return;
          }
          if (message.type === "error") {
            clearTimeout(timer);
            reject(new Error(message.error || "Unknown server error"));
            ws.close();
          }
        } catch (error) {
          clearTimeout(timer);
          reject(error);
          ws.close();
        }
      });

      ws.send(JSON.stringify({ type: "hello", deviceId: "vibe-cli", boardType: "cli" }));
    });
  } finally {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  }
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
  const running = await queryRunningServer();
  if (running.sendTarget !== sendTarget) {
    await ensureRunningServerTarget(sendTarget);
    process.stdout.write(`Server already running — switched target to [${arg}]\n`);
  } else {
    process.stdout.write(`Server already running — connecting as [${arg}]\n`);
  }
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
