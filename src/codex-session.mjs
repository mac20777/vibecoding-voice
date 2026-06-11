import { spawn } from "node:child_process";
import readline from "node:readline";

function buildCodexCliArgs(config, threadId, prompt) {
  const args = [];
  args.push("-C", config.codexCwd);

  if (threadId) {
    args.push("exec", "resume", threadId, "--json", prompt);
  } else {
    args.push("exec", "--json", prompt);
  }

  if (config.codexSkipGitRepoCheck) {
    args.push("--skip-git-repo-check");
  }

  return args;
}

export function buildCodexInvocation(config, threadId, prompt, platform = process.platform) {
  const codexCommand = config.codexCommand || "codex";
  const args = buildCodexCliArgs(config, threadId, prompt);

  if (platform === "win32" && /\.ps1$/i.test(codexCommand)) {
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", codexCommand, ...args]
    };
  }

  if (platform === "win32") {
    return { command: "cmd.exe", args: ["/c", codexCommand, ...args] };
  }

  return { command: codexCommand, args };
}

export class CodexSessionManager {
  constructor(config) {
    this.config = config;
    this.threadId = "";
    this.running = false;
  }

  isRunning() {
    return this.running;
  }

  getThreadId() {
    return this.threadId;
  }

  async sendPrompt(prompt, handlers = {}) {
    const trimmedPrompt = String(prompt || "").trim();
    if (!trimmedPrompt) {
      throw new Error("Prompt is empty");
    }
    if (this.running) {
      throw new Error("Codex session is busy");
    }

    this.running = true;
    handlers.onState?.({
      phase: "running",
      statusLine: "Running Codex...",
      threadId: this.threadId
    });

    const { command, args } = buildCodexInvocation(this.config, this.threadId, trimmedPrompt);
    const child = spawn(command, args, {
      cwd: this.config.codexCwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    const timeoutMs = (Number(this.config.cliTimeoutSec) || 300) * 1000;
    const timeoutTimer = setTimeout(() => {
      child.kill("SIGTERM");
    }, timeoutMs);

    const stdout = readline.createInterface({ input: child.stdout });
    let stderrText = "";
    let lastAssistantText = "";

    stdout.on("line", (line) => {
      const raw = String(line || "").trim();
      if (!raw) {
        return;
      }

      try {
        const event = JSON.parse(raw);
        if (event.type === "thread.started" && event.thread_id) {
          this.threadId = String(event.thread_id);
          handlers.onState?.({
            phase: "running",
            statusLine: "Codex running",
            threadId: this.threadId
          });
        }

        if (event.type === "item.completed" && event.item?.type === "agent_message") {
          lastAssistantText = String(event.item.text || "").trim();
          handlers.onSummary?.({
            latestAssistantText: lastAssistantText,
            statusLine: "Codex replied",
            phase: "running",
            threadId: this.threadId
          });
        }

        if (event.type === "turn.completed") {
          handlers.onState?.({
            phase: "idle",
            statusLine: "Codex idle",
            threadId: this.threadId
          });
        }

        handlers.onEvent?.(event);
      } catch {
        handlers.onLogLine?.(raw);
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderrText += text;
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) {
          handlers.onLogLine?.(`stderr: ${trimmed}`);
        }
      }
    });

    return await new Promise((resolve, reject) => {
      child.on("error", (error) => {
        clearTimeout(timeoutTimer);
        this.running = false;
        handlers.onState?.({
          phase: "error",
          statusLine: error.message,
          threadId: this.threadId
        });
        reject(error);
      });

      child.on("exit", (code) => {
        clearTimeout(timeoutTimer);
        this.running = false;
        if (code === 0) {
          handlers.onState?.({
            phase: "idle",
            statusLine: "Codex idle",
            threadId: this.threadId
          });
          resolve({
            threadId: this.threadId,
            lastAssistantText
          });
          return;
        }

        const message = stderrText.trim() || `Codex exited with code ${code}`;
        handlers.onState?.({
          phase: "error",
          statusLine: message,
          threadId: this.threadId
        });
        reject(new Error(message));
      });
    });
  }
}
