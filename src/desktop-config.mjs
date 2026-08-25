import { detectConfiguredSttProvider, getConfigIssues } from "./config.mjs";
import { normalizeDesktopSettings } from "./desktop-settings.mjs";
import {
  DEFAULT_VOICE_TRANSLATION_PROMPT,
  normalizeVoiceTranslationSendMode,
  normalizeVoiceTranslationTargetLanguage
} from "./translation-service.mjs";

const VALID_SEND_TARGETS = new Set(["text_injector", "codex_exec", "claude_code"]);
const VALID_STT_PROVIDERS = new Set(["volcengine", "openai"]);

function normalizeChoice(value, fallback, validValues) {
  const normalized = String(value || "").trim();
  return validValues.has(normalized) ? normalized : fallback;
}

function normalizeOptionalText(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

export function buildDesktopFormState(config, desktopSettings = {}) {
  const voiceTranslationSendMode = normalizeVoiceTranslationSendMode(
    config.voiceTranslationSendMode,
    config.voiceTranslationSendBilingual === true
  );
  return {
    sendTarget: normalizeChoice(config.sendTarget, "text_injector", VALID_SEND_TARGETS),
    sttProvider: normalizeChoice(detectConfiguredSttProvider(config), "volcengine", VALID_STT_PROVIDERS),
    openaiApiKey: String(config.openaiApiKey || ""),
    openaiModel: String(config.openaiModel || "whisper-1"),
    volcengineAppKey: String(config.volcengineAppKey || ""),
    volcengineAccessKey: String(config.volcengineAccessKey || ""),
    transcriptDeliveryMode:
      String(config.transcriptDeliveryMode || "").trim().toLowerCase() === "immediate"
        ? "immediate"
        : "confirm_on_device",
    textInjectionMode:
      String(config.textInjectionMode || "").trim().toLowerCase() === "type_only"
        ? "type_only"
        : "type_and_enter",
    voiceTranslationEnabled: config.voiceTranslationEnabled === true,
    voiceTranslationApiKey: String(config.voiceTranslationApiKey || ""),
    voiceTranslationModel: String(config.voiceTranslationModel || "deepseek-chat"),
    voiceTranslationBaseUrl: String(config.voiceTranslationBaseUrl || "https://api.deepseek.com"),
    voiceTranslationTimeoutMs: String(config.voiceTranslationTimeoutMs || "12000"),
    voiceTranslationPrompt: String(config.voiceTranslationPrompt || DEFAULT_VOICE_TRANSLATION_PROMPT),
    voiceTranslationTargetLanguage: normalizeVoiceTranslationTargetLanguage(
      config.voiceTranslationTargetLanguage
    ),
    voiceTranslationSendMode,
    voiceTranslationSendBilingual: voiceTranslationSendMode !== "target",
    lanSharedSecret: String(config.lanSharedSecret || ""),
    codexCwd: String(config.codexCwd || ""),
    claudeCwd: String(config.claudeCwd || ""),
    codexSkipGitRepoCheck: Boolean(config.codexSkipGitRepoCheck),
    claudeDangerouslySkipPermissions: Boolean(config.claudeDangerouslySkipPermissions),
    xiaomiRemoteEnabled: config.xiaomiRemoteEnabled === true,
    xiaomiRemoteButtonMap: String(config.xiaomiRemoteButtonMap || ""),
    desktopSettings: normalizeDesktopSettings(desktopSettings),
    configIssues: getConfigIssues(config),
    loadedConfigFiles: [...(config.loadedConfigFiles || [])],
    overrideFiles: (config.loadedConfigFiles || []).filter((filePath) => filePath !== config.userConfigPath),
    userConfigPath: config.userConfigPath,
    cwdConfigPath: config.cwdConfigPath,
    projectConfigPath: config.projectConfigPath,
    port: config.port,
    discoveryPort: config.discoveryPort
  };
}

export function buildUserConfigUpdates(formState = {}) {
  const sendTarget = normalizeChoice(formState.sendTarget, "text_injector", VALID_SEND_TARGETS);
  const sttProvider = normalizeChoice(formState.sttProvider, "volcengine", VALID_STT_PROVIDERS);
  const voiceTranslationSendMode = normalizeVoiceTranslationSendMode(
    formState.voiceTranslationSendMode,
    formState.voiceTranslationSendBilingual === true
  );

  return {
    SEND_TARGET: sendTarget,
    STT_PROVIDER: sttProvider,
    OPENAI_API_KEY: normalizeOptionalText(formState.openaiApiKey),
    OPENAI_TRANSCRIBE_MODEL: normalizeOptionalText(formState.openaiModel),
    VOLCENGINE_APP_KEY: normalizeOptionalText(formState.volcengineAppKey),
    VOLCENGINE_ACCESS_KEY: normalizeOptionalText(formState.volcengineAccessKey),
    TRANSCRIPT_DELIVERY_MODE:
      String(formState.transcriptDeliveryMode || "").trim().toLowerCase() === "immediate"
        ? "immediate"
        : "confirm_on_device",
    TEXT_INJECTION_MODE:
      String(formState.textInjectionMode || "").trim().toLowerCase() === "type_only"
        ? "type_only"
        : "type_and_enter",
    VOICE_TRANSLATION_ENABLED: formState.voiceTranslationEnabled ? "1" : null,
    VOICE_TRANSLATION_PROVIDER: formState.voiceTranslationEnabled ? "deepseek" : null,
    VOICE_TRANSLATION_API_KEY: formState.voiceTranslationEnabled
      ? normalizeOptionalText(formState.voiceTranslationApiKey)
      : null,
    VOICE_TRANSLATION_MODEL: formState.voiceTranslationEnabled
      ? normalizeOptionalText(formState.voiceTranslationModel) || "deepseek-chat"
      : null,
    VOICE_TRANSLATION_BASE_URL: formState.voiceTranslationEnabled
      ? normalizeOptionalText(formState.voiceTranslationBaseUrl) || "https://api.deepseek.com"
      : null,
    VOICE_TRANSLATION_TIMEOUT_MS: formState.voiceTranslationEnabled
      ? normalizeOptionalText(formState.voiceTranslationTimeoutMs) || "12000"
      : null,
    VOICE_TRANSLATION_PROMPT: formState.voiceTranslationEnabled
      ? normalizeOptionalText(formState.voiceTranslationPrompt) || DEFAULT_VOICE_TRANSLATION_PROMPT
      : null,
    VOICE_TRANSLATION_TARGET_LANGUAGE: formState.voiceTranslationEnabled
      ? normalizeVoiceTranslationTargetLanguage(formState.voiceTranslationTargetLanguage)
      : null,
    VOICE_TRANSLATION_SEND_MODE: formState.voiceTranslationEnabled ? voiceTranslationSendMode : null,
    VOICE_TRANSLATION_SEND_BILINGUAL:
      formState.voiceTranslationEnabled && voiceTranslationSendMode !== "target" ? "1" : null,
    LAN_SHARED_SECRET: normalizeOptionalText(formState.lanSharedSecret),
    CODEX_CWD: normalizeOptionalText(formState.codexCwd),
    CLAUDE_CWD: normalizeOptionalText(formState.claudeCwd),
    CODEX_SKIP_GIT_REPO_CHECK: formState.codexSkipGitRepoCheck ? "1" : null,
    CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS: formState.claudeDangerouslySkipPermissions ? "1" : null,
    XIAOMI_REMOTE_ENABLED: formState.xiaomiRemoteEnabled ? "1" : null,
    XIAOMI_REMOTE_BUTTON_MAP: normalizeOptionalText(formState.xiaomiRemoteButtonMap)
  };
}
