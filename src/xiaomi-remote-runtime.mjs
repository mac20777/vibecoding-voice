import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import readline from "node:readline";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_USBPCAP_PATH = String.raw`C:\Program Files\USBPcap\USBPcapCMD.exe`;
const DEFAULT_TSHARK_PATH = String.raw`C:\Program Files\Wireshark\tshark.exe`;
export function resolveAsarUnpackedPath(filePath) {
  return String(filePath).replace(
    /([\\/])app\.asar\1/,
    (_match, separator) => `${separator}app.asar.unpacked${separator}`
  );
}

const DEFAULT_USBPCAP_PIPE_HELPER = resolveAsarUnpackedPath(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "scripts",
    "windows",
    "xiaomi-usbpcap-pipe.ps1"
  )
);

function firstNonEmptyLine(value) {
  return String(value || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
}

async function runText(command, args) {
  const { stdout } = await execFileAsync(command, args, {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024
  });
  return stdout;
}

export function parseExtcapInterfaces(output) {
  const interfaces = [];
  for (const line of String(output || "").split(/\r?\n/)) {
    const match = line.match(/^interface \{value=([^}]+)\}/);
    if (match) {
      interfaces.push(match[1]);
    }
  }
  return interfaces;
}

export function findUsbDeviceAddress(output, adapterMatch = "BARROT Bluetooth") {
  const needle = String(adapterMatch || "").trim().toLowerCase();
  if (!needle) {
    return null;
  }

  for (const line of String(output || "").split(/\r?\n/)) {
    if (!line.toLowerCase().includes(needle)) {
      continue;
    }
    const match = line.match(/\{value=(\d+)(?:_\d+)?\}/);
    if (match) {
      return match[1];
    }
  }
  return null;
}

export function quotePowerShellSingle(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function encodePowerShellCommand(command) {
  return Buffer.from(String(command), "utf16le").toString("base64");
}

export function buildElevatedUsbPcapCommand(runtime, pipeName) {
  const innerCommand = [
    "$ErrorActionPreference='Stop';",
    "$ProgressPreference='SilentlyContinue';",
    `& ${quotePowerShellSingle(runtime.pipeHelperPath)}`,
    `-PipeName ${quotePowerShellSingle(pipeName)}`,
    `-UsbPcapPath ${quotePowerShellSingle(runtime.usbPcapPath)}`,
    `-InterfaceName ${quotePowerShellSingle(runtime.interfaceName)}`,
    `-DeviceAddress ${quotePowerShellSingle(runtime.deviceAddress)}`
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

async function detectCaptureTarget(usbPcapPath, config) {
  if (config.xiaomiRemoteUsbPcapInterface && config.xiaomiRemoteUsbDevice) {
    return {
      interfaceName: config.xiaomiRemoteUsbPcapInterface,
      deviceAddress: config.xiaomiRemoteUsbDevice
    };
  }

  const interfaceOutput = await runText(usbPcapPath, ["--extcap-interfaces"]);
  const interfaces = config.xiaomiRemoteUsbPcapInterface
    ? [config.xiaomiRemoteUsbPcapInterface]
    : parseExtcapInterfaces(interfaceOutput);

  for (const interfaceName of interfaces) {
    const tree = await runText(usbPcapPath, [
      "--extcap-interface",
      interfaceName,
      "--extcap-config"
    ]);
    const deviceAddress = config.xiaomiRemoteUsbDevice || findUsbDeviceAddress(
      tree,
      config.xiaomiRemoteUsbAdapterMatch
    );
    if (deviceAddress) {
      return { interfaceName, deviceAddress };
    }
  }

  throw new Error(
    `Could not find USB Bluetooth adapter matching "${config.xiaomiRemoteUsbAdapterMatch}". ` +
      "Set XIAOMI_REMOTE_USBPCAP_INTERFACE and XIAOMI_REMOTE_USB_DEVICE explicitly."
  );
}

async function detectDecoder(config) {
  const explicit = String(config.xiaomiRemoteFfmpegPath || "").trim();
  if (explicit) {
    if (!fs.existsSync(explicit)) {
      throw new Error(`XIAOMI_REMOTE_FFMPEG_PATH does not exist: ${explicit}`);
    }
    return { command: explicit, prefixArgs: [], label: explicit };
  }

  if (process.platform === "win32") {
    try {
      const output = await runText("where.exe", ["ffmpeg.exe"]);
      const executable = firstNonEmptyLine(output);
      if (executable) {
        return { command: executable, prefixArgs: [], label: executable };
      }
    } catch {
      // Fall through to the installed WSL decoder.
    }

    const distro = String(config.xiaomiRemoteWslDistro || "Ubuntu").trim() || "Ubuntu";
    try {
      await runText("wsl.exe", ["-d", distro, "--", "sh", "-lc", "command -v ffmpeg"]);
      return {
        command: "wsl.exe",
        prefixArgs: ["-d", distro, "--", "ffmpeg"],
        label: `WSL ${distro} ffmpeg`
      };
    } catch {
      throw new Error(
        "FFmpeg was not found. Install native ffmpeg.exe or install ffmpeg in WSL, " +
          "then set XIAOMI_REMOTE_FFMPEG_PATH or XIAOMI_REMOTE_WSL_DISTRO."
      );
    }
  }

  return { command: "ffmpeg", prefixArgs: [], label: "ffmpeg" };
}

export async function resolveXiaomiRemoteRuntime(config) {
  if (process.platform !== "win32") {
    throw new Error("Xiaomi remote USB capture is currently supported on Windows only.");
  }

  const usbPcapPath = path.resolve(
    String(config.xiaomiRemoteUsbPcapPath || DEFAULT_USBPCAP_PATH)
  );
  const tsharkPath = path.resolve(
    String(config.xiaomiRemoteTsharkPath || DEFAULT_TSHARK_PATH)
  );
  if (!fs.existsSync(usbPcapPath)) {
    throw new Error(`USBPcapCMD.exe was not found: ${usbPcapPath}`);
  }
  if (!fs.existsSync(tsharkPath)) {
    throw new Error(`tshark.exe was not found: ${tsharkPath}`);
  }
  if (!fs.existsSync(DEFAULT_USBPCAP_PIPE_HELPER)) {
    throw new Error(`USBPcap named-pipe helper was not found: ${DEFAULT_USBPCAP_PIPE_HELPER}`);
  }

  const captureTarget = await detectCaptureTarget(usbPcapPath, config);
  const decoder = await detectDecoder(config);
  return {
    usbPcapPath,
    tsharkPath,
    pipeHelperPath: DEFAULT_USBPCAP_PIPE_HELPER,
    ...captureTarget,
    decoder
  };
}

export async function startXiaomiRemoteCapture(runtime, handlers = {}) {
  const analyzer = spawn(
    runtime.tsharkPath,
    [
      "-l",
      "-n",
      "-r",
      "-",
      "-Y",
      "btatt.opcode == 0x1b",
      "-T",
      "fields",
      "-E",
      "separator=|",
      "-e",
      "btatt.handle",
      "-e",
      "btatt.value"
    ],
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }
  );

  const reader = readline.createInterface({ input: analyzer.stdout });
  reader.on("line", (line) => handlers.onLine?.(line));

  analyzer.stderr.setEncoding("utf8");
  analyzer.stderr.on("data", (chunk) => handlers.onLog?.("tshark", String(chunk).trim()));

  analyzer.on("error", (error) => handlers.onError?.("tshark", error));
  analyzer.on("exit", (code, signal) => handlers.onExit?.("tshark", code, signal));

  let stopped = false;
  let socket = null;
  let launcher = null;
  const pipeName = `vibecoding-xiaomi-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const pipePath = `\\\\.\\pipe\\${pipeName}`;
  const server = net.createServer();

  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    reader.close();
    socket?.destroy();
    server.close();
    analyzer.stdin.destroy();
    analyzer.kill();
    if (launcher && launcher.exitCode == null) {
      launcher.kill();
    }
  };

  try {
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(pipePath);
    });

    let rejectConnection = null;
    const connected = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(
          "Timed out waiting for the administrator capture helper. Approve the Windows UAC prompt and try again."
        ));
      }, 30_000);
      rejectConnection = (error) => {
        clearTimeout(timeout);
        rejectConnection = null;
        reject(error);
      };

      server.once("connection", (connection) => {
        clearTimeout(timeout);
        rejectConnection = null;
        socket = connection;
        connection.on("error", (error) => handlers.onError?.("usbpcap pipe", error));
        connection.pipe(analyzer.stdin);
        resolve();
      });

      server.once("error", (error) => {
        clearTimeout(timeout);
        rejectConnection = null;
        reject(error);
      });
    });

    const elevatedCommand = buildElevatedUsbPcapCommand(runtime, pipeName);
    launcher = spawn("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      encodePowerShellCommand(elevatedCommand)
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let elevatedPid = null;
    let launcherError = "";
    launcher.stdout.setEncoding("utf8");
    launcher.stdout.on("data", (chunk) => {
      const pid = Number(String(chunk).trim());
      if (Number.isInteger(pid) && pid > 0) {
        elevatedPid = pid;
      }
    });
    launcher.stderr.setEncoding("utf8");
    launcher.stderr.on("data", (chunk) => {
      launcherError += String(chunk);
    });
    launcher.on("error", (error) => handlers.onError?.("usbpcap launcher", error));
    launcher.on("exit", (code, signal) => {
      if (code && !socket) {
        const error = new Error(
          launcherError.trim() || `launcher exited with code ${code}${signal ? ` (${signal})` : ""}`
        );
        handlers.onError?.("usbpcap launcher", error);
        rejectConnection?.(error);
      }
    });

    handlers.onLog?.("usbpcap", "waiting for Windows administrator approval");
    await connected;
    handlers.onLog?.("usbpcap", "live capture connected through Windows named pipe");

    return {
      capturePid: elevatedPid || launcher.pid,
      analyzerPid: analyzer.pid,
      transport: "elevated-named-pipe",
      stop
    };
  } catch (error) {
    stop();
    throw error;
  };
}

export async function decodeMsbcFrames(frames, runtime) {
  if (!Array.isArray(frames) || frames.length === 0) {
    return Buffer.alloc(0);
  }

  const args = [
    ...runtime.decoder.prefixArgs,
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "sbc",
    "-i",
    "pipe:0",
    "-f",
    "s16le",
    "-ac",
    "1",
    "-ar",
    "16000",
    "pipe:1"
  ];
  const decoder = spawn(runtime.decoder.command, args, {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });
  const stdout = [];
  const stderr = [];
  decoder.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  decoder.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));

  const completed = new Promise((resolve, reject) => {
    decoder.on("error", reject);
    decoder.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(
        `mSBC decoder exited with code ${code}${signal ? ` (${signal})` : ""}: ` +
          Buffer.concat(stderr).toString("utf8").trim()
      ));
    });
  });

  decoder.stdin.end(Buffer.concat(frames));
  await completed;
  const pcm = Buffer.concat(stdout);
  if (pcm.length % 2 !== 0) {
    throw new Error(`mSBC decoder returned an odd PCM byte count: ${pcm.length}`);
  }
  return pcm;
}
