import net from "node:net";
import path from "node:path";

export const REMOTE_BROKER_PIPE_NAME = "VibeCodingVoice.RemoteBroker.v1";
export const REMOTE_BROKER_PIPE_PATH = `\\\\.\\pipe\\${REMOTE_BROKER_PIPE_NAME}`;

const RESPONSE_LIMIT_BYTES = 64 * 1024;

export function isInstalledDesktopRuntime() {
  return process.platform === "win32" &&
    path.basename(process.execPath).toLowerCase() === "vibecoding voice.exe";
}

export function buildRemoteBrokerCaptureRequest(runtime, pipeName, ownerPid = process.pid) {
  return {
    version: 1,
    action: "start_capture",
    pipeName: String(pipeName || ""),
    ownerPid,
    interfaceName: String(runtime?.interfaceName || ""),
    deviceAddress: String(runtime?.deviceAddress || ""),
    hidDeviceMatch: String(runtime?.hidDeviceMatch || ""),
    adapterMatch: String(runtime?.usbAdapterMatch || "Bluetooth"),
    allowInterfaceSwitch: runtime?.allowInterfaceSwitch === true
  };
}

export function parseRemoteBrokerResponse(raw) {
  let response;
  try {
    response = JSON.parse(String(raw || ""));
  } catch {
    throw new Error("The Windows remote broker returned an invalid response.");
  }
  if (!response || typeof response !== "object") {
    throw new Error("The Windows remote broker returned an empty response.");
  }
  if (response.ok !== true) {
    throw new Error(String(response.error || "The Windows remote broker rejected the request."));
  }
  return response;
}

export function requestRemoteBroker(request, { timeoutMs = 5_000 } = {}) {
  if (process.platform !== "win32") {
    return Promise.reject(new Error("The Windows remote broker is only available on Windows."));
  }

  return new Promise((resolve, reject) => {
    const socket = net.createConnection(REMOTE_BROKER_PIPE_PATH);
    let settled = false;
    let response = Buffer.alloc(0);
    const timer = setTimeout(() => {
      finish(new Error("Timed out waiting for the Windows remote broker."));
    }, timeoutMs);

    const finish = (error, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };

    socket.once("connect", () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });
    socket.on("data", (chunk) => {
      response = Buffer.concat([response, chunk]);
      if (response.length > RESPONSE_LIMIT_BYTES) {
        finish(new Error("The Windows remote broker response was too large."));
        return;
      }
      const newline = response.indexOf(0x0a);
      if (newline >= 0) {
        try {
          finish(null, parseRemoteBrokerResponse(response.subarray(0, newline).toString("utf8")));
        } catch (error) {
          finish(error);
        }
      }
    });
    socket.once("error", (error) => finish(error));
    socket.once("end", () => {
      if (!settled) {
        finish(new Error("The Windows remote broker closed the connection without a response."));
      }
    });
  });
}

export function startRemoteCaptureViaBroker(runtime, pipeName, ownerPid = process.pid) {
  return requestRemoteBroker(buildRemoteBrokerCaptureRequest(runtime, pipeName, ownerPid));
}

export function stopRemoteCaptureViaBroker(ownerPid = process.pid) {
  return requestRemoteBroker({
    version: 1,
    action: "stop_capture",
    ownerPid
  }, { timeoutMs: 2_000 });
}

export function restartRemoteHidViaBroker(instanceId) {
  return requestRemoteBroker({
    version: 1,
    action: "restart_hid",
    instanceId: String(instanceId || "")
  }, { timeoutMs: 45_000 });
}
