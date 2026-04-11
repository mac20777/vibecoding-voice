/**
 * Qwen TTS service for Alibaba Cloud DashScope
 * https://help.aliyun.com/zh/model-studio/qwen-ttsapi
 */

import { randomUUID } from "node:crypto";

/**
 * Synthesize text to speech using Qwen TTS API
 * @param {string} text - Text to synthesize
 * @param {object} config - Configuration with dashscopeApiKey
 * @returns {Promise<Buffer>} - Audio buffer (PCM16 or WAV format)
 */
export async function synthesizeTts(text, config) {
  if (!text || text.trim().length === 0) {
    return null;
  }

  if (!config.dashscopeApiKey) {
    console.warn("[TTS] DASHSCOPE_API_KEY not configured, skipping TTS");
    return null;
  }

  // Qwen TTS API endpoint
  const apiUrl = "https://dashscope.aliyuncs.com/api/v1/services/audio/tts";

  // Request body for Qwen TTS
  const requestBody = {
    model: "qwen-tts",  // or "cosy-v1" for CosyVoice
    input: {
      text: text.trim()
    },
    parameters: {
      voice: config.ttsVoice || "cherry",  // Cherry voice by default
      format: config.ttsFormat || "pcm",   // PCM16 format for direct playback
      sample_rate: 16000,  // 16kHz matches device audio
      // Optional: volume, speed, pitch
      ...(config.ttsVolume ? { volume: config.ttsVolume } : {}),
      ...(config.ttsSpeed ? { speed: config.ttsSpeed } : {})
    }
  };

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.dashscopeApiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[TTS] API error: ${response.status} ${errorText}`);
      return null;
    }

    // Handle streaming response (SSE format)
    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      // Non-streaming response
      const data = await response.json();
      if (data.output?.audio) {
        // Audio data is base64 encoded
        const audioBase64 = data.output.audio;
        return Buffer.from(audioBase64, "base64");
      }
    } else if (contentType?.includes("text/event-stream") || contentType?.includes("multipart")) {
      // Streaming response - collect all audio chunks
      const audioChunks = [];
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data:")) {
            const jsonStr = line.slice(5).trim();
            if (jsonStr === "[DONE]") continue;
            try {
              const chunk = JSON.parse(jsonStr);
              if (chunk.output?.audio) {
                audioChunks.push(Buffer.from(chunk.output.audio, "base64"));
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }

      // Combine all chunks
      if (audioChunks.length > 0) {
        return Buffer.concat(audioChunks);
      }
    }

    console.warn("[TTS] No audio data in response");
    return null;
  } catch (error) {
    console.error(`[TTS] Synthesis failed: ${error.message}`);
    return null;
  }
}

/**
 * Split long text into chunks for TTS (max ~500 chars per request)
 * @param {string} text - Long text to split
 * @param {number} maxChars - Maximum characters per chunk
 * @returns {string[]} - Array of text chunks
 */
export function splitTextForTts(text, maxChars = 500) {
  if (!text || text.length <= maxChars) {
    return [text];
  }

  const chunks = [];
  // Split by sentences (Chinese punctuation: 。！？；)
  const sentences = text.split(/[。！？；\n]+/);
  let currentChunk = "";

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > maxChars) {
      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = "";
      }
      // If single sentence exceeds limit, split further
      if (sentence.length > maxChars) {
        // Split by clause (，、)
        const clauses = sentence.split(/[，、]+/);
        for (const clause of clauses) {
          if (currentChunk.length + clause.length > maxChars) {
            if (currentChunk) chunks.push(currentChunk);
            currentChunk = clause;
          } else {
            currentChunk += clause;
          }
        }
      } else {
        currentChunk = sentence;
      }
    } else {
      currentChunk += sentence;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * Synthesize long text by splitting and concatenating audio
 * @param {string} text - Long text to synthesize
 * @param {object} config - Configuration
 * @returns {Promise<Buffer>} - Combined audio buffer
 */
export async function synthesizeLongText(text, config) {
  const chunks = splitTextForTts(text);
  const audioBuffers = [];

  for (const chunk of chunks) {
    if (!chunk || chunk.trim().length === 0) continue;
    const audio = await synthesizeTts(chunk, config);
    if (audio) {
      audioBuffers.push(audio);
      // Small delay between chunks to prevent rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  if (audioBuffers.length === 0) {
    return null;
  }

  return Buffer.concat(audioBuffers);
}