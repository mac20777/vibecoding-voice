// Maps Xiaomi remote button names (from xiaomi-remote-protocol.mjs) to the key
// names understood by scripts/inject-key.ps1. A value of "none" disables the
// button. XIAOMI_REMOTE_BUTTON_MAP overrides single entries, e.g.
// "ok:enter,back:escape,menu:none".

export const DEFAULT_REMOTE_BUTTON_KEYS = Object.freeze({
  up: "up",
  down: "down",
  left: "left",
  right: "right",
  ok: "enter",
  back: "escape",
  home: "home",
  volume_up: "volume_up",
  volume_down: "volume_down",
  menu: "menu"
});

export function parseRemoteButtonMap(override) {
  const map = { ...DEFAULT_REMOTE_BUTTON_KEYS };
  for (const entry of String(override || "").split(",")) {
    const [rawButton, rawKey] = entry.split(":", 2);
    const button = String(rawButton || "").trim().toLowerCase();
    const key = String(rawKey || "").trim().toLowerCase();
    if (!button) {
      continue;
    }
    if (!Object.hasOwn(DEFAULT_REMOTE_BUTTON_KEYS, button)) {
      throw new Error(`Unknown Xiaomi remote button in XIAOMI_REMOTE_BUTTON_MAP: ${button}`);
    }
    if (!key) {
      throw new Error(`Missing key for Xiaomi remote button "${button}" in XIAOMI_REMOTE_BUTTON_MAP`);
    }
    map[button] = key;
  }
  return map;
}
