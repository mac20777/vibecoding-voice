import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const windowsDirectory = process.env.WINDIR || String.raw`C:\Windows`;
const compilerCandidates = [
  path.join(windowsDirectory, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
  path.join(windowsDirectory, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe")
];
const compiler = compilerCandidates.find((candidate) => fs.existsSync(candidate));

if (process.platform !== "win32") {
  throw new Error("The Windows remote broker can only be built on Windows.");
}
if (!compiler) {
  throw new Error("The .NET Framework C# compiler was not found. Enable .NET Framework 4.x and retry.");
}

const source = path.join(
  projectRoot,
  "src",
  "windows-service",
  "VibeCodingVoiceRemoteBroker.cs"
);
const outputDirectory = path.join(projectRoot, "build-assets", "remote-broker");
const output = path.join(outputDirectory, "VibeCodingVoiceRemoteBroker.exe");
fs.mkdirSync(outputDirectory, { recursive: true });

const result = spawnSync(compiler, [
  "/nologo",
  "/target:exe",
  "/platform:anycpu",
  "/optimize+",
  `/out:${output}`,
  "/reference:System.Core.dll",
  "/reference:System.ServiceProcess.dll",
  "/reference:System.Web.Extensions.dll",
  source
], {
  cwd: projectRoot,
  encoding: "utf8",
  windowsHide: true
});

if (result.status !== 0) {
  process.stderr.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  throw new Error(`Remote broker compilation failed with exit code ${result.status}.`);
}

process.stdout.write(`Built ${output}\n`);
