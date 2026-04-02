import { createServer } from "node:net";

import { isCliAvailable } from "./config.mjs";

function ok(label) {
  console.log(`  \x1b[32m[✓]\x1b[0m ${label}`);
}

function fail(label) {
  console.log(`  \x1b[31m[✗]\x1b[0m ${label}`);
}

function warn(label) {
  console.log(`  \x1b[33m[~]\x1b[0m ${label}`);
}

function checkPort(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
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

  // Ports
  const wsAvailable = await checkPort(config.port);
  if (wsAvailable) {
    ok(`port ${config.port} available (WebSocket)`);
  } else {
    fail(`port ${config.port} in use — set LAN_VOICE_PORT to a free port`);
    hasError = true;
  }

  if (config.discoveryEnabled) {
    const udpAvailable = await checkPort(config.discoveryPort);
    if (udpAvailable) {
      ok(`port ${config.discoveryPort} available (UDP discovery)`);
    } else {
      warn(`port ${config.discoveryPort} may be in use (UDP discovery) — set LAN_DISCOVERY_PORT or LAN_DISCOVERY_ENABLED=0`);
    }
  }

  // Summary
  const autoNote = config.sendTargetAuto ? " [auto-detected]" : "";
  console.log(`\n  Target: \x1b[1m${config.sendTarget}\x1b[0m${autoNote}`);
  console.log(`  Delivery: \x1b[1m${config.transcriptDeliveryMode}\x1b[0m`);
  if (hasError) {
    console.log('  \x1b[31mSome checks failed — fix the issues above before starting. Run "vibe config" if needed.\x1b[0m\n');
    process.exit(1);
  } else {
    console.log("  \x1b[32mAll checks passed.\x1b[0m\n");
    process.exit(0);
  }
}
