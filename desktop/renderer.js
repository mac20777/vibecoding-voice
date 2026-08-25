const elements = {
  statusPill: document.querySelector("#status-pill"),
  footerServiceStatus: document.querySelector("#footer-service-status"),
  serviceMode: document.querySelector("#service-mode"),
  servicePort: document.querySelector("#service-port"),
  cliStatus: document.querySelector("#cli-status"),
  serviceMessage: document.querySelector("#service-message"),
  configIssues: document.querySelector("#config-issues"),
  overrideFiles: document.querySelector("#override-files"),
  form: document.querySelector("#settings-form"),
  tabButtons: [...document.querySelectorAll("[data-tab-trigger]")],
  tabPanels: [...document.querySelectorAll("[data-tab-panel]")],
  sendTarget: document.querySelector("#send-target"),
  sttProvider: document.querySelector("#stt-provider"),
  transcriptDeliveryMode: document.querySelector("#transcript-delivery-mode"),
  textInjectionMode: document.querySelector("#text-injection-mode"),
  voiceTranslationEnabled: document.querySelector("#voice-translation-enabled"),
  voiceTranslationApiKey: document.querySelector("#voice-translation-api-key"),
  voiceTranslationModel: document.querySelector("#voice-translation-model"),
  voiceTranslationBaseUrl: document.querySelector("#voice-translation-base-url"),
  voiceTranslationTimeoutMs: document.querySelector("#voice-translation-timeout-ms"),
  voiceTranslationPrompt: document.querySelector("#voice-translation-prompt"),
  voiceTranslationTargetLanguage: document.querySelector("#voice-translation-target-language"),
  voiceTranslationSendMode: document.querySelector("#voice-translation-send-mode"),
  openaiApiKey: document.querySelector("#openai-api-key"),
  openaiModel: document.querySelector("#openai-model"),
  volcengineAppKey: document.querySelector("#volcengine-app-key"),
  volcengineAccessKey: document.querySelector("#volcengine-access-key"),
  lanSharedSecret: document.querySelector("#lan-shared-secret"),
  codexCwd: document.querySelector("#codex-cwd"),
  claudeCwd: document.querySelector("#claude-cwd"),
  autoLaunch: document.querySelector("#auto-launch"),
  launchToTray: document.querySelector("#launch-to-tray"),
  closeToTray: document.querySelector("#close-to-tray"),
  codexSkipGitRepoCheck: document.querySelector("#codex-skip-git-repo-check"),
  claudeDangerouslySkipPermissions: document.querySelector("#claude-dangerously-skip-permissions"),
  summaryMode: document.querySelector("#summary-mode"),
  summaryDelivery: document.querySelector("#summary-delivery"),
  summaryProvider: document.querySelector("#summary-provider"),
  summaryProviderDetail: document.querySelector("#summary-provider-detail"),
  summaryLaunch: document.querySelector("#summary-launch"),
  summaryWindowBehavior: document.querySelector("#summary-window-behavior"),
  userConfigPath: document.querySelector("#user-config-path"),
  desktopSettingsPath: document.querySelector("#desktop-settings-path"),
  lastTranscript: document.querySelector("#last-transcript"),
  lastUserText: document.querySelector("#last-user-text"),
  lastAssistantText: document.querySelector("#last-assistant-text"),
  cliLogTail: document.querySelector("#cli-log-tail"),
  serviceLogTail: document.querySelector("#service-log-tail"),
  startServiceButton: document.querySelector("#start-service-button"),
  restartServiceButton: document.querySelector("#restart-service-button"),
  stopServiceButton: document.querySelector("#stop-service-button"),
  saveSettingsButton: document.querySelector("#save-settings-button"),
  openConfigFolderButton: document.querySelector("#open-config-folder-button"),
  pickCodexCwdButton: document.querySelector("#pick-codex-cwd-button"),
  pickClaudeCwdButton: document.querySelector("#pick-claude-cwd-button"),
  localMicButton: document.querySelector("#local-mic-button"),
  localMicButtonLabel: document.querySelector("#local-mic-button-label"),
  localMicSendButton: document.querySelector("#local-mic-send-button"),
  localMicUndoButton: document.querySelector("#local-mic-undo-button"),
  localMicState: document.querySelector("#local-mic-state"),
  localMicHint: document.querySelector("#local-mic-hint"),
  localMicHoldKey: document.querySelector("#local-mic-hold-key"),
  localMicSendKey: document.querySelector("#local-mic-send-key"),
  localMicUndoKey: document.querySelector("#local-mic-undo-key"),
  localMicTranslationToggleKey: document.querySelector("#local-mic-translation-toggle-key"),
  captureLocalMicHoldKeyButton: document.querySelector("#capture-local-mic-hold-key-button"),
  resetLocalMicHoldKeyButton: document.querySelector("#reset-local-mic-hold-key-button"),
  captureLocalMicSendKeyButton: document.querySelector("#capture-local-mic-send-key-button"),
  resetLocalMicSendKeyButton: document.querySelector("#reset-local-mic-send-key-button"),
  captureLocalMicUndoKeyButton: document.querySelector("#capture-local-mic-undo-key-button"),
  resetLocalMicUndoKeyButton: document.querySelector("#reset-local-mic-undo-key-button"),
  captureLocalMicTranslationToggleKeyButton: document.querySelector("#capture-local-mic-translation-toggle-key-button"),
  resetLocalMicTranslationToggleKeyButton: document.querySelector("#reset-local-mic-translation-toggle-key-button"),
  localMicActivity: document.querySelector("#local-mic-activity"),
  localMicDb: document.querySelector("#local-mic-db"),
  localMicBars: [...document.querySelectorAll("[data-local-mic-bar]")]
};

const DEFAULT_LOCAL_MIC_HOLD_KEY = "F8";
const DEFAULT_LOCAL_MIC_SEND_KEY = "F9";
const DEFAULT_LOCAL_MIC_UNDO_KEY = "F10";
const DEFAULT_LOCAL_MIC_TRANSLATION_TOGGLE_KEY = "F7";
const LOCAL_MIC_SAMPLE_RATE = 16000;
const SOCKET_READY_TIMEOUT_MS = 7000;

const liveState = {
  transcript: "",
  userText: "",
  assistantText: "",
  cliStatus: "尚未连接",
  cliLogLines: []
};

const appState = {
  bootstrap: null,
  service: null,
  socket: null,
  socketReady: false,
  reconnectTimer: null,
  socketPort: null
};

const localMic = {
  stream: null,
  context: null,
  source: null,
  processor: null,
  holdKey: DEFAULT_LOCAL_MIC_HOLD_KEY,
  sendKey: DEFAULT_LOCAL_MIC_SEND_KEY,
  undoKey: DEFAULT_LOCAL_MIC_UNDO_KEY,
  translationToggleKey: DEFAULT_LOCAL_MIC_TRANSLATION_TOGGLE_KEY,
  recording: false,
  starting: false,
  stopping: false,
  stopAfterStart: false,
  awaitingAction: false,
  sessionActive: false,
  capturingHotkey: null,
  globalHotkeysReady: false,
  activeHotkeyCode: null,
  level: 0,
  db: null,
  status: "idle",
  error: ""
};

function modeLabel(mode) {
  if (mode === "claude_code") {
    return "Claude Code";
  }
  if (mode === "codex_exec") {
    return "Codex";
  }
  return "输入注入";
}

function providerLabel(provider) {
  return provider === "openai" ? "OpenAI" : "Volcengine";
}

function deliveryLabel(mode) {
  return mode === "immediate" ? "识别完成立即发送" : "设备确认后发送";
}

function injectionLabel(mode) {
  return mode === "type_only" ? "仅输入文本" : "输入并回车";
}

function launchLabel({ autoLaunch, launchToTray }) {
  if (autoLaunch && launchToTray) {
    return "开机后隐藏启动";
  }
  if (autoLaunch) {
    return "开机自启";
  }
  return "手动启动";
}

function windowBehaviorLabel({ closeToTray }) {
  return closeToTray ? "关闭窗口时最小化到托盘" : "关闭窗口后仍保留界面";
}

function translationTargetLabel(language) {
  if (language === "korean") {
    return "韩语";
  }
  if (language === "japanese") {
    return "日语";
  }
  return "英语";
}

function translationSendModeLabel(mode) {
  if (mode === "all") {
    return "中文+英韩日";
  }
  if (mode === "zh_en") {
    return "中文+英语";
  }
  if (mode === "bilingual") {
    return "中文+目标语言";
  }
  return "只发目标语言";
}

function statusClass(status) {
  if (status === "running") {
    return "status-running";
  }
  if (status === "starting") {
    return "status-starting";
  }
  if (status === "needs_setup") {
    return "status-warning";
  }
  if (status === "error") {
    return "status-error";
  }
  return "status-stopped";
}

function serviceStatusLabel(status) {
  if (status === "running") {
    return "运行中";
  }
  if (status === "starting") {
    return "启动中";
  }
  if (status === "needs_setup") {
    return "待配置";
  }
  if (status === "error") {
    return "异常";
  }
  return "已停止";
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function displayHotkey(hotkey) {
  return String(hotkey || "").replace(/\+/g, " + ");
}

function eventToHotkey(event) {
  const code = event.code || "";
  const key = event.key || "";
  const ignoredCodes = new Set([
    "AltLeft",
    "AltRight",
    "ControlLeft",
    "ControlRight",
    "MetaLeft",
    "MetaRight",
    "ShiftLeft",
    "ShiftRight"
  ]);

  if (ignoredCodes.has(code) || ["Alt", "Control", "Meta", "Shift"].includes(key)) {
    return null;
  }

  const parts = [];
  if (event.ctrlKey) {
    parts.push("Ctrl");
  }
  if (event.altKey) {
    parts.push("Alt");
  }
  if (event.shiftKey) {
    parts.push("Shift");
  }
  if (event.metaKey) {
    parts.push("Meta");
  }

  parts.push(normalizeShortcutKey(code, key));
  return parts.join("+");
}

function normalizeShortcutKey(code, key) {
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3);
  }
  if (/^Digit[0-9]$/.test(code)) {
    return code.slice(5);
  }
  if (/^Numpad[0-9]$/.test(code)) {
    return code;
  }
  if (code === "Space") {
    return "Space";
  }
  if (code) {
    return code;
  }
  return String(key || "").toUpperCase();
}

function isEditableTarget(target) {
  if (!(target instanceof Element)) {
    return false;
  }
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function normalizeUiHotkey(hotkey, fallback) {
  return String(hotkey || fallback).replace(/\s+/g, "");
}

function setLocalMicHotkeys(settings = {}) {
  localMic.holdKey = normalizeUiHotkey(settings.localMicHoldKey, DEFAULT_LOCAL_MIC_HOLD_KEY);
  localMic.sendKey = normalizeUiHotkey(settings.localMicSendKey, DEFAULT_LOCAL_MIC_SEND_KEY);
  localMic.undoKey = normalizeUiHotkey(settings.localMicUndoKey, DEFAULT_LOCAL_MIC_UNDO_KEY);
  localMic.translationToggleKey = normalizeUiHotkey(
    settings.localMicTranslationToggleKey,
    DEFAULT_LOCAL_MIC_TRANSLATION_TOGGLE_KEY
  );
  elements.localMicHoldKey.value = displayHotkey(localMic.holdKey);
  elements.localMicSendKey.value = displayHotkey(localMic.sendKey);
  elements.localMicUndoKey.value = displayHotkey(localMic.undoKey);
  elements.localMicTranslationToggleKey.value = displayHotkey(localMic.translationToggleKey);
  renderLocalMic();
}

function setLocalMicStatus(status, error = "") {
  localMic.status = status;
  localMic.error = error;
  renderLocalMic();
}

function localMicStatusText() {
  if (localMic.capturingHotkey) {
    return { state: "录入中", hint: "按下新的快捷键" };
  }
  if (localMic.status === "connecting") {
    return { state: "准备中", hint: "正在连接本地服务和麦克风" };
  }
  if (localMic.status === "recording") {
    return { state: "录音中", hint: `松开 ${displayHotkey(localMic.holdKey)} 结束` };
  }
  if (localMic.status === "transcribing") {
    return { state: "识别中", hint: "正在提交给语音识别服务" };
  }
  if (localMic.status === "awaiting_action") {
    return { state: "待确认", hint: `按 ${displayHotkey(localMic.sendKey)} 发送，${displayHotkey(localMic.undoKey)} 撤销` };
  }
  if (localMic.status === "error") {
    return { state: "异常", hint: localMic.error || "麦克风不可用" };
  }
  return {
    state: "待命",
    hint:
      `${localMic.globalHotkeysReady ? "后台可用" : "窗口内可用"} · ` +
      `按住 ${displayHotkey(localMic.holdKey)} 输入，${displayHotkey(localMic.translationToggleKey)} 英文输出`
  };
}

function renderLocalMic() {
  const { state, hint } = localMicStatusText();
  elements.localMicState.textContent = state;
  elements.localMicHint.textContent = hint;
  elements.localMicButtonLabel.textContent = localMic.recording
    ? "松开结束"
    : `按住 ${displayHotkey(localMic.holdKey)}`;
  elements.localMicButton.classList.toggle("is-recording", localMic.recording);
  elements.localMicButton.disabled = localMic.starting || localMic.stopping || localMic.capturingHotkey;
  elements.localMicSendButton.disabled =
    localMic.recording || localMic.starting || localMic.stopping || localMic.capturingHotkey;
  elements.localMicUndoButton.disabled = !localMic.awaitingAction || localMic.recording || localMic.starting;
  elements.localMicSendButton.textContent = `发送 ${displayHotkey(localMic.sendKey)}`;
  elements.localMicUndoButton.textContent = `撤销 ${displayHotkey(localMic.undoKey)}`;
  elements.captureLocalMicHoldKeyButton.textContent = localMic.capturingHotkey === "hold" ? "等待" : "录入";
  elements.captureLocalMicSendKeyButton.textContent = localMic.capturingHotkey === "send" ? "等待" : "录入";
  elements.captureLocalMicUndoKeyButton.textContent = localMic.capturingHotkey === "undo" ? "等待" : "录入";
  elements.captureLocalMicTranslationToggleKeyButton.textContent =
    localMic.capturingHotkey === "translationToggle" ? "等待" : "录入";
  elements.localMicActivity.textContent = localMic.recording
    ? "Recording"
    : localMic.status === "transcribing"
      ? "STT"
      : localMic.status === "awaiting_action"
        ? "Confirm"
        : "Idle";
  elements.localMicDb.textContent = localMic.db === null ? "-- dB" : `${Math.round(localMic.db)} dB`;

  const baseLevel = localMic.recording ? Math.max(localMic.level, 0.04) : 0.04;
  const multipliers = [0.42, 0.72, 1, 0.86, 0.66, 0.48, 0.32, 0.24];
  elements.localMicBars.forEach((bar, index) => {
    const height = Math.max(8, Math.min(100, baseLevel * multipliers[index] * 100));
    bar.style.height = `${height}%`;
  });
}

function sendBridgeJson(message) {
  if (!appState.socket || appState.socket.readyState !== WebSocket.OPEN || !appState.socketReady) {
    throw new Error("本地服务还没有连接。");
  }
  appState.socket.send(JSON.stringify(message));
}

async function ensureBridgeSocketReady() {
  let service = appState.service || appState.bootstrap?.service;
  if (!service || (service.status !== "running" && service.status !== "starting")) {
    const bootstrap = await window.vibeApp.startService();
    appState.bootstrap = bootstrap;
    appState.service = bootstrap.service;
    service = bootstrap.service;
    renderService();
  }

  if (!service || service.status === "needs_setup" || service.status === "error") {
    throw new Error(service?.message || "本地服务未就绪。");
  }

  connectLiveSocket();
  const startedAt = Date.now();
  while (Date.now() - startedAt < SOCKET_READY_TIMEOUT_MS) {
    if (appState.socket && appState.socket.readyState === WebSocket.OPEN && appState.socketReady) {
      return appState.socket;
    }
    await delay(80);
  }

  throw new Error("连接本地服务超时。");
}

function cleanupLocalAudio() {
  if (localMic.processor) {
    localMic.processor.disconnect();
    localMic.processor.onaudioprocess = null;
    localMic.processor = null;
  }
  if (localMic.source) {
    localMic.source.disconnect();
    localMic.source = null;
  }
  if (localMic.stream) {
    localMic.stream.getTracks().forEach((track) => track.stop());
    localMic.stream = null;
  }
  if (localMic.context) {
    void localMic.context.close().catch(() => {});
    localMic.context = null;
  }
  localMic.level = 0;
  localMic.db = null;
}

function floatToPcm16(samples) {
  const output = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

function resampleToPcm16(samples, inputRate) {
  if (!samples.length) {
    return new Int16Array(0);
  }
  if (inputRate === LOCAL_MIC_SAMPLE_RATE) {
    return floatToPcm16(samples);
  }

  const ratio = inputRate / LOCAL_MIC_SAMPLE_RATE;
  const outputLength = Math.max(1, Math.floor(samples.length / ratio));
  const output = new Int16Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const left = Math.floor(sourceIndex);
    const right = Math.min(left + 1, samples.length - 1);
    const fraction = sourceIndex - left;
    const sample = samples[left] + (samples[right] - samples[left]) * fraction;
    const clamped = Math.max(-1, Math.min(1, sample));
    output[index] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return output;
}

function updateLocalMicLevel(samples) {
  if (!samples.length) {
    localMic.level = 0;
    localMic.db = null;
    return;
  }

  let sum = 0;
  for (const sample of samples) {
    sum += sample * sample;
  }
  const rms = Math.sqrt(sum / samples.length);
  const db = 20 * Math.log10(Math.max(rms, 0.00001));
  localMic.db = db;
  localMic.level = Math.max(0, Math.min(1, (db + 60) / 60));
  renderLocalMic();
}

function handleLocalMicAudio(event) {
  const output = event.outputBuffer.getChannelData(0);
  output.fill(0);

  if (!localMic.recording || !appState.socket || appState.socket.readyState !== WebSocket.OPEN) {
    return;
  }

  const input = event.inputBuffer.getChannelData(0);
  updateLocalMicLevel(input);
  const pcm = resampleToPcm16(input, localMic.context?.sampleRate || event.inputBuffer.sampleRate);
  if (pcm.byteLength > 0) {
    appState.socket.send(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
  }
}

async function startLocalMicRecording() {
  if (localMic.recording || localMic.starting) {
    return;
  }

  let sentStart = false;
  localMic.starting = true;
  localMic.stopAfterStart = false;
  localMic.awaitingAction = false;
  localMic.sessionActive = true;
  setLocalMicStatus("connecting");

  try {
    await ensureBridgeSocketReady();
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("当前环境不支持浏览器麦克风采集。");
    }
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error("当前环境不支持 Web Audio。");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });
    const context = new AudioContextCtor();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);

    localMic.stream = stream;
    localMic.context = context;
    localMic.source = source;
    localMic.processor = processor;

    processor.onaudioprocess = handleLocalMicAudio;
    sendBridgeJson({
      type: "ptt_start",
      source: "desktop_mic",
      transcriptDeliveryMode: "immediate",
      textInjectionMode: "type_only"
    });
    sentStart = true;
    localMic.recording = true;
    source.connect(processor);
    processor.connect(context.destination);
    await context.resume();
    setLocalMicStatus("recording");

    if (localMic.stopAfterStart) {
      void stopLocalMicRecording();
    }
  } catch (error) {
    if (sentStart) {
      try {
        sendBridgeJson({ type: "ptt_stop", source: "desktop_mic" });
      } catch {
        // ignore best-effort segment cleanup failures
      }
    }
    cleanupLocalAudio();
    localMic.sessionActive = false;
    setLocalMicStatus("error", error instanceof Error ? error.message : String(error));
  } finally {
    localMic.starting = false;
    renderLocalMic();
  }
}

async function stopLocalMicRecording({ sendStop = true } = {}) {
  if (localMic.starting && !localMic.recording) {
    localMic.stopAfterStart = true;
    return;
  }
  if (!localMic.recording || localMic.stopping) {
    return;
  }

  localMic.stopping = true;
  localMic.recording = false;
  cleanupLocalAudio();
  setLocalMicStatus(sendStop ? "transcribing" : "error", sendStop ? "" : "本地服务连接已断开。");

  try {
    if (sendStop) {
      sendBridgeJson({ type: "ptt_stop", source: "desktop_mic" });
    } else {
      localMic.sessionActive = false;
    }
  } catch (error) {
    localMic.sessionActive = false;
    setLocalMicStatus("error", error instanceof Error ? error.message : String(error));
  } finally {
    localMic.stopping = false;
    renderLocalMic();
  }
}

async function sendLocalMicAction(type) {
  try {
    sendBridgeJson({ type });
    localMic.awaitingAction = false;
    localMic.sessionActive = false;
    setLocalMicStatus("idle");
  } catch (error) {
    setLocalMicStatus("error", error instanceof Error ? error.message : String(error));
  }
}

async function submitLocalMicInput() {
  if (localMic.recording || localMic.starting || localMic.stopping || localMic.capturingHotkey) {
    return;
  }

  try {
    await ensureBridgeSocketReady();
    sendBridgeJson({ type: "action_submit", source: "desktop_mic" });
    localMic.awaitingAction = false;
    localMic.sessionActive = false;
    setLocalMicStatus("idle");
  } catch (error) {
    setLocalMicStatus("error", error instanceof Error ? error.message : String(error));
  }
}

function sendOrSubmitLocalMic() {
  if (localMic.awaitingAction) {
    void sendLocalMicAction("action_send");
    return;
  }

  void submitLocalMicInput();
}

function finishLocalMicSessionFromBridge(message) {
  if (!localMic.sessionActive) {
    return;
  }

  if (message.type === "transcript_final") {
    localMic.awaitingAction = message.requiresAction === true;
    localMic.sessionActive = localMic.awaitingAction;
    setLocalMicStatus(localMic.awaitingAction ? "awaiting_action" : "idle");
    return;
  }

  if (message.type === "status") {
    if (message.status === "transcribing") {
      setLocalMicStatus("transcribing");
      return;
    }
    if (message.status === "awaiting_action") {
      localMic.awaitingAction = true;
      localMic.sessionActive = true;
      setLocalMicStatus("awaiting_action");
      return;
    }
    if (["typed", "empty_segment", "transcript_empty"].includes(message.status)) {
      localMic.awaitingAction = false;
      localMic.sessionActive = false;
      setLocalMicStatus("idle");
    }
  }
}

function setActiveTab(tabName) {
  elements.tabButtons.forEach((button) => {
    const isActive = button.getAttribute("data-tab-trigger") === tabName;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  elements.tabPanels.forEach((panel) => {
    const isActive = panel.getAttribute("data-tab-panel") === tabName;
    panel.classList.toggle("hidden", !isActive);
    panel.classList.toggle("is-active", isActive);
  });
}

function activateSideNav(targetName) {
  const normalized = String(targetName || "overview").trim();
  const targetToTab = {
    integrations: "speech",
    settings: "basics",
    workspace: "workspace",
    hotkeys: "speech"
  };

  if (targetToTab[normalized]) {
    setActiveTab(targetToTab[normalized]);
    updateFormAffordances();
  }

  const activeSideTarget = normalized === "logs" ? "transcript" : normalized;
  document.querySelectorAll(".side-nav-item").forEach((button) => {
    button.classList.toggle("is-active", button.getAttribute("data-side-target") === activeSideTarget);
  });

  const sectionName = ["hotkeys", "integrations"].includes(normalized) ? "settings" : normalized;
  const section = document.querySelector(`[data-section="${sectionName}"]`);
  if (section) {
    section.scrollIntoView({ block: "start", behavior: "smooth" });
  }
}

function updateProviderVisibility() {
  const activeProvider = elements.sttProvider.value;
  document.querySelectorAll("[data-provider-section]").forEach((section) => {
    const enabled = section.getAttribute("data-provider-section") === activeProvider;
    section.classList.toggle("hidden", !enabled);
  });
}

function updateModeVisibility() {
  const activeMode = elements.sendTarget.value;
  document.querySelectorAll("[data-mode-visible]").forEach((section) => {
    const enabled = section.getAttribute("data-mode-visible") === activeMode;
    section.classList.toggle("hidden", !enabled);
  });
}

function renderConfigSummary() {
  elements.summaryMode.textContent = modeLabel(elements.sendTarget.value);
  elements.summaryDelivery.textContent =
    elements.sendTarget.value === "text_injector"
      ? `${deliveryLabel(elements.transcriptDeliveryMode.value)} · ${injectionLabel(elements.textInjectionMode.value)}`
      : deliveryLabel(elements.transcriptDeliveryMode.value);
  elements.summaryProvider.textContent = providerLabel(elements.sttProvider.value);
  const sttDetail =
    elements.sttProvider.value === "openai"
      ? `模型：${elements.openaiModel.value || "whisper-1"}`
      : "适合中文语音环境";
  if (elements.voiceTranslationEnabled.checked) {
    elements.summaryProviderDetail.textContent =
      `${sttDetail} · 翻译开启 · ` +
      `目标：${translationTargetLabel(elements.voiceTranslationTargetLanguage.value)} · ` +
      translationSendModeLabel(elements.voiceTranslationSendMode.value);
  } else {
    elements.summaryProviderDetail.textContent = sttDetail;
  }
  elements.summaryLaunch.textContent = launchLabel({
    autoLaunch: elements.autoLaunch.checked,
    launchToTray: elements.launchToTray.checked
  });
  elements.summaryWindowBehavior.textContent = windowBehaviorLabel({
    closeToTray: elements.closeToTray.checked
  });
}

function updateFormAffordances() {
  updateProviderVisibility();
  updateModeVisibility();
  updateTranslationVisibility();
  renderConfigSummary();
}

function updateTranslationVisibility() {
  document.querySelectorAll("[data-translation-config]").forEach((section) => {
    section.classList.toggle("hidden", !elements.voiceTranslationEnabled.checked);
  });
}

function syncTrayLanguageMode() {
  window.vibeApp.setTrayLanguageMode?.(
    isEnglishTargetOnlyTranslation() ? "english" : "chinese"
  );
}

function applyVoiceTranslationState(message = {}) {
  const enabled = message.enabled ?? message.voiceTranslationEnabled;
  const targetLanguage = message.targetLanguage || message.voiceTranslationTargetLanguage;
  const sendMode = message.sendMode || message.voiceTranslationSendMode;

  if (enabled !== undefined) {
    elements.voiceTranslationEnabled.checked = Boolean(enabled);
  }
  if (["english", "korean", "japanese"].includes(targetLanguage)) {
    elements.voiceTranslationTargetLanguage.value = targetLanguage;
  }
  if (["target", "bilingual", "zh_en", "all"].includes(sendMode)) {
    elements.voiceTranslationSendMode.value = sendMode;
  }
  updateFormAffordances();
  syncTrayLanguageMode();
}

function isEnglishTargetOnlyTranslation() {
  return (
    elements.voiceTranslationEnabled.checked &&
    elements.voiceTranslationTargetLanguage.value === "english" &&
    elements.voiceTranslationSendMode.value === "target"
  );
}

async function toggleEnglishVoiceOutput() {
  if (localMic.capturingHotkey) {
    return;
  }

  try {
    await ensureBridgeSocketReady();
    if (isEnglishTargetOnlyTranslation()) {
      sendBridgeJson({ type: "set_voice_translation", enabled: false, source: "desktop_hotkey" });
      applyVoiceTranslationState({ enabled: false });
      elements.serviceMessage.textContent = "English output shortcut disabled translation.";
      return;
    }

    sendBridgeJson({
      type: "set_voice_translation_target_language",
      language: "english",
      source: "desktop_hotkey"
    });
    sendBridgeJson({ type: "set_voice_translation_send_mode", mode: "target", source: "desktop_hotkey" });
    sendBridgeJson({ type: "set_voice_translation", enabled: true, source: "desktop_hotkey" });
    applyVoiceTranslationState({ enabled: true, targetLanguage: "english", sendMode: "target" });
    elements.serviceMessage.textContent = "English output shortcut enabled.";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    elements.serviceMessage.textContent = message;
    if (!localMic.recording && !localMic.starting && !localMic.stopping) {
      setLocalMicStatus("error", message);
    }
  }
}

function collectFormPayload() {
  return {
    form: {
      sendTarget: elements.sendTarget.value,
      sttProvider: elements.sttProvider.value,
      transcriptDeliveryMode: elements.transcriptDeliveryMode.value,
      textInjectionMode: elements.textInjectionMode.value,
      voiceTranslationEnabled: elements.voiceTranslationEnabled.checked,
      voiceTranslationApiKey: elements.voiceTranslationApiKey.value,
      voiceTranslationModel: elements.voiceTranslationModel.value,
      voiceTranslationBaseUrl: elements.voiceTranslationBaseUrl.value,
      voiceTranslationTimeoutMs: elements.voiceTranslationTimeoutMs.value,
      voiceTranslationPrompt: elements.voiceTranslationPrompt.value,
      voiceTranslationTargetLanguage: elements.voiceTranslationTargetLanguage.value,
      voiceTranslationSendMode: elements.voiceTranslationSendMode.value,
      openaiApiKey: elements.openaiApiKey.value,
      openaiModel: elements.openaiModel.value,
      volcengineAppKey: elements.volcengineAppKey.value,
      volcengineAccessKey: elements.volcengineAccessKey.value,
      lanSharedSecret: elements.lanSharedSecret.value,
      codexCwd: elements.codexCwd.value,
      claudeCwd: elements.claudeCwd.value,
      codexSkipGitRepoCheck: elements.codexSkipGitRepoCheck.checked,
      claudeDangerouslySkipPermissions: elements.claudeDangerouslySkipPermissions.checked
    },
    desktopSettings: {
      autoLaunch: elements.autoLaunch.checked,
      launchToTray: elements.launchToTray.checked,
      closeToTray: elements.closeToTray.checked,
      localMicHoldKey: localMic.holdKey,
      localMicSendKey: localMic.sendKey,
      localMicUndoKey: localMic.undoKey,
      localMicTranslationToggleKey: localMic.translationToggleKey
    }
  };
}

function fillForm(form, desktopSettingsPath) {
  elements.sendTarget.value = form.sendTarget;
  elements.sttProvider.value = form.sttProvider;
  elements.transcriptDeliveryMode.value = form.transcriptDeliveryMode;
  elements.textInjectionMode.value = form.textInjectionMode;
  elements.voiceTranslationEnabled.checked = Boolean(form.voiceTranslationEnabled);
  elements.voiceTranslationApiKey.value = form.voiceTranslationApiKey || "";
  elements.voiceTranslationModel.value = form.voiceTranslationModel || "";
  elements.voiceTranslationBaseUrl.value = form.voiceTranslationBaseUrl || "";
  elements.voiceTranslationTimeoutMs.value = form.voiceTranslationTimeoutMs || "";
  elements.voiceTranslationPrompt.value = form.voiceTranslationPrompt || "";
  elements.voiceTranslationTargetLanguage.value = form.voiceTranslationTargetLanguage || "english";
  elements.voiceTranslationSendMode.value = form.voiceTranslationSendMode || "target";
  elements.openaiApiKey.value = form.openaiApiKey || "";
  elements.openaiModel.value = form.openaiModel || "";
  elements.volcengineAppKey.value = form.volcengineAppKey || "";
  elements.volcengineAccessKey.value = form.volcengineAccessKey || "";
  elements.lanSharedSecret.value = form.lanSharedSecret || "";
  elements.codexCwd.value = form.codexCwd || "";
  elements.claudeCwd.value = form.claudeCwd || "";
  elements.autoLaunch.checked = Boolean(form.desktopSettings?.autoLaunch);
  elements.launchToTray.checked = Boolean(form.desktopSettings?.launchToTray);
  elements.closeToTray.checked = Boolean(form.desktopSettings?.closeToTray);
  setLocalMicHotkeys(form.desktopSettings);
  elements.codexSkipGitRepoCheck.checked = Boolean(form.codexSkipGitRepoCheck);
  elements.claudeDangerouslySkipPermissions.checked = Boolean(form.claudeDangerouslySkipPermissions);
  elements.userConfigPath.textContent = form.userConfigPath || "";
  elements.desktopSettingsPath.textContent = desktopSettingsPath || "";
  updateFormAffordances();
  syncTrayLanguageMode();
}

function renderNotices(form) {
  const issues = form.configIssues || [];
  const overrideFiles = form.overrideFiles || [];

  if (issues.length > 0) {
    elements.configIssues.textContent = `当前配置不完整：${issues.join(" ")}`;
    elements.configIssues.classList.remove("hidden");
  } else {
    elements.configIssues.classList.add("hidden");
  }

  if (overrideFiles.length > 0) {
    elements.overrideFiles.textContent = [
      "注意：以下配置文件会覆盖用户配置，界面里保存的值可能不会立即生效：",
      ...overrideFiles.map((filePath) => `• ${filePath}`)
    ].join("\n");
    elements.overrideFiles.classList.remove("hidden");
  } else {
    elements.overrideFiles.classList.add("hidden");
  }
}

function renderService() {
  const service = appState.service || appState.bootstrap?.service;
  if (!service) {
    return;
  }

  elements.statusPill.textContent = serviceStatusLabel(service.status);
  elements.statusPill.className = `status-pill ${statusClass(service.status)}`;
  elements.footerServiceStatus.textContent = `Service ${serviceStatusLabel(service.status).toLowerCase()}`;
  elements.serviceMode.textContent = modeLabel(service.mode);
  elements.servicePort.textContent = String(service.port || appState.bootstrap?.form?.port || 8765);
  elements.serviceMessage.textContent = service.message || "等待启动。";
  elements.cliStatus.textContent = liveState.cliStatus;
  elements.serviceLogTail.textContent =
    service.logs && service.logs.length > 0 ? service.logs.join("\n") : "等待启动。";
  elements.startServiceButton.disabled = service.status === "running" || service.status === "starting";
  elements.restartServiceButton.disabled = service.status === "starting";
  elements.stopServiceButton.disabled = service.status === "stopped" || service.status === "needs_setup";
}

function renderLive() {
  elements.lastTranscript.textContent = liveState.transcript || "还没有收到语音";
  elements.lastUserText.textContent = liveState.userText || "等待中";
  elements.lastAssistantText.textContent = liveState.assistantText || "等待中";
  elements.cliLogTail.textContent =
    liveState.cliLogLines.length > 0 ? liveState.cliLogLines.join("\n") : "尚未连接。";
}

function resetLiveConnection() {
  if (appState.socket) {
    if (localMic.recording || localMic.starting) {
      void stopLocalMicRecording({ sendStop: false });
    }
    appState.socket.close();
    appState.socket = null;
  }
  appState.socketReady = false;
  appState.socketPort = null;
  if (appState.reconnectTimer) {
    clearTimeout(appState.reconnectTimer);
    appState.reconnectTimer = null;
  }
}

function scheduleReconnect() {
  if (appState.reconnectTimer) {
    return;
  }
  appState.reconnectTimer = setTimeout(() => {
    appState.reconnectTimer = null;
    connectLiveSocket();
  }, 1200);
}

function handleBridgeMessage(message) {
  finishLocalMicSessionFromBridge(message);

  if (message.type === "hello_ack") {
    appState.socketReady = true;
    return;
  }

  if (message.type === "server_ready") {
    appState.socketReady = true;
    liveState.cliStatus = `已连接 · ${modeLabel(message.sendTarget)}`;
    if (message.sendTarget) {
      elements.serviceMode.textContent = modeLabel(message.sendTarget);
    }
    applyVoiceTranslationState(message);
    renderService();
    return;
  }

  if (message.type === "voice_translation_state") {
    applyVoiceTranslationState(message);
    return;
  }

  if (message.type === "warning" && message.warning) {
    elements.serviceMessage.textContent = message.warning;
    return;
  }

  if (message.type === "cli_session_state") {
    liveState.cliStatus = message.statusLine || message.phase || "待命";
    renderService();
    return;
  }

  if (message.type === "cli_summary") {
    if (message.latestUserText !== undefined) {
      liveState.userText = message.latestUserText || "";
    }
    if (message.latestAssistantText !== undefined) {
      liveState.assistantText = message.latestAssistantText || "";
    }
    renderLive();
    return;
  }

  if (message.type === "cli_log_tail") {
    liveState.cliLogLines = Array.isArray(message.lines) ? message.lines : [];
    renderLive();
    return;
  }

  if (message.type === "transcript_final") {
    liveState.transcript = message.text || "";
    renderLive();
    return;
  }

  if (message.type === "status" && message.text) {
    liveState.transcript = message.text;
    renderLive();
  }
}

function connectLiveSocket() {
  const service = appState.service || appState.bootstrap?.service;
  if (!service || (service.status !== "running" && service.status !== "starting")) {
    resetLiveConnection();
    liveState.cliStatus = "服务未连接";
    renderService();
    return;
  }

  const port = service.port || appState.bootstrap?.form?.port || 8765;
  if (
    appState.socket &&
    appState.socketPort === port &&
    (appState.socket.readyState === WebSocket.OPEN || appState.socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  resetLiveConnection();

  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  appState.socket = socket;
  appState.socketPort = port;
  appState.socketReady = false;

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ type: "hello", deviceId: "desktop-window", boardType: "desktop-window" }));
  });

  socket.addEventListener("message", (event) => {
    try {
      const message = JSON.parse(String(event.data));
      handleBridgeMessage(message);
    } catch {
      // ignore malformed messages
    }
  });

  socket.addEventListener("close", () => {
    if (appState.socket === socket) {
      appState.socket = null;
      appState.socketPort = null;
      appState.socketReady = false;
    }
    if (localMic.recording || localMic.starting) {
      void stopLocalMicRecording({ sendStop: false });
    }
    liveState.cliStatus = "连接已断开";
    renderService();
    scheduleReconnect();
  });

  socket.addEventListener("error", () => {
    liveState.cliStatus = "无法连接到本地服务";
    renderService();
  });
}

async function refreshBootstrap() {
  const bootstrap = await window.vibeApp.getBootstrap();
  appState.bootstrap = bootstrap;
  appState.service = bootstrap.service;
  if (bootstrap.globalHotkeys) {
    localMic.globalHotkeysReady = Boolean(bootstrap.globalHotkeys.ready);
    setLocalMicHotkeys(bootstrap.globalHotkeys.settings || bootstrap.form.desktopSettings);
  }
  fillForm(bootstrap.form, bootstrap.desktopSettingsPath);
  renderNotices(bootstrap.form);
  renderService();
  renderLive();
  connectLiveSocket();
}

async function chooseDirectory(targetInput) {
  const nextValue = await window.vibeApp.pickDirectory(targetInput.value);
  if (nextValue) {
    targetInput.value = nextValue;
    updateFormAffordances();
  }
}

function handleGlobalHotkey(payload = {}) {
  if (payload.type === "status") {
    localMic.globalHotkeysReady = Boolean(payload.ready);
    if (payload.settings) {
      setLocalMicHotkeys(payload.settings);
    }
    renderLocalMic();
    return;
  }
  if (payload.type === "record_start") {
    void startLocalMicRecording();
    return;
  }
  if (payload.type === "record_stop") {
    void stopLocalMicRecording();
    return;
  }
  if (payload.type === "action_send") {
    sendOrSubmitLocalMic();
    return;
  }
  if (payload.type === "action_undo" && localMic.awaitingAction) {
    void sendLocalMicAction("action_undo");
    return;
  }
  if (payload.type === "toggle_english_output") {
    void toggleEnglishVoiceOutput();
  }
}

async function persistLocalMicHotkeys(patch = {}) {
  setLocalMicHotkeys({
    localMicHoldKey: patch.localMicHoldKey || localMic.holdKey,
    localMicSendKey: patch.localMicSendKey || localMic.sendKey,
    localMicUndoKey: patch.localMicUndoKey || localMic.undoKey,
    localMicTranslationToggleKey:
      patch.localMicTranslationToggleKey || localMic.translationToggleKey
  });
  const bootstrap = await window.vibeApp.updateDesktopSettings({
    localMicHoldKey: localMic.holdKey,
    localMicSendKey: localMic.sendKey,
    localMicUndoKey: localMic.undoKey,
    localMicTranslationToggleKey: localMic.translationToggleKey
  });
  appState.bootstrap = bootstrap;
  appState.service = bootstrap.service;
  if (bootstrap.globalHotkeys) {
    localMic.globalHotkeysReady = Boolean(bootstrap.globalHotkeys.ready);
  }
  renderService();
  renderLocalMic();
}

let localMicPointerActive = false;

elements.tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveTab(button.getAttribute("data-tab-trigger"));
  });
});

document.querySelectorAll("[data-side-target]").forEach((button) => {
  button.addEventListener("click", () => {
    activateSideNav(button.getAttribute("data-side-target"));
  });
});

document.querySelector("#collapse-sidebar-button")?.addEventListener("click", (event) => {
  const body = document.querySelector(".app-body");
  const collapsed = body?.classList.toggle("sidebar-collapsed") ?? false;
  event.currentTarget.setAttribute("aria-pressed", String(collapsed));
});

elements.sttProvider.addEventListener("change", updateFormAffordances);
elements.sendTarget.addEventListener("change", updateFormAffordances);
elements.transcriptDeliveryMode.addEventListener("change", renderConfigSummary);
elements.textInjectionMode.addEventListener("change", renderConfigSummary);
elements.voiceTranslationEnabled.addEventListener("change", updateFormAffordances);
elements.voiceTranslationTargetLanguage.addEventListener("change", renderConfigSummary);
elements.voiceTranslationSendMode.addEventListener("change", renderConfigSummary);
elements.openaiModel.addEventListener("input", renderConfigSummary);
elements.autoLaunch.addEventListener("change", renderConfigSummary);
elements.launchToTray.addEventListener("change", renderConfigSummary);
elements.closeToTray.addEventListener("change", renderConfigSummary);

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.saveSettingsButton.disabled = true;
  try {
    const bootstrap = await window.vibeApp.saveConfig(collectFormPayload());
    appState.bootstrap = bootstrap;
    appState.service = bootstrap.service;
    fillForm(bootstrap.form, bootstrap.desktopSettingsPath);
    renderNotices(bootstrap.form);
    renderService();
    connectLiveSocket();
  } finally {
    elements.saveSettingsButton.disabled = false;
  }
});

elements.startServiceButton.addEventListener("click", async () => {
  const bootstrap = await window.vibeApp.startService();
  appState.bootstrap = bootstrap;
  appState.service = bootstrap.service;
  renderService();
  connectLiveSocket();
});

elements.restartServiceButton.addEventListener("click", async () => {
  const bootstrap = await window.vibeApp.restartService();
  appState.bootstrap = bootstrap;
  appState.service = bootstrap.service;
  renderService();
  connectLiveSocket();
});

elements.stopServiceButton.addEventListener("click", async () => {
  const bootstrap = await window.vibeApp.stopService();
  appState.bootstrap = bootstrap;
  appState.service = bootstrap.service;
  renderService();
  connectLiveSocket();
});

elements.openConfigFolderButton.addEventListener("click", () => {
  activateSideNav("logs");
});

elements.pickCodexCwdButton.addEventListener("click", () => chooseDirectory(elements.codexCwd));
elements.pickClaudeCwdButton.addEventListener("click", () => chooseDirectory(elements.claudeCwd));

function beginHotkeyCapture(target) {
  localMic.capturingHotkey = target;
  const input = target === "send"
    ? elements.localMicSendKey
    : target === "undo"
      ? elements.localMicUndoKey
      : target === "translationToggle"
        ? elements.localMicTranslationToggleKey
        : elements.localMicHoldKey;
  input.value = "按下新的快捷键...";
  input.focus();
  renderLocalMic();
}

function persistCapturedHotkey(hotkey) {
  const target = localMic.capturingHotkey;
  localMic.capturingHotkey = null;
  if (target === "send") {
    void persistLocalMicHotkeys({ localMicSendKey: hotkey });
    return;
  }
  if (target === "undo") {
    void persistLocalMicHotkeys({ localMicUndoKey: hotkey });
    return;
  }
  if (target === "translationToggle") {
    void persistLocalMicHotkeys({ localMicTranslationToggleKey: hotkey });
    return;
  }
  void persistLocalMicHotkeys({ localMicHoldKey: hotkey });
}

elements.captureLocalMicHoldKeyButton.addEventListener("click", () => beginHotkeyCapture("hold"));
elements.captureLocalMicSendKeyButton.addEventListener("click", () => beginHotkeyCapture("send"));
elements.captureLocalMicUndoKeyButton.addEventListener("click", () => beginHotkeyCapture("undo"));
elements.captureLocalMicTranslationToggleKeyButton.addEventListener("click", () =>
  beginHotkeyCapture("translationToggle")
);

elements.resetLocalMicHoldKeyButton.addEventListener("click", () => {
  localMic.capturingHotkey = null;
  void persistLocalMicHotkeys({ localMicHoldKey: DEFAULT_LOCAL_MIC_HOLD_KEY });
});

elements.resetLocalMicSendKeyButton.addEventListener("click", () => {
  localMic.capturingHotkey = null;
  void persistLocalMicHotkeys({ localMicSendKey: DEFAULT_LOCAL_MIC_SEND_KEY });
});

elements.resetLocalMicUndoKeyButton.addEventListener("click", () => {
  localMic.capturingHotkey = null;
  void persistLocalMicHotkeys({ localMicUndoKey: DEFAULT_LOCAL_MIC_UNDO_KEY });
});

elements.resetLocalMicTranslationToggleKeyButton.addEventListener("click", () => {
  localMic.capturingHotkey = null;
  void persistLocalMicHotkeys({
    localMicTranslationToggleKey: DEFAULT_LOCAL_MIC_TRANSLATION_TOGGLE_KEY
  });
});

elements.localMicButton.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || localMic.capturingHotkey) {
    return;
  }
  event.preventDefault();
  localMicPointerActive = true;
  void startLocalMicRecording();
});

window.addEventListener("pointerup", () => {
  if (!localMicPointerActive) {
    return;
  }
  localMicPointerActive = false;
  void stopLocalMicRecording();
});

window.addEventListener("pointercancel", () => {
  if (!localMicPointerActive) {
    return;
  }
  localMicPointerActive = false;
  void stopLocalMicRecording();
});

elements.localMicSendButton.addEventListener("click", () => {
  sendOrSubmitLocalMic();
});

elements.localMicUndoButton.addEventListener("click", () => {
  void sendLocalMicAction("action_undo");
});

document.addEventListener("keydown", (event) => {
  const hotkey = eventToHotkey(event);
  if (localMic.capturingHotkey) {
    if (!hotkey) {
      return;
    }
    event.preventDefault();
    persistCapturedHotkey(hotkey);
    return;
  }

  if (localMic.globalHotkeysReady || !hotkey || event.repeat || isEditableTarget(event.target)) {
    return;
  }
  if (hotkey !== localMic.holdKey) {
    if (hotkey === localMic.sendKey) {
      event.preventDefault();
      sendOrSubmitLocalMic();
      return;
    }
    if (hotkey === localMic.undoKey && localMic.awaitingAction) {
      event.preventDefault();
      void sendLocalMicAction("action_undo");
      return;
    }
    if (hotkey === localMic.translationToggleKey) {
      event.preventDefault();
      void toggleEnglishVoiceOutput();
    }
    return;
  }

  event.preventDefault();
  localMic.activeHotkeyCode = event.code;
  void startLocalMicRecording();
});

document.addEventListener("keyup", (event) => {
  if (localMic.globalHotkeysReady) {
    return;
  }
  if (!localMic.activeHotkeyCode || event.code !== localMic.activeHotkeyCode) {
    return;
  }
  event.preventDefault();
  localMic.activeHotkeyCode = null;
  void stopLocalMicRecording();
});

window.addEventListener("blur", () => {
  localMicPointerActive = false;
  localMic.activeHotkeyCode = null;
  if (!localMic.globalHotkeysReady && (localMic.recording || localMic.starting)) {
    void stopLocalMicRecording();
  }
});

window.vibeApp.onState((payload) => {
  appState.service = payload.service;
  renderService();
  connectLiveSocket();
});

window.vibeApp.onGlobalHotkey(handleGlobalHotkey);

setActiveTab("basics");
renderLocalMic();
await refreshBootstrap();
