import fs from "node:fs";
import { fork, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, session, shell, Tray } from "electron";
import { WebSocket } from "ws";

import { buildDesktopFormState, buildUserConfigUpdates } from "../src/desktop-config.mjs";
import { getConfigIssues, loadConfig, writeUserConfigValues } from "../src/config.mjs";
import { getDesktopSettingsPath, loadDesktopSettings, writeDesktopSettings } from "../src/desktop-settings.mjs";
import { getUserConfigDir } from "../src/paths.mjs";

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
let globalHotkeyChild = null;
let globalHotkeyRestartTimer = null;
let globalHotkeysReady = false;
let bridgeStopRequested = false;
let isQuitting = false;
let initialLaunchHidden = false;
let bundledIconCache = null;
const trayIconCache = new Map();
let trayLanguageMode = "chinese";
const desktopLogPath = path.join(getUserConfigDir(), "desktop.log");
const pressedGlobalKeys = new Set();
let activeGlobalRecordKey = null;

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

function normalizeModifierVk(vkCode) {
  if ([0x10, 0xa0, 0xa1].includes(vkCode)) {
    return "Shift";
  }
  if ([0x11, 0xa2, 0xa3].includes(vkCode)) {
    return "Ctrl";
  }
  if ([0x12, 0xa4, 0xa5].includes(vkCode)) {
    return "Alt";
  }
  if ([0x5b, 0x5c].includes(vkCode)) {
    return "Meta";
  }
  return null;
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

function currentGlobalModifiers() {
  const modifiers = new Set();
  for (const vkCode of pressedGlobalKeys) {
    const modifier = normalizeModifierVk(vkCode);
    if (modifier) {
      modifiers.add(modifier);
    }
  }
  return modifiers;
}

function modifiersEqual(left, right) {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

function hotkeyMatches(parsedHotkey, vkCode) {
  return Boolean(
    parsedHotkey &&
    parsedHotkey.keyVk === vkCode &&
    modifiersEqual(parsedHotkey.modifiers, currentGlobalModifiers())
  );
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

function emitGlobalHotkeyStatus() {
  emitGlobalHotkey({
    type: "status",
    ready: globalHotkeysReady,
    settings: selectDesktopHotkeySettings()
  });
}

function getGlobalHotkeyPowerShellScript() {
  return String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class GlobalKeyboardHook {
  private const int WH_KEYBOARD_LL = 13;
  private const int WM_KEYDOWN = 0x0100;
  private const int WM_KEYUP = 0x0101;
  private const int WM_SYSKEYDOWN = 0x0104;
  private const int WM_SYSKEYUP = 0x0105;
  private static LowLevelKeyboardProc _proc = HookCallback;
  private static IntPtr _hookID = IntPtr.Zero;

  public static void Start() {
    using (Process curProcess = Process.GetCurrentProcess())
    using (ProcessModule curModule = curProcess.MainModule) {
      _hookID = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, GetModuleHandle(curModule.ModuleName), 0);
      if (_hookID == IntPtr.Zero) {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }
    }
    Console.Error.WriteLine("ready");
    Console.Error.Flush();
  }

  public static void Stop() {
    if (_hookID != IntPtr.Zero) {
      UnhookWindowsHookEx(_hookID);
      _hookID = IntPtr.Zero;
    }
  }

  public static void Run() {
    MSG msg;
    while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) {
      TranslateMessage(ref msg);
      DispatchMessage(ref msg);
    }
  }

  private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
    if (nCode >= 0) {
      int message = wParam.ToInt32();
      if (message == WM_KEYDOWN || message == WM_SYSKEYDOWN || message == WM_KEYUP || message == WM_SYSKEYUP) {
        KBDLLHOOKSTRUCT data = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
        string eventType = (message == WM_KEYUP || message == WM_SYSKEYUP) ? "keyup" : "keydown";
        Console.WriteLine("{\"type\":\"" + eventType + "\",\"vkCode\":" + data.vkCode + "}");
        Console.Out.Flush();
      }
    }
    return CallNextHookEx(_hookID, nCode, wParam, lParam);
  }

  private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  private struct KBDLLHOOKSTRUCT {
    public int vkCode;
    public int scanCode;
    public int flags;
    public int time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct MSG {
    public IntPtr hwnd;
    public uint message;
    public IntPtr wParam;
    public IntPtr lParam;
    public uint time;
    public int pt_x;
    public int pt_y;
  }

  [DllImport("user32.dll", SetLastError = true)]
  private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

  [DllImport("user32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool UnhookWindowsHookEx(IntPtr hhk);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

  [DllImport("user32.dll")]
  private static extern bool TranslateMessage(ref MSG lpMsg);

  [DllImport("user32.dll")]
  private static extern IntPtr DispatchMessage(ref MSG lpMsg);

  [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  private static extern IntPtr GetModuleHandle(string lpModuleName);
}
"@
try {
  [GlobalKeyboardHook]::Start()
  [GlobalKeyboardHook]::Run()
} finally {
  [GlobalKeyboardHook]::Stop()
}
`;
}

function handleGlobalKeyboardEvent(event) {
  const vkCode = Number(event.vkCode);
  if (!Number.isInteger(vkCode)) {
    return;
  }

  if (event.type === "keydown") {
    const repeated = pressedGlobalKeys.has(vkCode);
    pressedGlobalKeys.add(vkCode);
    if (repeated) {
      return;
    }

    const settings = loadDesktopSettings();
    if (hotkeyMatches(parseHotkey(settings.localMicHoldKey), vkCode)) {
      activeGlobalRecordKey = vkCode;
      emitGlobalHotkey({ type: "record_start" });
      return;
    }
    if (hotkeyMatches(parseHotkey(settings.localMicSendKey), vkCode)) {
      emitGlobalHotkey({ type: "action_send" });
      return;
    }
    if (hotkeyMatches(parseHotkey(settings.localMicUndoKey), vkCode)) {
      emitGlobalHotkey({ type: "action_undo" });
      return;
    }
    if (hotkeyMatches(parseHotkey(settings.localMicTranslationToggleKey), vkCode)) {
      emitGlobalHotkey({ type: "toggle_english_output" });
    }
    return;
  }

  if (event.type === "keyup") {
    if (activeGlobalRecordKey === vkCode) {
      activeGlobalRecordKey = null;
      emitGlobalHotkey({ type: "record_stop" });
    }
    pressedGlobalKeys.delete(vkCode);
  }
}

function startGlobalHotkeyMonitor() {
  if (process.platform !== "win32" || globalHotkeyChild || isQuitting) {
    emitGlobalHotkeyStatus();
    return;
  }

  const encodedCommand = Buffer
    .from(getGlobalHotkeyPowerShellScript(), "utf16le")
    .toString("base64");
  const powershellPath = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
  const child = spawn(powershellPath, [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    encodedCommand
  ], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  globalHotkeyChild = child;
  globalHotkeysReady = false;
  pressedGlobalKeys.clear();
  activeGlobalRecordKey = null;

  const reader = readline.createInterface({ input: child.stdout });
  reader.on("line", (line) => {
    try {
      handleGlobalKeyboardEvent(JSON.parse(line));
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
    pressedGlobalKeys.clear();
    activeGlobalRecordKey = null;
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

function stopGlobalHotkeyMonitor() {
  if (globalHotkeyRestartTimer) {
    clearTimeout(globalHotkeyRestartTimer);
    globalHotkeyRestartTimer = null;
  }
  if (globalHotkeyChild) {
    globalHotkeyChild.kill();
    globalHotkeyChild = null;
  }
  globalHotkeysReady = false;
  pressedGlobalKeys.clear();
  activeGlobalRecordKey = null;
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
    service: snapshotServiceState()
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

async function stopBridgeProcess() {
  if (xiaomiRemoteChild) {
    const child = xiaomiRemoteChild;
    xiaomiRemoteChild = null;
    writeDesktopLog("stopXiaomiRemoteProcess", { pid: child.pid ?? null });
    child.kill();
  }

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
    setTimeout(finish, 2_000);
  });
}

function startXiaomiRemoteProcess(config) {
  if (!config.xiaomiRemoteEnabled || xiaomiRemoteChild) {
    return;
  }

  const child = fork(xiaomiRemoteEntryPath(), [], {
    cwd: DEFAULT_INVOKE_CWD,
    env: {
      ...process.env,
      VIBE_INVOKE_CWD: process.env.VIBE_INVOKE_CWD || DEFAULT_INVOKE_CWD,
      VIBE_DESKTOP: "1"
    },
    silent: true,
    windowsHide: false
  });
  xiaomiRemoteChild = child;
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
  child.on("exit", (code, signal) => {
    writeDesktopLog("xiaomi remote child exit", { code, signal });
    if (xiaomiRemoteChild === child) {
      xiaomiRemoteChild = null;
    }
    if (!isQuitting && code !== 0) {
      appendProcessLog(
        "xiaomi-remote",
        `Remote input exited${code != null ? ` with code ${code}` : ""}${signal ? ` (${signal})` : ""}.`
      );
    }
  });
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

  try {
    await connectToLocalBridge(config.port, 500);
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
  } catch {
    // nothing listening locally, safe to start
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
      VIBE_DESKTOP: "1"
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
  emitGlobalHotkeyStatus();
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

  return {
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    form: buildDesktopFormState(config, desktopSettings),
    desktopSettingsPath: getDesktopSettingsPath(),
    globalHotkeys: {
      ready: globalHotkeysReady,
      settings: selectDesktopHotkeySettings(desktopSettings)
    },
    service: snapshotServiceState()
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
    backgroundColor: "#08121d",
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

ipcMain.handle("desktop:open-config-folder", async () => {
  const configPath = loadEffectiveConfig().userConfigPath;
  await shell.openPath(path.dirname(configPath));
  return buildBootstrap();
});

ipcMain.handle("desktop:save-config", async (_event, payload = {}) => {
  writeUserConfigValues(buildUserConfigUpdates(payload.form || {}));
  const { settings } = writeDesktopSettings(payload.desktopSettings || {});
  await syncAutoLaunch(settings);
  emitGlobalHotkeyStatus();

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

ipcMain.on("desktop:set-tray-language-mode", (_event, mode) => {
  updateTrayLanguageMode(mode);
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
startGlobalHotkeyMonitor();
void startBridgeProcess({ revealOnError: !initialLaunchHidden });
