import fs from "node:fs";
import path from "node:path";
import util from "node:util";

export function resolveRuntimeLogDir({
  env = process.env,
  cwd = process.cwd(),
  platform = process.platform
} = {}) {
  const configured = String(env.VIBE_LOG_DIR || "").trim();
  if (configured) {
    return path.resolve(cwd, configured);
  }

  if (platform === "win32" && env.LOCALAPPDATA) {
    return path.join(env.LOCALAPPDATA, "VibeCoding Voice", "logs");
  }

  return path.resolve(cwd, "logs");
}

export function resolveRuntimeLogPath(options = {}) {
  return path.join(resolveRuntimeLogDir(options), "server-current.log");
}

function serializeLogArg(arg) {
  if (typeof arg === "string") {
    return arg;
  }
  if (arg instanceof Error) {
    return arg.stack || arg.message;
  }
  return util.inspect(arg, {
    breakLength: Infinity,
    compact: true,
    depth: 6
  });
}

export function createRuntimeLogger({
  consoleLog = console.log,
  env = process.env,
  cwd = process.cwd(),
  platform = process.platform
} = {}) {
  const logPath = resolveRuntimeLogPath({ env, cwd, platform });
  let fileLoggingAvailable = true;
  let fileLoggingWarned = false;

  function appendLine(line) {
    if (!fileLoggingAvailable) {
      return;
    }
    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.appendFileSync(logPath, `${line}\n`, "utf8");
    } catch (error) {
      fileLoggingAvailable = false;
      if (!fileLoggingWarned) {
        fileLoggingWarned = true;
        console.warn(
          new Date().toISOString(),
          "runtime log disabled",
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }

  function log(...args) {
    const line = `${new Date().toISOString()} ${args.map(serializeLogArg).join(" ")}`;
    consoleLog(line);
    appendLine(line);
  }

  return { log, logPath };
}

