# Voice Input Method Refactor Plan

## Objective

Refactor `vibecoding-voice` from a LAN hardware voice coding bridge into a focused voice input method.

The target product is a Windows input-method style app that:

- records from the PC or USB microphone;
- optionally records from the existing ESP32 hardware only as a remote push-to-talk microphone;
- injects recognized text into the active input field;
- toggles output mode with a shortcut:
  - `中`: normal Chinese transcript injection;
  - `英`: Chinese voice translated to English before injection;
- shows the current mode in the tray icon;
- stays usable from the tray and global hotkeys.

The hardware boundary is intentionally narrow: keep hardware voice input, remove hardware product features that are not required for dictation, translation, and text injection.

## Product Scope

### Keep

- Electron desktop app.
- Local microphone capture.
- Minimal ESP32 voice-input path:
  - push-to-talk recording;
  - 16 kHz mono PCM audio upload;
  - start / chunk / stop / cancel semantics;
  - enough connection/authentication behavior for safe local use.
- Global hotkeys:
  - hold-to-record;
  - submit;
  - undo pending transcript if confirmation remains enabled;
  - Chinese/English output toggle.
- Tray status and `中` / `英` mode indicator.
- STT providers:
  - Volcengine ASR;
  - OpenAI transcription.
- Voice translation through the existing DeepSeek-compatible translation service.
- Text injection into the active OS input field.
- Windows installer packaging.

### Remove

- Hardware features that are not voice input:
  - e-paper board UI concepts;
  - CLI progress projection;
  - Todo page and Todo voice commands;
  - device-side transcript confirmation UI;
  - multi-page board menus;
  - board-side target / send-mode selection;
  - reconnect/offline/deep-sleep product flows that exist for the old board UI.
- BOOT / UP / DN behavior except the minimum press-to-record control needed by the hardware microphone.
- Firmware release flow for AI-coding/e-paper features.
- UDP LAN discovery if the minimal hardware voice-input path can use a simpler pairing or fixed host configuration.
- LAN HMAC auth and nonce handling only if the replacement hardware audio path has an equivalent safe local trust model. Do not remove network auth while accepting microphone traffic from the LAN.
- External WebSocket device protocol fields that are not required for voice input.
- Hardware flashing docs, release zips, and troubleshooting notes.
- Mock board clients and hardware reconnect smoke tests.

### Decide Before Implementation

The current app also supports Codex, Claude, and Todo modes. For a true input method, remove these from the main product surface. If a voice-to-CLI workflow is still wanted later, rebuild it as a separate integration after the input method is stable.

Recommended decision for this refactor:

- remove Codex / Claude / Todo from the first-class UI;
- keep only `text_injector` behavior;
- delete CLI session code in a later cleanup phase after the desktop input pipeline is green.
- preserve hardware microphone support only if it feeds the same transcript -> optional translation -> injection pipeline as the desktop microphone.

## Target Architecture

### Current Shape

Today both the desktop microphone path and ESP32 path behave like clients of the old bridge server:

```text
renderer microphone
  -> local WebSocket
  -> src/server.mjs
  -> STT
  -> optional translation
  -> text injection / CLI target

ESP32 hardware
  -> LAN WebSocket
  -> src/server.mjs
  -> STT
  -> optional translation
  -> text injection / CLI target / board UI / Todo / CLI projection
```

This keeps hardware-era concepts in the input path: client handshake, WebSocket messages, `ptt_start`, `ptt_stop`, device auth, delivery modes, server broadcast state, board UI state, Todo state, and CLI state.

### Target Shape

The desktop app and the hardware microphone should become two input adapters feeding one input-method pipeline:

```text
renderer microphone capture
  -> Electron IPC audio chunks
  -> main-process voice session
  -> STT
  -> output-mode transform
  -> text injection

ESP32 PTT microphone
  -> minimal hardware audio receiver
  -> main-process voice session
  -> STT
  -> output-mode transform
  -> text injection
```

Proposed modules:

```text
desktop/
  main.mjs
    Owns tray, global hotkeys, settings, voice-session orchestration, injection.

  renderer.js
    Owns microphone capture, UI state, settings form, local visual feedback.

src/
  voice-session.mjs
    Owns one recording lifecycle: start, append PCM chunks, stop, produce transcript.

  hardware-audio-receiver.mjs
    Owns the minimal ESP32 voice-input transport, if hardware support remains.
    It should only expose recording events, not board UI, Todo, or CLI state.

  speech-to-text.mjs
    Thin facade over the existing STT implementation.

  output-mode.mjs
    Owns `zh_direct` versus `zh_to_en` mode and send-text formatting.

  translation-service.mjs
    Keep, but simplify to English-output use first.

  text-injector.mjs
    Keep as the OS injection boundary.

  desktop-settings.mjs
    Keep hotkeys and tray/startup behavior.
```

## Refactor Phases

### Phase 0: Safety Baseline

Goal: make current behavior reproducible before removing anything.

Tasks:

- Keep the current F7 `中` / `英` shortcut and tray indicator.
- Confirm packaged Windows app still starts.
- Confirm microphone record -> transcript -> injection works.
- Confirm English-output mode injects translated English.
- Keep `npm test` green.

Exit gate:

- `npm test` passes.
- Windows installer builds with `npm run desktop:dist`.
- Manual smoke test covers `中` and `英` tray modes.

### Phase 1: Introduce Desktop Voice Session

Goal: create the new voice pipeline while leaving the old server path intact.

Tasks:

- Add `src/voice-session.mjs`.
- Move audio segment assembly out of `src/server.mjs`.
- Expose a small API:
  - `startSession(options)`;
  - `appendPcm16(buffer)`;
  - `stopSession()`;
  - `cancelSession()`.
- Reuse existing PCM16 -> WAV conversion.
- Reuse existing STT provider code.
- Make the session independent of whether audio came from desktop mic or ESP32 mic.
- Return a structured result:
  - `originalText`;
  - `outputText`;
  - `outputMode`;
  - `transform`;
  - `warnings`.

Exit gate:

- Unit tests can run a mocked voice session without WebSocket.
- Existing WebSocket tests still pass.

### Phase 2: Replace Desktop WebSocket With IPC

Goal: make the desktop microphone independent from `src/server.mjs` without breaking the hardware microphone.

Tasks:

- Add IPC handlers in `desktop/main.mjs`:
  - `voice:start`;
  - `voice:chunk`;
  - `voice:stop`;
  - `voice:cancel`;
  - `voice:submit`;
  - `voice:set-output-mode`.
- Update `desktop/preload.cjs` to expose the new voice API.
- Update `desktop/renderer.js` to send audio chunks over IPC instead of WebSocket.
- Keep renderer-owned Web Audio capture.
- Move transcript status events from WebSocket messages to IPC events.
- Keep tray mode sync in main process as the source of truth.
- Keep the ESP32 hardware path on the old WebSocket receiver until a minimal hardware audio receiver has its own smoke test.

Exit gate:

- Desktop microphone works with no local WebSocket connection.
- `src/server.mjs` can be stopped and desktop input still works.
- Text injection works in both `中` and `英` modes.
- ESP32 microphone still works through the temporary legacy path.

### Phase 3: Collapse Product Modes

Goal: remove hardware-era and coding-agent modes from the desktop input method UI.

Tasks:

- Remove `Send Target` UI.
- Remove Codex workspace settings.
- Remove Claude workspace settings.
- Remove LAN Shared Secret from the general desktop settings. If hardware input remains, move the trust setting into a clearly optional Hardware Input section and rename it around pairing/authentication.
- Remove device confirmation language from UI copy.
- Rename settings around input method terms:
  - `Speech`;
  - `Output`;
  - `Injection`;
  - `Hotkeys`;
  - `Startup`.
- Keep `type_only` and `type_and_enter`.
- Decide whether to keep a simple confirmation mode. If kept, make it desktop-local, not "device confirmation".

Exit gate:

- No main workflow UI copy references ESP32, LAN, board, Codex, Claude, or Todo.
- ESP32/LAN/board wording appears only in an optional Hardware Input settings/help section.
- Main path is record -> transform -> inject.

### Phase 4: Remove Hardware Server Surface

Goal: trim the ESP32 path down to voice input only.

Candidate removals or rewrites:

- firmware UI/state that is not needed for PTT voice input;
- `src/discovery-server.mjs`, if replaced by simpler explicit host pairing;
- `src/lan-auth.mjs`, only if replaced by an equivalent safe auth/pairing mechanism;
- hardware sections in `README.md`
- `docs/firmware-reconnect-debug-notes.md`
- `scripts/mock-client.mjs`
- `scripts/reconnect-smoke.mjs`
- hardware-oriented tests:
  - discovery tests, if discovery is removed;
  - LAN auth tests, if auth is replaced;
  - board UI / Todo / CLI projection protocol tests.

Candidate keeps:

- a minimal hardware firmware target that records and uploads audio;
- a minimal host receiver for hardware audio;
- a hardware smoke test that proves PTT -> transcript -> optional translation -> injection.

Config removals:

- old `LAN_DISCOVERY_*` settings if discovery is removed;
- old `LAN_SHARED_SECRET` / `LAN_AUTH_WINDOW_SEC` names if replaced by input-method-oriented names;
- public bind defaults intended for the old multi-feature LAN bridge.

Possible replacement config:

- `HARDWARE_INPUT_ENABLED`;
- `HARDWARE_INPUT_PORT`;
- `HARDWARE_PAIRING_SECRET` or equivalent local trust mechanism.

Exit gate:

- `rg "Codex|Claude|Todo|e-paper|BOOT|UP|DN|board menu|LAN discovery"` returns only intentionally archived changelog/history text, or no results.
- Remaining ESP32 references describe only voice input hardware.
- Package output no longer includes hardware docs or scripts unrelated to voice input.

### Phase 5: Simplify Runtime and Packaging

Goal: make the app feel like a normal input method, not a bridge server.

Tasks:

- Rename npm scripts if needed:
  - `desktop:dev`;
  - `desktop:dist`;
  - optional `doctor`.
- Update `package.json` description and keywords.
- Update `.env.example` to input-method settings, with optional hardware microphone settings isolated in their own block.
- Replace README with:
  - install;
  - configure STT;
  - configure translation;
  - hotkeys;
  - optional hardware microphone setup;
  - troubleshooting text injection.
- Keep Windows packaging first.
- Decide whether Linux support remains in scope. If not, remove Linux-specific injection and Ubuntu packaging docs.

Exit gate:

- Fresh install can be configured without knowing anything about hardware.
- Optional ESP32 setup is documented only as an additional microphone input path.
- Installer launches directly into the input method experience.

## Testing Strategy

### Unit Tests

- desktop settings defaults:
  - F8 record;
  - F9 submit;
  - F10 undo;
  - F7 output toggle.
- output mode:
  - Chinese direct mode returns original transcript;
  - English mode requests translation;
  - translation failure falls back with a visible warning.
- voice session:
  - PCM chunks assemble into one WAV;
  - empty audio returns a clean empty state;
  - concurrent sessions are rejected or cancelled deterministically.
- text injection:
  - `type_only`;
  - `type_and_enter`;
  - dry-run mode.

### Desktop Smoke Tests

- Start app from source.
- Hold F8 and speak Chinese.
- Release F8 and verify Chinese injection.
- Press F7, confirm tray changes to `英`.
- Hold F8 and speak Chinese.
- Release F8 and verify English injection.
- Press F7, confirm tray changes to `中`.
- Confirm app still works from tray after hiding the window.

### Hardware Voice Input Smoke Tests

- Start app from source.
- Press the ESP32 hardware PTT control.
- Speak Chinese.
- Release PTT and verify Chinese injection.
- Press F7 on Windows, confirm tray changes to `英`.
- Press hardware PTT again and verify English injection.
- Confirm no board UI, Todo, Codex, or Claude behavior is involved in the flow.

### Packaging Gates

- `npm test`
- `node --check desktop/main.mjs`
- `node --check desktop/renderer.js`
- `node --check desktop/preload.cjs`
- `npm run desktop:dist`
- Verify packaged ASAR contains only the desktop app assets needed for the input method.

## Migration Risks

### Risk: Hidden coupling to server state

The renderer currently expects `server_ready`, `voice_translation_state`, and transcript status messages. Replace these with IPC events one by one and keep compatibility shims until the desktop path is green.

### Risk: Over-removing the hardware input transport

The goal is not to delete the ESP32 microphone if it still provides useful voice input. Before deleting discovery, auth, WebSocket, or firmware files, classify each piece as either `required for hardware audio input`, `replaceable transport detail`, or `non-input hardware feature`.

### Risk: Secrets move into renderer

Keep API keys and translation calls in the main process or Node-side modules. The renderer should capture audio and display state, not own provider credentials.

### Risk: Global hotkey lifecycle

The current PowerShell low-level keyboard hook works. Keep it initially. Only refactor after the input pipeline no longer depends on WebSocket.

### Risk: Tray icon mode drift

After IPC migration, main process should own the canonical output mode and tray icon. Renderer should request a mode change, not infer long-term truth.

### Risk: Removing CLI modes too early

If Codex/Claude users still depend on the app, hide these modes behind an explicit "legacy integrations" flag for one release before deleting them.

### Risk: Network microphone without trust boundary

If ESP32 audio remains LAN-based, the host must reject untrusted microphone sessions. Keep the current HMAC model until a simpler pairing/auth mechanism exists and is tested.

## Suggested Branch Milestones

1. `codex/input-method-refactor-plan`
   - Plan only.

2. `codex/input-method-voice-session`
   - Add `voice-session.mjs`.
   - Keep old server path.

3. `codex/input-method-ipc-audio`
   - Desktop mic uses IPC, no WebSocket dependency.

4. `codex/input-method-ui-slimdown`
   - Remove hardware and CLI UI concepts.

5. `codex/input-method-hardware-voice-only`
   - Reduce ESP32 support to PTT voice input only.
   - Delete board UI, Todo, CLI projection, and non-input docs/tests.

## Definition of Done

The refactor is complete when:

- the app is understandable as a desktop voice input method;
- hardware is optional and documented only as a voice-input source;
- the ESP32 path, if retained, only records speech and sends audio into the same input-method pipeline;
- F8/F7 hotkeys and tray `中` / `英` modes are the primary workflow;
- text injection is the default and only main send path;
- voice translation is treated as an input-method output mode, not as a coding-agent feature;
- Windows packaging is green;
- tests cover voice session, output mode, translation fallback, and injection.
