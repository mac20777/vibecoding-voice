const I18N = {
  zh: {
    openLogs: "打开日志目录",
    navHome: "首页", navTranscripts: "转写记录", navSettings: "设置", navLogs: "日志", navAbout: "关于",
    homeTitle: "首页", homeSub: "服务状态、初始检查和最近的语音。",
    startService: "启动", restart: "重启", stopService: "停止",
    checklistTitle: "初始检查",
    dictateTitle: "快速听写", recentTitle: "最近转写", emptyRecent: "还没有收到语音",
    trTitle: "转写记录", trSub: "本次运行的完整语音与回复历史。",
    setTitle: "设置", setSub: "改完记得点底部「保存」。",
    tabBasic: "基本", tabSpeech: "语音与快捷键", tabTranslation: "翻译", tabRemote: "遥控器", tabAdvanced: "高级",
    fTarget: "发送目标", optTargetInject: "输入注入（打字到当前窗口）", fTargetHint: "语音转写后发送到哪里",
    fTiming: "发送时机", optTimingConfirm: "设备确认后发送", optTimingImm: "识别完成立即发送",
    fTimingHint: "ESP32 在墨水屏上确认；遥控器选「设备确认后发送」时，文字先打进输入框，按确认键（默认回车）再发送",
    fInputMode: "输入模式", optTypeEnter: "输入并回车", optTypeOnly: "仅输入文本",
    fInputModeHint: "选「仅输入文本」：文字先打进输入框，按遥控器 OK（回车）再发送",
    fAutoLaunch: "开机自启", fTray: "启动后最小化到托盘", fCloseTray: "关闭窗口时最小化到托盘",
    fStt: "语音识别服务", fSttHint: "Volcengine 推荐给中文环境", fLanHint: "局域网设备握手签名，可留空",
    hotkeyGroup: "全局快捷键",
    fHoldKey: "按住说话", fSendKey: "发送", fUndoKey: "撤销", fTransToggleKey: "英文输出", capture: "录入",
    fTransEnable: "启用中文翻译（识别后翻译成目标语言再发送）",
    fTransTarget: "目标语言", langEnglish: "英语", langKorean: "韩语", langJapanese: "日语",
    fTransSendMode: "发送格式", optSendTarget: "只发送目标语言", optSendBilingual: "中文 + 目标语言",
    optSendZhEn: "只输出中文和英语", optSendAll: "输出中文、英语、韩语、日语",
    fTransModel: "模型", fTransTimeout: "超时 (ms)",
    fXiaomi: "启用小米蓝牙遥控器（需 USBPcap 驱动）",
    remoteNote: "点击遥控器上的按键，再点右侧动作完成映射。语音键固定为「按住说话」，不可改。按键事件来自抓包通道，Windows 的 HID 驱动状态不影响它。",
    advCli: "CLI 行为", fCodexSkip: "Codex：跳过 Git 仓库检查", fClaudeSkip: "Claude：减少权限确认",
    advWorkspace: "工作目录", fCodexCwd: "Codex 工作目录", fClaudeCwd: "Claude 工作目录", browse: "浏览…",
    fUserConfig: "用户配置", fDesktopSettings: "桌面设置",
    discard: "放弃更改", save: "保存",
    logTitle: "日志", logSub: "排障时看这里：上面是助手活动，下面是服务运行记录。",
    logCli: "助手活动", logService: "服务日志",
    aboutTitle: "关于", aboutSub: "版本与运行环境一览。",
    aboutVersion: "版本", aboutTarget: "发送目标", aboutStt: "语音识别",
    aboutLaunch: "启动方式", aboutRemote: "小米遥控器", aboutPort: "端口",
    tagYou: "你", tagAi: "助手",
    statusRunning: "运行中", statusStarting: "启动中", statusNeedsSetup: "待配置", statusError: "异常", statusStopped: "已停止",
    modeInject: "输入注入",
    bannerReady: "就绪，等你说话", bannerListening: "正在听…", bannerTranscribing: "识别中…",
    bannerStarting: "服务启动中…", bannerNeedsSetup: "需要先完成配置", bannerError: "服务异常", bannerStopped: "服务已停止",
    micIdle: "待命", micRecording: "录音中", micTranscribing: "识别中", micAwaiting: "待确认",
    micError: "异常", micConnecting: "准备中", micCapturing: "录入中",
    micHintIdle: "{scope} · 按住 {hold} 输入，{toggle} 英文输出",
    micHintRecording: "松开 {key} 结束",
    micHintTranscribing: "正在提交给语音识别服务",
    micHintAwaiting: "按 {send} 发送，{undo} 撤销",
    micHintCapturing: "按下新的快捷键",
    micHintConnecting: "正在连接本地服务和麦克风",
    micHintError: "麦克风不可用",
    scopeGlobal: "后台可用", scopeWindow: "窗口内可用",
    actIdle: "待命", actRecording: "REC", actStt: "STT", actConfirm: "待确认",
    sendWithKey: "发送 {key}", undoWithKey: "撤销 {key}",
    checkStt: "语音识别服务", checkSttOk: "{provider} · 已配置密钥", checkSttMiss: "{provider} 还没填密钥",
    checkSttFix: "去填写 →",
    checkTarget: "发送目标",
    targetDescInject: "文字直接打进当前窗口", targetDescCodex: "发送到 Codex CLI 会话", targetDescClaude: "发送到 Claude Code 会话",
    checkMicOk: "语音输入已验证", checkMicMiss: "还没试过说一句话",
    checkMicHint: "按住 {key} 或遥控器的语音键，说「你好」试试", checkMicFix: "去试试 →",
    checkRemoteOk: "小米遥控器已启用", checkRemoteMiss: "小米遥控器未启用",
    checkRemoteHint: "启用后可按遥控器语音键说话，方向/确认等按键也能映射", checkRemoteFix: "去设置 →",
    checkLaunch: "开机自启", checkLaunchOn: "已开启，语音功能随系统就绪", checkLaunchOff: "未开启 — 建议打开，开机即可用",
    checkLaunchFix: "去开启 →",
    voiceFixed: "固定为「按住说话」", remoteCodeUnknown: "HID — 待识别",
    remoteOn: "已启用", remoteOff: "未启用",
    remoteBattery: "电量 {level}%", remoteDisconnected: "未连接", remoteReading: "读取中…",
    btnVoice: "语音键", btnUp: "上", btnDown: "下", btnLeft: "左", btnRight: "右", btnOk: "确认",
    btnBack: "返回", btnHome: "主页", btnMenu: "菜单", btnVolUp: "音量 +", btnVolDown: "音量 −",
    actionUp: "方向 ↑", actionDown: "方向 ↓", actionLeft: "方向 ←", actionRight: "方向 →",
    actionEnter: "回车", actionEscape: "Esc", actionHome: "Home", actionMenu: "菜单键",
    actionVolumeUp: "系统音量 +", actionVolumeDown: "系统音量 −", actionNone: "禁用",
    notConnected: "尚未连接。", waitingStart: "等待启动。", waitingData: "等待中",
    connReady: "已连接 · {mode}", connNoService: "服务未连接", connClosed: "连接已断开", connFailed: "无法连接到本地服务",
    saving: "保存中…", saved: "已保存 ✓",
    englishOn: "已切换为英文输出。", englishOff: "已关闭英文输出。",
    configIssuePrefix: "当前配置不完整：",
    overrideNote: "注意：以下配置文件会覆盖用户配置，界面里保存的值可能不会立即生效：",
    providerDetailOpenai: "模型：{model}", providerDetailVolc: "适合中文语音环境",
    translationOn: "翻译开启 · 目标：{lang} · {mode}",
    transLangEnglish: "英语", transLangKorean: "韩语", transLangJapanese: "日语",
    sendModeTarget: "只发目标语言", sendModeBilingual: "中文+目标语言", sendModeZhEn: "中文+英语", sendModeAll: "中文+英韩日",
    deliveryImm: "识别完成立即发送", deliveryConfirm: "设备确认后发送",
    injectEnter: "输入并回车", injectOnly: "仅输入文本",
    launchHidden: "开机后隐藏启动", launchAuto: "开机自启", launchManual: "手动启动",
    closeTray: "关闭窗口时最小化到托盘", closeKeep: "关闭窗口后退出界面",
    serviceMsgDefault: "等待启动。",
    gestureClick: "单击", gestureDouble: "双击", gestureHold: "长按",
    actionTypeNone: "禁用", actionTypeKey: "键盘按键", actionTypeCombo: "组合快捷键",
    actionTypeApp: "打开应用", actionTypeText: "输入文本", actionTypePrompt: "提示词模板",
    actionUnset: "未设置",
    actionAppSummary: "打开 {target}", actionPromptSummary: "模板：{name}",
    promptListEmpty: "还没有模板，先在下面添加",
    templatesTitle: "提示词模板",
    templatesHint: "模板中的 {text} 会被替换成你说的话。用法：按绑定了模板的遥控器按键，再按住语音键说话。",
    templateNamePh: "模板名，如：优化", templateBodyPh: "优化下面这段话，去掉语气词：{text}",
    appPlaceholder: "chrome / notepad / C:\\path\\app.exe", textPlaceholder: "按一下就打进这段文字",
    addTemplate: "添加", deleteTemplate: "删除",
    promptArmed: "模板「{name}」已就位 — 按住语音键说话",
    voiceFixedNote: "语音键固定为「按住说话」，不参与映射。"
  },
  en: {
    openLogs: "Open Logs Folder",
    navHome: "Home", navTranscripts: "Transcripts", navSettings: "Settings", navLogs: "Logs", navAbout: "About",
    homeTitle: "Home", homeSub: "Service status, setup checks and your latest voice.",
    startService: "Start", restart: "Restart", stopService: "Stop",
    checklistTitle: "Setup checks",
    dictateTitle: "Quick dictate", recentTitle: "Recent transcripts", emptyRecent: "No voice received yet",
    trTitle: "Transcripts", trSub: "Full voice and reply history of this run.",
    setTitle: "Settings", setSub: "Remember to hit Save at the bottom.",
    tabBasic: "Basics", tabSpeech: "Speech & Hotkeys", tabTranslation: "Translation", tabRemote: "Remote", tabAdvanced: "Advanced",
    fTarget: "Send target", optTargetInject: "Text injection (type into focused window)", fTargetHint: "Where transcripts go",
    fTiming: "Delivery timing", optTimingConfirm: "Confirm on device first", optTimingImm: "Send right after recognition",
    fTimingHint: "ESP32 confirms on the e-paper screen; with “Confirm on device first”, the remote types text into the input box and the OK key (Enter by default) sends it",
    fInputMode: "Input mode", optTypeEnter: "Type + Enter", optTypeOnly: "Type only",
    fInputModeHint: "With “Type only”, text lands in the input box first — press the remote OK key (Enter) to send",
    fAutoLaunch: "Launch on Windows start", fTray: "Minimize to tray on launch", fCloseTray: "Close window to tray",
    fStt: "Speech recognition", fSttHint: "Volcengine recommended for Chinese", fLanHint: "HMAC handshake secret for LAN devices, optional",
    hotkeyGroup: "Global hotkeys",
    fHoldKey: "Hold to dictate", fSendKey: "Send", fUndoKey: "Undo", fTransToggleKey: "English output", capture: "Record",
    fTransEnable: "Translate Chinese dictation before sending",
    fTransTarget: "Target language", langEnglish: "English", langKorean: "Korean", langJapanese: "Japanese",
    fTransSendMode: "Send format", optSendTarget: "Target language only", optSendBilingual: "Chinese + target",
    optSendZhEn: "Chinese & English only", optSendAll: "Chinese, English, Korean & Japanese",
    fTransModel: "Model", fTransTimeout: "Timeout (ms)",
    fXiaomi: "Enable Xiaomi Bluetooth remote (needs USBPcap driver)",
    remoteNote: "Click a button on the remote, then pick an action on the right. The voice key is fixed to push-to-talk. Button events come from the capture channel, so Windows HID driver state does not affect them.",
    advCli: "CLI behavior", fCodexSkip: "Codex: skip Git repo check", fClaudeSkip: "Claude: reduce permission prompts",
    advWorkspace: "Workspaces", fCodexCwd: "Codex workspace", fClaudeCwd: "Claude workspace", browse: "Browse…",
    fUserConfig: "User config", fDesktopSettings: "Desktop settings",
    discard: "Discard", save: "Save",
    logTitle: "Logs", logSub: "For troubleshooting: assistant activity above, service records below.",
    logCli: "Assistant activity", logService: "Service log",
    aboutTitle: "About", aboutSub: "Version and environment at a glance.",
    aboutVersion: "Version", aboutTarget: "Send target", aboutStt: "Speech recognition",
    aboutLaunch: "Launch", aboutRemote: "Xiaomi remote", aboutPort: "Port",
    tagYou: "You", tagAi: "Assistant",
    statusRunning: "Running", statusStarting: "Starting", statusNeedsSetup: "Needs setup", statusError: "Error", statusStopped: "Stopped",
    modeInject: "Text injection",
    bannerReady: "Ready — say something", bannerListening: "Listening…", bannerTranscribing: "Transcribing…",
    bannerStarting: "Service starting…", bannerNeedsSetup: "Setup needed first", bannerError: "Service error", bannerStopped: "Service stopped",
    micIdle: "Idle", micRecording: "Recording", micTranscribing: "Transcribing", micAwaiting: "Confirm",
    micError: "Error", micConnecting: "Preparing", micCapturing: "Capturing",
    micHintIdle: "{scope} · hold {hold} to dictate, {toggle} for English output",
    micHintRecording: "Release {key} to finish",
    micHintTranscribing: "Submitting to the speech service",
    micHintAwaiting: "Press {send} to send, {undo} to undo",
    micHintCapturing: "Press the new hotkey",
    micHintConnecting: "Connecting to the local service and microphone",
    micHintError: "Microphone unavailable",
    scopeGlobal: "works in background", scopeWindow: "works in this window",
    actIdle: "Idle", actRecording: "REC", actStt: "STT", actConfirm: "Confirm",
    sendWithKey: "Send {key}", undoWithKey: "Undo {key}",
    checkStt: "Speech recognition", checkSttOk: "{provider} · key configured", checkSttMiss: "{provider} has no API key yet",
    checkSttFix: "Fill it in →",
    checkTarget: "Send target",
    targetDescInject: "Types into the focused window", targetDescCodex: "Sends to a Codex CLI session", targetDescClaude: "Sends to a Claude Code session",
    checkMicOk: "Voice input verified", checkMicMiss: "No voice test yet",
    checkMicHint: "Hold {key} or the remote voice key and say hello", checkMicFix: "Try it →",
    checkRemoteOk: "Xiaomi remote enabled", checkRemoteMiss: "Xiaomi remote not enabled",
    checkRemoteHint: "Once enabled, hold the remote voice key to talk; other buttons can be mapped", checkRemoteFix: "Open Settings →",
    checkLaunch: "Launch on Windows start", checkLaunchOn: "On — voice is ready whenever the system is", checkLaunchOff: "Off — recommended so voice is ready at boot",
    checkLaunchFix: "Enable →",
    voiceFixed: "Fixed to push-to-talk", remoteCodeUnknown: "HID — to be identified",
    remoteOn: "Enabled", remoteOff: "Disabled",
    remoteBattery: "Battery {level}%", remoteDisconnected: "Disconnected", remoteReading: "Reading…",
    btnVoice: "Voice key", btnUp: "Up", btnDown: "Down", btnLeft: "Left", btnRight: "Right", btnOk: "OK",
    btnBack: "Back", btnHome: "Home", btnMenu: "Menu", btnVolUp: "Volume +", btnVolDown: "Volume −",
    actionUp: "Arrow ↑", actionDown: "Arrow ↓", actionLeft: "Arrow ←", actionRight: "Arrow →",
    actionEnter: "Enter", actionEscape: "Esc", actionHome: "Home", actionMenu: "Menu key",
    actionVolumeUp: "Volume +", actionVolumeDown: "Volume −", actionNone: "Disabled",
    notConnected: "Not connected yet.", waitingStart: "Waiting to start.", waitingData: "Waiting",
    connReady: "Connected · {mode}", connNoService: "Service not connected", connClosed: "Disconnected", connFailed: "Cannot connect to the local service",
    saving: "Saving…", saved: "Saved ✓",
    englishOn: "English output enabled.", englishOff: "English output disabled.",
    configIssuePrefix: "Configuration is incomplete: ",
    overrideNote: "Note: these config files override the user config; values saved here may not take effect:",
    providerDetailOpenai: "Model: {model}", providerDetailVolc: "Recommended for Chinese",
    translationOn: "Translation on · target: {lang} · {mode}",
    transLangEnglish: "English", transLangKorean: "Korean", transLangJapanese: "Japanese",
    sendModeTarget: "Target only", sendModeBilingual: "Chinese + target", sendModeZhEn: "Chinese + English", sendModeAll: "All four languages",
    deliveryImm: "Send right after recognition", deliveryConfirm: "Confirm on device first",
    injectEnter: "Type + Enter", injectOnly: "Type only",
    launchHidden: "At login (hidden)", launchAuto: "At login", launchManual: "Manual",
    closeTray: "Closing the window minimizes to tray", closeKeep: "Closing the window exits the UI",
    serviceMsgDefault: "Waiting to start.",
    gestureClick: "Click", gestureDouble: "Double-click", gestureHold: "Long-press",
    actionTypeNone: "Disabled", actionTypeKey: "Key", actionTypeCombo: "Shortcut",
    actionTypeApp: "Launch app", actionTypeText: "Type text", actionTypePrompt: "Prompt template",
    actionUnset: "Not set",
    actionAppSummary: "Open {target}", actionPromptSummary: "Template: {name}",
    promptListEmpty: "No templates yet — add one below",
    templatesTitle: "Prompt templates",
    templatesHint: "{text} in a template is replaced by what you say. Usage: press a remote button bound to a template, then hold the voice key and speak.",
    templateNamePh: "Name, e.g. Polish", templateBodyPh: "Polish this paragraph and remove filler words: {text}",
    appPlaceholder: "chrome / notepad / C:\\path\\app.exe", textPlaceholder: "Text typed on each press",
    addTemplate: "Add", deleteTemplate: "Delete",
    promptArmed: "Template \"{name}\" armed — hold the voice key and speak",
    voiceFixedNote: "The voice key is fixed to push-to-talk and cannot be remapped."
  }
};

let lang = "zh";
let hasUsedVoice = false;

function t(key, vars = {}) {
  const table = I18N[lang] || I18N.zh;
  let value = table[key] ?? I18N.zh[key] ?? key;
  for (const [name, replacement] of Object.entries(vars)) {
    value = value.replaceAll(`{${name}}`, String(replacement));
  }
  return value;
}

const elements = {
  statusPill: document.querySelector("#status-pill"),
  statusDot: document.querySelector("#status-dot"),
  appVersion: document.querySelector("#app-version"),
  cliStatus: document.querySelector("#cli-status"),
  remoteStatus: document.querySelector("#remote-status"),
  remoteStatusSep: document.querySelector("#remote-status-sep"),
  langToggle: document.querySelector("#lang-toggle"),
  bannerPulse: document.querySelector("#banner-pulse"),
  bannerState: document.querySelector("#banner-state"),
  bannerDetail: document.querySelector("#banner-detail"),
  serviceMessage: document.querySelector("#service-message"),
  configIssues: document.querySelector("#config-issues"),
  overrideFiles: document.querySelector("#override-files"),
  checklistCard: document.querySelector("#checklist-card"),
  checklist: document.querySelector("#checklist"),
  recentList: document.querySelector("#recent-list"),
  transcriptList: document.querySelector("#transcript-list"),
  form: document.querySelector("#settings-form"),
  tabButtons: [...document.querySelectorAll(".settings-tab[data-tab]")],
  tabPanels: [...document.querySelectorAll("[data-panel]")],
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
  xiaomiRemoteEnabled: document.querySelector("#xiaomi-remote-enabled"),
  userConfigPath: document.querySelector("#user-config-path"),
  desktopSettingsPath: document.querySelector("#desktop-settings-path"),
  cliLogTail: document.querySelector("#cli-log-tail"),
  serviceLogTail: document.querySelector("#service-log-tail"),
  startServiceButton: document.querySelector("#start-service-button"),
  restartServiceButton: document.querySelector("#restart-service-button"),
  stopServiceButton: document.querySelector("#stop-service-button"),
  saveSettingsButton: document.querySelector("#save-settings-button"),
  discardSettingsButton: document.querySelector("#discard-settings-button"),
  openConfigFolderButton: document.querySelector("#open-config-folder-button"),
  openLogsButton: document.querySelector("#open-logs-button"),
  pickCodexCwdButton: document.querySelector("#pick-codex-cwd-button"),
  pickClaudeCwdButton: document.querySelector("#pick-claude-cwd-button"),
  localMicButton: document.querySelector("#local-mic-button"),
  localMicKeyBadge: document.querySelector("#local-mic-key-badge"),
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
  meter: document.querySelector("#meter"),
  localMicBars: [...document.querySelectorAll("[data-local-mic-bar]")],
  aboutVersion: document.querySelector("#about-version"),
  aboutTarget: document.querySelector("#about-target"),
  aboutTargetSub: document.querySelector("#about-target-sub"),
  aboutProvider: document.querySelector("#about-provider"),
  aboutProviderSub: document.querySelector("#about-provider-sub"),
  aboutLaunch: document.querySelector("#about-launch"),
  aboutLaunchSub: document.querySelector("#about-launch-sub"),
  aboutRemote: document.querySelector("#about-remote"),
  aboutRemoteSub: document.querySelector("#about-remote-sub"),
  aboutPort: document.querySelector("#about-port"),
  rselName: document.querySelector("#rsel-name"),
  rselCode: document.querySelector("#rsel-code"),
  gestureTabs: document.querySelector("#gesture-tabs"),
  actionEditor: document.querySelector("#action-editor"),
  voiceFixedNote: document.querySelector("#voice-fixed-note"),
  actionType: document.querySelector("#action-type"),
  afKey: document.querySelector("#af-key"),
  afCombo: document.querySelector("#af-combo"),
  afApp: document.querySelector("#af-app"),
  afText: document.querySelector("#af-text"),
  afPrompt: document.querySelector("#af-prompt"),
  actionKey: document.querySelector("#action-key"),
  comboCtrl: document.querySelector("#combo-ctrl"),
  comboAlt: document.querySelector("#combo-alt"),
  comboShift: document.querySelector("#combo-shift"),
  comboWin: document.querySelector("#combo-win"),
  comboKey: document.querySelector("#combo-key"),
  actionApp: document.querySelector("#action-app"),
  actionText: document.querySelector("#action-text"),
  actionPrompt: document.querySelector("#action-prompt"),
  templateList: document.querySelector("#template-list"),
  templateName: document.querySelector("#template-name"),
  templateBody: document.querySelector("#template-body"),
  templateAddButton: document.querySelector("#template-add-button")
};

const DEFAULT_LOCAL_MIC_HOLD_KEY = "F8";
const DEFAULT_LOCAL_MIC_SEND_KEY = "F9";
const DEFAULT_LOCAL_MIC_UNDO_KEY = "F10";
const DEFAULT_LOCAL_MIC_TRANSLATION_TOGGLE_KEY = "F7";
const LOCAL_MIC_SAMPLE_RATE = 16000;
const SOCKET_READY_TIMEOUT_MS = 7000;

const liveState = {
  cliStatusKey: null,
  cliStatusVars: {},
  cliStatusRaw: "",
  cliLogLines: [],
  lastUserText: "",
  lastAssistantText: ""
};

function cliStatusText() {
  if (liveState.cliStatusKey) {
    const vars = { ...liveState.cliStatusVars };
    if (vars.modeRaw !== undefined) {
      vars.mode = modeLabel(vars.modeRaw);
      delete vars.modeRaw;
    }
    return t(liveState.cliStatusKey, vars);
  }
  return liveState.cliStatusRaw || t("notConnected");
}

function setCliStatusKey(key, vars = {}) {
  liveState.cliStatusKey = key;
  liveState.cliStatusVars = vars;
  liveState.cliStatusRaw = "";
}

function setCliStatusRaw(text) {
  liveState.cliStatusKey = null;
  liveState.cliStatusVars = {};
  liveState.cliStatusRaw = text;
}

const transcriptHistory = [];

const appState = {
  bootstrap: null,
  service: null,
  remote: null,
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

// Mirror of src/remote-buttons.mjs action model — keep in sync.
const REMOTE_BUTTONS = ["up", "down", "left", "right", "ok", "back", "home", "volume_up", "volume_down", "menu"];
const REMOTE_GESTURES = ["click", "double", "hold"];
const DEFAULT_REMOTE_ACTIONS = Object.freeze({
  up: { click: { type: "key", key: "up" } },
  down: { click: { type: "key", key: "down" } },
  left: { click: { type: "key", key: "left" } },
  right: { click: { type: "key", key: "right" } },
  ok: { click: { type: "key", key: "enter" } },
  back: { click: { type: "key", key: "escape" } },
  home: { click: { type: "key", key: "home" } },
  volume_up: { click: { type: "key", key: "volume_up" } },
  volume_down: { click: { type: "key", key: "volume_down" } },
  menu: { click: { type: "key", key: "menu" } }
});
const REMOTE_KEY_OPTIONS = [
  "up", "down", "left", "right", "enter", "escape", "tab", "space", "backspace",
  "delete", "home", "end", "pageup", "pagedown", "menu", "volume_up", "volume_down"
];
const REMOTE_BUTTON_DEFS = [
  { id: "voice", code: "HID 0x3E", nameKey: "btnVoice" },
  { id: "up", code: "HID 0x52", nameKey: "btnUp" },
  { id: "down", code: "HID 0x51", nameKey: "btnDown" },
  { id: "left", code: "HID 0x50", nameKey: "btnLeft" },
  { id: "right", code: "HID 0x4F", nameKey: "btnRight" },
  { id: "ok", code: "HID 0x28", nameKey: "btnOk" },
  { id: "back", code: "HID 0xF1", nameKey: "btnBack" },
  { id: "home", code: "HID 0x4A", nameKey: "btnHome" },
  { id: "menu", code: null, nameKey: "btnMenu" },
  { id: "volume_up", code: "HID 0x80", nameKey: "btnVolUp" },
  { id: "volume_down", code: "HID 0x81", nameKey: "btnVolDown" }
];
let remoteButtonActions = defaultRemoteActions();
let promptTemplates = [];
let selectedRemoteButton = "ok";
let selectedGesture = "click";

function defaultRemoteActions() {
  const map = {};
  for (const button of REMOTE_BUTTONS) {
    map[button] = { ...DEFAULT_REMOTE_ACTIONS[button] };
  }
  return map;
}

function normalizeRemoteAction(action) {
  if (!action || typeof action !== "object") {
    return null;
  }
  switch (action.type) {
    case "none":
      return { type: "none" };
    case "key": {
      const key = String(action.key || "").trim().toLowerCase();
      return key ? { type: "key", key } : null;
    }
    case "combo": {
      const combo = String(action.combo || "").trim().toLowerCase();
      return combo ? { type: "combo", combo } : null;
    }
    case "app": {
      const command = String(action.command || "").trim();
      return command ? { type: "app", command } : null;
    }
    case "text": {
      const text = String(action.text || "");
      return text.trim() ? { type: "text", text } : null;
    }
    case "prompt": {
      const name = String(action.name || "").trim();
      return name ? { type: "prompt", name } : null;
    }
    default:
      return null;
  }
}

function serializeRemoteAction(action) {
  const normalized = normalizeRemoteAction(action);
  if (!normalized) {
    return "";
  }
  switch (normalized.type) {
    case "none":
      return "none";
    case "key":
      return `key:${encodeURIComponent(normalized.key)}`;
    case "combo":
      return `combo:${encodeURIComponent(normalized.combo)}`;
    case "app":
      return `app:${encodeURIComponent(normalized.command)}`;
    case "text":
      return `text:${encodeURIComponent(normalized.text)}`;
    case "prompt":
      return `prompt:${encodeURIComponent(normalized.name)}`;
    default:
      return "";
  }
}

function parseActionSpec(spec) {
  const raw = String(spec || "").trim();
  if (!raw) {
    return null;
  }
  if (raw === "none") {
    return { type: "none" };
  }
  const sepIndex = raw.indexOf(":");
  if (sepIndex < 0) {
    return normalizeRemoteAction({ type: "key", key: raw });
  }
  const type = raw.slice(0, sepIndex).trim().toLowerCase();
  const payload = decodeURIComponent(raw.slice(sepIndex + 1));
  const field = { key: "key", combo: "combo", app: "command", text: "text", prompt: "name" }[type];
  return field ? normalizeRemoteAction({ type, [field]: payload }) : null;
}

// Tolerant mirror of parseRemoteActionMap: unknown buttons/gestures are ignored
// so the UI never breaks on a config typo.
function parseRemoteActions(override) {
  const map = defaultRemoteActions();
  for (const entry of String(override || "").split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.includes("=")) {
      const eqIndex = trimmed.indexOf("=");
      const target = trimmed.slice(0, eqIndex).trim().toLowerCase();
      const [button, gesture = "click"] = target.split(".");
      if (!Object.hasOwn(DEFAULT_REMOTE_ACTIONS, button) || !REMOTE_GESTURES.includes(gesture)) {
        continue;
      }
      const action = parseActionSpec(trimmed.slice(eqIndex + 1));
      if (action) {
        map[button][gesture] = action;
      }
      continue;
    }
    const [rawButton, rawKey] = trimmed.split(":", 2);
    const button = String(rawButton || "").trim().toLowerCase();
    const key = String(rawKey || "").trim().toLowerCase();
    if (button && key && Object.hasOwn(DEFAULT_REMOTE_ACTIONS, button)) {
      map[button].click = parseActionSpec(key);
    }
  }
  return map;
}

function serializeRemoteActions() {
  const entries = [];
  for (const button of REMOTE_BUTTONS) {
    for (const gesture of REMOTE_GESTURES) {
      const action = remoteButtonActions[button]?.[gesture];
      if (!action) {
        continue;
      }
      const defaultAction = DEFAULT_REMOTE_ACTIONS[button]?.[gesture] || null;
      if (defaultAction && serializeRemoteAction(action) === serializeRemoteAction(defaultAction)) {
        continue;
      }
      const spec = serializeRemoteAction(action);
      if (spec) {
        entries.push(`${button}.${gesture}=${spec}`);
      }
    }
  }
  return entries.join(", ");
}

function parsePromptTemplates(json) {
  try {
    const parsed = JSON.parse(String(json || "").trim() || "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry) => ({ name: String(entry?.name || "").trim(), body: String(entry?.body || "") }))
      .filter((entry) => entry.name && entry.body.trim());
  } catch {
    return [];
  }
}

function remoteActionSummary(action) {
  const normalized = normalizeRemoteAction(action);
  if (!normalized) {
    return t("actionUnset");
  }
  switch (normalized.type) {
    case "none":
      return t("actionNone");
    case "key":
      return keyLabel(normalized.key);
    case "combo":
      return normalized.combo;
    case "app":
      return t("actionAppSummary", { target: normalized.command });
    case "text":
      return normalized.text.length > 12 ? `${normalized.text.slice(0, 12)}…` : normalized.text;
    case "prompt":
      return t("actionPromptSummary", { name: normalized.name });
    default:
      return t("actionUnset");
  }
}

function keyLabel(key) {
  const labels = {
    up: "↑", down: "↓", left: "←", right: "→", enter: "⏎ Enter", escape: "Esc",
    tab: "Tab", space: "Space", backspace: "⌫", delete: "Del", home: "Home",
    end: "End", pageup: "PgUp", pagedown: "PgDn", menu: "≡ Menu",
    volume_up: "🔊+", volume_down: "🔉−"
  };
  return labels[key] || key.toUpperCase();
}

function modeLabel(mode) {
  if (mode === "claude_code") {
    return "Claude Code";
  }
  if (mode === "codex_exec") {
    return "Codex";
  }
  return t("modeInject");
}

function providerLabel(provider) {
  return provider === "openai" ? "OpenAI" : "Volcengine";
}

function deliveryLabel(mode) {
  return mode === "immediate" ? t("deliveryImm") : t("deliveryConfirm");
}

function injectionLabel(mode) {
  return mode === "type_only" ? t("injectOnly") : t("injectEnter");
}

function launchLabel({ autoLaunch, launchToTray }) {
  if (autoLaunch && launchToTray) {
    return t("launchHidden");
  }
  if (autoLaunch) {
    return t("launchAuto");
  }
  return t("launchManual");
}

function windowBehaviorLabel({ closeToTray }) {
  return closeToTray ? t("closeTray") : t("closeKeep");
}

function translationTargetLabel(language) {
  if (language === "korean") {
    return t("transLangKorean");
  }
  if (language === "japanese") {
    return t("transLangJapanese");
  }
  return t("transLangEnglish");
}

function translationSendModeLabel(mode) {
  if (mode === "all") {
    return t("sendModeAll");
  }
  if (mode === "zh_en") {
    return t("sendModeZhEn");
  }
  if (mode === "bilingual") {
    return t("sendModeBilingual");
  }
  return t("sendModeTarget");
}

function serviceStatusLabel(status) {
  if (status === "running") {
    return t("statusRunning");
  }
  if (status === "starting") {
    return t("statusStarting");
  }
  if (status === "needs_setup") {
    return t("statusNeedsSetup");
  }
  if (status === "error") {
    return t("statusError");
  }
  return t("statusStopped");
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
  renderBanner();
}

function localMicStatusText() {
  if (localMic.capturingHotkey) {
    return { state: t("micCapturing"), hint: t("micHintCapturing") };
  }
  if (localMic.status === "connecting") {
    return { state: t("micConnecting"), hint: t("micHintConnecting") };
  }
  if (localMic.status === "recording") {
    return { state: t("micRecording"), hint: t("micHintRecording", { key: displayHotkey(localMic.holdKey) }) };
  }
  if (localMic.status === "transcribing") {
    return { state: t("micTranscribing"), hint: t("micHintTranscribing") };
  }
  if (localMic.status === "awaiting_action") {
    return {
      state: t("micAwaiting"),
      hint: t("micHintAwaiting", { send: displayHotkey(localMic.sendKey), undo: displayHotkey(localMic.undoKey) })
    };
  }
  if (localMic.status === "error") {
    return { state: t("micError"), hint: localMic.error || t("micHintError") };
  }
  return {
    state: t("micIdle"),
    hint: t("micHintIdle", {
      scope: localMic.globalHotkeysReady ? t("scopeGlobal") : t("scopeWindow"),
      hold: displayHotkey(localMic.holdKey),
      toggle: displayHotkey(localMic.translationToggleKey)
    })
  };
}

function renderLocalMic() {
  const { state, hint } = localMicStatusText();
  elements.localMicState.textContent = state;
  elements.localMicHint.textContent = hint;
  elements.localMicKeyBadge.textContent = displayHotkey(localMic.holdKey);
  elements.localMicButton.classList.toggle("is-recording", localMic.recording);
  elements.meter.classList.toggle("on", localMic.recording);
  elements.localMicButton.disabled = localMic.starting || localMic.stopping || Boolean(localMic.capturingHotkey);
  elements.localMicSendButton.disabled =
    localMic.recording || localMic.starting || localMic.stopping || Boolean(localMic.capturingHotkey);
  elements.localMicUndoButton.disabled = !localMic.awaitingAction || localMic.recording || localMic.starting;
  elements.localMicSendButton.textContent = t("sendWithKey", { key: displayHotkey(localMic.sendKey) });
  elements.localMicUndoButton.textContent = t("undoWithKey", { key: displayHotkey(localMic.undoKey) });
  elements.captureLocalMicHoldKeyButton.textContent = localMic.capturingHotkey === "hold" ? "…" : t("capture");
  elements.captureLocalMicSendKeyButton.textContent = localMic.capturingHotkey === "send" ? "…" : t("capture");
  elements.captureLocalMicUndoKeyButton.textContent = localMic.capturingHotkey === "undo" ? "…" : t("capture");
  elements.captureLocalMicTranslationToggleKeyButton.textContent =
    localMic.capturingHotkey === "translationToggle" ? "…" : t("capture");
  elements.localMicActivity.textContent = localMic.recording
    ? t("actRecording")
    : localMic.status === "transcribing"
      ? t("actStt")
      : localMic.status === "awaiting_action"
        ? t("actConfirm")
        : t("actIdle");
  elements.localMicActivity.classList.toggle(
    "hidden",
    !localMic.recording && !["transcribing", "awaiting_action"].includes(localMic.status)
  );
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
    throw new Error(t("connNoService"));
  }
  appState.socket.send(JSON.stringify(message));
}

async function ensureBridgeSocketReady() {
  let service = appState.service || appState.bootstrap?.service;
  if (!service || (service.status !== "running" && service.status !== "starting")) {
    const bootstrap = await window.vibeApp.startService();
    appState.bootstrap = bootstrap;
    appState.service = bootstrap.service;
    renderService();
  }

  if (!service || service.status === "needs_setup" || service.status === "error") {
    throw new Error(service?.message || t("connNoService"));
  }

  connectLiveSocket();
  const startedAt = Date.now();
  while (Date.now() - startedAt < SOCKET_READY_TIMEOUT_MS) {
    if (appState.socket && appState.socket.readyState === WebSocket.OPEN && appState.socketReady) {
      return appState.socket;
    }
    await delay(80);
  }

  throw new Error(t("connFailed"));
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
      throw new Error(t("micHintError"));
    }
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error(t("micHintError"));
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
    renderBanner();
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
  setLocalMicStatus(sendStop ? "transcribing" : "error", sendStop ? "" : t("connClosed"));

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
    renderBanner();
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

function gotoPage(pageName, settingsTab = null) {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.page === pageName);
  });
  document.querySelectorAll(".page").forEach((page) => {
    page.classList.toggle("active", page.id === `page-${pageName}`);
  });
  if (pageName === "settings" && settingsTab) {
    setActiveTab(settingsTab);
  }
}

function setActiveTab(tabName) {
  elements.tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });
  elements.tabPanels.forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.panel !== tabName);
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

function updateTranslationVisibility() {
  document.querySelectorAll("[data-translation-config]").forEach((section) => {
    section.classList.toggle("hidden", !elements.voiceTranslationEnabled.checked);
  });
}

function updateFormAffordances() {
  updateProviderVisibility();
  updateModeVisibility();
  updateTranslationVisibility();
  renderAbout();
  renderBanner();
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
      elements.serviceMessage.textContent = t("englishOff");
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
    elements.serviceMessage.textContent = t("englishOn");
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
      claudeDangerouslySkipPermissions: elements.claudeDangerouslySkipPermissions.checked,
      xiaomiRemoteEnabled: elements.xiaomiRemoteEnabled.checked,
      xiaomiRemoteButtonMap: serializeRemoteActions(),
      xiaomiRemotePromptTemplates: JSON.stringify(promptTemplates)
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
  elements.xiaomiRemoteEnabled.checked = Boolean(form.xiaomiRemoteEnabled);
  remoteButtonActions = parseRemoteActions(form.xiaomiRemoteButtonMap);
  promptTemplates = parsePromptTemplates(form.xiaomiRemotePromptTemplates);
  renderRemoteEditor();
  elements.userConfigPath.textContent = form.userConfigPath || "";
  elements.desktopSettingsPath.textContent = desktopSettingsPath || "";
  updateFormAffordances();
  syncTrayLanguageMode();
}

function renderNotices(form) {
  const issues = form.configIssues || [];
  const overrideFiles = form.overrideFiles || [];

  if (issues.length > 0) {
    elements.configIssues.textContent = `${t("configIssuePrefix")}${issues.join(" ")}`;
    elements.configIssues.classList.remove("hidden");
  } else {
    elements.configIssues.classList.add("hidden");
  }

  if (overrideFiles.length > 0) {
    elements.overrideFiles.textContent = [
      t("overrideNote"),
      ...overrideFiles.map((filePath) => `• ${filePath}`)
    ].join("\n");
    elements.overrideFiles.classList.remove("hidden");
  } else {
    elements.overrideFiles.classList.add("hidden");
  }
}

function renderBanner() {
  const service = appState.service || appState.bootstrap?.service;
  let stateKey = "bannerStopped";
  let active = false;
  if (localMic.recording) {
    stateKey = "bannerListening";
    active = true;
  } else if (localMic.status === "transcribing") {
    stateKey = "bannerTranscribing";
    active = true;
  } else if (service?.status === "running") {
    stateKey = "bannerReady";
    active = true;
  } else if (service?.status === "starting") {
    stateKey = "bannerStarting";
  } else if (service?.status === "needs_setup") {
    stateKey = "bannerNeedsSetup";
  } else if (service?.status === "error") {
    stateKey = "bannerError";
  }
  elements.bannerState.textContent = t(stateKey);
  elements.bannerPulse.classList.toggle("off", !active);

  const form = appState.bootstrap?.form;
  const mode = service?.mode || elements.sendTarget.value || form?.sendTarget;
  const provider = elements.sttProvider.value || form?.sttProvider;
  const port = service?.port || form?.port || 8765;
  elements.bannerDetail.textContent =
    `${modeLabel(mode)} · ${providerLabel(provider)} · :${port} · ${displayHotkey(localMic.holdKey)}`;
}

function renderService() {
  const service = appState.service || appState.bootstrap?.service;
  if (!service) {
    return;
  }

  elements.statusPill.textContent = serviceStatusLabel(service.status);
  elements.statusDot.className = "dot";
  if (service.status === "running") {
    elements.statusDot.classList.add("on");
  } else if (service.status === "starting" || service.status === "needs_setup") {
    elements.statusDot.classList.add("warn");
  } else if (service.status === "error") {
    elements.statusDot.classList.add("err");
  }
  elements.serviceMessage.textContent = service.message || t("serviceMsgDefault");
  elements.cliStatus.textContent = cliStatusText();
  elements.serviceLogTail.textContent =
    service.logs && service.logs.length > 0 ? service.logs.join("\n") : t("waitingStart");
  elements.startServiceButton.disabled = service.status === "running" || service.status === "starting";
  elements.restartServiceButton.disabled = service.status === "starting";
  elements.stopServiceButton.disabled = service.status === "stopped" || service.status === "needs_setup";
  renderBanner();
}

function remoteDisplayName(remote) {
  return remote?.name || remote?.model || t("aboutRemote");
}

// Title-bar chip + About cell for the Xiaomi remote: model and battery are
// read once at startup via BLE GATT (queried in the main process).
function renderRemoteStatus() {
  const enabled = elements.xiaomiRemoteEnabled.checked
    || appState.bootstrap?.form?.xiaomiRemoteEnabled === true;
  const remote = appState.remote;

  if (!enabled) {
    elements.remoteStatus.hidden = true;
    elements.remoteStatusSep.hidden = true;
    return;
  }

  elements.remoteStatus.hidden = false;
  elements.remoteStatusSep.hidden = false;
  if (!remote) {
    elements.remoteStatus.textContent = `${t("aboutRemote")} · ${t("remoteReading")}`;
    elements.remoteStatus.classList.add("dim");
    return;
  }

  const name = remoteDisplayName(remote);
  if (remote.connected && remote.batteryLevel != null) {
    elements.remoteStatus.textContent = `${name} · ${remote.batteryLevel}%`;
    elements.remoteStatus.classList.remove("dim");
  } else if (remote.connected) {
    elements.remoteStatus.textContent = `${name} · ${t("remoteOn")}`;
    elements.remoteStatus.classList.remove("dim");
  } else {
    elements.remoteStatus.textContent = `${name} · ${t("remoteDisconnected")}`;
    elements.remoteStatus.classList.add("dim");
  }
  renderAbout();
}

function formatTime(date) {
  return date.toLocaleTimeString(lang === "zh" ? "zh-CN" : "en-US", { hour12: false });
}

function pushTranscript(who, text) {
  const value = String(text || "").trim();
  if (!value) {
    return;
  }
  transcriptHistory.push({ time: new Date(), who, text: value });
  renderTranscripts();
}

function renderTranscriptListInto(container, entries) {
  container.innerHTML = "";
  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "tr-empty";
    empty.textContent = t("emptyRecent");
    container.appendChild(empty);
    return;
  }
  for (const entry of entries) {
    const item = document.createElement("div");
    item.className = "tr-item";
    const meta = document.createElement("div");
    meta.className = "tr-meta";
    const time = document.createElement("span");
    time.className = "tr-time";
    time.textContent = formatTime(entry.time);
    const tag = document.createElement("span");
    tag.className = `tr-tag ${entry.who}`;
    tag.textContent = entry.who === "you" ? t("tagYou") : t("tagAi");
    meta.append(time, tag);
    const text = document.createElement("div");
    text.className = `tr-text${entry.who === "ai" ? " dim" : ""}`;
    text.textContent = entry.text;
    item.append(meta, text);
    container.appendChild(item);
  }
}

function renderTranscripts() {
  renderTranscriptListInto(elements.recentList, transcriptHistory.slice(-4));
  renderTranscriptListInto(elements.transcriptList, transcriptHistory);
  elements.transcriptList.scrollTop = elements.transcriptList.scrollHeight;
}

function markVoiceUsed() {
  if (hasUsedVoice) {
    return;
  }
  hasUsedVoice = true;
  renderChecklist();
  void window.vibeApp.updateDesktopSettings({ hasUsedVoice: true }).then((bootstrap) => {
    appState.bootstrap = bootstrap;
    appState.service = bootstrap.service;
  }).catch(() => {});
}

function renderChecklist() {
  const form = appState.bootstrap?.form;
  const sttOk = elements.sttProvider.value === "openai"
    ? Boolean(elements.openaiApiKey.value)
    : Boolean(elements.volcengineAppKey.value && elements.volcengineAccessKey.value);
  const remoteOn = elements.xiaomiRemoteEnabled.checked || form?.xiaomiRemoteEnabled === true;
  const autoLaunchOn = elements.autoLaunch.checked;
  const mode = elements.sendTarget.value;
  const targetDesc = mode === "codex_exec"
    ? t("targetDescCodex")
    : mode === "claude_code"
      ? t("targetDescClaude")
      : t("targetDescInject");

  const items = [
    {
      icon: sttOk ? "ok" : "miss",
      title: t("checkStt"),
      desc: sttOk
        ? t("checkSttOk", { provider: providerLabel(elements.sttProvider.value) })
        : t("checkSttMiss", { provider: providerLabel(elements.sttProvider.value) }),
      fix: sttOk ? null : { label: t("checkSttFix"), page: "settings", tab: "speech" }
    },
    {
      icon: "ok",
      title: t("checkTarget"),
      desc: `${modeLabel(mode)} — ${targetDesc}`,
      fix: null
    },
    {
      icon: hasUsedVoice ? "ok" : "miss",
      title: hasUsedVoice ? t("checkMicOk") : t("checkMicMiss"),
      desc: t("checkMicHint", { key: displayHotkey(localMic.holdKey) }),
      fix: hasUsedVoice ? null : { label: t("checkMicFix"), action: "mic" }
    },
    {
      icon: remoteOn ? "ok" : "miss",
      title: remoteOn ? t("checkRemoteOk") : t("checkRemoteMiss"),
      desc: t("checkRemoteHint"),
      fix: remoteOn ? null : { label: t("checkRemoteFix"), page: "settings", tab: "remote" }
    },
    {
      icon: "tip",
      title: t("checkLaunch"),
      desc: autoLaunchOn ? t("checkLaunchOn") : t("checkLaunchOff"),
      fix: autoLaunchOn ? null : { label: t("checkLaunchFix"), page: "settings", tab: "basic" }
    }
  ];

  elements.checklist.innerHTML = "";
  const iconText = { ok: "✓", miss: "!", tip: "i" };
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "check-item";
    const icon = document.createElement("div");
    icon.className = `check-icon ${item.icon}`;
    icon.textContent = iconText[item.icon];
    const textWrap = document.createElement("div");
    textWrap.className = "check-text";
    const title = document.createElement("div");
    title.className = "t";
    title.textContent = item.title;
    const desc = document.createElement("div");
    desc.className = "d";
    desc.textContent = item.desc;
    textWrap.append(title, desc);
    row.append(icon, textWrap);
    if (item.fix) {
      const fix = document.createElement("button");
      fix.className = "check-fix";
      fix.type = "button";
      fix.textContent = item.fix.label;
      fix.addEventListener("click", () => {
        if (item.fix.action === "mic") {
          gotoPage("home");
          elements.localMicButton.classList.remove("attention");
          elements.localMicButton.scrollIntoView({ block: "center", behavior: "smooth" });
          requestAnimationFrame(() => elements.localMicButton.classList.add("attention"));
          return;
        }
        gotoPage(item.fix.page, item.fix.tab);
      });
      row.appendChild(fix);
    }
    elements.checklist.appendChild(row);
  }

  const allGood = sttOk && hasUsedVoice && remoteOn && autoLaunchOn;
  elements.checklistCard.classList.toggle("hidden", allGood);
}

function renderAbout() {
  const version = appState.bootstrap?.appVersion;
  elements.aboutVersion.textContent = version ? `v${version}` : "";
  elements.appVersion.textContent = version ? `v${version}` : "";
  elements.aboutTarget.textContent = modeLabel(elements.sendTarget.value);
  elements.aboutTargetSub.textContent =
    elements.sendTarget.value === "text_injector"
      ? `${deliveryLabel(elements.transcriptDeliveryMode.value)} · ${injectionLabel(elements.textInjectionMode.value)}`
      : deliveryLabel(elements.transcriptDeliveryMode.value);
  elements.aboutProvider.textContent = providerLabel(elements.sttProvider.value);
  const providerDetail = elements.sttProvider.value === "openai"
    ? t("providerDetailOpenai", { model: elements.openaiModel.value || "whisper-1" })
    : t("providerDetailVolc");
  elements.aboutProviderSub.textContent = elements.voiceTranslationEnabled.checked
    ? `${providerDetail} · ${t("translationOn", {
        lang: translationTargetLabel(elements.voiceTranslationTargetLanguage.value),
        mode: translationSendModeLabel(elements.voiceTranslationSendMode.value)
      })}`
    : providerDetail;
  elements.aboutLaunch.textContent = launchLabel({
    autoLaunch: elements.autoLaunch.checked,
    launchToTray: elements.launchToTray.checked
  });
  elements.aboutLaunchSub.textContent = windowBehaviorLabel({ closeToTray: elements.closeToTray.checked });
  const remoteEnabled = elements.xiaomiRemoteEnabled.checked
    || appState.bootstrap?.form?.xiaomiRemoteEnabled === true;
  const remote = appState.remote;
  elements.aboutRemote.textContent = remoteEnabled ? t("remoteOn") : t("remoteOff");
  if (!remoteEnabled) {
    elements.aboutRemoteSub.textContent = "XIAOMI_REMOTE_ENABLED=0";
  } else if (remote?.connected && remote.batteryLevel != null) {
    elements.aboutRemoteSub.textContent =
      `${remoteDisplayName(remote)} · ${t("remoteBattery", { level: remote.batteryLevel })}`;
  } else if (remote?.connected) {
    elements.aboutRemoteSub.textContent = remoteDisplayName(remote);
  } else if (remote) {
    elements.aboutRemoteSub.textContent =
      `${remoteDisplayName(remote)} · ${t("remoteDisconnected")}`;
  } else {
    elements.aboutRemoteSub.textContent = `USBPcap · ${t("remoteReading")}`;
  }
  elements.aboutPort.textContent = String(
    appState.service?.port || appState.bootstrap?.form?.port || 8765
  );
}

function renderRemoteEditor() {
  const def = REMOTE_BUTTON_DEFS.find((entry) => entry.id === selectedRemoteButton) || REMOTE_BUTTON_DEFS[5];
  elements.rselName.textContent = t(def.nameKey);
  elements.rselCode.textContent = def.code || t("remoteCodeUnknown");
  document.querySelectorAll(".rbtn[data-btn]").forEach((button) => {
    button.classList.toggle("selected", button.dataset.btn === selectedRemoteButton);
  });

  const isVoice = selectedRemoteButton === "voice";
  elements.gestureTabs.hidden = isVoice;
  elements.actionEditor.hidden = isVoice;
  elements.voiceFixedNote.hidden = !isVoice;
  if (isVoice) {
    return;
  }

  for (const gesture of REMOTE_GESTURES) {
    const tab = elements.gestureTabs.querySelector(`[data-gesture="${gesture}"]`);
    tab.classList.toggle("active", gesture === selectedGesture);
    tab.querySelector(".gsum").textContent = remoteActionSummary(remoteButtonActions[selectedRemoteButton]?.[gesture]);
  }

  const action = normalizeRemoteAction(remoteButtonActions[selectedRemoteButton]?.[selectedGesture])
    || { type: "none" };
  elements.actionType.value = action.type;
  elements.afKey.hidden = action.type !== "key";
  elements.afCombo.hidden = action.type !== "combo";
  elements.afApp.hidden = action.type !== "app";
  elements.afText.hidden = action.type !== "text";
  elements.afPrompt.hidden = action.type !== "prompt";

  if (action.type === "key") {
    elements.actionKey.value = action.key;
  } else if (action.type === "combo") {
    const parts = action.combo.split("+").map((part) => part.trim()).filter(Boolean);
    elements.comboCtrl.checked = parts.includes("ctrl");
    elements.comboAlt.checked = parts.includes("alt");
    elements.comboShift.checked = parts.includes("shift");
    elements.comboWin.checked = parts.includes("win");
    elements.comboKey.value = parts.find((part) => !["ctrl", "alt", "shift", "win"].includes(part)) || "";
  } else if (action.type === "app") {
    elements.actionApp.value = action.command;
  } else if (action.type === "text") {
    elements.actionText.value = action.text;
  } else if (action.type === "prompt") {
    renderPromptOptions(action.name);
  }
}

function setGestureAction(action) {
  remoteButtonActions[selectedRemoteButton][selectedGesture] = action;
  const tab = elements.gestureTabs.querySelector(`[data-gesture="${selectedGesture}"]`);
  tab.querySelector(".gsum").textContent = remoteActionSummary(action);
}

function currentCombo() {
  const parts = [];
  if (elements.comboCtrl.checked) parts.push("ctrl");
  if (elements.comboAlt.checked) parts.push("alt");
  if (elements.comboShift.checked) parts.push("shift");
  if (elements.comboWin.checked) parts.push("win");
  const key = elements.comboKey.value.trim().toLowerCase();
  if (key) {
    parts.push(key);
  }
  return parts.join("+");
}

function renderPromptOptions(selectedName = "") {
  elements.actionPrompt.innerHTML = "";
  if (promptTemplates.length === 0) {
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = t("promptListEmpty");
    elements.actionPrompt.appendChild(empty);
    return;
  }
  for (const template of promptTemplates) {
    const opt = document.createElement("option");
    opt.value = template.name;
    opt.textContent = template.name;
    elements.actionPrompt.appendChild(opt);
  }
  elements.actionPrompt.value = selectedName || promptTemplates[0].name;
}

function renderPromptTemplates() {
  elements.templateList.innerHTML = "";
  if (promptTemplates.length === 0) {
    const empty = document.createElement("div");
    empty.className = "template-empty";
    empty.textContent = t("promptListEmpty");
    elements.templateList.appendChild(empty);
    return;
  }
  promptTemplates.forEach((template, index) => {
    const row = document.createElement("div");
    row.className = "template-row";
    const name = document.createElement("span");
    name.className = "template-name";
    name.textContent = template.name;
    const body = document.createElement("span");
    body.className = "template-body";
    body.textContent = template.body;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "template-del";
    del.textContent = "×";
    del.title = t("deleteTemplate");
    del.addEventListener("click", () => {
      promptTemplates.splice(index, 1);
      renderPromptTemplates();
    });
    row.append(name, body, del);
    elements.templateList.appendChild(row);
  });
}

function applyLang() {
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    const value = I18N[lang][key];
    if (value !== undefined) {
      el.textContent = value;
    }
  });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    const key = el.dataset.i18nPh;
    const value = I18N[lang][key];
    if (value !== undefined) {
      el.placeholder = value;
    }
  });
  elements.langToggle.textContent = lang === "zh" ? "EN" : "中文";
  if (appState.bootstrap?.form) {
    renderNotices(appState.bootstrap.form);
  }
  renderService();
  renderLocalMic();
  renderBanner();
  renderChecklist();
  renderTranscripts();
  renderAbout();
  renderRemoteStatus();
  renderRemoteEditor();
  renderPromptTemplates();
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
    setCliStatusKey("connReady", { modeRaw: message.sendTarget });
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
    setCliStatusRaw(message.statusLine || message.phase || t("micIdle"));
    renderService();
    return;
  }

  if (message.type === "cli_summary") {
    if (message.latestUserText && message.latestUserText !== liveState.lastUserText) {
      pushTranscript("you", message.latestUserText);
      liveState.lastUserText = message.latestUserText;
    }
    if (message.latestAssistantText && message.latestAssistantText !== liveState.lastAssistantText) {
      pushTranscript("ai", message.latestAssistantText);
      liveState.lastAssistantText = message.latestAssistantText;
    }
    return;
  }

  if (message.type === "cli_log_tail") {
    liveState.cliLogLines = Array.isArray(message.lines) ? message.lines : [];
    elements.cliLogTail.textContent =
      liveState.cliLogLines.length > 0 ? liveState.cliLogLines.join("\n") : t("notConnected");
    return;
  }

  if (message.type === "transcript_final") {
    if (message.text) {
      pushTranscript("you", message.text);
      markVoiceUsed();
    }
    return;
  }

  if (message.type === "remote_action") {
    if (message.action === "prompt_armed" && message.name) {
      elements.serviceMessage.textContent = t("promptArmed", { name: message.name });
    }
    return;
  }
}

function connectLiveSocket() {
  const service = appState.service || appState.bootstrap?.service;
  if (!service || (service.status !== "running" && service.status !== "starting")) {
    resetLiveConnection();
    setCliStatusKey("connNoService");
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
    setCliStatusKey("connClosed");
    renderService();
    scheduleReconnect();
  });

  socket.addEventListener("error", () => {
    setCliStatusKey("connFailed");
    renderService();
  });
}

async function refreshBootstrap() {
  const bootstrap = await window.vibeApp.getBootstrap();
  appState.bootstrap = bootstrap;
  appState.service = bootstrap.service;
  appState.remote = bootstrap.remote ?? appState.remote;
  const savedLang = bootstrap.form?.desktopSettings?.uiLanguage;
  if ((savedLang === "en" || savedLang === "zh") && savedLang !== lang) {
    lang = savedLang;
  }
  hasUsedVoice = bootstrap.form?.desktopSettings?.hasUsedVoice === true;
  if (bootstrap.globalHotkeys) {
    localMic.globalHotkeysReady = Boolean(bootstrap.globalHotkeys.ready);
    setLocalMicHotkeys(bootstrap.globalHotkeys.settings || bootstrap.form.desktopSettings);
  }
  fillForm(bootstrap.form, bootstrap.desktopSettingsPath);
  renderNotices(bootstrap.form);
  applyLang();
  renderRemoteStatus();
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

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => gotoPage(button.dataset.page));
});

elements.tabButtons.forEach((button) => {
  button.addEventListener("click", () => setActiveTab(button.dataset.tab));
});

elements.langToggle.addEventListener("click", () => {
  lang = lang === "zh" ? "en" : "zh";
  applyLang();
  void window.vibeApp.updateDesktopSettings({ uiLanguage: lang }).then((bootstrap) => {
    appState.bootstrap = bootstrap;
    appState.service = bootstrap.service;
  }).catch(() => {});
});

elements.sttProvider.addEventListener("change", updateFormAffordances);
elements.sendTarget.addEventListener("change", updateFormAffordances);
elements.transcriptDeliveryMode.addEventListener("change", updateFormAffordances);
elements.textInjectionMode.addEventListener("change", updateFormAffordances);
elements.voiceTranslationEnabled.addEventListener("change", updateFormAffordances);
elements.voiceTranslationTargetLanguage.addEventListener("change", updateFormAffordances);
elements.voiceTranslationSendMode.addEventListener("change", updateFormAffordances);
elements.openaiModel.addEventListener("input", updateFormAffordances);
elements.autoLaunch.addEventListener("change", () => {
  updateFormAffordances();
  renderChecklist();
});
elements.launchToTray.addEventListener("change", updateFormAffordances);
elements.closeToTray.addEventListener("change", updateFormAffordances);
elements.xiaomiRemoteEnabled.addEventListener("change", () => {
  updateFormAffordances();
  renderChecklist();
  renderRemoteStatus();
});
elements.volcengineAppKey.addEventListener("input", renderChecklist);
elements.volcengineAccessKey.addEventListener("input", renderChecklist);
elements.openaiApiKey.addEventListener("input", renderChecklist);

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.saveSettingsButton.disabled = true;
  elements.saveSettingsButton.textContent = t("saving");
  try {
    const bootstrap = await window.vibeApp.saveConfig(collectFormPayload());
    appState.bootstrap = bootstrap;
    appState.service = bootstrap.service;
    fillForm(bootstrap.form, bootstrap.desktopSettingsPath);
    renderNotices(bootstrap.form);
    renderService();
    renderChecklist();
    connectLiveSocket();
    elements.saveSettingsButton.textContent = t("saved");
    setTimeout(() => {
      elements.saveSettingsButton.textContent = t("save");
    }, 1600);
  } finally {
    elements.saveSettingsButton.disabled = false;
  }
});

elements.discardSettingsButton.addEventListener("click", () => {
  if (appState.bootstrap?.form) {
    fillForm(appState.bootstrap.form, appState.bootstrap.desktopSettingsPath);
    renderNotices(appState.bootstrap.form);
    renderChecklist();
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
  void window.vibeApp.openConfigFolder();
});

elements.openLogsButton.addEventListener("click", () => {
  void window.vibeApp.openConfigFolder();
});

elements.pickCodexCwdButton.addEventListener("click", () => chooseDirectory(elements.codexCwd));
elements.pickClaudeCwdButton.addEventListener("click", () => chooseDirectory(elements.claudeCwd));

document.querySelectorAll(".rbtn[data-btn]").forEach((button) => {
  button.addEventListener("click", () => {
    selectedRemoteButton = button.dataset.btn;
    renderRemoteEditor();
  });
});

elements.gestureTabs.querySelectorAll("[data-gesture]").forEach((tab) => {
  tab.addEventListener("click", () => {
    selectedGesture = tab.dataset.gesture;
    renderRemoteEditor();
  });
});

elements.actionType.addEventListener("change", () => {
  const type = elements.actionType.value;
  const defaults = {
    none: { type: "none" },
    key: { type: "key", key: "enter" },
    combo: { type: "combo", combo: "ctrl+shift+p" },
    app: { type: "app", command: "" },
    text: { type: "text", text: "" },
    prompt: { type: "prompt", name: promptTemplates[0]?.name || "" }
  };
  setGestureAction(defaults[type] || { type: "none" });
  renderRemoteEditor();
});

elements.actionKey.addEventListener("change", () => {
  setGestureAction({ type: "key", key: elements.actionKey.value });
});

for (const input of [elements.comboCtrl, elements.comboAlt, elements.comboShift, elements.comboWin]) {
  input.addEventListener("change", () => {
    setGestureAction({ type: "combo", combo: currentCombo() });
  });
}
elements.comboKey.addEventListener("input", () => {
  setGestureAction({ type: "combo", combo: currentCombo() });
});

elements.actionApp.addEventListener("input", () => {
  setGestureAction({ type: "app", command: elements.actionApp.value });
});

elements.actionText.addEventListener("input", () => {
  setGestureAction({ type: "text", text: elements.actionText.value });
});

elements.actionPrompt.addEventListener("change", () => {
  setGestureAction({ type: "prompt", name: elements.actionPrompt.value });
});

elements.templateAddButton.addEventListener("click", () => {
  const name = elements.templateName.value.trim();
  const body = elements.templateBody.value.trim();
  if (!name || !body) {
    return;
  }
  const existing = promptTemplates.findIndex((entry) => entry.name === name);
  if (existing >= 0) {
    promptTemplates[existing] = { name, body };
  } else {
    promptTemplates.push({ name, body });
  }
  elements.templateName.value = "";
  elements.templateBody.value = "";
  renderPromptTemplates();
});

function beginHotkeyCapture(target) {
  localMic.capturingHotkey = target;
  const input = target === "send"
    ? elements.localMicSendKey
    : target === "undo"
      ? elements.localMicUndoKey
      : target === "translationToggle"
        ? elements.localMicTranslationToggleKey
        : elements.localMicHoldKey;
  input.value = "…";
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
  if (payload.remote !== undefined) {
    appState.remote = payload.remote;
  }
  renderService();
  renderRemoteStatus();
  connectLiveSocket();
});

window.vibeApp.onGlobalHotkey(handleGlobalHotkey);

if (elements.actionKey) {
  for (const key of REMOTE_KEY_OPTIONS) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = keyLabel(key);
    elements.actionKey.append(option);
  }
}
renderPromptTemplates();
setActiveTab("basic");
renderLocalMic();
renderRemoteEditor();
await refreshBootstrap();
