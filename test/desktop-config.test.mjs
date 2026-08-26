import test from "node:test";
import assert from "node:assert/strict";

import { buildDesktopFormState, buildUserConfigUpdates } from "../src/desktop-config.mjs";
import { normalizeDesktopSettings } from "../src/desktop-settings.mjs";
import { listConfigFileCandidatesForMode, resolveSendTarget } from "../src/config.mjs";

test("normalizeDesktopSettings applies safe defaults", () => {
  assert.deepEqual(normalizeDesktopSettings(), {
    autoLaunch: false,
    launchToTray: false,
    closeToTray: false,
    recordTranscripts: true,
    overlayX: null,
    overlayY: null,
    localMicHoldKey: "F8",
    localMicSendKey: "F9",
    localMicUndoKey: "F10",
    localMicTranslationToggleKey: "F7",
    uiLanguage: "zh",
    hasUsedVoice: false
  });

  assert.deepEqual(
    normalizeDesktopSettings({
      autoLaunch: true,
      launchToTray: true,
      closeToTray: false,
      localMicHoldKey: "Ctrl+Alt+M",
      localMicSendKey: "F11",
      localMicUndoKey: "Ctrl+Backspace",
      localMicTranslationToggleKey: "Ctrl+Alt+E"
    }),
    {
      autoLaunch: true,
      launchToTray: true,
      closeToTray: false,
      localMicHoldKey: "Ctrl+Alt+M",
      localMicSendKey: "F11",
      localMicUndoKey: "Ctrl+Backspace",
      localMicTranslationToggleKey: "Ctrl+Alt+E",
      recordTranscripts: true,
      overlayX: null,
      overlayY: null,
      uiLanguage: "zh",
      hasUsedVoice: false
    }
  );
});

test("buildDesktopFormState exposes effective config values for the desktop UI", () => {
  const formState = buildDesktopFormState(
    {
      sendTarget: "claude_code",
      sttProvider: "openai",
      openaiApiKey: "sk-test",
      openaiModel: "gpt-4o-mini-transcribe",
      volcengineAppKey: "",
      volcengineAccessKey: "",
      transcriptDeliveryMode: "immediate",
      textInjectionMode: "type_only",
      voiceTranslationEnabled: true,
      voiceTranslationApiKey: "translation-key",
      voiceTranslationModel: "deepseek-chat",
      voiceTranslationBaseUrl: "https://api.deepseek.com",
      voiceTranslationTimeoutMs: 12000,
      voiceTranslationPrompt: "Translate to idiomatic English.",
      voiceTranslationTargetLanguage: "korean",
      voiceTranslationSendMode: "all",
      lanSharedSecret: "secret",
      codexCwd: "D:/codex",
      claudeCwd: "D:/claude",
      codexSkipGitRepoCheck: true,
      claudeDangerouslySkipPermissions: true,
      loadedConfigFiles: ["C:/Users/test/AppData/Roaming/vibecoding-voice/config.env", "D:/github/app/.env"],
      userConfigPath: "C:/Users/test/AppData/Roaming/vibecoding-voice/config.env",
      cwdConfigPath: "D:/github/app/.env",
      projectConfigPath: "D:/github/vibecoding-voice/.env",
      port: 8765,
      discoveryPort: 8766
    },
    {
      autoLaunch: true,
      launchToTray: true,
      closeToTray: false,
      localMicHoldKey: "Ctrl+Shift+Space",
      localMicSendKey: "F9",
      localMicUndoKey: "F10",
      localMicTranslationToggleKey: "F7"
    }
  );

  assert.equal(formState.sendTarget, "claude_code");
  assert.equal(formState.sttProvider, "openai");
  assert.equal(formState.openaiModel, "gpt-4o-mini-transcribe");
  assert.equal(formState.transcriptDeliveryMode, "immediate");
  assert.equal(formState.textInjectionMode, "type_only");
  assert.equal(formState.voiceTranslationEnabled, true);
  assert.equal(formState.voiceTranslationApiKey, "translation-key");
  assert.equal(formState.voiceTranslationPrompt, "Translate to idiomatic English.");
  assert.equal(formState.voiceTranslationTargetLanguage, "korean");
  assert.equal(formState.voiceTranslationSendMode, "all");
  assert.equal(formState.voiceTranslationSendBilingual, true);
  assert.deepEqual(formState.overrideFiles, ["D:/github/app/.env"]);
  assert.deepEqual(formState.desktopSettings, {
    recordTranscripts: true,
    overlayX: null,
    overlayY: null,
    autoLaunch: true,
    launchToTray: true,
    closeToTray: false,
    localMicHoldKey: "Ctrl+Shift+Space",
    localMicSendKey: "F9",
    localMicUndoKey: "F10",
    localMicTranslationToggleKey: "F7",
    uiLanguage: "zh",
    hasUsedVoice: false
  });
});

test("buildUserConfigUpdates normalizes desktop form payload into env values", () => {
  const updates = buildUserConfigUpdates({
    sendTarget: "codex_exec",
    sttProvider: "volcengine",
    openaiApiKey: "sk-keep",
    openaiModel: "whisper-1",
    volcengineAppKey: "app-key",
    volcengineAccessKey: "access-key",
    transcriptDeliveryMode: "immediate",
    textInjectionMode: "type_only",
    voiceTranslationEnabled: true,
    voiceTranslationApiKey: "translation-key",
    voiceTranslationModel: "deepseek-chat",
    voiceTranslationBaseUrl: "https://api.deepseek.com",
    voiceTranslationTimeoutMs: "12000",
    voiceTranslationPrompt: "Translate to idiomatic English.",
    voiceTranslationTargetLanguage: "japanese",
    voiceTranslationSendMode: "zh_en",
    lanSharedSecret: "",
    codexCwd: "D:/workspace",
    claudeCwd: "",
    codexSkipGitRepoCheck: true,
    claudeDangerouslySkipPermissions: false
  });

  assert.deepEqual(updates, {
    SEND_TARGET: "codex_exec",
    STT_PROVIDER: "volcengine",
    OPENAI_API_KEY: "sk-keep",
    OPENAI_TRANSCRIBE_MODEL: "whisper-1",
    VOLCENGINE_APP_KEY: "app-key",
    VOLCENGINE_ACCESS_KEY: "access-key",
    TRANSCRIPT_DELIVERY_MODE: "immediate",
    TEXT_INJECTION_MODE: "type_only",
    VOICE_TRANSLATION_ENABLED: "1",
    VOICE_TRANSLATION_PROVIDER: "deepseek",
    VOICE_TRANSLATION_API_KEY: "translation-key",
    VOICE_TRANSLATION_MODEL: "deepseek-chat",
    VOICE_TRANSLATION_BASE_URL: "https://api.deepseek.com",
    VOICE_TRANSLATION_TIMEOUT_MS: "12000",
    VOICE_TRANSLATION_PROMPT: "Translate to idiomatic English.",
    VOICE_TRANSLATION_TARGET_LANGUAGE: "japanese",
    VOICE_TRANSLATION_SEND_MODE: "zh_en",
    VOICE_TRANSLATION_SEND_BILINGUAL: "1",
    LAN_SHARED_SECRET: null,
    CODEX_CWD: "D:/workspace",
    CLAUDE_CWD: null,
    CODEX_SKIP_GIT_REPO_CHECK: "1",
    CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS: null,
    XIAOMI_REMOTE_ENABLED: null,
    XIAOMI_REMOTE_BUTTON_MAP: null,
    XIAOMI_REMOTE_PROMPT_TEMPLATES: null
  });
});

test("resolveSendTarget defaults desktop mode to inject", () => {
  const resolved = resolveSendTarget("", {
    desktopMode: true,
    claudeCommand: "claude",
    codexCommand: "codex",
    platform: "win32"
  });

  assert.deepEqual(resolved, {
    sendTarget: "text_injector",
    sendTargetAuto: false
  });
});

test("resolveSendTarget auto-detects CLI target in Linux desktop mode", () => {
  const resolved = resolveSendTarget("", {
    desktopMode: true,
    claudeCommand: "claude",
    codexCommand: "codex",
    platform: "linux",
    cliAvailable: (command) => command === "codex"
  });

  assert.deepEqual(resolved, {
    sendTarget: "codex_exec",
    sendTargetAuto: true
  });
});

test("resolveSendTarget still preserves explicit desktop mode selection", () => {
  const resolved = resolveSendTarget("codex_exec", {
    desktopMode: true,
    claudeCommand: "claude",
    codexCommand: "codex"
  });

  assert.deepEqual(resolved, {
    sendTarget: "codex_exec",
    sendTargetAuto: false
  });
});

test("desktop mode env limits config search to the user config file", () => {
  const previousDesktopEnv = process.env.VIBE_DESKTOP;

  process.env.VIBE_DESKTOP = "1";
  try {
    const candidates = listConfigFileCandidatesForMode();
    assert.equal(candidates.length, 1);
    assert.match(candidates[0], /config\.env$/);
  } finally {
    if (previousDesktopEnv === undefined) {
      delete process.env.VIBE_DESKTOP;
    } else {
      process.env.VIBE_DESKTOP = previousDesktopEnv;
    }
  }
});
