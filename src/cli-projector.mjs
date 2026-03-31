import path from "node:path";

const MAX_LOG_LINES = 8;
const MAX_SUMMARY_CHARS = 240;

function collapseWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function trimSummary(value, maxChars = MAX_SUMMARY_CHARS) {
  const text = collapseWhitespace(value);
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars - 1)}…`;
}

function toolLabel(sendTarget) {
  if (sendTarget === "claude_code") return "Claude";
  if (sendTarget === "codex_exec") return "Codex";
  return "";
}

export function createCliView(config) {
  const label = toolLabel(config.sendTarget);
  const cwd = config.sendTarget === "claude_code" ? config.claudeCwd : config.codexCwd;
  return {
    phase: "idle",
    statusLine: label ? `${label} idle` : "Idle",
    latestUserText: "",
    latestAssistantText: "",
    logLines: [],
    threadId: "",
    cwd,
    repoName: path.basename(cwd),
    quota5hRemainingPct: null,
    quotaWeekRemainingPct: null,
    quotaPlanType: ""
  };
}

export function pushLogLine(lines, line) {
  const next = [...lines];
  const value = trimSummary(line, 120);
  if (!value) {
    return next;
  }
  next.push(value);
  if (next.length > MAX_LOG_LINES) {
    next.splice(0, next.length - MAX_LOG_LINES);
  }
  return next;
}

export function formatCodexEvent(event) {
  switch (event?.type) {
    case "thread.started":
      return `thread: ${event.thread_id}`;
    case "turn.started":
      return "turn: started";
    case "turn.completed":
      return "turn: completed";
    case "item.completed":
      if (event.item?.type === "agent_message") {
        return `assistant: ${trimSummary(event.item.text, 96)}`;
      }
      return `item: ${event.item?.type || "unknown"}`;
    default:
      return `event: ${event?.type || "unknown"}`;
  }
}

export function summarizeAssistantText(text) {
  return trimSummary(text);
}
