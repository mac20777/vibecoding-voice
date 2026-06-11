import test from "node:test";
import assert from "node:assert/strict";

import { buildCodexInvocation } from "../src/codex-session.mjs";

const baseConfig = {
  codexCommand: "codex",
  codexCwd: "/home/test/project",
  codexSkipGitRepoCheck: false
};

test("buildCodexInvocation runs codex directly on Linux", () => {
  const invocation = buildCodexInvocation(baseConfig, "", "hello", "linux");

  assert.deepEqual(invocation, {
    command: "codex",
    args: ["-C", "/home/test/project", "exec", "--json", "hello"]
  });
});

test("buildCodexInvocation wraps a Windows PowerShell shim", () => {
  const invocation = buildCodexInvocation(
    {
      ...baseConfig,
      codexCommand: "C:\\Users\\test\\AppData\\Roaming\\npm\\codex.ps1"
    },
    "thread-123",
    "resume this",
    "win32"
  );

  assert.deepEqual(invocation, {
    command: "powershell.exe",
    args: [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "C:\\Users\\test\\AppData\\Roaming\\npm\\codex.ps1",
      "-C",
      "/home/test/project",
      "exec",
      "resume",
      "thread-123",
      "--json",
      "resume this"
    ]
  });
});

test("buildCodexInvocation wraps plain Windows commands with cmd", () => {
  const invocation = buildCodexInvocation(
    {
      ...baseConfig,
      codexSkipGitRepoCheck: true
    },
    "",
    "hello",
    "win32"
  );

  assert.deepEqual(invocation, {
    command: "cmd.exe",
    args: [
      "/c",
      "codex",
      "-C",
      "/home/test/project",
      "exec",
      "--json",
      "hello",
      "--skip-git-repo-check"
    ]
  });
});
