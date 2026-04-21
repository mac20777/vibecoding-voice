import fs from "node:fs";
import path from "node:path";

import { getUserConfigDir } from "./paths.mjs";

export const DEFAULT_DESKTOP_SETTINGS = Object.freeze({
  autoLaunch: false,
  launchToTray: false,
  closeToTray: false
});

export function getDesktopSettingsPath() {
  return path.join(getUserConfigDir(), "desktop-settings.json");
}

export function normalizeDesktopSettings(value = {}) {
  return {
    autoLaunch: value.autoLaunch === true,
    launchToTray: value.launchToTray === true,
    closeToTray: value.closeToTray === true
  };
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
