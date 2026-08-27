import process from "node:process";

import { WebSocket } from "ws";

import { loadConfig } from "../src/config.mjs";
import {
  checkXiaomiRemoteHidHealth,
  restartXiaomiRemoteHidChild
} from "../src/xiaomi-remote-hid-health.mjs";
import { XiaomiRemoteSessionController } from "../src/xiaomi-remote-session.mjs";
import {
  decodeMsbcFrames,
  resolveXiaomiRemoteRuntime,
  startXiaomiRemoteCapture
} from "../src/xiaomi-remote-runtime.mjs";

const DEVICE_ID = "xiaomi-voice-remote";
const BOARD_TYPE = "xiaomi-remote-msbc";
const isDoctor = process.argv.includes("--doctor");
const isFixHid = process.argv.includes("--fix-hid");
const once = process.argv.includes("--once");
const config = loadConfig();

function log(message, details = "") {
  const suffix = details ? ` ${typeof details === "string" ? details : JSON.stringify(details)}` : "";
  process.stdout.write(`[xiaomi-remote] ${message}${suffix}\n`);
}

function sendDesktopCaptureStatus(state, metadata = {}) {
  if (process.env.VIBE_DESKTOP !== "1" || typeof process.send !== "function") {
    return;
  }
  try {
    process.send({
      type: "xiaomi_remote_capture_status",
      state,
      ...metadata
    });
  } catch {
    // The desktop may already be shutting down; capture cleanup still runs.
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function connectToBridge() {
  const url = `ws://127.0.0.1:${config.port}`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let settled = false;
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`Timed out connecting to ${url}`));
    }, 5_000);

    const finish = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      callback(value);
    };

    ws.once("open", () => {
      ws.send(JSON.stringify({ type: "hello", deviceId: DEVICE_ID, boardType: BOARD_TYPE }));
    });
    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString("utf8"));
        if (message.type === "server_ready") {
          finish(resolve, { ws, serverReady: message });
        }
      } catch {
        // Ignore non-JSON messages during the handshake.
      }
    });
    ws.once("error", (error) => finish(reject, error));
    ws.once("close", () => finish(reject, new Error(`Bridge closed before handshake: ${url}`)));
  });
}

async function waitForBridge() {
  let attempt = 0;
  while (true) {
    try {
      return await connectToBridge();
    } catch (error) {
      attempt += 1;
      if (attempt === 1 || attempt % 5 === 0) {
        log("waiting for local bridge", error.message);
      }
      await wait(1_000);
    }
  }
}

function waitForServerTarget(ws, target, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out switching bridge target to ${target}`));
    }, timeoutMs);
    const onMessage = (data) => {
      try {
        const message = JSON.parse(data.toString("utf8"));
        if (message.type === "server_ready" && message.sendTarget === target) {
          cleanup();
          resolve(message);
        }
      } catch {
        // Ignore messages unrelated to the target acknowledgement.
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      ws.removeListener("message", onMessage);
    };
    ws.on("message", onMessage);
  });
}

async function fixHidChild(match) {
  const entries = await checkXiaomiRemoteHidHealth(match);
  if (entries.length === 0) {
    log("HID child device not found; pair the remote first");
    process.exitCode = 1;
    return;
  }
  const broken = entries.find((entry) => entry.problem !== 0);
  if (!broken) {
    log("HID child is healthy", { status: entries[0].status, problem: entries[0].problem });
    return;
  }
  log("restarting HID child device through the Windows remote broker", {
    problem: broken.problem,
    instanceId: broken.instanceId
  });
  const result = await restartXiaomiRemoteHidChild(broken.instanceId, match);
  if (result.output) {
    log("pnputil", result.output);
  }
  if (result.healthy) {
    log("HID child recovered");
    return;
  }
  log("HID child still unhealthy; a full Windows restart may be required", result.after);
  process.exitCode = 1;
}

async function main() {
  if (isFixHid) {
    await fixHidChild(config.xiaomiRemoteHidDeviceMatch);
    return;
  }

  log("checking Windows capture tools");
  const runtime = await resolveXiaomiRemoteRuntime(config);
  log("capture target", {
    interface: runtime.interfaceName,
    usbDevice: runtime.deviceAddress
  });

  if (isDoctor) {
    const hidEntries = await checkXiaomiRemoteHidHealth(config.xiaomiRemoteHidDeviceMatch);
    const hidEntry = hidEntries[0];
    log(
      hidEntry
        ? "HID child device found"
        : "HID child device not found (pair the remote, or it is fully disconnected)",
      hidEntry ? { status: hidEntry.status, problem: hidEntry.problem } : ""
    );
    if (hidEntry && hidEntry.problem !== 0) {
      log("HID child needs repair", { fix: "node scripts/xiaomi-remote-input.mjs --fix-hid" });
    }
    log("doctor passed");
    return;
  }

  // A broken HID child (the "driver error" after a re-pair) is repaired by the
  // broker-owned capture helper's watchdog (-HidDeviceMatch), so the fix needs
  // no runtime UAC prompt regardless of when the remote was paired.

  const { ws, serverReady } = await waitForBridge();
  log("connected to VibeCoding Voice", `ws://127.0.0.1:${config.port}`);
  const requestedTarget = String(config.xiaomiRemoteSendTarget || "").trim();
  if (requestedTarget && requestedTarget !== serverReady.sendTarget) {
    const targetReady = waitForServerTarget(ws, requestedTarget);
    ws.send(JSON.stringify({ type: "set_target", sendTarget: requestedTarget }));
    await targetReady;
    log("bridge target selected", requestedTarget);
  } else {
    log("bridge target", serverReady.sendTarget || "unknown");
  }

  let capture = null;
  let shuttingDown = false;
  let adapterRecoveryAwaitingInput = false;
  const controller = new XiaomiRemoteSessionController({
    inactivityMs: config.xiaomiRemoteInactivityMs,
    log,
    sendJson: (message) => ws.send(JSON.stringify(message)),
    sendAudio: (pcm) => ws.send(pcm, { binary: true }),
    decodeFrames: (frames) => decodeMsbcFrames(frames)
  });

  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data.toString("utf8"));
      if (message.type === "transcript_final") {
        log("transcript", message.text || "");
        if (once) {
          void shutdown(0);
        }
      } else if (message.type === "status" && message.status !== "recording") {
        log("status", message.status || "unknown");
      } else if (message.type === "error" || message.type === "warning") {
        log(message.type, message.error || message.warning || "unknown");
      }
    } catch {
      // The bridge currently sends JSON only; ignore any future binary server messages.
    }
  });
  ws.on("close", () => {
    if (!shuttingDown) {
      log("bridge disconnected");
      void shutdown(1);
    }
  });
  ws.on("error", (error) => {
    if (!shuttingDown) {
      log("bridge error", error.message);
    }
  });

  capture = await startXiaomiRemoteCapture(runtime, {
    onLine(line) {
      if (adapterRecoveryAwaitingInput) {
        adapterRecoveryAwaitingInput = false;
        sendDesktopCaptureStatus("ready", { recovered: true });
      }
      controller.pushLine(line);
    },
    onCaptureStart(metadata) {
      log("capture generation started", metadata);
      adapterRecoveryAwaitingInput = metadata?.adapterChanged === true;
      sendDesktopCaptureStatus(
        adapterRecoveryAwaitingInput ? "adapter_changed" : "ready",
        { metadata }
      );
    },
    onCaptureEnd(metadata) {
      controller.reset(metadata?.reason || "capture_restart");
      log("capture generation ended", metadata);
      if (metadata?.reason === "adapter-missing" || metadata?.reason === "adapter-changed") {
        sendDesktopCaptureStatus("recovering", { metadata });
      }
    },
    onLog(source, message) {
      if (message) {
        log(source, message);
      }
    },
    onError(source, error) {
      log(`${source} error`, error.message);
    },
    onExit(source, code, signal) {
      if (!shuttingDown) {
        log(`${source} exited`, { code, signal });
        log("capture pipeline stopped; restart the listener to resume voice input");
        void shutdown(1);
      }
    }
  });
  log("listening; hold the Xiaomi voice key to speak", {
    capturePid: capture.capturePid,
    transport: capture.transport
  });

  async function shutdown(exitCode) {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    controller.dispose();
    capture?.stop();
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
    await wait(250);
    process.exitCode = exitCode;
  }

  process.on("SIGINT", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));
}

main().catch((error) => {
  log("fatal", error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
