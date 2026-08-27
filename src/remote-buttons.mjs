// Maps Xiaomi remote button gestures (from remote-gestures.mjs) to actions.
//
// Action types:
//   { type: "none" }                          — do nothing
//   { type: "key", key: "enter" }             — single key tap (inject-key.ps1)
//   { type: "combo", combo: "ctrl+shift+p" }  — modifier + key chord
//   { type: "app", command: "chrome" }        — launch an app / command line
//   { type: "text", text: "…" }               — type a preset snippet
//   { type: "prompt", name: "优化" }          — wrap the NEXT voice transcript
//                                               in the named prompt template
//   { type: "system", command: "shutdown" }   — power/session action; shutdown
//                                               and restart ask for on-screen
//                                               confirmation first (server.mjs)
//
// XIAOMI_REMOTE_BUTTON_MAP overrides single entries. Format:
//   new:  "ok.click=key:enter, ok.double=app:chrome, back.hold=none"
//   old:  "ok:enter, menu:none"  (legacy, means ok.click=key:enter)
// Payloads are percent-encoded so commas and colons survive.

export const REMOTE_BUTTONS = Object.freeze([
  "up", "down", "left", "right", "ok", "back", "home", "volume_up", "volume_down", "menu", "power"
]);

export const REMOTE_GESTURES = Object.freeze(["click", "double", "hold"]);

export const ACTION_TYPES = Object.freeze(["none", "key", "combo", "app", "text", "prompt", "system"]);

// Values accepted by { type: "system", command }. Shutdown/restart go through
// a confirmation step before executing; sleep/lock run immediately.
export const SYSTEM_COMMANDS = Object.freeze(["shutdown", "restart", "sleep", "lock"]);

const keyAction = (key) => Object.freeze({ type: "key", key });

export const DEFAULT_REMOTE_ACTIONS = Object.freeze({
  up: Object.freeze({ click: keyAction("up") }),
  down: Object.freeze({ click: keyAction("down") }),
  left: Object.freeze({ click: keyAction("left") }),
  right: Object.freeze({ click: keyAction("right") }),
  ok: Object.freeze({ click: keyAction("enter") }),
  back: Object.freeze({ click: keyAction("escape") }),
  home: Object.freeze({ click: keyAction("home") }),
  volume_up: Object.freeze({ click: keyAction("volume_up") }),
  volume_down: Object.freeze({ click: keyAction("volume_down") }),
  // Windows receives usage 0x65 through its native HID keyboard path as well
  // as our USBPcap path. Default to no second injection; users can still map
  // Menu to any action (including key:menu) in the Remote page.
  menu: Object.freeze({ click: Object.freeze({ type: "none" }) }),
  // Power is a regular configurable button. Its default click action requests
  // shutdown, which still goes through the shared on-screen confirmation flow.
  power: Object.freeze({ click: Object.freeze({ type: "system", command: "shutdown" }) })
});

export function cloneDefaultRemoteActions() {
  const map = {};
  for (const button of REMOTE_BUTTONS) {
    map[button] = { ...DEFAULT_REMOTE_ACTIONS[button] };
  }
  return map;
}

export function normalizeAction(action) {
  if (!action || typeof action !== "object") {
    return null;
  }
  switch (action.type) {
    case "none":
      return { type: "none" };
    case "key": {
      const key = String(action.key || "").trim().toLowerCase();
      return key ? { type: "key", key } : null;
    }
    case "combo": {
      const combo = String(action.combo || "").trim().toLowerCase();
      return combo ? { type: "combo", combo } : null;
    }
    case "app": {
      const command = String(action.command || "").trim();
      return command ? { type: "app", command } : null;
    }
    case "text": {
      const text = String(action.text || "");
      return text.trim() ? { type: "text", text } : null;
    }
    case "prompt": {
      const name = String(action.name || "").trim();
      return name ? { type: "prompt", name } : null;
    }
    case "system": {
      const command = String(action.command || "").trim().toLowerCase();
      return SYSTEM_COMMANDS.includes(command) ? { type: "system", command } : null;
    }
    default:
      return null;
  }
}

function parseActionSpec(spec) {
  const raw = String(spec || "").trim();
  if (!raw) {
    return null;
  }
  if (raw === "none") {
    return { type: "none" };
  }
  const sepIndex = raw.indexOf(":");
  if (sepIndex < 0) {
    // Bare key name (legacy value position), e.g. "ok:enter".
    return normalizeAction({ type: "key", key: raw });
  }
  const type = raw.slice(0, sepIndex).trim().toLowerCase();
  const payload = decodeURIComponent(raw.slice(sepIndex + 1));
  const field = { key: "key", combo: "combo", app: "command", text: "text", prompt: "name", system: "command" }[type];
  return field ? normalizeAction({ type, [field]: payload }) : null;
}

export function serializeAction(action) {
  const normalized = normalizeAction(action);
  if (!normalized) {
    return "";
  }
  switch (normalized.type) {
    case "none":
      return "none";
    case "key":
      return `key:${encodeURIComponent(normalized.key)}`;
    case "combo":
      return `combo:${encodeURIComponent(normalized.combo)}`;
    case "app":
      return `app:${encodeURIComponent(normalized.command)}`;
    case "text":
      return `text:${encodeURIComponent(normalized.text)}`;
    case "prompt":
      return `prompt:${encodeURIComponent(normalized.name)}`;
    case "system":
      return `system:${encodeURIComponent(normalized.command)}`;
    default:
      return "";
  }
}

export function actionsEqual(a, b) {
  return serializeAction(a) === serializeAction(b);
}

/**
 * Parses XIAOMI_REMOTE_BUTTON_MAP into { button: { gesture: action } } with
 * defaults filled in. Unknown buttons/gestures throw so config typos surface;
 * malformed entries are ignored.
 */
export function parseRemoteActionMap(override) {
  const map = cloneDefaultRemoteActions();
  for (const entry of String(override || "").split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed.includes("=")) {
      const eqIndex = trimmed.indexOf("=");
      const target = trimmed.slice(0, eqIndex).trim().toLowerCase();
      const [button, gesture = "click"] = target.split(".");
      if (!Object.hasOwn(DEFAULT_REMOTE_ACTIONS, button)) {
        throw new Error(`Unknown Xiaomi remote button in XIAOMI_REMOTE_BUTTON_MAP: ${button}`);
      }
      if (!REMOTE_GESTURES.includes(gesture)) {
        throw new Error(`Unknown Xiaomi remote gesture in XIAOMI_REMOTE_BUTTON_MAP: ${gesture}`);
      }
      const action = parseActionSpec(trimmed.slice(eqIndex + 1));
      if (action) {
        map[button][gesture] = action;
      }
      continue;
    }

    // Legacy "button:key" entries configure the click gesture.
    const [rawButton, rawKey] = trimmed.split(":", 2);
    const button = String(rawButton || "").trim().toLowerCase();
    if (!button) {
      continue;
    }
    if (!Object.hasOwn(DEFAULT_REMOTE_ACTIONS, button)) {
      throw new Error(`Unknown Xiaomi remote button in XIAOMI_REMOTE_BUTTON_MAP: ${button}`);
    }
    const key = String(rawKey || "").trim().toLowerCase();
    if (!key) {
      throw new Error(`Missing key for Xiaomi remote button "${button}" in XIAOMI_REMOTE_BUTTON_MAP`);
    }
    map[button].click = parseActionSpec(key);
  }
  return map;
}

/**
 * Serializes only the entries that differ from defaults. Legacy consumers
 * used a flat "button:key" string; new entries use "button.gesture=type:value".
 */
export function serializeRemoteActionMap(map) {
  const entries = [];
  for (const button of REMOTE_BUTTONS) {
    for (const gesture of REMOTE_GESTURES) {
      const action = map?.[button]?.[gesture];
      if (!action) {
        continue;
      }
      const defaultAction = DEFAULT_REMOTE_ACTIONS[button]?.[gesture] || null;
      if (defaultAction && actionsEqual(action, defaultAction)) {
        continue;
      }
      const spec = serializeAction(action);
      if (spec) {
        entries.push(`${button}.${gesture}=${spec}`);
      }
    }
  }
  return entries.join(", ");
}

/** Back-compat helper: the click-gesture key of each button, as before. */
export function parseRemoteButtonMap(override) {
  const actions = parseRemoteActionMap(override);
  const map = {};
  for (const button of REMOTE_BUTTONS) {
    const click = actions[button]?.click;
    map[button] = click?.type === "key" ? click.key : click?.type === "none" ? "none" : "";
  }
  return map;
}

// Legacy flat shape kept for older callers/tests: button -> click key name.
export const DEFAULT_REMOTE_BUTTON_KEYS = Object.freeze(
  Object.fromEntries(
    REMOTE_BUTTONS.map((button) => {
      const click = DEFAULT_REMOTE_ACTIONS[button].click;
      return [button, click.type === "key" ? click.key : click.type === "none" ? "none" : ""];
    })
  )
);

// While a remote preview is pending (confirm_on_device), these button+gesture
// combos become modal: confirm injects and sends the previewed text, undo pops
// the last appended segment, discard cancels the whole preview.
export const PREVIEW_ACTIONS = Object.freeze(["confirm", "undo", "discard"]);

export const DEFAULT_PREVIEW_KEYS = Object.freeze({
  confirm: Object.freeze({ button: "ok", gesture: "click" }),
  undo: Object.freeze({ button: "back", gesture: "click" }),
  discard: Object.freeze({ button: "back", gesture: "double" })
});

/**
 * XIAOMI_REMOTE_PREVIEW_KEYS overrides single entries. Format:
 *   "confirm:ok.click, undo:back.click, discard:back.double"
 * Unknown actions/buttons/gestures fall back to the default for that entry.
 */
export function parsePreviewKeys(spec) {
  const keys = { ...DEFAULT_PREVIEW_KEYS };
  for (const entry of String(spec || "").split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    const [rawAction, rawTarget] = trimmed.split(":", 2);
    const action = String(rawAction || "").trim().toLowerCase();
    const [button, gesture] = String(rawTarget || "").trim().toLowerCase().split(".");
    if (!PREVIEW_ACTIONS.includes(action)) {
      continue;
    }
    if (!REMOTE_BUTTONS.includes(button) || !REMOTE_GESTURES.includes(gesture)) {
      continue;
    }
    keys[action] = { button, gesture };
  }
  return keys;
}

export function serializePreviewKeys(keys) {
  const entries = [];
  for (const action of PREVIEW_ACTIONS) {
    const value = keys?.[action];
    if (!value) {
      continue;
    }
    const fallback = DEFAULT_PREVIEW_KEYS[action];
    if (value.button === fallback.button && value.gesture === fallback.gesture) {
      continue;
    }
    entries.push(`${action}:${value.button}.${value.gesture}`);
  }
  return entries.join(", ");
}

/**
 * XIAOMI_REMOTE_PROMPT_TEMPLATES holds a JSON array:
 *   [{"name": "优化", "body": "优化下面这段话，去掉语气词：{text}"}]
 * `{text}` is replaced by the next voice transcript when the template is armed
 * by a prompt action. Tolerant parser: invalid JSON or shape yields [].
 */
export function parsePromptTemplates(json) {
  try {
    const parsed = JSON.parse(String(json || "").trim() || "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry) => ({
        name: String(entry?.name || "").trim(),
        body: String(entry?.body || "")
      }))
      .filter((entry) => entry.name && entry.body.trim());
  } catch {
    return [];
  }
}

export function applyPromptTemplate(templateBody, transcript) {
  const body = String(templateBody || "");
  const text = String(transcript || "").trim();
  if (body.includes("{text}")) {
    return body.replaceAll("{text}", text);
  }
  return `${body.trim()}\n${text}`.trim();
}
