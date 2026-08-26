import fs from "node:fs";
import path from "node:path";

import { getUserConfigDir } from "./paths.mjs";

export const DEFAULT_DESKTOP_SETTINGS = Object.freeze({
  autoLaunch: false,
  launchToTray: false,
  closeToTray: false,
  recordTranscripts: true,
  overlayX: null,
  overlayY: null,
  localMicHoldKey: "F8",
  localMicSendKey: "F9",
  localMicUndoKey: "F10",
  localMicTranslationToggleKey: "F7",
  uiLanguage: "zh",
  hasUsedVoice: false
});

export function getDesktopSettingsPath() {
  return path.join(getUserConfigDir(), "desktop-settings.json");
}

export function normalizeDesktopSettings(value = {}) {
  return {
    autoLaunch: value.autoLaunch === true,
    launchToTray: value.launchToTray === true,
    closeToTray: value.closeToTray === true,
    recordTranscripts: value.recordTranscripts !== false,
    overlayX: Number.isFinite(value.overlayX) ? Math.round(value.overlayX) : null,
    overlayY: Number.isFinite(value.overlayY) ? Math.round(value.overlayY) : null,
    localMicHoldKey: normalizeLocalMicHotkey(value.localMicHoldKey, DEFAULT_DESKTOP_SETTINGS.localMicHoldKey),
    localMicSendKey: normalizeLocalMicHotkey(value.localMicSendKey, DEFAULT_DESKTOP_SETTINGS.localMicSendKey),
    localMicUndoKey: normalizeLocalMicHotkey(value.localMicUndoKey, DEFAULT_DESKTOP_SETTINGS.localMicUndoKey),
    localMicTranslationToggleKey: normalizeLocalMicHotkey(
      value.localMicTranslationToggleKey,
      DEFAULT_DESKTOP_SETTINGS.localMicTranslationToggleKey
    ),
    uiLanguage: value.uiLanguage === "en" ? "en" : "zh",
    hasUsedVoice: value.hasUsedVoice === true
  };
}

function normalizeLocalMicHotkey(value, fallback) {
  const normalized = String(value || "").replace(/\s+/g, "");
  if (!normalized || normalized.length > 64) {
    return fallback;
  }
  return normalized;
}

export function loadDesktopSettings() {
  const settingsPath = getDesktopSettingsPath();
  if (!fs.existsSync(settingsPath)) {
    return normalizeDesktopSettings(DEFAULT_DESKTOP_SETTINGS);
  }

  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    return normalizeDesktopSettings(raw);
  } catch {
    return normalizeDesktopSettings(DEFAULT_DESKTOP_SETTINGS);
  }
}

export function writeDesktopSettings(updates = {}) {
  const settingsPath = getDesktopSettingsPath();
  const nextSettings = {
    ...loadDesktopSettings(),
    ...normalizeDesktopSettings(updates)
  };

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(nextSettings, null, 2)}\n`, "utf8");
  return {
    path: settingsPath,
    settings: nextSettings
  };
}
