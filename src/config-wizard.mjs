import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  detectConfiguredSttProvider,
  getConfigIssues,
  hasRequiredConfig,
  loadConfig,
  redactValue,
  writeUserConfigValues
} from "./config.mjs";

class MutedWriter {
  constructor(stream) {
    this.stream = stream;
    this.muted = false;
  }

  get isTTY() {
    return this.stream.isTTY;
  }

  get columns() {
    return this.stream.columns;
  }

  get rows() {
    return this.stream.rows;
  }

  write(chunk, encoding, callback) {
    if (!this.muted) {
      return this.stream.write(chunk, encoding, callback);
    }

    if (typeof callback === "function") {
      callback();
    }

    return true;
  }

  on(eventName, listener) {
    this.stream.on(eventName, listener);
    return this;
  }

  once(eventName, listener) {
    this.stream.once(eventName, listener);
    return this;
  }

  removeListener(eventName, listener) {
    this.stream.removeListener(eventName, listener);
    return this;
  }
}

function createPromptInterface() {
  const mutedOutput = new MutedWriter(output);
  const rl = readline.createInterface({
    input,
    output: mutedOutput,
    terminal: Boolean(input.isTTY && output.isTTY)
  });

  return { rl, mutedOutput };
}

function printWizardIntro(config) {
  const provider = detectConfiguredSttProvider(config) || "not configured";
  const overridingFiles = (config.loadedConfigFiles || []).filter((filePath) => filePath !== config.userConfigPath);

  output.write("\nVibe setup\n\n");
  output.write(`Config file: ${config.userConfigPath}\n`);
  output.write(`Current STT provider: ${provider}\n`);
  output.write("This wizard configures the required STT settings for first use.\n");
  output.write("Required: STT provider + matching API keys\n");
  output.write("Optional: LAN_SHARED_SECRET (only if your board uses LAN auth)\n");
  output.write('Run "vibe config" again anytime to change these values.\n\n');

  if (overridingFiles.length > 0) {
    output.write("Note: a local config file is currently overriding user-level config:\n");
    for (const filePath of overridingFiles) {
      output.write(`  - ${filePath}\n`);
    }
    output.write("\n");
  }
}

function promptSuffix({ defaultValue, allowClear = false, optional = false }) {
  const parts = [];
  if (defaultValue) {
    parts.push("Enter = keep current");
  }
  if (allowClear) {
    parts.push('"-" = clear');
  }
  if (optional && !defaultValue) {
    parts.push("Enter = skip");
  }

  return parts.length ? ` (${parts.join(", ")})` : "";
}

async function askText(rl, label, { defaultValue = "", optional = false, allowClear = false } = {}) {
  while (true) {
    const answer = String(await rl.question(`${label}${promptSuffix({ defaultValue, optional, allowClear })}: `)).trim();

    if (answer === "-" && allowClear) {
      return "";
    }

    if (!answer) {
      if (defaultValue) {
        return defaultValue;
      }
      if (optional) {
        return "";
      }
      output.write("This value is required.\n");
      continue;
    }

    return answer;
  }
}

async function askSecret(rl, mutedOutput, label, { defaultValue = "", optional = false, allowClear = false } = {}) {
  while (true) {
    output.write(`${label}${promptSuffix({ defaultValue, optional, allowClear })}: `);
    mutedOutput.muted = true;
    const answer = String(await rl.question("")).trim();
    mutedOutput.muted = false;
    output.write("\n");

    if (answer === "-" && allowClear) {
      return "";
    }

    if (!answer) {
      if (defaultValue) {
        return defaultValue;
      }
      if (optional) {
        return "";
      }
      output.write("This value is required.\n");
      continue;
    }

    return answer;
  }
}

async function askYesNo(rl, label, defaultYes = true) {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = String(await rl.question(`${label} ${hint}: `)).trim().toLowerCase();
  if (!answer) {
    return defaultYes;
  }
  return answer === "y" || answer === "yes";
}

async function askProvider(rl, currentProvider) {
  const defaultOption = currentProvider === "openai" ? "2" : "1";

  while (true) {
    output.write("Choose your STT provider:\n");
    output.write("  1. Volcengine (VOLCENGINE_APP_KEY + VOLCENGINE_ACCESS_KEY)\n");
    output.write("  2. OpenAI (OPENAI_API_KEY)\n");
    const answer = String(await rl.question(`Selection [${defaultOption}]: `)).trim();
    const selection = answer || defaultOption;

    if (selection === "1" || selection.toLowerCase() === "volcengine") {
      return "volcengine";
    }
    if (selection === "2" || selection.toLowerCase() === "openai") {
      return "openai";
    }

    output.write("Please choose 1 or 2.\n");
  }
}

export async function runConfigWizard() {
  if (!input.isTTY || !output.isTTY) {
    throw new Error('Interactive setup requires a TTY. Run "vibe config" in a terminal.');
  }

  const currentConfig = loadConfig({ quietMissing: true });
  const currentProvider = detectConfiguredSttProvider(currentConfig) || "volcengine";

  printWizardIntro(currentConfig);

  const { rl, mutedOutput } = createPromptInterface();

  try {
    const provider = await askProvider(rl, currentProvider);
    const updates = {
      STT_PROVIDER: provider
    };

    if (provider === "volcengine") {
      updates.VOLCENGINE_APP_KEY = await askSecret(rl, mutedOutput, "VOLCENGINE_APP_KEY", {
        defaultValue: currentConfig.volcengineAppKey
      });
      updates.VOLCENGINE_ACCESS_KEY = await askSecret(rl, mutedOutput, "VOLCENGINE_ACCESS_KEY", {
        defaultValue: currentConfig.volcengineAccessKey
      });
      updates.VOLCENGINE_RESOURCE_ID = await askText(rl, "VOLCENGINE_RESOURCE_ID", {
        defaultValue: currentConfig.volcengineResourceId || "volc.bigasr.auc_turbo"
      });
      updates.VOLCENGINE_LANGUAGE = await askText(rl, "VOLCENGINE_LANGUAGE", {
        defaultValue: currentConfig.volcengineLanguage || "zh-CN"
      });
    } else {
      updates.OPENAI_API_KEY = await askSecret(rl, mutedOutput, "OPENAI_API_KEY", {
        defaultValue: currentConfig.openaiApiKey
      });
      updates.OPENAI_TRANSCRIBE_MODEL = await askText(rl, "OPENAI_TRANSCRIBE_MODEL", {
        defaultValue: currentConfig.openaiModel || "whisper-1"
      });
      updates.OPENAI_TRANSCRIBE_LANGUAGE = await askText(rl, "OPENAI_TRANSCRIBE_LANGUAGE", {
        defaultValue: currentConfig.openaiLanguage,
        optional: true,
        allowClear: true
      });
    }

    updates.LAN_SHARED_SECRET = await askSecret(rl, mutedOutput, "LAN_SHARED_SECRET", {
      defaultValue: currentConfig.lanSharedSecret,
      optional: true,
      allowClear: true
    });

    output.write("\nSummary\n");
    output.write(`  STT_PROVIDER=${provider}\n`);
    if (provider === "volcengine") {
      output.write(`  VOLCENGINE_APP_KEY=${redactValue(updates.VOLCENGINE_APP_KEY)}\n`);
      output.write(`  VOLCENGINE_ACCESS_KEY=${redactValue(updates.VOLCENGINE_ACCESS_KEY)}\n`);
      output.write(`  VOLCENGINE_RESOURCE_ID=${updates.VOLCENGINE_RESOURCE_ID}\n`);
      output.write(`  VOLCENGINE_LANGUAGE=${updates.VOLCENGINE_LANGUAGE}\n`);
    } else {
      output.write(`  OPENAI_API_KEY=${redactValue(updates.OPENAI_API_KEY)}\n`);
      output.write(`  OPENAI_TRANSCRIBE_MODEL=${updates.OPENAI_TRANSCRIBE_MODEL}\n`);
      output.write(`  OPENAI_TRANSCRIBE_LANGUAGE=${updates.OPENAI_TRANSCRIBE_LANGUAGE || "(auto)"}\n`);
    }
    output.write(`  LAN_SHARED_SECRET=${redactValue(updates.LAN_SHARED_SECRET)}\n\n`);

    const shouldSave = await askYesNo(rl, `Save these values to ${currentConfig.userConfigPath}?`, true);
    if (!shouldSave) {
      output.write("Setup cancelled.\n");
      return { saved: false, userConfigPath: currentConfig.userConfigPath };
    }

    const userConfigPath = writeUserConfigValues(updates);
    output.write(`Saved config to ${userConfigPath}\n`);
    const overridingFiles = (currentConfig.loadedConfigFiles || []).filter((filePath) => filePath !== currentConfig.userConfigPath);
    if (overridingFiles.length > 0) {
      output.write("A local .env file still has higher priority than this user config.\n");
    }
    output.write("Restart vibe if it is already running.\n");
    return { saved: true, userConfigPath };
  } finally {
    rl.close();
  }
}

export async function ensureConfigReadyInteractive() {
  const config = loadConfig({ quietMissing: true });
  if (hasRequiredConfig(config)) {
    return { ready: true, configuredNow: false, config };
  }

  const issues = getConfigIssues(config);
  output.write("\nVibe needs STT configuration before first use.\n");
  for (const issue of issues) {
    output.write(`- ${issue}\n`);
  }
  output.write(`Config file location: ${config.userConfigPath}\n`);

  if (!input.isTTY || !output.isTTY) {
    throw new Error(`Missing configuration. Run "vibe config" to create ${config.userConfigPath}.`);
  }

  const { rl } = createPromptInterface();
  try {
    const shouldConfigure = await askYesNo(rl, "Launch setup now?", true);
    if (!shouldConfigure) {
      throw new Error(`Missing configuration. Run "vibe config" to create ${config.userConfigPath}.`);
    }
  } finally {
    rl.close();
  }

  const result = await runConfigWizard();
  if (!result.saved) {
    throw new Error(`Missing configuration. Run "vibe config" to finish setup.`);
  }

  const refreshedConfig = loadConfig({ quietMissing: true });
  const refreshedIssues = getConfigIssues(refreshedConfig);
  if (refreshedIssues.length > 0) {
    throw new Error(`Configuration is still incomplete: ${refreshedIssues.join(" ")}`);
  }

  return { ready: true, configuredNow: true, config: refreshedConfig };
}
