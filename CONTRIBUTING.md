# Contributing

## Setup

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Fill in your own provider credentials.

## Development

- Run `npm test` before sending a change.
- Use `MOCK_TRANSCRIPT` and `DRY_RUN_TEXT_INJECTION=1` for safe local testing.
- Keep changes scoped; this repo is the host bridge, not the ESP32 firmware.

## Secrets And Local Data

- Never commit `.env`.
- Do not hardcode provider keys, local usernames, or machine-specific paths.
- Prefer generic defaults like `codex` over absolute local shim paths.
