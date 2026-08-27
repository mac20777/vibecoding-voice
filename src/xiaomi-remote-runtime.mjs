import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { UsbPcapCaptureStreamDecoder } from "./usbpcap-pipe-protocol.mjs";
import { decodeMsbcFrames as decodeMsbcFramesToPcm } from "./msbc-decoder.mjs";
import {
  isInstalledDesktopRuntime,
  startRemoteCaptureViaBroker,
  stopRemoteCaptureViaBroker
} from "./windows-remote-broker-client.mjs";

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
  // Hard timeout: a contended/wedged USBPcap driver can hang these queries
  // for good, which would otherwise wedge the whole listener at startup.
  const { stdout } = await execFileAsync(command, args, {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
    timeout: 10_000
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

  let fallbackAddress = null;
  for (const line of String(output || "").split(/\r?\n/)) {
    if (!line.toLowerCase().includes(needle)) {
      continue;
    }
    const match = line.match(/\{value=(\d+)(?:_\d+)?\}/);
    if (match) {
      if (/\{enabled=true\}/i.test(line)) {
        return match[1];
      }
      fallbackAddress ||= match[1];
    }
  }
  return fallbackAddress;
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
  // The broker-owned helper watches the remote's HID child device and repairs
  // a "driver error" in place without another UAC prompt, in any pair order.
  if (runtime.hidDeviceMatch) {
    helperArgs.push(`-HidDeviceMatch ${quotePowerShellSingle(runtime.hidDeviceMatch)}`);
  }
  // The helper re-resolves the Bluetooth adapter after an unplug/replug and
  // restarts the capture at the (possibly new) USB address by itself.
  if (runtime.usbAdapterMatch) {
    helperArgs.push(`-AdapterMatch ${quotePowerShellSingle(runtime.usbAdapterMatch)}`);
  }
  // Unless the user explicitly pinned XIAOMI_REMOTE_USBPCAP_INTERFACE, let the
  // helper search every USBPcap root after a Bluetooth-radio replacement.
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
    // The helper's HID watchdog repairs the remote's broken HID child (the
    // "driver error" after a re-pair). Off by default: a repaired child makes
    // Windows deliver the remote's keys natively system-wide, and a repair
    // landing mid-hold of the pairing combo latches a key (e.g. Menu keeps
    // opening context menus until the adapter is unplugged). The broken child
    // is harmless — voice and buttons ride the USBPcap path. Opt in with
    // XIAOMI_REMOTE_HID_AUTOREPAIR=1; the Remote page repair button stays.
    hidDeviceMatch: config.xiaomiRemoteHidAutoRepair ? config.xiaomiRemoteHidDeviceMatch : "",
    // Lets the helper re-find the adapter after an unplug/replug.
    usbAdapterMatch: config.xiaomiRemoteUsbAdapterMatch,
    // A configured interface is an intentional pin (usually for machines with
    // multiple Bluetooth radios). The default may follow a replacement radio
    // even when Windows enumerates it under a different USBPcap interface.
    allowInterfaceSwitch: !String(config.xiaomiRemoteUsbPcapInterface || "").trim(),
    ...captureTarget
  };
}

export async function startXiaomiRemoteCapture(runtime, handlers = {}) {
  // The broker-owned helper frames each capture generation. The decoder creates a
  // fresh USBPcap parser after an adapter unplug/replug so a truncated record
  // from the old stream cannot corrupt the new stream.
  const captureStream = new UsbPcapCaptureStreamDecoder();

  let stopped = false;
  let socket = null;
  let launcher = null;
  let brokerOwned = false;
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
        "capture produced no data; check ProgramData\\VibeCoding Voice\\logs for USBPcap " +
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
    if (brokerOwned) {
      void stopRemoteCaptureViaBroker(process.pid).catch(() => {});
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
          "Timed out waiting for the Windows remote capture broker. Repair the application installation and try again."
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
          let events;
          try {
            events = captureStream.push(chunk);
            capturedBytes = captureStream.dataBytes;
          } catch (error) {
            handlers.onError?.("usbpcap parser", error);
            connection.destroy();
            notifyExit();
            return;
          }
          for (const event of events) {
            if (event.type === "line") {
              handlers.onLine?.(event.line);
            } else if (event.type === "capture_start") {
              handlers.onCaptureStart?.(event.metadata);
            } else if (event.type === "capture_end") {
              handlers.onCaptureEnd?.(event.metadata);
            }
          }
        });
        connection.on("close", () => {
          if (!stopped) {
            try {
              captureStream.end();
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

    let capturePid = null;
    try {
      const broker = await startRemoteCaptureViaBroker(runtime, pipeName, process.pid);
      brokerOwned = true;
      capturePid = Number.isInteger(broker.pid) ? broker.pid : null;
      handlers.onLog?.("usbpcap", "capture started through the installed Windows remote broker");
    } catch (brokerError) {
      // Developer runs from node/electron do not have an installed, path-bound
      // broker client. Preserve the old one-time RunAs path there only. The
      // packaged desktop must fail closed so it never brings the boot-time UAC
      // prompt back when a service installation is damaged.
      if (isInstalledDesktopRuntime()) {
        throw new Error(
          "VibeCoding Voice Remote Broker is unavailable. Repair or reinstall VibeCoding Voice. " +
            `(${brokerError.message || brokerError})`
        );
      }

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
      let launcherError = "";
      launcher.stdout.setEncoding("utf8");
      launcher.stdout.on("data", (chunk) => {
        const pid = Number(String(chunk).trim());
        if (Number.isInteger(pid) && pid > 0) {
          capturePid = pid;
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
      handlers.onLog?.("usbpcap", "development fallback: waiting for Windows administrator approval");
    }

    await connected;
    handlers.onLog?.("usbpcap", "live capture connected through Windows named pipe");

    return {
      capturePid: capturePid || launcher?.pid || null,
      transport: brokerOwned ? "windows-service-broker" : "elevated-named-pipe",
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
