import { spawn } from "node:child_process";

function quotePowerShellSingle(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function encodePowerShellCommand(command) {
  return Buffer.from(String(command), "utf16le").toString("base64");
}

export function buildElevatedUsbPcapCommand(runtime, pipeName, ownerPid = 0) {
  const helperArgs = [
    `-PipeName ${quotePowerShellSingle(pipeName)}`,
    `-UsbPcapPath ${quotePowerShellSingle(runtime.usbPcapPath)}`,
    `-InterfaceName ${quotePowerShellSingle(runtime.interfaceName)}`,
    `-DeviceAddress ${quotePowerShellSingle(runtime.deviceAddress)}`
  ];
  if (Number.isInteger(ownerPid) && ownerPid > 0) {
    helperArgs.push(`-OwnerPid ${ownerPid}`);
  }
  if (runtime.hidDeviceMatch) {
    helperArgs.push(`-HidDeviceMatch ${quotePowerShellSingle(runtime.hidDeviceMatch)}`);
  }
  if (runtime.usbAdapterMatch) {
    helperArgs.push(`-AdapterMatch ${quotePowerShellSingle(runtime.usbAdapterMatch)}`);
  }
  if (runtime.allowInterfaceSwitch) {
    helperArgs.push("-AllowInterfaceSwitch");
  }
  const innerCommand = [
    "$ErrorActionPreference='Stop';",
    "$ProgressPreference='SilentlyContinue';",
    `& ${quotePowerShellSingle(runtime.pipeHelperPath)}`,
    ...helperArgs
  ].join(" ");
  const innerEncoded = encodePowerShellCommand(innerCommand);
  return [
    "$ErrorActionPreference='Stop';",
    "$ProgressPreference='SilentlyContinue';",
    "$process = Start-Process",
    "-FilePath 'powershell.exe'",
    `-ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${innerEncoded}')`,
    "-Verb RunAs",
    "-WindowStyle Hidden",
    "-PassThru;",
    "[Console]::Out.Write($process.Id)"
  ].join(" ");
}

export function startElevatedUsbPcapCapture(runtime, pipeName, ownerPid = 0) {
  const elevatedCommand = buildElevatedUsbPcapCommand(runtime, pipeName, ownerPid);
  return spawn("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    encodePowerShellCommand(elevatedCommand)
  ], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
}

export function runEncodedPowerShell(script, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      encodePowerShellCommand(script)
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      ...options
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf8"));
        return;
      }
      reject(new Error(
        `powershell exited with code ${code}${signal ? ` (${signal})` : ""}: ` +
          Buffer.concat(stderr).toString("utf8").trim()
      ));
    });
  });
}

export function buildHidRestartScript(instanceId, logPath) {
  const inner = [
    "$ErrorActionPreference='Stop';",
    `pnputil /restart-device ${quotePowerShellSingle(instanceId)}`,
    `  | Out-File -FilePath ${quotePowerShellSingle(logPath)} -Encoding utf8;`,
    "exit $LASTEXITCODE"
  ].join(" ");
  return [
    "$ErrorActionPreference='Stop';",
    "$ProgressPreference='SilentlyContinue';",
    "$process = Start-Process powershell.exe",
    `-ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand','${encodePowerShellCommand(inner)}')`,
    "-Verb RunAs -WindowStyle Hidden -Wait -PassThru;",
    "[Console]::Out.Write($process.ExitCode)"
  ].join(" ");
}
