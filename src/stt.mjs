import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { projectRoot } from "./paths.mjs";
import { pcm16MonoToWav } from "./wav.mjs";

export const STT_ERROR_CODES = Object.freeze({
  CANCELLED: "STT_CANCELLED",
  TIMEOUT: "STT_TIMEOUT"
});

function sttError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function abortableDelay(ms, signal) {
  if (!(Number(ms) > 0)) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, Number(ms));
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(signal.reason || sttError(STT_ERROR_CODES.CANCELLED, "Speech recognition was cancelled."));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function withTranscriptionDeadline({ timeoutMs, signal }, operation) {
  const controller = new AbortController();
  const effectiveTimeoutMs = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Number(timeoutMs)
    : 15_000;
  let abortCause = "";
  const onExternalAbort = () => {
    abortCause = "cancelled";
    controller.abort(signal?.reason);
  };
  if (signal?.aborted) {
    throw sttError(STT_ERROR_CODES.CANCELLED, "Speech recognition was cancelled.");
  }
  signal?.addEventListener("abort", onExternalAbort, { once: true });
  const timer = setTimeout(() => {
    abortCause = "timeout";
    controller.abort();
  }, effectiveTimeoutMs);
  timer.unref?.();

  try {
    return await operation(controller.signal);
  } catch (error) {
    if (abortCause === "cancelled" || signal?.aborted) {
      throw sttError(STT_ERROR_CODES.CANCELLED, "Speech recognition was cancelled.");
    }
    if (abortCause === "timeout") {
      throw sttError(
        STT_ERROR_CODES.TIMEOUT,
        `Speech recognition timed out after ${effectiveTimeoutMs} ms.`
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}

async function saveDebugWavIfNeeded(wavBuffer, enabled) {
  if (!enabled) {
    return null;
  }

  const dir = path.join(projectRoot, "tmp");
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `segment-${Date.now()}.wav`);
  await fs.writeFile(filePath, wavBuffer);
  return filePath;
}

export async function transcribePcm16Mono({ pcmBuffer, config, signal }) {
  if (!pcmBuffer || pcmBuffer.length === 0) {
    return "";
  }

  const wav = pcm16MonoToWav(pcmBuffer);
  await saveDebugWavIfNeeded(wav, config.saveDebugWav);
  return await withTranscriptionDeadline(
    { timeoutMs: config.sttTimeoutMs, signal },
    async (requestSignal) => {
      if (config.mockTranscript) {
        await abortableDelay(config.mockTranscriptDelayMs, requestSignal);
        return config.mockTranscript;
      }

      const provider = resolveProvider(config);
      if (provider === "openai") {
        return await transcribeWithOpenAI(wav, config, requestSignal);
      }
      if (provider === "volcengine") {
        return await transcribeWithVolcengine(wav, config, requestSignal);
      }

      throw new Error("No STT provider is configured. Set STT_PROVIDER or provider-specific keys.");
    }
  );
}

function resolveProvider(config) {
  if (config.sttProvider) {
    return String(config.sttProvider).toLowerCase();
  }
  if (config.openaiApiKey) {
    return "openai";
  }
  if (config.volcengineApiKey || (config.volcengineAppKey && config.volcengineAccessKey)) {
    return "volcengine";
  }
  return "";
}

async function transcribeWithOpenAI(wavBuffer, config, signal) {
  if (!config.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const form = new FormData();
  form.set("model", config.openaiModel);
  if (config.openaiLanguage) {
    form.set("language", config.openaiLanguage);
  }
  form.set("file", new File([wavBuffer], "segment.wav", { type: "audio/wav" }));

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`
    },
    body: form,
    signal
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI transcription failed: ${response.status} ${text}`);
  }

  const payload = await response.json();
  return String(payload.text || "").trim();
}

async function transcribeWithVolcengine(wavBuffer, config, signal) {
  const useApiKey = Boolean(config.volcengineApiKey);
  if (!useApiKey && !(config.volcengineAppKey && config.volcengineAccessKey)) {
    throw new Error("VOLCENGINE_API_KEY (new console) or VOLCENGINE_APP_KEY + VOLCENGINE_ACCESS_KEY (legacy console) is not set");
  }

  const requestId = randomUUID();
  const response = await fetch("https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(useApiKey
        ? { "X-Api-Key": config.volcengineApiKey }
        : {
            "X-Api-App-Key": config.volcengineAppKey,
            "X-Api-Access-Key": config.volcengineAccessKey
          }),
      "X-Api-Resource-Id": config.volcengineResourceId,
      "X-Api-Request-Id": requestId,
      "X-Api-Sequence": "-1"
    },
    body: JSON.stringify({
      user: {
        uid: config.volcengineAppKey || "vibecoding-voice"
      },
      audio: {
        data: wavBuffer.toString("base64"),
        format: "wav",
        ...(config.volcengineLanguage ? { language: config.volcengineLanguage } : {})
      },
      request: {
        model_name: "bigmodel",
        enable_itn: true,
        enable_punc: true,
        show_utterances: false
      }
    }),
    signal
  });

  const statusCode = response.headers.get("X-Api-Status-Code") || "";
  const statusMessage = response.headers.get("X-Api-Message") || "";
  const logId = response.headers.get("X-Tt-Logid") || "";

  if (!response.ok || statusCode !== "20000000") {
    const text = await response.text();
    throw new Error(
      `Volcengine transcription failed: http=${response.status} api=${statusCode} message=${statusMessage} logid=${logId} body=${text}`
    );
  }

  const payload = await response.json();
  return String(payload?.result?.text || "").trim();
}
