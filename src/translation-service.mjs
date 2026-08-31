export const DEFAULT_VOICE_TRANSLATION_PROMPT =
  "Translate the user's Chinese voice transcript into the selected target language. " +
  "Keep the original meaning, tone, and intent. Return only the translated text, with no quotes, labels, or explanation. " +
  "If the input is already in the target language, lightly polish it and return only the polished sentence.";

const TARGET_LANGUAGES = {
  english: {
    label: "English",
    style: "natural, idiomatic English"
  },
  korean: {
    label: "Korean",
    style: "natural, native Korean"
  },
  japanese: {
    label: "Japanese",
    style: "natural, native Japanese"
  }
};

export const VOICE_TRANSLATION_TARGET_LANGUAGES = Object.freeze(Object.keys(TARGET_LANGUAGES));

const SEND_MODES = {
  target: {
    label: "Target only",
    legacyBilingual: false
  },
  bilingual: {
    label: "Chinese + target",
    legacyBilingual: true
  },
  zh_en: {
    label: "Chinese + English",
    legacyBilingual: true
  },
  all: {
    label: "Chinese + English + Korean + Japanese",
    legacyBilingual: true
  }
};

export const VOICE_TRANSLATION_SEND_MODES = Object.freeze(Object.keys(SEND_MODES));

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

export function normalizeVoiceTranslationTargetLanguage(value) {
  const normalized = collapseWhitespace(value).toLowerCase();
  if (normalized === "ko" || normalized === "kr" || normalized === "korean") {
    return "korean";
  }
  if (normalized === "ja" || normalized === "jp" || normalized === "japanese") {
    return "japanese";
  }
  return "english";
}

export function getVoiceTranslationTargetLabel(value) {
  const normalized = normalizeVoiceTranslationTargetLanguage(value);
  return TARGET_LANGUAGES[normalized].label;
}

export function normalizeVoiceTranslationSendMode(value, legacyBilingual = false) {
  const normalized = collapseWhitespace(value)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (
    normalized === "all" ||
    normalized === "multi" ||
    normalized === "multilingual" ||
    normalized === "zh_en_ko_ja" ||
    normalized === "cn_en_ko_ja"
  ) {
    return "all";
  }
  if (
    normalized === "zh_en" ||
    normalized === "cn_en" ||
    normalized === "chinese_english" ||
    normalized === "chinese_and_english"
  ) {
    return "zh_en";
  }
  if (
    normalized === "bilingual" ||
    normalized === "both" ||
    normalized === "cn_target" ||
    normalized === "zh_target" ||
    normalized === "original_target" ||
    normalized === "chinese_target"
  ) {
    return "bilingual";
  }
  if (
    normalized === "target" ||
    normalized === "target_only" ||
    normalized === "translation" ||
    normalized === "translated"
  ) {
    return "target";
  }
  return legacyBilingual ? "bilingual" : "target";
}

export function getVoiceTranslationSendModeLabel(value) {
  const normalized = normalizeVoiceTranslationSendMode(value);
  return SEND_MODES[normalized].label;
}

export function isVoiceTranslationSendModeMultiline(value) {
  const normalized = normalizeVoiceTranslationSendMode(value);
  return SEND_MODES[normalized].legacyBilingual;
}

function buildTargetPrompt(basePrompt, targetLanguage) {
  const normalized = normalizeVoiceTranslationTargetLanguage(targetLanguage);
  const target = TARGET_LANGUAGES[normalized];
  return `${basePrompt} Target language: ${target.label}. Output style: ${target.style}. Return only the ${target.label} translation, with no prefixes, labels, quotes, or explanation.`;
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
    this.model = collapseWhitespace(config.voiceTranslationModel) || "deepseek-v4-flash";
    this.baseUrl = normalizeBaseUrl(config.voiceTranslationBaseUrl || "https://api.deepseek.com");
    this.timeoutMs = Number.isFinite(config.voiceTranslationTimeoutMs)
      ? config.voiceTranslationTimeoutMs
      : 12000;
    this.prompt = collapseWhitespace(config.voiceTranslationPrompt) || DEFAULT_VOICE_TRANSLATION_PROMPT;
    this.targetLanguage = normalizeVoiceTranslationTargetLanguage(config.voiceTranslationTargetLanguage);
  }

  isEnabled() {
    return this.enabled;
  }

  label() {
    if (!this.enabled) {
      return "off";
    }
    const targetLabel = getVoiceTranslationTargetLabel(this.targetLanguage);
    return this.apiKey
      ? `${this.provider} · ${this.model} · ${targetLabel}`
      : `${this.provider} — VOICE_TRANSLATION_API_KEY missing`;
  }

  async translate(text, { targetLanguage } = {}) {
    const input = collapseWhitespace(text);
    if (!this.enabled || !input) {
      return input;
    }
    if (!this.apiKey) {
      throw new Error("voice_translation_api_key_missing");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const resolvedTargetLanguage = normalizeVoiceTranslationTargetLanguage(
      targetLanguage || this.targetLanguage
    );
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
            { role: "system", content: buildTargetPrompt(this.prompt, resolvedTargetLanguage) },
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
