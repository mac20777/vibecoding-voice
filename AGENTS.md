# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

Host bridge for LAN voice coding with an ESP32 device and Codex CLI. Captures push-to-talk audio via WebSocket, transcribes it using STT providers (OpenAI Whisper or Volcengine), and either injects text into Windows input fields or sends it to a managed Codex CLI session.

## Commands

- **Install**: `npm install`
- **Start server**: `npm start` (runs `node src/server.mjs`)
- **Diagnose environment**: `npm run doctor` (checks CLI tools, API keys, ports)
- **Run all tests**: `npm test` (runs `node --test`)
- **Run single test**: `node --test test/lan-auth.test.mjs`
- **Mock client**: `node scripts/mock-client.mjs` (test WebSocket client)
- **Setup**: Copy `.env.example` to `.env` and configure API keys

## Architecture

ES module Node.js application (requires Node >= 20). Single dependency: `ws` for WebSocket.

### Module Graph

```
server.mjs (entry point — HTTP + WebSocket server)
├── config.mjs           — loads .env, resolves paths, auto-detects CLI shims on Windows
├── discovery-server.mjs — UDP broadcast listener for device discovery
│   └── lan-auth.mjs     — HMAC-SHA256 signing for discovery replies
├── lan-auth.mjs         — validates hello messages (nonce + timestamp freshness)
├── codex-session.mjs    — spawns/manages persistent Codex CLI subprocess
├── Codex-session.mjs   — spawns/manages Codex CLI (Codex -p --output-format stream-json)
├── doctor.mjs           — --doctor diagnostics (STT keys, CLI availability, ports)
├── cli-projector.mjs    — formats CLI state for device e-paper display
├── codex-rate-limits.mjs— reads quota from ~/.codex/sessions .jsonl files
├── xiaomi-remote-runtime.mjs — Xiaomi remote capture (USBPcap named pipe; ATT parsing and mSBC
│   │                             decoding are in-process, no tshark/ffmpeg). The elevated pipe
│   │                             helper (scripts/windows/xiaomi-usbpcap-pipe.ps1) self-heals:
│   │                             owner-PID watchdog on app exit, framed capture generations when
│   │                             the BT adapter is unplugged/replugged (each generation resets the
│   │                             in-process pcap parser). HID-child "driver error" auto-repair is
│   │                             OFF by default (XIAOMI_REMOTE_HID_AUTOREPAIR=1 opts in): a repaired
│   │                             child makes Windows deliver remote keys natively, and a repair
│   │                             mid-pairing-hold can latch a key. The broken child is harmless.
│   ├── usbpcap-att-parser.mjs — streaming pcap → ATT notification lines (replaces tshark)
│   ├── msbc-decoder.mjs     — pure-JS mSBC → PCM16 decoder (replaces ffmpeg)
│   ├── xiaomi-remote-session.mjs — PTT session state machine (inactivity watchdog)
│   ├── xiaomi-remote-info.mjs — reads remote model + battery over WinRT GATT (once at startup)
│   ├── remote-gestures.mjs  — turns raw button down/up into click/double/hold gestures
│   │                          (volume keys auto-repeat while held)
│   └── remote-buttons.mjs   — maps button gestures to actions: key/combo/app/text/prompt/system
│                              (inject-key.ps1 handles single keys and modifier chords;
│                              system-actions.mjs runs shutdown/restart/sleep/lock —
│                              shutdown/restart get an on-screen confirm, OK=run, Back=cancel).
│                              menu defaults to `none` (Windows already delivers usage 0x65
│                              natively as VK_APPS, suppressed by the desktop global hook).
│                              Phantom menu storms are a known HID-child fault:
│                              xiaomi-remote-menu-guard.mjs trips at ≥6 releases/2.5s and
│                              restarts the HID child; menu events are swallowed during
│                              repair, and menu/power actions are rate-limited in server.mjs
│                              against isolated phantom presses below the guard threshold
├── stt.mjs              — speech-to-text (OpenAI Whisper / Volcengine ASR)
│   ├── wav.mjs          — PCM16 → WAV header conversion
│   └── paths.mjs        — resolves project root from import.meta.url
└── text-injector.mjs    — Windows-only text injection via PowerShell + clipboard
    └── scripts/inject-text.ps1
```

### Protocol Flow

1. **Discovery**: Device sends UDP `discover_host` → server replies with WS URL (optionally HMAC-signed)
2. **Handshake**: Device connects WS → sends `hello` (with HMAC signature if auth enabled) → server sends `hello_ack`, `server_ready`, initial CLI state
3. **PTT cycle**: `ptt_start` → binary PCM16 audio chunks → `ptt_stop` → server transcribes → `transcript_final`
4. **Transcript delivery**: Either immediate dispatch or confirm-on-device (`action_send`/`action_undo`). With `confirm_on_device`, both `xiaomi_remote` and `desktop_mic` use `remote_preview` (see `resolveSegmentOptions` in server.mjs): the transcript is shown in the desktop floating overlay first, the remote's OK click / the desktop send key (default `F9`) injects and sends it in one step, Back / the undo key (default `F10`) discards it — the focused input is never touched before confirmation. Injection uses the segment's resolved mode (`TEXT_INJECTION_MODE` for the remote, `type_only` for the desktop mic). A `prompt` button action arms a template so the next voice transcript is wrapped into its `{text}` placeholder before sending.
5. **Codex mode**: Transcript sent to Codex CLI, JSON event stream parsed, state broadcast to all clients

### Key Design Details

- **Audio format**: 16kHz mono PCM16 (signed 16-bit LE)
- **Authentication**: HMAC-SHA256 with message format `type|field1|field2|...`, nonce replay protection, configurable timestamp window (default 300s)
- **Text injection**: Uses clipboard + Ctrl+V + restores previous clipboard (Windows PowerShell only)
- **Codex session**: Spawns via PowerShell wrapper, tracks thread ID for `codex exec resume` continuity
- **CLI projector**: Maintains rolling 8-line log buffer, truncates for e-paper constraints
- **Dictation relay**: Lifecycle events (recording/transcribing/typed/transcript_final…) are sent to the originating client and relayed to `desktop-window` clients (`sendDictationJson` in server.mjs) so the desktop UI can show live status, record transcripts, and drive the floating overlay
- **WeChat voice mode is global and direct-only**: when `XIAOMI_REMOTE_VOICE_MODE=wechat`, both the Xiaomi remote and the desktop F8 mic (`desktop_mic`) stream PCM straight into the virtual microphone publisher (`WindowsVirtualMicrophonePublisher` in server.mjs for the desktop mic) → VB-CABLE → WeChat Input Method's voice-to-text — no STT API key needed. WeChat Input Method keeps focus in the user's current input and types there directly; the app does not open a dictation overlay, capture IME text, relay recognized text through the bridge, or reinject it. WeChat Input Method must be configured once to use `CABLE Output (VB-Audio Virtual Cable)`; the Remote page can open its settings and persists `wechatVirtualMicConfirmed`, while `ensureWechatReady` blocks both remote and F8 dictation until that confirmation exists. For the Xiaomi remote, `BufferedWechatVirtualMicrophoneSession.start()` records PCM and sends the native `PREPARE` message while the key is held so capture routing settles early; after release the native publisher taps `Ctrl+Win+Shift` to start, waits for `shortcut_pressed` before replaying the buffered remote PCM, taps the same shortcut to stop after drain, and waits for `session_idle` after route restoration before allowing the next session. Power confirmations remain allowed to use the general overlay. `ensureWechatReady` checks `wetype_server.exe` rather than the unrelated Weixin/WeChat chat client; it wakes Windows Text Services with `ctfmon.exe` once and otherwise fails the press with an actionable prompt to activate WeChat Input Method. Detection caches a positive answer for 10s (negative for 1.5s) to keep PTT latency at zero.
- **Floating overlay**: `desktop/overlay.html` + `overlay-preload.cjs` — frameless always-on-top window, `focusable: false` so it never steals the injection target's focus; draggable, position persisted in desktop-settings.json (`overlayX/overlayY`)
- **Desktop bridge lifecycle**: the desktop app forks `src/server.mjs` as its bridge child (`VIBE_DESKTOP=1`). The server exits immediately when the IPC channel disconnects (parent crash/force-quit), so it never lingers as an orphan holding the voice port. As a second net, `startBridgeProcess` kills a port-holding orphan before reporting "port in use" — but only when the listener's command line matches this app's server entry AND its parent process is already gone (`findOrphanedBridgePid` in desktop/main.mjs); a deliberately started `npm start` server is left untouched. `stopBridgeProcess` escalates to `taskkill /T /F` if the child ignores the polite kill for 2s.

## Configuration (.env)

**Required** (one STT provider):
- `OPENAI_API_KEY` — for Whisper
- `VOLCENGINE_API_KEY` — for Volcengine ASR (new console, single key; legacy console pair `VOLCENGINE_APP_KEY` + `VOLCENGINE_ACCESS_KEY` still works)

**Key settings**:
- `SEND_TARGET`: `text_injector` (default), `codex_exec`, or `Codex`
- `TRANSCRIPT_DELIVERY_MODE`: `immediate` (default) or `confirm_on_device`
- `LAN_SHARED_SECRET`: enables HMAC authentication
- `LAN_VOICE_PORT` / `LAN_DISCOVERY_PORT`: network ports (default 8765/8766)

**Codex CLI** (when `SEND_TARGET=Codex`):
- `CLAUDE_COMMAND`: path to `Codex` binary (auto-detects `Codex.ps1` shim on Windows)
- `CLAUDE_CWD`: working directory (defaults to project root)
- `CLAUDE_ALLOWED_TOOLS`: comma-separated tools to pre-approve (default: `Read,Edit,Write,Bash,Glob,Grep`)
- `CLAUDE_MAX_TURNS`: max agentic turns per prompt (default: 10)
- `CLI_TIMEOUT_SEC`: kill CLI subprocess after N seconds (default: 300, applies to both Codex and Codex)

**Debug/test flags**:
- `MOCK_TRANSCRIPT`: bypass STT with fixed text
- `STT_TIMEOUT_MS`: hard recognition deadline (default 15000 ms); timed-out requests are aborted
- `DRY_RUN_TEXT_INJECTION`: log without typing
- `SAVE_DEBUG_WAV`: save audio to tmp/
