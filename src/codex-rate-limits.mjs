import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function getSessionsRoot() {
  return path.join(os.homedir(), ".codex", "sessions");
}

function collectJsonlFiles(root, results = []) {
  if (!fs.existsSync(root)) {
    return results;
  }

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      collectJsonlFiles(fullPath, results);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      results.push(fullPath);
    }
  }

  return results;
}

function findSessionFile(threadId = "") {
  const files = collectJsonlFiles(getSessionsRoot());
  files.sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);

  if (threadId) {
    const exact = files.find((filePath) => filePath.includes(threadId));
    if (exact) {
      return exact;
    }
  }

  return files[0] || "";
}

function parseRateLimitsFromText(content) {
  const lines = content.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line) {
      continue;
    }
    try {
      const event = JSON.parse(line);
      const rateLimits = event?.payload?.rate_limits;
      if (event?.type === "event_msg" && event?.payload?.type === "token_count" && rateLimits) {
        const primaryUsed = Number(rateLimits.primary?.used_percent);
        const secondaryUsed = Number(rateLimits.secondary?.used_percent);
        const primaryRemainingPct = Number.isFinite(primaryUsed) ? Math.max(0, Math.round(100 - primaryUsed)) : null;
        const secondaryRemainingPct = Number.isFinite(secondaryUsed) ? Math.max(0, Math.round(100 - secondaryUsed)) : null;
        return {
          sourceFile: "",
          primaryRemainingPct,
          secondaryRemainingPct,
          primaryResetAt: Number(rateLimits.primary?.resets_at || 0) || 0,
          secondaryResetAt: Number(rateLimits.secondary?.resets_at || 0) || 0,
          planType: String(rateLimits.plan_type || "")
        };
      }
    } catch {
      // Ignore malformed lines from partial writes.
    }
  }

  return null;
}

export function readLatestRateLimits(threadId = "") {
  const sessionFile = findSessionFile(threadId);
  if (!sessionFile) {
    return null;
  }

  const content = fs.readFileSync(sessionFile, "utf8");
  const limits = parseRateLimitsFromText(content);
  if (!limits) {
    return null;
  }

  return {
    ...limits,
    sourceFile: sessionFile
  };
}
