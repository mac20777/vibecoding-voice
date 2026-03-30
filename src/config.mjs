import fs from "node:fs";
import path from "node:path";

function loadDotEnvFile() {
  const filePath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(filePath)) {
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

export function loadConfig() {
  loadDotEnvFile();
  return {
    bindHost: process.env.LAN_VOICE_BIND || "0.0.0.0",
    port: Number(process.env.LAN_VOICE_PORT || "8765"),
    sendTarget: process.env.SEND_TARGET || "text_injector",
    transcriptDeliveryMode: process.env.TRANSCRIPT_DELIVERY_MODE || "immediate",
    textInjectionMode: process.env.TEXT_INJECTION_MODE || "type_only",
    dryRunTextInjection: process.env.DRY_RUN_TEXT_INJECTION === "1",
    codexCommand:
      process.env.CODEX_COMMAND ||
      (process.platform === "win32"
        ? path.join(process.env.APPDATA || "", "npm", "codex.ps1")
        : "codex"),
    codexCwd: process.env.CODEX_CWD || process.cwd(),
    codexSkipGitRepoCheck: process.env.CODEX_SKIP_GIT_REPO_CHECK === "1",
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
