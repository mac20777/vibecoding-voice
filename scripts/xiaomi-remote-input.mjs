import process from "node:process";

import { WebSocket } from "ws";

import { loadConfig } from "../src/config.mjs";
import { XiaomiRemoteProtocolParser } from "../src/xiaomi-remote-protocol.mjs";
import {
  decodeMsbcFrames,
  resolveXiaomiRemoteRuntime,
  startXiaomiRemoteCapture
} from "../src/xiaomi-remote-runtime.mjs";

const DEVICE_ID = "xiaomi-voice-remote";
const BOARD_TYPE = "xiaomi-remote-msbc";
const isDoctor = process.argv.includes("--doctor");
const once = process.argv.includes("--once");
const config = loadConfig();

function log(message, details = "") {
  const suffix = details ? ` ${typeof details === "string" ? details : JSON.stringify(details)}` : "";
  process.stdout.write(`[xiaomi-remote] ${message}${suffix}\n`);
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

async function main() {
  log("checking Windows capture and decoder tools");
  const runtime = await resolveXiaomiRemoteRuntime(config);
  log("capture target", {
    interface: runtime.interfaceName,
    usbDevice: runtime.deviceAddress,
    decoder: runtime.decoder.label
  });

  if (isDoctor) {
    log("doctor passed");
    return;
  }

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
  let session = null;
  let decoding = false;
  let inactivityTimer = null;
  let shuttingDown = false;
  const parser = new XiaomiRemoteProtocolParser();

  const clearInactivityTimer = () => {
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
      inactivityTimer = null;
    }
  };

  const armInactivityTimer = () => {
    clearInactivityTimer();
    inactivityTimer = setTimeout(() => {
      for (const event of parser.stop("inactivity")) {
        void handleEvent(event);
      }
    }, Math.max(250, config.xiaomiRemoteInactivityMs));
  };

  const finishSession = async (event) => {
    clearInactivityTimer();
    if (!session) {
      return;
    }

    const completed = session;
    session = null;
    if (completed.frames.length === 0) {
      log("voice session ignored: no audio frames");
      ws.send(JSON.stringify({ type: "ptt_cancel", source: "xiaomi_remote", ts: Date.now() }));
      return;
    }

    decoding = true;
    try {
      log("decoding voice", {
        frames: completed.frames.length,
        sequenceErrors: event.sequenceErrors,
        reason: event.reason
      });
      const pcm = await decodeMsbcFrames(completed.frames, runtime);
      ws.send(pcm, { binary: true });
      ws.send(JSON.stringify({ type: "ptt_stop", source: "xiaomi_remote", ts: Date.now() }));
      log("voice sent", {
        pcmBytes: pcm.length,
        durationSeconds: Number((pcm.length / 2 / 16_000).toFixed(3))
      });
    } catch (error) {
      ws.send(JSON.stringify({ type: "ptt_cancel", source: "xiaomi_remote", ts: Date.now() }));
      log("decode failed", error.message);
    } finally {
      decoding = false;
    }
  };

  const handleEvent = async (event) => {
    if (event.type === "start") {
      if (decoding || session) {
        return;
      }
      session = { frames: [], startedAt: Date.now() };
      ws.send(JSON.stringify({
        type: "ptt_start",
        source: "xiaomi_remote",
        ts: Date.now()
      }));
      log("voice key down");
      return;
    }

    if (event.type === "audio") {
      if (!session || decoding) {
        return;
      }
      session.frames.push(event.frame);
      armInactivityTimer();
      return;
    }

    if (event.type === "stop") {
      await finishSession(event);
    }
  };

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
      for (const event of parser.pushLine(line)) {
        void handleEvent(event);
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
      }
    }
  });
  log("listening; hold the Xiaomi voice key to speak", {
    capturePid: capture.capturePid,
    analyzerPid: capture.analyzerPid,
    transport: capture.transport
  });

  async function shutdown(exitCode) {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    clearInactivityTimer();
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
