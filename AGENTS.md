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
│   │                             decoding are in-process, no tshark/ffmpeg)
│   ├── usbpcap-att-parser.mjs — streaming pcap → ATT notification lines (replaces tshark)
│   ├── msbc-decoder.mjs     — pure-JS mSBC → PCM16 decoder (replaces ffmpeg)
│   ├── xiaomi-remote-session.mjs — PTT session state machine (inactivity watchdog)
│   ├── xiaomi-remote-info.mjs — reads remote model + battery over WinRT GATT (once at startup)
│   ├── remote-gestures.mjs  — turns raw button down/up into click/double/hold gestures
│   │                          (volume keys auto-repeat while held)
│   └── remote-buttons.mjs   — maps button gestures to actions: key/combo/app/text/prompt
│                              (inject-key.ps1 handles single keys and modifier chords)
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
4. **Transcript delivery**: Either immediate dispatch or confirm-on-device (`action_send`/`action_undo`). The `desktop_mic` source always forces immediate dispatch (see `resolveSegmentOptions` in server.mjs) — it has no on-device confirm UI. For `xiaomi_remote`, `confirm_on_device` forces `textInjectionMode: "type_only"`: text is typed into the focused input first, and the user sends it with the remote's OK button (mapped to `enter` by default, customizable like any other button gesture). A `prompt` button action arms a template so the next voice transcript is wrapped into its `{text}` placeholder before sending.
5. **Codex mode**: Transcript sent to Codex CLI, JSON event stream parsed, state broadcast to all clients

### Key Design Details

- **Audio format**: 16kHz mono PCM16 (signed 16-bit LE)
- **Authentication**: HMAC-SHA256 with message format `type|field1|field2|...`, nonce replay protection, configurable timestamp window (default 300s)
- **Text injection**: Uses clipboard + Ctrl+V + restores previous clipboard (Windows PowerShell only)
- **Codex session**: Spawns via PowerShell wrapper, tracks thread ID for `codex exec resume` continuity
- **CLI projector**: Maintains rolling 8-line log buffer, truncates for e-paper constraints
- **Dictation relay**: Lifecycle events (recording/transcribing/typed/transcript_final…) are sent to the originating client and relayed to `desktop-window` clients (`sendDictationJson` in server.mjs) so the desktop UI can show live status, record transcripts, and drive the floating overlay
- **Floating overlay**: `desktop/overlay.html` + `overlay-preload.cjs` — frameless always-on-top window, `focusable: false` so it never steals the injection target's focus; draggable, position persisted in desktop-settings.json (`overlayX/overlayY`)

## Configuration (.env)

**Required** (one STT provider):
- `OPENAI_API_KEY` — for Whisper
- `VOLCENGINE_APP_KEY` + `VOLCENGINE_ACCESS_KEY` — for Volcengine ASR

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
- `DRY_RUN_TEXT_INJECTION`: log without typing
- `SAVE_DEBUG_WAV`: save audio to tmp/
