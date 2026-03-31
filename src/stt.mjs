import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { projectRoot } from "./paths.mjs";
import { pcm16MonoToWav } from "./wav.mjs";

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

export async function transcribePcm16Mono({ pcmBuffer, config }) {
  if (!pcmBuffer || pcmBuffer.length === 0) {
    return "";
  }

  if (config.mockTranscript) {
    const wav = pcm16MonoToWav(pcmBuffer);
    await saveDebugWavIfNeeded(wav, config.saveDebugWav);
    return config.mockTranscript;
  }

  const wav = pcm16MonoToWav(pcmBuffer);
  await saveDebugWavIfNeeded(wav, config.saveDebugWav);
  const provider = resolveProvider(config);
  if (provider === "openai") {
    return await transcribeWithOpenAI(wav, config);
  }
  if (provider === "volcengine") {
    return await transcribeWithVolcengine(wav, config);
  }

  throw new Error("No STT provider is configured. Set STT_PROVIDER or provider-specific keys.");
}

function resolveProvider(config) {
  if (config.sttProvider) {
    return String(config.sttProvider).toLowerCase();
  }
  if (config.openaiApiKey) {
    return "openai";
  }
  if (config.volcengineAppKey && config.volcengineAccessKey) {
    return "volcengine";
  }
  return "";
}

async function transcribeWithOpenAI(wavBuffer, config) {
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
    body: form
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI transcription failed: ${response.status} ${text}`);
  }

  const payload = await response.json();
  return String(payload.text || "").trim();
}

async function transcribeWithVolcengine(wavBuffer, config) {
  if (!config.volcengineAppKey || !config.volcengineAccessKey) {
    throw new Error("VOLCENGINE_APP_KEY or VOLCENGINE_ACCESS_KEY is not set");
  }

  const requestId = randomUUID();
  const response = await fetch("https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-App-Key": config.volcengineAppKey,
      "X-Api-Access-Key": config.volcengineAccessKey,
      "X-Api-Resource-Id": config.volcengineResourceId,
      "X-Api-Request-Id": requestId,
      "X-Api-Sequence": "-1"
    },
    body: JSON.stringify({
      user: {
        uid: config.volcengineAppKey
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
    })
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
