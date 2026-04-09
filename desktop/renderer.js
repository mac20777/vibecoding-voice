const elements = {
  statusPill: document.querySelector("#status-pill"),
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
  pickClaudeCwdButton: document.querySelector("#pick-claude-cwd-button")
};

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
  reconnectTimer: null,
  socketPort: null
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
  elements.summaryProviderDetail.textContent =
    elements.sttProvider.value === "openai"
      ? `模型：${elements.openaiModel.value || "whisper-1"}`
      : "适合中文语音环境";
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
  renderConfigSummary();
}

function collectFormPayload() {
  return {
    form: {
      sendTarget: elements.sendTarget.value,
      sttProvider: elements.sttProvider.value,
      transcriptDeliveryMode: elements.transcriptDeliveryMode.value,
      textInjectionMode: elements.textInjectionMode.value,
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
      closeToTray: elements.closeToTray.checked
    }
  };
}

function fillForm(form, desktopSettingsPath) {
  elements.sendTarget.value = form.sendTarget;
  elements.sttProvider.value = form.sttProvider;
  elements.transcriptDeliveryMode.value = form.transcriptDeliveryMode;
  elements.textInjectionMode.value = form.textInjectionMode;
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
  elements.codexSkipGitRepoCheck.checked = Boolean(form.codexSkipGitRepoCheck);
  elements.claudeDangerouslySkipPermissions.checked = Boolean(form.claudeDangerouslySkipPermissions);
  elements.userConfigPath.textContent = form.userConfigPath || "";
  elements.desktopSettingsPath.textContent = desktopSettingsPath || "";
  updateFormAffordances();
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
    appState.socket.close();
    appState.socket = null;
  }
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
  if (message.type === "server_ready") {
    liveState.cliStatus = `已连接 · ${modeLabel(message.sendTarget)}`;
    if (message.sendTarget) {
      elements.serviceMode.textContent = modeLabel(message.sendTarget);
    }
    renderService();
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

elements.tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveTab(button.getAttribute("data-tab-trigger"));
  });
});

elements.sttProvider.addEventListener("change", updateFormAffordances);
elements.sendTarget.addEventListener("change", updateFormAffordances);
elements.transcriptDeliveryMode.addEventListener("change", renderConfigSummary);
elements.textInjectionMode.addEventListener("change", renderConfigSummary);
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

elements.openConfigFolderButton.addEventListener("click", async () => {
  const bootstrap = await window.vibeApp.openConfigFolder();
  appState.bootstrap = bootstrap;
  appState.service = bootstrap.service;
  renderService();
});

elements.pickCodexCwdButton.addEventListener("click", () => chooseDirectory(elements.codexCwd));
elements.pickClaudeCwdButton.addEventListener("click", () => chooseDirectory(elements.claudeCwd));

window.vibeApp.onState((payload) => {
  appState.service = payload.service;
  renderService();
  connectLiveSocket();
});

setActiveTab("basics");
await refreshBootstrap();
