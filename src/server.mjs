import { createServer } from "node:http";

import { WebSocketServer } from "ws";

import { loadConfig } from "./config.mjs";
import { transcribePcm16Mono } from "./stt.mjs";
import { injectText } from "./text-injector.mjs";

const config = loadConfig();

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function sendJson(ws, payload) {
  ws.send(JSON.stringify(payload));
}

function createClientState() {
  return {
    deviceId: "unknown",
    segmentActive: false,
    chunks: [],
    pendingTranscript: ""
  };
}

async function finalizeSegment(ws, state) {
  const pcmBuffer = Buffer.concat(state.chunks);
  state.segmentActive = false;
  state.chunks = [];

  if (pcmBuffer.length === 0) {
    sendJson(ws, { type: "status", status: "empty_segment" });
    return;
  }

  sendJson(ws, {
    type: "status",
    status: "transcribing",
    bytes: pcmBuffer.length
  });

  const startedAt = Date.now();
  const transcript = await transcribePcm16Mono({ pcmBuffer, config });

  sendJson(ws, {
    type: "transcript_final",
    text: transcript,
    latencyMs: Date.now() - startedAt,
    requiresAction: config.transcriptDeliveryMode === "confirm_on_device"
  });

  if (!transcript) {
    state.pendingTranscript = "";
    sendJson(ws, { type: "status", status: "transcript_empty" });
    return;
  }

  if (config.transcriptDeliveryMode === "confirm_on_device") {
    state.pendingTranscript = transcript;
    sendJson(ws, { type: "status", status: "awaiting_action", text: transcript });
    return;
  }

  await injectText(transcript, config.textInjectionMode, {
    dryRun: config.dryRunTextInjection
  });
  state.pendingTranscript = "";
  sendJson(ws, { type: "status", status: "typed", text: transcript });
}

async function sendPendingTranscript(ws, state) {
  const transcript = String(state.pendingTranscript || "").trim();
  if (!transcript) {
    sendJson(ws, { type: "status", status: "no_pending" });
    return;
  }

  await injectText(transcript, "type_and_enter", {
    dryRun: config.dryRunTextInjection
  });
  state.pendingTranscript = "";
  sendJson(ws, { type: "status", status: "typed", text: transcript });
}

function undoPendingTranscript(ws, state) {
  const transcript = String(state.pendingTranscript || "").trim();
  state.pendingTranscript = "";

  if (!transcript) {
    sendJson(ws, { type: "status", status: "no_pending" });
    return;
  }

  sendJson(ws, { type: "transcript_cleared" });
  sendJson(ws, { type: "status", status: "undo_ok" });
}

const server = createServer();
const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  const state = createClientState();
  log("client connected", req.socket.remoteAddress);

  sendJson(ws, {
    type: "server_ready",
    textInjectionMode: config.textInjectionMode,
    transcriptDeliveryMode: config.transcriptDeliveryMode
  });

  ws.on("message", async (data, isBinary) => {
    try {
      if (isBinary) {
        if (state.segmentActive) {
          state.chunks.push(Buffer.from(data));
        }
        return;
      }

      const message = JSON.parse(Buffer.from(data).toString("utf8"));
      switch (message.type) {
        case "hello":
          state.deviceId = message.deviceId || "unknown";
          log("hello", { deviceId: state.deviceId, boardType: message.boardType || "unknown" });
          sendJson(ws, { type: "hello_ack", deviceId: state.deviceId });
          break;
        case "ptt_start":
          log("ptt_start", state.deviceId);
          state.segmentActive = true;
          state.chunks = [];
          state.pendingTranscript = "";
          sendJson(ws, { type: "status", status: "recording" });
          break;
        case "ptt_stop":
          log("ptt_stop", state.deviceId, state.chunks.length);
          await finalizeSegment(ws, state);
          break;
        case "action_send":
          log("action_send", state.deviceId);
          await sendPendingTranscript(ws, state);
          break;
        case "action_undo":
          log("action_undo", state.deviceId);
          undoPendingTranscript(ws, state);
          break;
        case "ping":
          sendJson(ws, { type: "pong", nowMs: Date.now() });
          break;
        default:
          sendJson(ws, { type: "warning", warning: `unknown_message_type:${message.type}` });
          break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("message error", message);
      sendJson(ws, { type: "error", error: message });
    }
  });

  ws.on("close", () => {
    log("client disconnected", state.deviceId);
  });

  ws.on("error", (error) => {
    log("ws error", state.deviceId, error.message);
  });
});

server.listen(config.port, config.bindHost, () => {
  log(`server listening on ws://${config.bindHost}:${config.port}`);
});
