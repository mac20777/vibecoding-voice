import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { UsbPcapAttLineParser } from "./usbpcap-att-parser.mjs";
import { decodeMsbcFrames as decodeMsbcFramesToPcm } from "./msbc-decoder.mjs";

const execFileAsync = promisify(execFile);

const DEFAULT_USBPCAP_PATH = String.raw`C:\Program Files\USBPcap\USBPcapCMD.exe`;
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

// The default needle matches any Bluetooth adapter brand (Barrot, Realtek,
// Intel, CSR…); XIAOMI_REMOTE_USB_ADAPTER_MATCH overrides it when a machine has
// several Bluetooth adapters and the wrong one gets picked.
export function findUsbDeviceAddress(output, adapterMatch = "Bluetooth") {
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
  // The helper watches the remote's HID child device while elevated and
  // repairs a "driver error" in place — no second UAC prompt, any pair order.
  if (runtime.hidDeviceMatch) {
    helperArgs.push(`-HidDeviceMatch ${quotePowerShellSingle(runtime.hidDeviceMatch)}`);
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

export async function resolveXiaomiRemoteRuntime(config) {
  if (process.platform !== "win32") {
    throw new Error("Xiaomi remote USB capture is currently supported on Windows only.");
  }

  const usbPcapPath = path.resolve(
    String(config.xiaomiRemoteUsbPcapPath || DEFAULT_USBPCAP_PATH)
  );
  if (!fs.existsSync(usbPcapPath)) {
    throw new Error(`USBPcapCMD.exe was not found: ${usbPcapPath}`);
  }
  if (!fs.existsSync(DEFAULT_USBPCAP_PIPE_HELPER)) {
    throw new Error(`USBPcap named-pipe helper was not found: ${DEFAULT_USBPCAP_PIPE_HELPER}`);
  }

  const captureTarget = await detectCaptureTarget(usbPcapPath, config);
  return {
    usbPcapPath,
    pipeHelperPath: DEFAULT_USBPCAP_PIPE_HELPER,
    // Lets the elevated helper watch/repair the remote's HID child device
    // (see the -HidDeviceMatch param of the pipe helper).
    hidDeviceMatch: config.xiaomiRemoteHidDeviceMatch,
    ...captureTarget
  };
}

export async function startXiaomiRemoteCapture(runtime, handlers = {}) {
  // In-process USBPcap -> ATT notification parser; no external tshark needed.
  const parser = new UsbPcapAttLineParser();

  let stopped = false;
  let socket = null;
  let launcher = null;
  let capturedBytes = 0;
  let exitNotified = false;
  const pipeName = `vibecoding-xiaomi-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const pipePath = `\\\\.\\pipe\\${pipeName}`;
  const server = net.createServer();

  const notifyExit = () => {
    if (stopped || exitNotified) {
      return;
    }
    exitNotified = true;
    if (capturedBytes === 0) {
      handlers.onLog?.(
        "usbpcap",
        "capture produced no data; check %TEMP%\\xiaomi-usbpcap-helper.log for USBPcap " +
          "errors (stale capture process or vanished USB device address)"
      );
    }
    handlers.onExit?.("usbpcap", 0, null);
  };

  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    socket?.destroy();
    server.close();
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
        connection.on("data", (chunk) => {
          capturedBytes += chunk.length;
          let lines;
          try {
            lines = parser.push(chunk);
          } catch (error) {
            handlers.onError?.("usbpcap parser", error);
            connection.destroy();
            notifyExit();
            return;
          }
          for (const line of lines) {
            handlers.onLine?.(line);
          }
        });
        connection.on("close", () => {
          if (!stopped) {
            try {
              for (const line of parser.end()) {
                handlers.onLine?.(line);
              }
            } catch (error) {
              handlers.onError?.("usbpcap parser", error);
            }
          }
          notifyExit();
        });
        resolve();
      });

      server.once("error", (error) => {
        clearTimeout(timeout);
        rejectConnection = null;
        reject(error);
      });
    });

    const elevatedCommand = buildElevatedUsbPcapCommand(runtime, pipeName, process.pid);
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
      transport: "elevated-named-pipe",
      stop
    };
  } catch (error) {
    stop();
    throw error;
  };
}

// Decodes 57-byte mSBC frames to PCM16LE 16 kHz mono in-process
// (src/msbc-decoder.mjs); no external ffmpeg needed.
export function decodeMsbcFrames(frames) {
  if (!Array.isArray(frames) || frames.length === 0) {
    return Buffer.alloc(0);
  }
  const pcm = decodeMsbcFramesToPcm(Buffer.concat(frames));
  if (pcm.length % 2 !== 0) {
    throw new Error(`mSBC decoder returned an odd PCM byte count: ${pcm.length}`);
  }
  return pcm;
}
