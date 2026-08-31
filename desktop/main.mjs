import fs from "node:fs";
import { execFile, fork, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { promisify } from "node:util";

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, screen, session, shell, Tray } from "electron";
import { WebSocket } from "ws";

import { buildDesktopFormState, buildUserConfigUpdates } from "../src/desktop-config.mjs";
import { getConfigIssues, loadConfig, writeUserConfigValues } from "../src/config.mjs";
import { getDesktopSettingsPath, loadDesktopSettings, writeDesktopSettings } from "../src/desktop-settings.mjs";
import { getUserConfigDir } from "../src/paths.mjs";
import { queryXiaomiRemoteInfo } from "../src/xiaomi-remote-info.mjs";
import { checkRemotePairingStatus } from "../src/xiaomi-remote-pairing.mjs";
import {
  checkXiaomiRemoteHidHealth,
  restartXiaomiRemoteHidChild
} from "../src/xiaomi-remote-hid-health.mjs";
import { inspectWindowsVirtualMicrophone } from "../src/windows-virtual-microphone.mjs";

const APP_ID = "com.mac20777.vibecodingvoice";
const HIDDEN_LAUNCH_ARG = "--hidden";
const PROCESS_LOG_LIMIT = 200;
const READY_TIMEOUT_MS = 8_000;
const DEFAULT_INVOKE_CWD = os.homedir();

if (!process.env.VIBE_INVOKE_CWD) {
  process.env.VIBE_INVOKE_CWD = DEFAULT_INVOKE_CWD;
}

app.setAppUserModelId(APP_ID);
writeDesktopLog("app boot", {
  argv: process.argv,
  packaged: app.isPackaged,
  execPath: process.execPath
});

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
}

let mainWindow = null;
let tray = null;
let bridgeChild = null;
let xiaomiRemoteChild = null;
let xiaomiRemoteStopRequested = false;
let xiaomiRemoteRestartTimer = null;
let xiaomiRemoteRestartDelayMs = 5_000;
let globalHotkeyChild = null;
let globalHotkeyRestartTimer = null;
let globalHotkeysReady = false;
let globalHotkeyStartToken = 0;
const globalHotkeyFailed = new Map();
let bridgeStopRequested = false;
let isQuitting = false;
let initialLaunchHidden = false;
let closeToTrayNoticeShown = false;
let bundledIconCache = null;
const trayIconCache = new Map();
let trayLanguageMode = "chinese";
const desktopLogPath = path.join(getUserConfigDir(), "desktop.log");

function writeDesktopLog(message, details = null) {
  try {
    fs.mkdirSync(path.dirname(desktopLogPath), { recursive: true });
    const suffix = details
      ? ` ${typeof details === "string" ? details : JSON.stringify(details)}`
      : "";
    fs.appendFileSync(desktopLogPath, `${new Date().toISOString()} ${message}${suffix}\n`, "utf8");
  } catch {
    // ignore logging failures
  }
}

const serviceState = {
  status: "stopped",
  message: "Bridge is stopped.",
  mode: "text_injector",
  port: 8765,
  pid: null,
  logs: [],
  ownership: "app"
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let latestRemoteInfo = null;
let latestRemoteCaptureStatus = null;
let latestRemoteMenuGuardStatus = null;

// Queries the remote's model/battery once via BLE GATT (see
// src/xiaomi-remote-info.mjs). Deliberately not polled: runs at app start and
// whenever the remote capture child is (re)started.
async function refreshRemoteInfoOnce(reason = "startup") {
  if (process.platform !== "win32") {
    return;
  }
  const config = loadEffectiveConfig();
  if (!config.xiaomiRemoteEnabled) {
    if (latestRemoteInfo !== null) {
      latestRemoteInfo = null;
      emitState();
    }
    return;
  }
  const info = await queryXiaomiRemoteInfo(config.xiaomiRemoteHidDeviceMatch);
  if (!info) {
    writeDesktopLog("remote info query failed", { reason });
    return;
  }
  latestRemoteInfo = { ...info, updatedAt: Date.now() };
  writeDesktopLog("remote info", { reason, ...info });
  emitState();
}

let latestRemoteHidProblem = null;

// Reads the PnP problem code of the remote's HID-over-GATT child device (see
// src/xiaomi-remote-hid-health.mjs). A problem code is what Windows Settings
// shows as "driver error" after a re-pair. The USBPcap voice/button path does
// not depend on that child device, but the remote page offers a one-click
// repair so users do not have to reboot to clear the error.
async function refreshRemoteHidHealth(reason = "startup") {
  if (process.platform !== "win32") {
    return;
  }
  const config = loadEffectiveConfig();
  if (!config.xiaomiRemoteEnabled) {
    if (latestRemoteHidProblem !== null) {
      latestRemoteHidProblem = null;
      emitState();
    }
    return;
  }
  try {
    const entries = await checkXiaomiRemoteHidHealth(config.xiaomiRemoteHidDeviceMatch);
    const broken = entries.find((entry) => entry.problem !== 0);
    const problem = broken ? broken.problem : entries.length > 0 ? 0 : null;
    if (problem !== latestRemoteHidProblem) {
      latestRemoteHidProblem = problem;
      writeDesktopLog("remote hid health", { reason, problem, entries: entries.length });
      emitState();
    }
  } catch (error) {
    writeDesktopLog("remote hid health check failed", { reason, error: error?.message });
  }
}

let remoteHidRepairInFlight = false;

// Repairs the remote's broken HID child (the "driver error" Windows Settings
// shows after a re-pair) through the installed, restricted Windows broker.
// Used by the Remote page's manual repair button; the automatic path lives
// inside the broker-owned capture helper and needs no runtime UAC prompt.
async function maybeRepairRemoteHid(reason = "service-start") {
  if (remoteHidRepairInFlight || process.platform !== "win32") {
    return;
  }
  const config = loadEffectiveConfig();
  if (!config.xiaomiRemoteEnabled) {
    return;
  }
  remoteHidRepairInFlight = true;
  try {
    const entries = await checkXiaomiRemoteHidHealth(config.xiaomiRemoteHidDeviceMatch);
    const broken = entries.find((entry) => entry.problem !== 0);
    if (!broken) {
      const problem = entries.length > 0 ? 0 : null;
      if (problem !== latestRemoteHidProblem) {
        latestRemoteHidProblem = problem;
        emitState();
      }
      return;
    }
    writeDesktopLog("remote hid broken; broker repair follows", {
      reason,
      instanceId: broken.instanceId,
      problem: broken.problem
    });
    appendProcessLog(
      "xiaomi-remote",
      "Remote driver error detected; repairing through the Windows remote broker."
    );
    const result = await restartXiaomiRemoteHidChild(
      broken.instanceId,
      config.xiaomiRemoteHidDeviceMatch
    );
    latestRemoteHidProblem = result.healthy ? 0 : broken.problem;
    writeDesktopLog("remote hid manual repair finished", {
      reason,
      healthy: result.healthy,
      exitCode: result.exitCode,
      output: result.output
    });
    appendProcessLog(
      "xiaomi-remote",
      result.healthy
        ? "Remote driver repaired."
        : "Remote driver repair did not clear the error; a Windows restart may be needed."
    );
    emitState();
  } catch (error) {
    writeDesktopLog("remote hid auto-repair failed", { reason, error: error?.message });
  } finally {
    remoteHidRepairInFlight = false;
  }
}

const NAMED_KEY_VKS = new Map([
  ["BACKSPACE", 0x08],
  ["TAB", 0x09],
  ["ENTER", 0x0d],
  ["ESC", 0x1b],
  ["ESCAPE", 0x1b],
  ["SPACE", 0x20],
  ["PAGEUP", 0x21],
  ["PAGEDOWN", 0x22],
  ["END", 0x23],
  ["HOME", 0x24],
  ["ARROWLEFT", 0x25],
  ["LEFT", 0x25],
  ["ARROWUP", 0x26],
  ["UP", 0x26],
  ["ARROWRIGHT", 0x27],
  ["RIGHT", 0x27],
  ["ARROWDOWN", 0x28],
  ["DOWN", 0x28],
  ["INSERT", 0x2d],
  ["DELETE", 0x2e],
  ["NUMPAD0", 0x60],
  ["NUMPAD1", 0x61],
  ["NUMPAD2", 0x62],
  ["NUMPAD3", 0x63],
  ["NUMPAD4", 0x64],
  ["NUMPAD5", 0x65],
  ["NUMPAD6", 0x66],
  ["NUMPAD7", 0x67],
  ["NUMPAD8", 0x68],
  ["NUMPAD9", 0x69],
  ["NUMPADMULTIPLY", 0x6a],
  ["NUMPADADD", 0x6b],
  ["NUMPADSUBTRACT", 0x6d],
  ["NUMPADDECIMAL", 0x6e],
  ["NUMPADDIVIDE", 0x6f]
]);

for (let index = 1; index <= 24; index += 1) {
  NAMED_KEY_VKS.set(`F${index}`, 0x70 + index - 1);
}

function keyPartToVk(keyPart) {
  const normalized = String(keyPart || "").trim().toUpperCase();
  if (/^[A-Z]$/.test(normalized)) {
    return normalized.charCodeAt(0);
  }
  if (/^[0-9]$/.test(normalized)) {
    return normalized.charCodeAt(0);
  }
  return NAMED_KEY_VKS.get(normalized) || null;
}

function parseHotkey(value) {
  const parts = String(value || "")
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return null;
  }

  const modifiers = new Set();
  let keyVk = null;
  for (const part of parts) {
    const normalized = part.toLowerCase();
    if (normalized === "ctrl" || normalized === "control") {
      modifiers.add("Ctrl");
      continue;
    }
    if (normalized === "alt" || normalized === "option") {
      modifiers.add("Alt");
      continue;
    }
    if (normalized === "shift") {
      modifiers.add("Shift");
      continue;
    }
    if (normalized === "meta" || normalized === "win" || normalized === "cmd" || normalized === "command") {
      modifiers.add("Meta");
      continue;
    }
    keyVk = keyPartToVk(part);
  }

  if (!keyVk) {
    return null;
  }

  return { keyVk, modifiers };
}

function selectDesktopHotkeySettings(settings = loadDesktopSettings()) {
  return {
    localMicHoldKey: settings.localMicHoldKey,
    localMicSendKey: settings.localMicSendKey,
    localMicUndoKey: settings.localMicUndoKey,
    localMicTranslationToggleKey: settings.localMicTranslationToggleKey
  };
}

function emitGlobalHotkey(payload) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("desktop:global-hotkey", payload);
  }
}

function describeFailedHotkeys() {
  const settings = selectDesktopHotkeySettings();
  const labels = new Map([
    [1, settings.localMicHoldKey],
    [2, settings.localMicSendKey],
    [3, settings.localMicUndoKey],
    [4, settings.localMicTranslationToggleKey],
    [5, "Menu"]
  ]);
  return [...globalHotkeyFailed.keys()].map((id) => labels.get(id) || `hotkey ${id}`);
}

function emitGlobalHotkeyStatus() {
  emitGlobalHotkey({
    type: "status",
    ready: globalHotkeysReady,
    failedKeys: describeFailedHotkeys(),
    settings: selectDesktopHotkeySettings()
  });
}

const HOTKEY_MODIFIER_BITS = new Map([
  ["Shift", 1],
  ["Ctrl", 2],
  ["Alt", 4],
  ["Meta", 8]
]);

function hotkeyModifierMask(modifiers) {
  let mask = 0;
  for (const modifier of modifiers || []) {
    mask |= HOTKEY_MODIFIER_BITS.get(modifier) || 0;
  }
  return mask;
}

function appendHotkeyHelperArgs(args, name, value) {
  const hotkey = parseHotkey(value);
  if (!hotkey) {
    return;
  }
  args.push(`--${name}-vk`, String(hotkey.keyVk));
  args.push(`--${name}-modifiers`, String(hotkeyModifierMask(hotkey.modifiers)));
}

function windowsInputHelperPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "input-helper", "VibeCodingVoiceInputHelper.exe");
  }
  return path.join(app.getAppPath(), "build-assets", "input-helper", "VibeCodingVoiceInputHelper.exe");
}

function buildHotkeyHelperArgs() {
  const settings = loadDesktopSettings();
  const effectiveConfig = loadEffectiveConfig();
  const args = ["--monitor", "--owner-pid", String(process.pid)];
  appendHotkeyHelperArgs(args, "record", settings.localMicHoldKey);
  appendHotkeyHelperArgs(args, "send", settings.localMicSendKey);
  appendHotkeyHelperArgs(args, "undo", settings.localMicUndoKey);
  appendHotkeyHelperArgs(args, "translate", settings.localMicTranslationToggleKey);
  if (effectiveConfig.xiaomiRemoteEnabled === true) {
    args.push("--suppress-menu");
  }
  return args;
}

function handleGlobalHotkeyEvent(event) {
  if ([
    "record_start",
    "record_stop",
    "action_send",
    "action_undo",
    "toggle_english_output",
    "cancel_active_dictation"
  ].includes(event?.type)) {
    emitGlobalHotkey(event);
  }
}

// Kills input helpers orphaned by a crashed or force-killed app instance. A
// leftover helper keeps its global hotkeys registered, and RegisterHotKey is
// system-wide exclusive — every registration in the next instance then fails
// and F8/F9/F10 stay dead until the machine reboots. The single-instance lock
// means any helper from our own exe path that is not our current child is
// stale by definition.
async function killStaleInputHelpers(helperPath) {
  if (process.platform !== "win32") {
    return 0;
  }
  const keepPid = globalHotkeyChild?.pid ?? 0;
  const script = `
$target = '${String(helperPath).replace(/'/g, "''")}'
Get-CimInstance Win32_Process -Filter "Name='VibeCodingVoiceInputHelper.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.ExecutablePath -ieq $target -and $_.ProcessId -ne ${keepPid} } |
  ForEach-Object { $_.ProcessId }
`;
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 5_000, windowsHide: true }
    );
    const pids = stdout
      .split(/\r?\n/)
      .map((line) => Number(line.trim()))
      .filter((pid) => pid > 0);
    for (const pid of pids) {
      await killProcessTree(pid);
    }
    return pids.length;
  } catch {
    return 0;
  }
}

function trackGlobalHotkeyLine(line) {
  const failed = /^hotkey_failed id=(\d+) vk=(\d+) error=(\d+)/.exec(line);
  if (failed) {
    globalHotkeyFailed.set(Number(failed[1]), Number(failed[2]));
    emitGlobalHotkeyStatus();
    return;
  }
  const registered = /^hotkey_registered id=(\d+)/.exec(line);
  if (registered) {
    globalHotkeyFailed.delete(Number(registered[1]));
    emitGlobalHotkeyStatus();
  }
}

function spawnGlobalHotkeyHelper(helperPath) {
  const child = spawn(helperPath, buildHotkeyHelperArgs(), {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  globalHotkeyChild = child;
  globalHotkeysReady = false;
  globalHotkeyFailed.clear();

  const reader = readline.createInterface({ input: child.stdout });
  reader.on("line", (line) => {
    try {
      handleGlobalHotkeyEvent(JSON.parse(line));
    } catch {
      // ignore malformed keyboard hook output
    }
  });

  const errReader = readline.createInterface({ input: child.stderr });
  errReader.on("line", (line) => {
    if (line.trim() === "ready") {
      globalHotkeysReady = true;
      appendProcessLog("hotkey", "global shortcuts ready");
      emitGlobalHotkeyStatus();
      return;
    }
    trackGlobalHotkeyLine(line.trim());
    appendProcessLog("hotkey", line);
  });

  child.on("error", (error) => {
    globalHotkeysReady = false;
    appendProcessLog("hotkey", error.message || String(error));
    emitGlobalHotkeyStatus();
  });

  child.on("exit", (code, signal) => {
    if (globalHotkeyChild !== child) {
      return;
    }
    globalHotkeyChild = null;
    globalHotkeysReady = false;
    appendProcessLog("hotkey", `global shortcuts stopped code=${code ?? "null"} signal=${signal ?? "null"}`);
    emitGlobalHotkeyStatus();
    if (!isQuitting && !globalHotkeyRestartTimer) {
      globalHotkeyRestartTimer = setTimeout(() => {
        globalHotkeyRestartTimer = null;
        startGlobalHotkeyMonitor();
      }, 2000);
    }
  });
}

function startGlobalHotkeyMonitor() {
  if (process.platform !== "win32" || globalHotkeyChild || isQuitting) {
    emitGlobalHotkeyStatus();
    return;
  }

  const helperPath = windowsInputHelperPath();
  if (!fs.existsSync(helperPath)) {
    globalHotkeysReady = false;
    appendProcessLog("hotkey", `Windows input helper is missing: ${helperPath}`);
    emitGlobalHotkeyStatus();
    return;
  }

  const token = ++globalHotkeyStartToken;
  void killStaleInputHelpers(helperPath).then((killed) => {
    if (killed > 0) {
      appendProcessLog("hotkey", `killed ${killed} stale input helper process(es)`);
    }
    if (token !== globalHotkeyStartToken || globalHotkeyChild || isQuitting) {
      return;
    }
    spawnGlobalHotkeyHelper(helperPath);
  });
}

function stopGlobalHotkeyMonitor() {
  globalHotkeyStartToken += 1;
  if (globalHotkeyRestartTimer) {
    clearTimeout(globalHotkeyRestartTimer);
    globalHotkeyRestartTimer = null;
  }
  if (globalHotkeyChild) {
    globalHotkeyChild.kill();
    globalHotkeyChild = null;
  }
  globalHotkeysReady = false;
  globalHotkeyFailed.clear();
}

function restartGlobalHotkeyMonitor() {
  stopGlobalHotkeyMonitor();
  startGlobalHotkeyMonitor();
}

function loadEffectiveConfig() {
  return loadConfig({ quietMissing: true, desktopMode: true });
}

function snapshotServiceState() {
  return {
    ...serviceState,
    logs: [...serviceState.logs]
  };
}

function emitState() {
  const payload = {
    service: snapshotServiceState(),
    remote: latestRemoteInfo,
    remoteHidProblem: latestRemoteHidProblem,
    remoteCaptureStatus: latestRemoteCaptureStatus,
    remoteMenuGuardStatus: latestRemoteMenuGuardStatus
  };

  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("desktop:state", payload);
  }

  refreshTrayMenu();
}

function setServiceState(patch) {
  Object.assign(serviceState, patch);
  emitState();
}

function appendProcessLog(source, line) {
  const trimmed = String(line || "").trim();
  if (!trimmed) {
    return;
  }

  serviceState.logs = [...serviceState.logs, `[${source}] ${trimmed}`].slice(-PROCESS_LOG_LIMIT);
  emitState();
}

function normalizeTrayLanguageMode(value) {
  return value === "english" ? "english" : "chinese";
}

function trayLanguageLabel(mode = trayLanguageMode) {
  return normalizeTrayLanguageMode(mode) === "english" ? "English output" : "Chinese input";
}

function trayIconSize() {
  return process.platform === "win32" ? 16 : 20;
}

function resizeTrayIcon(image) {
  if (!image || image.isEmpty()) {
    return null;
  }

  const trayIcon = image.resize({ width: trayIconSize(), height: trayIconSize() });
  return trayIcon.isEmpty() ? image : trayIcon;
}

function loadTrayBadgeIcon(mode = trayLanguageMode) {
  const normalizedMode = normalizeTrayLanguageMode(mode);
  if (trayIconCache.has(normalizedMode)) {
    return trayIconCache.get(normalizedMode);
  }

  const filename = normalizedMode === "english" ? "tray-english.png" : "tray-chinese.png";
  const candidatePaths = [
    path.join(app.getAppPath(), "build-assets", filename),
    path.join(process.resourcesPath, "build-assets", filename),
    path.join(process.cwd(), "build-assets", filename)
  ];

  for (const candidatePath of candidatePaths) {
    try {
      if (!fs.existsSync(candidatePath)) {
        continue;
      }

      const image = nativeImage.createFromBuffer(fs.readFileSync(candidatePath));
      const trayIcon = resizeTrayIcon(image);
      if (trayIcon) {
        trayIconCache.set(normalizedMode, trayIcon);
        return trayIcon;
      }
    } catch (error) {
      writeDesktopLog("tray badge icon load failed", {
        candidatePath,
        error: error?.message || String(error)
      });
    }
  }

  return null;
}

function createFallbackTrayIcon() {
  const bundledIcon = loadBundledAppIcon();
  const trayIcon = resizeTrayIcon(bundledIcon);
  if (trayIcon) {
    return trayIcon;
  }

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#09131f" />
          <stop offset="100%" stop-color="#0d5f73" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="56" height="56" rx="18" fill="url(#g)" />
      <path d="M20 22c0-6.6 5.4-12 12-12s12 5.4 12 12v8c0 6.6-5.4 12-12 12s-12-5.4-12-12v-8Z" fill="#f7f4ea"/>
      <path d="M16 30c0 8.8 7.2 16 16 16s16-7.2 16-16" stroke="#f8b84e" stroke-width="4" stroke-linecap="round" fill="none"/>
      <path d="M32 46v8" stroke="#f8b84e" stroke-width="4" stroke-linecap="round"/>
      <path d="M24 54h16" stroke="#f8b84e" stroke-width="4" stroke-linecap="round"/>
    </svg>
  `;

  return nativeImage
    .createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`)
    .resize({ width: trayIconSize(), height: trayIconSize() });
}

function createTrayIcon(mode = trayLanguageMode) {
  return loadTrayBadgeIcon(mode) || createFallbackTrayIcon();
}

function updateTrayLanguageMode(mode) {
  const nextMode = normalizeTrayLanguageMode(mode);
  if (trayLanguageMode === nextMode) {
    return;
  }

  trayLanguageMode = nextMode;
  if (tray) {
    tray.setImage(createTrayIcon(trayLanguageMode));
    refreshTrayMenu();
  }
}

function createWindowIcon() {
  const bundledIcon = loadBundledAppIcon();
  if (bundledIcon && !bundledIcon.isEmpty()) {
    return bundledIcon;
  }
  return createTrayIcon();
}

function loadBundledAppIcon() {
  if (bundledIconCache && !bundledIconCache.isEmpty()) {
    return bundledIconCache;
  }

  const candidatePaths = [
    path.join(app.getAppPath(), "build-assets", "tray-icon.png"),
    path.join(app.getAppPath(), "build-assets", "app-icon.png"),
    path.join(process.resourcesPath, "build-assets", "tray-icon.png"),
    path.join(process.resourcesPath, "build-assets", "app-icon.png"),
    path.join(process.cwd(), "build-assets", "tray-icon.png"),
    path.join(process.cwd(), "build-assets", "app-icon.png")
  ];

  for (const candidatePath of candidatePaths) {
    try {
      if (!fs.existsSync(candidatePath)) {
        continue;
      }

      const image = nativeImage.createFromBuffer(fs.readFileSync(candidatePath));
      if (!image.isEmpty()) {
        bundledIconCache = image;
        writeDesktopLog("loaded bundled icon", {
          candidatePath,
          size: image.getSize()
        });
        return bundledIconCache;
      }

      writeDesktopLog("bundled icon image is empty", { candidatePath });
    } catch (error) {
      writeDesktopLog("bundled icon load failed", {
        candidatePath,
        error: error?.message || String(error)
      });
    }
  }

  writeDesktopLog("bundled icon fallback to generated svg");
  return null;
}

function serviceStatusLabel(status) {
  if (status === "running") {
    return "Running";
  }
  if (status === "starting") {
    return "Starting";
  }
  if (status === "needs_setup") {
    return "Needs Setup";
  }
  if (status === "error") {
    return "Error";
  }
  return "Stopped";
}

function modeLabel(mode) {
  if (mode === "claude_code") {
    return "Claude Code";
  }
  if (mode === "codex_exec") {
    return "Codex";
  }
  return "Inject";
}

function shouldHideOnLaunch() {
  const desktopSettings = loadDesktopSettings();
  return process.argv.includes(HIDDEN_LAUNCH_ARG) && desktopSettings.launchToTray;
}

function hasLiveMainWindow() {
  return Boolean(mainWindow) && !mainWindow.isDestroyed();
}

function ensureMainWindow() {
  if (hasLiveMainWindow()) {
    return mainWindow;
  }

  createMainWindow();
  return mainWindow;
}

function showMainWindow() {
  ensureMainWindow();
  writeDesktopLog("showMainWindow", {
    minimized: mainWindow.isMinimized(),
    visible: mainWindow.isVisible()
  });
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function maybeHideToTray(event) {
  if (isQuitting) {
    return;
  }

  const desktopSettings = loadDesktopSettings();
  if (!desktopSettings.closeToTray) {
    writeDesktopLog("mainWindow close allowed");
    return;
  }

  event.preventDefault();
  writeDesktopLog("mainWindow hidden to tray on close");
  mainWindow?.hide();
  if (!closeToTrayNoticeShown && process.platform === "win32" && tray) {
    closeToTrayNoticeShown = true;
    tray.displayBalloon({
      title: "VibeCoding Voice 仍在后台运行",
      content: "关闭窗口只会收进托盘；要彻底退出，请右键托盘图标并选择 Quit。",
      iconType: "info",
      noSound: true
    });
  }
}

function bridgeEntryPath() {
  return path.join(app.getAppPath(), "src", "server.mjs");
}

function xiaomiRemoteEntryPath() {
  return path.join(app.getAppPath(), "scripts", "xiaomi-remote-input.mjs");
}

function createLineReader(stream, source) {
  stream.setEncoding("utf8");
  const reader = readline.createInterface({ input: stream });
  reader.on("line", (line) => {
    writeDesktopLog(`child:${source}`, line);
    appendProcessLog(source, line);
  });
}

function connectToLocalBridge(port, timeoutMs = 1_500) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`Timed out while connecting to bridge on port ${port}.`));
    }, timeoutMs);

    const cleanup = () => clearTimeout(timer);

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "hello", deviceId: "desktop-app", boardType: "desktop-app" }));
    });

    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString("utf8"));
        if (message.type === "server_ready") {
          cleanup();
          ws.close();
          resolve(message);
        }
        if (message.type === "error") {
          cleanup();
          ws.close();
          reject(new Error(message.error || "Bridge returned an error."));
        }
      } catch (error) {
        cleanup();
        ws.close();
        reject(error);
      }
    });

    ws.on("error", (error) => {
      cleanup();
      reject(error);
    });
  });
}

async function waitForLocalBridge(port, timeoutMs = READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      return await connectToLocalBridge(port, 1_500);
    } catch (error) {
      lastError = error;
      await wait(350);
    }
  }

  throw lastError || new Error("Bridge did not become ready in time.");
}

async function syncAutoLaunch(settings = loadDesktopSettings()) {
  if (!app.isPackaged) {
    return;
  }

  app.setLoginItemSettings({
    openAtLogin: settings.autoLaunch,
    openAsHidden: settings.launchToTray,
    path: process.execPath,
    args: settings.launchToTray ? [HIDDEN_LAUNCH_ARG] : []
  });
}

const execFileAsync = promisify(execFile);

async function killProcessTree(pid) {
  if (!pid) {
    return;
  }
  if (process.platform === "win32") {
    await execFileAsync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      timeout: 5_000,
      windowsHide: true
    }).catch(() => {});
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // already gone
  }
}

// Finds a bridge child orphaned by a previous crash/force-quit that is still
// holding the voice port. Only returns a pid when the listener is verifiably
// ours: its command line points at this app's server entry AND its parent
// process is already gone — a deliberately started server (npm start) has a
// live parent and is left alone.
async function findOrphanedBridgePid(port) {
  if (process.platform !== "win32") {
    return 0;
  }
  const script = `
$conn = Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $conn) { exit 0 }
$proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($conn.OwningProcess)" -ErrorAction SilentlyContinue
if (-not $proc) { exit 0 }
$parentAlive = $false
if ($proc.ParentProcessId) {
  $parentAlive = [bool](Get-Process -Id $proc.ParentProcessId -ErrorAction SilentlyContinue)
}
[pscustomobject]@{ pid = $proc.ProcessId; commandLine = $proc.CommandLine; parentAlive = $parentAlive } | ConvertTo-Json -Compress
`;
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 5_000, windowsHide: true }
    );
    const info = JSON.parse(stdout.trim() || "{}");
    const pid = Number(info.pid) || 0;
    if (!pid || info.parentAlive) {
      return 0;
    }
    const commandLine = String(info.commandLine || "").toLowerCase().replace(/\//g, "\\");
    const entry = bridgeEntryPath().toLowerCase().replace(/\//g, "\\");
    return commandLine.includes(entry) ? pid : 0;
  } catch {
    return 0;
  }
}

async function stopBridgeProcess() {
  if (xiaomiRemoteChild) {
    const child = xiaomiRemoteChild;
    xiaomiRemoteChild = null;
    xiaomiRemoteStopRequested = true;
    writeDesktopLog("stopXiaomiRemoteProcess", { pid: child.pid ?? null });
    child.kill();
  }
  latestRemoteCaptureStatus = null;
  latestRemoteMenuGuardStatus = null;

  if (!bridgeChild) {
    const config = loadEffectiveConfig();
    const issues = getConfigIssues(config);
    setServiceState({
      status: issues.length ? "needs_setup" : "stopped",
      message: issues[0] || "Bridge is stopped.",
      mode: config.sendTarget,
      port: config.port,
      pid: null,
      ownership: "app"
    });
    return;
  }

  const child = bridgeChild;
  bridgeStopRequested = true;
  writeDesktopLog("stopBridgeProcess", { pid: child.pid ?? null });
  setServiceState({
    status: "stopped",
    message: "Stopping bridge…",
    pid: child.pid ?? null
  });

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };

    child.once("exit", finish);
    child.kill();
    setTimeout(() => {
      if (settled) {
        return;
      }
      writeDesktopLog("bridge child did not exit in time, force killing", { pid: child.pid ?? null });
      void killProcessTree(child.pid).finally(finish);
    }, 2_000);
  });
}

function startXiaomiRemoteProcess(config) {
  if (!config.xiaomiRemoteEnabled || xiaomiRemoteChild) {
    return;
  }

  xiaomiRemoteStopRequested = false;
  latestRemoteCaptureStatus = null;
  latestRemoteMenuGuardStatus = null;
  const child = fork(xiaomiRemoteEntryPath(), [], {
    cwd: DEFAULT_INVOKE_CWD,
    env: {
      ...process.env,
      VIBE_INVOKE_CWD: process.env.VIBE_INVOKE_CWD || DEFAULT_INVOKE_CWD,
      VIBE_DESKTOP: "1",
      // Electron's development resourcesPath points inside node_modules and
      // does not contain our extraResources. Leaving this empty makes the
      // helper resolve build-assets from the repository instead.
      VIBE_RESOURCES_PATH: app.isPackaged ? process.resourcesPath : ""
    },
    silent: true,
    windowsHide: false
  });
  xiaomiRemoteChild = child;
  // Once a child survives a minute, treat it as healthy and reset the
  // restart backoff.
  setTimeout(() => {
    if (xiaomiRemoteChild === child) {
      xiaomiRemoteRestartDelayMs = 5_000;
    }
  }, 60_000);
  void refreshRemoteInfoOnce("remote-start");
  // A broken HID child is repaired inside the broker-owned capture helper
  // (see scripts/xiaomi-remote-input.mjs); here we only track the
  // state for the UI warning, re-checking once the helper had time to repair.
  void refreshRemoteHidHealth("remote-start");
  setTimeout(() => {
    if (xiaomiRemoteChild === child) {
      void refreshRemoteHidHealth("remote-start-delayed");
    }
  }, 15_000);
  writeDesktopLog("xiaomi remote child forked", {
    pid: child.pid ?? null,
    entry: xiaomiRemoteEntryPath()
  });
  if (child.stdout) {
    createLineReader(child.stdout, "xiaomi-remote");
  }
  if (child.stderr) {
    createLineReader(child.stderr, "xiaomi-remote");
  }
  child.on("message", (message) => {
    if (xiaomiRemoteChild !== child) {
      return;
    }
    if (message?.type === "xiaomi_remote_wechat_ready_check") {
      const requestId = String(message.requestId || "");
      void ensureWechatReady()
        .then(() => {
          if (xiaomiRemoteChild === child && child.connected) {
            child.send({
              type: "xiaomi_remote_wechat_ready_result",
              requestId,
              ok: true
            });
          }
        })
        .catch((error) => {
          if (xiaomiRemoteChild === child && child.connected) {
            child.send({
              type: "xiaomi_remote_wechat_ready_result",
              requestId,
              ok: false,
              error: error?.message || String(error)
            });
          }
        });
      return;
    }
    if (message?.type === "xiaomi_remote_menu_guard_status") {
      latestRemoteMenuGuardStatus = message.state === "ready"
        ? null
        : {
            state: String(message.state || ""),
            error: message.error || null,
            details: message.details || null,
            updatedAt: Date.now()
          };
      writeDesktopLog(
        "xiaomi remote menu guard status",
        latestRemoteMenuGuardStatus || { state: "ready" }
      );
      emitState();
      return;
    }
    if (message?.type !== "xiaomi_remote_capture_status") {
      return;
    }
    latestRemoteCaptureStatus = message.state === "ready"
      ? null
      : {
          state: String(message.state || ""),
          metadata: message.metadata || null,
          updatedAt: Date.now()
        };
    writeDesktopLog("xiaomi remote capture status", latestRemoteCaptureStatus || { state: "ready" });
    if (message.state === "adapter_changed") {
      void refreshRemoteInfoOnce("adapter-changed");
      void refreshRemoteHidHealth("adapter-changed");
    }
    emitState();
  });
  child.on("exit", (code, signal) => {
    writeDesktopLog("xiaomi remote child exit", { code, signal });
    const wasCurrentChild = xiaomiRemoteChild === child;
    if (wasCurrentChild) {
      xiaomiRemoteChild = null;
      latestRemoteCaptureStatus = null;
      latestRemoteMenuGuardStatus = null;
      emitState();
    }
    if (!isQuitting && code !== 0) {
      appendProcessLog(
        "xiaomi-remote",
        `Remote input exited${code != null ? ` with code ${code}` : ""}${signal ? ` (${signal})` : ""}.`
      );
      if (!xiaomiRemoteStopRequested) {
        scheduleXiaomiRemoteRestart();
      }
    }
  });
}

// Restarts the remote input child after an unexpected exit (crashed capture,
// lost bridge connection, ...). An adapter unplug/replug normally needs no
// restart — the broker-owned capture helper re-resolves the adapter itself — so
// this is the safety net for everything else. Exponential backoff, reset once
// a child stays alive for a minute.
function scheduleXiaomiRemoteRestart() {
  if (xiaomiRemoteRestartTimer || isQuitting) {
    return;
  }
  const config = loadEffectiveConfig();
  if (!config.xiaomiRemoteEnabled || !bridgeChild) {
    return;
  }
  const delayMs = xiaomiRemoteRestartDelayMs;
  xiaomiRemoteRestartDelayMs = Math.min(30_000, xiaomiRemoteRestartDelayMs * 2);
  writeDesktopLog("xiaomi remote restart scheduled", { delayMs });
  xiaomiRemoteRestartTimer = setTimeout(() => {
    xiaomiRemoteRestartTimer = null;
    if (!isQuitting && !xiaomiRemoteStopRequested && bridgeChild && !xiaomiRemoteChild) {
      startXiaomiRemoteProcess(loadEffectiveConfig());
    }
  }, delayMs);
}

async function startBridgeProcess({ revealOnError = true } = {}) {
  if (bridgeChild) {
    writeDesktopLog("startBridgeProcess skipped: already running", { pid: bridgeChild.pid ?? null });
    return;
  }

  const config = loadEffectiveConfig();
  const issues = getConfigIssues(config);
  writeDesktopLog("startBridgeProcess", {
    mode: config.sendTarget,
    port: config.port,
    revealOnError,
    hasIssues: issues.length > 0
  });

  if (issues.length > 0) {
    setServiceState({
      status: "needs_setup",
      message: issues[0],
      mode: config.sendTarget,
      port: config.port,
      pid: null,
      ownership: "app"
    });
    return;
  }

  let portBusy = false;
  try {
    await connectToLocalBridge(config.port, 500);
    portBusy = true;
  } catch {
    // nothing listening locally, safe to start
  }

  if (portBusy) {
    // A bridge orphaned by a previous crash/force-quit keeps holding the port
    // and answers hello like a healthy one. Recover by killing it ourselves.
    const orphanPid = await findOrphanedBridgePid(config.port);
    if (orphanPid) {
      writeDesktopLog("killing orphaned bridge holding the port", { pid: orphanPid, port: config.port });
      await killProcessTree(orphanPid);
      try {
        await connectToLocalBridge(config.port, 500);
      } catch {
        portBusy = false;
      }
    }
  }

  if (portBusy) {
    setServiceState({
      status: "error",
      message: `Port ${config.port} is already in use by another local bridge.`,
      mode: config.sendTarget,
      port: config.port,
      pid: null,
      ownership: "external"
    });
    if (revealOnError) {
      showMainWindow();
    }
    startXiaomiRemoteProcess(config);
    return;
  }

  serviceState.logs = [];
  bridgeStopRequested = false;
  setServiceState({
    status: "starting",
    message: "Starting local bridge…",
    mode: config.sendTarget,
    port: config.port,
    pid: null,
    ownership: "app"
  });

  const child = fork(bridgeEntryPath(), [], {
    cwd: DEFAULT_INVOKE_CWD,
    env: {
      ...process.env,
      VIBE_INVOKE_CWD: process.env.VIBE_INVOKE_CWD || DEFAULT_INVOKE_CWD,
      VIBE_DESKTOP: "1",
      // Lets the bridge resolve the bundled virtual-mic publisher in packaged
      // builds. In development, an empty value deliberately falls back to the
      // repository's build-assets directory.
      VIBE_RESOURCES_PATH: app.isPackaged ? process.resourcesPath : ""
    },
    silent: true,
    windowsHide: true
  });

  bridgeChild = child;
  writeDesktopLog("bridge child forked", { pid: child.pid ?? null, entry: bridgeEntryPath() });

  if (child.stdout) {
    createLineReader(child.stdout, "bridge");
  }
  if (child.stderr) {
    createLineReader(child.stderr, "bridge");
  }

  child.on("exit", (code, signal) => {
    writeDesktopLog("bridge child exit", { code, signal });
    if (bridgeChild === child) {
      bridgeChild = null;
    }

    const nextConfig = loadEffectiveConfig();
    if (isQuitting) {
      return;
    }

    if (bridgeStopRequested) {
      bridgeStopRequested = false;
      const nextIssues = getConfigIssues(nextConfig);
      setServiceState({
        status: nextIssues.length ? "needs_setup" : "stopped",
        message: nextIssues[0] || "Bridge is stopped.",
        mode: nextConfig.sendTarget,
        port: nextConfig.port,
        pid: null,
        ownership: "app"
      });
      return;
    }

    const message = `Bridge exited${code != null ? ` with code ${code}` : ""}${signal ? ` (${signal})` : ""}.`;
    appendProcessLog("bridge", message);
    setServiceState({
      status: "error",
      message,
      mode: nextConfig.sendTarget,
      port: nextConfig.port,
      pid: null,
      ownership: "app"
    });
    showMainWindow();
  });

  setServiceState({
    pid: child.pid ?? null
  });

  try {
    const readyMessage = await waitForLocalBridge(config.port, READY_TIMEOUT_MS);
    if (bridgeChild !== child) {
      return;
    }

    setServiceState({
      status: "running",
      message: "Bridge is running.",
      mode: readyMessage.sendTarget || config.sendTarget,
      port: config.port,
      pid: child.pid ?? null,
      ownership: "app"
    });
    startXiaomiRemoteProcess(config);
  } catch (error) {
    appendProcessLog("bridge", error.message || String(error));
    setServiceState({
      status: "error",
      message: error.message || String(error),
      mode: config.sendTarget,
      port: config.port,
      pid: child.pid ?? null,
      ownership: "app"
    });
    child.kill();
    if (revealOnError) {
      showMainWindow();
    }
  }
}

async function restartBridgeProcess() {
  await stopBridgeProcess();
  await startBridgeProcess();
}

async function persistDesktopSettings(patch) {
  const current = loadDesktopSettings();
  const { settings } = writeDesktopSettings({
    ...current,
    ...patch
  });

  await syncAutoLaunch(settings);
  if (settings.localMicHoldKey !== current.localMicHoldKey) {
    restartGlobalHotkeyMonitor();
  } else {
    emitGlobalHotkeyStatus();
  }
  emitState();
  return settings;
}

async function persistMode(mode) {
  writeUserConfigValues({
    SEND_TARGET: mode
  });
  if (bridgeChild) {
    await restartBridgeProcess();
  } else {
    const config = loadEffectiveConfig();
    const issues = getConfigIssues(config);
    setServiceState({
      status: issues.length ? "needs_setup" : "stopped",
      message: issues[0] || "Bridge is stopped.",
      mode: config.sendTarget,
      port: config.port,
      pid: null,
      ownership: "app"
    });
  }
}

function refreshTrayMenu() {
  if (!tray) {
    return;
  }

  const desktopSettings = loadDesktopSettings();
  const config = loadEffectiveConfig();
  const menu = Menu.buildFromTemplate([
    {
      label: `${serviceStatusLabel(serviceState.status)} · ${modeLabel(serviceState.mode)}`,
      enabled: false
    },
    {
      label: `Voice: ${trayLanguageLabel()}`,
      enabled: false
    },
    { type: "separator" },
    {
      label: "Open Window",
      click: () => showMainWindow()
    },
    {
      label: bridgeChild ? "Restart Bridge" : "Start Bridge",
      click: () => {
        void (bridgeChild ? restartBridgeProcess() : startBridgeProcess());
      }
    },
    {
      label: "Stop Bridge",
      enabled: Boolean(bridgeChild),
      click: () => {
        void stopBridgeProcess();
      }
    },
    { type: "separator" },
    {
      label: "Mode",
      submenu: [
        {
          label: "Inject",
          type: "radio",
          checked: config.sendTarget === "text_injector",
          click: () => void persistMode("text_injector")
        },
        {
          label: "Codex",
          type: "radio",
          checked: config.sendTarget === "codex_exec",
          click: () => void persistMode("codex_exec")
        },
        {
          label: "Claude Code",
          type: "radio",
          checked: config.sendTarget === "claude_code",
          click: () => void persistMode("claude_code")
        }
      ]
    },
    { type: "separator" },
    {
      label: "Launch At Login",
      type: "checkbox",
      checked: desktopSettings.autoLaunch,
      click: (menuItem) => {
        void persistDesktopSettings({ autoLaunch: menuItem.checked });
      }
    },
    {
      label: "Start Hidden",
      type: "checkbox",
      checked: desktopSettings.launchToTray,
      click: (menuItem) => {
        void persistDesktopSettings({ launchToTray: menuItem.checked });
      }
    },
    {
      label: "Close To Tray",
      type: "checkbox",
      checked: desktopSettings.closeToTray,
      click: (menuItem) => {
        void persistDesktopSettings({ closeToTray: menuItem.checked });
      }
    },
    { type: "separator" },
    {
      label: "Open Config Folder",
      click: async () => {
        const configPath = loadEffectiveConfig().userConfigPath;
        await shell.openPath(path.dirname(configPath));
      }
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(menu);
  tray.setToolTip(
    `VibeCoding Voice · ${serviceStatusLabel(serviceState.status)} · ` +
      `${modeLabel(serviceState.mode)} · ${trayLanguageLabel()}`
  );
}

async function buildBootstrap() {
  const config = loadEffectiveConfig();
  const desktopSettings = loadDesktopSettings();
  const virtualMicrophone = await inspectWindowsVirtualMicrophone({
    env: {
      ...process.env,
      VIBE_RESOURCES_PATH: app.isPackaged ? process.resourcesPath : ""
    }
  });

  return {
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    form: buildDesktopFormState(config, desktopSettings),
    desktopSettingsPath: getDesktopSettingsPath(),
    globalHotkeys: {
      ready: globalHotkeysReady,
      failedKeys: describeFailedHotkeys(),
      settings: selectDesktopHotkeySettings(desktopSettings)
    },
    service: snapshotServiceState(),
    remote: latestRemoteInfo,
    remoteHidProblem: latestRemoteHidProblem,
    remoteCaptureStatus: latestRemoteCaptureStatus,
    remoteMenuGuardStatus: latestRemoteMenuGuardStatus,
    virtualMicrophone
  };
}

function createMainWindow() {
  const hiddenLaunch = initialLaunchHidden;
  writeDesktopLog("createMainWindow", { hiddenLaunch });

  mainWindow = new BrowserWindow({
    width: 1120,
    height: 860,
    minWidth: 940,
    minHeight: 700,
    show: !hiddenLaunch,
    title: "VibeCoding Voice",
    backgroundColor: "#0c0e12",
    icon: createWindowIcon(),
    webPreferences: {
      preload: path.join(app.getAppPath(), "desktop", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  mainWindow.on("close", (event) => maybeHideToTray(event));
  mainWindow.on("show", () => writeDesktopLog("mainWindow show"));
  mainWindow.on("hide", () => writeDesktopLog("mainWindow hide"));
  mainWindow.on("focus", () => writeDesktopLog("mainWindow focus"));
  mainWindow.on("blur", () => writeDesktopLog("mainWindow blur"));
  mainWindow.on("closed", () => {
    writeDesktopLog("mainWindow closed");
    mainWindow = null;
  });

  mainWindow.once("ready-to-show", () => {
    writeDesktopLog("mainWindow ready-to-show");
    if (!hiddenLaunch) {
      showMainWindow();
    }
  });

  mainWindow.webContents.on("did-finish-load", () => {
    writeDesktopLog("webContents did-finish-load");
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    writeDesktopLog("webContents did-fail-load", {
      errorCode,
      errorDescription,
      validatedURL
    });
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    writeDesktopLog("webContents render-process-gone", details);
  });

  void mainWindow
    .loadFile(path.join(app.getAppPath(), "desktop", "index.html"))
    .then(() => {
      writeDesktopLog("mainWindow loadFile resolved");
    })
    .catch((error) => {
      writeDesktopLog("mainWindow loadFile rejected", error?.stack || String(error));
    });

  if (!hiddenLaunch) {
    setTimeout(() => {
      if (hasLiveMainWindow() && !mainWindow.isVisible()) {
        writeDesktopLog("mainWindow visibility fallback");
        showMainWindow();
      }
    }, 1500);
  }
}

function createTray() {
  tray = new Tray(createTrayIcon());
  writeDesktopLog("createTray");
  tray.on("click", () => {
    writeDesktopLog("tray click");
    ensureMainWindow();
    if (mainWindow.isVisible()) {
      mainWindow.hide();
      return;
    }
    showMainWindow();
  });

  refreshTrayMenu();
}

function installMediaPermissionHandler() {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media" || permission === "microphone");
  });

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => (
    permission === "media" || permission === "microphone"
  ));
}

ipcMain.handle("desktop:get-bootstrap", async () => buildBootstrap());

ipcMain.handle("desktop:start-service", async () => {
  await startBridgeProcess();
  return buildBootstrap();
});

ipcMain.handle("desktop:stop-service", async () => {
  await stopBridgeProcess();
  return buildBootstrap();
});

ipcMain.handle("desktop:restart-service", async () => {
  await restartBridgeProcess();
  return buildBootstrap();
});

ipcMain.handle("desktop:pick-directory", async (_event, currentPath = "") => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose workspace",
    defaultPath: currentPath || DEFAULT_INVOKE_CWD,
    properties: ["openDirectory", "createDirectory"]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

// Only allow opening the known consoles for API keys — nothing else.
const ALLOWED_EXTERNAL_HOSTS = new Set([
  "console.volcengine.com",
  "platform.openai.com",
  "platform.deepseek.com"
]);

ipcMain.handle("desktop:open-external", async (_event, url) => {
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.protocol !== "https:" || !ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname)) {
      return false;
    }
    await shell.openExternal(parsed.toString());
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle("desktop:open-config-folder", async () => {
  const configPath = loadEffectiveConfig().userConfigPath;
  await shell.openPath(path.dirname(configPath));
  return buildBootstrap();
});

ipcMain.handle("desktop:save-config", async (_event, payload = {}) => {
  writeUserConfigValues(buildUserConfigUpdates(payload.form || {}));
  const { settings } = writeDesktopSettings(payload.desktopSettings || {});
  await syncAutoLaunch(settings);
  // Enabling/disabling remote support changes whether the native physical
  // Menu key is intercepted, so rebuild the hook immediately.
  restartGlobalHotkeyMonitor();

  if (bridgeChild) {
    await restartBridgeProcess();
  } else {
    const config = loadEffectiveConfig();
    const issues = getConfigIssues(config);
    if (issues.length > 0) {
      setServiceState({
        status: "needs_setup",
        message: issues[0],
        mode: config.sendTarget,
        port: config.port,
        pid: null,
        ownership: "app"
      });
    } else {
      await startBridgeProcess({ revealOnError: false });
    }
  }

  return buildBootstrap();
});

ipcMain.handle("desktop:set-mode", async (_event, mode) => {
  await persistMode(mode);
  return buildBootstrap();
});

ipcMain.handle("desktop:update-desktop-settings", async (_event, patch = {}) => {
  await persistDesktopSettings(patch);
  return buildBootstrap();
});

ipcMain.handle("desktop:refresh-remote-hid", async () => {
  await refreshRemoteHidHealth("ui");
  return latestRemoteHidProblem;
});

// Polled by the Remote page pairing guide (adapter present / remote paired /
// HID problem). On-demand only — the query costs one WMI/PnP lookup.
ipcMain.handle("desktop:remote-pairing-status", async () => {
  return checkRemotePairingStatus();
});

// The pairing guide sends the user to the system Bluetooth page. Separate
// handler on purpose: desktop:open-external stays limited to https consoles.
ipcMain.handle("desktop:open-bluetooth-settings", async () => {
  if (process.platform !== "win32") {
    return false;
  }
  try {
    await shell.openExternal("ms-settings:bluetooth");
    return true;
  } catch {
    return false;
  }
});

// One-click repair for the remote's broken HID child device (the "driver
// error" Windows Settings shows after a re-pair). Same broker path as the
// automatic repair on service (re)start, followed by a health re-check.
ipcMain.handle("desktop:fix-remote-hid", async () => {
  if (process.platform !== "win32") {
    return { healthy: false, unsupported: true };
  }
  // Join an in-flight auto repair instead of sending a duplicate broker request.
  for (let i = 0; i < 100 && remoteHidRepairInFlight; i += 1) {
    await wait(300);
  }
  await maybeRepairRemoteHid("manual");
  return { healthy: latestRemoteHidProblem === 0 };
});

ipcMain.on("desktop:set-tray-language-mode", (_event, mode) => {
  updateTrayLanguageMode(mode);
});

// ── Floating dictation overlay ──────────────────────────────────────────
// Frameless, always-on-top, never focusable (so it can't steal the injection
// target's focus). Draggable anywhere; position persists in desktop settings.
let overlayWindow = null;
let overlayHideTimer = null;
let overlayRecognitionTimer = null;
let overlayMoveTimer = null;
const OVERLAY_WIDTH = 480;
const OVERLAY_HEIGHT = 148;
const OVERLAY_RECOGNITION_FAILSAFE_MS = 20_000;

function clearOverlayTimers() {
  if (overlayHideTimer) {
    clearTimeout(overlayHideTimer);
    overlayHideTimer = null;
  }
  if (overlayRecognitionTimer) {
    clearTimeout(overlayRecognitionTimer);
    overlayRecognitionTimer = null;
  }
}

function requestOverlayCancel(origin) {
  clearOverlayTimers();
  overlayWindow?.hide();
  emitGlobalHotkey({ type: "cancel_active_dictation", origin });
}

function overlayDefaultPosition() {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  return { x: Math.round(area.x + (area.width - OVERLAY_WIDTH) / 2), y: area.y + 24 };
}

function overlaySavedPosition(settings) {
  if (!Number.isFinite(settings.overlayX) || !Number.isFinite(settings.overlayY)) {
    return null;
  }
  // The display the position was saved on may be disconnected — only honor
  // the saved position if it still lands inside a connected display.
  const area = screen.getDisplayNearestPoint({ x: settings.overlayX, y: settings.overlayY }).workArea;
  const inside =
    settings.overlayX >= area.x &&
    settings.overlayX < area.x + area.width &&
    settings.overlayY >= area.y &&
    settings.overlayY < area.y + area.height;
  return inside ? { x: settings.overlayX, y: settings.overlayY } : null;
}

function ensureOverlayWindow() {
  if (overlayWindow) {
    return overlayWindow;
  }
  const settings = loadDesktopSettings();
  const { x, y } = overlaySavedPosition(settings) || overlayDefaultPosition();
  overlayWindow = new BrowserWindow({
    width: OVERLAY_WIDTH,
    height: OVERLAY_HEIGHT,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(app.getAppPath(), "desktop", "overlay-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Keep status timers and power-confirm countdowns live while occluded.
      backgroundThrottling: false
    }
  });
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.on("move", () => {
    clearTimeout(overlayMoveTimer);
    overlayMoveTimer = setTimeout(() => {
      if (!overlayWindow) {
        return;
      }
      const [wx, wy] = overlayWindow.getPosition();
      writeDesktopSettings({ ...loadDesktopSettings(), overlayX: wx, overlayY: wy });
    }, 400);
  });
  overlayWindow.on("closed", () => {
    clearOverlayTimers();
    overlayWindow = null;
  });
  void overlayWindow.loadFile(path.join(app.getAppPath(), "desktop", "overlay.html"));
  return overlayWindow;
}

// WeChat Input Method owns the global voice shortcut. The Weixin/WeChat chat
// client is unrelated and must not be used as the readiness signal.
let wechatInputMethodRunningCache = { at: 0, running: true };

async function isWechatInputMethodRunning({ force = false } = {}) {
  if (process.platform !== "win32") {
    return true;
  }
  const now = Date.now();
  // Trust a fresh positive answer to keep PTT latency at zero; re-check a
  // negative quickly so a just-activated input method is picked up right away.
  const ttl = wechatInputMethodRunningCache.running ? 10_000 : 1_500;
  if (!force && now - wechatInputMethodRunningCache.at < ttl) {
    return wechatInputMethodRunningCache.running;
  }
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "[bool]@(Get-Process -Name wetype_server -ErrorAction SilentlyContinue)"],
      { timeout: 3_000, windowsHide: true }
    );
    wechatInputMethodRunningCache = { at: now, running: /true/i.test(stdout) };
  } catch (error) {
    // Detection failing must not block dictation — keep the previous answer.
    writeDesktopLog("wechat input method process check failed", error?.message || String(error));
  }
  return wechatInputMethodRunningCache.running;
}

async function tryWakeWechatInputMethod() {
  if (process.platform !== "win32") {
    return false;
  }
  try {
    // ctfmon is Windows' text-services host. Waking it is safe and gives an
    // installed WeType profile a chance to start its per-user server without
    // launching the unrelated WeChat chat client.
    const child = spawn("ctfmon.exe", [], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
    wechatInputMethodRunningCache = { at: 0, running: false };
    await wait(1_200);
    return isWechatInputMethodRunning({ force: true });
  } catch (error) {
    writeDesktopLog("wechat input method wake failed", error?.message || String(error));
    return false;
  }
}

async function findWechatInputMethodSettingsExecutable() {
  if (process.platform !== "win32") {
    return "";
  }
  const script = `
$running = Get-Process -Name wetype_update -ErrorAction SilentlyContinue |
  Where-Object { $_.Path } |
  Select-Object -First 1 -ExpandProperty Path
if ($running) { Write-Output $running; exit 0 }
$roots = @(
  (Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'Tencent\\WeType'),
  (Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Tencent\\WeType')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
$candidate = $roots |
  ForEach-Object { Get-ChildItem -LiteralPath $_ -Filter wetype_update.exe -File -Recurse -ErrorAction SilentlyContinue } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1 -ExpandProperty FullName
if ($candidate) { Write-Output $candidate }
`;
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 5_000, windowsHide: true }
    );
    return String(stdout || "").trim().split(/\r?\n/)[0] || "";
  } catch (error) {
    writeDesktopLog("wechat input method settings lookup failed", error?.message || String(error));
    return "";
  }
}

async function openWechatInputMethodSettings() {
  const executablePath = await findWechatInputMethodSettingsExecutable();
  if (!executablePath) {
    return false;
  }
  try {
    const child = spawn(executablePath, [], {
      detached: true,
      stdio: "ignore",
      windowsHide: false
    });
    child.unref();
    return true;
  } catch (error) {
    writeDesktopLog("wechat input method settings open failed", error?.message || String(error));
    return false;
  }
}

async function ensureWechatReady() {
  if (!loadDesktopSettings().wechatVirtualMicConfirmed) {
    throw new Error(
      "请先在软件的“遥控器”页面打开微信输入法设置，把麦克风选为 CABLE Output，并勾选“我已选择”。"
    );
  }
  if (await isWechatInputMethodRunning()) {
    return;
  }
  const woke = await tryWakeWechatInputMethod();
  writeDesktopLog("wechat input method not running", { woke });
  if (woke) {
    return;
  }
  throw new Error(
    "微信输入法语音服务没有运行。请先在一个文本输入框里切换到微信输入法，再按住遥控器说话。"
  );
}

const OVERLAY_SHOW_STATUSES = new Set(["recording", "transcribing", "translating", "awaiting_action", "power_confirm", "power_executing"]);
const OVERLAY_HIDE_STATUSES = new Set([
  "typed", "cancelled", "empty_segment", "transcript_empty",
  "transcription_timeout", "transcription_error"
]);

ipcMain.on("overlay:cancel", (_event, origin = "overlay_click") => {
  requestOverlayCancel(String(origin || "overlay_click"));
});

ipcMain.handle("desktop:ensure-wechat-ready", () => ensureWechatReady());

ipcMain.handle("desktop:open-wechat-input-settings", () => openWechatInputMethodSettings());

ipcMain.on("overlay:event", (_event, payload = {}) => {
  const win = ensureOverlayWindow();
  win.webContents.send("overlay:event", payload);
  clearOverlayTimers();
  if (payload.type === "transcript_final" || OVERLAY_SHOW_STATUSES.has(payload.status)) {
    if (!win.isVisible()) {
      if (!overlaySavedPosition(loadDesktopSettings())) {
        const pos = overlayDefaultPosition();
        win.setPosition(pos.x, pos.y);
      }
      win.showInactive();
    }
    if (payload.status === "transcribing" || payload.status === "translating") {
      overlayRecognitionTimer = setTimeout(
        () => requestOverlayCancel("overlay_failsafe_timeout"),
        OVERLAY_RECOGNITION_FAILSAFE_MS
      );
    }
    return;
  }
  if (OVERLAY_HIDE_STATUSES.has(payload.status)) {
    const delayMs = ["transcription_timeout", "transcription_error"].includes(payload.status)
      ? 2200
      : payload.status === "typed"
        ? 1400
        : 500;
    overlayHideTimer = setTimeout(() => overlayWindow?.hide(), delayMs);
  }
});

app.on("second-instance", () => {
  writeDesktopLog("app second-instance");
  showMainWindow();
});

app.on("activate", () => {
  writeDesktopLog("app activate");
  showMainWindow();
});

app.on("before-quit", () => {
  writeDesktopLog("app before-quit");
  isQuitting = true;
  mainWindow?.removeAllListeners("close");
  stopGlobalHotkeyMonitor();
  xiaomiRemoteChild?.kill();
  bridgeChild?.kill();
});

app.on("window-all-closed", (event) => {
  writeDesktopLog("app window-all-closed");
  event.preventDefault();
});

process.on("uncaughtException", (error) => {
  writeDesktopLog("uncaughtException", error?.stack || String(error));
});

process.on("unhandledRejection", (reason) => {
  writeDesktopLog(
    "unhandledRejection",
    reason instanceof Error ? reason.stack || reason.message : String(reason)
  );
});

await app.whenReady();
initialLaunchHidden = shouldHideOnLaunch();
writeDesktopLog("app ready", { initialLaunchHidden, desktopLogPath });
installMediaPermissionHandler();
await syncAutoLaunch();
createMainWindow();
createTray();
ensureOverlayWindow();
startGlobalHotkeyMonitor();
void isWechatInputMethodRunning();
void startBridgeProcess({ revealOnError: !initialLaunchHidden });
void refreshRemoteInfoOnce("startup");
void refreshRemoteHidHealth("startup");
