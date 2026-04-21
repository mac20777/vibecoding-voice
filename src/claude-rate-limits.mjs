import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Written by scripts/claude-statusline.mjs via Claude Code statusline hook.
const CACHE_FILE = path.join(os.tmpdir(), "vibecoding-claude-rate-limits.json");

// Discard data older than 1 hour — likely stale after an idle period.
const MAX_AGE_MS = 60 * 60 * 1000;

export function readLatestClaudeRateLimits() {
  if (!fs.existsSync(CACHE_FILE)) {
    return null;
  }

  try {
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    if (Date.now() - (data.writtenAt || 0) > MAX_AGE_MS) {
      return null;
    }

    const { fiveHourUsedPct, sevenDayUsedPct } = data;
    if (fiveHourUsedPct == null && sevenDayUsedPct == null) {
      return null;
    }

    return {
      primaryRemainingPct: fiveHourUsedPct != null ? Math.max(0, Math.round(100 - fiveHourUsedPct)) : null,
      secondaryRemainingPct: sevenDayUsedPct != null ? Math.max(0, Math.round(100 - sevenDayUsedPct)) : null,
      planType: "max"
    };
  } catch {
    return null;
  }
}
