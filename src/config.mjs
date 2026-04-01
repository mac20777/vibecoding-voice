import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { projectRoot } from "./paths.mjs";

function loadDotEnvFile() {
  const filePath = path.join(projectRoot, ".env");
  if (!fs.existsSync(filePath)) {
    console.warn(
      "[vibecoding-voice] .env not found — copy .env.example to .env and configure your keys.\n" +
        "                   Running with environment defaults (MOCK_TRANSCRIPT may be required)."
    );
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function resolveCodexCommand() {
  if (process.env.CODEX_COMMAND) {
    return process.env.CODEX_COMMAND;
  }

  if (process.platform !== "win32") {
    return "codex";
  }

  const npmShimPath = path.join(process.env.APPDATA || "", "npm", "codex.ps1");
  return fs.existsSync(npmShimPath) ? npmShimPath : "codex";
}

function resolveClaudeCommand() {
  if (process.env.CLAUDE_COMMAND) {
    return process.env.CLAUDE_COMMAND;
  }

  if (process.platform !== "win32") {
    return "claude";
  }

  const npmShimPath = path.join(process.env.APPDATA || "", "npm", "claude.ps1");
  return fs.existsSync(npmShimPath) ? npmShimPath : "claude";
}

function invokeCwd() {
  return String(process.env.VIBE_INVOKE_CWD || "").trim() || process.cwd();
}

function resolveCodexCwd() {
  const configured = String(process.env.CODEX_CWD || "").trim();
  if (!configured) {
    return invokeCwd();
  }

  return path.isAbsolute(configured) ? configured : path.resolve(invokeCwd(), configured);
}

export function isCliAvailable(command) {
  if (!command) {
    return false;
  }

  // Absolute path or relative path with separator — check file existence directly
  if (path.isAbsolute(command) || command.includes(path.sep)) {
    return fs.existsSync(command);
  }

  // Plain command name — probe PATH
  try {
    const finder = process.platform === "win32" ? "where" : "which";
    execSync(`${finder} ${command}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function autoDetectSendTarget(claudeCommand, codexCommand) {
  if (isCliAvailable(claudeCommand)) {
    return { sendTarget: "claude_code", sendTargetAuto: true };
  }
  if (isCliAvailable(codexCommand)) {
    return { sendTarget: "codex_exec", sendTargetAuto: true };
  }
  return { sendTarget: "text_injector", sendTargetAuto: true };
}

export function loadConfig() {
  loadDotEnvFile();

  const claudeCommand = resolveClaudeCommand();
  const codexCommand = resolveCodexCommand();

  const sendTargetEnv = String(process.env.SEND_TARGET || "").trim();
  const { sendTarget, sendTargetAuto } = sendTargetEnv
    ? { sendTarget: sendTargetEnv, sendTargetAuto: false }
    : autoDetectSendTarget(claudeCommand, codexCommand);

  return {
    bindHost: process.env.LAN_VOICE_BIND || "0.0.0.0",
    port: Number(process.env.LAN_VOICE_PORT || "8765"),
    discoveryEnabled: process.env.LAN_DISCOVERY_ENABLED !== "0",
    discoveryPort: Number(process.env.LAN_DISCOVERY_PORT || "8766"),
    discoveryHostId:
      String(process.env.LAN_DISCOVERY_HOST_ID || "").trim() ||
      process.env.COMPUTERNAME ||
      process.env.HOSTNAME ||
      "vibecoding-host",
    lanSharedSecret: String(process.env.LAN_SHARED_SECRET || "").trim(),
    lanAuthWindowSec: Number(process.env.LAN_AUTH_WINDOW_SEC || "300"),
    sendTarget,
    sendTargetAuto,
    transcriptDeliveryMode: process.env.TRANSCRIPT_DELIVERY_MODE || "immediate",
    textInjectionMode: process.env.TEXT_INJECTION_MODE || "type_only",
    dryRunTextInjection: process.env.DRY_RUN_TEXT_INJECTION === "1",
    codexCommand,
    codexCwd: resolveCodexCwd(),
    codexSkipGitRepoCheck: process.env.CODEX_SKIP_GIT_REPO_CHECK === "1",
    claudeCommand,
    claudeCwd: String(process.env.CLAUDE_CWD || "").trim()
      ? path.resolve(invokeCwd(), String(process.env.CLAUDE_CWD || "").trim())
      : invokeCwd(),
    claudeAllowedTools: process.env.CLAUDE_ALLOWED_TOOLS || "Read,Edit,Write,Bash,Glob,Grep",
    claudeMaxTurns: process.env.CLAUDE_MAX_TURNS !== undefined ? Number(process.env.CLAUDE_MAX_TURNS) : 30,
    claudeDangerouslySkipPermissions: process.env.CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS === "1",
    cliTimeoutSec: Number(process.env.CLI_TIMEOUT_SEC || "300"),
    sttProvider: process.env.STT_PROVIDER || "",
    openaiApiKey: process.env.OPENAI_API_KEY || "",
    openaiModel: process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1",
    openaiLanguage: process.env.OPENAI_TRANSCRIBE_LANGUAGE || "",
    volcengineAppKey: process.env.VOLCENGINE_APP_KEY || "",
    volcengineAccessKey: process.env.VOLCENGINE_ACCESS_KEY || "",
    volcengineResourceId: process.env.VOLCENGINE_RESOURCE_ID || "volc.bigasr.auc_turbo",
    volcengineLanguage: process.env.VOLCENGINE_LANGUAGE || "zh-CN",
    mockTranscript: process.env.MOCK_TRANSCRIPT || "",
    saveDebugWav: process.env.SAVE_DEBUG_WAV === "1"
  };
}
