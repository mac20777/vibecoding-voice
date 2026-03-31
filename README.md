# vibecoding-voice

`vibecoding-voice` is the host-side bridge for a LAN voice-coding setup built around an ESP32 device. It receives push-to-talk PCM audio over WebSocket, sends it to a speech-to-text provider, and then either:

- injects the transcript into the active Windows input box, or
- submits the transcript to a managed Codex CLI session and projects the latest status back to the device UI.

This repository contains the host bridge only. The ESP32 firmware lives in the board project and speaks a small JSON + binary WebSocket protocol to this server.

## Features

- 16 kHz mono PCM ingest over WebSocket
- STT via Volcengine flash ASR or OpenAI transcription
- optional Windows text injection
- managed `codex exec --json` session bridge
- projected Codex status, summary, log tail, and quota snapshot for e-paper UI
- device-side confirmation flow: transcript first, then `send` / `undo`

## Requirements

- Node.js 20 or newer
- Windows for text injection
- Codex CLI on your `PATH` if you use `SEND_TARGET=codex_exec`
- an STT provider key:
  - Volcengine `VOLCENGINE_APP_KEY` + `VOLCENGINE_ACCESS_KEY`, or
  - `OPENAI_API_KEY`

## Quick Start

1. Install dependencies.

```powershell
npm install
```

2. Create a local config file.

```powershell
Copy-Item .env.example .env
```

3. Edit `.env`.

Common defaults:

```env
STT_PROVIDER=volcengine
VOLCENGINE_APP_KEY=your-app-key
VOLCENGINE_ACCESS_KEY=your-access-key
VOLCENGINE_RESOURCE_ID=volc.bigasr.auc_turbo
VOLCENGINE_LANGUAGE=zh-CN
LAN_VOICE_PORT=8765
LAN_DISCOVERY_ENABLED=1
LAN_DISCOVERY_PORT=8766
LAN_SHARED_SECRET=replace-with-a-random-secret
SEND_TARGET=codex_exec
TRANSCRIPT_DELIVERY_MODE=confirm_on_device
TEXT_INJECTION_MODE=type_only
CODEX_COMMAND=codex
CODEX_CWD=.
```

4. Start the bridge.

```powershell
npm start
```

5. Point the device firmware at:

```text
ws://<your-lan-ip>:8765
```

6. Set the same `LAN_SHARED_SECRET` in the device firmware local config before you flash it. The secret is not meant to be committed to git.

## Device Wi-Fi Setup

- If the device has no saved Wi-Fi credentials, it boots into config AP mode automatically.
- The device shows the AP SSID, AP password, and `http://192.168.4.1` on the e-paper screen.
- Connect your phone or laptop to that AP, open `http://192.168.4.1`, and save your Wi-Fi credentials.
- To force Wi-Fi setup again later, hold `UP + DOWN` on the device until it clears saved Wi-Fi and re-enters config AP mode.
- The config AP now uses WPA/WPA2 instead of an open network. The password is derived from the device identity and displayed on screen.

## Configuration

- `STT_PROVIDER`: `volcengine` or `openai`. If omitted, the server infers the provider from configured keys.
- `VOLCENGINE_APP_KEY`: Volcengine app key.
- `VOLCENGINE_ACCESS_KEY`: Volcengine access key.
- `VOLCENGINE_RESOURCE_ID`: defaults to `volc.bigasr.auc_turbo`.
- `VOLCENGINE_LANGUAGE`: defaults to `zh-CN`.
- `OPENAI_API_KEY`: OpenAI API key.
- `OPENAI_TRANSCRIBE_MODEL`: defaults to `whisper-1`.
- `OPENAI_TRANSCRIBE_LANGUAGE`: optional, for example `zh`.
- `LAN_VOICE_BIND`: defaults to `0.0.0.0`.
- `LAN_VOICE_PORT`: defaults to `8765`.
- `LAN_DISCOVERY_ENABLED`: defaults to `1`. Enables UDP host discovery on the LAN.
- `LAN_DISCOVERY_PORT`: defaults to `8766`.
- `LAN_DISCOVERY_HOST_ID`: optional stable host identifier. Useful if more than one bridge is running on the same LAN.
- `LAN_SHARED_SECRET`: optional shared secret for device authentication. Strongly recommended outside a fully trusted LAN.
- `LAN_AUTH_WINDOW_SEC`: timestamp freshness window for HMAC auth. Defaults to `300`.
- `SEND_TARGET`: `text_injector` or `codex_exec`.
- `TRANSCRIPT_DELIVERY_MODE`: `immediate` or `confirm_on_device`.
- `TEXT_INJECTION_MODE`: `type_only` or `type_and_enter`.
- `CODEX_COMMAND`: Codex CLI executable or shim path.
- `CODEX_CWD`: workspace path for Codex. Relative paths resolve from the repository root.
- `CODEX_SKIP_GIT_REPO_CHECK`: set to `1` to pass `--skip-git-repo-check`.
- `DRY_RUN_TEXT_INJECTION`: set to `1` to log transcripts without sending keystrokes.
- `MOCK_TRANSCRIPT`: bypass STT and always return this transcript.
- `SAVE_DEBUG_WAV`: set to `1` to save each segment into `tmp/`.

## Development

Run tests:

```powershell
npm test
```

Useful local modes:

- set `MOCK_TRANSCRIPT=hello world` to bypass STT
- set `DRY_RUN_TEXT_INJECTION=1` to avoid typing into the active window
- use `scripts/mock-client.mjs` to simulate a device connection

## LAN Host Discovery

The bridge can advertise itself over UDP so the ESP32 device does not need a fixed host IP.

- The host listens for discovery requests on `LAN_DISCOVERY_PORT`.
- The device sends a UDP broadcast and receives a reply with the current WebSocket URL.
- If you run more than one bridge on the same network, set `LAN_DISCOVERY_HOST_ID` on the host and configure the device to expect the same ID.
- If `LAN_SHARED_SECRET` is set on both host and device, discovery replies and device `hello` messages are HMAC-signed.

This is the recommended way to survive DHCP IP changes without hardcoding your PC address.

## Security And Privacy

- Keep `.env` local. It is ignored by git and should never be committed.
- Set `LAN_SHARED_SECRET` before using the bridge on a shared or untrusted LAN.
- Audio segments are sent to the configured STT provider. Review provider retention and privacy settings before public demos or team use.
- If you use `SEND_TARGET=codex_exec`, Codex may store local session history under the current user's home directory.
- Windows text injection temporarily touches the clipboard to paste text, then restores previous clipboard text when possible.

## Open Source Readiness

Before publishing the repository, you should still decide and add:

- a project license
- a public repository URL in `package.json` if you plan to publish metadata
- screenshots or a short demo GIF of the device + host workflow

## Notes

- This repo currently targets the LAN MVP, not the future relay-based remote version.
- Volcengine support currently uses the flash recognition API:
  - <https://www.volcengine.com/docs/6561/1631584?lang=zh>
- If you want true incremental transcripts later, the next step is Volcengine's streaming ASR:
  - <https://www.volcengine.com/docs/6561/1354869?lang=zh>
