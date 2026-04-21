import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

import { projectRoot } from "./paths.mjs";

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

export async function injectText(text, mode, options = {}) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return;
  }

  if (options.dryRun) {
    console.log("[inject] dry-run", { mode, text: trimmed });
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
