import fs from "node:fs";
import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { projectRoot } from "./paths.mjs";

const execFileAsync = promisify(execFile);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function encodePowerShellCommand(command) {
  return Buffer.from(command, "utf16le").toString("base64");
}

function escapePowerShellSingleQuoted(value) {
  return String(value).replace(/'/g, "''");
}

function buildPowerShellInvocation(scriptContent, namedArgs = {}) {
  const renderedArgs = Object.entries(namedArgs)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([name, value]) => `-${name} '${escapePowerShellSingleQuoted(value)}'`)
    .join(" ");

  return `$ProgressPreference = 'SilentlyContinue'\n& {\n${scriptContent.trim()}\n}${renderedArgs ? ` ${renderedArgs}` : ""}`;
}

function runPowerShellScript(scriptContent, namedArgs) {
  return new Promise((resolve, reject) => {
    const command = buildPowerShellInvocation(scriptContent, namedArgs);
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Sta",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encodePowerShellCommand(command)
      ],
      {
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || stdout.trim() || `PowerShell exited with code ${code}`));
    });
  });
}

async function commandExists(command) {
  try {
    await execFileAsync("which", [command], { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

function runCommand(command, args = [], { input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || stdout.trim() || `${command} exited with code ${code}`));
    });

    if (input !== undefined) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
}

async function resolveLinuxInjectionBackend() {
  const sessionType = String(process.env.XDG_SESSION_TYPE || "").toLowerCase();
  const hasWayland = Boolean(process.env.WAYLAND_DISPLAY) || sessionType === "wayland";
  const hasX11 = Boolean(process.env.DISPLAY) || sessionType === "x11";
  const [hasXdotool, hasXclip, hasWtype] = await Promise.all([
    commandExists("xdotool"),
    commandExists("xclip"),
    commandExists("wtype")
  ]);

  if (hasWayland && hasWtype) {
    return "wtype";
  }
  if (hasX11 && hasXdotool && hasXclip) {
    return "x11";
  }
  if (hasWtype) {
    return "wtype";
  }
  if (hasXdotool && hasXclip) {
    return "x11";
  }

  throw new Error(
    "Linux text injection requires xdotool + xclip on X11, or wtype on Wayland. " +
      "On Ubuntu install them with: sudo apt install xdotool xclip wtype"
  );
}

async function readX11Clipboard() {
  try {
    return await runCommand("xclip", ["-selection", "clipboard", "-out"]);
  } catch {
    return null;
  }
}

async function writeX11Clipboard(text) {
  await runCommand("xclip", ["-selection", "clipboard", "-in"], { input: text });
}

async function pressX11Key(key) {
  await runCommand("xdotool", ["key", "--clearmodifiers", key]);
}

async function typeWithWtype(text) {
  try {
    await runCommand("wtype", ["--", text]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/unrecognized option|invalid option|unknown option/i.test(message)) {
      throw error;
    }
    await runCommand("wtype", [text]);
  }
}

async function pressWtypeKey(key) {
  await runCommand("wtype", ["-P", key, "-p", key]);
}

async function injectTextLinuxX11(text, mode) {
  const previousClipboard = await readX11Clipboard();
  try {
    await writeX11Clipboard(text);
    await wait(80);
    await pressX11Key("ctrl+v");
    if (mode !== "type_only") {
      await wait(80);
      await pressX11Key("Return");
    }
  } finally {
    if (previousClipboard !== null) {
      await wait(200);
      try {
        await writeX11Clipboard(previousClipboard);
      } catch {
        // Clipboard restoration is best-effort on Linux.
      }
    }
  }
}

async function injectTextLinuxWtype(text, mode) {
  await typeWithWtype(text);
  if (mode !== "type_only") {
    await wait(80);
    await pressWtypeKey("Return");
  }
}

async function injectTextLinux(text, mode) {
  const backend = await resolveLinuxInjectionBackend();
  if (backend === "x11") {
    await injectTextLinuxX11(text, mode);
    return;
  }
  await injectTextLinuxWtype(text, mode);
}

async function submitTextInputLinux() {
  const backend = await resolveLinuxInjectionBackend();
  if (backend === "x11") {
    await pressX11Key("Return");
    return;
  }
  await pressWtypeKey("Return");
}

export async function injectText(text, mode, options = {}) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return;
  }

  if (options.dryRun) {
    console.log("[inject] dry-run", { mode, text: trimmed });
    return;
  }

  if (process.platform === "linux") {
    await injectTextLinux(trimmed, mode);
    return;
  }

  if (process.platform !== "win32") {
    throw new Error(`text injection is only implemented for Windows in this MVP, got ${process.platform}`);
  }

  const scriptPath = path.join(projectRoot, "scripts", "inject-text.ps1");
  const scriptContent = fs.readFileSync(scriptPath, "utf8");
  const textBase64 = Buffer.from(trimmed, "utf8").toString("base64");

  await runPowerShellScript(scriptContent, {
    TextBase64: textBase64,
    Mode: mode
  });
}

export async function submitTextInput(options = {}) {
  if (options.dryRun) {
    console.log("[inject] dry-run", { mode: "enter_only" });
    return;
  }

  if (process.platform === "linux") {
    await submitTextInputLinux();
    return;
  }

  if (process.platform !== "win32") {
    throw new Error(`text submission is only implemented for Windows in this MVP, got ${process.platform}`);
  }

  const scriptPath = path.join(projectRoot, "scripts", "inject-text.ps1");
  const scriptContent = fs.readFileSync(scriptPath, "utf8");

  await runPowerShellScript(scriptContent, {
    Mode: "enter_only"
  });
}
