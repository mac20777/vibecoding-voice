import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { getUserConfigPath, projectRoot } from "./paths.mjs";

const INITIAL_ENV_KEYS = new Set(Object.keys(process.env));
let appliedConfigKeys = new Set();

function parseEnvContent(content) {
  const values = {};
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
    values[key] = value;
  }
  return values;
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return parseEnvContent(fs.readFileSync(filePath, "utf8"));
}

function applyEnvValues(values) {
  for (const [key, value] of Object.entries(values)) {
    if (INITIAL_ENV_KEYS.has(key)) {
      continue;
    }
    process.env[key] = value;
  }
}

function uniqPaths(paths) {
  return [...new Set(paths.map((candidate) => path.resolve(candidate)))];
}

function invokeCwd() {
  return String(process.env.VIBE_INVOKE_CWD || "").trim() || process.cwd();
}

export function listConfigFileCandidates() {
  const userConfigPath = getUserConfigPath();
  const projectConfigPath = path.join(projectRoot, ".env");
  const cwdConfigPath = path.join(invokeCwd(), ".env");

  return uniqPaths([userConfigPath, projectConfigPath, cwdConfigPath]);
}

export function loadConfigFiles({ quietMissing = false } = {}) {
  const mergedValues = {};
  const loadedConfigFiles = [];

  for (const filePath of listConfigFileCandidates()) {
    const values = readEnvFile(filePath);
    if (!values) {
      continue;
    }

    Object.assign(mergedValues, values);
    loadedConfigFiles.push(filePath);
  }

  for (const key of appliedConfigKeys) {
    if (!INITIAL_ENV_KEYS.has(key)) {
      delete process.env[key];
    }
  }

  applyEnvValues(mergedValues);
  appliedConfigKeys = new Set(Object.keys(mergedValues).filter((key) => !INITIAL_ENV_KEYS.has(key)));

  if (!quietMissing && loadedConfigFiles.length === 0) {
    console.warn(
      `[vibecoding-voice] No config file found.\n` +
        `                   Run "vibe config" to create ${getUserConfigPath()}.\n` +
        `                   You can also use environment variables or a local .env file.`
    );
  }

  return {
    loadedConfigFiles,
    userConfigPath: getUserConfigPath(),
    cwdConfigPath: path.join(invokeCwd(), ".env"),
    projectConfigPath: path.join(projectRoot, ".env")
  };
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

function resolveCodexCwd() {
  const configured = String(process.env.CODEX_CWD || "").trim();
  if (!configured) {
    return invokeCwd();
  }

  return path.isAbsolute(configured) ? configured : path.resolve(invokeCwd(), configured);
}

function normalizeTranscriptDeliveryMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "immediate" ? "immediate" : "confirm_on_device";
}

export function isCliAvailable(command) {
  if (!command) {
    return false;
  }

  if (path.isAbsolute(command) || command.includes(path.sep)) {
    return fs.existsSync(command);
  }

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

export function detectConfiguredSttProvider(config) {
  const explicit = String(config.sttProvider || "").trim().toLowerCase();
  if (explicit) {
    return explicit;
  }

  if (config.openaiApiKey) {
    return "openai";
  }

  if (config.volcengineAppKey || config.volcengineAccessKey) {
    return "volcengine";
  }

  return "";
}

export function getConfigIssues(config) {
  if (config.mockTranscript) {
    return [];
  }

  const provider = detectConfiguredSttProvider(config);
  if (!provider) {
    return [
      "No STT provider is configured. Set OPENAI_API_KEY or VOLCENGINE_APP_KEY + VOLCENGINE_ACCESS_KEY."
    ];
  }

  if (provider === "openai") {
    return config.openaiApiKey ? [] : ["OPENAI_API_KEY is not set."];
  }

  if (provider === "volcengine") {
    const issues = [];
    if (!config.volcengineAppKey) {
      issues.push("VOLCENGINE_APP_KEY is not set.");
    }
    if (!config.volcengineAccessKey) {
      issues.push("VOLCENGINE_ACCESS_KEY is not set.");
    }
    return issues;
  }

  return [`Unsupported STT_PROVIDER: ${config.sttProvider}`];
}

export function hasRequiredConfig(config) {
  return getConfigIssues(config).length === 0;
}

export function readUserConfigValues() {
  return readEnvFile(getUserConfigPath()) || {};
}

function normalizeEnvValue(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).replace(/\r?\n/g, " ").trim();
}

function formatEnvFile(values) {
  const keys = Object.keys(values).sort((left, right) => left.localeCompare(right));
  return `${keys.map((key) => `${key}=${normalizeEnvValue(values[key])}`).join("\n")}\n`;
}

export function writeUserConfigValues(updates) {
  const currentValues = readUserConfigValues();
  const nextValues = { ...currentValues };

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) {
      continue;
    }

    if (value === null) {
      delete nextValues[key];
      continue;
    }

    nextValues[key] = normalizeEnvValue(value);
  }

  const userConfigPath = getUserConfigPath();
  fs.mkdirSync(path.dirname(userConfigPath), { recursive: true });
  fs.writeFileSync(userConfigPath, formatEnvFile(nextValues), "utf8");
  return userConfigPath;
}

export function redactValue(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "(not set)";
  }

  if (trimmed.length <= 8) {
    return `${trimmed.slice(0, 1)}***${trimmed.slice(-1)}`;
  }

  return `${trimmed.slice(0, 4)}***${trimmed.slice(-4)}`;
}

export function loadConfig(options = {}) {
  const { loadedConfigFiles, userConfigPath, cwdConfigPath, projectConfigPath } = loadConfigFiles(options);

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
    transcriptDeliveryMode: normalizeTranscriptDeliveryMode(
      process.env.TRANSCRIPT_DELIVERY_MODE || "confirm_on_device"
    ),
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
    saveDebugWav: process.env.SAVE_DEBUG_WAV === "1",
    loadedConfigFiles,
    userConfigPath,
    cwdConfigPath,
    projectConfigPath
  };
}
