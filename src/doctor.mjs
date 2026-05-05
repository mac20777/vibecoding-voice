import { execFile } from "node:child_process";
import dgram from "node:dgram";
import fs from "node:fs";
import { createServer } from "node:net";
import { promisify } from "node:util";

import { isCliAvailable } from "./config.mjs";
import { resolveRuntimeLogPath } from "./runtime-log.mjs";

const execFileAsync = promisify(execFile);

function ok(label) {
  console.log(`  \x1b[32m[✓]\x1b[0m ${label}`);
}

function fail(label) {
  console.log(`  \x1b[31m[✗]\x1b[0m ${label}`);
}

function warn(label) {
  console.log(`  \x1b[33m[~]\x1b[0m ${label}`);
}

function checkTcpPort(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

function checkUdpPort(port) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    socket.once("error", () => {
      socket.close();
      resolve(false);
    });
    socket.once("listening", () => socket.close(() => resolve(true)));
    socket.bind(port, "0.0.0.0");
  });
}

function asArray(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function isLoopback(address) {
  const text = String(address || "");
  return text === "127.0.0.1" || text === "::1" || text === "::ffff:127.0.0.1";
}

function tcpStateName(state) {
  const text = String(state || "").toLowerCase();
  if (text === "2") {
    return "listen";
  }
  if (text === "5") {
    return "established";
  }
  return text;
}

async function readWindowsPortSnapshot({ tcpPort, udpPort }) {
  if (process.platform !== "win32") {
    return null;
  }

  const script = `
$tcpPort = ${Number(tcpPort)}
$udpPort = ${Number(udpPort)}
$tcp = @(Get-NetTCPConnection -LocalPort $tcpPort -ErrorAction SilentlyContinue |
  Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,State,OwningProcess)
$udp = @(Get-NetUDPEndpoint -LocalPort $udpPort -ErrorAction SilentlyContinue |
  Select-Object LocalAddress,LocalPort,OwningProcess)
$pids = @($tcp.OwningProcess + $udp.OwningProcess | Where-Object { $_ -and $_ -ne 0 } | Select-Object -Unique)
$processes = @($pids | ForEach-Object {
  Get-Process -Id $_ -ErrorAction SilentlyContinue |
    Select-Object Id,ProcessName,Path
})
[pscustomobject]@{
  tcp = $tcp
  udp = $udp
  processes = $processes
} | ConvertTo-Json -Depth 5
`;

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 5000, windowsHide: true, maxBuffer: 1024 * 1024 }
    );
    const trimmed = stdout.trim();
    return trimmed ? JSON.parse(trimmed) : null;
  } catch (error) {
    warn(`live port snapshot unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function formatProcess(processes, pid) {
  const processInfo = asArray(processes).find((entry) => Number(entry.Id) === Number(pid));
  if (!processInfo) {
    return `PID ${pid}`;
  }
  const path = processInfo.Path ? ` · ${processInfo.Path}` : "";
  return `${processInfo.ProcessName} PID ${pid}${path}`;
}

function reportRuntimeLog() {
  const logPath = resolveRuntimeLogPath();
  try {
    const stat = fs.statSync(logPath);
    ok(`runtime log: ${logPath} (updated ${stat.mtime.toLocaleString()})`);
  } catch {
    warn(`runtime log not found yet: ${logPath}`);
  }
}

async function reportLivePorts(config) {
  const snapshot = await readWindowsPortSnapshot({
    tcpPort: config.port,
    udpPort: config.discoveryPort
  });

  if (!snapshot) {
    const wsAvailable = await checkTcpPort(config.port);
    if (wsAvailable) {
      ok(`port ${config.port} available (WebSocket)`);
    } else {
      fail(`port ${config.port} in use — set LAN_VOICE_PORT to a free port`);
      return { hasError: true };
    }

    if (config.discoveryEnabled) {
      const udpAvailable = await checkUdpPort(config.discoveryPort);
      if (udpAvailable) {
        ok(`port ${config.discoveryPort} available (UDP discovery)`);
      } else {
        warn(`port ${config.discoveryPort} in use (UDP discovery)`);
      }
    }
    return { hasError: false };
  }

  let hasError = false;
  const tcpRows = asArray(snapshot.tcp);
  const udpRows = asArray(snapshot.udp);
  const listeners = tcpRows.filter((row) => tcpStateName(row.State) === "listen");
  const established = tcpRows.filter((row) => tcpStateName(row.State) === "established");
  const lanClients = established.filter((row) =>
    row.RemoteAddress &&
    row.RemoteAddress !== "0.0.0.0" &&
    !isLoopback(row.RemoteAddress)
  );

  if (listeners.length > 0) {
    for (const listener of listeners) {
      ok(`WebSocket listening on ${listener.LocalAddress}:${listener.LocalPort} by ${formatProcess(snapshot.processes, listener.OwningProcess)}`);
    }
  } else if (await checkTcpPort(config.port)) {
    ok(`port ${config.port} available (WebSocket server not running)`);
  } else {
    fail(`port ${config.port} in use but no listener details found`);
    hasError = true;
  }

  if (lanClients.length > 0) {
    for (const client of lanClients) {
      ok(`board/client connected: ${client.RemoteAddress}:${client.RemotePort} -> ${client.LocalAddress}:${client.LocalPort}`);
    }
  } else {
    warn(`no LAN board connection currently established on port ${config.port}`);
  }

  if (config.discoveryEnabled) {
    if (udpRows.length > 0) {
      for (const endpoint of udpRows) {
        ok(`UDP discovery endpoint ${endpoint.LocalAddress}:${endpoint.LocalPort} by ${formatProcess(snapshot.processes, endpoint.OwningProcess)}`);
      }
    } else if (await checkUdpPort(config.discoveryPort)) {
      ok(`port ${config.discoveryPort} available (UDP discovery server not running)`);
    } else {
      warn(`port ${config.discoveryPort} in use but no UDP endpoint details found`);
    }
  }

  return { hasError };
}

function resolveSttLabel(config) {
  if (config.mockTranscript) {
    return { label: "mock (MOCK_TRANSCRIPT set)", valid: true };
  }
  const provider = config.sttProvider || (config.openaiApiKey ? "openai" : config.volcengineAppKey ? "volcengine" : "");
  if (provider === "openai") {
    return config.openaiApiKey
      ? { label: `openai · ${config.openaiModel}`, valid: true }
      : { label: "openai — OPENAI_API_KEY missing", valid: false };
  }
  if (provider === "volcengine") {
    const keysOk = config.volcengineAppKey && config.volcengineAccessKey;
    return keysOk
      ? { label: `volcengine · ${config.volcengineLanguage}`, valid: true }
      : { label: "volcengine — VOLCENGINE_APP_KEY or VOLCENGINE_ACCESS_KEY missing", valid: false };
  }
  return { label: "none — set OPENAI_API_KEY or VOLCENGINE_APP_KEY + VOLCENGINE_ACCESS_KEY", valid: false };
}

function resolveTodoIntentLabel(config) {
  if (config.todoIntentProvider !== "deepseek") {
    return { label: "rules", valid: true };
  }
  return config.todoIntentApiKey
    ? { label: `deepseek · ${config.todoIntentModel}`, valid: true }
    : { label: "deepseek — TODO_INTENT_API_KEY missing", valid: false };
}

function resolveVoiceTranslationLabel(config) {
  if (!config.voiceTranslationEnabled) {
    return { label: "off", valid: true };
  }
  return config.voiceTranslationApiKey
    ? { label: `deepseek · ${config.voiceTranslationModel}`, valid: true }
    : { label: "deepseek — VOICE_TRANSLATION_API_KEY missing", valid: false };
}

export async function runDoctor(config) {
  console.log("\nvibecoding-voice doctor\n");

  let hasError = false;

  if (config.loadedConfigFiles?.length) {
    ok(`config loaded from: ${config.loadedConfigFiles.join(", ")}`);
  } else {
    warn(`no config file loaded — run "vibe config" to create ${config.userConfigPath}`);
  }

  // STT provider
  const stt = resolveSttLabel(config);
  if (stt.valid) {
    ok(`STT: ${stt.label}`);
  } else {
    fail(`STT: ${stt.label}`);
    hasError = true;
  }

  const todoIntent = resolveTodoIntentLabel(config);
  if (todoIntent.valid) {
    ok(`Todo intent: ${todoIntent.label}`);
  } else {
    warn(`Todo intent: ${todoIntent.label}`);
  }

  const voiceTranslation = resolveVoiceTranslationLabel(config);
  if (voiceTranslation.valid) {
    ok(`Voice translation: ${voiceTranslation.label}`);
  } else {
    fail(`Voice translation: ${voiceTranslation.label}`);
    hasError = true;
  }

  // Claude Code CLI
  const claudeFound = isCliAvailable(config.claudeCommand);
  if (claudeFound) {
    ok(`claude found: ${config.claudeCommand}`);
  } else {
    warn(`claude not found (${config.claudeCommand}) — install with: npm install -g @anthropic-ai/claude-code`);
  }

  // Codex CLI
  const codexFound = isCliAvailable(config.codexCommand);
  if (codexFound) {
    ok(`codex found: ${config.codexCommand}`);
  } else {
    warn(`codex not found (${config.codexCommand}) — install with: npm install -g @openai/codex`);
  }

  if (!claudeFound && !codexFound) {
    warn("neither claude nor codex found — SEND_TARGET will fall back to text_injector");
  }

  // Live ports / current device connection
  const portReport = await reportLivePorts(config);
  hasError = hasError || portReport.hasError;
  reportRuntimeLog();

  // Summary
  const autoNote = config.sendTargetAuto ? " [auto-detected]" : "";
  console.log(`\n  Target: \x1b[1m${config.sendTarget}\x1b[0m${autoNote}`);
  console.log(`  Delivery: \x1b[1m${config.transcriptDeliveryMode}\x1b[0m`);
  console.log(`  Translation: \x1b[1m${config.voiceTranslationEnabled ? "on" : "off"}\x1b[0m`);
  console.log(`  Inject: \x1b[1m${config.textInjectionMode}\x1b[0m`);
  if (hasError) {
    console.log('  \x1b[31mSome checks failed — fix the issues above before starting. Run "vibe config" if needed.\x1b[0m\n');
    process.exit(1);
  } else {
    console.log("  \x1b[32mAll checks passed.\x1b[0m\n");
    process.exit(0);
  }
}
