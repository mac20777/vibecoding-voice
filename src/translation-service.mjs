export const DEFAULT_VOICE_TRANSLATION_PROMPT =
  "Translate the user's Chinese voice transcript into natural, idiomatic English. " +
  "Keep the original meaning, tone, and intent. Return only the English translation, with no quotes, labels, or explanation. " +
  "If the input is already English, lightly polish it into natural English and return only the polished sentence.";

function collapseWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeBaseUrl(value) {
  return collapseWhitespace(value).replace(/\/+$/, "");
}

function chatCompletionsUrl(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl || "https://api.deepseek.com");
  return normalized.endsWith("/chat/completions")
    ? normalized
    : `${normalized}/chat/completions`;
}

function normalizeProvider(value) {
  const normalized = collapseWhitespace(value).toLowerCase();
  return normalized === "deepseek" ? "deepseek" : "deepseek";
}

export class VoiceTranslationService {
  constructor(config = {}) {
    this.enabled = config.voiceTranslationEnabled === true;
    this.provider = normalizeProvider(config.voiceTranslationProvider || "deepseek");
    this.apiKey = collapseWhitespace(
      config.voiceTranslationApiKey ||
        config.deepseekApiKey ||
        config.todoIntentApiKey
    );
    this.model = collapseWhitespace(config.voiceTranslationModel) || "deepseek-chat";
    this.baseUrl = normalizeBaseUrl(config.voiceTranslationBaseUrl || "https://api.deepseek.com");
    this.timeoutMs = Number.isFinite(config.voiceTranslationTimeoutMs)
      ? config.voiceTranslationTimeoutMs
      : 12000;
    this.prompt = collapseWhitespace(config.voiceTranslationPrompt) || DEFAULT_VOICE_TRANSLATION_PROMPT;
  }

  isEnabled() {
    return this.enabled;
  }

  label() {
    if (!this.enabled) {
      return "off";
    }
    return this.apiKey ? `${this.provider} · ${this.model}` : `${this.provider} — VOICE_TRANSLATION_API_KEY missing`;
  }

  async translate(text) {
    const input = collapseWhitespace(text);
    if (!this.enabled || !input) {
      return input;
    }
    if (!this.apiKey) {
      throw new Error("voice_translation_api_key_missing");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(chatCompletionsUrl(this.baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: this.prompt },
            { role: "user", content: input }
          ],
          temperature: 0.2,
          stream: false
        })
      });

      if (!response.ok) {
        throw new Error(`voice_translation_http_${response.status}`);
      }

      const payload = await response.json();
      const translated = collapseWhitespace(payload?.choices?.[0]?.message?.content);
      if (!translated) {
        throw new Error("voice_translation_empty");
      }
      return translated;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createVoiceTranslationService(config) {
  return new VoiceTranslationService(config);
}
