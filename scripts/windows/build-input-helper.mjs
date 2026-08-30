import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

if (process.platform !== "win32") {
  process.stdout.write("Skipping the Windows input helper build on this platform.\n");
  process.exit(0);
}

const windowsDirectory = process.env.WINDIR || String.raw`C:\Windows`;
const compilerCandidates = [
  path.join(windowsDirectory, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
  path.join(windowsDirectory, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe")
];
const compiler = compilerCandidates.find((candidate) => fs.existsSync(candidate));
if (!compiler) {
  throw new Error("The .NET Framework C# compiler was not found. Enable .NET Framework 4.x and retry.");
}

const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const numericVersion = String(packageJson.version || "0.0.0")
  .split(".")
  .slice(0, 3)
  .map((part) => Number.parseInt(part, 10) || 0);
while (numericVersion.length < 3) {
  numericVersion.push(0);
}
const assemblyVersion = `${numericVersion[0]}.${numericVersion[1]}.${numericVersion[2]}.0`;

const source = path.join(projectRoot, "src", "windows-input-helper", "VibeCodingVoiceInputHelper.cs");
const outputDirectory = path.join(projectRoot, "build-assets", "input-helper");
const output = path.join(outputDirectory, "VibeCodingVoiceInputHelper.exe");
const generatedDirectory = path.join(projectRoot, "tmp", "windows-build-info");
const assemblyInfo = path.join(generatedDirectory, "VibeCodingVoiceInputHelper.AssemblyInfo.cs");
fs.mkdirSync(outputDirectory, { recursive: true });
fs.mkdirSync(generatedDirectory, { recursive: true });
fs.writeFileSync(
  assemblyInfo,
  [
    "using System.Reflection;",
    '[assembly: AssemblyTitle("VibeCoding Voice Input Helper")]',
    '[assembly: AssemblyDescription("Handles the configured VibeCoding Voice hotkeys and foreground-window activation.")]',
    '[assembly: AssemblyCompany("mac20777")]',
    '[assembly: AssemblyProduct("VibeCoding Voice")]',
    '[assembly: AssemblyCopyright("Copyright (c) mac20777")]',
    `[assembly: AssemblyVersion("${assemblyVersion}")]`,
    `[assembly: AssemblyFileVersion("${assemblyVersion}")]`,
    `[assembly: AssemblyInformationalVersion("${packageJson.version}")]`,
    ""
  ].join("\r\n"),
  "utf8"
);

const result = spawnSync(compiler, [
  "/nologo",
  "/target:exe",
  "/platform:x64",
  "/optimize+",
  `/out:${output}`,
  "/reference:System.Windows.Forms.dll",
  source,
  assemblyInfo
], {
  cwd: projectRoot,
  encoding: "utf8",
  windowsHide: true
});

if (result.status !== 0) {
  process.stderr.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  throw new Error(`Windows input helper compilation failed with exit code ${result.status}.`);
}

const selfTest = spawnSync(output, ["--self-test"], {
  cwd: projectRoot,
  encoding: "utf8",
  windowsHide: true
});
if (selfTest.status !== 0 || !selfTest.stdout.includes('"ok":true')) {
  throw new Error(`Windows input helper self-test failed: ${selfTest.stderr || selfTest.stdout}`);
}

process.stdout.write(`Built ${output}\n`);
