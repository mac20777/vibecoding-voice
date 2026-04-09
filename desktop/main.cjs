const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

function getUserConfigDir() {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "vibecoding-voice");
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "vibecoding-voice");
  }

  const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(xdgConfigHome, "vibecoding-voice");
}

const bootstrapLogPath = path.join(getUserConfigDir(), "desktop-bootstrap.log");

function writeBootstrapLog(message, details = null) {
  try {
    fs.mkdirSync(path.dirname(bootstrapLogPath), { recursive: true });
    const suffix =
      details == null ? "" : ` ${typeof details === "string" ? details : JSON.stringify(details)}`;
    fs.appendFileSync(bootstrapLogPath, `${new Date().toISOString()} ${message}${suffix}\n`, "utf8");
  } catch {
    // ignore
  }
}

writeBootstrapLog("bootstrap start", {
  argv: process.argv,
  execPath: process.execPath,
  cwd: process.cwd()
});

process.on("uncaughtException", (error) => {
  writeBootstrapLog("uncaughtException", error && error.stack ? error.stack : String(error));
});

process.on("unhandledRejection", (reason) => {
  writeBootstrapLog(
    "unhandledRejection",
    reason && reason.stack ? reason.stack : String(reason)
  );
});

const target = pathToFileURL(path.join(__dirname, "main.mjs")).href;

import(target)
  .then(() => {
    writeBootstrapLog("main imported");
  })
  .catch((error) => {
    writeBootstrapLog("main import failed", error && error.stack ? error.stack : String(error));
  });
