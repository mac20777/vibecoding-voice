#!/usr/bin/env node
// Claude Code statusline script — writes rate_limits to a temp file for the vibecoding-voice server.
// Configure in ~/.claude/settings.json:
//   { "statusLine": { "type": "command", "command": "node D:/github/vibecoding-voice/scripts/claude-statusline.mjs" } }
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CACHE_FILE = path.join(os.tmpdir(), "vibecoding-claude-rate-limits.json");

let input = "";
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(input);
    const rl = data.rate_limits;
    if (rl) {
      fs.writeFileSync(
        CACHE_FILE,
        JSON.stringify({
          fiveHourUsedPct: rl.five_hour?.used_percentage ?? null,
          fiveHourResetsAt: rl.five_hour?.resets_at ?? null,
          sevenDayUsedPct: rl.seven_day?.used_percentage ?? null,
          sevenDayResetsAt: rl.seven_day?.resets_at ?? null,
          writtenAt: Date.now()
        })
      );
    }

    // Print something useful for the Claude Code statusline display
    const fiveH = rl?.five_hour?.used_percentage;
    const sevenD = rl?.seven_day?.used_percentage;
    if (fiveH != null) {
      const fiveRem = Math.round(100 - fiveH);
      const sevenRem = sevenD != null ? Math.round(100 - sevenD) : "?";
      process.stdout.write(`5h:${fiveRem}% 7d:${sevenRem}%\n`);
    }
  } catch {
    // Ignore parse errors
  }
});
