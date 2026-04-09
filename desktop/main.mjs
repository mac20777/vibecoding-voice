import fs from "node:fs";
import { fork } from "node:child_process";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from "electron";
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
let bridgeStopRequested = false;
let isQuitting = false;
let initialLaunchHidden = false;
let bundledIconCache = null;
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

function createTrayIcon() {
  const bundledIcon = loadBundledAppIcon();
  if (bundledIcon && !bundledIcon.isEmpty()) {
    const trayIcon = bundledIcon.resize(process.platform === "win32"
      ? { width: 16, height: 16 }
      : { width: 20, height: 20 });
    if (!trayIcon.isEmpty()) {
      return trayIcon;
    }
    writeDesktopLog("tray icon resize returned empty image");
    return bundledIcon;
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
    .resize({ width: 20, height: 20 });
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
  tray.setToolTip(`VibeCoding Voice · ${serviceStatusLabel(serviceState.status)} · ${modeLabel(serviceState.mode)}`);
}

async function buildBootstrap() {
  const config = loadEffectiveConfig();
  const desktopSettings = loadDesktopSettings();

  return {
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    form: buildDesktopFormState(config, desktopSettings),
    desktopSettingsPath: getDesktopSettingsPath(),
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
      sandbox: false
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
await syncAutoLaunch();
createMainWindow();
createTray();
void startBridgeProcess({ revealOnError: !initialLaunchHidden });
