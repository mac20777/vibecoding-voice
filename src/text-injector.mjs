import { spawn } from "node:child_process";
import path from "node:path";

function runPowerShellFile(filePath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-Sta", "-ExecutionPolicy", "Bypass", "-File", filePath, ...args],
      {
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `PowerShell exited with code ${code}`));
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

  const scriptPath = path.join(process.cwd(), "scripts", "inject-text.ps1");
  const textBase64 = Buffer.from(trimmed, "utf8").toString("base64");

  await runPowerShellFile(scriptPath, ["-TextBase64", textBase64, "-Mode", mode]);
}
