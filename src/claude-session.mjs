import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

function resolveClaudeCommand() {
  if (process.env.CLAUDE_COMMAND) {
    return process.env.CLAUDE_COMMAND;
  }

  if (process.platform !== "win32") {
    return "claude";
  }

  const npmShimPath = path.join(process.env.APPDATA || "", "npm", "claude.ps1");
  return fs.existsSync(npmShimPath) ? npmShimPath : "claude";
}

function buildClaudeArgs(config, hasSession, prompt) {
  const claudeCommand = config.claudeCommand || resolveClaudeCommand();

  // On Windows with a .ps1 shim, we invoke via PowerShell
  if (claudeCommand.endsWith(".ps1")) {
    const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", claudeCommand];
    args.push("--output-format", "stream-json");
    args.push("--verbose");
    if (config.claudeAllowedTools) {
      args.push("--allowedTools", config.claudeAllowedTools);
    }
    if (config.claudeMaxTurns) {
      args.push("--max-turns", String(config.claudeMaxTurns));
    }
    if (hasSession) {
      args.push("--continue");
    }
    args.push("-p", prompt);
    return { command: "powershell.exe", args };
  }

  // Direct invocation (non-Windows or plain "claude" on PATH)
  const args = ["--output-format", "stream-json", "--verbose"];
  if (config.claudeAllowedTools) {
    args.push("--allowedTools", config.claudeAllowedTools);
  }
  if (config.claudeMaxTurns) {
    args.push("--max-turns", String(config.claudeMaxTurns));
  }
  if (hasSession) {
    args.push("--continue");
  }
  args.push("-p", prompt);

  // On Windows, plain "claude" resolves to a .cmd shim; wrap via cmd.exe to
  // avoid shell:true which triggers a Node.js security warning about arg escaping.
  if (process.platform === "win32") {
    return { command: "cmd.exe", args: ["/c", claudeCommand, ...args] };
  }
  return { command: claudeCommand, args };
}

export class ClaudeSessionManager {
  constructor(config) {
    this.config = config;
    this.sessionId = "";
    this.running = false;
  }

  isRunning() {
    return this.running;
  }

  // Returns session ID (mirrors CodexSessionManager.getThreadId())
  getThreadId() {
    return this.sessionId;
  }

  async sendPrompt(prompt, handlers = {}) {
    const trimmedPrompt = String(prompt || "").trim();
    if (!trimmedPrompt) {
      throw new Error("Prompt is empty");
    }
    if (this.running) {
      throw new Error("Claude session is busy");
    }

    this.running = true;
    handlers.onState?.({
      phase: "running",
      statusLine: "Running Claude...",
      threadId: this.sessionId
    });

    const { command, args, shell = false } = buildClaudeArgs(this.config, Boolean(this.sessionId), trimmedPrompt);
    const child = spawn(command, args, {
      cwd: this.config.claudeCwd || process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell
    });

    const timeoutMs = (Number(this.config.cliTimeoutSec) || 300) * 1000;
    const timeoutTimer = setTimeout(() => {
      child.kill("SIGTERM");
    }, timeoutMs);

    const stdout = readline.createInterface({ input: child.stdout });
    let stderrText = "";
    let lastAssistantText = "";
    let lastResultMessage = "";
    let sawErrorResult = false;
    let resultHandled = false;

    stdout.on("line", (line) => {
      const raw = String(line || "").trim();
      if (!raw) {
        return;
      }

      try {
        const event = JSON.parse(raw);

        // Assistant message — extract text from content blocks
        // (stream-json format: {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}})
        if (event.type === "assistant" && Array.isArray(event.message?.content)) {
          for (const block of event.message.content) {
            if (block.type === "text" && block.text) {
              lastAssistantText += block.text;
            }
          }
          if (lastAssistantText) {
            handlers.onSummary?.({
              latestAssistantText: lastAssistantText,
              statusLine: "Claude replying...",
              phase: "running",
              threadId: this.sessionId
            });
          }
          return;
        }

        // Streaming text delta (verbose mode may emit these)
        if (
          event.type === "stream_event" &&
          event.event?.type === "content_block_delta" &&
          event.event?.delta?.type === "text_delta"
        ) {
          lastAssistantText += event.event.delta.text || "";
          handlers.onSummary?.({
            latestAssistantText: lastAssistantText,
            statusLine: "Claude replying...",
            phase: "running",
            threadId: this.sessionId
          });
          return;
        }

        // Final result — extract session ID
        if (event.type === "result") {
          if (event.session_id) {
            this.sessionId = String(event.session_id);
          }
          sawErrorResult = Boolean(event.is_error);
          lastResultMessage = String(event.result || "").trim();

          // Fallback: result.result field contains the final text when streaming wasn't used
          if (!lastAssistantText && lastResultMessage) {
            lastAssistantText = lastResultMessage;
          }

          resultHandled = true;

          if (sawErrorResult) {
            const message = lastResultMessage || lastAssistantText || "Claude returned an error";
            handlers.onState?.({
              phase: "error",
              statusLine: message,
              threadId: this.sessionId
            });
            if (message) {
              handlers.onSummary?.({
                latestAssistantText: message,
                statusLine: message,
                phase: "error",
                threadId: this.sessionId
              });
            }
            handlers.onEvent?.(event);
            return;
          }

          if (lastAssistantText) {
            handlers.onSummary?.({
              latestAssistantText: lastAssistantText,
              statusLine: "Claude replied",
              phase: "idle",
              threadId: this.sessionId
            });
          }
          handlers.onState?.({
            phase: "idle",
            statusLine: "Claude idle",
            threadId: this.sessionId
          });
          handlers.onEvent?.(event);
          return;
        }

        // API retry / system events — log them
        if (event.type === "system") {
          const msg =
            event.subtype === "api_retry"
              ? `retry: attempt ${event.attempt}/${event.max_retries} (${event.error})`
              : `system: ${event.subtype || "unknown"}`;
          handlers.onLogLine?.(msg);
          return;
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
          threadId: this.sessionId
        });
        reject(error);
      });

      child.on("exit", (code) => {
        clearTimeout(timeoutTimer);
        this.running = false;
        if (code === 0 || code === null) {
          // result event already emitted the final state; avoid double-firing
          if (!resultHandled) {
            handlers.onState?.({
              phase: "idle",
              statusLine: "Claude idle",
              threadId: this.sessionId
            });
          }
          resolve({
            sessionId: this.sessionId,
            lastAssistantText
          });
          return;
        }

        const message = lastResultMessage || lastAssistantText || stderrText.trim() || `Claude exited with code ${code}`;
        handlers.onState?.({
          phase: "error",
          statusLine: message,
          threadId: this.sessionId
        });
        reject(new Error(message));
      });
    });
  }
}
